// "Which links are in read but not in scan?" — the structural question.
//
// scan() finds visible interactive elements in (roughly) the current viewport;
// off-viewport anchors are excluded by the cropRectToVisible filter Vimium
// inherits from. read() uses innerText, which captures the full rendered
// document including content below the fold.
//
// For each site we count, per <a href> element in the DOM:
//   in_scan       — the same element ref is in window.__webpilot[] after a scan
//   visible_now   — its bounding rect intersects the current viewport
//   cross_origin  — its absolute URL has a different origin than the page
//   has_text      — its visible innerText (trim) is ≥2 chars
//
// Output buckets per site:
//   A. anchors with text, in scan: scan can press, scan's href is lossy if cross-origin
//   B. anchors with text, off-viewport (not in scan): only read can surface
//   C. anchors without text: image/icon links — neither read-with-URL helps
//   D. fragment/javascript anchors: not navigable, excluded from both

import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROBE_JS = `(() => {
  const wp = window.__webpilot || {};
  const inScan = new Set();
  for (const k of Object.keys(wp)) inScan.add(wp[k]);

  const results = {
    total_anchors: 0,
    text_in_scan: 0,
    text_off_viewport: 0,
    text_zero_size_or_hidden: 0,
    no_text: 0,
    fragment_or_js: 0,
    text_in_scan_cross_origin: 0,
    text_off_viewport_cross_origin: 0,
    sample_off_viewport_text: [],
  };

  for (const a of document.querySelectorAll("a[href]")) {
    results.total_anchors++;
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) { results.fragment_or_js++; continue; }
    const text = (a.innerText || "").trim();
    if (text.length < 2) { results.no_text++; continue; }

    let url;
    try { url = new URL(href, location.href); } catch { results.fragment_or_js++; continue; }
    const isCrossOrigin = url.origin !== location.origin;

    const isInScan = inScan.has(a);
    if (isInScan) {
      results.text_in_scan++;
      if (isCrossOrigin) results.text_in_scan_cross_origin++;
      continue;
    }

    // Not in scan. Why? Either zero-size, hidden, or off-viewport.
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { results.text_zero_size_or_hidden++; continue; }
    const cs = getComputedStyle(a);
    if (cs.display === "none" || cs.visibility === "hidden") { results.text_zero_size_or_hidden++; continue; }

    // Has text, has size, is rendered — must be off-viewport from scan's POV.
    results.text_off_viewport++;
    if (isCrossOrigin) results.text_off_viewport_cross_origin++;
    if (results.sample_off_viewport_text.length < 4) {
      results.sample_off_viewport_text.push(text.substring(0, 60) + " → " + url.href.substring(0, 80));
    }
  }
  return results;
})()`;

const SITES = [
  "https://en.wikipedia.org/wiki/Cat",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/API/Element",
  "https://nodejs.org/api/fs.html",
  "https://news.ycombinator.com/",
  "https://old.reddit.com/r/news",
  "https://www.reddit.com/r/programming",
  "https://dev.to/",
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://arstechnica.com/",
  "https://github.com/trending",
  "https://github.com/microsoft/vscode/issues",
  "https://stackoverflow.com/questions",
  "https://www.google.com/search?q=hello",
  "https://www.amazon.com/s?k=keyboard",
  "https://www.ebay.com/sch/i.html?_nkw=keyboard",
  "https://example.com/",
  "https://arxiv.org/",
];

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
process.setMaxListeners(100);

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

interface Bucket {
  url: string;
  total: number;
  in_scan: number;
  off_viewport: number;
  no_text: number;
  zero_or_hidden: number;
  fragment: number;
  in_scan_cross: number;
  off_viewport_cross: number;
  samples: string[];
}
const results: Bucket[] = [];

console.log(`${"site".padEnd(50)} ${"total".padStart(6)} ${"scan".padStart(6)} ${"offview".padStart(8)} ${"X-orig:scan/offview".padStart(20)}`);
console.log("-".repeat(94));

for (const url of SITES) {
  if (!await nav(url)) { console.log(`  ${url} nav fail`); continue; }
  await evalJS(SCANNER_JS);
  const r = await evalJS<{
    total_anchors: number; text_in_scan: number; text_off_viewport: number;
    text_zero_size_or_hidden: number; no_text: number; fragment_or_js: number;
    text_in_scan_cross_origin: number; text_off_viewport_cross_origin: number;
    sample_off_viewport_text: string[];
  }>(PROBE_JS);
  if (!r) { console.log(`  ${url} probe fail`); continue; }
  results.push({
    url, total: r.total_anchors,
    in_scan: r.text_in_scan, off_viewport: r.text_off_viewport,
    no_text: r.no_text, zero_or_hidden: r.text_zero_size_or_hidden, fragment: r.fragment_or_js,
    in_scan_cross: r.text_in_scan_cross_origin, off_viewport_cross: r.text_off_viewport_cross_origin,
    samples: r.sample_off_viewport_text,
  });
  console.log(
    `  ${url.replace(/^https?:\/\//, "").slice(0, 48).padEnd(48)}` +
    `${String(r.total_anchors).padStart(6)} ${String(r.text_in_scan).padStart(6)} ${String(r.text_off_viewport).padStart(8)} ${(r.text_in_scan_cross_origin + "/" + r.text_off_viewport_cross_origin).padStart(20)}`
  );
}

writeFileSync(resolvePath(__dirname, "data", "link-overlap.json"), JSON.stringify(results, null, 2));

let T = 0, S = 0, O = 0, NT = 0, ZH = 0, F = 0, SC = 0, OC = 0;
for (const r of results) {
  T += r.total; S += r.in_scan; O += r.off_viewport; NT += r.no_text;
  ZH += r.zero_or_hidden; F += r.fragment; SC += r.in_scan_cross; OC += r.off_viewport_cross;
}
console.log(`\n=== Aggregate across ${results.length} sites ===`);
console.log(`Total anchors with href:            ${T}`);
console.log(`  with text, in scan:               ${S}  (${(S/T*100).toFixed(0)}%)`);
console.log(`  with text, off-viewport:          ${O}  (${(O/T*100).toFixed(0)}%) ← only read can surface these`);
console.log(`  with text, zero-size or hidden:   ${ZH}  (${(ZH/T*100).toFixed(0)}%)`);
console.log(`  no text (icon/image links):       ${NT}  (${(NT/T*100).toFixed(0)}%)`);
console.log(`  javascript:/fragment only:        ${F}  (${(F/T*100).toFixed(0)}%)`);
console.log(`\nCross-origin breakdown (scan's href is lossy for these):`);
console.log(`  in scan, cross-origin:            ${SC}  ← scan strips host, agent can press but not navigate(url)`);
console.log(`  off-viewport, cross-origin:       ${OC}  ← only read URL works`);

console.log(`\n=== Sample off-viewport links (read sees, scan misses) ===`);
for (const r of results.slice(0, 6)) {
  if (r.off_viewport === 0) continue;
  console.log(`\n  ${r.url}`);
  for (const s of r.samples) console.log(`    ${s}`);
}

await client.close();
