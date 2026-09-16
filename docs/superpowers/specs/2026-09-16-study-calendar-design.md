# KGI 分岐: 学習時間の見積りと、アプリ内カレンダーへの自動割り振り (2026-09-16)

## 背景

教材は出るが「いつやるか」が無い。ユーザ判断（2026-09-16）: 予定は Google カレンダーではなく**このアプリ内のカレンダー**に、勉強の予定だけを入れる。割り振りは「空き枠を設定してコードが配置」。

## 役割分担

- AI（`prompts/study_plan.txt`、1 回の claude 呼び出し、ツール無し）: スキル・教材ごとの所要時間の見積りと、30〜`session_max_minutes` 分のセッションへの分割（title / minutes / resource_title / what）。順番は学習カードの順（90 日以内 → フェーズ → 優先度）。
- コード（`src/schedule.ts` の `allocate`）: 設定（開始日、曜日ごとの時間帯、週の上限時間、1 回の最長）に従って、セッションを日付と時刻に配置する。窓に収まらないセッションは 30 分以上の塊に分割し「(1/2)」のように番号を付ける。週の上限に達したらその週は打ち切る。730 日探しても置けないものは「未配置」として残す。

## データ

`doc.paths[i].study_plan`:
- `settings`: `{ start_date, weekly_max_hours, session_max_minutes, windows: [{ dow, start, end }] }`
- `templates`: AI が出したセッション雛形（id, skill, title, minutes, resource_title, resource_url, what）
- `sessions`: 配置済み（template_id, date, start, end, minutes, part, …）。id は `template_id#part`
- `done`: 完了にしたセッション id の配列（再配置後も id が残っていれば引き継ぐ）
- `unscheduled`: 置けなかった雛形の件数
- `generated_at`

## API

- `POST /api/study_plan { plan_id, path_index, settings?, regenerate?, model? }`: 雛形が無い／regenerate なら AI で作り直し、配置して保存
- `POST /api/study_plan/allocate { plan_id, path_index, settings }`: 再配置のみ（AI なし）
- `POST /api/study_plan/done { plan_id, path_index, session_id, done }`

## 画面

「カレンダー」タブ: 上に学習時間の設定（曜日×時間帯、週の上限、開始日、1 回の最長）と「学習計画を作る／作り直す」「再配置」。下に月表示（月曜始まり、‹ › と今日）。日のセルにセッションのチップ、クリックで右パネルに詳細（時間・スキル・教材リンク・やること・完了ボタン）。週ごとの合計時間と未配置件数を表示。

## やらないこと

外部カレンダー連携（Google / .ics）、ドラッグでの移動、繰り返し予定、通知。
