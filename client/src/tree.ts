import type { PlanDoc } from "./types";

export type NodeKind = "root" | "path" | "group" | "item" | "leaf";

/** 描画用の木。claude が返す JSON の形が揺れても必ずここに落とし込む。 */
export type TreeNode = {
  id: string;
  kind: NodeKind;
  /** ノードに出す短いラベル */
  label: string;
  /** 詳細パネルに出す全文（葉、または name を持つ項目） */
  text?: string;
  /** 詳細パネルに出す key/value（primitive の子） */
  fields?: [string, string][];
  /** ノード左端に出す短いバッジ（例: MBTI のおすすめ度 A/B/C） */
  badge?: string;
  children: TreeNode[];
};

const LABELS: Record<string, string> = {
  kgi: "KGI", horizon_years: "期間", paths: "道",
  thesis: "主張", style: "スタイル", tradeoff: "トレードオフ", tradeoffs: "トレードオフ", fit: "向く人", risk: "リスク", risks: "リスク",
  skills_kpi: "スキルとKPI", skills: "必要スキル", kpis: "KPI", leading: "先行KPI", lagging: "遅行KPI", "90_day_sprint": "90日スプリント",
  future: "未来シナリオ", snapshots: "断面", scene: "情景", wins: "得るもの", costs: "失うもの", fork: "分岐点",
  if_it_fails: "うまくいかない場合", if_it_works: "うまくいく場合",
  why: "なぜ", how_to_build: "身につけ方", proof: "証明", cadence: "頻度", target: "目標", name: "名前", year: "年",
  assumptions: "前提", open_questions: "未確定事項", kill_criteria: "撤退基準", phases: "フェーズ", stages: "段階",
  leading_indicators: "先行指標", comparison: "比較", recommendation: "推奨", review_cadence: "見直し頻度",
  shared_foundation: "共通基盤", confidence: "確度", capital_required: "必要資本", kgi_math: "数字の根拠",
  strategy_summary: "戦略概要", strategy_axis: "戦略軸", why_this_path: "なぜこの道か", description: "説明", summary: "概要",
  milestones: "マイルストーン", actions: "アクション", metrics: "指標", timeline: "時間軸",
  weekly: "週次", monthly: "月次", quarterly: "四半期", annual: "年次",
};

export function labelOf(key: string): string {
  return LABELS[key] ?? key;
}

const MAX_LABEL = 28;

export function short(s: string, n = MAX_LABEL): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
}

