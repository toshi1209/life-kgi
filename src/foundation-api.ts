// 土台（MVV → KGI → 共通 KPI）の API と、土台を使った道の生成・バリューの評価・複製。
// 結果は必ず plans に保存し、{ plan, doc } を返す。

import type { ServerResponse } from "node:http";
import type { PlanMeta, PlanRow, PlanStore } from "./db.ts";
import { foundationInput, generatePaths, normalizeMbti, pathSummaries, type PlanDoc } from "./engine.ts";
import {
  FoundationError, applyFoundationEdit, canRegeneratePaths, duplicateFoundation, foundationStage, generateKgiCandidates,
  generateKpiTree, generateMvvCandidates, generateValuesFit, isLocked, mergePaths, titleForDoc, type MvvAnswer,
} from "./foundation.ts";
import { claudeOk, sendJson } from "./http.ts";

export const FOUNDATION_ROUTES = new Set(["/api/mvv", "/api/kgi", "/api/kpis", "/api/foundation", "/api/values_fit"]);

type Body = {
  plan_id?: number;
  answers?: unknown;
  mvv?: unknown;
  kgi_spec?: unknown;
  context?: string;
  n_paths?: number;
  horizon_years?: number;
  model?: string | null;
  mbti?: string;
};

const MAX_ANSWER = 2000;
const LOCKED = "道を出したプランの土台は変えられません。「この土台で新しいプラン」で複製してから直してください";

function intIn(v: unknown, lo: number, hi: number): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

/** 画面から来た列の値。渡されたものだけ（undefined は update で書き換えない） */
function metaFrom(d: Body): PlanMeta {
  return {
    context: typeof d.context === "string" ? d.context : undefined,
    n_paths: intIn(d.n_paths, 1, 8),
    horizon_years: intIn(d.horizon_years, 1, 50),
    model: d.model === undefined ? undefined : d.model || null,
  };
}

function normalizeAnswers(v: unknown): MvvAnswer[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((x) => ({ q: String(x.q ?? "").trim(), a: String(x.a ?? "").trim().slice(0, MAX_ANSWER) }))
    .filter((x) => x.q && x.a)
    .slice(0, 12);
}

function findPlan(store: PlanStore, id: unknown) {
  const n = Number(id);
  const found = Number.isInteger(n) && n > 0 ? store.get(n) : null;
  if (!found) throw new FoundationError(404, "plan not found");
  return found;
}

function requireClaude() {
  if (!claudeOk()) throw new FoundationError(503, "claude CLI がありません。");
}

/** 新規なら insert、既存なら update。title / kgi は doc から決める。 */
function save(store: PlanStore, existing: { plan: PlanRow } | null, doc: PlanDoc, stage: PlanRow["stage"], meta: PlanMeta): PlanRow {
  const title = titleForDoc(doc);
  const kgi = doc.kgi_spec?.statement ?? (typeof doc.kgi === "string" ? doc.kgi : "");
  if (existing) return store.update(existing.plan.id, { doc, stage, meta: { ...meta, title, kgi } })!;
  return store.insert({
    title,
    kgi,
    context: meta.context ?? "",
    n_paths: meta.n_paths ?? 4,
    horizon_years: meta.horizon_years ?? 10,
    model: meta.model ?? null,
    stage,
    doc,
  });
}

export async function handleFoundation(store: PlanStore, pathname: string, data: Body, res: ServerResponse) {
  try {
    return await route(store, pathname, data, res);
  } catch (e) {
    if (e instanceof FoundationError) return sendJson(res, e.status, { error: e.message });
    throw e;
  }
}

