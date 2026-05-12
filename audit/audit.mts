// Audit harness: capture exactly what the model sees from each webpilot tool,
// under commit-5 (HEAD~5 = d7d84e3) vs the current working tree (HEAD + WIP).
//
// What changed between the two regimes (verified via `git diff HEAD~5..HEAD`):
//   • SCANNER_JS — disambiguation: identical-label buttons (no href) now get
//     row/sibling suffixes; commit 5 left them collapsed and the formatter
//     dedup'd to a single line. Affects scan output AND every label-based
//     tool call downstream.
//   • READ_JS — multi-root walk (portal-rendered dialogs / shadow component
//     hosts at <body> level), shadow-root descent, isRoot offsetParent
//     exemption.
//   • index.ts read() — WIP: now walks iframes via CDP isolated worlds and
//     merges with section markers; query filter moved from JS-side to TS-side
//     (line-based) so it sees iframe content too.
//
// Everything else (RESOLVE_JS, SELECT_JS, GET_RECT_JS, CHECK_JS,
// FRAME_SCANNER_JS, formatScanResult/cleanHref/formatGroup/dedup, scanFrames)
// is byte-identical between the two regimes. Tools that don't include scan
// output in their reply (key, dialog, tabs, switch_tab, expand, upload) are
// trivially identical and not exercised here — listed in the README of the
// data dir for completeness.
//
// We capture six classes of example per site:
//   1.  scan                  — the literal text scan() would return
//   2.  read.no_query         — the literal text read() would return, no filter
//   3.  read.query            — read() with a query string
//   4.  resolve.same_input    — RESOLVE_JS(label, null) where `label` is the
//                                same string under both regimes (probes whether
//                                the disambig'd scan output still resolves)
//   5.  resolve.scan_label    — RESOLVE_JS using each regime's OWN scan label,
//                                which under HEAD includes disambig suffixes
//   6.  press.delta           — formatDelta() of a no-op rescan, which is what
//                                press/type/toggle/hover/navigate/scroll show
//                                the model after acting. Identical here only
//                                because the underlying scan differs.
//
// Output: one JSONL line per example to audit/data/examples.jsonl, plus a
// site-level summary at audit/data/sites.json.

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync, appendFileSync, existsSync, unlinkSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import {
  SCANNER_JS as NOW_SCANNER_JS,
  READ_JS as NOW_READ_JS,
  RESOLVE_JS as NOW_RESOLVE_JS,
  FRAME_SCANNER_JS,
} from "../src/scanner.ts";
import {

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);
  SCANNER_JS as OG_SCANNER_JS,
  READ_JS as OG_READ_JS,
  RESOLVE_JS as OG_RESOLVE_JS,
} from "./scanner-og.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolvePath(__dirname, "data");
const EXAMPLES_PATH = resolvePath(DATA_DIR, "examples.jsonl");
const SITES_PATH = resolvePath(DATA_DIR, "sites.json");
const RAW_DIR = resolvePath(DATA_DIR, "raw");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });
if (existsSync(EXAMPLES_PATH)) unlinkSync(EXAMPLES_PATH);

// ── Formatter (verbatim copy of src/index.ts formatScanResult + helpers; the
// formatter is byte-identical between HEAD~5 and HEAD, so using the same
// implementation for both regimes is correct). ─────────────────────────────

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
    const bStrip = val.length > 16 && !hasWord;
    const aStrip = val.length > 32 && !hasStructure;
    return !(bStrip || aStrip);
  });
  if (kept.length === 0) return path;
  return path + "?" + kept.join("&");
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
    if (e.scrollContainer && e.scrollMore) {
      lastScrollMore = e.scrollMore; lastScrollLabel = e.label;
    } else if (lastScrollMore !== null && !e.scrollContainer) {
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

// ── CDP wrapper ────────────────────────────────────────────────────────────

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime, Target } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
process.setMaxListeners(100);

