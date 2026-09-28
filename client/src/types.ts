import type { KgiSpec } from "../../src/kgi.ts";
export type { KgiSpec };

export type Kpi = { name: string; cadence?: string; target?: string; why?: string };

// ---- 土台（MVV → KGI → 共通 KPI）。サーバは src/foundation.ts ----
export type MvvAnswer = { q: string; a: string };
export type MvvValue = { name: string; meaning?: string; behavior?: string };
export type Mvv = { mission: string; vision: string; values: MvvValue[]; grounds?: string };
export type CommonKpi = {
  id: string;
  name: string;
  definition?: string;
  how_to_measure?: string;
  kind: "leading" | "lagging";
  cadence?: string;
  unit?: string;
  targets: { at: string; value: string }[];
  why?: string;
};
export type KpiTree = { formula?: string; kpis: CommonKpi[]; generated_at: string };
export type PathKpiPlan = { kpi_id: string; target?: string; how?: string };
export type ValueFitLevel = "match" | "neutral" | "conflict";
export type ValuesFit = { rank: "A" | "B" | "C"; items: { value: string; fit: ValueFitLevel; reason?: string }[]; summary?: string };
export type Skill = { name: string; why?: string; how_to_build?: string; proof?: string };
export type Snapshot = { year: number; scene?: string; wins?: string[]; costs?: string[]; fork?: string };
export type Path = {
  id?: string;
  name: string;
  thesis?: string;
  style?: string;
  tradeoff?: string;
  fit?: string;
  risk?: string;
  skills_kpi?: { skills?: Skill[]; kpis?: { leading?: Kpi[]; lagging?: Kpi[] }; "90_day_sprint"?: string[] };
  future?: { snapshots?: Snapshot[]; if_it_fails?: string; if_it_works?: string };
  story_map?: StoryMap;
  learning?: Learning;
  study_plan?: StudyPlan;
  mbti_fit?: MbtiFit;
  difficulty?: Difficulty;
  qa?: QaTurn[];
  kpi_plan?: PathKpiPlan[];
  values_fit?: ValuesFit;
  one_liner?: string;
  strategy?: string;
};
export type DifficultyAspect = "time" | "money" | "skill_gap" | "uncertainty" | "life_load";
export type Difficulty = { overall: number; aspects: Record<DifficultyAspect, number>; wall?: string; reason?: string };
export type QaTurn = { q: string; a: string; at: string };
export type MbtiRank = "A" | "B" | "C";
export type MbtiFit = { rank: MbtiRank; reason?: string };
export const MBTI_TYPES = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"] as const;
export type StoryLane = "do" | "learn" | "prove" | "measure";
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
export type StudyWindow = { dow: number; start: string; end: string };
export type StudySettings = { start_date: string; weekly_max_hours: number; session_max_minutes: number; windows: StudyWindow[] };
export type SessionTemplate = { id: string; skill: string; title: string; minutes: number; resource_title?: string; resource_url?: string; what?: string };
export type StudySession = {
  id: string;
  template_id: string;
  skill: string;
  title: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  part: number;
  resource_title?: string;
  resource_url?: string;
  what?: string;
};
export type StudyPlan = { settings: StudySettings; templates: SessionTemplate[]; sessions: StudySession[]; done: string[]; done_at?: Record<string, string>; unscheduled: number; generated_at: string };
export type PlanDoc = {
  kgi?: string;
  horizon_years?: number;
  paths?: Path[];
  chosen_path?: number;
  mbti?: string;
  mbti_note?: string;
  mvv_answers?: MvvAnswer[];
  mvv_candidates?: Mvv[];
  mvv?: Mvv & { confirmed_at: string };
  kgi_candidates?: KgiSpec[];
  kgi_spec?: KgiSpec & { confirmed_at: string };
  kpi_tree?: KpiTree;
};
export type Payload = {
  kgi?: string;
  context: FormDataEntryValue | null;
  n_paths: number;
  horizon_years: number;
  model: string | null;
  paths_doc?: PlanDoc;
  /** 深掘り時に既存プランを更新したいとき */
  plan_id?: number;
  mbti?: string | null;
};
export type Stage = "mvv" | "kgi" | "kpi" | "paths" | "enriched" | "story";
export type PlanRow = {
  id: number;
  title: string;
  kgi: string;
  context: string;
  n_paths: number;
  horizon_years: number;
  model: string | null;
  stage: Stage;
  chosen_path: number | null;
  created_at: string;
  updated_at: string;
};
/** 生成系 POST と GET /api/plans/:id の応答 */
export type PlanResponse = { plan: PlanRow; doc: PlanDoc };
