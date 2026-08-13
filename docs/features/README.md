---
type: "Gherkin Specification Index"
title: "振る舞い仕様"
description: "flag registryの検証、Cloudflare Flagshipへの同期、fail-closedな評価契約の観測可能な振る舞いを定義するGherkin仕様への索引である。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/features/README.md"
tags: [flags, gherkin, specification, index]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:17:00Z
---

# 振る舞い仕様

各ファイルでは Gherkin キーワードを英語、シナリオ本文を日本語で記述します。

振る舞い仕様は、現在有効な観測可能かつ検証可能な契約の正本です。具体的な値、schema、入出力、エラー、境界条件を記述し、内部の実現方式とその理由は [Architecture Decision Records](../adr/README.md) に委ねます。

- [flag registry の検証](flags-registry.feature)
- [Cloudflare Flagship への同期](flagship-sync.feature)
- [fail-closed な評価と capability の順序保証](flag-evaluation.feature)

各ファイルは一つの観測可能な能力を扱い、`@flags` と能力別タグで分類します。
