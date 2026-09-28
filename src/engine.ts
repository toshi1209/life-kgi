import { ClaudeError, loadPrompt, parseJsonResult, runClaudeP } from "./claude.ts";
import type { SessionTemplate } from "./schedule.ts";
import type { ConfirmedKgi, ConfirmedMvv, KpiTree, Mvv, MvvAnswer } from "./foundation.ts";
import type { KgiSpec } from "./kgi.ts";

const SYSTEM =
  "あなたはユーザーの人生KGIを設計する参謀です。推測で盛らず、トレードオフを明示し、測定できる指標だけを出す。出力は指定JSONのみ。";
const SYSTEM_SEARCH =
  "あなたは学習教材の調査員です。WebSearch ツールで実在を確認した URL だけを使い、最後の応答は指定 JSON のみを出力する。";

export type PlanDoc = {
  kgi?: string;
  horizon_years?: number;
  paths?: Record<string, unknown>[];
  /** 決めた道の添字 */
  chosen_path?: number;
  /** 自己申告の MBTI（任意、参考情報） */
  mbti?: string;
  mbti_note?: string;
  // ---- 土台（MVV → KGI → 共通 KPI）。src/foundation.ts ----
  mvv_answers?: MvvAnswer[];
  mvv_candidates?: Mvv[];
  mvv?: ConfirmedMvv;
  kgi_candidates?: KgiSpec[];
  kgi_spec?: ConfirmedKgi;
  kpi_tree?: KpiTree;
};

/** 道・深掘り・ストーリーマップ・質問のプロンプトに渡す土台。無いプラン（従来の KGI 直入力）では空。 */
export function foundationInput(doc: PlanDoc): { mvv?: Mvv; kgi_spec?: KgiSpec; kpi_formula?: string; kpis?: KpiTree["kpis"] } {
  const out: { mvv?: Mvv; kgi_spec?: KgiSpec; kpi_formula?: string; kpis?: KpiTree["kpis"] } = {};
  if (doc.mvv) {
    const { confirmed_at: _c, grounds: _g, ...m } = doc.mvv;
    out.mvv = m;
  }
  if (doc.kgi_spec) {
    const { confirmed_at: _c, ...k } = doc.kgi_spec;
    out.kgi_spec = k;
  }
  if (doc.kpi_tree) {
    if (doc.kpi_tree.formula) out.kpi_formula = doc.kpi_tree.formula;
    out.kpis = doc.kpi_tree.kpis;
  }
  return out;
}

export type StoryLane = "do" | "learn" | "prove" | "measure";
export const STORY_LANES: readonly StoryLane[] = ["do", "learn", "prove", "measure"];
export type StoryPhase = { name: string; period?: string; goal?: string; story?: string };
export type StoryCard = {
  phase: number;
  lane: StoryLane;
  title: string;
  detail?: string;
  priority: number;
  first_90_days: boolean;
  done_when?: string;
  skill?: string;
};
export type StoryMap = { phases: StoryPhase[]; cards: StoryCard[] };
export type Resource = { title: string; url: string; type?: string; cost?: string; language?: string; why?: string };
export type LearningItem = { skill: string; why?: string; level?: string; resources: Resource[] };
export type Learning = { items: LearningItem[] };

type AskOpts<T> = { validate?: (v: unknown) => T; tools?: string[]; maxTurns?: number; systemPrompt?: string; vars?: Record<string, string | number> };

