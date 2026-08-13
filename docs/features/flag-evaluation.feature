@flags @evaluation @fail-closed
Feature: flag を fail-closed に評価し capability の順序を保証する
  consumerとして
  未実装のcapabilityへ機能が漏れないようにするために
  自分のversionとFlagshipの到達性を踏まえてflagをoffへfallbackしたい

  Background:
    Given flagの正本はflags repositoryのregistryである
    And consumerはFlagship SDK経由で1リクエストにつき1回だけ評価する

  Rule: 未定義、失敗、到達不能はすべて off として扱う

    Scenario: 未定義のflag keyを評価する
      Given "unknown-flag"というkeyはregistryに存在しない
      When consumerがそのkeyを評価する
      Then 結果は"off"である

    Scenario: Flagshipへ到達できない
      Given Flagshipへのリクエストがタイムアウトする
      When consumerがflagを評価する
      Then 結果は"off"である
      And 例外は呼び出し元へ伝播しない

    Scenario: 応答の型が不正である
      Given Flagshipが真偽値ではない値を返す
      When consumerがflagを評価する
      Then 結果は"off"である

  Rule: consumerは自分のversionがminVersion未満ならflagをoffとして扱う

    Scenario Outline: consumerのversionとminVersionの関係が結果を決める
      Given 対象flagの"state.<environment>"が"true"である
      And 対象flagの対象consumerに対する"minVersion"が"<minVersion>"である
      And consumer自身のversionが"<consumerVersion>"である
      When consumerがそのflagを評価する
      Then 結果は"<result>"である

      Examples:
        | environment | minVersion | consumerVersion | result |
        | staging     | 0.2.0      | 0.2.0            | on     |
        | staging     | 0.2.0      | 0.5.0            | on     |
        | staging     | 0.2.0      | 0.1.0            | off    |

    Scenario: state自体がfalseならconsumerのversionに関わらずoff
      Given 対象flagの"state.production"が"false"である
      When consumerがそのflagをproductionで評価する
      Then 結果は"off"である

    Scenario: このconsumerがdescriptorに宣言されていない
      Given 対象flagのconsumersに"ui"が含まれない
      When "ui"がそのflagを評価する
      Then 結果は"off"である

  Rule: CIはflagをONにする前にconsumerのreadinessを確認する

    Scenario: 宣言された全consumerがminVersion以上でDeploy済みである
      Given flagをONにするPRが対象environmentを変更する
      And 宣言された全consumerの直近の成功deployment versionがminVersion以上である
      When "verify-consumers.mjs"を実行する
      Then 検証は成功する

    Scenario: consumerの直近deploymentがminVersionを下回る
      Given flagをONにするPRが対象environmentを変更する
      And あるconsumerの直近の成功deployment versionがminVersion未満である
      When "verify-consumers.mjs"を実行する
      Then 検証は"cannot be enabled ahead of the capability"として失敗する

    Scenario: consumerの成功deployment receiptが存在しない
      Given flagをONにするPRが対象environmentを変更する
      And あるconsumerに成功production deploymentの記録がない
      When "verify-consumers.mjs"を実行する
      Then 検証は"no successful"のreceipt不足として失敗する

    Scenario: この検証はCI時の補助であり実行時のfail-closedを代替しない
      Given "verify-consumers.mjs"がPRをブロックしなかった
      When 対象consumerが実際にはまだcapabilityをDeployしていない
      Then consumer自身のminVersion比較が実行時にflagをoffとして扱う

  Rule: Flagshipの伝播には最大30秒かかる

    Scenario: 同期直後は新旧の値が混在し得る
      Given 同期workflowがFlagshipへ新しい状態を書き込んだ
      When 30秒以内にconsumerがflagを評価する
      Then 新旧いずれの値を観測してもconsumerの動作は破綻しない

    Scenario: 伝播完了後はすべてのedgeが新しい値を返す
      Given 同期workflowがFlagshipへ新しい状態を書き込んでから30秒以上経過した
      When consumerがflagを評価する
      Then すべてのリクエストが新しい値を観測する
