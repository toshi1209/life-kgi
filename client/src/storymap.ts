import type { Learning, LearningItem, StoryCard, StoryLane, StoryMap, StoryPhase } from "./types";

export const LANES: { key: StoryLane; label: string }[] = [
  { key: "do", label: "行動" },
  { key: "learn", label: "学習" },
  { key: "prove", label: "証明・実績" },
  { key: "measure", label: "指標" },
];

export function laneLabel(key: string): string {
  return LANES.find((l) => l.key === key)?.label ?? key;
}

/** フェーズ×レーンごとのカード。90 日以内のものを先頭に、次に優先度順。 */
export function cellsOf(map: StoryMap): Map<string, StoryCard[]> {
  const m = new Map<string, StoryCard[]>();
  for (const c of map.cards) {
    const k = `${c.phase}:${c.lane}`;
    const arr = m.get(k) ?? [];
    arr.push(c);
    m.set(k, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => Number(b.first_90_days) - Number(a.first_90_days) || a.priority - b.priority);
  return m;
}

/** 教材が取れなかったときのフォールバック検索リンク */
export function searchLinks(skill: string): { label: string; url: string }[] {
  const q = encodeURIComponent(skill);
  return [
    { label: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(`${skill} 学習 入門`)}` },
    { label: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
    { label: "Udemy", url: `https://www.udemy.com/courses/search/?q=${q}` },
    { label: "Amazon 書籍", url: `https://www.amazon.co.jp/s?k=${q}&i=stripbooks` },
  ];
}

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 学習カードに対応する教材。skill の完全一致、無ければ部分一致。 */
export function learningFor(learning: Learning | undefined, card: StoryCard): LearningItem | undefined {
  if (!learning?.items?.length) return undefined;
  const key = norm(card.skill || card.title);
  if (!key) return undefined;
  return (
    learning.items.find((it) => norm(it.skill) === key) ??
    learning.items.find((it) => {
      const s = norm(it.skill);
      return s.length >= 2 && (key.includes(s) || s.includes(key));
    })
  );
}

export type LearningState = "idle" | "loading" | "error" | "done";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const TYPE_LABEL: Record<string, string> = { official: "公式", course: "講座", book: "書籍", video: "動画", community: "コミュニティ", article: "記事" };
const COST_LABEL: Record<string, string> = { free: "無料", paid: "有料", mixed: "一部有料" };

/** 教材リンクの <ul>。resources が無ければ検索リンクを出す。 */
export function resourceList(item: LearningItem | undefined, skill: string): HTMLUListElement {
  const ul = el("ul", "links");
  const resources = item?.resources ?? [];
  if (resources.length) {
    for (const r of resources) {
      const li = el("li");
      const a = el("a");
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = r.title || r.url;
      li.append(a);
      const meta = [r.type && (TYPE_LABEL[r.type] ?? r.type), r.cost && (COST_LABEL[r.cost] ?? r.cost), r.language === "en" ? "英語" : r.language === "ja" ? "日本語" : r.language]
        .filter(Boolean)
        .join(" · ");
      if (meta) li.append(el("span", "meta", meta));
      if (r.why) li.append(el("div", "why", r.why));
      ul.append(li);
    }
  } else {
    const li = el("li", "fallback", "検索リンク: ");
    searchLinks(skill).forEach((l, i) => {
      const a = el("a");
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = l.label;
      if (i) li.append(document.createTextNode(" / "));
      li.append(a);
    });
    ul.append(li);
  }
  return ul;
}

export type StoryMapHandlers = {
  onCard: (card: StoryCard, phase: StoryPhase) => void;
  onPhase: (phase: StoryPhase, index: number) => void;
  onFetchLearning: () => void;
};

/** フェーズ×レーンのカード盤と、その下の「必要な学習と教材」 */
export class StoryMapView {
  private selectedTitle: string | null = null;

  constructor(private host: HTMLElement, private h: StoryMapHandlers) {}

  clear(): void {
    this.host.replaceChildren();
  }

  /** 学習カードの進捗（skill → 完了/全セッション）。カレンダーの完了から計算して渡す */
  private progress: Map<string, { done: number; total: number }> = new Map();

  setProgress(progress: Map<string, { done: number; total: number }>): void {
    this.progress = progress;
  }

  render(map: StoryMap, learning: Learning | undefined, state: LearningState, error?: string): void {
    const cells = cellsOf(map);
    const wrap = el("div", "sm");
    const grid = el("div", "sm-grid");
    grid.style.gridTemplateColumns = `104px repeat(${map.phases.length}, 260px)`;
    grid.append(el("div", "sm-corner", "フェーズ →"));
    map.phases.forEach((p, i) => {
      const h = el("div", "sm-phase");
      h.append(el("div", "sm-phase-name", `${i + 1}. ${p.name}`));
      if (p.period) h.append(el("div", "sm-phase-period", p.period));
      if (p.goal) h.append(el("div", "sm-phase-goal", p.goal));
      h.title = p.story ?? "";
      h.addEventListener("click", () => this.h.onPhase(p, i));
      grid.append(h);
    });
    for (const lane of LANES) {
      grid.append(el("div", `sm-lane lane-${lane.key}`, lane.label));
      map.phases.forEach((p, i) => {
        const cell = el("div", `sm-cell lane-${lane.key}`);
        for (const c of cells.get(`${i}:${lane.key}`) ?? []) {
          const card = el("div", `sm-card lane-${lane.key}${c.first_90_days ? " f90" : ""}${this.selectedTitle === c.title ? " selected" : ""}`);
          card.append(el("div", "sm-card-title", c.title));
          const chips = el("div", "sm-chips");
          if (c.first_90_days) chips.append(el("span", "chip f90", "90日以内"));
          if (lane.key === "learn") {
            const it = learningFor(learning, c);
            chips.append(el("span", "chip learn", it?.resources.length ? `教材 ${it.resources.length}` : state === "loading" ? "教材 取得中" : "教材"));
            const pr = this.progress.get(c.skill || c.title);
            if (pr?.total) {
              const complete = pr.done >= pr.total;
              chips.append(el("span", `chip progress${complete ? " complete" : ""}`, complete ? "完了" : `完了 ${pr.done}/${pr.total}`));
              if (complete) card.classList.add("complete");
            }
          }
          if (chips.childElementCount) card.append(chips);
          card.title = c.detail ?? "";
          card.addEventListener("click", () => {
            this.selectedTitle = c.title;
            for (const n of this.host.querySelectorAll(".sm-card.selected")) n.classList.remove("selected");
            card.classList.add("selected");
            this.h.onCard(c, p);
          });
          cell.append(card);
        }
        grid.append(cell);
      });
    }
    wrap.append(grid, this.renderLearning(map, learning, state, error));
    this.host.replaceChildren(wrap);
  }

  private renderLearning(map: StoryMap, learning: Learning | undefined, state: LearningState, error?: string): HTMLElement {
    const sec = el("section", "sm-learning");
    sec.append(el("h2", undefined, "必要な学習と教材"));
    const learnCards = map.cards.filter((c) => c.lane === "learn");
    if (!learnCards.length) {
      sec.append(el("p", "empty", "この道に学習カードはありません。"));
      return sec;
    }
    const status = el("p", "sm-learning-status");
    if (state === "loading") status.textContent = "WebSearch で教材を調べています（1〜3 分かかります）…";
    else if (state === "error") {
      status.textContent = `教材の取得に失敗: ${error ?? ""}`;
      status.classList.add("error");
    } else if (state === "idle") status.textContent = "教材はまだ取得していません。";
    if (state !== "loading") {
      const btn = el("button", "secondary", state === "done" ? "教材を再取得" : "教材を取得");
      btn.type = "button";
      btn.addEventListener("click", () => this.h.onFetchLearning());
      status.append(document.createTextNode(" "), btn);
    }
    sec.append(status);

    const seen = new Set<string>();
    for (const c of learnCards) {
      const skill = c.skill || c.title;
      if (seen.has(skill)) continue;
      seen.add(skill);
      const item = learningFor(learning, c);
      const box = el("div", "sm-item");
      box.append(el("h3", undefined, item?.level ? `${skill}（${item.level}）` : skill));
      if (item?.why) box.append(el("p", "why", item.why));
      else if (c.detail) box.append(el("p", "why", c.detail));
      box.append(resourceList(item, skill));
      sec.append(box);
    }
    return sec;
  }
}
