# KGI 分岐: ツリー図表示と SQLite 保存 (2026-09-16)

## 背景

初期 UI は `<details>` の折りたたみリストで、KGI → 道 → スキル/KPI/未来 の階層が「木」として見えない。
また生成結果（claude -p 呼び出し 1〜9 回、数分）がページを閉じると消える。

ユーザ判断（2026-09-16）: ツリーは「横方向ノードリンク図」、保存は「SQLite に自動保存」。

## ツリー図

- KGI を左端の根にして右へ枝分かれ。レイアウトは `d3-hierarchy` の `tree()` を `nodeSize` で使い、描画は素の SVG（依存は d3-hierarchy のみ）。
- ノードはクリックで開閉。初期状態は根・道・道直下のグループまで展開、それより深い階層は折りたたみ（閉じたノードには子の数を出す）。
- 長文はノードに出さず、ノードを選ぶと右側の詳細パネルにパンくず＋全文（子の primitive は key/value 表）を出す。
- ドラッグでパン、ホイールでズーム。「全体を表示」「すべて開く/閉じる」ボタン。
- `PlanDoc` → 木への変換は純関数 `toTree(doc, fallbackTitle)`（`client/src/tree.ts`）。claude が返す JSON の形が揺れるので、既知キーには日本語ラベルを当て、未知キーは汎用ルール（primitive→葉、配列→グループ、オブジェクト→`name`/`title`/`year` をラベルにした項目）で必ず描ける。

## SQLite 保存

- Node 22 内蔵の `node:sqlite`。ファイルは `data/life-kgi.db`（`LIFE_KGI_DB` で上書き可）。追加パッケージ・ネイティブビルド不要。Docker では `./data:/app/data` をボリュームにする。
- テーブル `plans`: id, title(KGI 先頭 60 文字), kgi, context, n_paths, horizon_years, model, stage, doc(JSON), created_at, updated_at。
- 保存単位は「1 回の生成 = 1 プラン」。`/api/paths` と `/api/full` は新規行を作る。`/api/enrich` は `plan_id` を受け取ればその行を更新（stage='enriched'）、無ければ新規行。
- API 追加: `GET /api/plans`（一覧、doc なし、新しい順）/ `GET /api/plans/:id` / `DELETE /api/plans/:id`。
- 生成系 POST の応答は `{ plan, doc }`（CLI は engine 直呼びなので影響なし）。
- DB 層は `src/db.ts` の `PlanStore` クラスに閉じ、`node:test` でテスト（`:memory:`）。

## 画面構成

左列: フォーム ＋ 保存済み一覧（タイトル・段階バッジ・日時、クリックで再表示、× で削除）。
中央: ツリー図。右: 詳細パネル（320px）。

## やらないこと

外部 DB、プランの改名、複数ユーザ、ノードの編集。
