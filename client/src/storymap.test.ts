import { test } from "node:test";
import assert from "node:assert/strict";
import { cellsOf, learningFor, searchLinks } from "./storymap";
import type { StoryCard, StoryMap } from "./types";

const card = (o: Partial<StoryCard> & { title: string }): StoryCard => ({ phase: 0, lane: "do", priority: 9, first_90_days: false, ...o });

test("cellsOf はフェーズ×レーンでまとめ、90日 → 優先度の順に並べる", () => {
  const map: StoryMap = {
    phases: [{ name: "A" }, { name: "B" }],
    cards: [card({ title: "c", priority: 1 }), card({ title: "b", priority: 2, first_90_days: true }), card({ title: "a", priority: 3, first_90_days: true }), card({ title: "x", phase: 1, lane: "learn" })],
  };
  const cells = cellsOf(map);
  assert.deepEqual(cells.get("0:do")!.map((c) => c.title), ["b", "a", "c"]);
  assert.deepEqual(cells.get("1:learn")!.map((c) => c.title), ["x"]);
  assert.equal(cells.get("1:do"), undefined);
});

test("searchLinks は 4 種の検索 URL を返し、スキル名をエンコードする", () => {
  const links = searchLinks("財務 三表");
  assert.equal(links.length, 4);
  assert.deepEqual(links.map((l) => l.label), ["Google", "YouTube", "Udemy", "Amazon 書籍"]);
  for (const l of links) assert.match(l.url, /%E8%B2%A1%E5%8B%99/);
  assert.doesNotMatch(links[1].url, / /);
});

test("learningFor は skill の完全一致、無ければ部分一致で教材を引く", () => {
  const learning = { items: [{ skill: "TypeScript", resources: [] }, { skill: "法人営業", resources: [] }] };
  assert.equal(learningFor(learning, card({ title: "TS を学ぶ", lane: "learn", skill: "typescript" }))?.skill, "TypeScript");
  assert.equal(learningFor(learning, card({ title: "法人営業の基礎を学ぶ", lane: "learn" }))?.skill, "法人営業");
  assert.equal(learningFor(learning, card({ title: "会計", lane: "learn", skill: "会計" })), undefined);
  assert.equal(learningFor(undefined, card({ title: "x" })), undefined);
});