/** プロンプトを claude -p に投げて JSON を返す。JSON でない・形が不正な出力は 1 回だけ再試行する。 */
export async function ask<T>(file: string, userBlock: string, model?: string, opts: AskOpts<T> = {}): Promise<T> {
  let system = await loadPrompt(file);
  for (const [k, v] of Object.entries(opts.vars ?? {})) system = system.split(`{${k}}`).join(String(v));
  const prompt = `${system}\n\n---\nユーザー入力:\n${userBlock}`;
  for (let attempt = 1; ; attempt++) {
    const raw = await runClaudeP(prompt, {
      systemPrompt: opts.systemPrompt ?? SYSTEM,
      model,
      label: `${file}#${attempt}`,
      tools: opts.tools,
      maxTurns: opts.maxTurns,
    });
    try {
      const parsed = parseJsonResult<unknown>(raw);
      return opts.validate ? opts.validate(parsed) : (parsed as T);
    } catch (e) {
      console.error(`[engine] ${file}#${attempt} ${e instanceof Error ? e.message : String(e)}`);
      if (attempt >= 2) throw e;
    }
  }
}

export async function generatePaths(input: {
  kgi: string;
  context?: string;
  horizon_years?: number;
  n_paths?: number;
  model?: string;
  mbti?: string;
  /** 土台（MVV・KGI・共通 KPI）。あれば道は KGI を言い換えず、kpi_plan を持つ */
  foundation?: ReturnType<typeof foundationInput>;
}): Promise<PlanDoc> {
  const n = input.n_paths ?? 4;
  const data = await ask<PlanDoc>(
    "paths.txt",
    JSON.stringify(
      {
        kgi: input.kgi,
        context: input.context ?? "",
        horizon_years: input.horizon_years ?? 10,
        n_paths: n,
        ...(input.mbti ? { mbti: input.mbti } : {}),
        ...(input.foundation ?? {}),
      },
      null,
      2,
    ),
    input.model,
  );
  data.paths = (data.paths ?? []).slice(0, n);
  if (input.mbti) data.mbti = input.mbti;
  return data;
}

export async function enrichPaths(
  kgi: string,
  pathsDoc: PlanDoc,
  model?: string,
): Promise<PlanDoc> {
  const paths = pathsDoc.paths ?? [];
  const foundation = foundationInput(pathsDoc);
  const filled = await Promise.all(
    paths.map(async (p) => {
      const payload = JSON.stringify({ kgi, ...foundation, path: p }, null, 2);
      const [skills, future] = await Promise.all([
        ask("skills_kpi.txt", payload, model),
        ask("future.txt", payload, model),
      ]);
      return { ...p, skills_kpi: skills, future };
    }),
  );
  return {
    kgi: pathsDoc.kgi || kgi,
    horizon_years: pathsDoc.horizon_years,
    paths: filled,
    chosen_path: pathsDoc.chosen_path,
    mbti: pathsDoc.mbti,
    mbti_note: pathsDoc.mbti_note,
    mvv_answers: pathsDoc.mvv_answers,
    mvv_candidates: pathsDoc.mvv_candidates,
    mvv: pathsDoc.mvv,
    kgi_candidates: pathsDoc.kgi_candidates,
    kgi_spec: pathsDoc.kgi_spec,
    kpi_tree: pathsDoc.kpi_tree,
  };
}

export async function runFull(input: {
  kgi: string;
  context?: string;
  horizon_years?: number;
  n_paths?: number;
  model?: string;
}): Promise<PlanDoc> {
  const base = await generatePaths(input);
  return enrichPaths(input.kgi, base, input.model);
}

// ---------- 道の要約（おすすめ度・難しさ・バリューの評価に渡す。重い入れ子は外す） ----------

const HEAVY_KEYS = new Set(["skills_kpi", "future", "story_map", "learning", "study_plan", "mbti_fit", "difficulty", "values_fit", "qa"]);

export function pathSummaries(paths: Record<string, unknown>[]) {
  return paths.map((p, i) => ({
    path: i,
    name: String(p.name ?? `道 ${i + 1}`),
    summary: Object.fromEntries(Object.entries(p).filter(([k]) => !HEAVY_KEYS.has(k) && k !== "name")),
  }));
}

