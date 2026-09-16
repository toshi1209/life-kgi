import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanDoc } from "./engine.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Stage = "paths" | "enriched" | "story";
const STAGES: readonly Stage[] = ["paths", "enriched", "story"];

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
  kgi: string;
  context?: string;
  n_paths: number;
  horizon_years: number;
  model?: string | null;
  stage: Stage;
  doc: PlanDoc;
};

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
      .run(titleOf(p.kgi), p.kgi, p.context ?? "", p.n_paths, p.horizon_years, p.model ?? null, p.stage, JSON.stringify(p.doc), now, now);
    return this.row(Number(r.lastInsertRowid))!;
  }

  update(id: number, patch: { doc: PlanDoc; stage: Stage }): PlanRow | null {
    assertStage(patch.stage);
    const now = new Date().toISOString();
    const r = this.db
      .prepare(`UPDATE plans SET doc = ?, stage = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(patch.doc), patch.stage, now, id);
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