async function evalJS<T>(expr: string): Promise<T> {
  const { result, exceptionDetails } = await Runtime.evaluate({
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value as T;
}

async function nav(url: string, timeoutMs = 15000): Promise<boolean> {
  try {
    await Page.navigate({ url });
    await Promise.race([
      Page.loadEventFired(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("nav timeout")), timeoutMs)),
    ]);
    // Belt-and-suspenders: a fixed pause so dynamic content has a chance to
    // settle. Mirrors what the prod waitForSettle path would have done by the
    // time the model called scan().
    await new Promise(r => setTimeout(r, 2000));
    return true;
  } catch {
    return false;
  }
}

// Replicate readFrames from the current src/index.ts. (Iframe walk under CDP
// isolated worlds, per-frame timeout, ≥50 char threshold.) This is part of the
// "now" read path; OG read had no equivalent.
async function readFramesNow(perFrameTimeoutMs = 200): Promise<{ url: string; text: string }[]> {
  let frameTree;
  try {
    const ft = await Page.getFrameTree();
    frameTree = ft.frameTree;
  } catch {
    return [];
  }
  const mainFrameId = (frameTree as { frame: { id: string } }).frame.id;
  const allFrames: { id: string; url: string }[] = [];
  function collect(node: { frame: { id: string; url: string }; childFrames?: unknown[] }) {
    if (node.frame.id !== mainFrameId) {
      allFrames.push({ id: node.frame.id, url: node.frame.url });
    }
    for (const child of (node.childFrames || []) as typeof node[]) collect(child);
  }
  collect(frameTree as Parameters<typeof collect>[0]);
  if (allFrames.length === 0) return [];

  const results: { url: string; text: string }[] = [];
  // Per-frame isolated world via Page.createIsolatedWorld → Runtime.evaluate
  // with the returned executionContextId. This is what the prod scanFrames/
  // readFrames path uses (via cdp.ts evaluateInFrame helper).
  for (const f of allFrames) {
    try {
      const { executionContextId } = await client.Page.createIsolatedWorld({
        frameId: f.id,
        worldName: "wp_audit",
        grantUniveralAccess: true,
      });
      const evalRes = await Promise.race([
        Runtime.evaluate({
          expression: `${NOW_READ_JS}(null).text`,
          contextId: executionContextId,
          returnByValue: true,
          awaitPromise: true,
        }),
        new Promise<null>(r => setTimeout(() => r(null), perFrameTimeoutMs)),
      ]);
      if (evalRes && (evalRes as any).result) {
        const txt = ((evalRes as any).result.value as string) || "";
        if (typeof txt === "string" && txt.trim().length >= 50) {
          results.push({ url: f.url, text: txt.trim() });
        }
      }
    } catch {}
  }

  // Strip duplicates (some sites enumerate the same frame multiple times).
  const seen = new Set<string>();
  return results.filter(r => {
    const k = r.text.slice(0, 200);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Reproduce read() exactly as each regime would have returned it.
async function readOG(query: string | null): Promise<string> {
  // commit-5 path: READ_JS(query).text  (internal substring filter, no frames)
  const arg = query ? JSON.stringify(query) : "null";
  return await evalJS<string>(`(${OG_READ_JS})(${arg}).text`);
}

async function readNOW(query: string | null): Promise<string> {
  // current path: READ_JS(null) + readFrames merge + external line-based filter
  const main = await evalJS<string>(`(${NOW_READ_JS})(null).text`);
  const frames = await readFramesNow();
  let merged = main;
  for (const f of frames) merged += `\n\n--- iframe: ${f.url} ---\n${f.text}`;
  const MAX = 12000;
  let output = merged.substring(0, MAX);
  if (query) {
    const q = query.toLowerCase();
    const lines = output.split("\n");
    const matches: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 5);
        matches.push(lines.slice(start, end).join("\n"));
      }
    }
    if (matches.length > 0) {
      output = `Found ${matches.length} sections matching '${query}':\n\n${matches.join("\n---\n")}`.substring(0, MAX);
    }
  }
  return output;
}

// Scan, returning the model-visible text. Injects the chosen SCANNER_JS, then
// formats with the (unchanged) formatter. Side effect: leaves window.__webpilot
// populated by that regime's scanner, which is what resolve(...) needs.
async function scanFormatted(scannerJS: string): Promise<{ text: string; raw: ScanResult }> {
  const raw = await evalJS<ScanResult>(scannerJS);
  return { text: formatScanResult(raw), raw };
}

