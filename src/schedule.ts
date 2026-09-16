/** 学習セッションを空き枠に配置する純粋な関数群。日付はすべてローカルの YYYY-MM-DD / HH:MM。 */

export type StudyWindow = { dow: number; start: string; end: string }; // dow: 0=日 … 6=土
export type StudySettings = {
  start_date: string;
  weekly_max_hours: number;
  session_max_minutes: number;
  windows: StudyWindow[];
};
export type SessionTemplate = {
  id: string;
  skill: string;
  title: string;
  minutes: number;
  resource_title?: string;
  resource_url?: string;
  what?: string;
};
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

const MIN_CHUNK = 30;
const MAX_DAYS = 730;

export function pad2(n: number): string {
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
export function dowOf(s: string): number {
  return parseDate(s).getDay();
}
/** 月曜始まりの週の先頭日 */
export function weekStart(s: string): string {
  return addDays(s, -((dowOf(s) + 6) % 7));
}
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
export function fromMin(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/** 既定: 平日 21:00〜22:30、土日 10:00〜12:00、週 8 時間、1 回 90 分、開始は次の月曜 */
export function defaultSettings(now = new Date()): StudySettings {
  const today = fmtDate(now);
  const shift = (8 - dowOf(today)) % 7 || 7;
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

export function normalizeSettings(v: unknown, fallback = defaultSettings()): StudySettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number, lo: number, hi: number) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const windows = (Array.isArray(o.windows) ? o.windows : fallback.windows)
    .filter((w): w is StudyWindow => !!w && typeof w === "object" && /^\d{2}:\d{2}$/.test(String((w as StudyWindow).start)) && /^\d{2}:\d{2}$/.test(String((w as StudyWindow).end)))
    .map((w) => ({ dow: num(w.dow, 1, 0, 6), start: w.start, end: w.end }))
    .filter((w) => toMin(w.end) - toMin(w.start) >= MIN_CHUNK);
  return {
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.start_date)) ? String(o.start_date) : fallback.start_date,
    weekly_max_hours: num(o.weekly_max_hours, fallback.weekly_max_hours, 0.5, 80),
    session_max_minutes: Math.round(num(o.session_max_minutes, fallback.session_max_minutes, MIN_CHUNK, 240)),
    windows,
  };
}

/**
 * 雛形を順番どおりに窓へ詰める。窓の残りが 30 分以上なら分割して置く（端数が 30 分未満になる切り方はしない）。
 * 週の上限に達したらその週は打ち切り。730 日探しても置けない雛形は unscheduled に残す。
 */
export function allocate(templates: SessionTemplate[], settings: StudySettings): { sessions: StudySession[]; unscheduled: SessionTemplate[] } {
  const queue = templates.filter((t) => t.minutes > 0).map((t) => ({ t, remaining: t.minutes, part: 0 }));
  const placed: (StudySession & { _partsRef: { n: number } })[] = [];
  const parts = new Map<string, { n: number }>();
  const weekUsed = new Map<string, number>();
  const capMin = Math.max(MIN_CHUNK, settings.session_max_minutes);
  let date = settings.start_date;

  for (let day = 0; day < MAX_DAYS && queue.length; day++, date = addDays(date, 1)) {
    const wins = settings.windows.filter((w) => w.dow === dowOf(date)).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!wins.length) continue;
    const wk = weekStart(date);
    for (const w of wins) {
      let cursor = toMin(w.start);
      const end = toMin(w.end);
      while (queue.length && end - cursor >= MIN_CHUNK) {
        const weekLeft = Math.round(settings.weekly_max_hours * 60) - (weekUsed.get(wk) ?? 0);
        if (weekLeft < MIN_CHUNK) break;
        const head = queue[0];
        const room = Math.min(end - cursor, weekLeft, capMin);
        let take = Math.min(head.remaining, room);
        if (take < head.remaining) {
          if (take < MIN_CHUNK) break;
          const tail = head.remaining - take;
          if (tail < MIN_CHUNK) {
            take = head.remaining - MIN_CHUNK;
            if (take < MIN_CHUNK) break;
          }
        }
        head.part++;
        const ref = parts.get(head.t.id) ?? { n: 0 };
        ref.n = head.part;
        parts.set(head.t.id, ref);
        placed.push({
          id: `${head.t.id}#${head.part}`,
          template_id: head.t.id,
          skill: head.t.skill,
          title: head.t.title,
          date,
          start: fromMin(cursor),
          end: fromMin(cursor + take),
          minutes: take,
          part: head.part,
          resource_title: head.t.resource_title,
          resource_url: head.t.resource_url,
          what: head.t.what,
          _partsRef: ref,
        });
        cursor += take;
        weekUsed.set(wk, (weekUsed.get(wk) ?? 0) + take);
        head.remaining -= take;
        if (head.remaining <= 0) queue.shift();
      }
    }
  }
  const sessions: StudySession[] = placed.map(({ _partsRef, ...s }) => ({
    ...s,
    title: _partsRef.n > 1 ? `${s.title} (${s.part}/${_partsRef.n})` : s.title,
  }));
  return { sessions, unscheduled: queue.map((q) => q.t) };
}
