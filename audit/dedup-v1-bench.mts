// stateful-scan-chrome-dedup v1 benchmark.
//
// Measures: scan output size (chars/tokens) in baseline (full emit always) vs
// dedup (state-aware) modes, across three scenarios per site:
//   1. scan #1 — baseline (no prior cache; full emit in both modes)
//   2. scan #2 — repeat scan with NO mutation between (this is where dedup pays)
//   3. scan #3 — after pressing the first PRESS element (real-world action)
//
// Per-site we compare matched scans head-to-head: both modes navigate to the
// same URL, both execute the same scenario, only the formatter differs.
//
// Goal: validate Q11=B (default-on) by showing meaningful reduction with no
// regressions in scan #1 (which both modes should emit identically).
//
// Run: CDP_PORT=9222 npx tsx audit/dedup-v1-bench.mts

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data/dedup-v1");
mkdirSync(OUT_DIR, { recursive: true });

const SITES = [
  // Same 20 sites as B0 (region-detector benchmark) for comparability.
  "https://en.wikipedia.org/wiki/Cat",
  "https://stackoverflow.com/questions",
  "https://github.com/anthropics/claude-code",
  "https://www.bbc.com/news",
  "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/main",
  "https://www.w3.org/",
  "https://music.youtube.com/",
  "https://www.linkedin.com/",
  "https://www.amazon.com/s?k=keyboard",
  "https://www.amazon.com/dp/B0CX4QTCCR",
  "https://www.google.com/travel/flights",
  "https://www.ebay.com/sch/i.html?_nkw=keyboard",
  "https://www.booking.com/searchresults.html?ss=tokyo",
  "https://www.airbnb.com/",
  "https://www.reddit.com/r/programming",
  "https://x.com/explore",
  "https://news.ycombinator.com/",
  "https://example.com/",
  "https://www.nytimes.com/",
  "https://www.notion.so/",
];

// ── Type defs (mirroring src/index.ts) ──

interface ScanEntry {
  id: number; tag: string; label: string; value?: string; inputType?: string;
  placeholder?: string; options?: string[]; checked?: boolean; href?: string;
  scrollContainer?: boolean; scrollMore?: number; affordance?: string;
  region?: string;
}
interface ScanResult {
  url: string; title: string;
  groups: Record<string, ScanEntry[]>;
  total: number;
  pageScrollable?: boolean;
}
interface ScanState {
  elementSigs: Map<number, string>;
  byRegion: Map<string, Set<number>>;
  title: string;
}

// ── Formatter (mirrors src/index.ts; duplicated to keep benchmark self-contained) ──

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
function dedupEntries(entries: ScanEntry[]): ScanEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = e.label + "|" + (e.href || "");
    if (!e.label || !seen.has(key)) { seen.add(key); return true; }
    return false;
  });
}
function fmtEntry(aff: string, e: ScanEntry): string {
  // Post-(c): no per-entry region suffix; regions promoted to scanner-side
  // disambiguator + dedup summary line only.
  if (aff === "PRESS") {
    const href = e.href ? ` → ${cleanHref(e.href)}` : "";
    return `  [${e.id}] ${e.tag} "${e.label}"${href}`;
  }
  if (aff === "TYPE") {
    const val = e.value ? ` value="${e.value}"` : "";
    const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
    return `  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`;
  }
  if (aff === "TOGGLE") {
    const state = e.checked ? "✓" : "○";
    return `  [${e.id}] ${e.tag} "${e.label}" ${state}`;
  }
  if (aff === "SELECT") {
    const opts = e.options?.join(", ") || "";
    return `  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`;
  }
  if (aff === "UPLOAD") return `  [${e.id}] input[file] "${e.label}"`;
  return `  [${e.id}] ${e.tag} "${e.label}"`;
}
const HEADERS: Record<string, string> = {
  PRESS: "PRESS → press(element)",
  TYPE: "TYPE → type(element, text)",
  SELECT: "SELECT → select(element, value)",
  TOGGLE: "TOGGLE → toggle(element)",
  UPLOAD: "UPLOAD → upload(element, filepath)",
};

