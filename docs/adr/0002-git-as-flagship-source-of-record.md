---
type: "Architecture Decision Record"
title: "ADR 0002: git を正本とした Cloudflare Flagship への config-as-code 同期"
description: "registryのJSONを正本とし、mainへのmergeごとに単一workflowでtagを打ちFlagshipへ同期する。dashboardからの直接編集は禁止しdrift checkで検出する。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/0002-git-as-flagship-source-of-record.md"
tags: [flags, adr, architecture, cloudflare-flagship, deploy, release, semver]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:11:00Z
---

# ADR 0002: git を正本とした Cloudflare Flagship への config-as-code 同期

## ステータス

承認済み

## 日付

2026-08-13

## コンテキスト

flagの状態変更は、誰が・いつ・なぜ変更したかを監査でき、かつロールバックできる必要がある。Cloudflare Flagshipのdashboardから直接編集すると、変更が誰にレビューされたか、なぜ変更したかの記録が残らず、gitの履歴と実際の状態が容易に乖離する。

一方で、flagsリポジトリ自身がConsumerではないため、Home/Blog/Contentのような「配信サービス」としてのDeployは存在しない。flagsにとって「main更新」は「Flagshipの状態を変える」ことそのものであり、これはコード配送ではなくProduct Releaseである。

## 決定

`registry/<key>.json`をgit上の正本とし、Cloudflare Flagshipを「gitの状態を反映した実行時ストア」として扱う。Flagship dashboardからの直接編集は禁止する。

mainへのPR mergeごとに、単一の`sync.yml` workflowが次を順に実行する。

1. PRタイトルの型に対して`package.json#version`が正しく上がっているかを検証する（`policy.mjs pull-request`はPR時、mergeされたrevisionのtag解決は`policy.mjs revision`が行う）
2. revisionに対応するtagを解決し、存在しなければ作成してpushする
3. registry内の全descriptorをproduction/staging/developmentの各Flagship appへ同期する（`sync-flagship.mjs`）
4. sync receiptを記録する（`record-deployment.mjs`）
5. SemVer coreが上がっていればGitHub Releaseを作る
6. `drift-check.mjs`で最新tagとreceiptの整合、およびgitとFlagshipの実状態の整合を検証する

tag打ちと同期を1つのworkflowにまとめるのは、`GITHUB_TOKEN`によるpushが新しいworkflow runを起動しないためである。分離するとtag push workflowから同期workflowを起動するのにPersonal Access Tokenが必要になる。

versionの意味は他のconsumerリポジトリと異なる。flagをONにするPRは`feat:`（minor）、OFFに戻すPRは`revert:`（patch）とする。registryの記述変更など状態を変えないPRは`docs:`/`chore:`とし、version coreを変えない代わりに`vX.Y.Z+YYYYMMDDHHmmss`のbuild識別子付きtagを打って同期を再実行する。build識別子はmerge commitのcommitter時刻をUTC変換したものであり、実行時刻ではなくcommitの属性なので、リトライしても同じtagに解決する。build識別子付きtagはGitHub Releaseを作らない。

同期のリトライは外部要因と判断できる失敗だけを最大3回に限る。Cloudflare APIの5xx、429、タイムアウト、接続リセット、DNS解決失敗を外部要因とし、build失敗、test失敗、descriptor validationの失敗、401/403、429以外の4xxは即座にfailさせる。リトライはtagを打ち直さない。

最新tagと同期済み状態が一致することを不変条件とし、`drift-check.mjs`がsync receiptとの整合を検証する。SemVerはbuild metadataを優先順位の比較に使わないため、最新tagは辞書順ではなくSemVer precedenceとcommit topologyで判定する。加えて`drift-check.mjs`はFlagshipの実際のflag状態をgitのregistryと突き合わせ、乖離があれば（dashboardからの直接編集を含め）CIを失敗させる。

## 検討した選択肢

- Cloudflare Flagship dashboardから直接flagを操作する構成
- flagsリポジトリが独自の評価APIを提供し、Flagshipを使わない構成
- tag専用workflowと同期workflowを分離する構成
- registryをgitの正本とし、単一workflowでFlagshipへ同期し、drift checkで乖離を検出する構成

## 結果

flagの変更履歴はすべてPRとしてgitに残り、レビューを経る。Flagship側の状態はgitからの一方向の反映結果であり、dashboardからの逸脱はdrift checkが検出する。同期の失敗はDeployと同じ分類・リトライ・fix-forwardの規律に従うため、他リポジトリの運用者が新しい手順を覚える必要がない。

Public BetaであるFlagship CLI/APIの破壊的変更は、同期処理を持つflagsリポジトリだけで再検証すればよい。

## 関連文書

- [Flagship同期仕様](../features/flagship-sync.feature)
- [flag registry仕様](../features/flags-registry.feature)
- [ADR 0001: flags のリポジトリ境界](0001-repository-boundary.md)
- [ADR 0003: fail-closed な評価契約](0003-fail-closed-consumer-contract.md)
