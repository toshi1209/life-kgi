import { MBTI_TYPES, type PlanResponse, type PlanRow, type Payload, type StoryCard, type StoryPhase, type StudySession, type StudySettings } from "./types";
import { toTree, type TreeNode } from "./tree";
import { TreeView } from "./view";
import { StoryMapView, laneLabel, learningFor, resourceList, type LearningState } from "./storymap";
import { CalendarView, DOW_LABELS, parseDate } from "./calendar";
import { computeGrowth } from "./growth";
import { GrowthView } from "./growthview";

type Endpoint = "paths" | "enrich" | "full";
type Tab = "tree" | "story" | "calendar" | "growth";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const statusEl = $<HTMLElement>("status");
const healthEl = $<HTMLElement>("health");
const pathsBtn = $<HTMLButtonElement>("paths");
const enrichBtn = $<HTMLButtonElement>("enrich");
const fullBtn = $<HTMLButtonElement>("full");
const downloadBtn = $<HTMLButtonElement>("download");
const fitBtn = $<HTMLButtonElement>("fit");
const mbtiSelect = $<HTMLSelectElement>("mbti");
const plansEl = $<HTMLUListElement>("plans");
const treeHost = $<HTMLElement>("tree");
const storyHost = $<HTMLElement>("story");
const calendarHost = $<HTMLElement>("calendar");
const growthHost = $<HTMLElement>("growth");
const treeTools = $<HTMLElement>("tree-tools");
const tabTree = $<HTMLButtonElement>("tab-tree");
const tabStory = $<HTMLButtonElement>("tab-story");
const tabCalendar = $<HTMLButtonElement>("tab-calendar");
const tabGrowth = $<HTMLButtonElement>("tab-growth");
const emptyEl = $<HTMLElement>("empty");
const crumbsEl = $<HTMLElement>("crumbs");
const detailTitle = $<HTMLElement>("detail-title");
const detailActions = $<HTMLElement>("detail-actions");
const detailText = $<HTMLElement>("detail-text");
const detailFields = $<HTMLTableElement>("detail-fields");
const detailLinks = $<HTMLUListElement>("detail-links");
const detailEmpty = $<HTMLElement>("detail-empty");

let current: PlanResponse | null = null;
let busy = false;
let tab: Tab = "tree";
let treeDirty = false;
let learningState: LearningState = "idle";
let learningError: string | undefined;
let studyMsg: { text?: string; error?: boolean } = {};

const view = new TreeView(treeHost, showDetail);
const story = new StoryMapView(storyHost, {
  onCard: showCardDetail,
  onPhase: showPhaseDetail,
  onFetchLearning: () => void fetchLearning(),
});
const growth = new GrowthView(growthHost);
const calendar = new CalendarView(calendarHost, {
  onGenerate: (settings, regenerate) => void generateStudyPlan(settings, regenerate),
  onAllocate: (settings) => void allocateStudy(settings),
  onSession: showSessionDetail,
});

const JSON_HEADERS = { "Content-Type": "application/json" };

function setStatus(msg: string, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", error);
}

function setBusy(b: boolean) {
  busy = b;
  pathsBtn.disabled = b;
  fullBtn.disabled = b;
  enrichBtn.disabled = b || !current?.doc.paths?.length;
  downloadBtn.disabled = b || !current;
  fitBtn.disabled = b || !current?.doc.paths?.length || !mbtiSelect.value;
  for (const btn of detailActions.querySelectorAll("button")) btn.disabled = b;
  for (const btn of calendarHost.querySelectorAll(".cal-actions button")) (btn as HTMLButtonElement).disabled = b;
}

function field<T extends HTMLElement>(name: string): T {
  return form.elements.namedItem(name) as T;
}

function payload(): Payload {
  const fd = new FormData(form);
  const model = String(fd.get("model") ?? "").trim();
  return {
    kgi: fd.get("kgi"),
    context: fd.get("context"),
    n_paths: Number(fd.get("n_paths") || 4),
    horizon_years: Number(fd.get("horizon_years") || 10),
    model: model || null,
    mbti: String(fd.get("mbti") ?? "") || null,
  };
}

// ---------- MBTI のおすすめ度 ----------

