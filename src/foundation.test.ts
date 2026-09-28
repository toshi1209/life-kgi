import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FoundationError, applyFoundationEdit, canRegeneratePaths, duplicateFoundation, foundationStage, generateMvvCandidates,
  mergePaths, normalizeKgiCandidates, normalizeKpiPlan, normalizeKpiTree, normalizeMvvCandidates, normalizeValuesFit,
  titleForDoc, validateKgi, validateMvv, type Mvv,
} from "./foundation.ts";
import type { PlanDoc } from "./engine.ts";

const today = new Date(2026, 8, 28);
const now = "2026-09-28T00:00:00.000Z";
const mvv: Mvv = { mission: "目の前の人を笑顔にする物をつくる", vision: "作った物の前で人が笑っている", values: [{ name: "自分で決める", meaning: "意味を自分で選ぶ" }] };
const kgi = {
  statement: "2031年9月までに、自分が作った物で笑った人を年1,000人その場で見ている",
  metric: "笑った・声を出した人の数",
  target: "年 1,000 人",
  deadline: "2031-09",
  how_to_measure: "その場で数える",
};
const kpiTree = { formula: "笑顔の人数 = 触れた人数 × 笑顔率", kpis: [{ id: "K1", name: "触れた人数", kind: "leading" as const, targets: [] }], generated_at: now };

// ---------- 正規化 ----------

test("normalizeMvvCandidates は mission / vision / values の無い案を捨て、values を 7 個までに切る", () => {
  const c = normalizeMvvCandidates({
    candidates: [
      { mission: " M1 ", vision: "V1", values: [{ name: "誠実", meaning: "嘘をつかない", behavior: "週1で振り返る" }, { meaning: "名前なし" }], grounds: "回答1から" },
      { mission: "M2", vision: "", values: [{ name: "x" }] },
      { mission: "M3", vision: "V3", values: Array.from({ length: 9 }, (_, i) => ({ name: `v${i}` })) },
      "junk",
    ],
  });
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { mission: "M1", vision: "V1", values: [{ name: "誠実", meaning: "嘘をつかない", behavior: "週1で振り返る" }], grounds: "回答1から" });
  assert.equal(c[1].values.length, 7);
  assert.throws(() => normalizeMvvCandidates({ candidates: [] }), /mvv/);
});

test("validateMvv はミッション・ビジョン・バリュー 1 個以上を要求する（400）", () => {
  assert.deepEqual(validateMvv({ ...mvv, extra: 1 }), mvv);
  assert.throws(() => validateMvv({ ...mvv, mission: "" }), (e: unknown) => e instanceof FoundationError && e.status === 400 && /ミッション/.test(e.message));
  assert.throws(() => validateMvv({ ...mvv, values: [{ name: " " }] }), /バリュー/);
});

test("normalizeKgiCandidates は測れない案（願望形・数字なし・過去）を捨てる", () => {
  const c = normalizeKgiCandidates({
    candidates: [
      { ...kgi, why: "vision の中心" },
      { ...kgi, statement: "笑顔を増やしたい" },
      { ...kgi, target: "たくさん" },
      { ...kgi, deadline: "2020-01" },
    ],
  }, today);
  assert.deepEqual(c, [{ ...kgi, why: "vision の中心" }]);
  assert.throws(() => normalizeKgiCandidates({ candidates: [{ ...kgi, metric: "" }] }, today), /kgi/);
});

test("validateKgi は問題を並べて 400 で落ちる", () => {
  assert.deepEqual(validateKgi({ ...kgi, statement: ` ${kgi.statement} ` }, today), kgi);
  assert.throws(() => validateKgi({ ...kgi, target: "", deadline: "来年" }, today), (e: unknown) => e instanceof FoundationError && e.status === 400 && /目標値/.test(e.message) && /YYYY-MM/.test(e.message));
});

