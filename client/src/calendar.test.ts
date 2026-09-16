import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, monthGrid, sessionsByDate, weekTotals } from "./calendar";
import type { StudySession } from "./types";

const ses = (id: string, date: string, minutes: number): StudySession => ({ id, template_id: id, skill: "S", title: id, date, start: "21:00", end: "22:00", minutes, part: 1 });

test("monthGrid は月曜始まりで月全体を覆う", () => {
  const g = monthGrid(2026, 8); // 2026-09
  assert.equal(g[0][0], "2026-08-31");
  assert.equal(g[0][6], "2026-09-06");
  assert.equal(g[g.length - 1][6], "2026-10-04");
  assert.equal(g.length, 5);
  assert.ok(g.every((w) => w.length === 7));
  const feb = monthGrid(2027, 1); // 2027-02-01 は月曜、28 日 → ちょうど 4 週
  assert.equal(feb[0][0], "2027-02-01");
  assert.equal(feb.length, 4);
});

test("sessionsByDate は日付ごとに開始時刻順", () => {
  const a = { ...ses("a", "2026-09-21", 60), start: "22:00" };
  const b = { ...ses("b", "2026-09-21", 60), start: "21:00" };
  const m = sessionsByDate([a, b, ses("c", "2026-09-22", 30)]);
  assert.deepEqual(m.get("2026-09-21")!.map((s) => s.id), ["b", "a"]);
  assert.equal(m.get("2026-09-22")!.length, 1);
});

test("weekTotals は月曜始まりの週ごとに分を合計する", () => {
  const t = weekTotals([ses("a", "2026-09-21", 60), ses("b", "2026-09-27", 30), ses("c", "2026-09-28", 45)]);
  assert.deepEqual(t, [{ week: "2026-09-21", minutes: 90 }, { week: "2026-09-28", minutes: 45 }]);
});

test("defaultSettings は次の月曜始まり・平日夜と週末午前", () => {
  const s = defaultSettings(new Date(2026, 8, 16));
  assert.equal(s.start_date, "2026-09-21");
  assert.equal(s.windows.length, 7);
});