function entrySig(e: ScanEntry, aff: string): string {
  return [aff, e.tag, e.label || "", e.href || "", e.value || "", e.checked ? "1" : "", e.region || ""].join("|");
}
function snapshotState(scan: ScanResult): ScanState {
  const elementSigs = new Map<number, string>();
  const byRegion = new Map<string, Set<number>>();
  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    for (const e of scan.groups[aff] || []) {
      elementSigs.set(e.id, entrySig(e, aff));
      const r = e.region || "_unassigned";
      if (!byRegion.has(r)) byRegion.set(r, new Set());
      byRegion.get(r)!.add(e.id);
    }
  }
  return { elementSigs, byRegion, title: scan.title };
}
function compactIds(ids: number[]): string {
  if (ids.length === 0) return "";
  const sorted = [...ids].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = sorted[i];
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
}

function formatFull(scan: ScanResult): string {
  const lines: string[] = [
    `Page: ${scan.title}`,
    `URL: ${scan.url}`,
    `Elements: ${scan.total}`,
  ];
  if (scan.pageScrollable) lines.push(`... more below — scroll() for next page`);
  lines.push("");
  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const g = scan.groups[aff];
    if (!g || g.length === 0) continue;
    lines.push(HEADERS[aff]);
    for (const e of dedupEntries(g)) lines.push(fmtEntry(aff, e));
    lines.push("");
  }
  return lines.join("\n");
}

