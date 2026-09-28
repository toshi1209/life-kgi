import { kgiProblems } from "../../src/kgi.ts";
import type { CommonKpi, KgiSpec, Mvv, MvvAnswer, PlanDoc } from "./types";

// 土台タブ: ① MVV（質問シート → 候補 3 案 → 直して確定）② KGI（候補 3 案 or 自分で書く）③ 共通 KPI。
// 下書き（回答・編集中の MVV / KGI）はこのクラスが持ち、再描画しても消えない。API は main.ts が呼ぶ。

export const MVV_QUESTIONS = [
  "時間を忘れて没頭したこと（仕事でも遊びでも）",
  "人に感謝されて一番うれしかった場面",
  "見ていて許せないこと・もどかしいこと",
  "お金の心配がなかったら、何に時間を使う？",
  "10年後、身近な人に何と言われていたい？",
  "譲れない生き方・働き方",
  "いま思っているミッションの一文（あれば）",
];

export type FoundationHandlers = {
  onMvvCandidates: (answers: MvvAnswer[]) => Promise<boolean>;
  onConfirmMvv: (mvv: Mvv) => Promise<boolean>;
  onKgiCandidates: () => Promise<boolean>;
  onConfirmKgi: (kgi: KgiSpec) => Promise<boolean>;
  onKpis: () => Promise<boolean>;
  onPaths: () => void;
  onDuplicate: () => void;
};

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c) e.append(c);
  return e;
}
const text = (tag: keyof HTMLElementTagNameMap, cls: string, s: string) => el(tag, cls, s);
const hint = (s: string) => text("p", "fd-hint", s);

const emptyKgi = (): KgiSpec => ({ statement: "", metric: "", target: "", deadline: "", how_to_measure: "", why: "" });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function stripConfirmed<T extends object>(v: T): T {
  const { confirmed_at: _c, ...rest } = v as T & { confirmed_at?: string };
  return rest as T;
}

export class FoundationView {
  private answers: string[] = MVV_QUESTIONS.map(() => "");
  private mvvDraft: Mvv | null = null;
  private kgiDraft: KgiSpec | null = null;
  /** MVV を確定したあとで、質問からやり直すとき */
  private sheetOpen = false;
  /** KGI を確定したあとで、候補から選び直すとき */
  private kgiOpen = false;
  private skipMvv = false;
  private last: { doc: PlanDoc | null; busy: boolean } = { doc: null, busy: false };

  constructor(private host: HTMLElement, private h: FoundationHandlers) {}

  /** 別のプランを開いた・新しく始めたときに下書きを捨てる */
  reset(doc: PlanDoc | null) {
    this.answers = MVV_QUESTIONS.map((q) => doc?.mvv_answers?.find((a) => a.q === q)?.a ?? "");
    this.mvvDraft = null;
    this.kgiDraft = null;
    this.sheetOpen = false;
    this.kgiOpen = false;
    this.skipMvv = false;
  }

  render(doc: PlanDoc | null, busy: boolean) {
    this.last = { doc, busy };
    const d: PlanDoc = doc ?? {};
    const locked = !!d.paths?.length;
    if (locked && !d.mvv && !d.kgi_spec) {
      this.host.replaceChildren(
        el("div", "fd", text("p", "fd-note", `このプランは MVV・KGI・KPI なしで作りました（KGI: ${d.kgi ?? ""}）。土台から決めるなら、左の「新しく始める」からどうぞ。`)),
      );
      return;
    }
    const root = el("div", "fd", hint("① MVV → ② KGI → ③ KPI の順に決めます。KPI は全部の道で共通の物差しになり、道を同じ基準で比べられます。"));
    if (locked) {
      root.append(el("div", "fd-lock", "道を出したので、土台は読み取り専用です。直したいときは複製して新しいプランで。", this.button("この土台で新しいプランを始める", "secondary", () => this.h.onDuplicate())));
    }
    root.append(this.mvvSection(d, locked), this.kgiSection(d, locked), this.kpiSection(d, locked));
    this.host.replaceChildren(root);
  }

  private rerender() {
    this.render(this.last.doc, this.last.busy);
  }

  private button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = el("button", cls, label);
    b.type = "button";
    b.disabled = this.last.busy || disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  private step(title: string, state: string, done: boolean, off = false): HTMLElement {
    const sec = el("section", `fd-step${done ? " done" : ""}${off ? " off" : ""}`);
    sec.append(el("h2", "", title, text("span", "fd-state", state)));
    return sec;
  }

  // ---------- ① MVV ----------

