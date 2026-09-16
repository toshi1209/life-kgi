import type { StudyPlan, StudySession, StudySettings, StudyWindow } from "./types";

export const DOW_LABELS = ["月", "火", "水", "木", "金", "土", "日"]; // 表示順（月曜始まり）
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Date#getDay の値

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
export function weekStart(s: string): string {
  return addDays(s, -((parseDate(s).getDay() + 6) % 7));
}

/** 月曜始まりで、その月を覆う週の配列（各週 7 日の YYYY-MM-DD） */
export function monthGrid(year: number, month0: number): string[][] {
  const first = fmtDate(new Date(year, month0, 1));
  const last = fmtDate(new Date(year, month0 + 1, 0));
  const weeks: string[][] = [];
  let cur = weekStart(first);
  while (cur <= last) {
    const w: string[] = [];
    for (let i = 0; i < 7; i++) w.push(addDays(cur, i));
    weeks.push(w);
    cur = addDays(cur, 7);
  }
  return weeks;
}

export function sessionsByDate(sessions: StudySession[]): Map<string, StudySession[]> {
  const m = new Map<string, StudySession[]>();
  for (const s of sessions) {
    const arr = m.get(s.date) ?? [];
    arr.push(s);
    m.set(s.date, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
  return m;
}

export function weekTotals(sessions: StudySession[]): { week: string; minutes: number }[] {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const w = weekStart(s.date);
    m.set(w, (m.get(w) ?? 0) + s.minutes);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, minutes]) => ({ week, minutes }));
}

export function defaultSettings(now = new Date()): StudySettings {
  const today = fmtDate(now);
  const shift = (8 - parseDate(today).getDay()) % 7 || 7;
  return {
    start_date: addDays(today, shift),
    weekly_max_hours: 8,
    session_max_minutes: 90,
    windows: [
      ...[1, 2, 3, 4, 5].map((dow) => ({ dow, start: "21:00", end: "22:30" })),
      { dow: 6, start: "10:00", end: "12:00" },
      { dow: 0, start: "10:00", end: "12:00" },
    ],
  };
}

