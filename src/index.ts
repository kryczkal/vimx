import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type CDP from "chrome-remote-interface";
import {
  getClient, evaluate, evaluateInFrame, listTabs, switchTab, navigateTo,
  waitForNavigation, serialized, getPendingDialog, consumeLastAlert,
  handlePendingDialog, onDialog, startObserving, waitForSettle,
  waitForLoadingIndicators,
} from "./cdp.js";
import { SCANNER_JS, FRAME_SCANNER_JS, CHECK_JS, RESOLVE_JS, SELECT_JS, READ_JS, HIGHLIGHT_JS } from "./scanner.js";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);
const HIGHLIGHT = !["", "0", "false"].includes((process.env.WEBPILOT_HIGHLIGHT ?? "").toLowerCase());

function highlight(client: CDP.Client, id: number): void {
  if (!HIGHLIGHT) return;
  evaluate(client, `${HIGHLIGHT_JS}(${id})`).catch(() => {});
}

// ── Helpers ──

interface ScanEntry {
  id: number; tag: string; label: string; value?: string; inputType?: string;
  placeholder?: string; options?: string[]; checked?: boolean; href?: string;
  scrollContainer?: boolean; scrollMore?: number; affordance?: string;
  x?: number; y?: number; w?: number; h?: number;
  region?: string;
}

interface ScanResult {
  url: string;
  title: string;
  groups: Record<string, ScanEntry[]>;
  total: number;
  pageScrollable?: boolean;
}

// Per-URL-path emit cache for stateful-scan-chrome-dedup.
// Tracks what the agent has already seen so subsequent scans can elide
// unchanged elements and emit only diffs. Element ids are stable across
// scans within a page (WeakMap in scanner.ts), so referencing elided ids
// in subsequent tool calls works fine.
//
// Default ON per benchmark 2026-05-12 (-77% idle, -83% post-action scan
// output across 20 sites, 0 site failures). Disable via WEBPILOT_SCAN_DEDUP=0
// for A/B testing or to recover legacy NEW: delta behavior.
const SCAN_DEDUP = !["0", "false", "no"].includes((process.env.WEBPILOT_SCAN_DEDUP ?? "1").toLowerCase());

interface ScanState {
  elementSigs: Map<number, string>;       // id → signature; used for change detection
  byRegion: Map<string, Set<number>>;     // region → ids in that region
  title: string;
  pageScrollable?: boolean;
}
// LRU bound: per Q10=B. 20 URLs is generous for a session.
const SCAN_CACHE_LIMIT = 20;
const scanCache = new Map<string, ScanState>();

// (b) Error-state bypass: on interactive failures (obscured / stale / not found)
// the next scan must emit FULL output so the agent has labels for diagnosis.
// Dedup is implementation mechanic; recovery is task semantics — mechanic yields.
// Cleared after one emit. Set via markActionError() in error paths.
let nextScanForceFresh = false;
function markActionError(): void { if (SCAN_DEDUP) nextScanForceFresh = true; }

// Cache key includes querystring after (f) investigation 2026-05-12:
// path-only keying caused false dedup on Google Flights ?q=SFO vs ?q=NYC
// (audit/data/cache-key-investigation/). For SPAs the querystring IS
// state. Fragment dropped — typically client-only state, doesn't change
// scan-visible affordances.
//
// Cost: cache miss on URLs that differ only in tracking params (e.g.
// ?ref=abc). Acceptable — those URLs rarely repeat per-session anyway.
function urlPathKey(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

// Per-entry signature for change detection. Includes everything an agent
// would observe — affordance group, label, href, value, checked state, region.
function entrySig(e: ScanEntry, affordance: string): string {
  return [
    affordance,
    e.tag,
    e.label || "",
    e.href || "",
    e.value || "",
    e.checked ? "1" : "",
    e.region || "",
  ].join("|");
}

function snapshotState(scan: ScanResult): ScanState {
  const elementSigs = new Map<number, string>();
  const byRegion = new Map<string, Set<number>>();
  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const group = scan.groups[aff];
    if (!group) continue;
    for (const e of group) {
      elementSigs.set(e.id, entrySig(e, aff));
      const r = e.region || "_unassigned";
      if (!byRegion.has(r)) byRegion.set(r, new Set());
      byRegion.get(r)!.add(e.id);
    }
  }
  return { elementSigs, byRegion, title: scan.title, pageScrollable: scan.pageScrollable };
}

function getCachedState(url: string): ScanState | undefined {
  return scanCache.get(urlPathKey(url));
}

function setCachedState(url: string, state: ScanState): void {
  const key = urlPathKey(url);
  if (scanCache.has(key)) scanCache.delete(key); // refresh recency
  scanCache.set(key, state);
  while (scanCache.size > SCAN_CACHE_LIMIT) {
    const oldest = scanCache.keys().next().value;
    if (oldest === undefined) break;
    scanCache.delete(oldest);
  }
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
      lastScrollMore = e.scrollMore;
      lastScrollLabel = e.label;
    } else if (lastScrollMore !== null && !e.scrollContainer) {
      lines.splice(lines.length - 1, 0, `  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
      lastScrollMore = null;
      lastScrollLabel = null;
    }
  }
  if (lastScrollMore !== null) {
    lines.push(`  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
  }
  return lines;
}

// Strip tracking params from URLs for display. Full URLs are preserved in
// stored element refs — press() uses coordinates, not URLs. The model never
// copies tracking URLs from scan output (verified across all session logs).
//
// Two complementary detections (combo strips if EITHER matches):
//   B: value > 16 chars + no 4-letter lowercase word → hex/base64 tokens
//   A: value > 32 chars + no structure chars → long opaque blobs
// Tested on 9 sites (Google×3, Amazon, Reddit, eBay, Wikipedia, GitHub,
// Booking.com): -28% total chars, zero false positives.
//
// REVISIT IF: models start constructing URLs from scan hrefs instead of using
// press(label) or building URLs from scratch.
function cleanHref(href: string): string {
  const qIdx = href.indexOf("?");
  if (qIdx === -1) return href;
  const path = href.substring(0, qIdx);
  const params = href.substring(qIdx + 1).split("&");
  const kept = params.filter(p => {
    const eq = p.indexOf("=");
    if (eq === -1) return true;
    const val = p.substring(eq + 1);
    // B: short or contains a word → keep
    // A: short or contains structure (spaces, url-encoded separators) → keep
    const hasWord = /[a-z]{4,}/.test(val);
    const hasStructure = /[+]|%20|%3A|%26|%2F|%3D/i.test(val);
    const bStrip = val.length > 16 && !hasWord;
    const aStrip = val.length > 32 && !hasStructure;
    return !(bStrip || aStrip);
  });
  if (kept.length === 0) return path;
  return path + "?" + kept.join("&");
}