test("normalizeKpiTree は id を K1 から振り直し、kind を補い、名前の無い KPI を捨てる", () => {
  const t = normalizeKpiTree({
    formula: "A = B × C",
    kpis: [
      { id: "X", name: "触れた人数", kind: "leading", cadence: "月次", unit: "人", targets: [{ at: "2027-09", value: "100人" }, { at: "", value: "?" }], why: "母数" },
      { name: "笑顔率", kind: "lagging" },
      { name: "", kind: "leading" },
      { name: "謎", kind: "weird" },
    ],
  }, now);
  assert.equal(t.formula, "A = B × C");
  assert.equal(t.generated_at, now);
  assert.deepEqual(t.kpis.map((k) => [k.id, k.name, k.kind]), [["K1", "触れた人数", "leading"], ["K2", "笑顔率", "lagging"], ["K3", "謎", "leading"]]);
  assert.deepEqual(t.kpis[0].targets, [{ at: "2027-09", value: "100人" }]);
  assert.deepEqual(t.kpis[1].targets, []);
  assert.throws(() => normalizeKpiTree({ kpis: [] }, now), /kpi/);
});

test("normalizeKpiPlan は知らない id と重複を捨てる", () => {
  const kpis = [{ id: "K1", name: "a", kind: "leading" as const, targets: [] }, { id: "K2", name: "b", kind: "lagging" as const, targets: [] }];
  assert.deepEqual(
    normalizeKpiPlan([{ kpi_id: "K2", target: "50人", how: "展示" }, { kpi_id: "K9" }, { kpi_id: "K2", target: "dup" }, { kpi_id: "K1" }], kpis),
    [{ kpi_id: "K2", target: "50人", how: "展示" }, { kpi_id: "K1", target: undefined, how: undefined }],
  );
  assert.deepEqual(normalizeKpiPlan("junk", kpis), []);
});

test("normalizeValuesFit は道ごとに rank と各バリューの fit を並べ、不正な行を捨てる", () => {
  const r = normalizeValuesFit({
    paths: [
      { path: 1, rank: "b", items: [{ value: "自分で決める", fit: "conflict", reason: "仕様は他部門" }, { value: "x", fit: "bogus" }], summary: "要工夫" },
      { path: 5, rank: "A" },
      { path: 0, rank: "Z" },
    ],
  }, 3);
  assert.equal(r[0], undefined);
  assert.deepEqual(r[1], { rank: "B", items: [{ value: "自分で決める", fit: "conflict", reason: "仕様は他部門" }, { value: "x", fit: "neutral", reason: undefined }], summary: "要工夫" });
  assert.equal(r[2], undefined);
  assert.throws(() => normalizeValuesFit({ paths: [] }, 2), /values_fit/);
});

// ---------- 変更のルール ----------

test("MVV を確定し直すと KGI の候補・KGI・KPI が消える", () => {
  const doc: PlanDoc = { mvv: { ...mvv, confirmed_at: "old" }, kgi_candidates: [kgi], kgi_spec: { ...kgi, confirmed_at: "old" }, kgi: kgi.statement, kpi_tree: kpiTree, mvv_answers: [{ q: "q", a: "a" }] };
  const next = applyFoundationEdit(doc, { mvv: { ...mvv, mission: "新しい" } }, today);
  assert.equal(next.mvv?.mission, "新しい");
  assert.equal(next.mvv?.confirmed_at, today.toISOString());
  assert.equal(next.kgi_candidates, undefined);
  assert.equal(next.kgi_spec, undefined);
  assert.equal(next.kgi, undefined);
  assert.equal(next.kpi_tree, undefined);
  assert.deepEqual(next.mvv_answers, doc.mvv_answers, "回答は残る");
  assert.equal(doc.kgi_spec?.statement, kgi.statement, "元の doc は変えない");
});

test("KGI を確定し直すと KPI だけ消え、doc.kgi が一文になる。MVV が無くても確定できる", () => {
  const next = applyFoundationEdit({ kpi_tree: kpiTree }, { kgi_spec: kgi }, today);
  assert.equal(next.kgi, kgi.statement);
  assert.equal(next.kgi_spec?.metric, kgi.metric);
  assert.equal(next.kpi_tree, undefined);
  assert.throws(() => applyFoundationEdit({}, { kgi_spec: { ...kgi, target: "" } }, today), /目標値/);
});

test("道がある土台は変えられない（409）", () => {
  const doc: PlanDoc = { mvv: { ...mvv, confirmed_at: now }, paths: [{ name: "A" }] };
  assert.throws(() => applyFoundationEdit(doc, { mvv }, today), (e: unknown) => e instanceof FoundationError && e.status === 409);
});

