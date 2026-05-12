// Benchmark: scan with viewport filter (current) vs scan without it.
//
// The "without viewport" variant is the current SCANNER_JS with
// cropRectToVisible's position-based filter stripped. We still keep the size
// filter (≥3px width AND height) — that's what excludes truly invisible
// elements regardless of position.
//
// Metrics, per site:
//   - element count from scan (`total` field of ScanResult)
//   - formatted-output char count (formatScanResult — what the model actually sees)
//   - approx tokens = chars / 4
// Aggregated: deltas across all sites, ratio per site.

import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Variant: drop two viewport-bound filters in SCANNER_JS:
//   1. cropRectToVisible — currently rejects rects below innerHeight-4 or right of innerWidth-4
//   2. overlap detection via elementFromPoint — elementFromPoint only resolves
//      coords inside the viewport, so off-viewport rects always fail the hit test
//
// We patch (1) to keep size-only filtering, and patch (2) to short-circuit
// off-viewport elements past the hit test (they can't be tested geometrically,
// so we accept them as candidates — agent's press path already calls
// scrollIntoView before clicking).
let SCANNER_NO_VP = SCANNER_JS.replace(
  /function cropRectToVisible\(rect\) \{[\s\S]*?return bounded;\s*\}/,
  `function cropRectToVisible(rect) {
    if (rect.width < 3 || rect.height < 3) return null;
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }`
);

// Short-circuit the overlap detection for off-viewport hints. The original
// loop runs pointReachesHint() at center then corners; we inject an early
// `results.push` for any rect that's entirely off-viewport.
SCANNER_NO_VP = SCANNER_NO_VP.replace(
  `for (const hint of filtered) {
    if (hint.iframeEditor) { results.push(hint); continue; }
    const r = hint.rect;
    if (pointReachesHint(hint, r.left + r.width * 0.5, r.top + r.height * 0.5)) {`,
  `for (const hint of filtered) {
    if (hint.iframeEditor) { results.push(hint); continue; }
    const r = hint.rect;
    if (r.top >= innerHeight || r.bottom <= 0 || r.left >= innerWidth || r.right <= 0) {
      results.push(hint); continue;
    }
    if (pointReachesHint(hint, r.left + r.width * 0.5, r.top + r.height * 0.5)) {`
);

// Sanity check: both replacements must have fired.
if (SCANNER_NO_VP === SCANNER_JS) {
  console.error("ERROR: neither patch matched"); process.exit(1);
}
if (!SCANNER_NO_VP.includes("results.push(hint); continue;\n    }\n    if (pointReachesHint")) {
  console.error("ERROR: overlap-detection patch did not match"); process.exit(1);
}

// Mirror of src/index.ts formatScanResult — verbatim, since char count of
// formatted output is the metric the model actually sees.

interface ScanEntry {
  id: number; tag: string; label: string; value?: string; inputType?: string;
  placeholder?: string; options?: string[]; checked?: boolean; href?: string;
  scrollContainer?: boolean; scrollMore?: number; affordance?: string;
}
interface ScanResult {
  url: string; title: string; groups: Record<string, ScanEntry[]>;
  total: number; pageScrollable?: boolean;
}

