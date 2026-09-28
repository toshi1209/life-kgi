import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { PlanStore } from "./db.ts";
import { handleDuplicate, handleFoundation } from "./foundation-api.ts";
import type { PlanDoc } from "./engine.ts";

// claude の代わり: プロンプトの中身で KPI / 道 の出力を出し分ける
const saved = process.env.CLAUDE_BIN;
let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-fapi-"));
  const kpis = { formula: "笑顔 = 触れた人数 × 笑顔率", kpis: [{ name: "触れた人数", kind: "leading", targets: [{ at: "2031-09", value: "3000人" }] }, { name: "笑顔率", kind: "lagging" }] };
  const paths = { kgi: "AI が言い換えた KGI", paths: [{ name: "インディーゲーム", kpi_plan: [{ kpi_id: "K1", target: "5000人", how: "試遊会" }, { kpi_id: "K9" }] }, { name: "教育" }] };
  writeFileSync(join(dir, "kpis.out"), JSON.stringify({ result: JSON.stringify(kpis) }));
  writeFileSync(join(dir, "paths.out"), JSON.stringify({ result: JSON.stringify(paths) }));
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh
case "$*" in
  *"KPI 設計の専門家"*) cat "${dir}/kpis.out" ;;
  *) cat "${dir}/paths.out" ;;
esac
`);
  chmodSync(bin, 0o755);
  process.env.CLAUDE_BIN = bin;
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved == null) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = saved;
});

type Res = { code: number; body: { plan?: { id: number; stage: string; title: string; kgi: string }; doc?: PlanDoc; error?: string } };
function fakeRes(): ServerResponse & Res {
  const r = {
    code: 0,
    body: {},
    writeHead(code: number) { r.code = code; return r; },
    end(buf: Buffer) { r.body = JSON.parse(String(buf)); },
  };
  return r as unknown as ServerResponse & Res;
}
async function call(store: PlanStore, path: string, data: Record<string, unknown>) {
  const res = fakeRes();
  await handleFoundation(store, path, data, res);
  return res;
}

const kgi = {
  statement: "2031年9月までに、自分が作った物で笑った人を年1,000人その場で見ている",
  metric: "笑った・声を出した人の数",
  target: "年 1,000 人",
  deadline: "2031-09",
  how_to_measure: "その場で数える",
};

test("KGI を自分で書く → KPI → 道 → 土台はロック → 複製、の一続き", async () => {
  const store = new PlanStore(":memory:");

  const noMvv = await call(store, "/api/kgi", { plan_id: 1 });
  assert.equal(noMvv.code, 404, "プランが無ければ 404");

  const created = await call(store, "/api/foundation", { kgi_spec: kgi, context: "20代", horizon_years: 5, n_paths: 2 });
  assert.equal(created.code, 200);
  const id = created.body.plan!.id;
  assert.equal(created.body.plan!.stage, "kgi");
  assert.equal(created.body.plan!.title, kgi.statement);
  assert.equal(created.body.plan!.kgi, kgi.statement);

  const kgiCand = await call(store, "/api/kgi", { plan_id: id });
  assert.equal(kgiCand.code, 400, "MVV が無いと KGI の候補は出せない");

  const bad = await call(store, "/api/foundation", { plan_id: id, kgi_spec: { ...kgi, target: "たくさん" } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.error!, /数字/);

  const kpis = await call(store, "/api/kpis", { plan_id: id });
  assert.equal(kpis.code, 200);
  assert.equal(kpis.body.plan!.stage, "kpi");
  assert.deepEqual(kpis.body.doc!.kpi_tree!.kpis.map((k) => k.id), ["K1", "K2"]);

  const paths = await call(store, "/api/paths", { plan_id: id, n_paths: 2 });
  assert.equal(paths.code, 200);
  assert.equal(paths.body.plan!.stage, "paths");
  assert.equal(paths.body.doc!.kgi, kgi.statement, "AI の言い換えで上書きされない");
  assert.deepEqual(paths.body.doc!.paths![0].kpi_plan, [{ kpi_id: "K1", target: "5000人", how: "試遊会" }]);
  assert.ok(paths.body.doc!.kpi_tree, "土台は残る");

  const locked = await call(store, "/api/foundation", { plan_id: id, kgi_spec: kgi });
  assert.equal(locked.code, 409);
  assert.equal((await call(store, "/api/kpis", { plan_id: id })).code, 409);

  const noValues = await call(store, "/api/values_fit", { plan_id: id });
  assert.equal(noValues.code, 400, "MVV が無いプランではバリューの評価はできない");

  const dupRes = fakeRes();
  await handleDuplicate(store, id, dupRes);
  assert.equal(dupRes.code, 200);
  assert.notEqual(dupRes.body.plan!.id, id);
  assert.equal(dupRes.body.plan!.stage, "kpi");
  assert.equal(dupRes.body.doc!.paths, undefined);
  assert.equal(store.get(dupRes.body.plan!.id)?.plan.context, "20代");
  store.close();
});

test("ストーリーマップのある道があると、道は作り直せない（409）", async () => {
  const store = new PlanStore(":memory:");
  const doc: PlanDoc = {
    kgi: kgi.statement,
    kgi_spec: { ...kgi, confirmed_at: "x" },
    kpi_tree: { kpis: [{ id: "K1", name: "a", kind: "leading", targets: [] }], generated_at: "x" },
    paths: [{ name: "A", story_map: { phases: [], cards: [] } }],
  };
  const row = store.insert({ kgi: kgi.statement, n_paths: 2, horizon_years: 5, stage: "story", doc });
  const r = await call(store, "/api/paths", { plan_id: row.id });
  assert.equal(r.code, 409);
  store.close();
});

test("MVV の候補は、回答も状況も無ければ 400", async () => {
  const store = new PlanStore(":memory:");
  const r = await call(store, "/api/mvv", { answers: [{ q: "没頭したこと", a: " " }] });
  assert.equal(r.code, 400);
  store.close();
});
