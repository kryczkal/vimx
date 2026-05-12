// Validation: removing the chrome strip in READ_JS. Across 105 sites,
// compare prod READ_JS (strip-removed, current) vs a strip-on variant of
// the same code. Both have the anchor-URL injection — only delta is the
// strip. Goal: confirm strip removal recovers the previously-lost content
// without introducing pathological output anywhere.
//
// "False positive" of this change = a site where strip-off output is
// worse than strip-on. Concrete tests:
//   - duplication ratio > 25% (chrome nav repeating like a feed)
//   - length explodes (>3x strip-on AND >200k)
//   - canary phrases on canary sites must be in strip-off, absent from strip-on
//   - output empty / errors

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import { READ_JS as PROD_READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data", "strip-removed");
mkdirSync(OUT_DIR, { recursive: true });

// Inject the old chrome strip BEFORE prod READ_JS runs. Wrap so we get the
// same anchor-URL injection logic but with chrome hidden during innerText
// capture. Removes the style itself when done so the page is left alone.
const STRIP_ON_READ_JS = `(() => {
  const _s = document.createElement("style");
  _s.textContent = 'nav, footer, aside, [role="navigation"], [role="contentinfo"], [role="complementary"] { display: none !important; }';
  document.head.appendChild(_s);
  try {
    return (${PROD_READ_JS})();
  } finally {
    _s.remove();
  }
})()`;

const URLS: string[] = [
  // wikipedia
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
  // docs
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
  // news
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
  // e-commerce
  "https://www.amazon.com/dp/B07XJ8C8F5",
  "https://www.amazon.com/",
  "https://www.ebay.com/",
  "https://www.etsy.com/",
  "https://www.target.com/",
  "https://www.walmart.com/",
  "https://www.ikea.com/us/en/",
  // github / dev
  "https://github.com/",
  "https://github.com/anthropics/anthropic-sdk-python",
  "https://github.com/torvalds/linux",
  "https://github.com/microsoft/vscode/issues",
  "https://github.com/anthropics/anthropic-sdk-python/blob/main/README.md",
  "https://gitlab.com/",
  // q&a
  "https://stackoverflow.com/",
  "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python",
  "https://news.ycombinator.com/",
  "https://news.ycombinator.com/newest",
  "https://lobste.rs/",
  "https://slashdot.org/",
  // packages
  "https://www.npmjs.com/",
  "https://pypi.org/",
  "https://pypi.org/project/anthropic/",
  "https://crates.io/",
  // saas
  "https://linear.app/",
  "https://www.notion.so/",
  "https://www.airtable.com/",
  "https://www.figma.com/",
  "https://slack.com/",
  "https://www.dropbox.com/",
  // search
  "https://duckduckgo.com/",
  "https://www.google.com/",
  "https://www.bing.com/",
  // gov
  "https://www.nasa.gov/",
  "https://www.whitehouse.gov/",
  "https://www.congress.gov/",
  "https://www.nih.gov/",
  "https://www.usa.gov/",
  // edu
  "https://web.mit.edu/",
  "https://www.stanford.edu/",
  "https://www.coursera.org/",
  "https://www.khanacademy.org/",
  // blog
  "https://medium.com/",
  "https://dev.to/",
  "https://substack.com/",
  "https://www.paulgraham.com/articles.html",
  "https://www.paulgraham.com/greatwork.html",
  "https://sive.rs/",
  "https://jvns.ca/",
  // books
  "https://www.gutenberg.org/files/76/76-h/76-h.htm",
  "https://en.wikisource.org/wiki/Main_Page",
  // entertainment
  "https://www.imdb.com/",
  "https://www.imdb.com/title/tt0111161/",
  "https://www.rottentomatoes.com/",
  "https://www.metacritic.com/",
  // ref
  "https://archive.org/",
  "https://www.timeanddate.com/",
  "https://weather.com/",
  "https://www.wolframalpha.com/",
  // minimal
  "https://example.com/",
  "https://info.cern.ch/",
  "https://httpforever.com/",
  // misc
  "https://www.openstreetmap.org/",
  "https://www.allrecipes.com/",
  "https://platform.openai.com/docs",
  "https://www.anthropic.com/",
];

// Canary sites: previously-lost content that strip-off must recover and
// strip-on must lack. If strip-off includes the phrase AND strip-on doesn't,
// the change works as intended on that site.
const CANARIES: Record<string, string[]> = {
  "https://www.congress.gov/": ["News from the Law Library", "Taylor Gulatsi"],
  "https://www.ebay.com/": ["Score rare finds", "Discover exclusive deals"],
  "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python": [
    "Protected question", "10 reputation",
  ],
  "https://www.nytimes.com/": ["War in the Middle East"],
};

console.error(`URLs: ${URLS.length}, canaries: ${Object.keys(CANARIES).length}`);

const newTab = await CDP.New({ port: CDP_PORT, url: "about:blank" });
const client = await CDP({ port: CDP_PORT, target: newTab.id });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function nav(url: string, timeoutMs = 15000): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([
      Page.loadEventFired(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    await new Promise(r => setTimeout(r, 2500));
    return true;
  } catch { return false; }
}

async function readText(expr: string): Promise<string | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: `(${expr}).text`, returnByValue: true, awaitPromise: true, timeout: 8000,
    });
    if (exceptionDetails) return null;
    return (result.value as string) ?? "";
  } catch { return null; }
}