test("foundationStage は進んだところまでを返す", () => {
  assert.equal(foundationStage({}), "mvv");
  assert.equal(foundationStage({ kgi_spec: { ...kgi, confirmed_at: now } }), "kgi");
  assert.equal(foundationStage({ kgi_spec: { ...kgi, confirmed_at: now }, kpi_tree: kpiTree }), "kpi");
});

test("duplicateFoundation は土台だけ複製し、道・決定・MBTI 以外の結果を持ち込まない", () => {
  const doc: PlanDoc = {
    mvv_answers: [{ q: "q", a: "a" }], mvv_candidates: [mvv], mvv: { ...mvv, confirmed_at: now },
    kgi_candidates: [kgi], kgi_spec: { ...kgi, confirmed_at: now }, kgi: kgi.statement, kpi_tree: kpiTree,
    horizon_years: 10, mbti: "INFP", mbti_note: "note", paths: [{ name: "A" }], chosen_path: 0,
  };
  const d = duplicateFoundation(doc);
  assert.deepEqual(Object.keys(d).sort(), ["horizon_years", "kgi", "kgi_candidates", "kgi_spec", "kpi_tree", "mbti", "mvv", "mvv_answers", "mvv_candidates"]);
  assert.notEqual(d.mvv, doc.mvv, "深いコピー");
});

test("titleForDoc は KGI → ミッション → 作成中 の順", () => {
  assert.equal(titleForDoc({ kgi_spec: { ...kgi, confirmed_at: now }, mvv: { ...mvv, confirmed_at: now } }), kgi.statement);
  assert.equal(titleForDoc({ mvv: { ...mvv, confirmed_at: now } }), mvv.mission);
  assert.equal(titleForDoc({}), "（作成中）");
});

test("canRegeneratePaths はストーリーマップのある道が無いときだけ true", () => {
  assert.equal(canRegeneratePaths({ paths: [{ name: "A" }] }), true);
  assert.equal(canRegeneratePaths({ paths: [{ name: "A" }, { name: "B", story_map: { phases: [], cards: [] } }] }), false);
});

test("mergePaths は土台を残して道を差し替え、AI が書いた kgi などで上書きさせない", () => {
  const doc: PlanDoc = { kgi: kgi.statement, kgi_spec: { ...kgi, confirmed_at: now }, kpi_tree: kpiTree, mvv: { ...mvv, confirmed_at: now }, horizon_years: 10, mbti: "INFP", paths: [{ name: "old" }], chosen_path: 0, old_extra: 1 } as PlanDoc;
  const next = mergePaths(doc, { kgi: "言い換えた KGI", comparison: "比較", paths: [{ name: "A", kpi_plan: [{ kpi_id: "K1", target: "10人" }, { kpi_id: "K7" }] }] } as PlanDoc);
  assert.equal(next.kgi, kgi.statement);
  assert.equal(next.chosen_path, undefined);
  assert.equal((next as Record<string, unknown>).comparison, "比較");
  assert.equal((next as Record<string, unknown>).old_extra, undefined);
  assert.deepEqual(next.paths?.[0].kpi_plan, [{ kpi_id: "K1", target: "10人", how: undefined }]);
  assert.equal(next.mbti, "INFP");
});

// ---------- 生成（claude の代わりに偽のバイナリ） ----------

const saved = process.env.CLAUDE_BIN;
let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  if (saved == null) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = saved;
});

test("generateMvvCandidates は回答をプロンプトに入れ、候補を正規化して返す", async () => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-foundation-"));
  const argsFile = join(dir, "args");
  const bin = join(dir, "claude");
  const out = JSON.stringify({ result: JSON.stringify({ candidates: [{ mission: "M", vision: "V", values: [{ name: "誠実" }] }] }) });
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$*" > "${argsFile}"\nprintf '%s\\n' '${out.replace(/'/g, "'\\''")}'\n`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
  const c = await generateMvvCandidates({ answers: [{ q: "没頭したこと", a: "ゲームジャム" }], context: "20代", horizon_years: 10 });
  assert.deepEqual(c, [{ mission: "M", vision: "V", values: [{ name: "誠実" }] }]);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(argsFile, "utf8"), /ゲームジャム/);
});
