import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";

export function claudeOk(): boolean {
  try {
    execFileSync(process.env.CLAUDE_BIN || "claude", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function sendJson(res: ServerResponse, code: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