function cleanHref(href: string): string {
  const qIdx = href.indexOf("?");
  if (qIdx === -1) return href;
  const path = href.substring(0, qIdx);
  const params = href.substring(qIdx + 1).split("&");
  const kept = params.filter(p => {
    const eq = p.indexOf("=");
    if (eq === -1) return true;
    const val = p.substring(eq + 1);
    const hasWord = /[a-z]{4,}/.test(val);
    const hasStructure = /[+]|%20|%3A|%26|%2F|%3D/i.test(val);
    return !((val.length > 16 && !hasWord) || (val.length > 32 && !hasStructure));
  });
  return kept.length === 0 ? path : path + "?" + kept.join("&");
}
function dedup(entries: ScanEntry[]): ScanEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = e.label + "|" + (e.href || "");
    if (!e.label || !seen.has(key)) { seen.add(key); return true; }
    return false;
  });
}
function formatGroup(entries: ScanEntry[], formatter: (e: ScanEntry) => string): string[] {
  const lines: string[] = [];
  let lastScrollMore: number | null = null;
  let lastScrollLabel: string | null = null;
  for (const e of dedup(entries)) {
    lines.push(formatter(e));
    if (e.scrollContainer && e.scrollMore) { lastScrollMore = e.scrollMore; lastScrollLabel = e.label; }
    else if (lastScrollMore !== null && !e.scrollContainer) {
      lines.splice(lines.length - 1, 0, `  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
      lastScrollMore = null; lastScrollLabel = null;
    }
  }
  if (lastScrollMore !== null) {
    lines.push(`  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
  }
  return lines;
}
function formatScanResult(scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);
  lines.push(`Elements: ${scan.total}`);
  if (scan.pageScrollable) lines.push(`... more below — scroll() for next page`);
  lines.push("");
  if (scan.groups.PRESS?.length > 0) {
    lines.push("PRESS → press(element)");
    lines.push(...formatGroup(scan.groups.PRESS, e => {
      const href = e.href ? ` → ${cleanHref(e.href)}` : "";
      return `  [${e.id}] ${e.tag} "${e.label}"${href}`;
    }));
    lines.push("");
  }
  if (scan.groups.TYPE?.length > 0) {
    lines.push("TYPE → type(element, text)");
    lines.push(...formatGroup(scan.groups.TYPE, e => {
      const val = e.value ? ` value="${e.value}"` : "";
      const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
      return `  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`;
    }));
    lines.push("");
  }
  if (scan.groups.SELECT?.length > 0) {
    lines.push("SELECT → select(element, value)");
    lines.push(...formatGroup(scan.groups.SELECT, e => {
      const opts = e.options?.join(", ") || "";
      return `  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`;
    }));
    lines.push("");
  }
  if (scan.groups.TOGGLE?.length > 0) {
    lines.push("TOGGLE → toggle(element)");
    lines.push(...formatGroup(scan.groups.TOGGLE, e => {
      const state = e.checked ? "✓" : "○";
      return `  [${e.id}] ${e.tag} "${e.label}" ${state}`;
    }));
    lines.push("");
  }
  if (scan.groups.UPLOAD?.length > 0) {
    lines.push("UPLOAD → upload(element, filepath)");
    lines.push(...formatGroup(scan.groups.UPLOAD, e => `  [${e.id}] input[file] "${e.label}"`));
    lines.push("");
  }
  return lines.join("\n");
}

const SITES = [
  // Search (5)
  "https://www.google.com/search?q=hello",
  "https://www.bing.com/search?q=hello",
  "https://duckduckgo.com/?q=cats&ia=web",
  "https://search.brave.com/search?q=hello",
  "https://www.qwant.com/?q=hello",
  // News (10)
  "https://news.ycombinator.com/",
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://arstechnica.com/",
  "https://www.theverge.com/",
  "https://www.theguardian.com/international",
  "https://www.reuters.com/",
  "https://www.economist.com/",
  "https://www.nytimes.com/",
  "https://www.washingtonpost.com/",
  // Social/forum (8)
  "https://www.reddit.com/",
  "https://old.reddit.com/r/news",
  "https://www.reddit.com/r/programming",
  "https://www.linkedin.com/",
  "https://twitter.com/",
  "https://www.pinterest.com/",
  "https://news.ycombinator.com/newest",
  "https://lobste.rs/",
  // Dev / code (12)
  "https://github.com/",
  "https://github.com/trending",
  "https://github.com/explore",
  "https://github.com/microsoft/vscode/issues",
  "https://github.com/microsoft/vscode/pulls",
  "https://gitlab.com/explore",
  "https://stackoverflow.com/",
  "https://stackoverflow.com/questions",
  "https://www.npmjs.com/search?q=react",
  "https://pypi.org/",
  "https://crates.io/",
  "https://dev.to/",
  // Docs / reference (15)
  "https://en.wikipedia.org/wiki/Cat",
  "https://en.wikipedia.org/wiki/John_Hopfield",
  "https://en.wikipedia.org/wiki/Python_(programming_language)",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://en.wikipedia.org/wiki/Carl_Linnaeus",
  "https://developer.mozilla.org/en-US/docs/Web/API/Element",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "https://docs.python.org/3/library/stdtypes.html",
  "https://nodejs.org/api/fs.html",
  "https://nodejs.org/api/http.html",
  "https://www.rust-lang.org/learn",
  "https://nginx.org/en/docs/",
  "https://wiki.archlinux.org/",
  "https://developer.chrome.com/docs",
  "https://www.w3.org/",
  // E-commerce (10)
  "https://www.amazon.com/s?k=keyboard",
  "https://www.amazon.com/s?k=monitor",
  "https://www.ebay.com/sch/i.html?_nkw=keyboard",
  "https://www.etsy.com/search?q=keyboard",
  "https://www.target.com/s?searchTerm=keyboard",
  "https://www.bestbuy.com/site/searchpage.jsp?st=keyboard",
  "https://www.walmart.com/search?q=keyboard",
  "https://www.aliexpress.com/wholesale?SearchText=keyboard",
  "https://www.newegg.com/p/pl?d=keyboard",
  "https://www.ikea.com/us/en/search/?q=desk",
  // Multimedia (5)
  "https://www.youtube.com/",
  "https://www.youtube.com/results?search_query=cats",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://vimeo.com/",
  "https://www.twitch.tv/directory",
  // SaaS / cloud (8)
  "https://www.cloudflare.com/",
  "https://aws.amazon.com/",
  "https://cloud.google.com/",
  "https://azure.microsoft.com/en-us/",
  "https://www.mozilla.org/en-US/",
  "https://vercel.com/",
  "https://www.netlify.com/",
  "https://www.notion.so/",
  // Long tail / misc (12)
  "https://example.com/",
  "https://www.weather.com/",
  "https://www.accuweather.com/",
  "https://arxiv.org/",
  "https://scholar.google.com/scholar?q=hello",
  "https://www.science.org/",
  "https://www.python.org/",
  "https://nodejs.org/en",
  "https://kernel.org/",
  "https://www.iana.org/",
  "https://news.mit.edu/",
  "https://www.nature.com/",
  // Government / org (5)
  "https://www.usa.gov/",
  "https://www.un.org/en/",
  "https://europa.eu/",
  "https://www.gov.uk/",
  "https://www.whitehouse.gov/",
  // SPAs / dashboards (5)
  "https://app.netlify.com/",
  "https://developer.android.com/",
  "https://flutter.dev/",
  "https://reactjs.org/",
  "https://vuejs.org/",
  // International / non-English (5)
  "https://www.bbc.co.uk/",
  "https://www.bbc.com/sport",
  "https://www.aljazeera.com/",
  "https://www.lemonde.fr/",
  "https://www.spiegel.de/",
];

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
process.setMaxListeners(200);

async function evalJS<T>(expr: string): Promise<T | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) return null;
    return result.value as T;
  } catch { return null; }
}

