import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, allocate, defaultSettings, weekStart, type SessionTemplate, type StudySettings } from "./schedule.ts";

const tpl = (id: string, minutes: number, title = id): SessionTemplate => ({ id, skill: "S", title, minutes });
// 2026-09-21 は月曜
const MON = "2026-09-21";

test("addDays / weekStart はローカル日付で月曜始まり", () => {
  assert.equal(addDays(MON, 1), "2026-09-22");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(weekStart("2026-09-27"), MON, "日曜はその週の月曜");
  assert.equal(weekStart(MON), MON);
});

test("順番どおりに窓へ詰め、窓の余りには 30 分以上なら分割して置く", () => {
  const settings: StudySettings = { start_date: MON, weekly_max_hours: 8, session_max_minutes: 90, windows: [{ dow: 1, start: "21:00", end: "22:30" }] };
  const { sessions, unscheduled } = allocate([tpl("a", 60), tpl("b", 60)], settings);
  assert.equal(unscheduled.length, 0);
  assert.deepEqual(
    sessions.map((s) => [s.template_id, s.date, s.start, s.end, s.part, s.title]),
    [
      ["a", MON, "21:00", "22:00", 1, "a"],
      ["b", MON, "22:00", "22:30", 1, "b (1/2)"],
      ["b", "2026-09-28", "21:00", "21:30", 2, "b (2/2)"],
    ],
  );
  assert.deepEqual(sessions.map((s) => s.id), ["a#1", "b#1", "b#2"]);
});

test("30 分未満の端数は作らない（残りが小さくなるなら手前で切る）", () => {
  const settings: StudySettings = { start_date: MON, weekly_max_hours: 8, session_max_minutes: 90, windows: [{ dow: 1, start: "21:00", end: "22:10" }] };
  const { sessions } = allocate([tpl("a", 90)], settings);
  // 窓 70 分。90 を 70+20 にすると端数 20 になるので 60+30 に切る
  assert.deepEqual(sessions.map((s) => [s.date, s.minutes]), [[MON, 60], ["2026-09-28", 30]]);
});

test("週の上限を超えない（月曜始まり）", () => {
  const settings: StudySettings = { start_date: MON, weekly_max_hours: 1, session_max_minutes: 90, windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "20:00", end: "22:00" })) };
  const { sessions } = allocate([tpl("a", 60), tpl("b", 60), tpl("c", 60)], settings);
  assert.deepEqual(sessions.map((s) => s.date), [MON, "2026-09-28", "2026-10-05"]);
});

test("1 回の最長で塊を切る", () => {
  const settings: StudySettings = { start_date: MON, weekly_max_hours: 20, session_max_minutes: 45, windows: [{ dow: 1, start: "19:00", end: "23:00" }] };
  const { sessions } = allocate([tpl("a", 120)], settings);
  assert.deepEqual(sessions.map((s) => [s.start, s.end, s.minutes]), [["19:00", "19:45", 45], ["19:45", "20:30", 45], ["20:30", "21:00", 30]]);
});

test("窓が無ければ全部未配置", () => {
  const settings: StudySettings = { start_date: MON, weekly_max_hours: 8, session_max_minutes: 90, windows: [] };
  const r = allocate([tpl("a", 60)], settings);
  assert.equal(r.sessions.length, 0);
  assert.equal(r.unscheduled.length, 1);
});

test("defaultSettings は平日夜と週末午前、開始日は次の月曜", () => {
  const s = defaultSettings(new Date(2026, 8, 16)); // 水曜
  assert.equal(s.start_date, MON);
  assert.equal(s.windows.filter((w) => w.dow >= 1 && w.dow <= 5).length, 5);
  assert.ok(s.windows.some((w) => w.dow === 6) && s.windows.some((w) => w.dow === 0));
  assert.equal(s.weekly_max_hours, 8);
  assert.equal(s.session_max_minutes, 90);
});
