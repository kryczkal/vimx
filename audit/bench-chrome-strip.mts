// Chrome-strip blind-spot audit.
//
// Question: does the READ_JS chrome strip (nav/footer/aside + ARIA
// navigation/contentinfo/complementary) hide content the agent actually
// needs?
//
// Method: navigate to each URL, run READ_JS TWICE — once with the current
// strip, once without — diff the line sets, save the "what got stripped"
// chunk per site, auto-flag potentially-load-bearing categories
// (date/byline/breadcrumb/pagination/TOC/tabs), produce a report sorted
// by how much was stripped.
//
// Uses a dedicated tab so the user's foreground tab is untouched.

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data", "chrome-strip");
mkdirSync(OUT_DIR, { recursive: true });

// Two parallel READ_JS variants. Same root selection. ONLY difference: with-
// strip injects the chrome-hiding style, without-strip doesn't. Keeps the
// comparison fair (multi-root walk, shadow handling, etc. all identical).
const READ_BASE = `
  const roots = [];
  const main = document.querySelector("main, article, [role=main]");
  if (main) {
    roots.push(main);
    for (const child of document.body.children) {
      if (child === main || main.contains(child) || child.contains(main)) continue;
      const role = (child.getAttribute("role") || "").toLowerCase();
      const isDialog = role === "dialog" || role === "alertdialog" || child.getAttribute("aria-modal") === "true";
      const hasShadow = !!child.shadowRoot;
      if (!isDialog && !hasShadow) continue;
      roots.push(child);
    }
  } else {
    roots.push(document.body);
  }
`;

const READ_WITH_STRIP = `(() => {
  ${READ_BASE}
  const s = document.createElement("style");
  s.textContent = 'nav, footer, aside, [role="navigation"], [role="contentinfo"], [role="complementary"] { display: none !important; }';
  document.head.appendChild(s);
  let md;
  try { md = roots.map(r => (r && r.innerText) || "").join("\\n\\n").trim(); }
  finally { s.remove(); }
  return md;
})()`;

const READ_WITHOUT_STRIP = `(() => {
  ${READ_BASE}
  return roots.map(r => (r && r.innerText) || "").join("\\n\\n").trim();
})()`;

const URLS: string[] = [
  // ── wikipedia (TOC + infoboxes + many <nav>/<aside>) ────────────────────
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://en.wikipedia.org/wiki/Cornell_University",
  "https://en.wikipedia.org/wiki/Geoffrey_Hinton",
  "https://en.wikipedia.org/wiki/Climate_change",
  "https://en.wikipedia.org/wiki/World_War_II",
  "https://en.wikipedia.org/wiki/Photosynthesis",
  "https://en.wikipedia.org/wiki/Linus_Torvalds",
  "https://en.wikipedia.org/wiki/Special:Random",
  "https://simple.wikipedia.org/wiki/Main_Page",
  "https://en.wiktionary.org/wiki/example",
  // ── docs sites (TOC navs, breadcrumbs, sidebars) ────────────────────────
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/CSS/flex",
  "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav",
  "https://docs.python.org/3/tutorial/datastructures.html",
  "https://docs.python.org/3/library/asyncio.html",
  "https://docs.python.org/3/",
  "https://doc.rust-lang.org/book/",
  "https://doc.rust-lang.org/std/vec/struct.Vec.html",
  "https://react.dev/learn",
  "https://react.dev/reference/react",
  "https://www.typescriptlang.org/docs/",
  "https://nodejs.org/api/http.html",
  "https://go.dev/doc/tutorial/getting-started",
  "https://vuejs.org/guide/introduction.html",
  "https://docs.docker.com/get-started/",
  "https://kubernetes.io/docs/home/",
  // ── news (bylines, related, pagination) ─────────────────────────────────
  "https://www.bbc.com/news",
  "https://www.bbc.com/sport",
  "https://www.bbc.com/culture",
  "https://www.npr.org/",
  "https://www.reuters.com/",
  "https://apnews.com/",
  "https://www.theguardian.com/international",
  "https://www.nytimes.com/",
  "https://www.aljazeera.com/",
  "https://techcrunch.com/",
  "https://arstechnica.com/",
  "https://www.theverge.com/",
  "https://www.wired.com/",
  "https://www.quantamagazine.org/",
  // ── e-commerce (specs, breadcrumbs, related products) ───────────────────
  "https://www.amazon.com/dp/B07XJ8C8F5",
  "https://www.amazon.com/",
  "https://www.ebay.com/",
  "https://www.etsy.com/",
  "https://www.target.com/",
  "https://www.walmart.com/",
  "https://www.ikea.com/us/en/",
  // ── github (sidebar = aside, file tree = nav?) ──────────────────────────
  "https://github.com/",
  "https://github.com/anthropics/anthropic-sdk-python",
  "https://github.com/torvalds/linux",
  "https://github.com/microsoft/vscode/issues",
  "https://github.com/anthropics/anthropic-sdk-python/blob/main/README.md",
  "https://gitlab.com/",
  // ── q&a / aggregators ───────────────────────────────────────────────────
  "https://stackoverflow.com/",
  "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python",
  "https://news.ycombinator.com/",
  "https://news.ycombinator.com/newest",
  "https://lobste.rs/",
  "https://slashdot.org/",
  // ── package registries ──────────────────────────────────────────────────
  "https://www.npmjs.com/",
  "https://pypi.org/",
  "https://pypi.org/project/anthropic/",
  "https://crates.io/",
  // ── saas / apps (mostly chrome) ─────────────────────────────────────────
  "https://linear.app/",
  "https://www.notion.so/",
  "https://www.airtable.com/",
  "https://www.figma.com/",
  "https://slack.com/",
  "https://www.dropbox.com/",
  // ── search ──────────────────────────────────────────────────────────────
  "https://duckduckgo.com/",
  "https://www.google.com/",
  "https://www.bing.com/",
  // ── gov / institutional ─────────────────────────────────────────────────
  "https://www.nasa.gov/",
  "https://www.whitehouse.gov/",
  "https://www.congress.gov/",
  "https://www.nih.gov/",
  "https://www.usa.gov/",
  // ── education ───────────────────────────────────────────────────────────
  "https://web.mit.edu/",
  "https://www.stanford.edu/",
  "https://www.coursera.org/",
  "https://www.khanacademy.org/",
  // ── blogs / personal ────────────────────────────────────────────────────
  "https://medium.com/",
  "https://dev.to/",
  "https://substack.com/",
  "https://www.paulgraham.com/articles.html",
  "https://www.paulgraham.com/greatwork.html",
  "https://sive.rs/",
  "https://jvns.ca/",
  // ── books / long-form ───────────────────────────────────────────────────
  "https://www.gutenberg.org/files/76/76-h/76-h.htm",
  "https://en.wikisource.org/wiki/Main_Page",
  // ── entertainment ───────────────────────────────────────────────────────
  "https://www.imdb.com/",
  "https://www.imdb.com/title/tt0111161/",
  "https://www.rottentomatoes.com/",
  "https://www.metacritic.com/",
  // ── reference / utility ─────────────────────────────────────────────────
  "https://archive.org/",
  "https://www.timeanddate.com/",
  "https://weather.com/",
  "https://www.wolframalpha.com/",
  // ── minimal / controls ──────────────────────────────────────────────────
  "https://example.com/",
  "https://info.cern.ch/",
  "https://httpforever.com/",
  // ── misc ────────────────────────────────────────────────────────────────
  "https://www.openstreetmap.org/",
  "https://www.allrecipes.com/",
  "https://platform.openai.com/docs",
  "https://www.anthropic.com/",
];

