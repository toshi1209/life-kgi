// 土台: MVV → KGI → 共通 KPI。型・正規化・生成・変更のルール・複製。
// 道より前に 1 回だけ決め、全部の道が同じ KGI と KPI で比べられるようにする。

import { ClaudeError } from "./claude.ts";
import { ask, type PlanDoc } from "./engine.ts";
import { KGI_FIELDS, kgiProblems, monthOf, type KgiSpec } from "./kgi.ts";

export type MvvAnswer = { q: string; a: string };
export type MvvValue = { name: string; meaning?: string; behavior?: string };
export type Mvv = { mission: string; vision: string; values: MvvValue[]; grounds?: string };
export type ConfirmedMvv = Mvv & { confirmed_at: string };
export type ConfirmedKgi = KgiSpec & { confirmed_at: string };
export type KpiKind = "leading" | "lagging";
export type KpiTarget = { at: string; value: string };
export type Kpi = {
  id: string;
  name: string;
  definition?: string;
  how_to_measure?: string;
  kind: KpiKind;
  cadence?: string;
  unit?: string;
  targets: KpiTarget[];
  why?: string;
};
export type KpiTree = { formula?: string; kpis: Kpi[]; generated_at: string };
export type PathKpiPlan = { kpi_id: string; target?: string; how?: string };
export type ValueFitLevel = "match" | "neutral" | "conflict";
export type ValuesFit = { rank: "A" | "B" | "C"; items: { value: string; fit: ValueFitLevel; reason?: string }[]; summary?: string };

/** 400（入力が不正）/ 409（道があるので変えられない など）を返すためのエラー */
export class FoundationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const FOUNDATION_KEYS = ["mvv_answers", "mvv_candidates", "mvv", "kgi_candidates", "kgi_spec", "kpi_tree"] as const;
const MAX_VALUES = 7;
const MAX_KPIS = 8;

function isObj(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
/** undefined のキーを落とす（保存する JSON と比較を素直にする） */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
function listOf(v: unknown, key: string): unknown[] {
  if (Array.isArray(v)) return v;
  return isObj(v) && Array.isArray(v[key]) ? (v[key] as unknown[]) : [];
}

// ---------- MVV ----------

function toMvv(v: unknown): Mvv | undefined {
  if (!isObj(v)) return undefined;
  const mission = str(v.mission);
  const vision = str(v.vision);
  const values = (Array.isArray(v.values) ? v.values : [])
    .filter(isObj)
    .map((x) => compact({ name: str(x.name) ?? "", meaning: str(x.meaning), behavior: str(x.behavior) }))
    .filter((x) => x.name)
    .slice(0, MAX_VALUES);
  if (!mission || !vision || !values.length) return undefined;
  return compact({ mission, vision, values, grounds: str(v.grounds) });
}

export function normalizeMvvCandidates(v: unknown): Mvv[] {
  const out = listOf(v, "candidates").map(toMvv).filter((m): m is Mvv => !!m);
  if (!out.length) throw new ClaudeError("mvv の形式が不正（candidates が空）");
  return out;
}

/** 手で直して確定する MVV。ミッション・ビジョン・バリュー 1 個以上が必要。 */
export function validateMvv(v: unknown): Mvv {
  const o = isObj(v) ? v : {};
  if (!str(o.mission)) throw new FoundationError(400, "ミッションを書いてください");
  if (!str(o.vision)) throw new FoundationError(400, "ビジョンを書いてください");
  const m = toMvv(o);
  if (!m) throw new FoundationError(400, "バリューを 1 つ以上書いてください");
  return m;
}

// ---------- KGI ----------

function toKgi(v: unknown): KgiSpec | undefined {
  if (!isObj(v)) return undefined;
  const k = compact({
    statement: str(v.statement) ?? "",
    metric: str(v.metric) ?? "",
    target: str(v.target) ?? "",
    deadline: str(v.deadline) ?? "",
    how_to_measure: str(v.how_to_measure) ?? "",
    why: str(v.why),
  });
  return k;
}

/** 測れない案（願望形・数字なし・過去の期限・欠け）は捨てる。1 案も残らなければ作り直し。 */
export function normalizeKgiCandidates(v: unknown, today = new Date()): KgiSpec[] {
  const out = listOf(v, "candidates")
    .map(toKgi)
    .filter((k): k is KgiSpec => !!k && kgiProblems(k, today).length === 0);
  if (!out.length) throw new ClaudeError("kgi の形式が不正（測れる candidates が無い）");
  return out;
}

export function validateKgi(v: unknown, today = new Date()): KgiSpec {
  const k = toKgi(v) ?? toKgi({})!;
  const problems = kgiProblems(k, today);
  if (problems.length) throw new FoundationError(400, problems.join(" / "));
  return k;
}

// ---------- KPI ----------

export function normalizeKpiTree(v: unknown, generatedAt = new Date().toISOString()): KpiTree {
  const kpis: Kpi[] = listOf(v, "kpis")
    .filter(isObj)
    .filter((k) => str(k.name))
    .slice(0, MAX_KPIS)
    .map((k, i) => ({
      id: `K${i + 1}`,
      name: str(k.name)!,
      definition: str(k.definition),
      how_to_measure: str(k.how_to_measure),
      kind: k.kind === "lagging" ? "lagging" : "leading",
      cadence: str(k.cadence),
      unit: str(k.unit),
      targets: (Array.isArray(k.targets) ? k.targets : [])
        .filter(isObj)
        .map((t) => ({ at: str(t.at) ?? "", value: str(t.value) ?? "" }))
        .filter((t) => t.at && t.value),
      why: str(k.why),
    }));
  if (!kpis.length) throw new ClaudeError("kpi の形式が不正（kpis が空）");
  return compact({ formula: isObj(v) ? str(v.formula) : undefined, kpis, generated_at: generatedAt });
}

/** 道の kpi_plan を共通 KPI の id に揃える。知らない id と重複は捨てる。 */
export function normalizeKpiPlan(v: unknown, kpis: Kpi[]): PathKpiPlan[] {
  const ids = new Set(kpis.map((k) => k.id));
  const seen = new Set<string>();
  const out: PathKpiPlan[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    if (!isObj(r)) continue;
    const id = str(r.kpi_id);
    if (!id || !ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ kpi_id: id, target: str(r.target), how: str(r.how) });
  }
  return out;
}

