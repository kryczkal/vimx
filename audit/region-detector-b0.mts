// B0 — region detector quality comparison.
//
// Compares three detection strategies for grouping elements into page regions
// (header/nav/main/aside/footer/modal/list-region). The chosen detector becomes
// the foundation of stateful-scan-chrome-dedup (hypothesis #1).
//
// Detectors:
//   A — ARIA-only: trust role attrs + HTML5 sections + modals
//   B — ARIA + position fallback: A; if <2 regions, derive from fixed positions
//       and repeated card patterns
//   C — Pipeline: ARIA → HTML5 → heading subgrouping → repeated patterns → position
//
// Per-site we capture: regions found (id, kind, bbox, element count contained),
// plus the full interactive-element list with each element's assigned region.
//
// Output: JSON per-site + summary table + per-site HTML overlay for eyeball verify.
//
// Run: CDP_PORT=9222 npx tsx audit/region-detector-b0.mts

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data/region-detector-b0");
mkdirSync(OUT_DIR, { recursive: true });

const SITES = [
  // ARIA-rich (6, 30%)
  { url: "https://en.wikipedia.org/wiki/Cat", tag: "aria-rich" },
  { url: "https://stackoverflow.com/questions", tag: "aria-rich" },
  { url: "https://github.com/anthropics/claude-code", tag: "aria-rich" },
  { url: "https://www.bbc.com/news", tag: "aria-rich" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/main", tag: "aria-rich" },
  { url: "https://www.w3.org/", tag: "aria-rich" },

  // ARIA-poor SPAs (10, 50%)
  { url: "https://music.youtube.com/", tag: "aria-poor" },
  { url: "https://www.linkedin.com/", tag: "aria-poor" },
  { url: "https://www.amazon.com/s?k=keyboard", tag: "aria-poor" },
  { url: "https://www.amazon.com/dp/B0CX4QTCCR", tag: "aria-poor" },
  { url: "https://www.google.com/travel/flights", tag: "aria-poor" },
  { url: "https://www.ebay.com/sch/i.html?_nkw=keyboard", tag: "aria-poor" },
  { url: "https://www.booking.com/searchresults.html?ss=tokyo", tag: "aria-poor" },
  { url: "https://www.airbnb.com/", tag: "aria-poor" },
  { url: "https://www.reddit.com/r/programming", tag: "aria-poor" },
  { url: "https://x.com/explore", tag: "aria-poor" },

  // Edge (4, 20%)
  { url: "https://news.ycombinator.com/", tag: "edge" },
  { url: "https://example.com/", tag: "edge" },
  { url: "https://www.nytimes.com/", tag: "edge" },
  { url: "https://www.notion.so/", tag: "edge" },
];

// ── Detector JS — all three return the same shape ──
//
// Each detector is a self-contained function that:
//   1. Identifies region containers via its strategy
//   2. Returns { regions: [{ id, kind, label, bbox }], elements: [{ tag, label, bbox, regionId }] }
//
// `elements` enumerates the same interactive set as our real scanner. We don't
// re-implement the full scanner here — we use a simplified "visible clickable"
// finder. The detector benchmark only needs to test classification quality,
// not element discovery quality (that's already validated in the existing
// scanner).

const COMMON_HELPERS = `
  function getBbox(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    if (r.bottom < 0 || r.top > innerHeight) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible" || cs.opacity === "0") return false;
    return true;
  }
  function getInteractiveElements() {
    const selectors = [
      "a[href]", "button", "input:not([type=hidden])", "select", "textarea",
      "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]",
      "[role=menuitem]", "[role=tab]", "[role=switch]", "[role=combobox]",
      "[onclick]", "[tabindex]:not([tabindex='-1'])"
    ];
    const found = [];
    const seen = new WeakSet();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        if (!isVisible(el)) continue;
        seen.add(el);
        found.push(el);
      }
    }
    return found;
  }
  function elementLabel(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.substring(0, 60);
    const text = (el.innerText || el.value || el.placeholder || "").trim().replace(/\\s+/g, " ");
    return text.substring(0, 60);
  }
  function elementsInBbox(els, bbox) {
    const result = [];
    for (let i = 0; i < els.length; i++) {
      const b = getBbox(els[i]);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      if (cx >= bbox.x && cx <= bbox.x + bbox.w &&
          cy >= bbox.y && cy <= bbox.y + bbox.h) {
        result.push(i);
      }
    }
    return result;
  }
  function elementInRegion(el, region) {
    const b = getBbox(el);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return cx >= region.bbox.x && cx <= region.bbox.x + region.bbox.w &&
           cy >= region.bbox.y && cy <= region.bbox.y + region.bbox.h;
  }
  function assignElementsToRegions(elements, regions) {
    // Smallest containing region wins (allows nested regions like list-items inside main)
    return elements.map((el, idx) => {
      let bestId = null;
      let bestArea = Infinity;
      for (const r of regions) {
        if (elementInRegion(el, r)) {
          const a = r.bbox.w * r.bbox.h;
          if (a < bestArea) { bestArea = a; bestId = r.id; }
        }
      }
      const b = getBbox(el);
      return {
        idx,
        tag: el.tagName.toLowerCase(),
        label: elementLabel(el),
        bbox: b,
        regionId: bestId
      };
    });
  }
`;

// Detector A — pure ARIA + HTML5 sections + modals
const DETECTOR_A = `(() => {
  ${COMMON_HELPERS}
  const regions = [];
  let nextId = 0;
  const seen = new WeakSet();

  const rules = [
    { sel: '[role="dialog"][aria-modal="true"], dialog[open]', kind: 'modal' },
    { sel: '[role="banner"], header', kind: 'header' },
    { sel: '[role="navigation"], nav', kind: 'nav' },
    { sel: '[role="search"]', kind: 'search' },
    { sel: '[role="main"], main', kind: 'main' },
    { sel: '[role="complementary"], aside', kind: 'aside' },
    { sel: '[role="contentinfo"], footer', kind: 'footer' },
    { sel: '[role="region"][aria-label]', kind: 'region' },
  ];

  for (const { sel, kind } of rules) {
    for (const el of document.querySelectorAll(sel)) {
      // Skip if a same-or-broader landmark already swallowed this
      let p = el.parentElement, nested = false;
      while (p) { if (seen.has(p)) { nested = true; break; } p = p.parentElement; }
      if (nested) continue;
      if (!isVisible(el)) continue;
      const bbox = getBbox(el);
      if (bbox.w < 50 || bbox.h < 30) continue;
      seen.add(el);
      regions.push({
        id: nextId++,
        kind,
        label: el.getAttribute('aria-label') || el.tagName.toLowerCase(),
        bbox
      });
    }
  }

  const els = getInteractiveElements();
  const elements = assignElementsToRegions(els, regions);
  return { regions, elements, detector: 'A' };
})()`;

// Detector B — A, then position fallback if too few regions
const DETECTOR_B = `(() => {
  ${COMMON_HELPERS}
  const regions = [];
  let nextId = 0;
  const seen = new WeakSet();

  // ARIA pass (same as A)
  const rules = [
    { sel: '[role="dialog"][aria-modal="true"], dialog[open]', kind: 'modal' },
    { sel: '[role="banner"], header', kind: 'header' },
    { sel: '[role="navigation"], nav', kind: 'nav' },
    { sel: '[role="search"]', kind: 'search' },
    { sel: '[role="main"], main', kind: 'main' },
    { sel: '[role="complementary"], aside', kind: 'aside' },
    { sel: '[role="contentinfo"], footer', kind: 'footer' },
    { sel: '[role="region"][aria-label]', kind: 'region' },
  ];

  for (const { sel, kind } of rules) {
    for (const el of document.querySelectorAll(sel)) {
      let p = el.parentElement, nested = false;
      while (p) { if (seen.has(p)) { nested = true; break; } p = p.parentElement; }
      if (nested) continue;
      if (!isVisible(el)) continue;
      const bbox = getBbox(el);
      if (bbox.w < 50 || bbox.h < 30) continue;
      seen.add(el);
      regions.push({
        id: nextId++, kind,
        label: el.getAttribute('aria-label') || el.tagName.toLowerCase(),
        bbox
      });
    }
  }

  // Position fallback if ARIA underdelivered
  if (regions.length < 2) {
    // Find fixed/sticky elements — likely chrome
    const allDivs = document.querySelectorAll('div, section, header, footer, nav, aside');
    const fixedCandidates = [];
    for (const el of allDivs) {
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const b = getBbox(el);
        if (b.w > 100 && b.h > 20) fixedCandidates.push({ el, bbox: b, position: cs.position });
      }
    }

    // Classify fixed elements by position
    for (const c of fixedCandidates) {
      let kind;
      if (c.bbox.y < 100 && c.bbox.w > innerWidth * 0.5) kind = 'header';
      else if (c.bbox.y + c.bbox.h > innerHeight - 100 && c.bbox.w > innerWidth * 0.5) kind = 'footer';
      else if (c.bbox.x < 100 && c.bbox.h > innerHeight * 0.4) kind = 'nav';
      else if (c.bbox.x + c.bbox.w > innerWidth - 100 && c.bbox.h > innerHeight * 0.4) kind = 'aside';
      else continue;
      regions.push({ id: nextId++, kind, label: 'position-' + kind, bbox: c.bbox, fallback: true });
    }

    // Synthesize a "main" region as the central remainder
    let mainTop = 0, mainBottom = innerHeight, mainLeft = 0, mainRight = innerWidth;
    for (const r of regions) {
      if (r.kind === 'header') mainTop = Math.max(mainTop, r.bbox.y + r.bbox.h);
      else if (r.kind === 'footer') mainBottom = Math.min(mainBottom, r.bbox.y);
      else if (r.kind === 'nav' && r.bbox.x < innerWidth * 0.3) mainLeft = Math.max(mainLeft, r.bbox.x + r.bbox.w);
      else if (r.kind === 'aside' && r.bbox.x > innerWidth * 0.5) mainRight = Math.min(mainRight, r.bbox.x);
    }
    if (mainBottom - mainTop > 100 && mainRight - mainLeft > 100) {
      regions.push({
        id: nextId++, kind: 'main', label: 'position-main',
        bbox: { x: mainLeft, y: mainTop, w: mainRight - mainLeft, h: mainBottom - mainTop },
        fallback: true
      });
    }
  }

  // Repeated card pattern detection (for list pages like search results)
  // Look for sets of siblings with similar bbox dimensions inside what we've
  // classified as main.
  const mainRegion = regions.find(r => r.kind === 'main');
  if (mainRegion) {
    const candidates = document.querySelectorAll('li, article, [class*="card"], [class*="item"], [class*="result"], [data-testid]');
    const bySig = new Map();
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      if (!elementInRegion(el, mainRegion)) continue;
      const b = getBbox(el);
      if (b.h < 50 || b.w < 100) continue;
      const sig = el.tagName + '|' + Math.round(b.h / 20) * 20 + '|' + Math.round(b.w / 50) * 50;
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push({ el, bbox: b });
    }
    for (const [sig, items] of bySig) {
      if (items.length < 3) continue;
      for (const item of items) {
        regions.push({
          id: nextId++, kind: 'list-item',
          label: 'pattern-' + sig.split('|')[0].toLowerCase(),
          bbox: item.bbox,
          fallback: true
        });
      }
    }
  }

  const els = getInteractiveElements();
  const elements = assignElementsToRegions(els, regions);
  return { regions, elements, detector: 'B' };
})()`;

// Detector C — full pipeline: ARIA → HTML5 → heading subgroups → repeated patterns → position
const DETECTOR_C = `(() => {
  ${COMMON_HELPERS}
  const regions = [];
  let nextId = 0;
  const claimed = new WeakSet();

  function add(kind, label, bbox, source) {
    regions.push({ id: nextId++, kind, label, bbox, source });
  }

  // Pass 1: ARIA explicit
  const aria = [
    { sel: '[role="dialog"][aria-modal="true"], dialog[open]', kind: 'modal' },
    { sel: '[role="banner"]', kind: 'header' },
    { sel: '[role="navigation"]', kind: 'nav' },
    { sel: '[role="search"]', kind: 'search' },
    { sel: '[role="main"]', kind: 'main' },
    { sel: '[role="complementary"]', kind: 'aside' },
    { sel: '[role="contentinfo"]', kind: 'footer' },
    { sel: '[role="region"][aria-label]', kind: 'region' },
  ];
  for (const { sel, kind } of aria) {
    for (const el of document.querySelectorAll(sel)) {
      let p = el.parentElement, skip = false;
      while (p) { if (claimed.has(p)) { skip = true; break; } p = p.parentElement; }
      if (skip || !isVisible(el)) continue;
      const b = getBbox(el);
      if (b.w < 50 || b.h < 30) continue;
      claimed.add(el);
      add(kind, el.getAttribute('aria-label') || kind, b, 'aria');
    }
  }

  // Pass 2: HTML5 sections (only those not already claimed by ARIA)
  const html5 = [
    { tag: 'header', kind: 'header' },
    { tag: 'nav', kind: 'nav' },
    { tag: 'main', kind: 'main' },
    { tag: 'aside', kind: 'aside' },
    { tag: 'footer', kind: 'footer' },
  ];
  for (const { tag, kind } of html5) {
    for (const el of document.getElementsByTagName(tag)) {
      let p = el.parentElement, skip = false;
      while (p) { if (claimed.has(p)) { skip = true; break; } p = p.parentElement; }
      if (skip || !isVisible(el)) continue;
      const b = getBbox(el);
      if (b.w < 50 || b.h < 30) continue;
      claimed.add(el);
      add(kind, el.tagName.toLowerCase(), b, 'html5');
    }
  }

  // Pass 3: Heading-based sub-regions inside main (h1/h2 only)
  const mainRegion = regions.find(r => r.kind === 'main');
  if (mainRegion) {
    const headings = document.querySelectorAll('h1, h2');
    let lastHeading = null;
    for (const h of headings) {
      if (!isVisible(h)) continue;
      if (!elementInRegion(h, mainRegion)) continue;
      const hb = getBbox(h);
      if (lastHeading) {
        // Region between previous heading and this one
        const top = lastHeading.bbox.y;
        const bottom = hb.y;
        if (bottom - top > 100) {
          add('section', lastHeading.label, {
            x: mainRegion.bbox.x,
            y: top,
            w: mainRegion.bbox.w,
            h: bottom - top
          }, 'heading');
        }
      }
      lastHeading = { bbox: hb, label: (h.innerText || '').substring(0, 40).trim() };
    }
    if (lastHeading) {
      const top = lastHeading.bbox.y;
      const bottom = mainRegion.bbox.y + mainRegion.bbox.h;
      if (bottom - top > 100) {
        add('section', lastHeading.label, {
          x: mainRegion.bbox.x, y: top, w: mainRegion.bbox.w, h: bottom - top
        }, 'heading');
      }
    }
  }

  // Pass 4: Repeated patterns (inside main if it exists, else page-wide)
  const containerForPatterns = mainRegion ? mainRegion : { bbox: { x: 0, y: 0, w: innerWidth, h: document.body.scrollHeight } };
  const patternCandidates = document.querySelectorAll('li, article, [class*="card"], [class*="item"], [class*="result"]');
  const bySig = new Map();
  for (const el of patternCandidates) {
    if (!isVisible(el)) continue;
    if (!elementInRegion(el, containerForPatterns)) continue;
    const b = getBbox(el);
    if (b.h < 50 || b.w < 100) continue;
    const sig = el.tagName + '|' + Math.round(b.h / 20) * 20 + '|' + Math.round(b.w / 50) * 50;
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push({ el, bbox: b });
  }
  for (const [sig, items] of bySig) {
    if (items.length < 3) continue;
    for (const item of items) {
      add('list-item', 'pattern-' + sig.split('|')[0].toLowerCase(), item.bbox, 'pattern');
    }
  }

  // Pass 5: Position fallback if structure is sparse
  if (regions.length < 2) {
    const cands = document.querySelectorAll('div, section');
    for (const el of cands) {
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const b = getBbox(el);
      if (b.w < 100 || b.h < 20) continue;
      let kind;
      if (b.y < 100 && b.w > innerWidth * 0.5) kind = 'header';
      else if (b.y + b.h > innerHeight - 100 && b.w > innerWidth * 0.5) kind = 'footer';
      else if (b.x < 100 && b.h > innerHeight * 0.4) kind = 'nav';
      else if (b.x + b.w > innerWidth - 100 && b.h > innerHeight * 0.4) kind = 'aside';
      else continue;
      add(kind, 'position-' + kind, b, 'position');
    }
  }

  const els = getInteractiveElements();
  const elements = assignElementsToRegions(els, regions);
  return { regions, elements, detector: 'C' };
})()`;

// ── Runner ──

interface RegionResult {
  id: number;
  kind: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
  source?: string;
  fallback?: boolean;
}
interface ElementResult {
  idx: number;
  tag: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
  regionId: number | null;
}
interface DetectorOutput {
  regions: RegionResult[];
  elements: ElementResult[];
  detector: string;
}
interface SiteResult {
  url: string;
  tag: string;
  ok: boolean;
  err?: string;
  detectorA?: DetectorOutput;
  detectorB?: DetectorOutput;
  detectorC?: DetectorOutput;
}

const client = await CDP({ port: 9222 });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function evalJS<T>(expr: string): Promise<T | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      console.error("  JS exception:", exceptionDetails.text);
      return null;
    }
    return result.value as T;
  } catch (e) {
    console.error("  eval failed:", (e as Error).message);
    return null;
  }
}