// Pathology: ratio of duplicate non-empty lines to total non-empty lines.
// Excludes 1- and 2-char lines (whitespace, dividers).
function dupRatio(text: string): number {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 2);
  if (lines.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  let dupes = 0;
  for (const [, n] of counts) if (n > 1) dupes += n - 1;
  return dupes / lines.length;
}

interface Row {
  url: string; slug: string; err?: string;
  charsOn: number; charsOff: number; ratio: number;
  dupOn: number; dupOff: number;
  canaryOk?: boolean; canaryDetails?: string;
  flags: string[];
}
const rows: Row[] = [];

let i = 0;
for (const url of URLS) {
  i++;
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  process.stderr.write(`[${i}/${URLS.length}] ${url} ... `);
  if (!(await nav(url))) {
    console.error("NAV FAIL");
    rows.push({ url, slug, err: "nav fail", charsOn: 0, charsOff: 0, ratio: 0, dupOn: 0, dupOff: 0, flags: [] });
    continue;
  }
  // PROD_READ_JS is `(() => {...})` (not invoked); STRIP_ON_READ_JS is
  // `(() => {...})()` (already invoked). Wrap PROD with call parens.
  const off = await readText(`(${PROD_READ_JS})()`);
  const on = await readText(STRIP_ON_READ_JS);
  if (off === null || on === null) {
    console.error("EVAL FAIL");
    rows.push({ url, slug, err: "eval fail", charsOn: 0, charsOff: 0, ratio: 0, dupOn: 0, dupOff: 0, flags: [] });
    continue;
  }
  writeFileSync(resolvePath(OUT_DIR, `${slug}.off.txt`), off);
  writeFileSync(resolvePath(OUT_DIR, `${slug}.on.txt`), on);
  const ratio = on.length > 0 ? off.length / on.length : 0;
  const dupOn = dupRatio(on), dupOff = dupRatio(off);
  const flags: string[] = [];
  if (off.length > 0 && off.length < on.length) flags.push("SHRANK");      // strip-off should never be shorter
  if (ratio > 3 && off.length > 200_000) flags.push("EXPLODED");           // 3x bigger AND over cap
  if (dupOff > 0.25 && dupOff > dupOn + 0.10) flags.push("DUP_SPIKE");     // duplication got significantly worse
  if (off.length === 0) flags.push("EMPTY");

  let canaryOk: boolean | undefined;
  let canaryDetails: string | undefined;
  if (CANARIES[url]) {
    const phrases = CANARIES[url];
    const inOff = phrases.filter(p => off.toLowerCase().includes(p.toLowerCase()));
    const inOn = phrases.filter(p => on.toLowerCase().includes(p.toLowerCase()));
    canaryOk = inOff.length === phrases.length && inOn.length === 0;
    canaryDetails = `off:[${inOff.join("|")}] on:[${inOn.join("|")}]`;
    if (!canaryOk) flags.push("CANARY_FAIL");
  }

  rows.push({
    url, slug, charsOn: on.length, charsOff: off.length,
    ratio, dupOn, dupOff, canaryOk, canaryDetails, flags,
  });
  console.error(`on=${on.length} off=${off.length} x${ratio.toFixed(2)} dup ${dupOn.toFixed(2)}→${dupOff.toFixed(2)}${flags.length ? " ⚠ " + flags.join(",") : ""}${canaryOk === true ? " ✓canary" : ""}${canaryOk === false ? " ✗canary " + canaryDetails : ""}`);
}