// ---------- ストーリーマップ / 学習教材 ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** claude の出力を StoryMap に正規化する。phases / cards が無ければ不正として投げる（→ 再生成）。 */
export function normalizeStoryMap(v: unknown): StoryMap {
  if (!isObj(v) || !Array.isArray(v.phases) || !Array.isArray(v.cards)) {
    throw new ClaudeError("story_map の形式が不正（phases / cards が無い）");
  }
  const phases: StoryPhase[] = v.phases
    .filter(isObj)
    .map((p) => ({ name: str(p.name) ?? "", period: str(p.period), goal: str(p.goal), story: str(p.story) }))
    .filter((p) => p.name);
  if (!phases.length) throw new ClaudeError("story_map の形式が不正（phases が空）");
  const cards: StoryCard[] = v.cards
    .filter(isObj)
    .map((c) => {
      const phase = Number(c.phase);
      const lane = STORY_LANES.includes(c.lane as StoryLane) ? (c.lane as StoryLane) : "do";
      const priority = Number(c.priority);
      return {
        phase: Number.isInteger(phase) ? Math.min(Math.max(phase, 0), phases.length - 1) : 0,
        lane,
        title: str(c.title) ?? "",
        detail: str(c.detail),
        priority: Number.isFinite(priority) ? priority : 99,
        first_90_days: c.first_90_days === true || c.first_90_days === "true",
        done_when: str(c.done_when),
        skill: lane === "learn" ? str(c.skill) : undefined,
      };
    })
    .filter((c) => c.title);
  if (!cards.length) throw new ClaudeError("story_map の形式が不正（cards が空）");
  return { phases, cards };
}