export function hours(min: number): string {
  return `${Math.round((min / 60) * 10) / 10}h`;
}
function mdLabel(date: string): string {
  const d = parseDate(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export type CalendarHandlers = {
  onGenerate: (settings: StudySettings, regenerate: boolean) => void;
  onAllocate: (settings: StudySettings) => void;
  onSession: (session: StudySession, done: boolean) => void;
};
export type CalendarState = { busy: boolean; canGenerate: boolean; message?: string; error?: boolean };

/** 学習時間の設定 ＋ 月表示のカレンダー */
export class CalendarView {
  private ym: { y: number; m: number } | null = null;
  private selectedId: string | null = null;
  private settings: StudySettings | null = null;

  constructor(private host: HTMLElement, private h: CalendarHandlers) {}

  clear(): void {
    this.host.replaceChildren();
    this.ym = null;
    this.selectedId = null;
    this.settings = null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const n of this.host.querySelectorAll(".cal-chip")) n.classList.toggle("selected", (n as HTMLElement).dataset.id === id);
  }

  render(plan: StudyPlan | undefined, state: CalendarState): void {
    const settings = this.settings ?? plan?.settings ?? defaultSettings();
    this.settings = settings;
    const wrap = el("div", "cal");
    wrap.append(this.renderSettings(settings, plan, state));
    if (state.message) {
      const p = el("p", `cal-message${state.error ? " error" : ""}`, state.message);
      wrap.append(p);
    }
    if (plan?.sessions.length) wrap.append(this.renderSummary(plan), this.renderMonth(plan));
    else if (plan?.templates.length) wrap.append(el("p", "empty", "配置できるセッションがありません。時間帯の設定を見直して「再配置」してください。"));
    else wrap.append(el("p", "empty", "まだ学習計画がありません。時間帯を設定して「学習計画を作る」を押すと、AI が教材ごとの所要時間を見積もってセッションに分け、ここに配置します。"));
    this.host.replaceChildren(wrap);
  }

  private readSettings(form: HTMLElement): StudySettings {
    const q = <T extends HTMLInputElement>(name: string) => form.querySelector(`[name="${name}"]`) as T;
    const windows: StudyWindow[] = [];
    for (const dow of DOW_ORDER) {
      if (!q(`on-${dow}`).checked) continue;
      const start = q(`start-${dow}`).value;
      const end = q(`end-${dow}`).value;
      if (start && end && end > start) windows.push({ dow, start, end });
    }
    return {
      start_date: q("start_date").value || defaultSettings().start_date,
      weekly_max_hours: Number(q("weekly_max_hours").value) || 8,
      session_max_minutes: Number(q("session_max_minutes").value) || 90,
      windows,
    };
  }

  private renderSettings(settings: StudySettings, plan: StudyPlan | undefined, state: CalendarState): HTMLElement {
    const form = el("div", "cal-settings");
    const input = (label: string, name: string, type: string, value: string, attrs: Record<string, string> = {}) => {
      const l = el("label");
      l.append(document.createTextNode(label));
      const i = el("input");
      i.type = type;
      i.name = name;
      i.value = value;
      for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
      l.append(i);
      return l;
    };
    form.append(
      input("開始日", "start_date", "date", settings.start_date),
      input("週の上限（時間）", "weekly_max_hours", "number", String(settings.weekly_max_hours), { min: "0.5", max: "80", step: "0.5" }),
      input("1 回の最長（分）", "session_max_minutes", "number", String(settings.session_max_minutes), { min: "30", max: "240", step: "15" }),
    );
    const wins = el("div", "cal-windows");
    DOW_ORDER.forEach((dow, i) => {
      const w = settings.windows.find((x) => x.dow === dow);
      const box = el("div", "cal-win");
      const head = el("label", "cal-win-head");
      const on = el("input");
      on.type = "checkbox";
      on.name = `on-${dow}`;
      on.checked = !!w;
      head.append(on, document.createTextNode(` ${DOW_LABELS[i]}`));
      const s = el("input");
      s.type = "time";
      s.name = `start-${dow}`;
      s.value = w?.start ?? (dow === 0 || dow === 6 ? "10:00" : "21:00");
      const e = el("input");
      e.type = "time";
      e.name = `end-${dow}`;
      e.value = w?.end ?? (dow === 0 || dow === 6 ? "12:00" : "22:30");
      box.append(head, s, e);
      wins.append(box);
    });
    form.append(wins);
    const actions = el("div", "cal-actions");
    const mk = (label: string, cls: string, fn: () => void) => {
      const b = el("button", cls, label);
      b.type = "button";
      b.disabled = state.busy;
      b.addEventListener("click", fn);
      return b;
    };
    if (plan?.templates.length) {
      actions.append(
        mk("再配置（設定を反映）", "", () => this.h.onAllocate((this.settings = this.readSettings(form)))),
        mk("学習計画を作り直す（AI）", "secondary", () => {
          if (confirm("AI で学習計画を作り直しますか？（完了の記録は残ります）")) this.h.onGenerate((this.settings = this.readSettings(form)), true);
        }),
      );
    } else {
      const b = mk("学習計画を作る（AI・約 1 分）", "", () => this.h.onGenerate((this.settings = this.readSettings(form)), false));
      b.disabled = state.busy || !state.canGenerate;
      actions.append(b);
      if (!state.canGenerate) actions.append(el("span", "hint", "先にストーリーマップと教材が必要です"));
    }
    form.append(actions);
    return form;
  }

  private renderSummary(plan: StudyPlan): HTMLElement {
    const total = plan.sessions.reduce((a, s) => a + s.minutes, 0);
    const doneSet = new Set(plan.done ?? []);
    const doneMin = plan.sessions.filter((s) => doneSet.has(s.id)).reduce((a, s) => a + s.minutes, 0);
    const first = plan.sessions[0]?.date;
    const last = plan.sessions[plan.sessions.length - 1]?.date;
    const box = el("div", "cal-summary");
    box.append(
      el("span", undefined, `セッション ${plan.sessions.length} 件・合計 ${hours(total)}`),
      el("span", undefined, `完了 ${doneSet.size} 件（${hours(doneMin)}）`),
      el("span", undefined, first && last ? `${mdLabel(first)} 〜 ${mdLabel(last)}` : ""),
    );
    if (plan.unscheduled) box.append(el("span", "error", `未配置 ${plan.unscheduled} 件（枠が足りません）`));
    return box;
  }

  private renderMonth(plan: StudyPlan): HTMLElement {
    const today = fmtDate(new Date());
    if (!this.ym) {
      const d = parseDate(plan.sessions[0]?.date ?? today);
      this.ym = { y: d.getFullYear(), m: d.getMonth() };
    }
    const { y, m } = this.ym;
    const wrap = el("div", "cal-month");
    const nav = el("div", "cal-nav");
    const prev = el("button", "secondary", "‹");
    prev.type = "button";
    prev.addEventListener("click", () => this.shift(plan, -1));
    const next = el("button", "secondary", "›");
    next.type = "button";
    next.addEventListener("click", () => this.shift(plan, 1));
    const now = el("button", "secondary", "今日");
    now.type = "button";
    now.addEventListener("click", () => {
      const d = new Date();
      this.ym = { y: d.getFullYear(), m: d.getMonth() };
      this.rerenderMonth(plan);
    });
    nav.append(prev, el("h2", undefined, `${y} 年 ${m + 1} 月`), next, now);
    wrap.append(nav);

    const grid = el("div", "cal-grid");
    for (const l of DOW_LABELS) grid.append(el("div", "cal-dow", l));
    const byDate = sessionsByDate(plan.sessions);
    const doneSet = new Set(plan.done ?? []);
    for (const week of monthGrid(y, m)) {
      for (const date of week) {
        const d = parseDate(date);
        const cell = el("div", `cal-day${d.getMonth() !== m ? " other" : ""}${date === today ? " today" : ""}`);
        cell.append(el("div", "num", String(d.getDate())));
        for (const s of byDate.get(date) ?? []) {
          const done = doneSet.has(s.id);
          const chip = el("div", `cal-chip${done ? " done" : ""}${this.selectedId === s.id ? " selected" : ""}`, `${s.start} ${s.title}`);
          chip.dataset.id = s.id;
          chip.title = `${s.start}〜${s.end} ${s.title}（${s.skill}）`;
          chip.addEventListener("click", () => {
            this.select(s.id);
            this.h.onSession(s, done);
          });
          cell.append(chip);
        }
        grid.append(cell);
      }
    }
    wrap.append(grid);

    const weeks = el("div", "cal-weeks");
    for (const w of weekTotals(plan.sessions)) weeks.append(el("span", undefined, `${mdLabel(w.week)} 週: ${hours(w.minutes)}`));
    wrap.append(weeks);
    return wrap;
  }

  private shift(plan: StudyPlan, n: number): void {
    if (!this.ym) return;
    const d = new Date(this.ym.y, this.ym.m + n, 1);
    this.ym = { y: d.getFullYear(), m: d.getMonth() };
    this.rerenderMonth(plan);
  }

  private rerenderMonth(plan: StudyPlan): void {
    const old = this.host.querySelector(".cal-month");
    if (old) old.replaceWith(this.renderMonth(plan));
  }
}