function formatDedup(scan: ScanResult, prev: ScanState): string {
  const newIds = new Set<number>();
  const changedIds = new Set<number>();
  const unchangedIds = new Set<number>();
  const currentSigs = new Map<number, string>();
  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    for (const e of scan.groups[aff] || []) {
      const sig = entrySig(e, aff);
      currentSigs.set(e.id, sig);
      const prevSig = prev.elementSigs.get(e.id);
      if (prevSig === undefined) newIds.add(e.id);
      else if (prevSig !== sig) changedIds.add(e.id);
      else unchangedIds.add(e.id);
    }
  }
  const removedIds = new Set<number>();
  for (const id of prev.elementSigs.keys()) if (!currentSigs.has(id)) removedIds.add(id);
  const noChange = newIds.size === 0 && changedIds.size === 0 && removedIds.size === 0;

  const lines: string[] = [`Page: ${scan.title}`, `URL: ${scan.url}`];
  if (noChange) {
    lines.push(`Elements: ${scan.total} (unchanged since last scan, ids: ${compactIds([...unchangedIds])})`);
    if (scan.pageScrollable) lines.push(`... more below — scroll() for next page`);
    return lines.join("\n");
  }

  const parts: string[] = [];
  if (newIds.size) parts.push(`${newIds.size} new`);
  if (changedIds.size) parts.push(`${changedIds.size} changed`);
  if (removedIds.size) parts.push(`${removedIds.size} gone`);
  if (unchangedIds.size) parts.push(`${unchangedIds.size} unchanged`);
  lines.push(`Elements: ${scan.total} (${parts.join(", ")})`);
  if (scan.pageScrollable) lines.push(`... more below — scroll() for next page`);
  lines.push("");
  if (removedIds.size > 0) {
    lines.push(`GONE since last scan: ${compactIds([...removedIds])}`);
    lines.push("");
  }
  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const g = scan.groups[aff];
    if (!g || g.length === 0) continue;
    const nE = g.filter(e => newIds.has(e.id));
    const cE = g.filter(e => changedIds.has(e.id));
    const uE = g.filter(e => unchangedIds.has(e.id));
    if (nE.length === 0 && cE.length === 0 && uE.length === 0) continue;
    lines.push(HEADERS[aff]);
    for (const e of dedupEntries(nE)) lines.push(fmtEntry(aff, e) + "  ← new");
    for (const e of dedupEntries(cE)) lines.push(fmtEntry(aff, e) + "  ← changed");
    if (uE.length > 0) {
      const byRegion = new Map<string, number[]>();
      for (const e of uE) {
        const r = e.region || "_unassigned";
        if (!byRegion.has(r)) byRegion.set(r, []);
        byRegion.get(r)!.push(e.id);
      }
      const order = ["header", "nav", "search", "main", "aside", "footer", "modal", "_unassigned"];
      const sortedRegs = [...byRegion.keys()].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });
      const summaries: string[] = [];
      for (const reg of sortedRegs) {
        const ids = byRegion.get(reg)!;
        const display = reg === "_unassigned" ? "other" : reg;
        summaries.push(`${display}: ${ids.length} (${compactIds(ids)})`);
      }
      lines.push(`  Unchanged — ${summaries.join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ── Runner ──

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
process.setMaxListeners(200);

async function evalJS<T>(expr: string): Promise<T | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) return null;
    return result.value as T;
  } catch { return null; }
}

async function nav(url: string): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([
      Page.loadEventFired(),
      new Promise((_, r) => setTimeout(() => r(new Error("t")), 15000)),
    ]);
    await new Promise(r => setTimeout(r, 2000));
    return true;
  } catch { return false; }
}

async function scanOnce(): Promise<ScanResult | null> {
  return evalJS<ScanResult>(SCANNER_JS);
}

interface Row {
  url: string;
  scan1_full: number;
  scan1_dedup: number;
  scan2_full: number;     // repeat scan, no mutation
  scan2_dedup: number;
  scan3_full?: number;    // after a press
  scan3_dedup?: number;
  press_target?: string;  // label of the element we pressed
  press_ok?: boolean;
  err?: string;
}

const rows: Row[] = [];

for (const url of SITES) {
  const shortUrl = url.replace(/^https?:\/\//, "").substring(0, 50);
  console.log(`\n${shortUrl}`);

  const row: Row = { url, scan1_full: 0, scan1_dedup: 0, scan2_full: 0, scan2_dedup: 0 };

  if (!await nav(url)) { row.err = "nav timeout"; rows.push(row); console.log("  nav fail"); continue; }

  // First navigate also runs the scanner once via SCANNER_JS for ID init.
  // Reset state manually to ensure a fresh start per site.
  await evalJS(`(() => { delete window.__wpIdMap; delete window.__wpNextId; delete window.__webpilot; delete window.__webpilotRects; delete window.__webpilotLabels; delete window.__webpilotAffordances; delete window.__webpilotRegions; })()`);

  // Scenario 1: first scan — both modes emit full output (no prev state)
  const s1 = await scanOnce();
  if (!s1) { row.err = "scan1 fail"; rows.push(row); console.log("  scan1 fail"); continue; }
  row.scan1_full = formatFull(s1).length;
  row.scan1_dedup = formatFull(s1).length; // identical, no prev state
  let state = snapshotState(s1);

  // Scenario 2: repeat scan, no mutation
  const s2 = await scanOnce();
  if (!s2) { row.err = "scan2 fail"; rows.push(row); console.log("  scan2 fail"); continue; }
  row.scan2_full = formatFull(s2).length;
  row.scan2_dedup = formatDedup(s2, state).length;
  state = snapshotState(s2);

  // Scenario 3: press first PRESS element with a label, then scan
  const pressTargets = (s2.groups.PRESS || []).filter(e => e.label && e.label.length > 0 && e.label.length < 60);
  if (pressTargets.length > 0) {
    const target = pressTargets[0];
    row.press_target = target.label;
    const rect = await evalJS<{ x: number; y: number } | null>(
      `(() => { const r = window.__webpilotRects?.[${target.id}]; return r ? { x: r.x, y: r.y } : null; })()`
    );
    if (rect) {
      try {
        await client.Input.dispatchMouseEvent({ type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await new Promise(r => setTimeout(r, 1500));
        row.press_ok = true;
      } catch { row.press_ok = false; }
    }
    const s3 = await scanOnce();
    if (s3) {
      row.scan3_full = formatFull(s3).length;
      row.scan3_dedup = formatDedup(s3, state).length;
    }
  }

  rows.push(row);

  const fmtPct = (full: number, dedup: number) => {
    if (full === 0) return "-";
    const saved = ((full - dedup) / full * 100).toFixed(0);
    return `${dedup}/${full} (-${saved}%)`;
  };
  console.log(`  scan2 (no mut):   ${fmtPct(row.scan2_full, row.scan2_dedup)}`);
  if (row.scan3_full !== undefined) {
    console.log(`  scan3 (press):    ${fmtPct(row.scan3_full!, row.scan3_dedup!)} — pressed "${row.press_target}"`);
  }
}

await client.close();

writeFileSync(resolvePath(OUT_DIR, "results.json"), JSON.stringify(rows, null, 2));

// Aggregates
const okRows = rows.filter(r => !r.err);
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (full: number[], dedup: number[]) => {
  const ratios = full.map((f, i) => f > 0 ? (f - dedup[i]) / f : 0);
  return (avg(ratios) * 100).toFixed(1);
};

const s1Full = okRows.map(r => r.scan1_full);
const s1Dedup = okRows.map(r => r.scan1_dedup);
const s2Full = okRows.map(r => r.scan2_full);
const s2Dedup = okRows.map(r => r.scan2_dedup);
const s3Rows = okRows.filter(r => r.scan3_full !== undefined);
const s3Full = s3Rows.map(r => r.scan3_full!);
const s3Dedup = s3Rows.map(r => r.scan3_dedup!);

console.log("\n\n=== SUMMARY ===\n");
console.log(`Sites measured: ${okRows.length}/${SITES.length} (${rows.filter(r => r.err).length} failed)`);
console.log("");
console.log("Scenario       | avg full   | avg dedup  | reduction");
console.log("-".repeat(60));
console.log(`scan #1 (cold) | ${avg(s1Full).toFixed(0).padStart(10)} | ${avg(s1Dedup).toFixed(0).padStart(10)} | ${pct(s1Full, s1Dedup)}%  (expected 0% — no prev state)`);
console.log(`scan #2 (idle) | ${avg(s2Full).toFixed(0).padStart(10)} | ${avg(s2Dedup).toFixed(0).padStart(10)} | ${pct(s2Full, s2Dedup)}%`);
if (s3Rows.length > 0) {
  console.log(`scan #3 (post) | ${avg(s3Full).toFixed(0).padStart(10)} | ${avg(s3Dedup).toFixed(0).padStart(10)} | ${pct(s3Full, s3Dedup)}%  (${s3Rows.length} sites with press)`);
}

console.log("\nPer-site (chars):");
console.log(`${"site".padEnd(46)}|  scan2 full→dedup     |  scan3 full→dedup`);
console.log("-".repeat(110));
for (const r of okRows) {
  const u = r.url.replace(/^https?:\/\//, "").substring(0, 44).padEnd(46);
  const s2 = `${r.scan2_full}→${r.scan2_dedup} (-${((r.scan2_full - r.scan2_dedup) / r.scan2_full * 100).toFixed(0)}%)`.padEnd(22);
  const s3 = r.scan3_full !== undefined
    ? `${r.scan3_full}→${r.scan3_dedup} (-${((r.scan3_full! - r.scan3_dedup!) / r.scan3_full! * 100).toFixed(0)}%)`
    : "-";
  console.log(`${u}|  ${s2}|  ${s3}`);
}

console.log(`\nResults: ${OUT_DIR}/results.json`);