console.error(`URLs: ${URLS.length}`);

// ── CDP: open a dedicated tab so the foreground stays untouched ─────────────
const list = await CDP.List({ port: CDP_PORT });
console.error(`existing tabs: ${list.length}`);
const newTab = await CDP.New({ port: CDP_PORT, url: "about:blank" });
console.error(`new tab: ${newTab.id}`);

const client = await CDP({ port: CDP_PORT, target: newTab.id });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function nav(url: string, timeoutMs = 15000): Promise<boolean> {
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

async function evalText(expr: string): Promise<string | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true, timeout: 5000,
    });
    if (exceptionDetails) return null;
    return (result.value as string) ?? "";
  } catch { return null; }
}

// Heuristic flags on the stripped chunk: cheap signals that the content
// might have been load-bearing. Inspection is still required, but these
// surface the interesting cases.
function flag(text: string): string[] {
  const flags: string[] = [];
  const t = text;
  if (/\b\d{4}-\d{2}-\d{2}\b|\b(\d{1,2}\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b|\b\d+\s+(hours?|days?|minutes?|weeks?|months?|years?)\s+ago\b/i.test(t))
    flags.push("date");
  if (/\bby\s+[A-Z][a-z]+ [A-Z][a-z]+|^author[: ]|posted by|written by|reporter|correspondent/m.test(t))
    flags.push("byline");
  if (/\bpage\s+\d+\s+of\s+\d+\b|^next\s*(page|→|»)?\s*$|^previous\s*(page|‹|«)?\s*$|^prev\s*$|^›$|^«$|^»$/im.test(t))
    flags.push("pagination");
  // Breadcrumb: line with multiple > or › separators, short words
  if (/(\w+[\s ]*[›>\/][\s ]*){2,}\w+/.test(t.split("\n").find(l => l.length < 200) || ""))
    flags.push("breadcrumb");
  // TOC: 3+ lines that look like "1. Heading" or "1.1 Heading"
  const tocLines = t.split("\n").filter(l => /^\s*\d+(\.\d+)*\.?\s+[A-Z]/.test(l));
  if (tocLines.length >= 3) flags.push("toc");
  // Tabs / inline navigation: very short single-word/two-word lines clustered
  const shortLines = t.split("\n").filter(l => l.trim().length > 0 && l.trim().length < 20);
  if (shortLines.length >= 10 && shortLines.length / t.split("\n").filter(l => l.trim()).length > 0.6)
    flags.push("short-labels");
  // Contains structural content (long prose) — strong signal we lost real text
  const longLines = t.split("\n").filter(l => l.trim().length > 150);
  if (longLines.length >= 2) flags.push("long-prose");
  // Site footer typical noise
  if (/\bcopyright\b|©|\bprivacy\s+policy\b|\bterms\s+of\b|\bcookie\s+policy\b/i.test(t))
    flags.push("footer-legal");
  // Newsletter / signup
  if (/\b(subscribe|newsletter|sign\s+up|enter\s+your\s+email)\b/i.test(t))
    flags.push("signup");
  // Article metadata block (typical inside <footer> of <article>)
  if (/\b(tags?|categories|filed under|topics?)[:\s]/i.test(t))
    flags.push("article-meta");
  return flags;
}

function diffLines(without: string, withStrip: string): string {
  const w = new Set(withStrip.split("\n").map(l => l.trim()).filter(l => l.length > 0));
  const out: string[] = [];
  for (const line of without.split("\n")) {
    if (!w.has(line.trim()) && line.trim().length > 0) out.push(line);
  }
  return out.join("\n");
}

interface Row {
  url: string;
  slug: string;
  err?: string;
  charsWithout: number;
  charsWith: number;
  charsDiff: number;
  pctStripped: number;
  flags: string[];
}
const rows: Row[] = [];

let i = 0;
for (const url of URLS) {
  i++;
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  process.stderr.write(`[${i}/${URLS.length}] ${url} ... `);
  const ok = await nav(url);
  if (!ok) {
    console.error("NAV FAIL");
    rows.push({ url, slug, err: "nav fail", charsWithout: 0, charsWith: 0, charsDiff: 0, pctStripped: 0, flags: [] });
    continue;
  }
  const without = await evalText(READ_WITHOUT_STRIP);
  const withStrip = await evalText(READ_WITH_STRIP);
  if (without === null || withStrip === null) {
    console.error("EVAL FAIL");
    rows.push({ url, slug, err: "eval fail", charsWithout: 0, charsWith: 0, charsDiff: 0, pctStripped: 0, flags: [] });
    continue;
  }
  const diff = diffLines(without, withStrip);
  const charsDiff = diff.length;
  const pct = without.length > 0 ? Math.round((charsDiff / without.length) * 100) : 0;
  const fl = flag(diff);
  rows.push({
    url, slug,
    charsWithout: without.length, charsWith: withStrip.length,
    charsDiff, pctStripped: pct, flags: fl,
  });
  writeFileSync(resolvePath(OUT_DIR, `${slug}.diff.txt`), diff);
  console.error(`without=${without.length} with=${withStrip.length} stripped=${charsDiff} (${pct}%) flags=[${fl.join(",")}]`);
}

// ── Report ──────────────────────────────────────────────────────────────────
const md: string[] = [];
md.push("# chrome-strip blind-spot audit");
md.push("");
md.push(`${URLS.length} URLs. For each: READ_JS with current strip vs. no strip. Diff = lines present without-strip but missing with-strip. Flags are cheap heuristics — manual inspection of \`*.diff.txt\` files is the source of truth.`);
md.push("");
md.push("| # | site | without | with | stripped | % | flags |");
md.push("|---:|---|---:|---:|---:|---:|---|");
const sorted = [...rows].sort((a, b) => b.charsDiff - a.charsDiff);
sorted.forEach((r, idx) => {
  if (r.err) {
    md.push(`| ${idx + 1} | ${r.url} | — | — | — | — | ${r.err} |`);
  } else {
    md.push(`| ${idx + 1} | ${r.url} | ${r.charsWithout} | ${r.charsWith} | ${r.charsDiff} | ${r.pctStripped} | ${r.flags.join(", ")} |`);
  }
});

// Aggregate flag counts
const flagCounts = new Map<string, number>();
for (const r of rows) {
  for (const f of r.flags) flagCounts.set(f, (flagCounts.get(f) || 0) + 1);
}
md.push("");
md.push("## Flag frequencies");
md.push("");
const sortedFlags = [...flagCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, n] of sortedFlags) md.push(`- **${f}**: ${n} sites`);

md.push("");
md.push("## Top-10 most-stripped sites (likely worst blind spots)");
md.push("");
for (const r of sorted.slice(0, 10)) {
  if (r.err) continue;
  md.push(`### ${r.url} — ${r.charsDiff} chars stripped (${r.pctStripped}%)`);
  md.push("");
  md.push(`Flags: ${r.flags.join(", ") || "(none)"}`);
  md.push("");
  md.push("```");
  const sample = readFileSync(resolvePath(OUT_DIR, `${r.slug}.diff.txt`), "utf8").slice(0, 1200);
  md.push(sample);
  md.push("```");
  md.push("");
}

writeFileSync(resolvePath(OUT_DIR, "REPORT.md"), md.join("\n"));
console.error(`\n\nReport: ${resolvePath(OUT_DIR, "REPORT.md")}`);

await client.close();
try { await CDP.Close({ port: CDP_PORT, id: newTab.id }); } catch {}
