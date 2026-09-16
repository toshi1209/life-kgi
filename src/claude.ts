import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export class ClaudeError extends Error {}

/**
 * `--bare` は ANTHROPIC_API_KEY（または apiKeyHelper）専用で、claude.ai ログイン（OAuth）を読まない。
 * API キーが無い環境では非 bare にし、MCP・ツール・設定・hooks を切った軽量モードで OAuth ログインを使う。
 * LIFE_KGI_BARE=1 / 0 で強制できる。
 */
const BARE_ARGS = ["--bare"];
const LIGHT_ARGS = [
  "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
  "--disable-slash-commands",
  "--no-session-persistence",
  "--setting-sources", "",
];

function bareMode(): boolean {
  const forced = process.env.LIFE_KGI_BARE;
  if (forced === "1") return true;
  if (forced === "0") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const DEFAULT_TIMEOUT_MS = 600_000;

function timeoutMs(): number {
  const v = Number(process.env.LIFE_KGI_CLAUDE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

/**
 * 子の claude に渡す環境。Claude Code のセッション内から起動されると CLAUDE_EFFORT（xhigh など）を継承して
 * 生成が数倍遅くなるので外す。effort を指定したいときは LIFE_KGI_EFFORT で --effort に渡す。
 */
function childEnv(): NodeJS.ProcessEnv {
  const { CLAUDE_EFFORT: _effort, ...env } = process.env;
  return { ...env, CI: env.CI || "1" };
}

type Exit = { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean };

/** stdin は閉じて起動する（パイプのままだと claude が 3 秒 stdin を待ってから進む）。 */
function run(bin: string, args: string[], limitMs: number): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: childEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, limitMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => { stdout += d; });
    child.stderr.setEncoding("utf8").on("data", (d: string) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(new ClaudeError(`claude を起動できません (${bin}): ${e.message}`)); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ stdout, stderr, code, signal, timedOut }); });
  });
}

export async function runClaudeP(
  prompt: string,
  opts: { systemPrompt?: string; model?: string; timeoutMs?: number; label?: string; tools?: string[]; maxTurns?: number } = {},
): Promise<string> {
  const bin = process.env.CLAUDE_BIN || "claude";
  // 既定はツール無し・1 ターン。tools を渡したときだけ（例: WebSearch）そのツールを許可し、複数ターン回す。
  const tools = opts.tools ?? [];
  const args = [
    ...(bareMode() ? BARE_ARGS : LIGHT_ARGS),
    "-p", prompt,
    "--output-format", "json",
    "--max-turns", String(opts.maxTurns ?? 1),
    "--tools", tools.join(","),
  ];
  if (tools.length) args.push("--allowedTools", tools.join(","));
  // Claude Code 既定のシステムプロンプト（コーディングエージェントの人格とツール説明）は不要なので置き換える。
  // append だとモデルがツール呼び出し（<invoke ...>）をテキストで書き出すことがあり、JSON が壊れる。
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  if (opts.model) args.push("--model", opts.model);
  if (process.env.LIFE_KGI_EFFORT) args.push("--effort", process.env.LIFE_KGI_EFFORT);
  const limit = opts.timeoutMs ?? timeoutMs();
  const label = opts.label ?? "claude -p";
  const t0 = Date.now();
  const r = await run(bin, args, limit);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const raw = r.stdout.trim();

  if (r.timedOut) {
    console.error(`[claude] ${label} timeout after ${secs}s`);
    throw new ClaudeError(`claude -p がタイムアウト（${limit / 1000} 秒）。LIFE_KGI_CLAUDE_TIMEOUT_MS で延ばせます。`);
  }
  if (!raw) {
    const tail = r.stderr.trim().split("\n").filter((l) => !/no stdin data/.test(l)).join("\n").slice(-600);
    console.error(`[claude] ${label} failed after ${secs}s (exit ${r.code ?? r.signal})`);
    throw new ClaudeError(`claude -p 失敗 (exit ${r.code ?? r.signal}, ${secs}s): ${tail || "出力なし"}`);
  }
  console.log(`[claude] ${label} done in ${secs}s`);
  try {
    const envelope = JSON.parse(raw) as { is_error?: boolean; result?: unknown };
    if (envelope.is_error) throw new ClaudeError(String(envelope.result ?? raw));
    if (envelope.result == null) return raw;
    return typeof envelope.result === "string" ? envelope.result : JSON.stringify(envelope.result);
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    return raw;
  }
}

export function parseJsonResult<T>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new ClaudeError(`claude の出力が JSON ではありません（先頭 200 文字）: ${text.trim().slice(0, 200)}`);
  }
}

export async function loadPrompt(name: string): Promise<string> {
  return readFile(join(root, "prompts", name), "utf8");
}