async function fitPaths() {
  if (!current || busy) return;
  const mbti = mbtiSelect.value;
  if (!mbti) {
    setStatus("MBTI を選んでください", true);
    return;
  }
  setBusy(true);
  setStatus(`${mbti} での各道のおすすめ度を判定中… claude -p を呼んでいます（1 分程度）`);
  const t0 = Date.now();
  try {
    current = await api<PlanResponse>("/api/fit", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ plan_id: current.plan.id, mbti, model: payload().model }),
    });
    show(current);
    setTab("tree");
    setStatus(`おすすめ度を付けました (${secsSince(t0)}) — ツリーの道ノードにランク、根と道の詳細に理由`);
    await loadPlans();
  } catch (e) {
    setStatus(errMsg(e), true);
  } finally {
    setBusy(false);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function secsSince(t0: number): string {
  return `${Math.round((Date.now() - t0) / 1000)} 秒`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 決めた道（doc.chosen_path）と、その path */
function chosenPath() {
  const i = current?.doc.chosen_path;
  const path = typeof i === "number" ? current?.doc.paths?.[i] : undefined;
  return path && typeof i === "number" ? { index: i, path } : null;
}

// ---------- タブ ----------

function calendarAvailable(): boolean {
  const cp = chosenPath();
  return !!(cp && (cp.path.learning?.items?.length || cp.path.study_plan));
}

function setTab(t: Tab) {
  if (t === "story" && !chosenPath()?.path.story_map) t = "tree";
  if (t === "calendar" && !calendarAvailable()) t = "tree";
  if (t === "growth" && !chosenPath()?.path.study_plan) t = "tree";
  tab = t;
  treeHost.hidden = t !== "tree";
  treeTools.hidden = t !== "tree";
  storyHost.hidden = t !== "story";
  calendarHost.hidden = t !== "calendar";
  growthHost.hidden = t !== "growth";
  tabTree.classList.toggle("active", t === "tree");
  tabStory.classList.toggle("active", t === "story");
  tabCalendar.classList.toggle("active", t === "calendar");
  tabGrowth.classList.toggle("active", t === "growth");
  if (t === "tree" && treeDirty) {
    view.fit();
    treeDirty = false;
  }
}

// ---------- 生成（道 / 深掘り / 一括） ----------

async function generate(endpoint: Endpoint) {
  const body = payload();
  if (!String(body.kgi ?? "").trim()) {
    setStatus("KGI を入力してください", true);
    return;
  }
  if (endpoint === "enrich" && current) {
    body.paths_doc = current.doc;
    body.plan_id = current.plan.id;
  }
  setBusy(true);
  const label = { paths: "道を生成中", enrich: "各道を深掘り中", full: "一括生成中" }[endpoint];
  setStatus(`${label}… claude -p を呼んでいます（数十秒〜数分かかります）`);
  const t0 = Date.now();
  try {
    current = await api<PlanResponse>(`/api/${endpoint}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    show(current);
    setStatus(`完了 (${secsSince(t0)}) — #${current.plan.id} として保存しました`);
    await loadPlans();
  } catch (e) {
    setStatus(errMsg(e), true);
  } finally {
    setBusy(false);
  }
}

// ---------- ストーリーマップ / 教材 ----------

async function chooseAndStory(index: number, regenerate = false) {
  if (!current || busy) return;
  const path = current.doc.paths?.[index];
  if (!path) return;
  if (path.story_map && !regenerate) {
    setTab("story");
    return;
  }
  if (regenerate && !confirm("ストーリーマップを作り直しますか？（教材も取り直します）")) return;
  setBusy(true);
  setStatus(`道 ${index + 1} のストーリーマップを生成中… claude -p を呼んでいます（1〜2 分）`);
  const t0 = Date.now();
  try {
    current = await api<PlanResponse>("/api/story", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ plan_id: current.plan.id, path_index: index, model: payload().model }),
    });
    learningState = "idle";
    learningError = undefined;
    renderStory();
    setTab("story");
    clearDetail();
    setStatus(`ストーリーマップ完了 (${secsSince(t0)}) — 続けて教材を調べます`);
    await loadPlans();
  } catch (e) {
    setStatus(errMsg(e), true);
    setBusy(false);
    return;
  }
  setBusy(false);
  await fetchLearning();
}

async function fetchLearning() {
  const cp = chosenPath();
  if (!current || !cp?.path.story_map || busy) return;
  learningState = "loading";
  learningError = undefined;
  renderStory();
  setBusy(true);
  setStatus("教材を WebSearch で調べています（1〜3 分かかります）…");
  const t0 = Date.now();
  try {
    current = await api<PlanResponse>("/api/learning", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ plan_id: current.plan.id, path_index: cp.index, model: payload().model }),
    });
    learningState = "done";
    renderStory();
    renderCalendar();
    setStatus(`教材の取得完了 (${secsSince(t0)}) — 続けて学習計画を作ります`);
  } catch (e) {
    learningState = "error";
    learningError = errMsg(e);
    renderStory();
    setStatus(`教材の取得に失敗: ${learningError}`, true);
    setBusy(false);
    return;
  }
  setBusy(false);
  if (!chosenPath()?.path.study_plan) await generateStudyPlan(undefined, false);
}

