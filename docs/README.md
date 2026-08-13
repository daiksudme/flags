---
type: "Documentation Index"
title: "文書"
description: "flagsの受け入れ基準となる振る舞い仕様と技術判断への入口を提供する。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/README.md"
tags: [flags, documentation, index]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:16:00Z
---

# 文書

このディレクトリは feature flag registry と Cloudflare Flagship 同期の受け入れ基準と技術判断を管理します。

## 文書の責務

- [振る舞い仕様](features/README.md)は、現在有効な観測可能かつ検証可能な契約の正本です。具体的な値、schema、入出力、エラー、境界条件を Gherkin で定義します。
- [Architecture Decision Records](adr/README.md)は、技術判断の背景、理由、選択肢、トレードオフ、結果を記録します。受け入れ条件を繰り返さず、対応する振る舞い仕様を参照します。

観測可能な契約について両者の記述が異なる場合は、振る舞い仕様を現在の仕様として扱います。

flags は [Home](https://github.com/daiksudme/home)、[Blog](https://github.com/daiksudme/blog)、[Content](https://github.com/daiksudme/content) の配信サービス層がFlagship SDK経由で参照するflagの正本を提供します。flagsはこれらのリポジトリを再Deployせずに機能の公開を制御します。