// Per-entry formatter. Same shape for full and dedup output so the agent
// never sees different schemas — only differences in WHICH entries appear.
//
// (c) Regions no longer broadcast on every entry. Regions are now load-bearing
// only when (1) used by the scanner's disambiguator to suffix conflicting
// labels ("Save in nav" vs "Save in main"), or (2) summarized in the dedup
// "Unchanged — header: 7 · main: 18 · ..." line. Per-entry region tags
// were emitted on every entry in v1 but zero agent thinking traces across
// 5 post-ship sessions reasoned about them. Saves ~7-10% cold-scan tokens.
function fmtEntry(aff: string, e: ScanEntry): string {
  if (aff === "PRESS") {
    const href = e.href ? ` → ${cleanHref(e.href)}` : "";
    return `  [${e.id}] ${e.tag} "${e.label}"${href}`;
  }
  if (aff === "TYPE") {
    const val = e.value ? ` value="${e.value}"` : "";
    const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
    return `  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`;
  }
  if (aff === "SELECT") {
    const opts = e.options?.join(", ") || "";
    return `  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`;
  }
  if (aff === "TOGGLE") {
    const state = e.checked ? "✓" : "○";
    return `  [${e.id}] ${e.tag} "${e.label}" ${state}`;
  }
  if (aff === "UPLOAD") {
    return `  [${e.id}] input[file] "${e.label}"`;
  }
  return `  [${e.id}] ${e.tag} "${e.label}"`;
}

const AFFORDANCE_HEADERS: Record<string, string> = {
  PRESS: "PRESS → press(element)",
  TYPE: "TYPE → type(element, text)",
  SELECT: "SELECT → select(element, value)",
  TOGGLE: "TOGGLE → toggle(element)",
  UPLOAD: "UPLOAD → upload(element, filepath)",
};

function formatScanResultFull(scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);
  lines.push(`Elements: ${scan.total}`);
  if (scan.pageScrollable) {
    lines.push(`... more below — scroll() for next page`);
  }
  lines.push("");

  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const group = scan.groups[aff];
    if (!group || group.length === 0) continue;
    lines.push(AFFORDANCE_HEADERS[aff]);
    lines.push(...formatGroup(group, e => fmtEntry(aff, e)));
    lines.push("");
  }

  return lines.join("\n");
}

// Compact id range form: [1,2,3,5,7,8] → "1-3, 5, 7-8"
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