// ---------- 学習計画 / カレンダー ----------

async function studyRequest(path: string, body: Record<string, unknown>, doing: string, quiet = false): Promise<boolean> {
  const cp = chosenPath();
  if (!current || !cp || busy) return false;
  setBusy(true);
  studyMsg = { text: `${doing}…` };
  renderCalendar();
  setStatus(`${doing}…`);
  const t0 = Date.now();
  try {
    current = await api<PlanResponse>(path, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ plan_id: current.plan.id, path_index: cp.index, model: payload().model, ...body }),
    });
    const sp = chosenPath()?.path.study_plan;
    if (quiet) {
      studyMsg = {};
      setStatus(doing);
    } else {
      studyMsg = { text: sp ? `${doing}が完了しました (${secsSince(t0)})。セッション ${sp.sessions.length} 件${sp.unscheduled ? `、未配置 ${sp.unscheduled} 件` : ""}` : undefined };
      setStatus(`${doing}が完了しました (${secsSince(t0)}) — 「カレンダー」タブに配置済み`);
    }
    return true;
  } catch (e) {
    studyMsg = { text: `${doing}に失敗: ${errMsg(e)}`, error: true };
    setStatus(studyMsg.text!, true);
    return false;
  } finally {
    setBusy(false);
    renderCalendar();
  }
}

async function generateStudyPlan(settings: StudySettings | undefined, regenerate: boolean) {
  await studyRequest("/api/study_plan", { settings, regenerate }, regenerate ? "学習計画の作り直し（AI）" : "学習計画の作成（AI）");
}

async function allocateStudy(settings: StudySettings) {
  await studyRequest("/api/study_plan/allocate", { settings }, "再配置");
}

async function toggleDone(session: StudySession, done: boolean) {
  const ok = await studyRequest("/api/study_plan/done", { session_id: session.id, done }, done ? "完了にしました" : "未完了に戻しました", true);
  if (ok) {
    const sp = chosenPath()?.path.study_plan;
    const updated = sp?.sessions.find((s) => s.id === session.id) ?? session;
    calendar.select(updated.id);
    showSessionDetail(updated, !!sp?.done.includes(updated.id));
  }
}

function renderCalendar() {
  const cp = chosenPath();
  tabCalendar.disabled = !calendarAvailable();
  if (!cp) {
    calendar.clear();
    growth.clear();
    return;
  }
  calendar.render(cp.path.study_plan, {
    busy,
    canGenerate: !!(cp.path.story_map && cp.path.learning?.items?.length),
    message: studyMsg.text,
    error: studyMsg.error,
  });
  renderGrowth();
  renderStory();
}

function renderStory() {
  const cp = chosenPath();
  tabStory.disabled = !cp?.path.story_map;
  if (!cp?.path.story_map) {
    story.clear();
    return;
  }
  const sp = cp.path.study_plan;
  const progress = new Map<string, { done: number; total: number }>();
  if (sp) {
    const doneSet = new Set(sp.done ?? []);
    for (const s of sp.sessions) {
      const p = progress.get(s.skill) ?? { done: 0, total: 0 };
      p.total++;
      if (doneSet.has(s.id)) p.done++;
      progress.set(s.skill, p);
    }
  }
  story.setProgress(progress);
  story.render(cp.path.story_map, cp.path.learning, learningState, learningError);
}

function renderGrowth() {
  const cp = chosenPath();
  tabGrowth.disabled = !cp?.path.study_plan;
  growth.render(cp?.path.study_plan ? computeGrowth(cp.path.study_plan) : null);
}

// ---------- 表示 ----------

function show(r: PlanResponse) {
  emptyEl.hidden = true;
  const typed = String(new FormData(form).get("kgi") ?? "").trim();
  const cp = chosenPath();
  learningState = cp?.path.learning ? "done" : "idle";
  learningError = undefined;
  studyMsg = {};
  calendar.clear();
  renderStory();
  renderCalendar();
  setTab(cp?.path.story_map ? "story" : "tree");
  view.setRoot(toTree(r.doc, r.plan.kgi || typed || "KGI"));
  treeDirty = treeHost.hidden;
  clearDetail();
  highlightPlan(r.plan.id);
}

