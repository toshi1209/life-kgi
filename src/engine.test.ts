import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePaths } from "./engine.ts";

const saved = process.env.CLAUDE_BIN;
let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (saved == null) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = saved;
});

test("JSON でない出力は 1 回だけ再試行して、2 回目が JSON なら成功する", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-engine-"));
  const counter = join(dir, "count");
  writeFileSync(counter, "0");
  const bin = join(dir, "claude");
  // 1 回目は <invoke ...> のようなゴミ、2 回目は正しい JSON
  writeFileSync(bin, `#!/bin/sh
n=$(cat "${counter}"); n=$((n+1)); echo "$n" > "${counter}"
if [ "$n" = "1" ]; then echo '{"result":"<invoke name=\\"x\\">oops</invoke>"}'; else echo '{"result":"{\\"kgi\\":\\"K\\",\\"paths\\":[{\\"name\\":\\"A\\"},{\\"name\\":\\"B\\"},{\\"name\\":\\"C\\"}]}"}'; fi
`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  const doc = await generatePaths({ kgi: "K", n_paths: 2 });
  assert.deepEqual(doc.paths?.map((p) => p.name), ["A", "B"], "n_paths で切られる");
  assert.equal(readFileSync(counter, "utf8").trim(), "2");
});

test("2 回とも JSON でなければ ClaudeError で落ちる", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-engine-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\necho '{"result":"not json at all"}'\n`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  await assert.rejects(generatePaths({ kgi: "K" }), (e: unknown) => e instanceof Error && /JSON ではありません/.test(e.message));
});

import { generateLearning, generateStoryMap, normalizeLearning, normalizeStoryMap } from "./engine.ts";

test("normalizeStoryMap は添字とレーンを補正し、題の無いカードを捨てる", () => {
  const m = normalizeStoryMap({
    phases: [{ name: "準備", period: "0〜6ヶ月" }, { name: "独立" }, { extra: 1 }],
    cards: [
      { phase: 5, lane: "bogus", title: "営業する", priority: "2", first_90_days: "true" },
      { phase: 0, lane: "learn", title: "会計を学ぶ", skill: "財務三表", priority: 1 },
      { phase: 0, lane: "do", title: "" },
    ],
  });
  assert.deepEqual(m.phases.map((p) => p.name), ["準備", "独立"]);
  assert.equal(m.cards.length, 2);
  assert.deepEqual(m.cards[0], { phase: 1, lane: "do", title: "営業する", detail: undefined, priority: 2, first_90_days: true, done_when: undefined, skill: undefined });
  assert.equal(m.cards[1].skill, "財務三表");
  assert.throws(() => normalizeStoryMap({ phases: [] }), /phases/);
  assert.throws(() => normalizeStoryMap({ phases: [{ name: "a" }], cards: [] }), /cards/);
});

test("normalizeLearning は http でない URL を捨て、items が空なら投げる", () => {
  const l = normalizeLearning({ items: [{ skill: "TypeScript", resources: [{ title: "公式", url: "https://www.typescriptlang.org/" }, { title: "偽", url: "typescriptlang.org" }] }, { resources: [] }] });
  assert.equal(l.items.length, 1);
  assert.deepEqual(l.items[0].resources.map((r) => r.url), ["https://www.typescriptlang.org/"]);
  assert.throws(() => normalizeLearning({ items: [] }), /items/);
});

test("generateStoryMap は形が不正なら 1 回再生成する", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-engine-"));
  const counter = join(dir, "count");
  writeFileSync(counter, "0");
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh
n=$(cat "${counter}"); n=$((n+1)); echo "$n" > "${counter}"
if [ "$n" = "1" ]; then echo '{"result":"{\\"phases\\":[]}"}'; else echo '{"result":"{\\"phases\\":[{\\"name\\":\\"P\\"}],\\"cards\\":[{\\"phase\\":0,\\"lane\\":\\"do\\",\\"title\\":\\"T\\"}]}"}'; fi
`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  const m = await generateStoryMap({ kgi: "K", path: { name: "A" } });
  assert.equal(m.cards[0].title, "T");
  assert.equal(readFileSync(counter, "utf8").trim(), "2");
});

