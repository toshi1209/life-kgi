# KGI 分岐

人生の MVV（ミッション・ビジョン・バリュー）→ 測れる KGI → 全部の道で共通の KPI を決めてから、KGI に向かう「道」を分岐させてツリーで見る。サーバもフロントも TypeScript。起動は npm だけ。

内部は `claude -p`。生成結果は SQLite に自動保存される。

```bash
npm install
npm run build
npm start
```

http://localhost:8787

## 画面

- 左: 「新しく始める」、前提・道の数・年数・MBTI・モデル、各ボタン、保存済み一覧（クリックで再表示、× で削除）
- 中央: タブ。土台 / ツリー（横方向のノードリンク図。ドラッグで移動、ホイールで拡大縮小、○ で開閉、ノードをクリックで詳細）/ 比較 / ストーリーマップ / カレンダー / 成長
- 右: 選んだノードの全文と key/value

## 土台: MVV → KGI → 共通 KPI（道を出す前に決める）

仕様: [docs/superpowers/specs/2026-09-28-mvv-kgi-kpi-foundation-design.md](docs/superpowers/specs/2026-09-28-mvv-kgi-kpi-foundation-design.md)

- ① MVV: 質問シート 7 問（任意）と「前提・状況」から候補 3 案（`POST /api/mvv`、`prompts/mvv.txt`）。1 案を選んで手で直し「MVV を確定」（`POST /api/foundation { mvv }`）。MVV を飛ばして KGI を自分で書いてもよい。
- ② KGI: 確定した MVV から候補 3 案（`POST /api/kgi`、`prompts/kgi.txt`）。一文・何を数えるか・目標値（数字と単位）・期限（YYYY-MM）・測り方がそろわないと確定できない（`src/kgi.ts` の `kgiProblems`。画面とサーバで共有。「〜したい」の願望形も弾く）。
- ③ KPI: KGI の分解式と、道に依存しない KPI 3〜6 個（`POST /api/kpis`、`prompts/kpis.txt`）。手では直さず作り直すだけ。
- 「この KPI で道を出す」→ `POST /api/paths { plan_id }`。KGI は言い換えさせず、各道に `kpi_plan`（共通 KPI ごとの見込みと動かし方）。続けてバリューとの合い具合（`POST /api/values_fit`、`prompts/values_fit.txt`。A/B/C とバリューごとの ○△×）を別の呼び出しで評価する。ツリーの道ノードに `V:A` バッジ。
- 「比較」タブ: 列が道、行が 概要・バリュー・MBTI・難しさ・共通 KPI の見込み。列ごとに「この道で進める」。
- 変更のルール: 道を出す前は、MVV を確定し直すと KGI・KPI が、KGI を確定し直すと KPI が消える。道を出した後は土台は読み取り専用（409）で、「この土台で新しいプランを始める」（`POST /api/plans/:id/duplicate`）で複製して直す。ストーリーマップを作った道があるプランは道を作り直せない。
- 保存: `doc.mvv_answers` / `mvv_candidates` / `mvv` / `kgi_candidates` / `kgi_spec` / `kpi_tree`、`doc.paths[i].kpi_plan` / `values_fit`。段階は `mvv` → `kgi` → `kpi` → `paths`。
- MVV なしで作った旧プランもそのまま開ける。深掘り・ストーリーマップ・難しさ・質問にも土台を渡す（`foundationInput`）。

## 道を決めたら: ストーリーマップと教材

- ツリーで道のノードを選ぶと右パネルに「この道で進める」ボタン。押すとその道のストーリーマップを生成し（`POST /api/story`、1〜2 分）、続けて学習カードのスキルごとに教材を WebSearch で調べる（`POST /api/learning`、1〜3 分）。
- ストーリーマップは横にフェーズ（期間・ゴール・その時期の物語）、縦に 行動 / 学習 / 証明・実績 / 指標 のレーン。90 日以内に着手するカードにはバッジ。カードやフェーズをクリックすると右パネルに詳細。
- 教材は実在 URL を WebSearch で確認したものだけ（`--tools WebSearch --allowedTools WebSearch`）。取れなかったスキルは Google / YouTube / Udemy / Amazon の検索リンクにフォールバック。「教材を再取得」で再実行できる。
- 保存: `doc.paths[i].story_map`、`doc.paths[i].learning`、`doc.chosen_path`。段階は `story`（一覧では「決定済 道N」）。
- プロンプト: `prompts/story_map.txt`（JSON の形を固定）、`prompts/learning.txt`。

## 学習時間の割り振り（アプリ内カレンダー）

- 教材の取得後、AI が教材ごとの所要時間を見積もって 30〜90 分のセッションに分割する（`POST /api/study_plan`、約 1〜2 分、`prompts/study_plan.txt`）。
- 配置はコード（`src/schedule.ts`）。「カレンダー」タブの設定（開始日、曜日ごとの時間帯、週の上限、1 回の最長）に従って、ストーリーマップの順（90 日以内 → フェーズ → 優先度）で空き枠に詰める。窓に収まらない分は 30 分以上の塊に分けて「(1/2)」と番号を付ける。設定を変えて「再配置」すれば AI を呼ばずに即反映（`POST /api/study_plan/allocate`）。
- 月表示のカレンダーにセッションのチップ。クリックで右パネルに詳細（時間・スキル・教材リンク・やること）と「完了にする」（`POST /api/study_plan/done`）。週ごとの合計時間と未配置件数も表示。
- 保存は `doc.paths[i].study_plan`（settings / templates / sessions / done）。外部カレンダー連携は無し。