async function route(store: PlanStore, pathname: string, data: Body, res: ServerResponse) {
  const meta = metaFrom(data);
  const model = data.model || undefined;
  const mbti = normalizeMbti(data.mbti);

  // ① MVV の候補（plan_id が無ければ新しいプランを作る）
  if (pathname === "/api/mvv") {
    const answers = normalizeAnswers(data.answers);
    if (!answers.length && !meta.context?.trim()) throw new FoundationError(400, "質問に 1 つ以上答えるか、状況を書いてください");
    const existing = data.plan_id ? findPlan(store, data.plan_id) : null;
    if (existing && isLocked(existing.doc)) throw new FoundationError(409, LOCKED);
    requireClaude();
    const horizon = meta.horizon_years ?? existing?.plan.horizon_years ?? 10;
    const candidates = await generateMvvCandidates({ answers, context: meta.context ?? existing?.plan.context ?? "", horizon_years: horizon }, model);
    const doc: PlanDoc = { ...(existing?.doc ?? {}), horizon_years: horizon, mvv_answers: answers, mvv_candidates: candidates, ...(mbti ? { mbti } : {}) };
    const plan = save(store, existing, doc, foundationStage(doc), meta);
    return sendJson(res, 200, { plan, doc });
  }

  // 確定（AI なし）。plan_id が無く KGI だけ来たら、MVV を飛ばした新しいプランを作る
  if (pathname === "/api/foundation") {
    if (data.mvv === undefined && data.kgi_spec === undefined) throw new FoundationError(400, "mvv か kgi_spec が必要です");
    const existing = data.plan_id ? findPlan(store, data.plan_id) : null;
    const base: PlanDoc = existing?.doc ?? { horizon_years: meta.horizon_years ?? 10, ...(mbti ? { mbti } : {}) };
    const doc = applyFoundationEdit(base, { mvv: data.mvv, kgi_spec: data.kgi_spec });
    const plan = save(store, existing, doc, foundationStage(doc), meta);
    return sendJson(res, 200, { plan, doc });
  }

  const found = findPlan(store, data.plan_id);
  const { plan, doc } = found;
  const context = meta.context ?? plan.context;
  const horizon = meta.horizon_years ?? plan.horizon_years;
  const f = foundationInput(doc);

  // ② KGI の候補
  if (pathname === "/api/kgi") {
    if (isLocked(doc)) throw new FoundationError(409, LOCKED);
    if (!doc.mvv) throw new FoundationError(400, "先に MVV を確定してください（MVV を飛ばすなら KGI を自分で書いて確定）");
    requireClaude();
    const kgi_candidates = await generateKgiCandidates({ mvv: f.mvv, context, horizon_years: horizon }, model);
    const next: PlanDoc = { ...doc, kgi_candidates };
    return sendJson(res, 200, { plan: save(store, found, next, foundationStage(next), meta), doc: next });
  }

  // ③ 共通 KPI（作り直しもここ）
  if (pathname === "/api/kpis") {
    if (isLocked(doc)) throw new FoundationError(409, LOCKED);
    if (!f.kgi_spec) throw new FoundationError(400, "先に KGI を確定してください");
    requireClaude();
    const kpi_tree = await generateKpiTree({ mvv: f.mvv, kgi_spec: f.kgi_spec, context, horizon_years: horizon }, model);
    const next: PlanDoc = { ...doc, kpi_tree };
    return sendJson(res, 200, { plan: save(store, found, next, "kpi", meta), doc: next });
  }

  // ④ 土台で道を出す
  if (pathname === "/api/paths") {
    if (!doc.kgi_spec || !doc.kpi_tree) throw new FoundationError(400, "先に土台タブで KGI と KPI を決めてください");
    if (!canRegeneratePaths(doc)) throw new FoundationError(409, "ストーリーマップを作った道があるので、道は作り直せません。「この土台で新しいプラン」で複製してください");
    requireClaude();
    const generated = await generatePaths({
      kgi: plan.kgi,
      context,
      horizon_years: horizon,
      n_paths: meta.n_paths ?? plan.n_paths,
      model,
      mbti: mbti ?? doc.mbti,
      foundation: f,
    });
    const next: PlanDoc = { ...mergePaths(doc, generated), ...(mbti ? { mbti } : {}) };
    return sendJson(res, 200, { plan: save(store, found, next, "paths", meta), doc: next });
  }

  // 道のあと: バリューとの合い具合（道を作ったのとは別の呼び出しで評価する）
  if (pathname === "/api/values_fit") {
    const paths = doc.paths ?? [];
    if (!doc.mvv?.values?.length) throw new FoundationError(400, "バリューがありません（MVV を確定したプランだけで使えます）");
    if (!paths.length) throw new FoundationError(400, "道がありません");
    requireClaude();
    const fits = await generateValuesFit({ mission: doc.mvv.mission, values: doc.mvv.values, kgi: plan.kgi, paths: pathSummaries(paths) }, model);
    const next: PlanDoc = { ...doc, paths: paths.map((p, i) => (fits[i] ? { ...p, values_fit: fits[i] } : p)) };
    return sendJson(res, 200, { plan: save(store, found, next, plan.stage, {}), doc: next });
  }

  return sendJson(res, 404, { error: "not found" });
}

/** 土台（回答・MVV・KGI・KPI と候補）を複製した新しいプランを作る */
export async function handleDuplicate(store: PlanStore, id: number, res: ServerResponse) {
  const found = store.get(id);
  if (!found) return sendJson(res, 404, { error: "plan not found" });
  const doc = duplicateFoundation(found.doc);
  const { plan: p } = found;
  const plan = save(store, null, doc, foundationStage(doc), { context: p.context, n_paths: p.n_paths, horizon_years: p.horizon_years, model: p.model });
  return sendJson(res, 200, { plan, doc });
}
