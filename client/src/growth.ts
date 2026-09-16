import type { StudyPlan } from "./types";
import { addDays, fmtDate, weekStart } from "./calendar";

export type Stage = { label: string; index: number; min: number };

const SKILL_STAGES: Stage[] = [
  { label: "未着手", index: 0, min: 0 },
  { label: "見習い", index: 1, min: 0.0001 },
  { label: "初級", index: 2, min: 0.25 },
  { label: "中級", index: 3, min: 0.5 },
  { label: "実務", index: 4, min: 0.75 },
  { label: "熟練", index: 5, min: 1 },
];
const TREE_STAGES: Stage[] = [
  { label: "種", index: 0, min: 0 },
  { label: "芽", index: 1, min: 0.0001 },
  { label: "若木", index: 2, min: 0.25 },
  { label: "枝分かれ", index: 3, min: 0.5 },
  { label: "茂る", index: 4, min: 0.75 },
  { label: "実り", index: 5, min: 1 },
];

function stageOf(stages: Stage[], ratio: number): Stage {
  let s = stages[0];
  for (const st of stages) if (ratio >= st.min) s = st;
  return s;
}
export function skillStage(ratio: number): Stage {
  return stageOf(SKILL_STAGES, ratio);
}
export function treeStage(ratio: number): Stage {
  return stageOf(TREE_STAGES, ratio);
}
/** 次の段階までに必要な進捗率（最終段階なら null） */
export function nextStage(stages: "skill" | "tree", ratio: number): { stage: Stage; remainingRatio: number } | null {
  const list = stages === "skill" ? SKILL_STAGES : TREE_STAGES;
  const next = list.find((s) => s.min > ratio && s.min > 0.0001);
  return next ? { stage: next, remainingRatio: next.min - ratio } : null;
}

export type SkillGrowth = { skill: string; planned: number; done: number; ratio: number; stage: Stage; sessions: number; doneSessions: number };
export type WeekProgress = { week: string; planned: number; done: number };
export type Growth = {
  plannedMinutes: number;
  doneMinutes: number;
  ratio: number;
  doneCount: number;
  sessionCount: number;
  tree: Stage;
  skills: SkillGrowth[];
  streak: number;
  thisWeekDone: number;
  weekly: WeekProgress[];
};

function localDate(iso: string): string {
  return fmtDate(new Date(iso));
}

/** done_at のローカル日付で、今日（無ければ昨日）から遡った連続日数 */
export function streakDays(doneAt: Record<string, string>, now = new Date()): number {
  const days = new Set(Object.values(doneAt).map(localDate));
  if (!days.size) return 0;
  let cur = fmtDate(now);
  if (!days.has(cur)) cur = addDays(cur, -1);
  let n = 0;
  while (days.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}

/** 直近 weeks 週（今週を含む、月曜始まり）の計画分と実績分。実績は done_at の週、無ければ予定日の週。 */
export function weeklyProgress(plan: StudyPlan, weeks = 12, now = new Date()): WeekProgress[] {
  const thisWeek = weekStart(fmtDate(now));
  const out: WeekProgress[] = [];
  const idx = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    const w = addDays(thisWeek, -7 * i);
    idx.set(w, out.length);
    out.push({ week: w, planned: 0, done: 0 });
  }
  const doneSet = new Set(plan.done ?? []);
  for (const s of plan.sessions) {
    const pi = idx.get(weekStart(s.date));
    if (pi != null) out[pi].planned += s.minutes;
    if (doneSet.has(s.id)) {
      const at = plan.done_at?.[s.id];
      const di = idx.get(weekStart(at ? localDate(at) : s.date));
      if (di != null) out[di].done += s.minutes;
    }
  }
  return out;
}

export function computeGrowth(plan: StudyPlan, now = new Date()): Growth {
  const doneSet = new Set(plan.done ?? []);
  const bySkill = new Map<string, SkillGrowth>();
  let plannedMinutes = 0;
  let doneMinutes = 0;
  let doneCount = 0;
  for (const s of plan.sessions) {
    const g = bySkill.get(s.skill) ?? { skill: s.skill, planned: 0, done: 0, ratio: 0, stage: SKILL_STAGES[0], sessions: 0, doneSessions: 0 };
    g.planned += s.minutes;
    g.sessions++;
    plannedMinutes += s.minutes;
    if (doneSet.has(s.id)) {
      g.done += s.minutes;
      g.doneSessions++;
      doneMinutes += s.minutes;
      doneCount++;
    }
    bySkill.set(s.skill, g);
  }
  const skills = [...bySkill.values()].map((g) => {
    const ratio = g.planned ? Math.min(1, g.done / g.planned) : 0;
    return { ...g, ratio, stage: skillStage(ratio) };
  });
  const ratio = plannedMinutes ? Math.min(1, doneMinutes / plannedMinutes) : 0;
  const weekly = weeklyProgress(plan, 12, now);
  return {
    plannedMinutes,
    doneMinutes,
    ratio,
    doneCount,
    sessionCount: plan.sessions.length,
    tree: treeStage(ratio),
    skills,
    streak: streakDays(plan.done_at ?? {}, now),
    thisWeekDone: weekly[weekly.length - 1]?.done ?? 0,
    weekly,
  };
}