// Dedup formatter: emit only what's changed since prev state.
// Per Q2=B (explicit dedup): agent SEES the dedup — header announces it,
// unchanged elements summarized per region with id ranges.
function formatScanResultDedup(scan: ScanResult, prev: ScanState): string {
  const lines: string[] = [];

  // Walk current scan, classify each id as new / changed / unchanged vs prev.
  const newIds = new Set<number>();
  const changedIds = new Set<number>();
  const unchangedIds = new Set<number>();
  const currentSigs = new Map<number, string>();
  const idToEntry = new Map<number, { aff: string; entry: ScanEntry }>();

  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const group = scan.groups[aff];
    if (!group) continue;
    for (const e of group) {
      const sig = entrySig(e, aff);
      currentSigs.set(e.id, sig);
      idToEntry.set(e.id, { aff, entry: e });
      const prevSig = prev.elementSigs.get(e.id);
      if (prevSig === undefined) newIds.add(e.id);
      else if (prevSig !== sig) changedIds.add(e.id);
      else unchangedIds.add(e.id);
    }
  }

  const removedIds = new Set<number>();
  for (const id of prev.elementSigs.keys()) {
    if (!currentSigs.has(id)) removedIds.add(id);
  }

  const noChange = newIds.size === 0 && changedIds.size === 0 && removedIds.size === 0;

  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);

  if (noChange) {
    // (a) Frame as positive assertion about the page, not "I am withholding
    // info." The agent's prior view is the truth; act with confidence on it.
    const idRange = compactIds([...unchangedIds]);
    lines.push(`No changes since last scan. ${scan.total} elements (ids ${idRange}) still current — act on what you saw.`);
    if (scan.pageScrollable) {
      lines.push(`... more below — scroll() for next page`);
    }
    return lines.join("\n");
  }

  const parts: string[] = [];
  if (newIds.size) parts.push(`${newIds.size} new`);
  if (changedIds.size) parts.push(`${changedIds.size} changed`);
  if (removedIds.size) parts.push(`${removedIds.size} gone`);
  if (unchangedIds.size) parts.push(`${unchangedIds.size} unchanged`);
  lines.push(`Elements: ${scan.total} (${parts.join(", ")})`);
  if (scan.pageScrollable) {
    lines.push(`... more below — scroll() for next page`);
  }
  lines.push("");

  // Per affordance group: emit new + changed entries in full, then a per-region
  // summary of unchanged ids. Removed ids listed at top.
  if (removedIds.size > 0) {
    const removedRange = compactIds([...removedIds]);
    lines.push(`GONE since last scan: ${removedRange}`);
    lines.push("");
  }

  for (const aff of ["PRESS", "TYPE", "SELECT", "TOGGLE", "UPLOAD"]) {
    const group = scan.groups[aff];
    if (!group || group.length === 0) continue;

    const newEntries = group.filter(e => newIds.has(e.id));
    const changedEntries = group.filter(e => changedIds.has(e.id));
    const unchangedEntries = group.filter(e => unchangedIds.has(e.id));

    if (newEntries.length === 0 && changedEntries.length === 0 && unchangedEntries.length === 0) continue;

    lines.push(AFFORDANCE_HEADERS[aff]);

    if (newEntries.length > 0) {
      lines.push(...formatGroup(newEntries, e => fmtEntry(aff, e) + "  ← new"));
    }
    if (changedEntries.length > 0) {
      lines.push(...formatGroup(changedEntries, e => fmtEntry(aff, e) + "  ← changed"));
    }
    if (unchangedEntries.length > 0) {
      // Group unchanged by region for a compact summary.
      const byRegion = new Map<string, number[]>();
      for (const e of unchangedEntries) {
        const r = e.region || "_unassigned";
        if (!byRegion.has(r)) byRegion.set(r, []);
        byRegion.get(r)!.push(e.id);
      }
      const regSummaries: string[] = [];
      // Stable ordering: known regions first, then anything else alphabetical.
      const order = ["header", "nav", "search", "main", "aside", "footer", "modal", "_unassigned"];
      const sortedRegs = [...byRegion.keys()].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });
      for (const reg of sortedRegs) {
        const ids = byRegion.get(reg)!;
        const display = reg === "_unassigned" ? "other" : reg;
        regSummaries.push(`${display}: ${ids.length} (${compactIds(ids)})`);
      }
      lines.push(`  Unchanged — ${regSummaries.join(" · ")}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatScanResult(scan: ScanResult, prev?: ScanState): string {
  if (SCAN_DEDUP && prev) return formatScanResultDedup(scan, prev);
  return formatScanResultFull(scan);
}

async function scanPage(client: CDP.Client): Promise<ScanResult> {
  const result = await evaluate(client, SCANNER_JS) as ScanResult;

  try {
    const frameElements = await scanFrames(client);
    if (frameElements.length > 0) {
      const mergeResult = await evaluate(client, `((frameEls) => {
        if (!window.__wpIdMap) window.__wpIdMap = new WeakMap();
        if (!window.__wpNextId) window.__wpNextId = 0;
        const added = [];
        for (const fe of frameEls) {
          const id = window.__wpNextId++;
          window.__webpilotRects[id] = { x: fe.x, y: fe.y };
          window.__webpilotLabels[id] = fe.label;
          window.__webpilotAffordances[id] = fe.affordance;
          window.__webpilot[id] = { __frameElement: true, x: fe.x, y: fe.y };
          added.push({ ...fe, id });
        }
        return added;
      })(${JSON.stringify(frameElements)})`) as ScanEntry[];

      for (const entry of mergeResult) {
        const aff = entry.affordance || "PRESS";
        const group = result.groups[aff];
        if (group) group.push(entry);
      }
      result.total += mergeResult.length;
    }
  } catch {}

  return result;
}

async function runScan(): Promise<ScanResult> {
  const client = await getClient(CDP_PORT);
  await startObserving(client);
  await waitForSettle(client);
  // If the page is still streaming content (skeleton/aria-busy visible),
  // wait for those indicators to clear, then re-settle to catch the
  // post-XHR render burst. No-op (~1ms) on stable pages.
  if (await waitForLoadingIndicators(client)) {
    await startObserving(client);
    await waitForSettle(client);
  }
  return scanPage(client);
}

interface FrameElement {
  tag: string;
  label: string;
  affordance: string;
  x: number;
  y: number;
  value?: string;
  inputType?: string;
  placeholder?: string;
  options?: string[];
  checked?: boolean;
  href?: string;
}

async function scanFrames(client: CDP.Client): Promise<FrameElement[]> {
  // Get frame tree
  let frameTree;
  try {
    const ft = await client.Page.getFrameTree();
    frameTree = ft.frameTree;
  } catch {
    return [];
  }

  const mainFrameId = (frameTree as { frame: { id: string } }).frame.id;
  const allFrames: { frameId: string; parentFrameId?: string }[] = [];

  function collectFrames(node: { frame: { id: string; parentId?: string }; childFrames?: unknown[] }) {
    if (node.frame.id !== mainFrameId) {
      allFrames.push({ frameId: node.frame.id, parentFrameId: node.frame.parentId });
    }
    for (const child of (node.childFrames || []) as typeof node[]) {
      collectFrames(child);
    }
  }
  collectFrames(frameTree as Parameters<typeof collectFrames>[0]);

  if (allFrames.length === 0) return [];

  // Build frame offset chain: for each frame, compute its viewport offset
  // by getting the iframe element's rect in the parent frame
  const frameOffsets = new Map<string, { x: number; y: number }>();
  frameOffsets.set(mainFrameId, { x: 0, y: 0 });

  for (const frame of allFrames) {
    try {
      // Get the iframe element's rect in the parent frame
      const parentId = frame.parentFrameId || mainFrameId;
      const iframeRect = await evaluateInFrame(client, parentId, `(() => {
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          // Match by checking if this iframe's contentWindow corresponds to our target frame
          const r = iframe.getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            return { x: r.left, y: r.top, w: r.width, h: r.height, src: iframe.src || "" };
          }
        }
        return null;
      })()`) as { x: number; y: number } | null;

      // Simple approach: accumulate parent offset + iframe position
      const parentOffset = frameOffsets.get(parentId) || { x: 0, y: 0 };
      if (iframeRect) {
        frameOffsets.set(frame.frameId, {
          x: parentOffset.x + iframeRect.x,
          y: parentOffset.y + iframeRect.y,
        });
      }
    } catch {
      // Frame not accessible
    }
  }

  // Scan each frame
  const allElements: FrameElement[] = [];
  for (const frame of allFrames) {
    const offset = frameOffsets.get(frame.frameId);
    if (!offset) continue;

    try {
      const frameResult = await evaluateInFrame(client, frame.frameId, FRAME_SCANNER_JS) as {
        elements: FrameElement[];
        childIframes: { x: number; y: number }[];
      };

      for (const el of frameResult.elements) {
        allElements.push({
          ...el,
          x: el.x + offset.x,
          y: el.y + offset.y,
        });
      }
    } catch {
      // Frame scan failed — skip
    }
  }

  return allElements;
}

// read() in the main document misses iframe content — embedded widgets,
// social embeds, and deeply nested portals (the May 10 iframe-inception
// session aborted on this). Walks every non-main frame via CDP isolated
// worlds, drops frames below threshold (50 chars after trim), and merges
// with section markers. Per-frame timeout bounds worst-case overhead.
//
// 70-site survey (May 11): 33% of sites have iframes but only 5.8% have
// substantive frames; rest are ad slots that lazy-load or use postMessage
// and contribute 0 chars to a DOM walk anyway. Avg 21ms overhead per page,
// zero regressions, 0.7% net token increase across the set.
interface FrameRead { url: string; text: string }
async function readFrames(client: CDP.Client, perFrameTimeoutMs = 200): Promise<FrameRead[]> {
  let frameTree;
  try {
    const ft = await client.Page.getFrameTree();
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

  const results: FrameRead[] = [];
  for (const f of allFrames) {
    try {
      const text = await Promise.race([
        evaluateInFrame(client, f.id, `${READ_JS}().text`) as Promise<string>,
        new Promise<null>(resolve => setTimeout(() => resolve(null), perFrameTimeoutMs)),
      ]);
      if (typeof text === "string" && text.trim().length >= 50) {
        results.push({ url: f.url, text: text.trim() });
      }
    } catch {
      // frame eval failed — skip silently
    }
  }
  return results;
}

// Single entry point for all scan-emission to the agent. Handles dedup
// (when SCAN_DEDUP is on) and legacy NEW: deltas (when off).
//
// Honors the (b) error-state bypass: when nextScanForceFresh is set (an
// action just errored), emit full so the agent has full labels for diagnosis.
function emitScan(scan: ScanResult, beforeIds?: Set<number>): string {
  if (SCAN_DEDUP) {
    const useCache = !nextScanForceFresh;
    nextScanForceFresh = false;
    const prev = useCache ? getCachedState(scan.url) : undefined;
    const out = formatScanResult(scan, prev);
    setCachedState(scan.url, snapshotState(scan));
    return out;
  }
  if (beforeIds) return formatDelta(beforeIds, scan);
  return formatScanResultFull(scan);
}

async function snapshotIds(client: CDP.Client): Promise<Set<number>> {
  const ids = await evaluate(client, `Object.keys(window.__webpilotRects || {}).map(Number)`) as number[];
  return new Set(ids || []);
}

function formatDelta(before: Set<number>, result: ScanResult): string {
  const full = emitScan(result);
  const entries = [
    ...(result.groups.PRESS || []),
    ...(result.groups.TYPE || []),
    ...(result.groups.SELECT || []),
    ...(result.groups.TOGGLE || []),
  ];
  const newEntries = entries.filter(e => !before.has(e.id));
  if (newEntries.length === 0) return full;

  const lines: string[] = ["NEW:"];
  for (const e of newEntries) {
    const label = e.label ? ` "${(e.label as string).substring(0, 60)}"` : "";
    lines.push(`  [${e.id}] ${e.tag}${label}`);
  }
  lines.push("");
  return lines.join("\n") + "\n" + full;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// Action-error: same as err() but also primes the next scan to emit FULL
// output (no dedup). The agent needs labels for recovery diagnosis.
function aerr(text: string) {
  markActionError();
  return err(text);
}

function dialogBlock(): ReturnType<typeof err> | null {
  const d = getPendingDialog();
  if (!d) return null;
  const hint = d.type === "prompt"
    ? "Respond with dialog(accept, text) or dialog(dismiss)."
    : "Respond with dialog(accept) or dialog(dismiss).";
  return err(`A dialog is open — handle it before doing anything else.\n  ${d.type}: "${d.message}"\n${hint}`);
}

function dialogReturn(prefix: string): ReturnType<typeof ok> | null {
  const d = getPendingDialog();
  if (!d) return null;
  const hint = d.type === "prompt"
    ? "Respond with dialog(accept, text) or dialog(dismiss)."
    : "Respond with dialog(accept) or dialog(dismiss).";
  return ok(`${prefix} Dialog appeared:\n  ${d.type}: "${d.message}"\n${hint}`);
}

function alertSuffix(): string {
  const a = consumeLastAlert();
  return a ? `\nAlert: "${a.message}"` : "";
}

// ── CDP input primitives ──
// Every interaction goes through these. No DOM manipulation for interaction.

async function cdpClick(client: CDP.Client, x: number, y: number) {
  await client.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
  // mouseReleased hangs if a dialog opened during mousePressed (renderer paused).
  // Race it against the dialog event so we don't block forever.
  await Promise.race([
    client.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 }),
    onDialog(),
  ]);
}

async function cdpHover(client: CDP.Client, x: number, y: number) {
  await client.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
}

async function cdpType(client: CDP.Client, text: string) {
  await client.Input.insertText({ text });
}

// Clear the focused element's value via direct DOM manipulation.
//
// Earlier we used cdpSelectAll (Ctrl+A keystroke) + cdpBackspace. That was
// silently broken: CDP's Input.dispatchKeyEvent fires renderer-side DOM events
// but doesn't trigger Chromium's browser-process editing-command handler, so
// Ctrl+A never selected anything. The backspace then deleted one char,
// cdpType.insertText appended the new text — net result, prior + typed
// concatenated. This was the actual root cause of the Forms session 8bbfd98a
// "Option AOption 1" shipped-broken case. Surfaced by anomaly-flag bench.
//
// Native value setter dispatched as input+change covers regular inputs,
// textareas, and contenteditable. React/Vue controlled components respect
// the setter call because we go through the prototype descriptor.
async function clearField(client: CDP.Client, id: number) {
  await evaluate(client, `(() => {
    const el = window.__webpilot?.[${id}];
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, "");
      else el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
}

