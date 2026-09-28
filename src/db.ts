import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanDoc } from "./engine.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** mvv / kgi / kpi は土台（道を出す前）の段階 */
export type Stage = "mvv" | "kgi" | "kpi" | "paths" | "enriched" | "story";
const STAGES: readonly Stage[] = ["mvv", "kgi", "kpi", "paths", "enriched", "story"];

export type PlanRow = {
  id: number;
  title: string;
  kgi: string;
  context: string;
  n_paths: number;
  horizon_years: number;
  model: string | null;
  stage: Stage;
  /** doc.chosen_path（決めた道の添字）。無ければ null */
  chosen_path: number | null;
  created_at: string;
  updated_at: string;
};

export type NewPlan = {
  /** 省略時は kgi から作る */
  title?: string;
  kgi: string;
  context?: string;
  n_paths: number;
  horizon_years: number;
  model?: string | null;
  stage: Stage;
  doc: PlanDoc;
};

export type PlanMeta = { title?: string; kgi?: string; context?: string; n_paths?: number; horizon_years?: number; model?: string | null };

const COLS = "id, title, kgi, context, n_paths, horizon_years, model, stage, json_extract(doc, '$.chosen_path') AS chosen_path, created_at, updated_at";

const SCHEMA = `CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kgi TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  n_paths INTEGER NOT NULL,
  horizon_years INTEGER NOT NULL,
  model TEXT,
  stage TEXT NOT NULL,
  doc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

function assertStage(stage: string): asserts stage is Stage {
  if (!STAGES.includes(stage as Stage)) throw new Error(`stage が不正: ${stage}`);
}

/** 一覧用のタイトル。KGI の空白を潰して 60 文字で切る。 */
export function titleOf(kgi: string): string {
  const t = kgi.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

export function defaultDbPath(): string {
  return process.env.LIFE_KGI_DB || join(root, "data", "life-kgi.db");
}

/** plans テーブル 1 枚だけの SQLite ストア。1 行 = 1 回の生成結果。 */
export class PlanStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
    this.db.exec(SCHEMA);
  }

  /** 初期スキーマは stage に CHECK 制約があり 'story' を入れられない。SQLite は制約を変えられないので作り直す。 */
  private migrate(): void {
    const row = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plans'`).get() as { sql: string } | undefined;
    if (!row || !/CHECK/i.test(row.sql)) return;
    this.db.exec(`
      BEGIN;
      ${SCHEMA.replace("IF NOT EXISTS plans", "plans_new")};
      INSERT INTO plans_new (id, title, kgi, context, n_paths, horizon_years, model, stage, doc, created_at, updated_at)
        SELECT id, title, kgi, context, n_paths, horizon_years, model, stage, doc, created_at, updated_at FROM plans;
      DROP TABLE plans;
      ALTER TABLE plans_new RENAME TO plans;
      COMMIT;
    `);
    console.log("[db] plans テーブルを移行しました（stage の CHECK 制約を撤去）");
  }

  insert(p: NewPlan): PlanRow {
    assertStage(p.stage);
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `INSERT INTO plans (title, kgi, context, n_paths, horizon_years, model, stage, doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(titleOf(p.title ?? p.kgi), p.kgi, p.context ?? "", p.n_paths, p.horizon_years, p.model ?? null, p.stage, JSON.stringify(p.doc), now, now);
    return this.row(Number(r.lastInsertRowid))!;
  }

  /** meta に渡した列だけ書き換える（土台の段階で KGI や状況が後から決まるため） */
  update(id: number, patch: { doc: PlanDoc; stage: Stage; meta?: PlanMeta }): PlanRow | null {
    assertStage(patch.stage);
    const now = new Date().toISOString();
    const sets = ["doc = ?", "stage = ?", "updated_at = ?"];
    const vals: (string | number | null)[] = [JSON.stringify(patch.doc), patch.stage, now];
    const m = patch.meta ?? {};
    if (m.title !== undefined) { sets.push("title = ?"); vals.push(titleOf(m.title)); }
    if (m.kgi !== undefined) { sets.push("kgi = ?"); vals.push(m.kgi); }
    if (m.context !== undefined) { sets.push("context = ?"); vals.push(m.context); }
    if (m.n_paths !== undefined) { sets.push("n_paths = ?"); vals.push(m.n_paths); }
    if (m.horizon_years !== undefined) { sets.push("horizon_years = ?"); vals.push(m.horizon_years); }
    if (m.model !== undefined) { sets.push("model = ?"); vals.push(m.model); }
    const r = this.db.prepare(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return r.changes ? this.row(id) : null;
  }

  get(id: number): { plan: PlanRow; doc: PlanDoc } | null {
    const r = this.db.prepare(`SELECT ${COLS}, doc FROM plans WHERE id = ?`).get(id) as (PlanRow & { doc: string }) | undefined;
    if (!r) return null;
    const { doc, ...plan } = r;
    return { plan: { ...plan }, doc: JSON.parse(doc) as PlanDoc };
  }

  list(): PlanRow[] {
    return (this.db.prepare(`SELECT ${COLS} FROM plans ORDER BY updated_at DESC, id DESC`).all() as PlanRow[]).map((r) => ({ ...r }));
  }

  delete(id: number): boolean {
    return this.db.prepare(`DELETE FROM plans WHERE id = ?`).run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private row(id: number): PlanRow | null {
    const r = this.db.prepare(`SELECT ${COLS} FROM plans WHERE id = ?`).get(id) as PlanRow | undefined;
    return r ? { ...r } : null;
  }
}