/** claude の出力を Learning に正規化する。http(s) でない URL は捨てる。 */
export function normalizeLearning(v: unknown): Learning {
  const rawItems = isObj(v) && Array.isArray(v.items) ? v.items : Array.isArray(v) ? v : [];
  const items: LearningItem[] = rawItems
    .filter(isObj)
    .map((it) => ({
      skill: str(it.skill) ?? "",
      why: str(it.why),
      level: str(it.level),
      resources: (Array.isArray(it.resources) ? it.resources : [])
        .filter(isObj)
        .map((r) => ({
          title: str(r.title) ?? str(r.url) ?? "",
          url: str(r.url) ?? "",
          type: str(r.type),
          cost: str(r.cost),
          language: str(r.language),
          why: str(r.why),
        }))
        .filter((r) => /^https?:\/\//i.test(r.url)),
    }))
    .filter((it) => it.skill);
  if (!items.length) throw new ClaudeError("learning の形式が不正（items が空）");
  return { items };
}

export async function generateStoryMap(
  input: { kgi: string; context?: string; horizon_years?: number; path: Record<string, unknown> } & ReturnType<typeof foundationInput>,
  model?: string,
): Promise<StoryMap> {
  return ask<StoryMap>("story_map.txt", JSON.stringify(input, null, 2), model, { validate: normalizeStoryMap });
}

export type LearningInput = {
  kgi: string;
  context?: string;
  path_name: string;
  skills: { skill: string; title: string; detail?: string }[];
};

/** WebSearch を許可して教材を調べる。ターン数はスキル数に比例（上限 30）。 */
export async function generateLearning(input: LearningInput, model?: string): Promise<Learning> {
  return ask<Learning>("learning.txt", JSON.stringify(input, null, 2), model, {
    validate: normalizeLearning,
    tools: ["WebSearch"],
    maxTurns: Math.min(30, 4 + input.skills.length * 2),
    systemPrompt: SYSTEM_SEARCH,
  });
}

// ---------- 学習計画（セッション雛形） ----------

export type StudyInputSkill = {
  skill: string;
  level?: string;
  why?: string;
  resources: { title: string; url: string; type?: string; cost?: string }[];
  cards: { title: string; detail?: string; done_when?: string; phase?: number }[];
};
export type StudyInput = { kgi: string; context?: string; path_name: string; session_max_minutes: number; skills: StudyInputSkill[] };

/** claude の出力をセッション雛形の列にする。分数は 30〜max に丸め、教材 URL は title 一致で引く。 */
export function normalizeStudyTemplates(v: unknown, skills: { skill: string; resources: { title: string; url: string }[] }[], maxMinutes: number): SessionTemplate[] {
  const out: SessionTemplate[] = [];
  const rawSkills = isObj(v) && Array.isArray(v.skills) ? v.skills : [];
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  rawSkills.filter(isObj).forEach((rs) => {
    const name = str(rs.skill) ?? "";
    const idx = skills.findIndex((s) => norm(s.skill) === norm(name));
    if (idx < 0) return;
    const resources = skills[idx].resources;
    let n = 0;
    for (const ses of Array.isArray(rs.sessions) ? rs.sessions : []) {
      if (!isObj(ses)) continue;
      const title = str(ses.title);
      if (!title) continue;
      const minutes = Math.min(maxMinutes, Math.max(30, Math.round(Number(ses.minutes) || 60)));
      const rt = str(ses.resource_title);
      const res = rt ? resources.find((r) => norm(r.title) === norm(rt)) ?? resources.find((r) => norm(r.title).includes(norm(rt)) || norm(rt).includes(norm(r.title))) : undefined;
      n++;
      out.push({ id: `s${idx}-${n}`, skill: skills[idx].skill, title, minutes, resource_title: res?.title ?? rt, resource_url: res?.url, what: str(ses.what) });
    }
  });
  if (!out.length) throw new ClaudeError("study_plan の形式が不正（sessions が空）");
  return out;
}

export async function generateStudyTemplates(input: StudyInput, model?: string): Promise<SessionTemplate[]> {
  return ask<SessionTemplate[]>("study_plan.txt", JSON.stringify(input, null, 2), model, {
    validate: (v) => normalizeStudyTemplates(v, input.skills, input.session_max_minutes),
    vars: { session_max_minutes: input.session_max_minutes },
  });
}

// ---------- MBTI による道のおすすめ度（A / B / C） ----------

export const MBTI_TYPES = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"] as const;
export type MbtiType = (typeof MBTI_TYPES)[number];
export type MbtiRank = "A" | "B" | "C";
export type MbtiFit = { rank: MbtiRank; reason?: string };

export function normalizeMbti(v: unknown): MbtiType | undefined {
  const t = String(v ?? "").trim().toUpperCase();
  return (MBTI_TYPES as readonly string[]).includes(t) ? (t as MbtiType) : undefined;
}

/** claude の出力を道ごとの { rank, reason } に並べる。不正な添字・ランクは捨て、1 件も無ければ投げる。 */
export function normalizeMbtiFit(v: unknown, nPaths: number): { fits: (MbtiFit | undefined)[]; note?: string } {
  const fits: (MbtiFit | undefined)[] = Array.from({ length: nPaths }, () => undefined);
  const ranks = isObj(v) && Array.isArray(v.ranks) ? v.ranks : [];
  let n = 0;
  for (const r of ranks) {
    if (!isObj(r)) continue;
    const idx = Number(r.path);
    const rank = String(r.rank ?? "").trim().toUpperCase();
    if (!Number.isInteger(idx) || idx < 0 || idx >= nPaths || !["A", "B", "C"].includes(rank)) continue;
    fits[idx] = { rank: rank as MbtiRank, reason: str(r.reason) };
    n++;
  }
  if (!n) throw new ClaudeError("mbti_fit の形式が不正（ranks が空）");
  return { fits, note: isObj(v) ? str(v.note) : undefined };
}

export type MbtiFitInput = { mbti: MbtiType; kgi: string; context?: string; paths: { path: number; name: string; summary: Record<string, unknown> }[] };

export async function generateMbtiFit(input: MbtiFitInput, model?: string): Promise<{ fits: (MbtiFit | undefined)[]; note?: string }> {
  return ask("mbti_fit.txt", JSON.stringify(input, null, 2), model, { validate: (v) => normalizeMbtiFit(v, input.paths.length) });
}

// ---------- 道の難しさ（★1〜5 ＋ 観点別） ----------

export const DIFFICULTY_ASPECTS = ["time", "money", "skill_gap", "uncertainty", "life_load"] as const;
export type DifficultyAspect = (typeof DIFFICULTY_ASPECTS)[number];
export type Difficulty = { overall: number; aspects: Record<DifficultyAspect, number>; wall?: string; reason?: string };

function clamp15(v: unknown): number | undefined {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v != null && v !== "" ? Math.min(5, Math.max(1, n)) : undefined;
}

/** claude の出力を道ごとの Difficulty に並べる。overall が無ければ観点の最大値。何も無ければ投げる。 */
export function normalizeDifficulty(v: unknown, nPaths: number): (Difficulty | undefined)[] {
  const out: (Difficulty | undefined)[] = Array.from({ length: nPaths }, () => undefined);
  const rows = isObj(v) && Array.isArray(v.paths) ? v.paths : [];
  let n = 0;
  for (const r of rows) {
    if (!isObj(r)) continue;
    const idx = Number(r.path);
    if (!Number.isInteger(idx) || idx < 0 || idx >= nPaths) continue;
    const a = isObj(r.aspects) ? r.aspects : {};
    const aspects = {} as Record<DifficultyAspect, number>;
    let any = false;
    for (const k of DIFFICULTY_ASPECTS) {
      const val = clamp15(a[k]);
      if (val != null) any = true;
      aspects[k] = val ?? 3;
    }
    const overall = clamp15(r.overall) ?? (any ? Math.max(...DIFFICULTY_ASPECTS.map((k) => aspects[k])) : undefined);
    if (overall == null) continue;
    out[idx] = { overall, aspects, wall: str(r.wall), reason: str(r.reason) };
    n++;
  }
  if (!n) throw new ClaudeError("difficulty の形式が不正（paths が空）");
  return out;
}

export type DifficultyInput = { kgi: string; context?: string; horizon_years?: number; paths: { path: number; name: string; summary: Record<string, unknown> }[] } & ReturnType<typeof foundationInput>;

export async function generateDifficulty(input: DifficultyInput, model?: string): Promise<(Difficulty | undefined)[]> {
  return ask("difficulty.txt", JSON.stringify(input, null, 2), model, { validate: (v) => normalizeDifficulty(v, input.paths.length) });
}

// ---------- 道についての質問（本文テキストで返す） ----------

const SYSTEM_QA = "あなたは人生設計の相談相手です。渡された道の情報と KGI・context を根拠に、日本語で簡潔に答える。出力は回答本文だけ。";
const QA_HISTORY = 6;

export type QaTurn = { q: string; a: string; at: string };
export type QaInput = ReturnType<typeof foundationInput> & {
  kgi: string;
  context?: string;
  mbti?: string;
  path: Record<string, unknown>;
  history: { q: string; a: string }[];
  question: string;
};

/** JSON ではなく本文テキストを返す問い合わせ。空なら 1 回だけ再試行。 */
export async function answerQuestion(input: QaInput, model?: string): Promise<string> {
  const system = await loadPrompt("qa.txt");
  const block = JSON.stringify({ ...input, history: input.history.slice(-QA_HISTORY) }, null, 2);
  const prompt = `${system}\n\n---\nユーザー入力:\n${block}`;
  for (let attempt = 1; ; attempt++) {
    const raw = (await runClaudeP(prompt, { systemPrompt: SYSTEM_QA, model, label: `qa.txt#${attempt}` })).trim();
    if (raw) return raw;
    console.error(`[engine] qa.txt#${attempt} 空の回答`);
    if (attempt >= 2) throw new ClaudeError("回答が空でした");
  }
}
