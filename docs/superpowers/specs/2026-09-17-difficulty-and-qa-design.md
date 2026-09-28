# KGI 分岐: 道の難しさと、道についての質問 (2026-09-17)

## 背景

道を比較するとき「どれくらい難しいか」「気になることを聞きたい」が無い。ユーザ判断（2026-09-17）: 難しさは **総合 ★1〜5 ＋ 観点別の内訳**、質問は **道の詳細パネル内のスレッド**。

## 難しさ

- 「難しさを出す」→ `POST /api/difficulty { plan_id }` → claude 1 回（`prompts/difficulty.txt`）。各道に `difficulty = { overall(1〜5), aspects: { time, money, skill_gap, uncertainty, life_load }(各 1〜5), wall(一番の壁 1 行), reason(1 行) }` を保存。ユーザの context に対する相対評価。
- ツリーの道ノードに ★ バッジ（MBTI ランクのバッジと並ぶ）。道の詳細に総合・内訳・一番の壁・理由。根の詳細に難しさ順。

## 質問

- 道を選ぶと右パネルに「この道について質問」欄と過去の Q&A スレッド。`POST /api/qa { plan_id, path_index, question }` → claude 1 回（`prompts/qa.txt`、出力は本文テキスト）。入力には KGI・context・MBTI・その道の全情報（qa を除く。study_plan は settings と templates のみ）・直近 6 往復の履歴を渡す。
- 回答は `doc.paths[i].qa[]` に `{ q, a, at }` で保存（最大 50 件）。Markdown は使わせず、`textContent` と `white-space: pre-wrap` で描く。

## やらないこと

回答からプランを書き換えること、道をまたいだ質問、ストリーミング表示。