function setFields(rows: [string, string | undefined][]) {
  const present = rows.filter((r): r is [string, string] => !!r[1]);
  detailFields.replaceChildren(
    ...present.map(([k, v]) => {
      const tr = document.createElement("tr");
      const tk = document.createElement("td");
      tk.className = "k";
      tk.textContent = k;
      const tv = document.createElement("td");
      tv.textContent = v;
      tr.append(tk, tv);
      return tr;
    }),
  );
  detailFields.hidden = present.length === 0;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.disabled = busy;
  b.addEventListener("click", onClick);
  return b;
}

/** ツリーのノードを選んだとき */
function showDetail(n: TreeNode, ancestors: TreeNode[]) {
  detailEmpty.hidden = true;
  crumbsEl.textContent = ancestors.slice(0, -1).map((a) => a.label).join(" › ");
  detailTitle.textContent = n.label;
  const showText = !!n.text && !n.label.includes(n.text);
  detailText.textContent = showText ? n.text! : "";
  detailText.hidden = !showText;
  setFields((n.fields ?? []).map(([k, v]) => [k, v]));
  detailLinks.replaceChildren();
  detailLinks.hidden = true;
  detailActions.replaceChildren();

  const m = /^path(\d+)$/.exec(n.id);
  if (m && current) {
    const idx = Number(m[1]);
    const path = current.doc.paths?.[idx];
    if (path?.story_map) {
      detailActions.append(
        button("ストーリーマップを見る", "", () => setTab("story")),
        button("作り直す", "secondary", () => void chooseAndStory(idx, true)),
      );
    } else {
      detailActions.append(button("この道で進める（ストーリーマップを作る）", "", () => void chooseAndStory(idx)));
      if (current.plan.stage === "paths") {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "先に「各道を深掘り」をしておくと、スキルと KPI を踏まえた地図になります。";
        detailActions.append(hint);
      }
    }
  }
}

/** ストーリーマップのカードを選んだとき */
function showCardDetail(card: StoryCard, phase: StoryPhase) {
  detailEmpty.hidden = true;
  detailActions.replaceChildren();
  crumbsEl.textContent = `ストーリーマップ › ${phase.name} › ${laneLabel(card.lane)}`;
  detailTitle.textContent = card.title;
  detailText.textContent = card.detail ?? "";
  detailText.hidden = !card.detail;
  setFields([
    ["時期", phase.period],
    ["優先度", String(card.priority)],
    ["着手", card.first_90_days ? "90 日以内" : undefined],
    ["完了条件", card.done_when],
    ["スキル", card.skill],
  ]);
  if (card.lane === "learn") {
    const ul = resourceList(learningFor(chosenPath()?.path.learning, card), card.skill || card.title);
    detailLinks.replaceChildren(...ul.children);
    detailLinks.hidden = false;
  } else {
    detailLinks.replaceChildren();
    detailLinks.hidden = true;
  }
}

/** カレンダーのセッションを選んだとき */
function showSessionDetail(s: StudySession, done: boolean) {
  detailEmpty.hidden = true;
  const d = parseDate(s.date);
  crumbsEl.textContent = `カレンダー › ${d.getMonth() + 1}/${d.getDate()}（${DOW_LABELS[(d.getDay() + 6) % 7]}）`;
  detailTitle.textContent = s.title;
  detailText.textContent = s.what ?? "";
  detailText.hidden = !s.what;
  setFields([
    ["時間", `${s.start}〜${s.end}（${s.minutes} 分）`],
    ["スキル", s.skill],
    ["教材", s.resource_title],
    ["状態", done ? "完了" : "未完了"],
  ]);
  detailActions.replaceChildren(button(done ? "未完了に戻す" : "完了にする", done ? "secondary" : "", () => void toggleDone(s, !done)));
  detailLinks.replaceChildren();
  if (s.resource_url) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.resource_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = s.resource_title || s.resource_url;
    li.append(a);
    detailLinks.append(li);
  }
  detailLinks.hidden = !s.resource_url;
}

/** フェーズ見出しを選んだとき */
function showPhaseDetail(phase: StoryPhase, index: number) {
  detailEmpty.hidden = true;
  detailActions.replaceChildren();
  crumbsEl.textContent = "ストーリーマップ";
  detailTitle.textContent = `${index + 1}. ${phase.name}`;
  detailText.textContent = phase.story ?? "";
  detailText.hidden = !phase.story;
  setFields([
    ["時期", phase.period],
    ["ゴール", phase.goal],
  ]);
  detailLinks.replaceChildren();
  detailLinks.hidden = true;
}