// Replicates resolveElement's call into RESOLVE_JS. We test single-shot
// (no retry) since the retry path is identical in both regimes and orthogonal
// to the scan/disambig diff we're auditing.
async function resolveAttempt(resolveJS: string, label: string): Promise<{
  matched: boolean; id?: number; matchedLabel?: string; error?: string;
  options?: { id: number; label: string }[];
}> {
  const r = await evalJS<{
    id?: number; label?: string; match?: string; error?: string; message?: string;
    options?: { id: number; label: string; affordance: string }[];
  }>(`(${resolveJS})(${JSON.stringify(label)}, null)`);
  if (r.error === "ambiguous") {
    return { matched: false, error: "ambiguous", options: r.options?.map(o => ({ id: o.id, label: o.label })) };
  }
  if (r.error) return { matched: false, error: r.message || r.error };
  return { matched: true, id: r.id, matchedLabel: r.label };
}

// ── Site list ─────────────────────────────────────────────────────────────
// Reused/extended from test-read-og-vs-now.mts. Mix of static docs, news,
// SPAs, search, e-comm, social, dev tools, and known-disambig sites
// (LinkedIn, Reddit comment lists, GitHub issue lists).

const SITES: string[] = [
  // Static docs / reference
  "https://en.wikipedia.org/wiki/Cat",
  "https://en.wikipedia.org/wiki/John_Hopfield",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/API/Element",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "https://docs.python.org/3/library/stdtypes.html",
  "https://nodejs.org/api/fs.html",
  "https://www.rust-lang.org/learn",
  "https://nginx.org/en/docs/",
  "https://wiki.archlinux.org/",
  "https://developer.chrome.com/docs",
  // News (heavy duplicate-label nav: "Read more", "Comments")
  "https://news.ycombinator.com/",
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://arstechnica.com/",
  "https://www.theverge.com/",
  "https://www.theguardian.com/international",
  "https://www.reuters.com/",
  "https://www.economist.com/",
  "https://dev.to/",
  // Dev / code (issue lists, PR lists)
  "https://github.com/",
  "https://github.com/trending",
  "https://github.com/explore",
  "https://github.com/microsoft/vscode/issues",
  "https://github.com/microsoft/vscode/pulls",
  "https://stackoverflow.com/",
  "https://stackoverflow.com/questions",
  "https://www.npmjs.com/search?q=react",
  "https://pypi.org/",
  // Search (result lists with similar labels)
  "https://www.google.com/search?q=hello",
  "https://www.bing.com/search?q=hello",
  "https://duckduckgo.com/?q=cats&ia=web",
  "https://search.brave.com/search?q=hello",
  // E-commerce (product lists with "Add to cart" buttons)
  "https://www.amazon.com/s?k=keyboard",
  "https://www.ebay.com/sch/i.html?_nkw=keyboard",
  "https://www.etsy.com/search?q=keyboard",
  // Multimedia
  "https://www.youtube.com/",
  "https://www.youtube.com/results?search_query=cats",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  // Social (heaviest disambig stressors)
  "https://www.reddit.com/",
  "https://old.reddit.com/r/news",
  "https://www.reddit.com/r/programming",
  // SaaS / cloud
  "https://www.cloudflare.com/",
  "https://aws.amazon.com/",
  "https://cloud.google.com/",
  "https://www.mozilla.org/en-US/",
  // Long tail
  "https://example.com/",
  "https://arxiv.org/",
  "https://www.python.org/",
  // Known iframe / portal cases (probes the read() shadow/multi-root + frames)
  "https://browser-use.github.io/stress-tests/challenges/iframe-inception-level1.html",
];

// ── Example storage ───────────────────────────────────────────────────────

interface Example {
  site: string;
  tool: string;        // "scan" | "read.no_query" | "read.query" | "resolve.same_input" | "resolve.scan_label"
  input: Record<string, unknown>;
  og: string;
  now: string;
  meta: {
    og_len: number;
    now_len: number;
    identical: boolean;
    notes?: string[];
  };
}

