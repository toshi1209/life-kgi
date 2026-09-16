import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore, titleOf } from "./db.ts";

const doc = { kgi: "K", horizon_years: 10, paths: [{ name: "A" }] };
const base = { kgi: "年収1500万を安定して稼ぐ", context: "33歳 PM", n_paths: 2, horizon_years: 10, model: null } as const;
const tick = () => new Promise((r) => setTimeout(r, 5));

test("insert → get で行と doc が戻る", () => {
  const s = new PlanStore(":memory:");
  const row = s.insert({ ...base, stage: "paths", doc });
  assert.equal(row.id, 1);
  assert.equal(row.title, base.kgi);
  assert.equal(row.stage, "paths");
  assert.equal(row.model, null);
  const got = s.get(row.id);
  assert.deepEqual(got?.doc, doc);
  assert.equal(got?.plan.context, "33歳 PM");
  assert.equal(s.get(999), null);
  s.close();
});

test("update で doc と stage が置き換わり updated_at が進む", async () => {
  const s = new PlanStore(":memory:");
  const row = s.insert({ ...base, stage: "paths", doc });
  await tick();
  const next = { ...doc, paths: [{ name: "A", future: { snapshots: [] } }] };
  const upd = s.update(row.id, { doc: next, stage: "enriched" });
  assert.equal(upd?.stage, "enriched");
  assert.ok(upd!.updated_at > row.updated_at);
  assert.deepEqual(s.get(row.id)?.doc, next);
  assert.equal(s.update(999, { doc, stage: "enriched" }), null);
  s.close();
});

test("list は更新が新しい順で doc を含まない", async () => {
  const s = new PlanStore(":memory:");
  const a = s.insert({ ...base, stage: "paths", doc });
  await tick();
  const b = s.insert({ ...base, kgi: "B", stage: "paths", doc });
  await tick();
  s.update(a.id, { doc, stage: "enriched" });
  const rows = s.list();
  assert.deepEqual(rows.map((r) => r.id), [a.id, b.id]);
  assert.ok(!("doc" in rows[0]));
  s.close();
});

test("delete は存在すれば true", () => {
  const s = new PlanStore(":memory:");
  const row = s.insert({ ...base, stage: "paths", doc });
  assert.equal(s.delete(row.id), true);
  assert.equal(s.delete(row.id), false);
  assert.equal(s.list().length, 0);
  s.close();
});

test("titleOf は空白を潰して 60 文字で切る", () => {
  assert.equal(titleOf("  a\n b  "), "a b");
  assert.equal(titleOf("あ".repeat(70)), "あ".repeat(60) + "…");
});

test("ファイルパス指定でディレクトリごと作られ、再オープンでデータが残る", () => {
  const dir = mkdtempSync(join(tmpdir(), "life-kgi-"));
  const file = join(dir, "nested", "plans.db");
  const s1 = new PlanStore(file);
  const row = s1.insert({ ...base, stage: "paths", doc });
  s1.close();
  assert.ok(existsSync(file));
  const s2 = new PlanStore(file);
  assert.equal(s2.get(row.id)?.plan.kgi, base.kgi);
  s2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("stage 'story' が使え、chosen_path が一覧と取得に出る", () => {
  const s = new PlanStore(":memory:");
  const row = s.insert({ ...base, stage: "paths", doc });
  assert.equal(row.chosen_path, null);
  const upd = s.update(row.id, { doc: { ...doc, chosen_path: 1 }, stage: "story" });
  assert.equal(upd?.stage, "story");
  assert.equal(upd?.chosen_path, 1);
  assert.equal(s.list()[0].chosen_path, 1);
  assert.equal(s.get(row.id)?.plan.chosen_path, 1);
  assert.throws(() => s.update(row.id, { doc, stage: "bogus" as never }), /stage/);
  s.close();
});

test("旧スキーマ（CHECK 制約あり）の DB は起動時に移行され、story に更新できる", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "life-kgi-mig-"));
  const file = join(dir, "old.db");
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, kgi TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
    n_paths INTEGER NOT NULL, horizon_years INTEGER NOT NULL, model TEXT,
    stage TEXT NOT NULL CHECK (stage IN ('paths', 'enriched')), doc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  old.prepare(`INSERT INTO plans (title,kgi,context,n_paths,horizon_years,model,stage,doc,created_at,updated_at) VALUES ('t','k','',2,10,NULL,'enriched',?, '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`).run(JSON.stringify(doc));
  old.close();
  const s = new PlanStore(file);
  assert.equal(s.get(1)?.plan.stage, "enriched", "既存行は残る");
  assert.equal(s.update(1, { doc: { ...doc, chosen_path: 0 }, stage: "story" })?.stage, "story");
  s.close();
  const s2 = new PlanStore(file);
  assert.equal(s2.get(1)?.plan.stage, "story", "再オープンしても二重移行しない");
  s2.close();
  rmSync(dir, { recursive: true, force: true });
});