const md: string[] = [];
md.push("# strip-removed validation");
md.push("");
md.push(`${URLS.length} URLs. Two READ_JS variants per site, identical except for chrome strip. ratio = strip-off length / strip-on length (≥1 expected).`);
md.push("");
md.push("## False positives");
md.push("");
const fps = rows.filter(r => r.flags.length > 0 && !r.err);
if (fps.length === 0) {
  md.push("**None.** Every site that loaded returned non-empty strip-off output, never shorter than strip-on, no duplication spike, no canary regression.");
} else {
  md.push(`${fps.length} flagged sites:`);
  md.push("| site | charsOn | charsOff | ratio | dupOn | dupOff | flags |");
  md.push("|---|---:|---:|---:|---:|---:|---|");
  for (const r of fps) {
    md.push(`| ${r.url} | ${r.charsOn} | ${r.charsOff} | ${r.ratio.toFixed(2)} | ${r.dupOn.toFixed(2)} | ${r.dupOff.toFixed(2)} | ${r.flags.join(",")} |`);
  }
}
md.push("");
md.push("## Canary recoveries");
md.push("");
const canaryRows = rows.filter(r => r.canaryOk !== undefined);
md.push(`${canaryRows.filter(r => r.canaryOk).length}/${canaryRows.length} canaries: strip-off contains the lost phrase AND strip-on doesn't.`);
md.push("");
md.push("| site | canary | result |");
md.push("|---|---|---|");
for (const r of canaryRows) {
  md.push(`| ${r.url} | ${(CANARIES[r.url] || []).join(" + ")} | ${r.canaryOk ? "✓" : "✗"} ${r.canaryDetails || ""} |`);
}
md.push("");
md.push("## Top size deltas (sites where strip-off adds the most)");
md.push("");
md.push("| site | charsOn | charsOff | added | ratio |");
md.push("|---|---:|---:|---:|---:|");
const sorted = [...rows].filter(r => !r.err).sort((a, b) => (b.charsOff - b.charsOn) - (a.charsOff - a.charsOn));
for (const r of sorted.slice(0, 20)) {
  md.push(`| ${r.url} | ${r.charsOn} | ${r.charsOff} | +${r.charsOff - r.charsOn} | ${r.ratio.toFixed(2)} |`);
}
md.push("");
md.push("## Nav failures");
md.push("");
const navFails = rows.filter(r => r.err);
if (navFails.length === 0) md.push("None.");
else for (const r of navFails) md.push(`- ${r.url}: ${r.err}`);

md.push("");
md.push("## Aggregate");
md.push("");
const ok = rows.filter(r => !r.err);
const avgRatio = ok.reduce((s, r) => s + r.ratio, 0) / ok.length;
const medRatio = [...ok.map(r => r.ratio)].sort()[Math.floor(ok.length / 2)];
const totalAddedChars = ok.reduce((s, r) => s + (r.charsOff - r.charsOn), 0);
md.push(`- sites loaded: ${ok.length}/${rows.length}`);
md.push(`- avg ratio (off/on): ${avgRatio.toFixed(2)}x`);
md.push(`- median ratio: ${medRatio.toFixed(2)}x`);
md.push(`- total chars added across all sites: +${totalAddedChars}`);
md.push(`- sites with flags: ${fps.length}`);
md.push(`- canaries passing: ${canaryRows.filter(r => r.canaryOk).length}/${canaryRows.length}`);

writeFileSync(resolvePath(OUT_DIR, "REPORT.md"), md.join("\n"));
console.error(`\nReport: ${resolvePath(OUT_DIR, "REPORT.md")}`);

await client.close();
try { await CDP.Close({ port: CDP_PORT, id: newTab.id }); } catch {}
