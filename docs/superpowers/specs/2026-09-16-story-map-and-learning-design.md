# KGI 分岐: 道を決めたらストーリーマップ＋学習教材 (2026-09-16)

## 背景

道（path）を複数出して比較するところまではできたが、「一つに決めた後に何をするか」が無い。
ユーザ判断（2026-09-16）: 形は「フェーズ×レーンのカード盤」、教材は「WebSearch で実在 URL を確認」。

## 流れ

1. ツリーで道ノードを選ぶ → 右パネルに「この道で進める」ボタン。
2. `POST /api/story { plan_id, path_index }` → claude 1 回でストーリーマップを生成し、`doc.paths[i].story_map` と `doc.chosen_path = i` を保存、stage を `story` に。中央が「ストーリーマップ」タブに切り替わる。
3. 続けて `POST /api/learning { plan_id, path_index }` → 学習レーンのカード（skill）をまとめて 1 回の claude 呼び出し（`--tools WebSearch --allowedTools WebSearch`、max-turns はスキル数に応じて）で調べ、`doc.paths[i].learning` に保存。
4. 教材はカードの詳細パネルと、盤の下の「必要な学習と教材」一覧に出す。取得失敗時は Google / YouTube / Udemy / Amazon の検索リンクにフォールバックし、「教材を再取得」できる。

## ストーリーマップの JSON（プロンプトで固定）

- `phases[]`: name / period / goal / story（時間順の背骨、3〜5 個）
- `cards[]`: phase（添字）/ lane（do | learn | prove | measure）/ title / detail / priority / first_90_days / done_when / skill（learn のみ）
- レーン表示名: 行動 / 学習 / 証明・実績 / 指標。first_90_days のカードはセル内で先頭に置き「90日」バッジ。
- サーバ側で `normalizeStoryMap` が形を検証・補正し、不正なら 1 回再生成。

## 学習教材の JSON

- `items[]`: skill / why / level / resources[]（title / url / type / cost / language / why）
- URL は `https?://` で始まるものだけ残す。

## DB

- stage に `story` を追加。既存テーブルの CHECK 制約は SQLite で変更できないため、起動時に旧スキーマなら作り直して移行する（以後 CHECK は持たず、コード側で検証）。
- 一覧の `chosen_path` は `json_extract(doc, '$.chosen_path')` で返す（列追加なし）。

## やらないこと

カードの編集・並べ替え、複数の道の同時決定、教材の自動更新。
