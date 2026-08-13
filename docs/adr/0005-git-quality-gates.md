---
type: "Architecture Decision Record"
title: "ADR 0005: Git 品質ゲート"
description: "Conventional Commits、Git hook、CIによってコミットとPull Requestの品質を検証する。"
resource: "https://github.com/daiksudme/flags/blob/main/docs/adr/0005-git-quality-gates.md"
tags: [flags, adr, architecture, git, quality-gate]
status: stable
generated:
  by: "codex/gpt-5.6-sol"
  at: 2026-08-13T17:14:00Z
---

# ADR 0005: Git 品質ゲート

## ステータス

承認済み

## 日付

2026-08-13

## コンテキスト

flagsではPull Requestタイトルの型がversionとGitHub Releaseに直結し、さらにflagをONにするPRの`minVersion`検証がconsumerの安全性に直結する。したがって、コミット件名とPRタイトルの規約は他リポジトリ以上に構造的な意味を持ち、ローカルとCIの両方で一貫して検証する必要がある。

## 決定

コミット件名とPull Requestタイトルには Conventional Commits を採用し、commitlint で検証する。Husky の `pre-commit` hook は lint-staged を実行し、staged 済みファイルを担当 tool で整形してから lint する。`commit-msg` hook は作成中のコミット件名を検証する。CI は Pull Request タイトル、Pull Request に含まれる全コミット、main へ追加されたコミットを検証する。main の履歴が non-fast-forward push で置き換えられた場合は、新しい HEAD から到達可能な全履歴を検証する。GitHub 形式の件名と two-parent topology を持つ Pull Request merge commit 本体だけは、検証済みタイトルを含む merge metadata として除外する。

staged ファイルの検査は高速な局所フィードバックに限定する。リポジトリ全体の整形確認、lint、registry検証、workflow構造検査は既存の CI 品質ゲートを正本とする。

## 検討した選択肢

- 開発者の運用だけでコミット規約を維持する構成
- Git hook だけで規約と品質を検証する構成
- Pull Request タイトルだけを検証し、個々のコミットは許容する構成
- Git hook と CI の両方でタイトルと全コミットを検証する構成

## 結果

コミット前に対象ファイルへ短いフィードバックを返し、整形済みの内容だけを stage できる。ローカル hook を省略したコミットも CI が検出する。Pull Request タイトルの型はversion bumpとGitHub Releaseの根拠でもあるため、規約への準拠がそのままProduct Releaseの正しさに直結する。

## 関連文書

- [ADR 0002: git を正本とした Cloudflare Flagship への config-as-code 同期](0002-git-as-flagship-source-of-record.md)
- [ADR 0004: ツールチェーンと検証](0004-toolchain-and-version-pinning.md)