function slugify(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80).toLowerCase();
}

function persistExample(ex: Example) {
  appendFileSync(EXAMPLES_PATH, JSON.stringify(ex) + "\n");
}

function persistRaw(siteSlug: string, tool: string, og: string, now: string) {
  const dir = resolvePath(RAW_DIR, siteSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolvePath(dir, `${tool}.og.txt`), og);
  writeFileSync(resolvePath(dir, `${tool}.now.txt`), now);
}

// Pick the most interesting labels for resolve probes: prefer labels with a
// disambig suffix in NOW scan (those are exactly the regressions we want to
// see — does the same string still match anything in OG?). Fall back to
// arbitrary labels with length ≥ 3 chars.
function pickResolveLabels(ogRaw: ScanResult, nowRaw: ScanResult): {
  sameInput: string[];        // present in both, ordinary
  scanLabel: { og: string; now: string }[];   // disambig case: differing labels for "same" element
} {
  const ogLabels = new Set<string>();
  for (const g of Object.values(ogRaw.groups)) for (const e of g) if (e.label) ogLabels.add(e.label);
  const nowLabels = new Set<string>();
  for (const g of Object.values(nowRaw.groups)) for (const e of g) if (e.label) nowLabels.add(e.label);

  const shared: string[] = [];
  for (const l of ogLabels) if (nowLabels.has(l) && l.length >= 3 && l.length <= 60) shared.push(l);

  // Disambig case: SCANNER_JS at HEAD appends " [<unique>]" or " [<ancestor>]"
  // to duplicate labels. Find NOW labels that have that suffix and whose
  // bare-prefix is in OG.
  const disambigPairs: { og: string; now: string }[] = [];
  for (const nowLabel of nowLabels) {
    if (ogLabels.has(nowLabel)) continue;
    const m = nowLabel.match(/^(.+?) \[(.+)\]$/);
    if (!m) continue;
    const prefix = m[1].trim();
    if (prefix.length >= 3 && ogLabels.has(prefix)) {
      disambigPairs.push({ og: prefix, now: nowLabel });
      if (disambigPairs.length >= 3) break;
    }
  }

  return {
    sameInput: shared.slice(0, 3),
    scanLabel: disambigPairs.slice(0, 2),
  };
}

// ── Per-site runner ───────────────────────────────────────────────────────

interface SiteSummary {
  url: string;
  slug: string;
  examples: number;
  nav_ok: boolean;
  scan_changed: boolean;
  scan_og_total: number;
  scan_now_total: number;
  read_og_chars: number;
  read_now_chars: number;
  read_query_og_chars: number;
  read_query_now_chars: number;
  resolves_same_input: number;
  resolves_scan_label: number;
}

const READ_QUERIES = ["search", "more", "sign in", "about", "cookie"];

async function safeEval<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`    [${label}] ${msg.split("\n")[0].substring(0, 120)}`);
    return fallback;
  }
}

