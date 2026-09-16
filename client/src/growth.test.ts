import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGrowth, skillStage, streakDays, treeStage, weeklyProgress } from "./growth";
import type { StudyPlan, StudySession } from "./types";

const ses = (id: string, skill: string, date: string, minutes: number): StudySession => ({ id, template_id: id, skill, title: id, date, start: "21:00", end: "22:00", minutes, part: 1 });
const plan = (sessions: StudySession[], done: string[], done_at: Record<string, string> = {}): StudyPlan => ({
  settings: { start_date: "2026-09-21", weekly_max_hours: 8, session_max_minutes: 90, windows: [] },
  templates: [],
  sessions,
  done,
  done_at,
  unscheduled: 0,
  generated_at: "",
});

test("skillStage / treeStage は進捗率で段階が上がる", () => {
  assert.equal(skillStage(0).label, "未着手");
  assert.equal(skillStage(0.1).label, "見習い");
  assert.equal(skillStage(0.25).label, "初級");
  assert.equal(skillStage(0.5).label, "中級");
  assert.equal(skillStage(0.75).label, "実務");
  assert.equal(skillStage(1).label, "熟練");
  assert.equal(treeStage(0).label, "種");
  assert.equal(treeStage(0.1).label, "芽");
  assert.equal(treeStage(0.3).label, "若木");
  assert.equal(treeStage(0.6).label, "枝分かれ");
  assert.equal(treeStage(0.9).label, "茂る");
  assert.equal(treeStage(1).label, "実り");
});

test("computeGrowth はスキル別と全体の完了時間・進捗率を出す", () => {
  const p = plan([ses("a", "SQL", "2026-09-21", 60), ses("b", "SQL", "2026-09-22", 60), ses("c", "会計", "2026-09-23", 30)], ["a", "c"]);
  const g = computeGrowth(p, new Date(2026, 8, 24));
  assert.equal(g.plannedMinutes, 150);
  assert.equal(g.doneMinutes, 90);
  assert.equal(g.ratio, 0.6);
  assert.deepEqual(g.skills.map((s) => [s.skill, s.planned, s.done, s.stage.label]), [["SQL", 120, 60, "中級"], ["会計", 30, 30, "熟練"]]);
  assert.equal(g.tree.label, "枝分かれ");
  assert.equal(g.doneCount, 2);
});

test("streakDays は done_at のローカル日付で連続日数を数える（今日が無ければ昨日から）", () => {
  const today = new Date(2026, 8, 24, 12);
  const iso = (d: number, h = 21) => new Date(2026, 8, d, h).toISOString();
  assert.equal(streakDays({ a: iso(24), b: iso(23), c: iso(22), d: iso(20) }, today), 3);
  assert.equal(streakDays({ b: iso(23), c: iso(22) }, today), 2, "今日は未実施でも昨日から数える");
  assert.equal(streakDays({ c: iso(22) }, today), 0, "一昨日で途切れていれば 0");
  assert.equal(streakDays({}, today), 0);
});

test("weeklyProgress は直近 N 週の計画と実績（done_at 優先、無ければ予定日）", () => {
  const p = plan(
    [ses("a", "SQL", "2026-09-21", 60), ses("b", "SQL", "2026-09-28", 60), ses("c", "SQL", "2026-10-05", 90)],
    ["a", "b"],
    { a: new Date(2026, 8, 29, 21).toISOString() }, // a は翌週に完了、b は done_at 無し → 予定日の週
  );
  const w = weeklyProgress(p, 3, new Date(2026, 9, 6));
  assert.deepEqual(w.map((x) => [x.week, x.planned, x.done]), [
    ["2026-09-21", 60, 0],
    ["2026-09-28", 60, 120],
    ["2026-10-05", 90, 0],
  ]);
});
