import { loadPrompt, parseJsonResult, runClaudeP } from "./claude.ts";

const SYSTEM =
  "あなたはユーザーの人生KGIを設計する参謀です。推測で盛らず、トレードオフを明示し、測定できる指標だけを出す。出力は指定JSONのみ。";

export type PlanDoc = {
  kgi?: string;
  horizon_years?: number;
  paths?: Record<string, unknown>[];
};

async function ask<T>(file: string, userBlock: string, model?: string): Promise<T> {
  const system = await loadPrompt(file);
  const raw = await runClaudeP(`${system}\n\n---\nユーザー入力:\n${userBlock}`, {
    systemPrompt: SYSTEM,
    model,
  });
  return parseJsonResult<T>(raw);
}

export async function generatePaths(input: {
  kgi: string;
  context?: string;
  horizon_years?: number;
  n_paths?: number;
  model?: string;
}): Promise<PlanDoc> {
  const n = input.n_paths ?? 4;
  const data = await ask<PlanDoc>(
    "paths.txt",
    JSON.stringify(
      {
        kgi: input.kgi,
        context: input.context ?? "",
        horizon_years: input.horizon_years ?? 10,
        n_paths: n,
      },
      null,
      2,
    ),
    input.model,
  );
  data.paths = (data.paths ?? []).slice(0, n);
  return data;
}

export async function enrichPaths(
  kgi: string,
  pathsDoc: PlanDoc,
  model?: string,
): Promise<PlanDoc> {
  const paths = pathsDoc.paths ?? [];
  const filled = await Promise.all(
    paths.map(async (p) => {
      const payload = JSON.stringify({ kgi, path: p }, null, 2);
      const [skills, future] = await Promise.all([
        ask("skills_kpi.txt", payload, model),
        ask("future.txt", payload, model),
      ]);
      return { ...p, skills_kpi: skills, future };
    }),
  );
  return {
    kgi: pathsDoc.kgi || kgi,
    horizon_years: pathsDoc.horizon_years,
    paths: filled,
  };
}

export async function runFull(input: {
  kgi: string;
  context?: string;
  horizon_years?: number;
  n_paths?: number;
  model?: string;
}): Promise<PlanDoc> {
  const base = await generatePaths(input);
  return enrichPaths(input.kgi, base, input.model);
}