async function runSite(url: string): Promise<SiteSummary> {
  const slug = slugify(url);
  const summary: SiteSummary = {
    url, slug, examples: 0, nav_ok: false,
    scan_changed: false, scan_og_total: 0, scan_now_total: 0,
    read_og_chars: 0, read_now_chars: 0,
    read_query_og_chars: 0, read_query_now_chars: 0,
    resolves_same_input: 0, resolves_scan_label: 0,
  };

  if (!await nav(url)) return summary;
  summary.nav_ok = true;

  // ── 1. scan ──
  // Inject NOW first so resolve.same_input has fresh NOW state; we'll redo OG
  // injection just before OG resolve to reset.
  const EMPTY_SCAN = { text: "[scan failed]", raw: { url, title: "", total: 0, groups: {} as Record<string, ScanEntry[]> } };
  const nowScan = await safeEval("scan now", () => scanFormatted(NOW_SCANNER_JS), EMPTY_SCAN);
  const ogScan = await safeEval("scan og", () => scanFormatted(OG_SCANNER_JS), EMPTY_SCAN);
  summary.scan_og_total = ogScan.raw.total;
  summary.scan_now_total = nowScan.raw.total;
  summary.scan_changed = ogScan.text !== nowScan.text;

  const scanEx: Example = {
    site: url, tool: "scan", input: {},
    og: ogScan.text, now: nowScan.text,
    meta: {
      og_len: ogScan.text.length, now_len: nowScan.text.length,
      identical: ogScan.text === nowScan.text,
      notes: [
        `og_total=${ogScan.raw.total}`,
        `now_total=${nowScan.raw.total}`,
        `og_press=${ogScan.raw.groups.PRESS?.length || 0}`,
        `now_press=${nowScan.raw.groups.PRESS?.length || 0}`,
      ],
    },
  };
  persistExample(scanEx);
  persistRaw(slug, "scan", ogScan.text, nowScan.text);
  summary.examples++;

  // ── 2. read (no query) ──
  const og = await safeEval("read og", () => readOG(null), "[og read failed]");
  const now = await safeEval("read now", () => readNOW(null), "[now read failed]");
  summary.read_og_chars = og.length;
  summary.read_now_chars = now.length;
  persistExample({
    site: url, tool: "read.no_query", input: { query: null },
    og, now,
    meta: { og_len: og.length, now_len: now.length, identical: og === now },
  });
  persistRaw(slug, "read.no_query", og, now);
  summary.examples++;

  // ── 3. read with query ──  Pick the first query that yields a hit in NOW.
  for (const q of READ_QUERIES) {
    const nowQ = await safeEval(`read.query now "${q}"`, () => readNOW(q), "");
    if (!nowQ.startsWith("Found")) continue;
    const ogQ = await safeEval(`read.query og "${q}"`, () => readOG(q), "[og read.query failed]");
    summary.read_query_og_chars = ogQ.length;
    summary.read_query_now_chars = nowQ.length;
    persistExample({
      site: url, tool: "read.query", input: { query: q },
      og: ogQ, now: nowQ,
      meta: { og_len: ogQ.length, now_len: nowQ.length, identical: ogQ === nowQ, notes: [`query="${q}"`] },
    });
    persistRaw(slug, `read.query_${q.replace(/\s+/g, "_")}`, ogQ, nowQ);
    summary.examples++;
    break;
  }

  // ── 4. resolve.same_input (same label string in both regimes) ──
  const picks = pickResolveLabels(ogScan.raw, nowScan.raw);

  // Re-inject OG so window.__webpilot reflects OG ids/labels for OG resolves.
  await safeEval("re-inject og", () => evalJS(OG_SCANNER_JS), null);
  const ogResolves = new Map<string, { matched: boolean; id?: number; matchedLabel?: string; error?: string; options?: { id: number; label: string }[] }>();
  for (const label of picks.sameInput) {
    ogResolves.set(label, await safeEval(`og resolve "${label.slice(0,30)}"`,
      () => resolveAttempt(OG_RESOLVE_JS, label),
      { matched: false, error: "eval failed" }));
  }
  // Now inject NOW for NOW resolves.
  await safeEval("re-inject now", () => evalJS(NOW_SCANNER_JS), null);
  for (const label of picks.sameInput) {
    const nowR = await safeEval(`now resolve "${label.slice(0,30)}"`,
      () => resolveAttempt(NOW_RESOLVE_JS, label),
      { matched: false, error: "eval failed" });
    const ogR = ogResolves.get(label)!;
    const ogText = formatResolve(ogR);
    const nowText = formatResolve(nowR);
    persistExample({
      site: url, tool: "resolve.same_input", input: { label },
      og: ogText, now: nowText,
      meta: {
        og_len: ogText.length, now_len: nowText.length,
        identical: ogText === nowText,
        notes: [
          `og.matched=${ogR.matched}`, `now.matched=${nowR.matched}`,
          ogR.error ? `og.error=${ogR.error}` : "",
          nowR.error ? `now.error=${nowR.error}` : "",
        ].filter(Boolean),
      },
    });
    summary.resolves_same_input++;
    summary.examples++;
  }

  // ── 5. resolve.scan_label (each regime gets its OWN scan label) ──
  // This is the realistic comparison: at commit 5 the model would have seen
  // og.label and called resolve(og.label); at HEAD it sees now.label and
  // calls resolve(now.label). Both should succeed but resolve to (different
  // or the same) elements.
  await safeEval("re-inject og 2", () => evalJS(OG_SCANNER_JS), null);
  const ogScanLabelResolves = new Map<string, { matched: boolean; id?: number; matchedLabel?: string; error?: string; options?: { id: number; label: string }[] }>();
  for (const pair of picks.scanLabel) {
    ogScanLabelResolves.set(pair.og, await safeEval(`og resolve "${pair.og.slice(0,30)}"`,
      () => resolveAttempt(OG_RESOLVE_JS, pair.og),
      { matched: false, error: "eval failed" }));
  }
  await safeEval("re-inject now 2", () => evalJS(NOW_SCANNER_JS), null);
  for (const pair of picks.scanLabel) {
    const nowR = await safeEval(`now resolve "${pair.now.slice(0,30)}"`,
      () => resolveAttempt(NOW_RESOLVE_JS, pair.now),
      { matched: false, error: "eval failed" });
    const ogR = ogScanLabelResolves.get(pair.og)!;
    const ogText = formatResolve(ogR);
    const nowText = formatResolve(nowR);
    persistExample({
      site: url, tool: "resolve.scan_label",
      input: { og_label: pair.og, now_label: pair.now },
      og: ogText, now: nowText,
      meta: {
        og_len: ogText.length, now_len: nowText.length,
        identical: ogText === nowText,
        notes: [
          `og_label="${pair.og}"`, `now_label="${pair.now}"`,
          `og.matched=${ogR.matched}`, `now.matched=${nowR.matched}`,
        ],
      },
    });
    summary.resolves_scan_label++;
    summary.examples++;
  }

  return summary;
}

