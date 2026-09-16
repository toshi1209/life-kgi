import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeError, runClaudeP } from "./claude.ts";

let dir = "";
const saved = { bin: process.env.CLAUDE_BIN, key: process.env.ANTHROPIC_API_KEY, bare: process.env.LIFE_KGI_BARE };

/** 偽の claude を作り、CLAUDE_BIN に設定する */
function fakeClaude(script: string): string {
  const file = join(dir, "claude");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  process.env.CLAUDE_BIN = file;
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "life-kgi-claude-"));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LIFE_KGI_BARE;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [["CLAUDE_BIN", saved.bin], ["ANTHROPIC_API_KEY", saved.key], ["LIFE_KGI_BARE", saved.bare]] as const) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
});

test("JSON エンベロープの result を返す", async () => {
  fakeClaude(`echo '{"is_error":false,"result":"{\\"a\\":1}"}'`);
  assert.equal(await runClaudeP("hi"), '{"a":1}');
});

test("is_error なら result を ClaudeError にする", async () => {
  fakeClaude(`echo '{"is_error":true,"result":"Not logged in"}'`);
  await assert.rejects(runClaudeP("hi"), (e: unknown) => e instanceof ClaudeError && /Not logged in/.test(e.message));
});

test("stdin はパイプではなく閉じている（3 秒待ちの警告を出させない）", async () => {
  fakeClaude(`if [ -t 0 ] || [ ! -p /dev/stdin ]; then echo '{"result":"closed"}'; else echo '{"result":"pipe"}'; fi`);
  assert.equal(await runClaudeP("hi"), "closed");
});

test("タイムアウトすると理由が分かるメッセージで落ちる", async () => {
  fakeClaude(`sleep 5; echo '{"result":"late"}'`);
  await assert.rejects(runClaudeP("hi", { timeoutMs: 300 }), (e: unknown) => e instanceof ClaudeError && /タイムアウト/.test(e.message) && /0\.3|300/.test(e.message));
});

test("出力なしで終了したら exit code と stderr を含める", async () => {
  fakeClaude(`echo 'boom happened' >&2; exit 3`);
  await assert.rejects(runClaudeP("hi"), (e: unknown) => e instanceof ClaudeError && /exit 3/.test(e.message) && /boom happened/.test(e.message));
});

test("API キーがあれば --bare、無ければ軽量フラグで呼ぶ", async () => {
  fakeClaude(`printf '{"result":"%s"}' "$*" | sed 's/"/\\"/g; s/\\\\"result\\\\":\\\\"/"result":"/; s/\\\\"}$/"}/'`);
  // 上の sed は引数に含まれる " をエスケープするだけ。フラグの有無だけ見る。
  const light = await runClaudeP("hi", { systemPrompt: "SYS" });
  assert.match(light, /--setting-sources/);
  assert.doesNotMatch(light, /--bare/);
  assert.match(light, /--system-prompt SYS/);
  assert.doesNotMatch(light, /--append-system-prompt/);
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const bare = await runClaudeP("hi");
  assert.match(bare, /--bare/);
  assert.doesNotMatch(bare, /--setting-sources/);
});

test("親セッションの CLAUDE_EFFORT は子に渡さず、LIFE_KGI_EFFORT があれば --effort を付ける", async () => {
  fakeClaude(`printf '{"result":"effort=%s args=%s"}' "\${CLAUDE_EFFORT:-none}" "$*"`);
  const savedEffort = process.env.CLAUDE_EFFORT;
  const savedLife = process.env.LIFE_KGI_EFFORT;
  try {
    process.env.CLAUDE_EFFORT = "xhigh";
    delete process.env.LIFE_KGI_EFFORT;
    const a = await runClaudeP("hi");
    assert.match(a, /effort=none /);
    assert.doesNotMatch(a, /--effort/);
    process.env.LIFE_KGI_EFFORT = "low";
    const b = await runClaudeP("hi");
    assert.match(b, /effort=none /);
    assert.match(b, /--effort low/);
  } finally {
    if (savedEffort == null) delete process.env.CLAUDE_EFFORT; else process.env.CLAUDE_EFFORT = savedEffort;
    if (savedLife == null) delete process.env.LIFE_KGI_EFFORT; else process.env.LIFE_KGI_EFFORT = savedLife;
  }
});

test("parseJsonResult は JSON でない出力の先頭を含めて失敗する", async () => {
  const { parseJsonResult } = await import("./claude.ts");
  assert.deepEqual(parseJsonResult('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonResult('前置き {"a":[1,2]} 後置き'), { a: [1, 2] });
  assert.throws(() => parseJsonResult('<invoke name="x">...</invoke>'), (e: unknown) => e instanceof ClaudeError && /JSON ではありません/.test(e.message) && /<invoke name="x">/.test(e.message));
});

test("tools を指定すると --tools / --allowedTools / --max-turns が付き、無指定なら --tools は空", async () => {
  const argsFile = join(dir, "args");
  fakeClaude(`printf '%s\\n' "$@" > "${argsFile}"; echo '{"result":"ok"}'`);
  const { readFileSync } = await import("node:fs");
  await runClaudeP("hi");
  let a = readFileSync(argsFile, "utf8").split("\n");
  assert.equal(a[a.indexOf("--tools") + 1], "");
  assert.equal(a[a.indexOf("--max-turns") + 1], "1");
  assert.ok(!a.includes("--allowedTools"));
  await runClaudeP("hi", { tools: ["WebSearch"], maxTurns: 12 });
  a = readFileSync(argsFile, "utf8").split("\n");
  assert.equal(a[a.indexOf("--tools") + 1], "WebSearch");
  assert.equal(a[a.indexOf("--allowedTools") + 1], "WebSearch");
  assert.equal(a[a.indexOf("--max-turns") + 1], "12");
});
