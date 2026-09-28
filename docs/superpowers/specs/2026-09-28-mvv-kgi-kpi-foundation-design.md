# KGI 分岐: MVV → KGI → 共通 KPI の「土台」と、同じ物差しでの道の比較 (2026-09-28)

## 背景

「人がワクワクしたり、笑顔になる物をつくりたい。」を KGI に入れたところ、5 本の道がそれぞれ深掘りで KGI を別々の測り方に言い換えていた（システムプロンプトの「測定できる指標だけを出す」に従った結果）。KGI が道を選ぶ基準になっておらず、道が KGI の意味を決めている。道同士も同じ物差しで比べられない。

ユーザ判断（2026-09-28）: 人生の **MVV を決める → KGI を決める → KPI を自動で出す → 道を出す** の順にする。MVV は **質問シートに答えて AI が候補を 3 案**出し、選んで手で直して確定する。構成は「今のプランの前に 3 段を足す（1 プラン = MVV→KGI→KPI→道→…の一続き）」。

## 流れ

中央の先頭に「土台」タブ。① MVV ② KGI ③ KPI を縦に並べ、前が確定するまで次は押せない。

1. **MVV**: 質問 7 問（任意）と左の「状況」から `POST /api/mvv` → 候補 3 案（mission / vision / values 3〜5（name・meaning・behavior）/ grounds = どの回答が根拠か）。1 案を選んで手で直し、`POST /api/foundation { mvv }` で確定。MVV を飛ばして KGI を自分で書いてもよい。
2. **KGI**: 確定した MVV から `POST /api/kgi` → 候補 3 案。各案は statement / metric（何を数えるか）/ target（数字＋単位）/ deadline（YYYY-MM）/ how_to_measure / why。確定は `POST /api/foundation { kgi_spec }`。5 項目のどれかが欠ける・target に数字が無い・deadline が過去や形式違いなら確定できない（`src/kgi.ts` の `kgiProblems`。画面とサーバで同じ関数）。
3. **KPI**: `POST /api/kpis` → `formula`（KGI の分解式 1 行）と KPI 3〜6 個（id K1… / name / definition / how_to_measure / kind lagging|leading / cadence / unit / targets[{at, value}] / why）。**道に依存しない指標だけ**。手で編集はせず、作り直しのみ。
4. **道**: 「この KPI で道を出す」→ `POST /api/paths { plan_id }`。MVV・KGI・KPI を渡し、KGI の言い換えは禁止。各道は `kpi_plan: [{ kpi_id, target, how }]`（KGI の期限時点での見込みと動かし方）を持つ。続けて `POST /api/values_fit` でバリューとの合い具合を自動で出す。

## 道のあと

- バリューとの合い具合（`paths[i].values_fit`）: rank A/B/C、バリューごとに match / neutral / conflict と理由、summary。道を作った呼び出しとは別の呼び出しで評価する（自作を甘く採点しないため）。ツリーの道ノードに `V:A` のバッジ。
- 深掘り（skills_kpi / future）・ストーリーマップ・質問・難しさにも MVV / KGI / KPI を渡す。深掘りは KGI と共通 KPI を言い換えず、道固有の先行指標だけ足してよい。ストーリーマップの「指標」レーンは共通 KPI を使う。
- 「比較」タブ: 列が道、行が 概要・バリュー（総合と各バリュー）・MBTI・難しさ・共通 KPI ごとの見込み。列ごとに「この道で進める」。

## 変更のルール

- 道を出す前: MVV を確定し直すと KGI の候補・KGI・KPI が消える。KGI を確定し直すと KPI が消える（画面で確認を出す）。
- 道を出した後: 土台は読み取り専用（API は 409）。変えたいときは `POST /api/plans/:id/duplicate` で土台（回答・MVV・KGI・KPI と候補）を複製した新しいプランを作る。道・学習計画・完了記録を壊さないため。
- 道の作り直しは、ストーリーマップを作った道が無いときだけ（あれば 409 で複製を案内）。
- MVV なしで作った既存プラン（doc.kgi が文字列のもの）はそのまま開ける。土台タブには「MVV なしで作ったプラン」と出す。CLI（`npm run kgi`）と `plan_id` なしの `/api/paths` `/api/full` は従来どおり。

## データ

`doc` に追加（DB の列は増やさない）:

- `mvv_answers: {q, a}[]`, `mvv_candidates: Mvv[]`, `mvv: Mvv & { confirmed_at }`
- `kgi_candidates: KgiSpec[]`, `kgi_spec: KgiSpec & { confirmed_at }`（確定時に `doc.kgi` = statement）
- `kpi_tree: { formula, kpis, generated_at }`
- `paths[i].kpi_plan`, `paths[i].values_fit`

stage に `mvv` / `kgi` / `kpi` を追加。`plans.kgi` は KGI 確定までは空、一覧のタイトルは KGI → ミッション → 「（作成中）」の順。

## API

- `POST /api/mvv { plan_id?, answers, context, horizon_years, … }` → 候補を保存（plan_id なしなら新規行）
- `POST /api/kgi { plan_id }` / `POST /api/kpis { plan_id }` → 候補 / KPI を保存
- `POST /api/foundation { plan_id?, mvv? | kgi_spec?, context?, … }` → 確定（AI なし。plan_id なし＋kgi_spec なら新規行）
- `POST /api/values_fit { plan_id }`
- `POST /api/plans/:id/duplicate`
- `POST /api/paths { plan_id }` → そのプランの土台で道を出して更新

プロンプト新規: `mvv.txt` / `kgi.txt` / `kpis.txt` / `values_fit.txt`（JSON の形を固定し、正規化で検証、不正なら 1 回作り直し）。`paths.txt` / `skills_kpi.txt` / `future.txt` / `story_map.txt` に数行追加。

## コード

- `src/kgi.ts`: KgiSpec と `kgiProblems`（依存なし。サーバと画面で共有）
- `src/foundation.ts`: 型・正規化・生成（MVV / KGI / KPI / values_fit）・変更ルール・複製
- `src/foundation-api.ts`: 上の API のハンドラ
- `client/src/foundation.ts`: 土台タブ、`client/src/compare.ts`: 比較タブ
- `main.ts` は配線だけ足す

## やらないこと

KPI の実績の記録と追跡（次の段階）、KPI の手編集、MVV の対話モード、複数人。
