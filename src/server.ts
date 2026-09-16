import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { enrichPaths, generatePaths, runFull, type PlanDoc } from "./engine.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDist = join(root, "dist", "client");
const port = Number(process.env.PORT || 8787);
const host = process.env.LIFE_KGI_HOST || "0.0.0.0";

function claudeOk(): boolean {
  try {
    execFileSync(process.env.CLAUDE_BIN || "claude", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

async function sendJson(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(urlPath: string, res: import("node:http").ServerResponse) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = normalize(join(clientDist, rel.replace(/^\/+/, "")));
  if (!file.startsWith(clientDist)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const target = existsSync(file) ? file : join(clientDist, "index.html");
  try { await stat(target); } catch { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": mime[extname(target)] || "application/octet-stream" });
  createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      await sendJson(res, 200, { ok: true, claude: claudeOk() });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      const data = JSON.parse((await readBody(req)) || "{}") as {
        kgi?: string; context?: string; n_paths?: number; horizon_years?: number; model?: string; paths_doc?: PlanDoc;
      };
      const kgi = (data.kgi || "").trim();
      if (!kgi) { await sendJson(res, 400, { error: "kgi required" }); return; }
      if (!claudeOk()) {
        await sendJson(res, 503, { error: "claude CLI がありません。" });
        return;
      }
      const input = { kgi, context: data.context || "", n_paths: data.n_paths || 4, horizon_years: data.horizon_years || 10, model: data.model };
      let doc: PlanDoc;
      if (url.pathname === "/api/paths") doc = await generatePaths(input);
      else if (url.pathname === "/api/enrich") doc = await enrichPaths(kgi, data.paths_doc || {}, data.model);
      else if (url.pathname === "/api/full") doc = await runFull(input);
      else { await sendJson(res, 404, { error: "not found" }); return; }
      await sendJson(res, 200, doc);
      return;
    }
    if (req.method === "GET") { await serveStatic(url.pathname, res); return; }
    res.writeHead(405).end("method");
  } catch (e) {
    await sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(port, host, () => {
  console.log(`life-kgi  http://${host}:${port}`);
});