async function nav(url: string): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([
      Page.loadEventFired(),
      new Promise((_, r) => setTimeout(() => r(new Error("t")), 15000)),
    ]);
    await new Promise(r => setTimeout(r, 2500)); // settle
    return true;
  } catch {
    return false;
  }
}

const results: SiteResult[] = [];

for (const site of SITES) {
  const shortUrl = site.url.replace(/^https?:\/\//, "").substring(0, 50);
  console.log(`\n[${site.tag}] ${shortUrl}`);

  const r: SiteResult = { url: site.url, tag: site.tag, ok: false };
  if (!await nav(site.url)) {
    r.err = "nav timeout";
    results.push(r);
    console.log(`  nav fail`);
    continue;
  }

  const a = await evalJS<DetectorOutput>(DETECTOR_A);
  const b = await evalJS<DetectorOutput>(DETECTOR_B);
  const c = await evalJS<DetectorOutput>(DETECTOR_C);

  if (!a || !b || !c) {
    r.err = "detector eval fail";
    results.push(r);
    console.log(`  eval fail: A=${!!a} B=${!!b} C=${!!c}`);
    continue;
  }

  r.detectorA = a;
  r.detectorB = b;
  r.detectorC = c;
  r.ok = true;
  results.push(r);

  const fmt = (d: DetectorOutput) =>
    `${d.regions.length}r/${d.elements.length}e/${d.elements.filter(e => e.regionId !== null).length}cov`;
  console.log(`  A: ${fmt(a)}`);
  console.log(`  B: ${fmt(b)}`);
  console.log(`  C: ${fmt(c)}`);
}

await client.close();

// Write raw results
writeFileSync(resolvePath(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));

// ── Summary ──

function score(d: DetectorOutput | undefined) {
  if (!d) return null;
  const totalEls = d.elements.length;
  const covered = d.elements.filter(e => e.regionId !== null).length;
  const kinds = new Set(d.regions.map(r => r.kind));
  const subRegions = d.regions.filter(r => r.kind === 'list-item' || r.kind === 'section').length;
  return {
    regionCount: d.regions.length,
    elementCount: totalEls,
    coverage: totalEls > 0 ? covered / totalEls : 0,
    coveragePct: totalEls > 0 ? Math.round(100 * covered / totalEls) : 0,
    kinds: [...kinds].sort(),
    kindCount: kinds.size,
    subRegions,
    hasMain: kinds.has('main'),
    hasNav: kinds.has('nav'),
    hasHeader: kinds.has('header'),
    hasFooter: kinds.has('footer'),
  };
}

interface Summary {
  url: string;
  tag: string;
  ok: boolean;
  err?: string;
  scoreA: ReturnType<typeof score>;
  scoreB: ReturnType<typeof score>;
  scoreC: ReturnType<typeof score>;
}

const summary: Summary[] = results.map(r => ({
  url: r.url,
  tag: r.tag,
  ok: r.ok,
  err: r.err,
  scoreA: score(r.detectorA),
  scoreB: score(r.detectorB),
  scoreC: score(r.detectorC),
}));

writeFileSync(resolvePath(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

// Console table
console.log("\n\n=== SUMMARY ===\n");
console.log("site".padEnd(46) + " | A regions/cov% | B regions/cov% | C regions/cov%");
console.log("-".repeat(100));
for (const s of summary) {
  const u = s.url.replace(/^https?:\/\//, "").substring(0, 44).padEnd(46);
  if (!s.ok) {
    console.log(`${u} | ${s.err}`);
    continue;
  }
  const fa = `${s.scoreA!.regionCount}/${s.scoreA!.coveragePct}%`.padEnd(15);
  const fb = `${s.scoreB!.regionCount}/${s.scoreB!.coveragePct}%`.padEnd(15);
  const fc = `${s.scoreC!.regionCount}/${s.scoreC!.coveragePct}%`.padEnd(15);
  console.log(`${u} | ${fa}| ${fb}| ${fc}`);
}

// Aggregates
function avg(nums: number[]) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }

const okResults = summary.filter(s => s.ok);
const byTag = { "aria-rich": okResults.filter(s => s.tag === "aria-rich"),
                "aria-poor": okResults.filter(s => s.tag === "aria-poor"),
                "edge": okResults.filter(s => s.tag === "edge") };

console.log("\n=== AGGREGATES ===\n");
console.log("group".padEnd(14) + " | A avg-cov / hasMain | B avg-cov / hasMain | C avg-cov / hasMain");
console.log("-".repeat(100));
for (const [tag, items] of Object.entries(byTag)) {
  if (items.length === 0) continue;
  const f = (key: 'scoreA' | 'scoreB' | 'scoreC') => {
    const covs = items.map(i => i[key]!.coverage * 100);
    const mains = items.filter(i => i[key]!.hasMain).length;
    return `${avg(covs).toFixed(1)}% (${mains}/${items.length})`.padEnd(20);
  };
  console.log(`${tag.padEnd(14)} | ${f('scoreA')}| ${f('scoreB')}| ${f('scoreC')}`);
}

const all = okResults;
console.log("");
const detCount = (key: 'scoreA' | 'scoreB' | 'scoreC') => ({
  avgCov: avg(all.map(s => s[key]!.coverage * 100)).toFixed(1),
  hasMain: all.filter(s => s[key]!.hasMain).length,
  hasNav: all.filter(s => s[key]!.hasNav).length,
  avgRegions: avg(all.map(s => s[key]!.regionCount)).toFixed(1),
  avgSubRegions: avg(all.map(s => s[key]!.subRegions)).toFixed(1),
  zeroRegions: all.filter(s => s[key]!.regionCount === 0).length,
});
const a = detCount('scoreA'), b = detCount('scoreB'), c = detCount('scoreC');
console.log("OVERALL                | A                   | B                   | C");
console.log(`avg coverage           | ${a.avgCov}%               | ${b.avgCov}%               | ${c.avgCov}%`);
console.log(`avg regions/site       | ${a.avgRegions}                | ${b.avgRegions}                | ${c.avgRegions}`);
console.log(`avg sub-regions/site   | ${a.avgSubRegions}                | ${b.avgSubRegions}                | ${c.avgSubRegions}`);
console.log(`sites with main        | ${a.hasMain}/${all.length}               | ${b.hasMain}/${all.length}               | ${c.hasMain}/${all.length}`);
console.log(`sites with nav         | ${a.hasNav}/${all.length}               | ${b.hasNav}/${all.length}               | ${c.hasNav}/${all.length}`);
console.log(`zero-region sites      | ${a.zeroRegions}                  | ${b.zeroRegions}                  | ${c.zeroRegions}`);

console.log(`\nResults: ${OUT_DIR}/results.json`);
console.log(`Summary: ${OUT_DIR}/summary.json`);
