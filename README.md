# flags

`flags` は、Home、Blog、Content の配信サービス層が参照する feature flag の git 正本を管理し、Cloudflare Flagship への config-as-code 同期を担うリポジトリです。

## 現在の状態

実装開始前の基準として、観測可能な振る舞いを Gherkin、技術的な決定を Architecture Decision Records（ADR）で確定しています。registry検証とFlagship同期の自動化は安全な初期状態で配置済みですが、Cloudflare Flagshipの環境が揃うまでgateで停止しています。

## 仕様書

- [文書の案内](docs/README.md)
- [振る舞い仕様](docs/features/README.md)
- [Architecture Decision Records](docs/adr/README.md)
- [GitHub と Flagship 同期の運用](.github/README.md)

## ローカル開発

Node.js 24.16.0 以降と pnpm 11 を使います。`.nvmrc`、`package.json` の `engines`、`packageManager` で必要な version を宣言し、依存関係は manifest と lockfile に正確に固定しています。

```sh
pnpm install
```

lint、整形確認、registry検証、policyテストは個別に実行できます。

```sh
pnpm lint
pnpm format:check
pnpm policy:check
pnpm policy:test
```

整形を適用するには `pnpm format`、すべての品質検査をまとめて実行するには `pnpm validate` を使います。

## コミット時の検査

`pnpm install` は Husky の Git hook を有効にします。コミット前には lint-staged が staged ファイルだけを対象に整形と lint を順番に実行し、整形結果を自動的に再度 stage します。検査に失敗した場合はコミットを中止します。

コミットメッセージと pull request のタイトルには Conventional Commits 形式を使います。**flagsではversionの意味が他のrepositoryと異なります**。flagをONにするPRは`feat:`、公開済みflagをOFFへ戻すPRは`revert:`とします。

```text
feat: enable new-feed in production
revert: disable new-feed in production
docs: explain the new-feed rollout
```

`commit-msg` hook はコミットメッセージを検証します。CI でも pull request のタイトルと含まれる全コミット、および `main` へ push されたコミットを検証するため、`--no-verify` で省略したローカル検査も共有前に検出できます。リポジトリ全体の検証は引き続き `pnpm validate` で実行します。

PR branch は `feat/<slug>`、`revert/<slug>` などの規約に従います。branchから付くlabelはPolicy CIとは独立したGitHub UI向けの分類です。PRタイトルの型に対して`package.json#version`が正しいbumpになっているか、および対象consumerがready状態かはPolicy CIが検証します。ローカルでは次を実行できます。

```sh
pnpm policy:test
```

| ツール | 担当範囲 | 実行コマンド |
| --- | --- | --- |
| Biome | JavaScript / TypeScript / JSON の整形と lint | `pnpm lint:biome` |
| Commitlint | コミットメッセージと pull request タイトルの検証 | `pnpm lint:commit` |
| ESLint | 型情報を使う TypeScript の意味的検査 | `pnpm lint:eslint` |
| Husky / lint-staged | Git hook と staged ファイルの整形・lint | `pnpm lint:staged` |
| rumdl | Markdown の lint と整形 | `pnpm lint:rumdl`、`pnpm format`、`pnpm format:check` |
| Prettier | YAML / JSON の整形 | `pnpm format`、`pnpm format:check` |
| knip | 未使用の依存関係、exports、files の検出 | `pnpm lint:knip` |
| node:test | registry検証、fail-closed評価、workflow構造の不変条件の検査 | `pnpm policy:test` |

## flag registry

`registry/<key>.json` がflagの正本です。`registry/schema.json`が形状を定義し、`registry/example-flag.json`は最初のflagを追加するまでのテンプレートです。

```json
{
  "schemaVersion": 1,
  "key": "example-flag",
  "description": "何を制御するflagかを平易に説明する",
  "consumers": [{ "repo": "blog", "minVersion": "0.2.0" }],
  "state": { "production": false, "staging": false, "development": false }
}
```

`consumers[].minVersion`は、そのflagを解釈できる最初のconsumer versionです。consumerは自分のversionがこれより古ければ、flagがONでも`off`として扱います（fail closed）。`state.production`を`true`にするPRがProduct Releaseです。

## 関連リポジトリ

- [Home](https://github.com/daiksudme/home)
- [Blog](https://github.com/daiksudme/blog)
- [Content](https://github.com/daiksudme/content)
- [UI](https://github.com/daiksudme/ui)