// ---------- バリューとの合い具合 ----------

export function normalizeValuesFit(v: unknown, nPaths: number): (ValuesFit | undefined)[] {
  const out: (ValuesFit | undefined)[] = Array.from({ length: nPaths }, () => undefined);
  let n = 0;
  for (const r of listOf(v, "paths")) {
    if (!isObj(r)) continue;
    const idx = Number(r.path);
    const rank = String(r.rank ?? "").trim().toUpperCase();
    if (!Number.isInteger(idx) || idx < 0 || idx >= nPaths || !["A", "B", "C"].includes(rank)) continue;
    const items = (Array.isArray(r.items) ? r.items : [])
      .filter(isObj)
      .map((it) => ({
        value: str(it.value) ?? "",
        fit: (["match", "neutral", "conflict"].includes(String(it.fit)) ? it.fit : "neutral") as ValueFitLevel,
        reason: str(it.reason),
      }))
      .filter((it) => it.value);
    out[idx] = { rank: rank as ValuesFit["rank"], items, summary: str(r.summary) };
    n++;
  }
  if (!n) throw new ClaudeError("values_fit の形式が不正（paths が空）");
  return out;
}

// ---------- 変更のルール ----------

export function isLocked(doc: PlanDoc): boolean {
  return (doc.paths?.length ?? 0) > 0;
}

/**
 * 確定（MVV か KGI）を doc に入れた新しい doc を返す。元の doc は変えない。
 * MVV を確定し直すと KGI の候補・KGI・KPI を消し、KGI を確定し直すと KPI を消す。道があれば 409。
 */
