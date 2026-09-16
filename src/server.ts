import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  enrichPaths, generateLearning, generateMbtiFit, generatePaths, generateStoryMap, generateStudyTemplates, normalizeMbti, runFull,
  type Learning, type PlanDoc, type StoryMap, type StudyInputSkill,
} from "./engine.ts";
import { allocate, defaultSettings, normalizeSettings, type SessionTemplate, type StudySession, type StudySettings } from "./schedule.ts";
import { PlanStore, defaultDbPath } from "./db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDist = join(root, "dist", "client");
const port = Number(process.env.PORT || 8787);
const host = process.env.LIFE_KGI_HOST || "0.0.0.0";
const dbPath = defaultDbPath();
const store = new PlanStore(dbPath);

function claudeOk(): boolean {
  try {
    execFileSync(process.env.CLAUDE_BIN || "claude", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

async function sendJson(res: ServerResponse, code: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(urlPath: string, res: ServerResponse) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = normalize(join(clientDist, rel.replace(/^\/+/, "")));
  if (!file.startsWith(clientDist)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const target = existsSync(file) ? file : join(clientDist, "index.html");
  try { await stat(target); } catch { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": mime[extname(target)] || "application/octet-stream" });
  createReadStream(target).pipe(res);
}

type GenerateBody = {
  kgi?: string;
  context?: string;
  n_paths?: number;
  horizon_years?: number;
  model?: string | null;
  paths_doc?: PlanDoc;
  plan_id?: number;
  mbti?: string;
};

/** 生成系 3 エンドポイント。結果は必ず plans に保存し、{ plan, doc } を返す。 */
async function handleGenerate(pathname: string, data: GenerateBody, res: ServerResponse) {
  const kgi = (data.kgi || "").trim();
  if (!kgi) return sendJson(res, 400, { error: "kgi required" });
  if (!claudeOk()) return sendJson(res, 503, { error: "claude CLI がありません。" });
  const model = data.model || undefined;
  const mbti = normalizeMbti(data.mbti);
  const input = { kgi, context: data.context || "", n_paths: data.n_paths || 4, horizon_years: data.horizon_years || 10, model, mbti };
  const meta = { kgi, context: input.context, n_paths: input.n_paths, horizon_years: input.horizon_years, model: model ?? null };

  if (pathname === "/api/paths") {
    const doc = await generatePaths(input);
    return sendJson(res, 200, { plan: store.insert({ ...meta, stage: "paths", doc }), doc });
  }
  if (pathname === "/api/full") {
    const doc = await runFull(input);
    return sendJson(res, 200, { plan: store.insert({ ...meta, stage: "enriched", doc }), doc });
  }
  if (pathname === "/api/enrich") {
    const planId = Number(data.plan_id);
    const existing = Number.isInteger(planId) && planId > 0 ? store.get(planId) : null;
    const base = data.paths_doc ?? existing?.doc ?? {};
    const doc = await enrichPaths(kgi, base, model);
    const plan = existing ? store.update(planId, { doc, stage: "enriched" })! : store.insert({ ...meta, stage: "enriched", doc });
    return sendJson(res, 200, { plan, doc });
  }
  return sendJson(res, 404, { error: "not found" });
}

type StoryBody = { plan_id?: number; path_index?: number; model?: string | null };

/** 決めた道のストーリーマップ（/api/story）と教材（/api/learning）。どちらも保存済みプランを更新する。 */
async function handleStory(pathname: string, data: StoryBody, res: ServerResponse) {
  const id = Number(data.plan_id);
  const found = Number.isInteger(id) && id > 0 ? store.get(id) : null;
  if (!found) return sendJson(res, 404, { error: "plan not found" });
  const { plan, doc } = found;
  const paths = doc.paths ?? [];
  const idx = Number(data.path_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) return sendJson(res, 400, { error: "path_index が不正" });
  if (!claudeOk()) return sendJson(res, 503, { error: "claude CLI がありません。" });
  const model = data.model || undefined;
  const path = paths[idx];

  if (pathname === "/api/story") {
    const story_map = await generateStoryMap({ kgi: plan.kgi, context: plan.context, horizon_years: plan.horizon_years, path }, model);
    paths[idx] = { ...path, story_map };
    const next: PlanDoc = { ...doc, paths, chosen_path: idx };
    return sendJson(res, 200, { plan: store.update(id, { doc: next, stage: "story" })!, doc: next });
  }

  const story = path.story_map as StoryMap | undefined;
  if (!story?.cards) return sendJson(res, 400, { error: "先にストーリーマップを作ってください" });
  const seen = new Set<string>();
  const skills = story.cards
    .filter((c) => c.lane === "learn")
    .map((c) => ({ skill: c.skill || c.title, title: c.title, detail: c.detail }))
    .filter((s) => (seen.has(s.skill) ? false : (seen.add(s.skill), true)));
  const learning = skills.length
    ? await generateLearning({ kgi: plan.kgi, context: plan.context, path_name: String(path.name ?? ""), skills }, model)
    : { items: [] };
  paths[idx] = { ...path, learning };
  const next: PlanDoc = { ...doc, paths };
  return sendJson(res, 200, { plan: store.update(id, { doc: next, stage: plan.stage })!, doc: next });
}

export type StudyPlan = {
  settings: StudySettings;
  templates: SessionTemplate[];
  sessions: StudySession[];
  done: string[];
  /** 完了にした時刻（session id → ISO）。連続日数や週次の実績に使う */
  done_at?: Record<string, string>;
  unscheduled: number;
  generated_at: string;
};
type StudyBody = { plan_id?: number; path_index?: number; model?: string | null; settings?: unknown; regenerate?: boolean; session_id?: string; done?: boolean };

function normKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}
function findLearningItem(learning: Learning | undefined, key: string) {
  const k = normKey(key);
  return learning?.items.find((it) => normKey(it.skill) === k) ?? learning?.items.find((it) => { const s = normKey(it.skill); return s.length >= 2 && (k.includes(s) || s.includes(k)); });
}

/**
 * 学習計画: /api/study_plan（雛形を AI で作って配置）/ /api/study_plan/allocate（再配置のみ）/ /api/study_plan/done（完了の切り替え）。
 * 配置はコード（schedule.ts）、AI は所要時間の見積りとセッション分割だけ。
 */
async function handleStudy(pathname: string, data: StudyBody, res: ServerResponse) {
  const id = Number(data.plan_id);
  const found = Number.isInteger(id) && id > 0 ? store.get(id) : null;
  if (!found) return sendJson(res, 404, { error: "plan not found" });
  const { plan, doc } = found;
  const paths = doc.paths ?? [];
  const idx = Number(data.path_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) return sendJson(res, 400, { error: "path_index が不正" });
  const path = paths[idx];
  const existing = path.study_plan as StudyPlan | undefined;
  const save = (study_plan: StudyPlan) => {
    paths[idx] = { ...path, study_plan };
    const next: PlanDoc = { ...doc, paths };
    return sendJson(res, 200, { plan: store.update(id, { doc: next, stage: plan.stage })!, doc: next });
  };

  if (pathname === "/api/study_plan/done") {
    const sid = String(data.session_id ?? "");
    if (!existing?.sessions.some((s) => s.id === sid)) return sendJson(res, 404, { error: "session not found" });
    const done = new Set(existing.done ?? []);
    const done_at = { ...(existing.done_at ?? {}) };
    if (data.done) {
      done.add(sid);
      done_at[sid] = new Date().toISOString();
    } else {
      done.delete(sid);
      delete done_at[sid];
    }
    return save({ ...existing, done: [...done], done_at });
  }

  const settings = normalizeSettings(data.settings ?? existing?.settings, existing?.settings ?? defaultSettings());
  let templates = existing?.templates ?? [];
  if (pathname === "/api/study_plan") {
    if (data.regenerate || !templates.length) {
      const story = path.story_map as StoryMap | undefined;
      const learning = path.learning as Learning | undefined;
      if (!story?.cards) return sendJson(res, 400, { error: "先にストーリーマップを作ってください" });
      if (!learning?.items?.length) return sendJson(res, 400, { error: "先に教材を取得してください" });
      if (!claudeOk()) return sendJson(res, 503, { error: "claude CLI がありません。" });
      const learnCards = story.cards
        .filter((c) => c.lane === "learn")
        .sort((a, b) => Number(b.first_90_days) - Number(a.first_90_days) || a.phase - b.phase || a.priority - b.priority);
      const skills: StudyInputSkill[] = [];
      const byKey = new Map<string, StudyInputSkill>();
      for (const c of learnCards) {
        const key = c.skill || c.title;
        let sk = byKey.get(key);
        if (!sk) {
          const item = findLearningItem(learning, key);
          sk = { skill: key, level: item?.level, why: item?.why, resources: (item?.resources ?? []).map((r) => ({ title: r.title, url: r.url, type: r.type, cost: r.cost })), cards: [] };
          byKey.set(key, sk);
          skills.push(sk);
        }
        sk.cards.push({ title: c.title, detail: c.detail, done_when: c.done_when, phase: c.phase });
      }
      templates = await generateStudyTemplates(
        { kgi: plan.kgi, context: plan.context, path_name: String(path.name ?? ""), session_max_minutes: settings.session_max_minutes, skills },
        data.model || undefined,
      );
    }
  } else if (pathname === "/api/study_plan/allocate") {
    if (!templates.length) return sendJson(res, 400, { error: "先に学習計画を作ってください" });
  } else {
    return sendJson(res, 404, { error: "not found" });
  }
  const { sessions, unscheduled } = allocate(templates, settings);
  const ids = new Set(sessions.map((s) => s.id));
  return save({
    settings,
    templates,
    sessions,
    done: (existing?.done ?? []).filter((sid) => ids.has(sid)),
    done_at: Object.fromEntries(Object.entries(existing?.done_at ?? {}).filter(([sid]) => ids.has(sid))),
    unscheduled: unscheduled.length,
    generated_at: new Date().toISOString(),
  });
}

const HEAVY_KEYS = new Set(["skills_kpi", "future", "story_map", "learning", "study_plan", "mbti_fit"]);

/** MBTI から各道のおすすめ度（A/B/C）を付けて保存する。道の重い入れ子は渡さない。 */
async function handleFit(data: { plan_id?: number; mbti?: string; model?: string | null }, res: ServerResponse) {
  const id = Number(data.plan_id);
  const found = Number.isInteger(id) && id > 0 ? store.get(id) : null;
  if (!found) return sendJson(res, 404, { error: "plan not found" });
  const mbti = normalizeMbti(data.mbti);
  if (!mbti) return sendJson(res, 400, { error: "MBTI が不正です（例: INTJ）" });
  const { plan, doc } = found;
  const paths = doc.paths ?? [];
  if (!paths.length) return sendJson(res, 400, { error: "道がありません" });
  if (!claudeOk()) return sendJson(res, 503, { error: "claude CLI がありません。" });
  const summaries = paths.map((p, i) => ({
    path: i,
    name: String(p.name ?? `道 ${i + 1}`),
    summary: Object.fromEntries(Object.entries(p).filter(([k]) => !HEAVY_KEYS.has(k) && k !== "name")),
  }));
  const { fits, note } = await generateMbtiFit({ mbti, kgi: plan.kgi, context: plan.context, paths: summaries }, data.model || undefined);
  const nextPaths = paths.map((p, i) => (fits[i] ? { ...p, mbti_fit: fits[i] } : { ...p, mbti_fit: undefined }));
  const next: PlanDoc = { ...doc, paths: nextPaths, mbti, mbti_note: note };
  return sendJson(res, 200, { plan: store.update(id, { doc: next, stage: plan.stage })!, doc: next });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;
  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return await sendJson(res, 200, { ok: true, claude: claudeOk(), db: dbPath, inherited_effort: process.env.CLAUDE_EFFORT ?? null, effort: process.env.LIFE_KGI_EFFORT ?? null });
    }
    if (req.method === "GET" && pathname === "/api/plans") {
      return await sendJson(res, 200, store.list());
    }
    const m = pathname.match(/^\/api\/plans\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (req.method === "GET") {
        const found = store.get(id);
        return await sendJson(res, found ? 200 : 404, found ?? { error: "not found" });
      }
      if (req.method === "DELETE") {
        if (store.delete(id)) { res.writeHead(204).end(); return; }
        return await sendJson(res, 404, { error: "not found" });
      }
      res.writeHead(405).end("method");
      return;
    }
    if (req.method === "POST" && pathname === "/api/fit") {
      const data = JSON.parse((await readBody(req)) || "{}") as { plan_id?: number; mbti?: string; model?: string | null };
      return await handleFit(data, res);
    }
    if (req.method === "POST" && pathname.startsWith("/api/study_plan")) {
      const data = JSON.parse((await readBody(req)) || "{}") as StudyBody;
      return await handleStudy(pathname, data, res);
    }
    if (req.method === "POST" && (pathname === "/api/story" || pathname === "/api/learning")) {
      const data = JSON.parse((await readBody(req)) || "{}") as StoryBody;
      return await handleStory(pathname, data, res);
    }
    if (req.method === "POST" && pathname.startsWith("/api/")) {
      const data = JSON.parse((await readBody(req)) || "{}") as GenerateBody;
      return await handleGenerate(pathname, data, res);
    }
    if (req.method === "GET") { await serveStatic(pathname, res); return; }
    res.writeHead(405).end("method");
  } catch (e) {
    await sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(port, host, () => {
  console.log(`life-kgi  http://${host}:${port}  db=${dbPath}`);
});
