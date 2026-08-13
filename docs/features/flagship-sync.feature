@flags @sync @release @cloudflare
Feature: git を正本として Cloudflare Flagship へ同期する
  運用者として
  flagの変更履歴を監査可能にしながら本番へ安全に反映するために
  mainへのmergeごとにtagを打ちFlagshipへ同期したい

  Background:
    Given registryの各JSONがFlagshipへ同期する状態の正本である
    And Flagship dashboardからの直接編集は禁止される

  Rule: mainへのmergeは必ず同期を試みる

    Scenario: mergeされたrevisionを同期する
      Given PRがmainへsquash mergeされた
      When sync workflowを実行する
      Then そのexact commitのregistry状態をFlagshipへ反映する
      And 各flagについてproduction、staging、developmentの3環境すべてを同期する

    Scenario: 同期が続けて要求される
      Given 一つの同期が実行中である
      When mainに複数の更新が続けてmergeされる
      Then 実行中の同期は中断しない
      And pendingには最新のmain revisionだけを残す

  Rule: versionはPRタイトルから決まる

    Scenario Outline: PRタイトルの型が必須bumpを決める
      Given base revisionのpackage versionは "<previous>" である
      When PRタイトルが "<title>" である
      Then package versionは "<next>" でなければならない

      Examples:
        | title                                      | previous | next  |
        | feat: enable new-feed in production         | 0.1.0    | 0.2.0 |
        | revert: disable new-feed in production       | 0.2.0    | 0.2.1 |
        | fix: correct the new-feed consumer minVersion | 0.1.0    | 0.1.1 |
        | docs: explain the new-feed rollout            | 0.1.0    | 0.1.0 |
        | chore: tidy the registry schema comment       | 0.1.0    | 0.1.0 |

    Scenario: flagをONにするPRのタイトル規約
      Given PRが対象flagの"state.production"を"false"から"true"へ変更する
      Then PRタイトルは"feat:"で始まらなければならない
      And 必須bumpはminorである

    Scenario: 公開済みflagをOFFに戻すPRのタイトル規約
      Given PRが対象flagの"state.production"を"true"から"false"へ変更する
      Then PRタイトルは"revert:"で始まらなければならない
      And 必須bumpはpatchである

  Rule: version、tag、GitHub Releaseが一対一に対応する

    Scenario: capabilityを公開したmergeにtagとReleaseを作る
      Given SemVer coreを上げるPRがmergeされた
      When 同期が成功する
      Then そのrevisionへ "vX.Y.Z" のannotated tagを作る
      And 同じtagのGitHub Releaseを公開する

    Scenario: versionを変えないmergeにbuild識別子のtagを作る
      Given SemVer coreを変えないPRがmergeされた
      When 同期が成功する
      Then merge commitのcommitter時刻をUTC変換した "vX.Y.Z+YYYYMMDDHHmmss" のtagを作る
      And GitHub Releaseは作らない

    Scenario: 中断した同期を同じrevisionで再実行する
      Given 直前のrunがtagを作った後に失敗した
      When 同じrevisionをworkflow_dispatchで再実行する
      Then 解決されるtag名は最初のrunと同一である
      And 既存tagを移動せず作り直さない
      And 同期だけをやり直す

    Scenario: 最新tagを辞書順で判定しない
      Given tag "v0.9.0" と "v0.10.0" が存在する
      When 最新tagを判定する
      Then SemVer precedenceにより "v0.10.0" を最新とする

  Rule: 失敗の分類がリトライを決める

    Scenario Outline: 外部要因だけをリトライする
      Given 同期が "<failure>" で失敗した
      When 失敗を分類する
      Then 挙動は "<behavior>" である

      Examples:
        | failure                       | behavior     |
        | Cloudflare APIの503            | 最大3回リトライ |
        | 429 Too Many Requests         | 最大3回リトライ |
        | 接続タイムアウト                 | 最大3回リトライ |
        | DNS解決失敗                     | 最大3回リトライ |
        | 401 Unauthorized              | 即座にfail    |
        | 403 Forbidden                 | 即座にfail    |
        | descriptor validationの失敗     | 即座にfail    |

    Scenario: リトライはtagを打ち直さない
      Given 同期が外部要因でリトライされている
      When リトライが成功する
      Then 作成されたtagは一つだけである

  Rule: 不変条件を破る乖離はCIが検出する

    Scenario: 最新tagと同期済み状態が一致する
      Given 最新tagが"v0.2.0"である
      And sync receiptのversionが"0.2.0"である
      When drift checkを実行する
      Then 検証は成功する

    Scenario: Flagship dashboardが直接編集された
      Given registryは対象flagの"production"を"false"と宣言している
      And Flagshipは同じflagを"true"として返す
      When drift checkを実行する
      Then 検証は"dashboard edits are not permitted"として失敗する

  Rule: 導入gateが閉じている間は外部状態を変更しない

    Scenario: Sync gateが無効である
      Given repository variable "SYNC_ENABLED" は "true" ではない
      When mainが更新される
      Then sync workflowは意図的なskipを報告する
      And tag、Flagship、GitHub Releaseを変更しない
