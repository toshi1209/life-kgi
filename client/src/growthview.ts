import type { Growth, SkillGrowth, WeekProgress } from "./growth";
import { nextStage } from "./growth";
import { parseDate } from "./calendar";

const FILL = "#3987e5"; // 実績（参照パレットのダーク用 blue）
const TRACK = "#184f95"; // 計画（同一色相の暗い段）

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function h(min: number): string {
  return `${Math.round((min / 60) * 10) / 10}h`;
}
function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
function short(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** 進捗率で育つ木。段階（種→芽→若木→枝分かれ→茂る→実り）ごとに幹・枝・葉・実を増やす。 */
export function treeSvg(ratio: number, stageIndex: number): string {
  const W = 240;
  const H = 260;
  const gy = 228; // 地面
  const cx = 120;
  const parts: string[] = [];
  parts.push(`<ellipse cx="${cx}" cy="${gy + 8}" rx="88" ry="10" fill="#1a2230"/>`);
  if (stageIndex === 0) {
    parts.push(`<ellipse cx="${cx}" cy="${gy - 4}" rx="9" ry="6" fill="#8a6a3a"/>`);
  } else if (stageIndex === 1) {
    parts.push(`<path d="M${cx},${gy} C${cx},${gy - 20} ${cx - 2},${gy - 32} ${cx},${gy - 44}" stroke="#5aa06a" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    parts.push(`<ellipse cx="${cx - 12}" cy="${gy - 32}" rx="12" ry="6" fill="#3ddc97" transform="rotate(-30 ${cx - 12} ${gy - 32})"/>`);
    parts.push(`<ellipse cx="${cx + 12}" cy="${gy - 40}" rx="12" ry="6" fill="#3ddc97" transform="rotate(30 ${cx + 12} ${gy - 40})"/>`);
  } else {
    const trunkH = [0, 0, 70, 100, 118, 124][stageIndex];
    const trunkW = [0, 0, 8, 12, 14, 16][stageIndex];
    const top = gy - trunkH;
    parts.push(`<path d="M${cx - trunkW / 2},${gy} L${cx - trunkW / 3},${top} L${cx + trunkW / 3},${top} L${cx + trunkW / 2},${gy} Z" fill="#7a5a3a"/>`);
    const branches: [number, number, number, number][] =
      stageIndex >= 3
        ? [
            [cx, top + 30, cx - 48, top - 6],
            [cx, top + 20, cx + 50, top - 12],
            [cx, top + 50, cx - 34, top + 24],
            [cx, top + 44, cx + 36, top + 18],
          ]
        : [
            [cx, top + 26, cx - 34, top + 2],
            [cx, top + 18, cx + 36, top - 4],
          ];
    for (const [x1, y1, x2, y2] of branches) parts.push(`<path d="M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 - 8} ${x2},${y2}" stroke="#7a5a3a" stroke-width="${Math.max(3, trunkW / 3)}" fill="none" stroke-linecap="round"/>`);
    // 葉: 段階と進捗で数と大きさが増える
    const canopy: [number, number, number][] = [];
    const base = stageIndex >= 4 ? 30 : 20;
    const spots: [number, number][] = [
      [cx, top - 10],
      [cx - 44, top + 2],
      [cx + 46, top - 6],
      [cx - 24, top - 26],
      [cx + 26, top - 30],
      [cx - 36, top + 26],
      [cx + 38, top + 20],
      [cx, top - 44],
    ];
    const count = stageIndex >= 4 ? 8 : stageIndex === 3 ? 6 : 3;
    for (let i = 0; i < count; i++) canopy.push([spots[i][0], spots[i][1], base + (i % 3) * 6 + Math.round(ratio * 8)]);
    for (const [x, y, r] of canopy) parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${["#2f9c6a", "#3ddc97", "#35b57e"][(x + y) % 3]}" opacity="0.92"/>`);
    if (stageIndex >= 5) {
      for (const [x, y] of [[cx - 30, top - 4], [cx + 24, top - 16], [cx - 6, top - 36], [cx + 40, top + 14], [cx - 40, top + 22]]) parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="#fab219"/>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="成長の木">${parts.join("")}</svg>`;
}

/** スキル別の進捗（0〜1）のレーダー。同じ尺度の軸だけを載せる。 */
export function radarSvg(skills: SkillGrowth[]): string {
  const S = 440;
  const cx = S / 2;
  const cy = S / 2;
  const R = 110;
  const items = skills.slice(0, 8);
  const n = items.length;
  if (n < 3) return "";
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number) => [cx + R * v * Math.cos(angle(i)), cy + R * v * Math.sin(angle(i))] as const;
  const ring = (v: number) => items.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");
  const grid = [0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${ring(v)}" fill="none" stroke="#2a2f3a" stroke-width="1"/>`).join("");
  const axes = items.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#2a2f3a" stroke-width="1"/>`; }).join("");
  const poly = items.map((s, i) => pt(i, Math.max(s.ratio, 0.02)).map((x) => x.toFixed(1)).join(",")).join(" ");
  const dots = items.map((s, i) => { const [x, y] = pt(i, Math.max(s.ratio, 0.02)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${FILL}" stroke="#12151c" stroke-width="2"><title>${esc(s.skill)}: ${pct(s.ratio)}（${h(s.done)} / ${h(s.planned)}）</title></circle>`; }).join("");
  const labels = items.map((s, i) => {
    const [x, y] = pt(i, 1.15);
    const c = Math.cos(angle(i));
    const anchor = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
    // 枠内に収まるよう、左右端のラベルはさらに短く
    const maxLen = anchor === "middle" ? 10 : 6;
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(short(s.skill, maxLen))} ${pct(s.ratio)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${S} ${S}" class="gr-radar" role="img" aria-label="スキル別の進捗">${grid}${axes}<polygon points="${poly}" fill="${FILL}" fill-opacity="0.28" stroke="${FILL}" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

/** 週ごとの計画（トラック）と実績（塗り）。同一色相の 2 段階、目盛は最大値の 1 本だけ。 */
export function weeklySvg(weeks: WeekProgress[]): string {
  const W = 640;
  const H = 170;
  const padL = 36;
  const padB = 26;
  const padT = 18;
  const plotW = W - padL - 12;
  const plotH = H - padT - padB;
  const max = Math.max(60, ...weeks.map((w) => Math.max(w.planned, w.done)));
  const bw = plotW / weeks.length;
  const y = (min: number) => padT + plotH - (min / max) * plotH;
  const maxDone = Math.max(...weeks.map((w) => w.done));
  const bars = weeks.map((w, i) => {
    const x = padL + i * bw + bw * 0.18;
    const width = bw * 0.64;
    const d = parseDate(w.week);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const isLast = i === weeks.length - 1;
    const direct = w.done > 0 && (isLast || (w.done === maxDone && maxDone > 0)) ? `<text x="${(x + width / 2).toFixed(1)}" y="${(y(w.done) - 4).toFixed(1)}" text-anchor="middle" class="gr-val">${h(w.done)}</text>` : "";
    return `<g>
      <title>${label} 週: 実績 ${h(w.done)} / 計画 ${h(w.planned)}</title>
      <rect x="${x.toFixed(1)}" y="${y(w.planned).toFixed(1)}" width="${width.toFixed(1)}" height="${(padT + plotH - y(w.planned)).toFixed(1)}" rx="3" fill="${TRACK}"/>
      <rect x="${x.toFixed(1)}" y="${y(w.done).toFixed(1)}" width="${width.toFixed(1)}" height="${(padT + plotH - y(w.done)).toFixed(1)}" rx="3" fill="${FILL}"/>
      ${direct}
      ${i % 2 === 0 || isLast ? `<text x="${(x + width / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label}</text>` : ""}
    </g>`;
  }).join("");
  const gridY = y(max);
  return `<svg viewBox="0 0 ${W} ${H}" class="gr-bars" role="img" aria-label="週ごとの学習時間">
    <line x1="${padL}" y1="${gridY.toFixed(1)}" x2="${W - 12}" y2="${gridY.toFixed(1)}" stroke="#2a2f3a" stroke-dasharray="3 3"/>
    <text x="${padL - 6}" y="${(gridY + 4).toFixed(1)}" text-anchor="end">${h(max)}</text>
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - 12}" y2="${padT + plotH}" stroke="#2a2f3a"/>
    ${bars}
  </svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export class GrowthView {
  constructor(private host: HTMLElement) {}

  clear(): void {
    this.host.replaceChildren();
  }

  render(g: Growth | null): void {
    if (!g || !g.sessionCount) {
      this.host.replaceChildren(el("p", "empty", "学習計画を作ってセッションを完了にしていくと、ここに成長が表示されます。"));
      return;
    }
    const wrap = el("div", "gr");

    // 全体の成長
    const hero = el("section", "gr-hero");
    const tree = el("div", "gr-tree");
    tree.innerHTML = treeSvg(g.ratio, g.tree.index);
    const nxt = nextStage("tree", g.ratio);
    tree.append(el("div", "gr-stage", nxt ? `${g.tree.label} — 次の「${nxt.stage.label}」まであと ${h(Math.ceil(nxt.remainingRatio * g.plannedMinutes))}` : `${g.tree.label} — 計画をすべて終えました`));
    const stats = el("div", "gr-stats");
    const big = el("div", "gr-big");
    big.append(document.createTextNode(h(g.doneMinutes)));
    const small = el("small", undefined, `/ ${h(g.plannedMinutes)}（${pct(g.ratio)}）`);
    big.append(small);
    const meter = el("div", "gr-meter");
    const fill = el("i");
    fill.style.width = `${Math.round(g.ratio * 100)}%`;
    meter.append(fill);
    const kpis = el("div", "gr-kpis");
    const kpi = (v: string, label: string) => {
      const k = el("div", "gr-kpi");
      k.append(el("b", undefined, v), el("span", undefined, label));
      return k;
    };
    kpis.append(kpi(`${g.doneCount} / ${g.sessionCount}`, "完了したセッション"), kpi(`${g.streak} 日`, "連続学習"), kpi(h(g.thisWeekDone), "今週の実績"), kpi(`${g.skills.filter((s) => s.stage.index >= 3).length} / ${g.skills.length}`, "中級以上のスキル"));
    stats.append(big, meter, kpis);
    hero.append(tree, stats);
    const radar = el("div", "gr-radar-wrap");
    radar.innerHTML = radarSvg(g.skills) || `<p class="empty">スキルが 3 つ以上あるとレーダーが出ます。</p>`;
    hero.append(radar);
    wrap.append(hero);

    // スキル別
    const sec = el("section", "gr-section");
    sec.append(el("h2", undefined, "スキル別の成長"));
    for (const s of [...g.skills].sort((a, b) => b.ratio - a.ratio)) {
      const row = el("div", "gr-skill");
      row.append(el("div", "name", s.skill), el("div", "stage", s.stage.label));
      const m = el("div", "gr-meter");
      const f = el("i");
      f.style.width = `${Math.round(s.ratio * 100)}%`;
      m.append(f);
      m.title = `${s.doneSessions} / ${s.sessions} セッション`;
      row.append(m, el("div", "val", `${h(s.done)} / ${h(s.planned)}`));
      sec.append(row);
    }
    wrap.append(sec);

    // 週ごと
    const wk = el("section", "gr-section");
    wk.append(el("h2", undefined, "週ごとの学習時間（直近 12 週）"));
    const legend = el("div", "gr-legend");
    const li = (color: string, label: string) => {
      const s = el("span");
      const i = el("i");
      i.style.background = color;
      s.append(i, document.createTextNode(label));
      return s;
    };
    legend.append(li(FILL, "実績（完了にした分）"), li(TRACK, "計画"));
    const chart = el("div", "gr-bars-wrap");
    chart.innerHTML = weeklySvg(g.weekly);
    wk.append(legend, chart);
    wrap.append(wk);

    this.host.replaceChildren(wrap);
  }
}
