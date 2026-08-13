---
type: "Architecture Decision Record"
title: "ADR 0003: fail-closed な評価契約と capability の順序保証"
description: "consumerはFlagship到達不能や未対応versionをすべてoffとして扱い、capabilityの本番到達より前にflagがONにならないことを保証する。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/0003-fail-closed-consumer-contract.md"
tags: [flags, adr, architecture, fail-closed, ordering, cloudflare-flagship]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:12:00Z
---

# ADR 0003: fail-closed な評価契約と capability の順序保証

## ステータス

承認済み

## 日付

2026-08-13

## コンテキスト

flagsはHome/Blog/Contentのdeployとは独立にflagを変更する。したがって、あるconsumerがまだ実装していない、あるいはまだ本番へDeployしていないcapabilityに対応するflagを誤ってONにしても、そのconsumerが安全に振る舞う必要がある。同様に、Cloudflare FlagshipのPublic Beta基盤への到達性やレイテンシは保証されないため、評価が失敗する経路は必ず存在する。

Flagshipの変更はCloudflareのedgeへ伝播するまで最大30秒かかる。この間、古い値と新しい値が混在して観測され得る。

## 決定

**fail closed を評価契約の根幹に置く。** 未定義のflag key、評価の失敗、値の型不一致、Flagshipへの到達不能は、例外を投げることも古い値へfallbackすることもなく、すべて`off`として扱う。この契約はconsumer側のFlagship SDK呼び出しが守るべきものであり、`policy-lib.mjs`の`evaluateFlag()`が参照実装として同じ規則を表現する。

**capabilityの順序を`minVersion`で保証する。** `registry/<key>.json`の`consumers[].minVersion`は「このflagを解釈できる最初のconsumer version」を記録する。consumerは実行時に自分自身のversionを知っているため、`minVersion`より古ければ、Flagship側でflagがONであっても`off`として扱う。これにより、capabilityがまだ本番に出ていないconsumerへ機能が漏れることを実行時に構造的へ防ぐ。

**CI時の検証は補助であり、実行時のfail-closedが本命である。** `verify-consumers.mjs`は、flagをONにするPRについて、宣言された全consumerの直近の成功production Deploymentのversionが`minVersion`以上であることをGitHub Deploymentsから検証する。この検証はPRをブロックする効果はあるが、実行時のfail-closed契約を代替するものではない。両者は独立した防御層である。

**伝播中の混在を許容する。** Flagshipの変更が全edgeへ伝播するまで最大30秒を要するため、同期直後はリクエストによって新旧どちらの値も観測され得る。同期workflowはこの遅延を前提とし、drift check（ADR 0002）による整合確認より前にsmokeを実行する場合は、この遅延を考慮した待機を行う。

## 検討した選択肢

- 評価失敗時に前回の既知の値へfallbackする契約
- 評価失敗時に例外を投げてconsumer側の呼び出し元に処理を委ねる契約
- CI時の`minVersion`検証だけに頼り、実行時のバージョン比較を省略する契約
- 実行時のfail-closedとminVersion比較を評価契約の根幹に置き、CI検証を補助とする契約

## 結果

Flagshipへの到達不能やPublic Betaの不安定性が、機能の誤爆や例外としてconsumerへ波及しない。capabilityより先にflagが観測される事故は、consumer自身のversion比較によって実行時に閉じる。CIのconsumer readiness検証は、この実行時契約が正しく機能するための前提（capabilityが実際にDeploy済みであること）を、flagをONにする時点で人間にも示す。

## 関連文書

- [flag評価仕様](../features/flag-evaluation.feature)
- [Flagship同期仕様](../features/flagship-sync.feature)
- [ADR 0001: flags のリポジトリ境界](0001-repository-boundary.md)
- [ADR 0002: git を正本とした Cloudflare Flagship への config-as-code 同期](0002-git-as-flagship-source-of-record.md)
