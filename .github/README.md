# GitHub と Flagship 同期の運用

## 操作モデル

`flags` はWorkerを持たず、Deployもコード配送もしません。このrepositoryで起こるproduction操作はCloudflare Flagshipへのflag状態の同期だけであり、これが**Product Release**そのものです。

- **Tag**: PRがmergeされるたびに必ず打つ。mainのどのrevisionが検証済みかを記録する。
- **Sync**: mainへのmergeごとに必ず実施する。registry内の全descriptorをproduction / staging / developmentの3つのFlagship appへ反映する。
- **Consumer**: HomeとBlogとContentは自身のFlagship SDK呼び出しでflagを評価するだけであり、flagを変更する権限を持たない。

`Sync` workflowはrepository全体で直列化されています。実行中runは完了させ、concurrency queueには最新のpending runだけを残します。

## Version、tag、同期の関係

PRがmergeされると、単一のSync workflowが次を順に実行します。

1. PRタイトルの型に対して `package.json#version` が正しいかを検証し、tagを解決する
2. tagが未作成なら打ってpushする
3. registry内の全descriptorをFlagshipの3環境へ同期する
4. sync receiptを記録する（GitHub Deploymentとして）
5. SemVer coreが上がっていればGitHub Releaseを作る
6. 最新tagと同期済み状態の整合、およびFlagshipとregistryの整合をdrift checkで検証する

tag打ちと同期を別workflowに分けていないのは、`GITHUB_TOKEN` によるpushが新しいworkflow runを起動しないためです。分離するとPATが必要になります。

| PRタイトル | 必須bump | 打たれるtag | GitHub Release |
| --- | --- | --- | --- |
| `feat:` / `perf:` | minor | `vX.Y.Z` | 作る |
| `fix:` / `revert:` | patch | `vX.Y.Z` | 作る |
| breaking change | major（`0.x` の間はminor） | `vX.Y.Z` | 作る |
| `docs:` `chore:` `ci:` `test:` `build:` `refactor:` `style:` | なし | `vX.Y.Z+YYYYMMDDHHmmss` | 作らない |

flagsではversionの意味が他のrepositoryと異なります。**flagをONにするPRは`feat:`（minor）、公開済みflagをOFFへ戻すPRは`revert:`（patch）とします。** registryの説明文修正など状態を変えない変更は`docs:`/`chore:`とし、version coreは変わりませんが同期自体は必ず実行します。

ビルド番号 `+YYYYMMDDHHmmss` はmerge commitのcommitter時刻をUTC変換したものです。実行時刻ではなくcommitの属性なので、**再実行しても同じtagになります**。これがリトライでtagを打ち直さないことを構造的に保証します。

SemVerはbuild metadataを優先順位の比較に使いません。したがって最新tagを辞書順で判定してはならず、sync receiptとcommit topologyで判定します。

## 不変条件: 最新tag == 同期済み状態、かつ Flagship == registry

Sync workflowの最後に `drift-check.mjs` が2つを検証します。

- 最新tagとsync receiptのversionが一致すること
- Flagshipの実際のflag状態が、registryの`state`と全環境で一致すること（**dashboardからの直接編集はここで検出されます**）

いずれかが乖離していればCIを失敗させます。**Flagship dashboardを直接編集してはいけません。** すべての変更はPR経由でregistryへ加え、Sync workflowに反映させてください。

**tagは削除も移動もしません。** 失敗したtagはそのまま残し、外部要因なら `workflow_dispatch` で**同じtagのまま**再実行、内部要因なら新しいversionとtagでfix-forwardします。

## 同期のリトライ

外部要因と判断できる失敗だけを**最大3回**リトライします。

| 分類 | 例 | 挙動 |
| --- | --- | --- |
| 外部要因 | Cloudflare APIの5xx、429、タイムアウト、接続リセット、DNS解決失敗 | 指数バックオフで最大3回 |
| 内部要因 | build失敗、test失敗、descriptor validationの失敗、401/403、429以外の4xx | 即座にfailしfix-forward |

## fail-closed な評価契約

evaluationはconsumer側のFlagship SDK呼び出しが担いますが、契約は次のとおりです。

- 未定義のflag key、評価失敗、型不一致、Flagshipへの到達不能 → すべて`off`
- consumer自身のversionが対象flagの`consumers[].minVersion`未満 → `off`（stateがtrueでも関係ない）
- Flagshipの変更が全edgeへ伝播するまで最大30秒かかり、その間は新旧の値が混在し得る

CIの`verify-consumers.mjs`は、flagをONにするPRについて宣言済み全consumerの直近成功production deploymentが`minVersion`以上であることを検証します。これは補助的なCI gateであり、consumer自身のfail-closed評価が本命の防御です。

## Branchとlabel

