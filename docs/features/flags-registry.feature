@flags @registry @schema
Feature: flag registry の descriptor を検証する
  運用者として
  Cloudflare Flagship へ同期する前に不正な状態が紛れ込まないようにするために
  registry の各 descriptor を schema に照らして検証したい

  Background:
    Given registryの各ファイルは "registry/<key>.json" という名前を持つ
    And schemaVersionは常に1である

  Rule: descriptor は自分の key と一致するファイル名を持たなければならない

    Scenario: key とファイル名が一致する
      Given descriptorの"key"が"new-feed"である
      When "registry/new-feed.json" として検証する
      Then 検証は成功する

    Scenario: key とファイル名が一致しない
      Given descriptorの"key"が"new-feed"である
      When "registry/other-key.json" として検証する
      Then 検証は"must be named after its key"として失敗する

    Scenario: key は kebab-case でなければならない
      Given descriptorの"key"が"New_Feed"である
      When 検証する
      Then 検証は"kebab-case slug"として失敗する

  Rule: consumers は最低1件、重複のない repo を宣言しなければならない

    Scenario: consumers が空である
      Given descriptorの"consumers"が空配列である
      When 検証する
      Then 検証は"at least one repo"として失敗する

    Scenario: 同じ repo を2度宣言する
      Given descriptorの"consumers"が"blog"を2回含む
      When 検証する
      Then 検証は"declares consumer blog twice"として失敗する

    Scenario: minVersion は v prefix のない SemVer core でなければならない
      Given consumerの"minVersion"が"v0.2.0"である
      When 検証する
      Then 検証は"minVersion"として失敗する

  Rule: state は production、staging、development をすべて boolean で宣言しなければならない

    Scenario: 環境が不足している
      Given descriptorの"state"が"production"と"staging"だけを含む
      When 検証する
      Then 検証は"must declare exactly"として失敗する

    Scenario: 値が boolean ではない
      Given descriptorの"state.production"が文字列"false"である
      When 検証する
      Then 検証は"production must be a boolean"として失敗する

  Rule: CI は PR ごとと push ごとに registry 全体を再検証する

    Scenario: PRがregistryに触れていなくても再検証する
      Given このPRはregistryを変更していない
      When "policy.mjs repository"を実行する
      Then registry内の全descriptorが検証される
      And 無関係な変更によってdescriptorが壊れていても検出する

    Scenario: flagをONにするPRはconsumerの readiness も検証する
      Given PRが"production"の"state"を"true"へ変更する
      When "verify-consumers.mjs"を実行する
      Then 宣言された全consumerの直近の成功production deploymentを取得する
      And versionが"minVersion"未満のconsumerがあれば検証は失敗する