export function applyFoundationEdit(doc: PlanDoc, edit: { mvv?: unknown; kgi_spec?: unknown }, today = new Date()): PlanDoc {
  if (isLocked(doc)) throw new FoundationError(409, "道を出したプランの土台は変えられません。「この土台で新しいプラン」で複製してから直してください");
  const at = today.toISOString();
  const next: PlanDoc = { ...doc };
  if (edit.mvv !== undefined) {
    next.mvv = { ...validateMvv(edit.mvv), confirmed_at: at };
    delete next.kgi_candidates;
    delete next.kgi_spec;
    delete next.kgi;
    delete next.kpi_tree;
  }
  if (edit.kgi_spec !== undefined) {
    const k = validateKgi(edit.kgi_spec, today);
    next.kgi_spec = { ...k, confirmed_at: at };
    next.kgi = k.statement;
    delete next.kpi_tree;
  }
  return next;
}

export function foundationStage(doc: PlanDoc): "mvv" | "kgi" | "kpi" {
  if (doc.kpi_tree) return "kpi";
  if (doc.kgi_spec) return "kgi";
  return "mvv";
}

/** 土台（回答・MVV・KGI・KPI と候補）と期間・MBTI だけを深くコピーした新しい doc。 */
export function duplicateFoundation(doc: PlanDoc): PlanDoc {
  const keys = [...FOUNDATION_KEYS, "kgi", "horizon_years", "mbti"] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (doc[k] !== undefined) out[k] = structuredClone(doc[k]);
  return out as PlanDoc;
}

export function titleForDoc(doc: PlanDoc): string {
  return doc.kgi_spec?.statement || (typeof doc.kgi === "string" && doc.kgi) || doc.mvv?.mission || "（作成中）";
}

/** ストーリーマップを作った道があるなら、道の作り直しで学習計画や完了記録を消さないよう止める。 */
export function canRegeneratePaths(doc: PlanDoc): boolean {
  return !(doc.paths ?? []).some((p) => p.story_map);
}

/** 生成した道を doc に入れる。土台・期間・MBTI は doc のものを残し、AI が書き直した kgi などで上書きさせない。 */
export function mergePaths(doc: PlanDoc, generated: PlanDoc): PlanDoc {
  const keep = [...FOUNDATION_KEYS, "kgi", "horizon_years", "mbti", "mbti_note"] as const;
  const extra = Object.fromEntries(Object.entries(generated).filter(([k]) => !(keep as readonly string[]).includes(k) && k !== "paths" && k !== "chosen_path"));
  const base: Record<string, unknown> = {};
  for (const k of keep) if (doc[k] !== undefined) base[k] = doc[k];
  const kpis = doc.kpi_tree?.kpis;
  const paths = (generated.paths ?? []).map((p) => (kpis ? { ...p, kpi_plan: normalizeKpiPlan(p.kpi_plan, kpis) } : p));
  return { ...extra, ...base, paths } as PlanDoc;
}

// ---------- 生成（claude -p） ----------

export async function generateMvvCandidates(input: { answers: MvvAnswer[]; context?: string; horizon_years?: number }, model?: string): Promise<Mvv[]> {
  return ask("mvv.txt", JSON.stringify(input, null, 2), model, { validate: normalizeMvvCandidates });
}

export async function generateKgiCandidates(input: { mvv?: Mvv; context?: string; horizon_years?: number }, model?: string): Promise<KgiSpec[]> {
  const today = new Date();
  return ask("kgi.txt", JSON.stringify({ ...input, today: monthOf(today) }, null, 2), model, { validate: (v) => normalizeKgiCandidates(v, today) });
}

export async function generateKpiTree(input: { mvv?: Mvv; kgi_spec: KgiSpec; context?: string; horizon_years?: number }, model?: string): Promise<KpiTree> {
  return ask("kpis.txt", JSON.stringify({ ...input, today: monthOf(new Date()) }, null, 2), model, { validate: (v) => normalizeKpiTree(v) });
}

export type ValuesFitInput = {
  mission: string;
  values: MvvValue[];
  kgi: string;
  paths: { path: number; name: string; summary: Record<string, unknown> }[];
};

export async function generateValuesFit(input: ValuesFitInput, model?: string): Promise<(ValuesFit | undefined)[]> {
  return ask("values_fit.txt", JSON.stringify(input, null, 2), model, { validate: (v) => normalizeValuesFit(v, input.paths.length) });
}

/** 確定前の KGI の欠けを画面に返すため、項目名だけ公開する */
export { KGI_FIELDS };