versionへの影響は**PRタイトル**から決まります。squash mergeによりタイトルがcommit件名として履歴に残るためです。branch名はlabel付けの補助にのみ使います。`registry/**`を変更するPRには変更されたbranch名に関わらず`flags` labelが付きます。

Dependabot branchだけはbranch規約を免除します。Labelerは`pull_request_target`でbase側の設定だけをAPIから読み、PRコードをcheckoutしません。

## Workflow

| Workflow | 契機 | 役割 |
| --- | --- | --- |
| `ci.yml` の `Policy success` | PR、merge queue、mainへのpush | policy testと、PRタイトルに対するversion bumpの検証、registry全体の検証、consumer readinessの検証 |
| `ci.yml` の `CI success` | PR、merge queue、mainへのpush | commit規約、整形、lint |
| `sync.yml` | mainへのpush、`workflow_dispatch` | tagの作成とFlagshipへの同期、drift check |
| `labeler.yml` | `pull_request_target` | branch名と変更pathからのlabel付与 |

`.github/scripts/` の役割は次のとおりです。

| Script | 役割 |
| --- | --- |
| `policy-lib.mjs` | version影響、必要bump、tag解決、失敗分類、descriptor検証、fail-closed評価の参照実装 |
| `policy.mjs` | `pull-request` でPRを検証し、`repository` でregistry全体を検証し、`revision` で `{tag, version, coreChanged}` を出力する |
| `sync-flagship.mjs` | git正本をwrangler経由でFlagshipへ反映し、sync receiptを書き出す |
| `verify-consumers.mjs` | flagをONにする変更について、宣言済みconsumerのdeploy済みversionが`minVersion`以上かをGitHub Deploymentsから検証する |
| `drift-check.mjs` | 最新tagとsync receiptの整合、およびFlagshipとregistryの整合を検証する |
| `record-deployment.mjs` | sync receiptからGitHub Deploymentを記録する |
| `*.test.mjs` | 上記とworkflow、labeler設定の不変条件のtest |

## 初期設定

同期は初期状態で停止します。次の順序で有効化します。

1. この変更をmergeし、`CI success` と `Policy success` のcheck名をGitHubへ登録する。
2. `gh infra validate .github/settings.yml` と `gh infra plan .github/settings.yml` をreviewしてからapplyする。labelとrulesetはadditive reconciliationなので、未宣言の既存設定を削除しない。
3. merge queueを有効化しsquashを選択する。**同時mergeによるversion衝突はmerge queueの再検証だけが防げます。**
4. reviewerを追加しない `production` Environmentを作る。PRのmergeを同期承認として扱う。
5. Cloudflare Flagshipでproduction / staging / developmentの3つのappを作成し、それぞれの `FLAGSHIP_APP_ID_*` を控える。
6. 下記の変数とsecretを設定し、`workflow_dispatch` で同期を手動実行してdrift checkが通ることを確認する。
7. `SYNC_ENABLED=true` にする。

Repository variables:

| 名前 | 用途 |
| --- | --- |
| `SYNC_ENABLED` | `true` のときだけmainをFlagshipへ同期する |
| `CLOUDFLARE_ACCOUNT_ID` | Flagship appを所有するaccount |
| `FLAGSHIP_APP_ID_PRODUCTION` | production環境のFlagship app ID |
| `FLAGSHIP_APP_ID_STAGING` | staging環境のFlagship app ID |
| `FLAGSHIP_APP_ID_DEVELOPMENT` | development環境のFlagship app ID |

Environment secrets:

| Environment | 名前 | 最小権限 |
| --- | --- | --- |
| `production` | `CLOUDFLARE_FLAGSHIP_API_TOKEN` | 3つのFlagship appすべてのflag読み書き |

**このtokenを他のrepositoryへ渡してはいけません。** Flagshipを書き込めるのはこのrepositoryのSync workflowだけです。GitHub workflowのdefault permissionはreadで、すべてのthird-party ActionはfullのcommitSHAで固定します。`v*` tagはGitHub Actionsだけが作成できます。

## Repository settings

`.github/settings.yml`はlabels、main/tag ruleset、squash merge、Release immutability、ActionsのSHA pinningを宣言します。現在のgh-infra schemaはmerge queue ruleを管理しないため、queue自体はGitHub repository settingsで手動有効化します。設定変更時も必ず`gh infra plan`をreviewし、workflowから自動applyしません。

## 関連文書

- [ADR 0002: git を正本とした Cloudflare Flagship への config-as-code 同期](../docs/adr/0002-git-as-flagship-source-of-record.md)
- [ADR 0003: fail-closed な評価契約と capability の順序保証](../docs/adr/0003-fail-closed-consumer-contract.md)
- [Flagship同期仕様](../docs/features/flagship-sync.feature)
- [flag評価仕様](../docs/features/flag-evaluation.feature)
