import { test } from "node:test";
import assert from "node:assert/strict";
import { toTree, type TreeNode } from "./tree";

function find(n: TreeNode, pred: (x: TreeNode) => boolean): TreeNode | undefined {
  if (pred(n)) return n;
  for (const c of n.children) {
    const f = find(c, pred);
    if (f) return f;
  }
  return undefined;
}
function ids(n: TreeNode, out: string[] = []): string[] {
  out.push(n.id);
  n.children.forEach((c) => ids(c, out));
  return out;
}

test("kgi が文字列なら根のラベルになり、道が子になる", () => {
  const t = toTree({ kgi: "年収1500万", horizon_years: 10, paths: [{ name: "独立", thesis: "指名される専門家になる" }, { name: "資産" }] });
  assert.equal(t.kind, "root");
  assert.equal(t.label, "年収1500万");
  assert.deepEqual(t.fields, [["期間", "10 年"]]);
  assert.equal(t.children.length, 2);
  assert.equal(t.children[0].kind, "path");
  assert.equal(t.children[0].label, "1. 独立");
  const thesis = t.children[0].children[0];
  assert.equal(thesis.kind, "leaf");
  assert.equal(thesis.label, "主張: 指名される専門家になる");
  assert.equal(thesis.text, "指名される専門家になる");
  assert.deepEqual(t.children[0].fields, [["主張", "指名される専門家になる"]]);
});

test("kgi がオブジェクトなら fallback を根ラベルにし、中身は kgi グループになる", () => {
  const t = toTree({ kgi: { statement: "S", deadline: "40歳" } as never, paths: [] }, "入力したKGI");
  assert.equal(t.label, "入力したKGI");
  const g = t.children.find((c) => c.label === "KGI");
  assert.equal(g?.kind, "group");
  assert.deepEqual(g?.fields, [["statement", "S"], ["deadline", "40歳"]]);
});

test("深掘り結果はスキル/KPI/未来のグループになり、項目は name でラベル付けされる", () => {
  const t = toTree({
    kgi: "K",
    paths: [{
      name: "A",
      skills_kpi: { skills: [{ name: "営業", why: "単価" }, { name: "会計" }], kpis: { leading: [{ name: "面談数", cadence: "月次" }] }, "90_day_sprint": ["a", "b", "c"] },
      future: { snapshots: [{ year: 1, scene: "副業開始", wins: ["実績"], costs: [] }], if_it_fails: "撤退" },
    }],
  });
  const sk = find(t, (n) => n.label === "スキルとKPI")!;
  assert.equal(sk.kind, "group");
  const skills = find(sk, (n) => n.label === "必要スキル (2)")!;
  assert.equal(skills.children[0].kind, "item");
  assert.equal(skills.children[0].label, "営業");
  assert.deepEqual(skills.children[0].fields, [["なぜ", "単価"]]);
  assert.equal(find(sk, (n) => n.label === "先行KPI (1)")!.children[0].label, "面談数");
  const sprint = find(sk, (n) => n.label === "90日スプリント (3)")!;
  assert.deepEqual(sprint.children.map((c) => c.label), ["a", "b", "c"]);
  assert.deepEqual(sprint.fields, [["1", "a"], ["2", "b"], ["3", "c"]]);
  const snap = find(t, (n) => n.label === "1年後")!;
  assert.equal(snap.kind, "item");
  assert.equal(find(snap, (n) => n.label === "得るもの (1)")!.children[0].text, "実績");
  assert.equal(find(snap, (n) => n.label.startsWith("失うもの")), undefined, "空配列は出さない");
  assert.equal(find(t, (n) => n.label === "うまくいかない場合: 撤退")!.kind, "leaf");
});

test("未知のキーも汎用ルールで描け、null/空文字は落ち、id は一意", () => {
  const t = toTree({ kgi: "K", paths: [{ name: "A", kill_criteria: ["x"], empty: "", nothing: null, meta: { score: 3 } }], zzz_extra: { a: "1" } } as never);
  const p = t.children[0];
  assert.deepEqual(p.children.map((c) => c.label), ["撤退基準 (1)", "meta"]);
  assert.equal(find(p, (n) => n.label === "score: 3")!.kind, "leaf");
  assert.equal(t.children[1].label, "zzz_extra");
  const all = ids(t);
  assert.equal(new Set(all).size, all.length);
});

test("長いラベルは省略され、全文は text に残る", () => {
  const long = "あ".repeat(80);
  const t = toTree({ kgi: long, paths: [{ name: "A", thesis: long }] });
  assert.ok(t.label.length < 45);
  assert.equal(t.text, long);
  const th = t.children[0].children[0];
  assert.ok(th.label.length < 40);
  assert.equal(th.text, long);
});