function clearDetail() {
  detailEmpty.hidden = false;
  crumbsEl.textContent = "";
  detailTitle.textContent = "";
  detailActions.replaceChildren();
  detailText.textContent = "";
  detailText.hidden = true;
  detailFields.replaceChildren();
  detailFields.hidden = true;
  detailLinks.replaceChildren();
  detailLinks.hidden = true;
}

// ---------- 保存済み一覧 ----------

async function loadPlans() {
  const rows = await api<PlanRow[]>("/api/plans");
  plansEl.replaceChildren(...rows.map(renderPlanRow));
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "まだありません";
    plansEl.append(li);
  }
}

function stageLabel(p: PlanRow): string {
  if (p.stage === "story") return p.chosen_path != null ? `決定済 道${p.chosen_path + 1}` : "決定済";
  return p.stage === "enriched" ? "深掘り済" : "道のみ";
}

function renderPlanRow(p: PlanRow): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.id = String(p.id);
  if (current?.plan.id === p.id) li.classList.add("active");
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = p.title;
  title.title = p.kgi;
  const meta = document.createElement("span");
  meta.className = "meta";
  const badge = document.createElement("span");
  badge.className = `badge ${p.stage}`;
  badge.textContent = stageLabel(p);
  const date = document.createElement("span");
  date.className = "date";
  date.textContent = fmtDate(p.updated_at);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "del";
  del.textContent = "×";
  del.title = "削除";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`「${p.title}」を削除しますか？`)) return;
    try {
      await api(`/api/plans/${p.id}`, { method: "DELETE" });
      if (current?.plan.id === p.id) {
        current = null;
        view.clear();
        story.clear();
        calendar.clear();
        growth.clear();
        setTab("tree");
        emptyEl.hidden = false;
        clearDetail();
        setBusy(false);
      }
      await loadPlans();
    } catch (err) {
      setStatus(errMsg(err), true);
    }
  });
  meta.append(badge, date, del);
  li.append(title, meta);
  li.addEventListener("click", () => void openPlan(p.id));
  return li;
}

function highlightPlan(id: number) {
  for (const li of plansEl.querySelectorAll("li")) li.classList.toggle("active", li.dataset.id === String(id));
}

async function openPlan(id: number) {
  if (busy) return;
  try {
    current = await api<PlanResponse>(`/api/plans/${id}`);
    const p = current.plan;
    field<HTMLTextAreaElement>("kgi").value = p.kgi;
    field<HTMLTextAreaElement>("context").value = p.context;
    field<HTMLInputElement>("n_paths").value = String(p.n_paths);
    field<HTMLInputElement>("horizon_years").value = String(p.horizon_years);
    field<HTMLInputElement>("model").value = p.model ?? "";
    mbtiSelect.value = current.doc.mbti ?? "";
    show(current);
    setStatus(`#${p.id} を開きました（${fmtDate(p.updated_at)} 保存）`);
    setBusy(false);
  } catch (e) {
    setStatus(errMsg(e), true);
  }
}

// ---------- 配線 ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void generate("paths");
});
enrichBtn.addEventListener("click", () => void generate("enrich"));
fullBtn.addEventListener("click", () => void generate("full"));
downloadBtn.addEventListener("click", () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current.doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kgi-${current.plan.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
for (const tname of MBTI_TYPES) {
  const o = document.createElement("option");
  o.value = tname;
  o.textContent = tname;
  mbtiSelect.append(o);
}
mbtiSelect.addEventListener("change", () => setBusy(busy));
fitBtn.addEventListener("click", () => void fitPaths());
tabTree.addEventListener("click", () => setTab("tree"));
tabStory.addEventListener("click", () => setTab("story"));
tabCalendar.addEventListener("click", () => setTab("calendar"));
tabGrowth.addEventListener("click", () => setTab("growth"));
$<HTMLButtonElement>("fit").addEventListener("click", () => view.fit());
$<HTMLButtonElement>("expand").addEventListener("click", () => view.expandAll());
$<HTMLButtonElement>("collapse").addEventListener("click", () => view.collapseAll());

fetch("/api/health")
  .then((r) => r.json())
  .then((h: { ok?: boolean; claude?: boolean }) => {
    healthEl.textContent = h.claude ? "claude CLI: OK" : "claude CLI が見つかりません";
    healthEl.classList.toggle("error", !h.claude);
  })
  .catch(() => {
    healthEl.textContent = "サーバに接続できません";
    healthEl.classList.add("error");
  });

clearDetail();
setTab("tree");
setBusy(false);
void loadPlans().catch((e) => setStatus(errMsg(e), true));