test("generateLearning は WebSearch を許可し、ターン数をスキル数に合わせる", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-engine-"));
  const argsFile = join(dir, "args");
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\necho '{"result":"{\\"items\\":[{\\"skill\\":\\"S\\",\\"resources\\":[{\\"title\\":\\"t\\",\\"url\\":\\"https://x.example/\\"}]}]}"}'\n`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  const l = await generateLearning({ kgi: "K", path_name: "A", skills: [{ skill: "S", title: "S を学ぶ" }, { skill: "T", title: "T" }, { skill: "U", title: "U" }] });
  assert.equal(l.items[0].resources[0].url, "https://x.example/");
  const a = readFileSync(argsFile, "utf8").split("\n");
  assert.equal(a[a.indexOf("--tools") + 1], "WebSearch");
  assert.equal(a[a.indexOf("--allowedTools") + 1], "WebSearch");
  assert.equal(a[a.indexOf("--max-turns") + 1], "10");
  assert.match(a[a.indexOf("--system-prompt") + 1], /WebSearch/);
});

import { normalizeStudyTemplates, generateStudyTemplates } from "./engine.ts";

test("normalizeStudyTemplates は分数を丸めて id を振り、教材 URL を title で引く", () => {
  const skills = [
    { skill: "SQL", resources: [{ title: "SQL入門", url: "https://a.example/" }] },
    { skill: "会計", resources: [] },
  ];
  const t = normalizeStudyTemplates(
    { skills: [
      { skill: "SQL", sessions: [{ title: "SQL入門: SELECT", minutes: 20, resource_title: "SQL入門", what: "x" }, { title: "演習", minutes: "100" }] },
      { skill: "会計", sessions: [{ title: "", minutes: 60 }, { title: "決算書を読む", minutes: 60 }] },
      { skill: "知らない", sessions: [{ title: "z", minutes: 60 }] },
    ] },
    skills,
    90,
  );
  assert.deepEqual(t.map((x) => [x.id, x.skill, x.title, x.minutes, x.resource_url ?? null]), [
    ["s0-1", "SQL", "SQL入門: SELECT", 30, "https://a.example/"],
    ["s0-2", "SQL", "演習", 90, null],
    ["s1-1", "会計", "決算書を読む", 60, null],
  ]);
  assert.throws(() => normalizeStudyTemplates({ skills: [] }, skills, 90), /sessions/);
});

test("generateStudyTemplates は session_max_minutes をプロンプトに埋め込む", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-engine-"));
  const promptFile = join(dir, "prompt");
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh
prev=""; for a in "$@"; do if [ "$prev" = "-p" ]; then printf '%s' "$a" > "${promptFile}"; fi; prev="$a"; done
echo '{"result":"{\\"skills\\":[{\\"skill\\":\\"SQL\\",\\"sessions\\":[{\\"title\\":\\"t\\",\\"minutes\\":60}]}]}"}'
`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  const t = await generateStudyTemplates({ kgi: "K", path_name: "A", session_max_minutes: 75, skills: [{ skill: "SQL", resources: [], cards: [] }] });
  assert.equal(t[0].minutes, 60);
  const prompt = readFileSync(promptFile, "utf8");
  assert.match(prompt, /30〜75 分/);
  assert.doesNotMatch(prompt, /\{session_max_minutes\}/);
});

import { MBTI_TYPES, normalizeMbti, normalizeMbtiFit } from "./engine.ts";

test("normalizeMbti は 16 タイプだけを大文字で受け付ける", () => {
  assert.equal(normalizeMbti(" intj "), "INTJ");
  assert.equal(normalizeMbti("XXXX"), undefined);
  assert.equal(normalizeMbti(""), undefined);
  assert.equal(MBTI_TYPES.length, 16);
});

test("normalizeMbtiFit は添字とランクを検証し、道ごとに並べる", () => {
  const r = normalizeMbtiFit({ ranks: [{ path: 1, rank: "a", reason: "営業が多い" }, { path: 0, rank: "C" }, { path: 9, rank: "A" }, { path: 0, rank: "Z" }], note: "参考です" }, 2);
  assert.deepEqual(r.fits, [{ rank: "C", reason: undefined }, { rank: "A", reason: "営業が多い" }]);
  assert.equal(r.note, "参考です");
  assert.throws(() => normalizeMbtiFit({ ranks: [] }, 2), /ranks/);
});