async function nav(url: string): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([Page.loadEventFired(), new Promise((_, r) => setTimeout(() => r(new Error("t")), 12000))]);
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch { return false; }
}

interface Row {
  url: string;
  cur_elems: number; cur_chars: number; cur_tokens: number;
  nov_elems: number; nov_chars: number; nov_tokens: number;
  cur_press: number; nov_press: number;
  cur_type: number; nov_type: number;
}
const rows: Row[] = [];

console.log(`${"site".padEnd(50)} ${"cur".padStart(5)}/${"nov".padStart(5)}  ${"cur_kch".padStart(7)} ${"nov_kch".padStart(7)}  ${"x"}`);
console.log("-".repeat(90));

let okCount = 0, failCount = 0;
for (const url of SITES) {
  if (!await nav(url)) { console.log(`  ${url.replace(/^https?:\/\//, "").slice(0, 48).padEnd(48)} nav fail`); failCount++; continue; }
  const cur = await evalJS<ScanResult>(SCANNER_JS);
  const nov = await evalJS<ScanResult>(SCANNER_NO_VP);
  if (!cur || !nov) { console.log(`  ${url.replace(/^https?:\/\//, "").slice(0, 48).padEnd(48)} scan fail`); failCount++; continue; }
  const curTxt = formatScanResult(cur);
  const novTxt = formatScanResult(nov);
  const row: Row = {
    url,
    cur_elems: cur.total, cur_chars: curTxt.length, cur_tokens: Math.round(curTxt.length / 4),
    nov_elems: nov.total, nov_chars: novTxt.length, nov_tokens: Math.round(novTxt.length / 4),
    cur_press: cur.groups.PRESS?.length || 0, nov_press: nov.groups.PRESS?.length || 0,
    cur_type: cur.groups.TYPE?.length || 0, nov_type: nov.groups.TYPE?.length || 0,
  };
  rows.push(row);
  okCount++;
  const ratio = row.cur_chars > 0 ? (row.nov_chars / row.cur_chars).toFixed(1) + "×" : "—";
  console.log(
    `  ${url.replace(/^https?:\/\//, "").slice(0, 48).padEnd(48)} ` +
    `${String(row.cur_elems).padStart(5)}/${String(row.nov_elems).padStart(5)}  ` +
    `${(row.cur_chars/1000).toFixed(1).padStart(7)} ${(row.nov_chars/1000).toFixed(1).padStart(7)}  ${ratio}`
  );
}