const KEY_MAP: Record<string, { key: string; code: string }> = {
  enter: { key: "Enter", code: "Enter" },
  tab: { key: "Tab", code: "Tab" },
  escape: { key: "Escape", code: "Escape" },
  backspace: { key: "Backspace", code: "Backspace" },
  delete: { key: "Delete", code: "Delete" },
  arrowup: { key: "ArrowUp", code: "ArrowUp" },
  arrowdown: { key: "ArrowDown", code: "ArrowDown" },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft" },
  arrowright: { key: "ArrowRight", code: "ArrowRight" },
  space: { key: " ", code: "Space" },
  home: { key: "Home", code: "Home" },
  end: { key: "End", code: "End" },
  pageup: { key: "PageUp", code: "PageUp" },
  pagedown: { key: "PageDown", code: "PageDown" },
};

async function cdpKey(client: CDP.Client, keyName: string, modifiers = 0) {
  const mapped = KEY_MAP[keyName.toLowerCase()];
  if (!mapped) throw new Error(`Unknown key: ${keyName}. Available: ${Object.keys(KEY_MAP).join(", ")}`);
  await client.Input.dispatchKeyEvent({ type: "keyDown", ...mapped, modifiers });
  // keyUp can hang if keyDown triggered a dialog (renderer paused)
  await Promise.race([
    client.Input.dispatchKeyEvent({ type: "keyUp", ...mapped, modifiers }),
    onDialog(),
  ]);

  if (getPendingDialog()) return;

  // CDP dispatchKeyEvent fires DOM events but doesn't trigger the browser's
  // default actions (form submit, button activate). Apply them via JS.
  if (modifiers === 0 && keyName.toLowerCase() === "enter") {
    await evaluate(client, `(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return;
      const form = el.closest?.("form");
      if (form) { form.requestSubmit(); return; }
      if (el.tagName === "A" || el.tagName === "BUTTON" ||
          el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
        el.click();
      }
    })()`);
  }

  if (modifiers === 0 && keyName.toLowerCase() === "space") {
    await evaluate(client, `(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return;
      const tag = el.tagName;
      if (tag === "INPUT" && (el.type === "text" || el.type === "search" || el.type === "password")) return;
      if (tag === "TEXTAREA") return;
      if (el.isContentEditable) return;
      if (tag === "BUTTON" || tag === "A" ||
          el.getAttribute("role") === "button" ||
          (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio"))) {
        el.click();
      }
    })()`);
  }
}

