import { test } from "node:test";
import assert from "node:assert/strict";
import { compareTable } from "./compare";
import type { PlanDoc } from "./types";

const doc: PlanDoc = {
  mvv: { mission: "M", vision: "V", values: [{ name: "自分で決める" }, { name: "目の前の人" }], confirmed_at: "x" },
  kpi_tree: {
    kpis: [
      { id: "K1", name: "触れた人数", kind: "leading", targets: [{ at: "2027-09", value: "300人" }, { at: "2031-09", value: "3000人" }] },
      { id: "K2", name: "笑顔率", kind: "lagging", targets: [] },
    ],
    generated_at: "x",
  },
  paths: [
    {
      name: "インディーゲーム",
      one_liner: "作品を世界に届ける",
      values_fit: { rank: "A", items: [{ value: "自分で決める", fit: "match", reason: "企画も自分" }], summary: "合う" },
      mbti_fit: { rank: "A", reason: "孤独な作業" },
      difficulty: { overall: 3, aspects: { time: 3, money: 3, skill_gap: 3, uncertainty: 5, life_load: 2 }, wall: "ヒット依存" },
      kpi_plan: [{ kpi_id: "K1", target: "5000人", how: "試遊会" }],
    },
    { name: "教育", strategy: "教室を開く", kpi_plan: [{ kpi_id: "K1", target: "2000人" }] },
  ],
};

test("列は道、行は 概要・バリュー（総合と各バリュー）・MBTI・難しさ・共通 KPI", () => {
  const t = compareTable(doc);
  assert.deepEqual(t.paths, ["1. インディーゲーム", "2. 教育"]);
  const byLabel = Object.fromEntries(t.rows.map((r) => [r.label, r]));
  assert.deepEqual(byLabel["概要"].cells, ["作品を世界に届ける", "教室を開く"]);
  assert.deepEqual(byLabel["バリュー"].cells, ["A — 合う", ""]);
  assert.deepEqual(byLabel["・自分で決める"].cells, ["○ 企画も自分", ""]);
  assert.deepEqual(byLabel["MBTI"].cells, ["A — 孤独な作業", ""]);
  assert.deepEqual(byLabel["難しさ"].cells, ["★3 — ヒット依存", ""]);
  const k1 = byLabel["K1 触れた人数"];
  assert.equal(k1.note, "目標 3000人（2031-09）");
  assert.deepEqual(k1.cells, ["5000人", "2000人"]);
  assert.deepEqual(k1.subs, ["試遊会", ""]);
});

test("全部の列が空の行は出さない", () => {
  const t = compareTable(doc);
  const labels = t.rows.map((r) => r.label);
  assert.ok(!labels.includes("・目の前の人"), "どの道も評価していないバリューは出さない");
  assert.ok(!labels.includes("K2 笑顔率"), "どの道も見込みを書いていない KPI は出さない");
});

test("道が無ければ空", () => {
  assert.deepEqual(compareTable({}), { paths: [], rows: [] });
});
