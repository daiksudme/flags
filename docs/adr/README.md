---
type: "Architecture Decision Record Index"
title: "Architecture Decision Records"
description: "flagsのリポジトリ境界、Cloudflare Flagshipへの同期、fail-closedな評価契約、ツールチェーン、Git品質ゲートに関する設計判断への索引である。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/README.md"
tags: [flags, adr, architecture, index]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:15:00Z
---

# Architecture Decision Records

| 番号 | 決定 | ステータス | 日付 |
| --- | --- | --- | --- |
| 0001 | [flags のリポジトリ境界](0001-repository-boundary.md) | 承認済み | 2026-08-13 |
| 0002 | [git を正本とした Cloudflare Flagship への config-as-code 同期](0002-git-as-flagship-source-of-record.md) | 承認済み | 2026-08-13 |
| 0003 | [fail-closed な評価契約と capability の順序保証](0003-fail-closed-consumer-contract.md) | 承認済み | 2026-08-13 |
| 0004 | [ツールチェーンと検証](0004-toolchain-and-version-pinning.md) | 承認済み | 2026-08-13 |
| 0005 | [Git 品質ゲート](0005-git-quality-gates.md) | 承認済み | 2026-08-13 |

ADR は判断の背景、理由、選択肢、トレードオフ、結果を記録します。具体的な値、URL、入出力、エラー、境界条件などの受け入れ条件は繰り返さず、対応する[振る舞い仕様](../features/README.md)を参照します。

実装前で、まだコードや利用者へ影響していない決定は、既存 ADR を直接改訂して `generated.at` を更新できます。実装後に変更が必要になった決定は、新しい ADR で置き換え関係を明示します。