// Pre-action hit test: returns coords + an "obscured" descriptor if the
// element at (x, y) isn't our target or part of its tree.
//
// Shadow DOM: we descend top-down (shadowRoot.elementFromPoint until no
// deeper) then check containment piercing shadow boundaries. Playwright does
// the inverse — walks UP from target to enumerate its shadow chain, then
// verifies elementFromPoint at each root steps to the next host
// (microsoft/playwright packages/injected/src/injectedScript.ts:expectHitTarget).
// Their approach catches per-level obscuration and handles display:contents
// quirks; ours matches their result on the common case for ~10× less code.
// If we hit hard-to-diagnose cases, swap elementFromPoint for elementsFromPoint
// (plural) to expose the full vertical stack at the click point.
//
// Element stability check — INTENTIONALLY NOT DONE. Playwright waits for the
// bounding rect to be identical across two animation frames before clicking,
// to avoid mid-animation misses. Measured on 8 scenarios (Wikipedia, Twitter,
// Stripe, Linear, BBC, Amazon, Amazon-mid-hover, Amazon-during-carousel):
// zero elements moved >2px in the 50ms window between getRect and cdpClick,
// even right after hover triggers a mega-menu animation. Motion does happen,
// but only at 150ms+ — by then the agent's think time has elapsed and the
// next getRect re-reads fresh coords. Add a one-RAF rect re-read here if a
// real silent-misclick caused by motion ever shows up in a session.
async function getRect(client: CDP.Client, id: number): Promise<{ x: number; y: number; obscured?: string } | null> {
  return await evaluate(client, `(() => {
    const el = window.__webpilot?.[${id}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }
    const r2 = el.getBoundingClientRect();
    const x = r2.left + r2.width / 2;
    const y = r2.top + r2.height / 2;

    // Shadow-aware elementFromPoint (web components return their host otherwise)
    let top = document.elementFromPoint(x, y);
    while (top && top.shadowRoot) {
      const deeper = top.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === top) break;
      top = deeper;
    }
    if (!top) return { x, y };

    // Shadow-piercing containment in both directions:
    //   top inside el → click on a child, bubbles up to el
    //   el inside top → el is decoration with pe:none, or top is shadow host
    function deepContains(a, b) {
      let n = b;
      while (n) { if (n === a) return true; n = n.parentNode || n.host; }
      return false;
    }
    if (top === el || deepContains(el, top) || deepContains(top, el)) return { x, y };

    const tag = top.tagName.toLowerCase();
    const role = top.getAttribute("role");
    const text = (top.getAttribute("aria-label") || top.innerText || "").substring(0, 40).trim().replace(/\\n+/g, " ");
    const desc = role ? tag + '[role="' + role + '"]' : tag;
    return { x, y, obscured: desc + (text ? ' "' + text + '"' : "") };
  })()`) as { x: number; y: number; obscured?: string } | null;
}

async function checkElement(client: CDP.Client, id: number): Promise<{ error?: string; tag?: string; ok?: boolean }> {
  return await evaluate(client, `${CHECK_JS}(${id})`) as { error?: string; tag?: string; ok?: boolean };
}

interface ResolveResult {
  id?: number;
  label?: string;
  match?: string;
  error?: string;
  message?: string;
  options?: { id: number; label: string; affordance: string }[];
}

async function tryResolveOnce(
  client: CDP.Client,
  idOrLabel: number | string,
  affordanceFilter?: string,
): Promise<{ id: number; label?: string } | { error: string; stale?: boolean }> {
  if (typeof idOrLabel === "number") {
    const check = await checkElement(client, idOrLabel);
    if (check.error === "not_found") return { error: "Element not found. Run scan first." };
    if (check.error === "stale") return { error: "Element is stale. Run scan again.", stale: true };
    return { id: idOrLabel };
  }

  const result = await evaluate(
    client,
    `${RESOLVE_JS}(${JSON.stringify(idOrLabel)}, ${affordanceFilter ? JSON.stringify(affordanceFilter) : "null"})`,
  ) as ResolveResult;

  if (result.error === "ambiguous") {
    const opts = result.options!.map(o => `  [${o.id}] "${o.label}"`).join("\n");
    return { error: `Multiple matches for "${idOrLabel}":\n${opts}\nUse a more specific label or pass the id.` };
  }
  if (result.error) return { error: result.message! };

  const check = await checkElement(client, result.id!);
  if (check.error) return { error: `Matched "${result.label}" but element is stale. Run scan again.`, stale: true };
  return { id: result.id!, label: result.label };
}

// Heavily re-rendering pages (LinkedIn messaging is the canonical case)
// unmount target elements between scan and action, so single-shot resolve
// returns "stale" every time even with rescans the model performs manually
// — the model's think time is enough for another remount cycle. We
// transparently retry once: capture the target's label, re-run the scanner
// (no settle — we want minimal window), re-resolve. Bounded to one retry to
// avoid loops on permanently-removed elements.
//
// Synthetic 200ms churn test: 0/5 → 5/5 success. Zero spurious retries
// across 20 real sites (test-stale-recovery.mts, May 11 2026).
async function resolveElement(
  client: CDP.Client,
  idOrLabel: number | string,
  affordanceFilter?: string,
): Promise<{ id: number } | { error: string }> {
  const first = await tryResolveOnce(client, idOrLabel, affordanceFilter);
  if ("id" in first) return { id: first.id };
  if (!first.stale) return { error: first.error };

  // Recover a label to retry by. For string input, use it directly. For
  // numeric input, look it up in the now-stale labels map before we rescan.
  let retryLabel: string | null = typeof idOrLabel === "string" ? idOrLabel : null;
  if (retryLabel === null) {
    const cached = await evaluate(client, `window.__webpilotLabels?.[${idOrLabel}] ?? null`) as string | null;
    if (typeof cached === "string" && cached.length > 0) retryLabel = cached;
  }
  if (retryLabel === null) return { error: first.error };

  // Fast rescan — no settle, no loading-indicator wait. Speed matters
  // because the page is mutating; a slower scan widens the window for
  // another remount before we act.
  await evaluate(client, SCANNER_JS);

  const retry = await tryResolveOnce(client, retryLabel, affordanceFilter);
  if ("id" in retry) return { id: retry.id };
  return { error: `${first.error} (retried after re-scan: ${retry.error})` };
}

// Schema for tools that accept id or label
const elementRef = z.union([
  z.number().describe("Element ID from scan results"),
  z.string().describe("Element label text (matched against scan labels)"),
]);

// ── Server ──

const server = new McpServer({
  name: "webpilot",
  version: "0.2.0",
});