writeFileSync(resolvePath(__dirname, "data", "scan-viewport-bench.json"), JSON.stringify(rows, null, 2));

let cur_elems = 0, nov_elems = 0, cur_chars = 0, nov_chars = 0;
let cur_press = 0, nov_press = 0, cur_type = 0, nov_type = 0;
for (const r of rows) {
  cur_elems += r.cur_elems; nov_elems += r.nov_elems;
  cur_chars += r.cur_chars; nov_chars += r.nov_chars;
  cur_press += r.cur_press; nov_press += r.nov_press;
  cur_type += r.cur_type; nov_type += r.nov_type;
}
console.log(`\n=== Aggregate across ${rows.length} sites (${failCount} failed) ===`);
console.log(`Element counts (window.__webpilot total):`);
console.log(`  current (viewport-bound):  ${cur_elems}`);
console.log(`  no viewport filter:        ${nov_elems}  (${(nov_elems/cur_elems).toFixed(2)}×)`);
console.log(`\nFormatted output chars (what the model sees):`);
console.log(`  current:                   ${cur_chars.toLocaleString()}  (~${Math.round(cur_chars/4).toLocaleString()} tokens)`);
console.log(`  no viewport filter:        ${nov_chars.toLocaleString()}  (~${Math.round(nov_chars/4).toLocaleString()} tokens)`);
console.log(`  delta per scan call:       +${Math.round((nov_chars - cur_chars) / rows.length).toLocaleString()} chars avg (~${Math.round((nov_chars - cur_chars) / rows.length / 4).toLocaleString()} tokens)`);
console.log(`\nAffordance breakdown (after dedup):`);
console.log(`  PRESS:  current ${cur_press}, no-vp ${nov_press} (${(nov_press/cur_press).toFixed(2)}×)`);
console.log(`  TYPE:   current ${cur_type}, no-vp ${nov_type} (${(nov_type/(cur_type||1)).toFixed(2)}×)`);

const sortedByDelta = [...rows].sort((a, b) => (b.nov_chars - b.cur_chars) - (a.nov_chars - a.cur_chars));
console.log(`\n=== Top 10 worst regressions (largest absolute char delta) ===`);
console.log(`${"site".padEnd(50)} ${"cur".padStart(5)} ${"nov".padStart(5)}  ${"+chars".padStart(8)}  ${"+tokens".padStart(8)}`);
for (const r of sortedByDelta.slice(0, 10)) {
  console.log(
    `  ${r.url.replace(/^https?:\/\//, "").slice(0, 48).padEnd(48)} ${String(r.cur_elems).padStart(5)} ${String(r.nov_elems).padStart(5)}  ${String(r.nov_chars - r.cur_chars).padStart(8)}  ${String(Math.round((r.nov_chars - r.cur_chars)/4)).padStart(8)}`
  );
}

await client.close();
