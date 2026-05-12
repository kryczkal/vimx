// Benchmark: does a model-written regex on read() output actually surface
// the intended content? Replays the Nobel-session failure pattern across
// 8 real pages with realistic intents and the regexes a model would
// plausibly write.
//
// For each (site, intent): navigate, run READ_JS to get the un-capped text,
// apply each candidate regex per-line with ±2/+5 line windowing, and report:
//   - total page length
//   - match count
//   - filtered-output length
//   - first 2 matched windows (truncated)
//
// I score "hit" by eyeballing whether the windows contain the answer the
// intent asks for.

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import { READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data", "regex-bench");
mkdirSync(OUT_DIR, { recursive: true });

interface Case {
  slug: string;
  url: string;
  intent: string;
  regexes: string[];
}

const CASES: Case[] = [
  {
    slug: "hopfield",
    url: "https://en.wikipedia.org/wiki/John_J._Hopfield",
    intent: "where did Hopfield get his PhD",
    regexes: ["PhD|doctorate|alma mater", "Cornell", "education|PhD"],
  },
  {
    slug: "hinton",
    url: "https://en.wikipedia.org/wiki/Geoffrey_Hinton",
    intent: "where did Hinton get his PhD",
    regexes: ["PhD|doctorate|alma mater", "Edinburgh", "thesis|PhD"],
  },
  {
    slug: "laureates-by-uni",
    url: "https://en.wikipedia.org/wiki/List_of_Nobel_laureates_by_university_affiliation",
    intent: "find Cornell entry / laureates count",
    regexes: ["Cornell", "Cornell University"],
  },
  {
    slug: "cornell",
    url: "https://en.wikipedia.org/wiki/Cornell_University",
    intent: "find Nobel laureates section",
    regexes: ["Nobel", "Nobel laureat"],
  },
  {
    slug: "amazon-echo",
    url: "https://www.amazon.com/dp/B07XJ8C8F5",
    intent: "find product price",
    regexes: ["\\$[0-9]", "price|sale|deal", "\\$\\d+\\.\\d{2}"],
  },
  {
    slug: "gh-readme",
    url: "https://github.com/anthropics/anthropic-sdk-python",
    intent: "find install instructions",
    regexes: ["pip install|npm install|^#+ install", "install|getting started", "pip install"],
  },
  {
    slug: "hn",
    url: "https://news.ycombinator.com/",
    intent: "find top stories with scores",
    regexes: ["\\d+ points?", "points?\\s+by", "\\d+\\s*comments?"],
  },
  {
    slug: "stack",
    url: "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python",
    intent: "find the accepted answer",
    regexes: ["accepted|answered", "yield", "generator|iterator"],
  },
];

// ── CDP ─────────────────────────────────────────────────────────────────────
const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function nav(url: string, timeoutMs = 20000): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([
      Page.loadEventFired(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("nav timeout")), timeoutMs)),
    ]);
    await new Promise(r => setTimeout(r, 2500));
    return true;
  } catch {
    return false;
  }
}

async function readText(): Promise<string> {
  const { result, exceptionDetails } = await Runtime.evaluate({
    expression: `${READ_JS}().text`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return (result.value as string) || "";
}

// Mirror the proposed regex filter: per-line case-insensitive match, ±2/+5
// line window per match. Adjacent windows merge so we don't double-show.
function applyRegex(text: string, pattern: string): { count: number; output: string } {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (e) {
    return { count: -1, output: `INVALID REGEX: ${e instanceof Error ? e.message : e}` };
  }
  const lines = text.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push(i);
  }
  if (hits.length === 0) return { count: 0, output: "" };

  // Merge overlapping windows.
  const windows: [number, number][] = [];
  for (const h of hits) {
    const start = Math.max(0, h - 2);
    const end = Math.min(lines.length, h + 5);
    const last = windows[windows.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  const chunks = windows.map(([s, e]) => lines.slice(s, e).join("\n"));
  return { count: hits.length, output: chunks.join("\n---\n") };
}

// ── Run ─────────────────────────────────────────────────────────────────────
interface Row {
  slug: string;
  intent: string;
  pageLen: number;
  regex: string;
  matches: number;
  filteredLen: number;
  sample: string;
}
const rows: Row[] = [];

for (const c of CASES) {
  console.error(`\n=== ${c.slug} :: ${c.intent} ===`);
  console.error(`nav ${c.url}`);
  const ok = await nav(c.url);
  if (!ok) {
    console.error("  nav FAILED");
    continue;
  }
  let text = "";
  try { text = await readText(); }
  catch (e) { console.error("  read failed:", e); continue; }

  writeFileSync(resolvePath(OUT_DIR, `${c.slug}.raw.txt`), text);
  console.error(`  page text: ${text.length} chars, ${text.split("\n").length} lines`);

  for (const rx of c.regexes) {
    const { count, output } = applyRegex(text, rx);
    const sample = output.slice(0, 600).replace(/\s+/g, " ").trim();
    console.error(`  /${rx}/i → ${count} matches, ${output.length} chars`);
    rows.push({
      slug: c.slug, intent: c.intent, pageLen: text.length,
      regex: rx, matches: count, filteredLen: output.length,
      sample,
    });
    writeFileSync(
      resolvePath(OUT_DIR, `${c.slug}__${rx.replace(/[^a-z0-9]+/gi, "_")}.txt`),
      output || "(no matches)",
    );
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const md: string[] = [];
md.push("# regex-vs-substring read() benchmark");
md.push("");
md.push("8 sites × multiple candidate regexes per intent. Per-line case-insensitive match, ±2/+5 line window, adjacent windows merged.");
md.push("");
md.push("| site | intent | page lines | regex | matches | filtered chars |");
md.push("|---|---|---:|---|---:|---:|");
let lastSlug = "";
for (const r of rows) {
  const slug = r.slug === lastSlug ? "" : r.slug;
  const intent = r.slug === lastSlug ? "" : r.intent;
  const pageLines = r.slug === lastSlug ? "" : String(r.pageLen);
  lastSlug = r.slug;
  md.push(`| ${slug} | ${intent} | ${pageLines} | \`${r.regex}\` | ${r.matches} | ${r.filteredLen} |`);
}
md.push("");
md.push("## Sample windows (first ~600 chars, whitespace collapsed)");
md.push("");
for (const r of rows) {
  md.push(`### ${r.slug} — /${r.regex}/i (${r.matches} hits)`);
  md.push("");
  md.push("```");
  md.push(r.sample || "(no matches)");
  md.push("```");
  md.push("");
}

const reportPath = resolvePath(OUT_DIR, "REPORT.md");
writeFileSync(reportPath, md.join("\n"));
console.error(`\n\nreport: ${reportPath}`);

await client.close();
