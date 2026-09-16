import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export class ClaudeError extends Error {}

export async function runClaudeP(
  prompt: string,
  opts: { systemPrompt?: string; model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const bin = process.env.CLAUDE_BIN || "claude";
  const args = ["--bare", "-p", prompt, "--output-format", "json", "--max-turns", "1"];
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
  if (opts.model) args.push("--model", opts.model);
  const r = await execFileAsync(bin, args, {
    timeout: opts.timeoutMs ?? 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI || "1" },
  }).catch((e: { stdout?: string; stderr?: string; message?: string }) => {
    if (e.stdout?.trim()) return { stdout: e.stdout, stderr: e.stderr || "" };
    throw new ClaudeError(`claude -p 失敗: ${e.stderr || e.message}`);
  });
  const raw = (r.stdout || "").trim();
  try {
    const envelope = JSON.parse(raw) as { is_error?: boolean; result?: unknown };
    if (envelope.is_error) throw new ClaudeError(String(envelope.result ?? raw));
    if (envelope.result == null) return raw;
    return typeof envelope.result === "string" ? envelope.result : JSON.stringify(envelope.result);
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    if (raw) return raw;
    throw new ClaudeError("JSON parse failed");
  }
}

export function parseJsonResult<T>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as T;
}

export async function loadPrompt(name: string): Promise<string> {
  return readFile(join(root, "prompts", name), "utf8");
}