  private mvvSection(d: PlanDoc, locked: boolean): HTMLElement {
    const sec = this.step("① MVV（ミッション・ビジョン・バリュー）", d.mvv ? "確定済み" : "未確定", !!d.mvv);
    if (d.mvv) sec.append(mvvCard(d.mvv, true));
    if (locked) return sec;
    if (d.mvv && !this.mvvDraft) {
      sec.append(el("div", "fd-row",
        this.button("直す", "secondary", () => { this.mvvDraft = stripConfirmed(clone(d.mvv!)); this.rerender(); }),
        this.button(this.sheetOpen ? "質問を閉じる" : "質問からやり直す", "secondary", () => { this.sheetOpen = !this.sheetOpen; this.rerender(); }),
      ));
    }
    if (!d.mvv || this.sheetOpen) {
      sec.append(this.sheet());
      const actions = el("div", "fd-row", this.button("MVV の候補を出す（1 分ほど）", "", () => void this.h.onMvvCandidates(this.collectAnswers())));
      if (!d.mvv && !d.kgi_spec && !this.skipMvv) {
        actions.append(this.button("MVV を飛ばして KGI を自分で書く", "secondary", () => { this.skipMvv = true; this.kgiDraft ??= emptyKgi(); this.rerender(); }));
      }
      sec.append(actions, hint("答えるのは一部だけでも大丈夫です。左の「前提・状況」も材料に使います。"));
      if (d.mvv_candidates?.length) {
        sec.append(el("div", "fd-cands", ...d.mvv_candidates.map((c, i) => {
          const card = mvvCard(c, false, `案 ${i + 1}`);
          card.append(this.button("これを使う", "", () => { this.mvvDraft = clone(c); this.rerender(); }));
          return card;
        })));
      }
    }
    if (this.mvvDraft) sec.append(this.mvvForm(d));
    return sec;
  }

  private sheet(): HTMLElement {
    const box = el("div", "fd-sheet");
    MVV_QUESTIONS.forEach((q, i) => {
      const ta = el("textarea");
      ta.value = this.answers[i] ?? "";
      ta.rows = 2;
      ta.addEventListener("input", () => { this.answers[i] = ta.value; });
      box.append(el("label", "", `${i + 1}. ${q}`, ta));
    });
    return box;
  }

  private collectAnswers(): MvvAnswer[] {
    return MVV_QUESTIONS.map((q, i) => ({ q, a: (this.answers[i] ?? "").trim() })).filter((x) => x.a);
  }

  private mvvForm(d: PlanDoc): HTMLElement {
    const m = this.mvvDraft!;
    const form = el("div", "fd-form", text("h3", "", "MVV を直して確定"));
    const mission = el("input");
    mission.value = m.mission;
    mission.placeholder = "例: 目の前の人がワクワクする物をつくる";
    mission.addEventListener("input", () => { m.mission = mission.value; });
    const vision = el("textarea");
    vision.value = m.vision;
    vision.rows = 2;
    vision.addEventListener("input", () => { m.vision = vision.value; });
    form.append(el("label", "", "ミッション（何のために動くか・動詞で終わる 1 文）", mission), el("label", "", "ビジョン（何年後にどんな状態でいたいか）", vision));
    const values = el("div", "fd-values", text("span", "fd-hint", "バリュー（迷ったときの判断基準）: 名前 / 意味 / 守れているとき毎週の行動で何が見えるか"));
    m.values.forEach((v, i) => {
      const name = el("input");
      name.value = v.name;
      name.placeholder = "名前";
      name.addEventListener("input", () => { v.name = name.value; });
      const meaning = el("input");
      meaning.value = v.meaning ?? "";
      meaning.placeholder = "意味";
      meaning.addEventListener("input", () => { v.meaning = meaning.value; });
      const behavior = el("input");
      behavior.value = v.behavior ?? "";
      behavior.placeholder = "毎週の行動";
      behavior.addEventListener("input", () => { v.behavior = behavior.value; });
      values.append(el("div", "fd-value", name, meaning, behavior, this.button("×", "secondary", () => { m.values.splice(i, 1); this.rerender(); })));
    });
    values.append(el("div", "fd-row", this.button("＋ バリューを足す", "secondary", () => { m.values.push({ name: "" }); this.rerender(); }, m.values.length >= 7)));
    form.append(values, el("div", "fd-row",
      this.button("MVV を確定", "", () => void this.confirmMvv(d)),
      this.button("やめる", "secondary", () => { this.mvvDraft = null; this.rerender(); }),
    ));
    return form;
  }