function formatResolve(r: { matched: boolean; id?: number; matchedLabel?: string; error?: string; options?: { id: number; label: string }[] }): string {
  if (r.matched) return `OK id=${r.id} label="${r.matchedLabel}"`;
  if (r.error === "ambiguous") {
    const opts = (r.options || []).map(o => `  [${o.id}] "${o.label}"`).join("\n");
    return `AMBIGUOUS\n${opts}`;
  }
  return `ERROR ${r.error}`;
}

// ── Main ─────────────────────────────────────────────────────────────────

const summaries: SiteSummary[] = [];
let totalExamples = 0;
const startMs = Date.now();

console.log(`Auditing ${SITES.length} sites…`);
console.log(`OG = commit 5 = HEAD~5 = d7d84e3`);
console.log(`NOW = working tree (HEAD + WIP src/index.ts)\n`);

console.log(`${"site".padEnd(58)}  ${"scan".padStart(6)}  ${"read".padStart(6)}  ${"resv".padStart(4)}`);
console.log("-".repeat(82));

for (const url of SITES) {
  const s = await runSite(url);
  summaries.push(s);
  totalExamples += s.examples;

  const flag = !s.nav_ok ? "FAIL"
    : s.scan_changed ? "Δ"
    : ".";
  console.log(
    `  ${url.replace(/^https?:\/\//, "").slice(0, 56).padEnd(56)}  ` +
    `${String(s.scan_now_total).padStart(6)}  ` +
    `${String(s.read_now_chars).padStart(6)}  ` +
    `${String(s.resolves_same_input + s.resolves_scan_label).padStart(4)}  ${flag}`
  );

  if (totalExamples >= 100 && totalExamples - s.examples < 100) {
    console.log(`\n  ≥100 examples reached at ${url}; continuing for full coverage.`);
  }
}

writeFileSync(SITES_PATH, JSON.stringify(summaries, null, 2));

const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(0);
console.log(`\n=== Done ===`);
console.log(`Sites probed:      ${summaries.filter(s => s.nav_ok).length}/${SITES.length}`);
console.log(`Examples stored:   ${totalExamples}`);
console.log(`Examples file:     ${EXAMPLES_PATH}`);
console.log(`Per-site raw text: ${RAW_DIR}/<slug>/<tool>.{og,now}.txt`);
console.log(`Sites summary:     ${SITES_PATH}`);
console.log(`Elapsed:           ${elapsedSec}s`);

await client.close();