/** name / title / label / year のどれかを項目のラベルにする。使ったキーは子に出さない。 */
function itemLabel(o: Record<string, unknown>, fallback: string): { label: string; used?: string } {
  for (const k of ["name", "title", "label"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return { label: short(v), used: k };
  }
  if (o.year != null && o.year !== "") {
    const y = Number(o.year);
    return { label: Number.isFinite(y) && y <= 100 ? `${y}年後` : String(o.year), used: "year" };
  }
  return { label: fallback };
}

export function toTree(doc: PlanDoc, fallbackTitle = "KGI"): TreeNode {
  const d = doc as Record<string, unknown>;
  const kgiRaw = d.kgi;
  const title = typeof kgiRaw === "string" && kgiRaw.trim() ? kgiRaw.trim() : fallbackTitle;
  const root: TreeNode = { id: "root", kind: "root", label: short(title, 40), text: title, fields: [], children: [] };
  if (typeof d.horizon_years === "number") root.fields!.push(["期間", `${d.horizon_years} 年`]);
  const paths = Array.isArray(d.paths) ? d.paths : [];
  paths.forEach((p, i) => {
    if (isObj(p)) root.children.push(pathNode(p, i));
  });
  if (typeof d.mbti === "string" && d.mbti) {
    root.fields!.push(["MBTI", d.mbti]);
    const ranked = paths
      .map((p, i) => ({ i, rank: isObj(p) && isObj(p.mbti_fit) ? String(p.mbti_fit.rank ?? "") : "" }))
      .filter((x) => x.rank)
      .sort((a, b) => a.rank.localeCompare(b.rank));
    if (ranked.length) root.fields!.push(["おすすめ順", ranked.map((x) => `${x.rank}: 道 ${x.i + 1}`).join(" / ")]);
    if (typeof d.mbti_note === "string" && d.mbti_note) root.fields!.push(["注記", d.mbti_note]);
  }
  if (kgiRaw != null && typeof kgiRaw !== "string") root.children.push(generic(kgiRaw, "kgi", "root.kgi"));
  for (const [k, v] of Object.entries(d)) {
    if (k === "kgi" || k === "horizon_years" || k === "paths" || k === "chosen_path" || k === "mbti" || k === "mbti_note" || isEmpty(v)) continue;
    root.children.push(generic(v, k, `root.${k}`));
  }
  return root;
}

function pathNode(p: Record<string, unknown>, i: number): TreeNode {
  const { label, used } = itemLabel(p, `道 ${i + 1}`);
  const n: TreeNode = {
    id: `path${i}`,
    kind: "path",
    label: `${i + 1}. ${label}`,
    text: used && typeof p[used] === "string" ? (p[used] as string) : undefined,
    fields: [],
    children: [],
  };
  const fit = isObj(p.mbti_fit) ? p.mbti_fit : undefined;
  if (fit && typeof fit.rank === "string") {
    n.badge = fit.rank;
    n.fields!.push(["おすすめ度", `${fit.rank}${typeof fit.reason === "string" && fit.reason ? ` — ${fit.reason}` : ""}`]);
  }
  fillObject(n, p, [...(used ? [used] : []), "id", "mbti_fit"]);
  return n;
}

/** オブジェクトの各キーを子ノードにする。primitive は葉＋fields、配列/オブジェクトは generic。 */
function fillObject(n: TreeNode, o: Record<string, unknown>, skip: string[]) {
  for (const [k, v] of Object.entries(o)) {
    if (skip.includes(k) || isEmpty(v)) continue;
    if (!isObj(v) && !Array.isArray(v)) {
      n.fields!.push([labelOf(k), String(v)]);
      n.children.push(leaf(`${n.id}.${k}`, k, v));
    } else n.children.push(generic(v, k, `${n.id}.${k}`));
  }
}

function leaf(id: string, key: string, v: unknown): TreeNode {
  const text = String(v);
  return { id, kind: "leaf", label: `${labelOf(key)}: ${short(text)}`, text, children: [] };
}

/** 未知の値を再帰的に木にする。配列→グループ、オブジェクト→グループ or 項目、それ以外→葉。 */
export function generic(v: unknown, key: string, id: string): TreeNode {
  if (Array.isArray(v)) {
    const g: TreeNode = { id, kind: "group", label: `${labelOf(key)} (${v.length})`, fields: [], children: [] };
    v.forEach((x, i) => {
      const cid = `${id}[${i}]`;
      if (isObj(x)) {
        const { label, used } = itemLabel(x, `${labelOf(key)} ${i + 1}`);
        const it: TreeNode = { id: cid, kind: "item", label, text: used && typeof x[used] === "string" ? (x[used] as string) : undefined, fields: [], children: [] };
        fillObject(it, x, used ? [used] : []);
        g.children.push(it);
      } else if (Array.isArray(x)) {
        g.children.push(generic(x, `${labelOf(key)} ${i + 1}`, cid));
      } else if (!isEmpty(x)) {
        const text = String(x);
        g.fields!.push([String(i + 1), text]);
        g.children.push({ id: cid, kind: "leaf", label: short(text), text, children: [] });
      }
    });
    return g;
  }
  if (isObj(v)) {
    const g: TreeNode = { id, kind: "group", label: labelOf(key), fields: [], children: [] };
    fillObject(g, v, []);
    return g;
  }
  return leaf(id, key, v);
}