  private async confirmMvv(d: PlanDoc) {
    const m = this.mvvDraft;
    if (!m) return;
    if (d.kgi_spec && !confirm("MVV を変えると、KGI と KPI は消えて作り直しになります。よいですか？")) return;
    const cleaned: Mvv = {
      mission: m.mission.trim(),
      vision: m.vision.trim(),
      values: m.values.map((v) => ({ name: v.name.trim(), meaning: v.meaning?.trim() || undefined, behavior: v.behavior?.trim() || undefined })).filter((v) => v.name),
      ...(m.grounds ? { grounds: m.grounds } : {}),
    };
    if (await this.h.onConfirmMvv(cleaned)) {
      this.mvvDraft = null;
      this.sheetOpen = false;
      this.rerender();
    }
  }

  // ---------- ② KGI ----------

  private kgiSection(d: PlanDoc, locked: boolean): HTMLElement {
    const enabled = !!d.mvv || this.skipMvv || !!d.kgi_spec;
    const sec = this.step("② KGI（測れる最終成果指標）", d.kgi_spec ? "確定済み" : "未確定", !!d.kgi_spec, !enabled);
    if (!enabled) {
      sec.append(hint("先に MVV を確定してください。"));
      return sec;
    }
    if (d.kgi_spec) sec.append(kgiCard(d.kgi_spec, true));
    if (locked) return sec;
    if (d.kgi_spec && !this.kgiDraft) {
      sec.append(el("div", "fd-row",
        this.button("直す", "secondary", () => { this.kgiDraft = stripConfirmed(clone(d.kgi_spec!)); this.rerender(); }),
        this.button(this.kgiOpen ? "候補を閉じる" : "候補から選び直す", "secondary", () => { this.kgiOpen = !this.kgiOpen; this.rerender(); }),
      ));
    }
    if (!d.kgi_spec || this.kgiOpen) {
      const actions = el("div", "fd-row", this.button("KGI の候補を出す（1 分ほど）", "", () => void this.h.onKgiCandidates(), !d.mvv));
      if (!this.kgiDraft) actions.append(this.button("自分で書く", "secondary", () => { this.kgiDraft = emptyKgi(); this.rerender(); }));
      sec.append(actions);
      if (!d.mvv) sec.append(hint("MVV を飛ばしたので、KGI は自分で書きます（候補は MVV から作るため出せません）。"));
      if (d.kgi_candidates?.length) {
        sec.append(el("div", "fd-cands", ...d.kgi_candidates.map((c, i) => {
          const card = kgiCard(c, false, `案 ${i + 1}`);
          card.append(this.button("これを使う", "", () => { this.kgiDraft = clone(c); this.rerender(); }));
          return card;
        })));
      }
    }
    if (this.kgiDraft) sec.append(this.kgiForm(d));
    return sec;
  }

  private kgiForm(d: PlanDoc): HTMLElement {
    const k = this.kgiDraft!;
    const form = el("div", "fd-form", text("h3", "", "KGI を直して確定"));
    const problems = el("ul", "fd-problems");
    const confirmBtn = this.button("KGI を確定", "", () => void this.confirmKgi(d));
    const refresh = () => {
      const ps = kgiProblems(k);
      problems.replaceChildren(...ps.map((p) => text("li", "", p)));
      problems.hidden = ps.length === 0;
      confirmBtn.disabled = this.last.busy || ps.length > 0;
    };
    const field = (key: keyof KgiSpec, label: string, placeholder: string, kind: "input" | "textarea" | "month" = "input") => {
      const input = kind === "textarea" ? el("textarea") : el("input");
      if (input instanceof HTMLInputElement && kind === "month") input.type = "month";
      input.value = k[key] ?? "";
      input.placeholder = placeholder;
      input.addEventListener("input", () => { k[key] = input.value; refresh(); });
      form.append(el("label", "", label, input));
    };
    field("statement", "KGI の一文（〜までに、〜が〜になっている）", "例: 2031年9月までに、自分が作った物で笑った人を年1,000人その場で見ている", "textarea");
    field("metric", "何を数えるか", "例: 自分が作った物に触れて笑った・声を出した人の数（その場で数えた分だけ）");
    field("target", "目標値（数字と単位）", "例: 年 1,000 人");
    field("deadline", "期限（YYYY-MM）", "例: 2031-09", "month");
    field("how_to_measure", "測り方（誰が・いつ・何で数えるか）", "例: 展示や試遊のたびに自分で数え、月末に集計する", "textarea");
    field("why", "ビジョンとのつながり（任意）", "例: ビジョンの『作った物の前で人が笑っている』を数で確かめる");
    form.append(problems, el("div", "fd-row", confirmBtn, this.button("やめる", "secondary", () => { this.kgiDraft = null; this.rerender(); })));
    refresh();
    return form;
  }