test("MBTI のおすすめ度は道ノードのバッジと詳細、根のおすすめ順になる", () => {
  const t = toTree({ kgi: "K", mbti: "INTJ", mbti_note: "参考です", paths: [{ name: "A", mbti_fit: { rank: "B", reason: "営業が多い" } }, { name: "B", mbti_fit: { rank: "A" } }] } as never);
  assert.equal(t.children[0].badges?.[0].text, "B");
  assert.deepEqual(t.children[0].fields, [["おすすめ度", "B — 営業が多い"]]);
  assert.equal(t.children[1].badges?.[0].text, "A");
  assert.ok(!t.children[0].children.some((c) => c.label.startsWith("mbti_fit")), "mbti_fit は子ノードにしない");
  assert.deepEqual(t.fields, [["MBTI", "INTJ"], ["おすすめ順", "A: 道 2 / B: 道 1"], ["注記", "参考です"]]);
  assert.ok(!t.children.some((c) => c.label === "mbti"), "mbti は根の子にしない");
});

test("難しさは ★ バッジと内訳の詳細、根の難しさ順になる", () => {
  const t = toTree({ kgi: "K", paths: [
    { name: "A", difficulty: { overall: 4, aspects: { time: 3, money: 5, skill_gap: 4, uncertainty: 3, life_load: 2 }, wall: "資金", reason: "貯蓄が薄い" }, mbti_fit: { rank: "B" } },
    { name: "B", difficulty: { overall: 2, aspects: { time: 2, money: 1, skill_gap: 2, uncertainty: 2, life_load: 2 } } },
  ] } as never);
  assert.deepEqual(t.children[0].badges?.map((b) => b.text), ["B", "★4"]);
  assert.deepEqual(t.children[0].fields, [
    ["おすすめ度", "B"],
    ["難しさ", "★★★★☆ 4/5 — 一番の壁: 資金"],
    ["難しさの内訳", "時間 3・資金 5・スキル差 4・不確実さ 3・生活負担 2"],
    ["難しさの理由", "貯蓄が薄い"],
  ]);
  assert.ok(!t.children[0].children.some((c) => c.label.startsWith("difficulty") || c.label.startsWith("qa")));
  assert.deepEqual(t.fields, [["難しさ順（易→難）", "★2: 道 2 / ★4: 道 1"]]);
});

test("土台があれば根に MVV・KGI・KPI の式が出て、共通 KPI のグループができる。候補や回答は木に出さない", () => {
  const t = toTree({
    kgi: "2031年までに年1,000人の笑顔を見ている",
    mvv: { mission: "笑顔をつくる", vision: "作った物の前で人が笑っている", values: [{ name: "自分で決める" }, { name: "目の前の人" }], confirmed_at: "x" },
    kgi_spec: { statement: "2031年までに年1,000人の笑顔を見ている", metric: "笑った人の数", target: "年 1,000 人", deadline: "2031-09", how_to_measure: "その場で数える", confirmed_at: "x" },
    kpi_tree: { formula: "笑顔 = 触れた人 × 率", kpis: [{ id: "K1", name: "触れた人数", kind: "leading", cadence: "月次", targets: [{ at: "2031-09", value: "3000人" }] }], generated_at: "x" },
    mvv_answers: [{ q: "q", a: "a" }],
    mvv_candidates: [],
    kgi_candidates: [],
    paths: [],
  });
  const f = Object.fromEntries(t.fields!);
  assert.equal(f["ミッション"], "笑顔をつくる");
  assert.equal(f["バリュー"], "自分で決める・目の前の人");
  assert.equal(f["目標"], "年 1,000 人（2031-09 まで）");
  assert.equal(f["KPI の式"], "笑顔 = 触れた人 × 率");
  const g = t.children.find((c) => c.label === "共通KPI (1)")!;
  assert.equal(g.children[0].label, "K1 触れた人数");
  assert.ok(g.children[0].fields!.some(([k, v]) => k === "目標" && v.includes("3000人")));
  assert.equal(find(t, (n) => /mvv_answers|mvv_candidates|kgi_candidates|kpi_tree|kgi_spec/.test(n.label)), undefined);
});

test("道のバリュー評価は V バッジと内訳、kpi_plan は KPI 名付きの見込みグループになる", () => {
  const t = toTree({
    kgi: "K",
    kpi_tree: { kpis: [{ id: "K1", name: "触れた人数", kind: "leading", targets: [] }], generated_at: "x" },
    paths: [{
      name: "インディーゲーム",
      values_fit: { rank: "A", items: [{ value: "自分で決める", fit: "match", reason: "企画も自分" }, { value: "目の前の人", fit: "conflict" }], summary: "合う" },
      kpi_plan: [{ kpi_id: "K1", target: "5000人", how: "試遊会" }],
    }],
  });
  const p = t.children[0];
  assert.deepEqual(p.badges?.map((b) => b.text), ["V:A"]);
  const f = Object.fromEntries(p.fields!);
  assert.equal(f["バリュー"], "A — 合う");
  assert.equal(f["バリューの内訳"], "○ 自分で決める / × 目の前の人");
  const g = p.children.find((c) => c.label === "共通KPIの見込み (1)")!;
  assert.equal(g.children[0].label, "K1 触れた人数: 5000人");
  assert.deepEqual(g.children[0].fields, [["見込み", "5000人"], ["動かし方", "試遊会"]]);
  assert.equal(find(t, (n) => n.label.startsWith("values_fit") || n.label.startsWith("kpi_plan")), undefined);
  assert.deepEqual(Object.fromEntries(t.fields!)["バリュー順"], "A: 道 1");
});
