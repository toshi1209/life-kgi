import { test } from "node:test";
import assert from "node:assert/strict";
import { kgiProblems, monthOf } from "./kgi.ts";

const today = new Date(2026, 8, 28); // 2026-09-28
const ok = {
  statement: "2031年9月までに、自分が作った物で笑った人を年1,000人その場で見ている",
  metric: "自分が作った物に触れて笑った・声を出した人の数",
  target: "年 1,000 人",
  deadline: "2031-09",
  how_to_measure: "展示や試遊のたびに自分で数え、月末に集計する",
};

test("5 項目がそろっていれば問題なし", () => {
  assert.deepEqual(kgiProblems(ok, today), []);
});

test("欠けた項目をすべて挙げる", () => {
  const p = kgiProblems({ statement: " ", metric: "", target: "", deadline: "", how_to_measure: "" }, today);
  assert.equal(p.length, 5);
  assert.ok(p.some((s) => s.includes("一文")));
  assert.ok(p.some((s) => s.includes("何を数えるか")));
  assert.ok(p.some((s) => s.includes("目標値")));
  assert.ok(p.some((s) => s.includes("期限")));
  assert.ok(p.some((s) => s.includes("測り方")));
});

test("目標値に数字が無いと問題", () => {
  assert.ok(kgiProblems({ ...ok, target: "たくさん" }, today).some((s) => s.includes("数字")));
  assert.deepEqual(kgiProblems({ ...ok, target: "年１０００人" }, today), [], "全角数字も数字");
});

test("期限は YYYY-MM で、今月より後", () => {
  assert.ok(kgiProblems({ ...ok, deadline: "2031/09" }, today).some((s) => s.includes("YYYY-MM")));
  assert.ok(kgiProblems({ ...ok, deadline: "2031-13" }, today).some((s) => s.includes("YYYY-MM")));
  assert.ok(kgiProblems({ ...ok, deadline: "2026-09" }, today).some((s) => s.includes("過去")));
  assert.deepEqual(kgiProblems({ ...ok, deadline: "2026-10" }, today), []);
});

test("「〜したい」で終わる一文は願望として指摘する", () => {
  const p = kgiProblems({ ...ok, statement: "人がワクワクしたり、笑顔になる物をつくりたい。" }, today);
  assert.equal(p.length, 1);
  assert.match(p[0], /願望/);
});

test("monthOf は YYYY-MM を返す", () => {
  assert.equal(monthOf(today), "2026-09");
  assert.equal(monthOf(new Date(2027, 0, 1)), "2027-01");
});