  private async confirmKgi(d: PlanDoc) {
    const k = this.kgiDraft;
    if (!k || kgiProblems(k).length) return;
    if (d.kpi_tree && !confirm("KGI を変えると、KPI は消えて作り直しになります。よいですか？")) return;
    const cleaned: KgiSpec = {
      statement: k.statement.trim(),
      metric: k.metric.trim(),
      target: k.target.trim(),
      deadline: k.deadline.trim(),
      how_to_measure: k.how_to_measure.trim(),
      ...(k.why?.trim() ? { why: k.why.trim() } : {}),
    };
    if (await this.h.onConfirmKgi(cleaned)) {
      this.kgiDraft = null;
      this.kgiOpen = false;
      this.rerender();
    }
  }

  // ---------- ③ KPI ----------

  private kpiSection(d: PlanDoc, locked: boolean): HTMLElement {
    const t = d.kpi_tree;
    const sec = this.step("③ KPI（全部の道で共通）", t ? `${t.kpis.length} 個` : "未作成", !!t, !d.kgi_spec);
    if (!d.kgi_spec) {
      sec.append(hint("先に KGI を確定してください。"));
      return sec;
    }
    if (t) {
      if (t.formula) sec.append(el("p", "fd-formula", text("span", "fd-hint", "KGI の分解: "), t.formula));
      sec.append(kpiTable(t.kpis));
    }
    if (locked) {
      sec.append(hint("道はツリーと比較タブに出ています。"));
      return sec;
    }
    sec.append(el("div", "fd-row", this.button(t ? "KPI を作り直す（1 分ほど）" : "KPI を出す（1 分ほど）", t ? "secondary" : "", () => void this.h.onKpis())));
    if (t) {
      sec.append(
        el("div", "fd-row", this.button("この KPI で道を出す", "fd-go", () => this.h.onPaths())),
        hint("道の数・MBTI・前提は左のフォームの値を使います。道が出たら、続けてバリューとの合い具合を出します。"),
      );
    }
    return sec;
  }
}

// ---------- 表示だけの部品 ----------

function mvvCard(m: Mvv, confirmed: boolean, label?: string): HTMLElement {
  const card = el("div", `fd-card${confirmed ? " confirmed" : ""}`);
  if (label) card.append(text("span", "k", label));
  card.append(text("span", "k", "ミッション"), text("span", "big", m.mission), text("span", "k", "ビジョン"), text("span", "", m.vision), text("span", "k", "バリュー"));
  card.append(el("ul", "", ...m.values.map((v) => el("li", "", el("b", "", v.name), v.meaning ? ` — ${v.meaning}` : "", v.behavior ? el("div", "sub", `行動: ${v.behavior}`) : null))));
  if (m.grounds) card.append(text("span", "sub", `根拠: ${m.grounds}`));
  return card;
}

function kgiCard(k: KgiSpec, confirmed: boolean, label?: string): HTMLElement {
  const card = el("div", `fd-card${confirmed ? " confirmed" : ""}`);
  if (label) card.append(text("span", "k", label));
  card.append(text("span", "big", k.statement));
  const rows: [string, string | undefined][] = [
    ["何を数えるか", k.metric],
    ["目標", `${k.target}（${k.deadline} まで）`],
    ["測り方", k.how_to_measure],
    ["ビジョンとのつながり", k.why],
  ];
  for (const [key, v] of rows) if (v) card.append(el("div", "", text("span", "k", `${key}: `), v));
  return card;
}

function kpiTable(kpis: CommonKpi[]): HTMLElement {
  const table = el("table", "fd-kpis");
  const head = table.createTHead().insertRow();
  for (const hd of ["ID", "KPI", "種類", "頻度", "目標", "定義・測り方"]) head.append(text("th", "", hd));
  const body = table.createTBody();
  for (const k of kpis) {
    const tr = body.insertRow();
    tr.insertCell().textContent = k.id;
    const name = tr.insertCell();
    name.append(el("b", "", k.name));
    if (k.why) name.append(el("div", "fd-hint", k.why));
    tr.insertCell().textContent = k.kind === "lagging" ? "結果" : "先行";
    tr.insertCell().textContent = k.cadence ?? "";
    tr.insertCell().textContent = k.targets.map((t) => `${t.at}: ${t.value}`).join("\n");
    const def = tr.insertCell();
    if (k.definition) def.append(el("div", "", k.definition));
    if (k.how_to_measure) def.append(el("div", "fd-hint", `測り方: ${k.how_to_measure}`));
  }
  return table;
}
