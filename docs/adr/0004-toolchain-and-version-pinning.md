---
type: "Architecture Decision Record"
title: "ADR 0004: ツールチェーンと検証"
description: "Node.js、pnpmとscriptだけの構成を固定し、registry検証とworkflow構造検査をCIの必須ゲートにすることを定める。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/0004-toolchain-and-version-pinning.md"
tags: [flags, adr, architecture, toolchain, validation]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:13:00Z
---

# ADR 0004: ツールチェーンと検証

## ステータス

承認済み

## 日付

2026-08-13

## コンテキスト

flagsはAstroページもCloudflare Workerも持たず、`registry/`のJSONと`.github/scripts/`のNode scriptだけで構成される。この構成でも、他のdaiksudmeリポジトリと同じ水準の再現可能性と検証を維持する必要がある。

## 決定

Node.js 24.16.0以降、pnpm 11を標準ツールチェーンとし、pnpmを直接使って依存取得とscript実行を行う。pnpm自体と直接依存するツールのversionはマニフェストへ正確に指定し、解決結果はリポジトリ単位のlockfileへ固定する。JavaScript、TypeScript、JSONの整形と lintはBiome、MarkdownはrumdlとPrettierが分担し、Astro向けの整形設定やstylelintは持たない。意味的検査はESLintとKnipに分担し、Cloudflare Flagshipとの通信にはWrangler `4.107.0`を固定して使う。

`node --test`によるunit testを2系統持つ。`policy.test.mjs`はregistry検証とversion計算などの純粋関数を検査し、`workflow-policy.test.mjs`はaction pinの版数対応、labelerの安全性、sync workflowのgatingとcredential分離、drift checkの構成など、workflow YAMLの構造そのものを検査する。両方とも`pnpm validate`から実行され、CIの`policy` jobでも同じコマンドを実行する。

Knipは`.github/workflows/*.yml`の`run:`ステップを解析し、そこで参照される`.github/scripts/*.mjs`をentry pointとして自動検出する。したがって新しいscriptを追加する場合は、対応するworkflowのstepからも呼び出されなければ「未使用ファイル」として検出される。

## 検討した選択肢

- Astro向けの整形設定とstylelintをそのまま残す構成
- Knipの設定を個別に手動管理し、workflow解析に依存しない構成
- registry検証だけをCIで実行し、workflow構造自体は検査しない構成
- Node.js/pnpmへ絞った軽量ツールチェーンとし、registry検証とworkflow構造検査の両方をCI必須ゲートにする構成

## 結果

Astro/CSS向けの設定を持たないことで、コピー元だったHomeの設定からの残骸が混入しない。Knipのworkflow解析により、scriptの追加と対応するworkflow配線が一致していることを継続的に検証できる。workflow構造テストにより、action pinの版数ズレやcredentialの越境をコードレビューだけに頼らず機械的に検出する。

## 関連文書

- [flag registry仕様](../features/flags-registry.feature)
- [ADR 0005: Git 品質ゲート](0005-git-quality-gates.md)