server.tool(
  "scan",
  "Scan the current page for all interactive elements, grouped by affordance (PRESS, TYPE, SELECT, TOGGLE). Returns element IDs you can use with press/type/select/toggle tools. Call this first before interacting with any page.",
  {},
  async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      return ok(emitScan(await runScan()));
    } catch (e) {
      return err(`Scan failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "press",
  "Press a button, click a link, or activate a pressable element. Accepts element id (number) or label text (string).",
  { element: elementRef.describe("Element ID or label text") },
  async ({ element }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element, "PRESS");
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;
      highlight(client, id);

      const rect = await getRect(client, id);
      if (!rect) return aerr("Element not found. Run scan first.");
      if (rect.obscured) return aerr(`Element [${id}] is obscured by ${rect.obscured}. Dismiss it or scroll to clear the obstruction, then retry.`);

      const before = await snapshotIds(client);
      const urlBefore = await evaluate(client, "location.href") as string;

      await startObserving(client);
      await cdpClick(client, rect.x, rect.y);

      const dr = dialogReturn(`Pressed [${id}].`);
      if (dr) return dr;

      let navigated = false;
      let fullNavigation = false;
      try {
        await waitForSettle(client);
        const urlAfter = await evaluate(client, "location.href") as string;
        navigated = urlAfter !== urlBefore;
      } catch {
        navigated = true;
        fullNavigation = true;
      }

      if (fullNavigation) {
        try { await waitForNavigation(client); } catch {}
      }

      try {
        const result = fullNavigation ? await runScan() : await scanPage(client);
        const text = emitScan(result, before);
        return ok(`Pressed [${id}].${navigated ? " Page navigated." : ""}${alertSuffix()}\n\n${text}`);
      } catch {
        return ok(`Pressed [${id}]. Page is loading — call scan when ready.${alertSuffix()}`);
      }
    } catch (e) {
      return err(`Press failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "type",
  "Type text into an input field, textarea, or contenteditable element. Accepts element id (number) or label text (string). Optionally press a confirm key (enter/tab/escape) after typing.",
  {
    element: elementRef.describe("Element ID or label text"),
    text: z.string().describe("Text to type into the element"),
    clear: z.boolean().optional().default(true).describe("Clear existing value first (default: true)"),
    confirm: z.string().optional().describe("Key to press after typing to confirm (enter, tab, escape). Use for autocomplete fields."),
  },
  async ({ element, text, clear, confirm }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element, "TYPE");
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;
      highlight(client, id);

      const rect = await getRect(client, id);
      if (!rect) return aerr("Element not found. Run scan first.");

      await cdpClick(client, rect.x, rect.y);
      await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (el && document.activeElement !== el) el.focus();
      })()`);

      // Snapshot prior value BEFORE clear/insert so we can detect a clear:true
      // that didn't actually clear (Forms shipped-broken case: prior remained
      // as suffix of new value, see post-ship session 8bbfd98a).
      const priorValue = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        return (el?.value ?? el?.textContent ?? "").substring(0, 200);
      })()`) as string;

      if (clear) {
        await clearField(client, id);
      }

      if (confirm) await startObserving(client);

      await cdpType(client, text);

      await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el || el.tagName !== "INPUT") return;
        const widgetTypes = ["time","date","datetime-local","month","week","number","range","color"];
        if (!widgetTypes.includes(el.type)) return;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (set) set.call(el, ${JSON.stringify(text)});
        else el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);

      if (confirm) {
        await waitForSettle(client);
        await cdpKey(client, confirm);
        const dr = dialogReturn(`Typed into [${id}] (confirmed with ${confirm}).`);
        if (dr) return dr;
      }

      const readback = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        const targetVal = (el?.value ?? el?.textContent ?? "").substring(0, 200);
        if (targetVal) return targetVal;
        const active = document.activeElement;
        if (active && active !== el && active !== document.body) {
          return (active.value ?? active.textContent ?? "").substring(0, 200);
        }
        return targetVal;
      })()`) as string;

      // Anomaly: clear:true was set but prior value remained as substring of
      // new value AND new value is longer than typed text. Catches the Forms
      // "Option AOption 1" case exactly. Safe vs idempotent re-types
      // (new.length == text.length) and vs empty-prior fields.
      if (clear && priorValue && readback.includes(priorValue) && readback.length > text.length) {
        return aerr(
          `type [${id}]: clear:true did not clear prior value '${priorValue.substring(0, 80)}' — ` +
          `value is now '${readback.substring(0, 120)}' (typed '${text.substring(0, 60)}'). ` +
          `Either the element doesn't support clear (custom input?) or clear:false is appropriate here.`
        );
      }

      return ok(`Typed into [${id}]. Value now: "${readback}"${confirm ? ` (confirmed with ${confirm})` : ""}${alertSuffix()}`);
    } catch (e) {
      return err(`Type failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "select",
  "Select an option from a dropdown. Accepts element id (number) or label text (string).",
  {
    element: elementRef.describe("Element ID or label text"),
    value: z.string().describe("Option text or value to select"),
  },
  async ({ element, value }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element, "SELECT");
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;
      highlight(client, id);
      const result = await evaluate(client, `${SELECT_JS}(${id}, ${JSON.stringify(value)})`) as {
        ok?: boolean; error?: string; selected?: string; actual?: string;
      };
      if (result.error) return aerr(result.error);
      // Anomaly: requested option didn't stick. SELECT_JS already extracts
      // both — promote the existing info-readback to an error.
      if (result.selected && result.actual && result.selected !== result.actual) {
        return aerr(
          `select [${id}]: requested '${result.selected}' but shown value is '${result.actual}' — selection did not stick. ` +
          `The select may be a custom widget that needs press()+key() navigation.`
        );
      }
      return ok(`Selected "${result.selected}" on [${id}]. Showing: "${result.actual}"`);
    } catch (e) {
      return err(`Select failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "toggle",
  "Toggle a checkbox, radio button, or switch. Accepts element id (number) or label text (string).",
  { element: elementRef.describe("Element ID or label text") },
  async ({ element }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element, "TOGGLE");
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;
      highlight(client, id);

      const rect = await getRect(client, id);
      if (!rect) return aerr("Element not found. Run scan first.");
      if (rect.obscured) return aerr(`Element [${id}] is obscured by ${rect.obscured}. Dismiss it or scroll to clear the obstruction, then retry.`);

      // Pre-state for anomaly check: if a toggle's state doesn't flip,
      // the click landed on something that ignored it (disabled, managed
      // elsewhere, radio that snapped back).
      const preState = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el) return null;
        return !!(el.checked ?? el.getAttribute("aria-checked") === "true");
      })()`) as boolean | null;

      await cdpClick(client, rect.x, rect.y);

      const dr = dialogReturn(`Toggled [${id}].`);
      if (dr) return dr;

      const state = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el) return { checked: false };
        return { checked: !!(el.checked ?? el.getAttribute("aria-checked") === "true") };
      })()`) as { checked: boolean };

      if (preState !== null && preState === state.checked) {
        return aerr(
          `toggle [${id}]: state did not change (was ${preState ? '✓ checked' : '○ unchecked'}, still is). ` +
          `Element may be disabled, managed elsewhere, or a radio that snapped back.`
        );
      }

      return ok(`Toggled [${id}]. Now: ${state.checked ? "✓ checked" : "○ unchecked"}${alertSuffix()}`);
    } catch (e) {
      return err(`Toggle failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "hover",
  "Move the mouse over an element to reveal hover-only UI (dropdown menus, row action buttons, tooltips). Re-scans after hovering so newly-revealed elements appear in the result. Accepts element id (number) or label text (string).",
  { element: elementRef.describe("Element ID or label text") },
  async ({ element }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element);
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;
      highlight(client, id);

      const rect = await getRect(client, id);
      if (!rect) return aerr("Element not found. Run scan first.");
      if (rect.obscured) return aerr(`Element [${id}] is obscured by ${rect.obscured}. Dismiss it or scroll to clear the obstruction, then retry.`);

      const before = await snapshotIds(client);
      await startObserving(client);
      await cdpHover(client, rect.x, rect.y);
      await waitForSettle(client);

      const dr = dialogReturn(`Hovered [${id}].`);
      if (dr) return dr;

      const result = await scanPage(client);
      const text = emitScan(result, before);
      const hadNew = text.startsWith("NEW:");
      return ok(`Hovered [${id}].${hadNew ? "" : " No new elements appeared."}${alertSuffix()}\n\n${text}`);
    } catch (e) {
      return err(`Hover failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "upload",
  "Upload a file to a file input element. Only works on elements listed under UPLOAD in scan results. Accepts element id (number) or label text (string).",
  {
    element: elementRef.describe("Element ID or label text"),
    filepath: z.string().describe("Absolute path to the file to upload"),
  },
  async ({ element, filepath }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const resolved = await resolveElement(client, element, "UPLOAD");
      if ("error" in resolved) return aerr(resolved.error);
      const id = resolved.id;

      // Use DOM.querySelector to get the backend node ID
      const { root } = await client.DOM.getDocument();
      const { nodeId } = await client.DOM.querySelector({
        nodeId: root.nodeId,
        selector: `input[type="file"]`,
      });

      if (!nodeId) return err("Could not locate file input in DOM.");

      // If there are multiple file inputs, find the right one by matching
      // against our stored element
      const allFileInputs = await evaluate(client, `(() => {
        const inputs = document.querySelectorAll('input[type="file"]');
        const target = window.__webpilot?.[${id}];
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i] === target) return i;
        }
        return 0;
      })()`) as number;

      // Get the right node ID
      const { nodeIds } = await client.DOM.querySelectorAll({
        nodeId: root.nodeId,
        selector: `input[type="file"]`,
      });

      const targetNodeId = nodeIds[allFileInputs] || nodeId;

      await client.DOM.setFileInputFiles({
        files: [filepath],
        nodeId: targetNodeId,
      });

      // Verify by reading back the file name
      const filename = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el || !el.files || el.files.length === 0) return "";
        return el.files[0].name;
      })()`) as string;

      if (filename) {
        return ok(`Uploaded "${filename}" to [${id}].`);
      }
      return ok(`Upload command sent to [${id}]. File: ${filepath.split("/").pop()}`);
    } catch (e) {
      return err(`Upload failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "key",
  `Send a keyboard key press. Use for confirming actions (Enter), dismissing popups (Escape), navigating fields (Tab), or moving through lists (ArrowDown/ArrowUp). Available keys: ${Object.keys(KEY_MAP).join(", ")}. Supports ctrl/shift/alt modifiers.`,
  {
    key: z.string().describe("Key name: enter, tab, escape, backspace, arrowdown, arrowup, space, etc."),
    ctrl: z.boolean().optional().default(false).describe("Hold Ctrl"),
    shift: z.boolean().optional().default(false).describe("Hold Shift"),
    alt: z.boolean().optional().default(false).describe("Hold Alt"),
  },
  async ({ key, ctrl, shift, alt }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      let modifiers = 0;
      if (alt) modifiers |= 1;
      if (ctrl) modifiers |= 2;
      if (shift) modifiers |= 8;
      const keyName = [alt && "Alt", ctrl && "Ctrl", shift && "Shift", key].filter(Boolean).join("+");

      await cdpKey(client, key, modifiers);

      const dr = dialogReturn(`Pressed ${keyName}.`);
      if (dr) return dr;

      const focus = await evaluate(client, `(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "Focus: none";
        const tag = el.tagName.toLowerCase();
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "";
        const val = (el.value ?? el.textContent ?? "").substring(0, 80);
        return "Focus: " + tag + (label ? ' "' + label + '"' : "") + (val ? ' value="' + val + '"' : "");
      })()`) as string;

      return ok(`Pressed ${keyName}. ${focus}${alertSuffix()}`);
    } catch (e) {
      return err(`Key failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "read",
  "Read the page content as plain text. Optionally pass a JS regex (case-insensitive) to keep only matching lines plus -2/+5 lines of context per hit. Examples: 'pip install', '\\\\$\\\\d+\\\\.\\\\d{2}', '^#+ '.",
  {
    regex: z.string().optional().describe("JS regex pattern, case-insensitive. Per-line match with -2/+5 context window per hit; overlapping windows merged. 0 matches returns 'No matches' — model should broaden or drop the regex, not assume the page is empty."),
  },
  async ({ regex }) => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const main = (await evaluate(client, `${READ_JS}().text`)) as string;
      const frames = await readFrames(client);

      let merged = main;
      for (const f of frames) {
        merged += `\n\n--- iframe: ${f.url} ---\n${f.text}`;
      }

      const MAX = 200_000;

      if (!regex) {
        if (merged.length > MAX) {
          return ok(merged.substring(0, MAX) +
            `\n\n[... truncated at ${MAX} of ${merged.length} chars — use read({regex:"..."}) to find specific content]`);
        }
        return ok(merged);
      }

      let re: RegExp;
      try {
        re = new RegExp(regex, "i");
      } catch (e) {
        return err(`Invalid regex /${regex}/: ${e instanceof Error ? e.message : e}`);
      }

      const lines = merged.split("\n");
      const hits: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) hits.push(i);
      }
      if (hits.length === 0) return ok(`No matches for /${regex}/i`);

      // Merge overlapping/adjacent windows in a single forward pass. -2/+5 is
      // asymmetric because the answer usually follows the matched line
      // (heading → paragraph, label → value, "^# Install" → command).
      const windows: [number, number][] = [];
      for (const h of hits) {
        const start = Math.max(0, h - 2);
        const end = Math.min(lines.length, h + 5);
        const last = windows[windows.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else windows.push([start, end]);
      }
      const body = windows.map(([s, e]) => lines.slice(s, e).join("\n")).join("\n---\n");
      const out = `${hits.length} matches for /${regex}/i:\n\n${body}`;
      if (out.length > MAX) {
        return ok(out.substring(0, MAX) +
          `\n\n[... truncated at ${MAX} of ${out.length} chars — tighten the regex]`);
      }
      return ok(out);
    } catch (e) {
      return err(`Read failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "navigate",
  "Navigate to a URL. Automatically scans the new page after loading.",
  { url: z.string().describe("URL to navigate to") },
  async ({ url }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      await navigateTo(client, url);

      // beforeunload from the old page can hold navigation. Don't try to scan
      // until the agent handles the dialog (scan would hang on Runtime.evaluate).
      const dr = dialogReturn(`Navigating to ${url} —`);
      if (dr) return dr;

      // Explicit navigate → reset cache for the target URL so the scan that
      // follows is a fresh full emit. Agents use navigate as a "give me current
      // state" gesture; preserving the cache here would hand them a stale dedup.
      scanCache.delete(urlPathKey(url));

      const text = emitScan(await runScan());
      return ok(`Navigated to ${url}.${alertSuffix()}\n\n${text}`);
    } catch (e) {
      return err(`Navigation failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "scroll",
  "Scroll down the page or a specific scrollable container. Use when scan shows '... more below' or '... N more' on a list. Re-scans after scrolling.",
  {
    target: z.string().optional().describe("Label of an element inside the scrollable container. If omitted, scrolls the page."),
  },
  async ({ target }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      await startObserving(client);
      if (target) {
        await evaluate(client, `(() => {
          const labels = window.__webpilotLabels || {};
          const q = ${JSON.stringify(target)}.toLowerCase();
          for (const id of Object.keys(labels)) {
            if (labels[id].toLowerCase().includes(q)) {
              const el = window.__webpilot[id];
              if (!el) continue;
              let node = el.parentElement;
              while (node && node !== document.body) {
                const s = getComputedStyle(node);
                if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10) {
                  node.scrollBy({ top: node.clientHeight * 0.8, behavior: "instant" });
                  return;
                }
                node = node.parentElement;
              }
            }
          }
        })()`);
      } else {
        await evaluate(client, `window.scrollBy({ top: window.innerHeight * 0.8, behavior: "instant" })`);
      }
      await waitForSettle(client);
      const text = emitScan(await scanPage(client));
      return ok(`Scrolled${target ? ` "${target}"` : ""} down.\n\n${text}`);
    } catch (e) {
      return err(`Scroll failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "expand",
  "Show ALL items in a scrollable list (time picker, dropdown, etc.). Use when scan shows '... N more' on a bounded list. Returns all items from that container.",
  {
    target: z.string().describe("Label of an element inside the scrollable container to expand"),
  },
  async ({ target }) => serialized(async () => {
    const blocked = dialogBlock();
    if (blocked) return blocked;
    try {
      const client = await getClient(CDP_PORT);
      const items = await evaluate(client, `(() => {
        const labels = window.__webpilotLabels || {};
        const q = ${JSON.stringify(target)}.toLowerCase();
        // Find the element matching the label
        for (const id of Object.keys(labels)) {
          if (!labels[id].toLowerCase().includes(q)) continue;
          const el = window.__webpilot[id];
          if (!el) continue;
          // Walk up to find the scroll container
          let node = el.parentElement;
          while (node && node !== document.body) {
            const s = getComputedStyle(node);
            if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10) {
              // Found the scroll container — get ALL clickable children
              const items = [];
              for (const child of node.querySelectorAll("*")) {
                const r = child.getBoundingClientRect();
                if (r.width < 3 || r.height < 3) continue;
                const text = (child.innerText || "").trim().replace(/\\n+/g, " ");
                if (!text || text.length > 80) continue;
                if (child.children.length > 2) continue;
                items.push(text);
              }
              // Deduplicate
              return [...new Set(items)];
            }
            node = node.parentElement;
          }
        }
        return null;
      })()`) as string[] | null;

      if (!items) return aerr(`No scrollable container found near "${target}".`);
      const text = items.map(item => `  ${item}`).join("\n");
      return ok(`Expanded list near "${target}" (${items.length} items):\n${text}`);
    } catch (e) {
      return err(`Expand failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "tabs",
  "List all open browser tabs with their IDs. Use switch_tab to change the active tab.",
  {},
  async () => {
    try {
      const tabs = await listTabs(CDP_PORT);
      const text = tabs
        .map((t, i) => `[${i}] ${t.title}\n    ${t.url}\n    id: ${t.id}`)
        .join("\n\n");
      return ok(text || "No tabs found.");
    } catch (e) {
      return err(`Tabs failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "switch_tab",
  "Switch to a different browser tab by its ID (from the tabs tool).",
  { tab_id: z.string().describe("Tab ID from the tabs tool output") },
  async ({ tab_id }) => {
    try {
      await switchTab(CDP_PORT, tab_id);
      const text = emitScan(await runScan());
      return ok(`Switched tab.\n\n${text}`);
    } catch (e) {
      return err(`Switch failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "dialog",
  "Respond to a browser dialog (confirm, prompt, or beforeunload). Only usable when a dialog is open — other tools will tell you when one appears.",
  {
    accept: z.boolean().describe("true to accept (OK/confirm/yes), false to dismiss (Cancel/no)"),
    text: z.string().optional().describe("Text to enter for prompt dialogs before accepting"),
  },
  async ({ accept, text }) => serialized(async () => {
    try {
      const d = getPendingDialog();
      if (!d) return err("No dialog is currently open.");
      const client = await getClient(CDP_PORT);
      await handlePendingDialog(client, accept, text);
      const alert = alertSuffix();
      try {
        const result = await runScan();
        const action = accept ? "accepted" : "dismissed";
        return ok(`Dialog ${action}.${alert}\n\n${emitScan(result)}`);
      } catch {
        const action = accept ? "accepted" : "dismissed";
        return ok(`Dialog ${action}. Page is loading — call scan when ready.${alert}`);
      }
    } catch (e) {
      return err(`Dialog failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
