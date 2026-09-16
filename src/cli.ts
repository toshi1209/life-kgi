import { writeFile } from "node:fs/promises";
import { generatePaths, runFull } from "./engine.ts";

function arg(flag: string, fallback = ""): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] ?? fallback) : fallback;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

const rest = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const kgi = rest[0] || "";

if (has("--serve") || has("-s")) {
  await import("./server.ts");
} else if (!kgi) {
  console.log(`usage:\n  npm start\n  npm run kgi -- "KGI" [-c context] [-n 4]`);
  process.exit(2);
} else {
  const input = {
    kgi,
    context: arg("-c") || arg("--context"),
    n_paths: Number(arg("-n") || arg("--paths") || 4),
    horizon_years: Number(arg("--years") || 10),
    model: arg("--model") || undefined,
  };
  const doc = has("--paths-only") ? await generatePaths(input) : await runFull(input);
  const text = JSON.stringify(doc, null, 2);
  const out = arg("-o") || arg("--out");
  if (out) {
    await writeFile(out, text, "utf8");
    console.log(`wrote ${out}`);
  } else console.log(text);
}
