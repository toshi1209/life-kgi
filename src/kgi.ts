// KGI の形と「測れる KGI か」の判定。依存なしで、サーバと画面（client）の両方から使う。

export type KgiSpec = {
  /** 「〜までに、〜が〜になっている」形の 1 文 */
  statement: string;
  /** 何を数えるか */
  metric: string;
  /** 目標値（数字と単位） */
  target: string;
  /** 期限 YYYY-MM */
  deadline: string;
  /** 誰が・いつ・何で数えるか */
  how_to_measure: string;
  /** vision とのつながり（任意） */
  why?: string;
};

export const KGI_FIELDS = ["statement", "metric", "target", "deadline", "how_to_measure"] as const;

export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const blank = (v: unknown) => typeof v !== "string" || !v.trim();

/** 確定できない理由の一覧（空なら確定できる）。願望形の一文、数字の無い目標、過去の期限を弾く。 */
export function kgiProblems(k: Partial<KgiSpec>, today = new Date()): string[] {
  const out: string[] = [];
  if (blank(k.statement)) out.push("KGI の一文がありません");
  else if (/たい[。．.!！]?\s*$/.test(k.statement!.trim())) out.push("「〜したい」は願望です。達成したか判定できる状態（〜になっている）で書いてください");
  if (blank(k.metric)) out.push("何を数えるか（指標）がありません");
  if (blank(k.target)) out.push("目標値がありません");
  else if (!/[0-9０-９]/.test(k.target!)) out.push("目標値に数字がありません（例: 年 1,000 人）");
  if (blank(k.deadline)) out.push("期限がありません");
  else if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k.deadline!.trim())) out.push("期限は YYYY-MM の形で書いてください");
  else if (k.deadline!.trim() <= monthOf(today)) out.push("期限が過去（または今月）です");
  if (blank(k.how_to_measure)) out.push("測り方がありません");
  return out;
}
