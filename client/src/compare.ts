import type { Path, PlanDoc } from "./types";

// 比較タブ: 列が道、行が 概要・バリュー・MBTI・難しさ・共通 KPI ごとの見込み。
// 共通 KPI があるので、道ごとに言い換えた KGI ではなく同じ物差しで比べられる。

export type CompareRow = { label: string; note?: string; cells: string[]; subs?: string[]; kind: "summary" | "value" | "kpi" };
export type CompareTable = { paths: string[]; rows: CompareRow[] };

const FIT_MARK = { match: "○", neutral: "△", conflict: "×" } as const;

function summaryOf(p: Path): string {
  const r = p as Record<string, unknown>;
  for (const k of ["one_liner", "thesis", "summary", "strategy"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const withReason = (head: string, reason?: string) => (head ? `${head}${reason ? ` — ${reason}` : ""}` : "");

export function compareTable(doc: PlanDoc): CompareTable {
  const paths = doc.paths ?? [];
  if (!paths.length) return { paths: [], rows: [] };
  const rows: CompareRow[] = [
    { label: "概要", kind: "summary", cells: paths.map(summaryOf) },
    { label: "バリュー", kind: "value", cells: paths.map((p) => withReason(p.values_fit?.rank ?? "", p.values_fit?.summary)) },
    ...(doc.mvv?.values ?? []).map((v): CompareRow => ({
      label: `・${v.name}`,
      kind: "value",
      cells: paths.map((p) => {
        const it = p.values_fit?.items.find((x) => x.value === v.name);
        return it ? `${FIT_MARK[it.fit] ?? "△"}${it.reason ? ` ${it.reason}` : ""}` : "";
      }),
    })),
    { label: "MBTI", kind: "summary", cells: paths.map((p) => withReason(p.mbti_fit?.rank ?? "", p.mbti_fit?.reason)) },
    { label: "難しさ", kind: "summary", cells: paths.map((p) => withReason(p.difficulty ? `★${p.difficulty.overall}` : "", p.difficulty?.wall)) },
    ...(doc.kpi_tree?.kpis ?? []).map((k): CompareRow => {
      const last = k.targets[k.targets.length - 1];
      const plans = paths.map((p) => p.kpi_plan?.find((x) => x.kpi_id === k.id));
      return {
        label: `${k.id} ${k.name}`,
        note: last ? `目標 ${last.value}（${last.at}）` : undefined,
        kind: "kpi",
        cells: plans.map((x) => x?.target ?? ""),
        subs: plans.map((x) => x?.how ?? ""),
      };
    }),
  ];
  return { paths: paths.map((p, i) => `${i + 1}. ${p.name}`), rows: rows.filter((r) => r.cells.some(Boolean)) };
}

export type CompareHandlers = { onChoose: (index: number) => void };

export class CompareView {
  constructor(private host: HTMLElement, private h: CompareHandlers) {}

  clear() {
    this.host.replaceChildren();
  }

  render(doc: PlanDoc | null, busy: boolean) {
    const t = doc ? compareTable(doc) : { paths: [], rows: [] };
    if (!t.paths.length) {
      this.host.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "道を出すと、ここで道を同じ物差しで比べられます。" }));
      return;
    }
    const table = document.createElement("table");
    table.className = "cmp";
    const head = table.createTHead().insertRow();
    head.append(document.createElement("th"));
    t.paths.forEach((name, i) => {
      const th = document.createElement("th");
      th.textContent = name;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      const hasStory = !!doc?.paths?.[i]?.story_map;
      btn.textContent = hasStory ? "ストーリーマップを見る" : "この道で進める";
      btn.disabled = busy;
      btn.addEventListener("click", () => this.h.onChoose(i));
      th.append(document.createElement("br"), btn);
      head.append(th);
    });
    const body = table.createTBody();
    for (const r of t.rows) {
      const tr = body.insertRow();
      tr.className = `cmp-${r.kind}`;
      const th = document.createElement("th");
      th.textContent = r.label;
      if (r.note) th.append(Object.assign(document.createElement("div"), { className: "cmp-note", textContent: r.note }));
      tr.append(th);
      r.cells.forEach((c, i) => {
        const td = tr.insertCell();
        td.textContent = c;
        const sub = r.subs?.[i];
        if (sub) td.append(Object.assign(document.createElement("div"), { className: "cmp-sub", textContent: sub }));
      });
    }
    this.host.replaceChildren(table);
  }
}
