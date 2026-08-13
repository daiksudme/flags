---
type: "Architecture Decision Record"
title: "ADR 0001: flags のリポジトリ境界"
description: "feature flagの定義とCloudflare Flagshipへの同期をflagsリポジトリだけが所有することを定める。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/0001-repository-boundary.md"
tags: [flags, adr, architecture, repository-boundary]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:10:00Z
---

# ADR 0001: flags のリポジトリ境界

## ステータス

承認済み

## 日付

2026-08-13

## コンテキスト

Home、Blog、Contentの配信サービス層は、共通のfeature flag機構を必要とする。当初はHomeが`wrangler flagship`によるCloudflare Flagshipとの連携を実装し、各リポジトリが自分のflagを自分で管理する設計になっていた。この構成では、flagを変更する権限とCloudflare Flagship credentialが複数のリポジトリのworkflowへ分散し、Public Betaであるflagship CLI/APIの変更を検証すべき箇所も複数に散る。

さらに、flagを保持するリポジトリ自身が機能を公開する構成では、機能公開のたびにそのリポジトリのmergeとDeployが必要になり、Deployの成否と公開の成否が同じworkflowで絡み合う。

## 決定

feature flagの定義と状態をflagsリポジトリだけが所有する。`registry/<key>.json`をgit上の正本とし、Cloudflare Flagshipへ書き込める権限（`CLOUDFLARE_FLAGSHIP_API_TOKEN`）はflagsリポジトリのworkflowだけが持つ。Home、Blog、Contentの配信サービス層はconsumerとして、実行時にFlagship SDK経由でflagを評価するだけであり、flagを変更する権限を一切持たない。

flagsはWorker実装を持たない。Cloudflare Flagship自体が実行時の評価ストアであるため、flags独自の評価APIを追加する必要がない。flagsが提供するのはgitの正本とそれをFlagshipへ反映するsync workflow、およびconsumerがreadyであることを検証するCI gateである。

## 検討した選択肢

- 各consumerリポジトリが自分の使うflagを自分で管理する構成（旧設計）
- flagsリポジトリがWorker上で評価APIを提供する構成
- flagsリポジトリがgitの正本を持ち、Cloudflare Flagshipへ同期し、consumerはFlagship SDKで直接評価する構成

## 結果

Cloudflare Flagship write権限が1リポジトリに閉じ込められ、Public Betaの破壊的変更を検証すべき対象がflagsだけになる。Home、Blog、Contentのworkflowからflagship関連のcredentialと処理が完全に消える。機能公開（Product Release）はflagsでのflag変更として、consumerの再Deployを伴わずに完結する。

## 関連文書

- [flag registry仕様](../features/flags-registry.feature)
- [Home](https://github.com/daiksudme/home)
- [Blog](https://github.com/daiksudme/blog)
- [Content](https://github.com/daiksudme/content)