## 成長の表示

- 「成長」タブ。完了にしたセッションから計算するだけで AI は使わない（[client/src/growth.ts](client/src/growth.ts)）。
- 全体: 進捗率で育つ木（種 → 芽 → 若木 → 枝分かれ → 茂る → 実り）、累計 / 計画、完了セッション数、連続学習日数（完了時刻 `done_at` から）、今週の実績。
- スキル別: 進捗率のレーダー（同じ 0〜100% の軸だけ）と、段階（未着手 → 見習い → 初級 → 中級 → 実務 → 熟練）付きのメーター。
- 週ごと: 直近 12 週の計画（トラック）と実績（塗り）。実績は完了にした週、無ければ予定日の週。
- ストーリーマップの学習カードには「完了 3/5」の進捗チップ。全部終わると「完了」。

## MBTI による道のおすすめ度

- フォームの「MBTI（任意・参考）」で 16 タイプから選ぶ。道の生成にも渡され、`doc.mbti` に保存される。
- 「おすすめ度を出す」（`POST /api/fit { plan_id, mbti }`、`prompts/mbti_fit.txt`、約 1 分）で各道に **A / B / C** のランクと 1 行の理由を付ける（`doc.paths[i].mbti_fit`）。点数は出さない。
- ツリーの道ノードにランクのバッジ（A=緑、B=青、C=灰）、道の詳細に「おすすめ度: A — 理由」、根の詳細に MBTI・おすすめ順・注記。
- MBTI は自己申告の参考情報という前提で、理由は「営業の頻度」「孤独な作業の量」など検証できる行動で書かせている。

## 道の難しさと、道についての質問

- 「難しさを出す」（`POST /api/difficulty { plan_id }`、`prompts/difficulty.txt`、約 1 分）で各道に総合 ★1〜5 と観点別（時間・資金・スキル差・不確実さ・生活負担、各 1〜5）、一番の壁、理由を付ける（`doc.paths[i].difficulty`）。ユーザの context に対する相対評価。ツリーの道ノードに ★ バッジ、根の詳細に難しさ順。
- ツリーで道を選ぶと右パネルに「この道について質問」。`POST /api/qa { plan_id, path_index, question }`（`prompts/qa.txt`、本文テキストで回答、30〜90 秒）。入力には KGI・context・MBTI・その道の全情報（qa 以外。学習計画は設定と雛形のみ）・直近 6 往復の履歴を渡す。やり取りは `doc.paths[i].qa[]` に保存（最大 50 件）。Cmd/Ctrl+Enter でも送信。

## claude の認証

- `ANTHROPIC_API_KEY` があれば `claude --bare -p`（設定・hooks・MCP を一切読まない最小モード）
- 無ければ claude.ai ログイン（OAuth）を使うため非 bare で呼ぶ。`--bare` は API キー専用で OAuth を読まない。
  その代わり `--strict-mcp-config --tools "" --disable-slash-commands --no-session-persistence --setting-sources ""` で MCP・ツール・設定・hooks を切って軽くしている
- `LIFE_KGI_BARE=1|0` で強制できる
- システムプロンプトは `--system-prompt` で**置き換える**（`--append-system-prompt` だと Claude Code のツール説明が残り、モデルが `<invoke ...>` をテキストで書いて JSON が壊れる・極端に遅くなることがあった）
- 親が Claude Code セッションでも `CLAUDE_EFFORT` は子に渡さない。effort を変えたいときは `LIFE_KGI_EFFORT=low|medium|high` → `--effort`
- 1 回の呼び出しのタイムアウトは `LIFE_KGI_CLAUDE_TIMEOUT_MS`（既定 600000）。JSON でない出力は 1 回だけ再試行

## 保存（SQLite）

Node 22 内蔵の `node:sqlite` を使う。追加パッケージ・ネイティブビルド不要。

- ファイル: `data/life-kgi.db`（`LIFE_KGI_DB` で変更可。Docker では `./data:/app/data` をマウント）
- 1 回の生成 = 1 プラン。`道を出す` / `一括生成` は新規行、`各道を深掘り` は開いているプランを更新
- API
  - `GET /api/plans` 一覧（doc なし、更新が新しい順）
  - `GET /api/plans/:id` → `{ plan, doc }`
  - `DELETE /api/plans/:id`
  - `POST /api/paths` / `POST /api/full` → `{ plan, doc }`（`plan_id` なしは KGI 直入力の従来どおり新規保存。`plan_id` 付きの `/api/paths` はそのプランの土台で道を出す）
  - `POST /api/mvv` / `POST /api/kgi` / `POST /api/kpis` / `POST /api/foundation` / `POST /api/values_fit` / `POST /api/plans/:id/duplicate` → `{ plan, doc }`（土台）
  - `POST /api/enrich`（`plan_id` を渡すと既存を更新）→ `{ plan, doc }`
  - `POST /api/story` / `POST /api/learning`（`{ plan_id, path_index }`）→ `{ plan, doc }`
  - `POST /api/study_plan` / `POST /api/study_plan/allocate` / `POST /api/study_plan/done` → `{ plan, doc }`

## 開発

```bash
npm run dev        # サーバを watch 起動（フロントは npm run build で dist に出す）
npm test           # node:test（DB 層と JSON→木 変換）
npm run kgi -- "KGI" [-c 状況] [-n 4]   # CLI。DB には保存しない
```
