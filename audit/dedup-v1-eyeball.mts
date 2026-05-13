// Quick eyeball: print before/after for one site to verify dedup output is
// human (and agent) readable.

import CDP from "chrome-remote-interface";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const URL = process.argv[2] || "https://en.wikipedia.org/wiki/Cat";

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function ev<T>(e: string): Promise<T | null> {
  try {
    const { result } = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    return result.value as T;
  } catch { return null; }
}

await Page.navigate({ url: URL });
await Promise.race([Page.loadEventFired(), new Promise(r => setTimeout(r, 12000))]);
await new Promise(r => setTimeout(r, 2000));

await ev(`(() => { delete window.__wpIdMap; delete window.__wpNextId; delete window.__vimx; delete window.__vimxRects; delete window.__vimxLabels; delete window.__vimxAffordances; delete window.__vimxRegions; })()`);

interface ScanEntry { id: number; tag: string; label: string; value?: string; inputType?: string; placeholder?: string; options?: string[]; checked?: boolean; href?: string; region?: string; }
interface ScanResult { url: string; title: string; groups: Record<string, ScanEntry[]>; total: number; pageScrollable?: boolean; }
interface ScanState { elementSigs: Map<number, string>; byRegion: Map<string, Set<number>>; title: string; }

function cleanHref(href: string): string {
  const q = href.indexOf("?"); if (q === -1) return href;
  const path = href.substring(0, q);
  const params = href.substring(q + 1).split("&").filter(p => {
    const eq = p.indexOf("="); if (eq === -1) return true;
    const val = p.substring(eq + 1);
    const hasW = /[a-z]{4,}/.test(val), hasS = /[+]|%20|%3A|%26|%2F|%3D/i.test(val);
    return !((val.length > 16 && !hasW) || (val.length > 32 && !hasS));
  });
  return params.length === 0 ? path : path + "?" + params.join("&");
}
function entrySig(e: ScanEntry, aff: string): string {
  return [aff, e.tag, e.label || "", e.href || "", e.value || "", e.checked ? "1" : "", e.region || ""].join("|");
}
function snapshotState(s: ScanResult): ScanState {
  const elementSigs = new Map<number, string>();
  const byRegion = new Map<string, Set<number>>();
  for (const aff of ["PRESS","TYPE","SELECT","TOGGLE","UPLOAD"]) {
    for (const e of s.groups[aff] || []) {
      elementSigs.set(e.id, entrySig(e, aff));
      const r = e.region || "_unassigned";
      if (!byRegion.has(r)) byRegion.set(r, new Set());
      byRegion.get(r)!.add(e.id);
    }
  }
  return { elementSigs, byRegion, title: s.title };
}
function compactIds(ids: number[]): string {
  if (!ids.length) return "";
  const s = [...ids].sort((a,b) => a-b);
  const out: string[] = []; let st = s[0], pr = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === pr + 1) { pr = s[i]; continue; }
    out.push(st === pr ? `${st}` : `${st}-${pr}`);
    st = pr = s[i];
  }
  out.push(st === pr ? `${st}` : `${st}-${pr}`);
  return out.join(", ");
}
function fmtE(aff: string, e: ScanEntry): string {
  const reg = e.region ? ` [${e.region}]` : "";
  if (aff === "PRESS") {
    const href = e.href ? ` → ${cleanHref(e.href)}` : "";
    return `  [${e.id}] ${e.tag} "${e.label}"${href}${reg}`;
  }
  if (aff === "TYPE") return `  [${e.id}] ${e.tag}[${e.inputType||"text"}]${e.value?` value="${e.value}"`:""} "${e.label}"${reg}`;
  if (aff === "TOGGLE") return `  [${e.id}] ${e.tag} "${e.label}" ${e.checked?"✓":"○"}${reg}`;
  return `  [${e.id}] ${e.tag} "${e.label}"${reg}`;
}
const HEAD: Record<string,string> = { PRESS: "PRESS → press(element)", TYPE: "TYPE → type(element, text)", SELECT: "SELECT → select(element, value)", TOGGLE: "TOGGLE → toggle(element)", UPLOAD: "UPLOAD → upload(element, filepath)" };

function formatFull(s: ScanResult): string {
  const lines = [`Page: ${s.title}`, `URL: ${s.url}`, `Elements: ${s.total}`];
  if (s.pageScrollable) lines.push(`... more below — scroll() for next page`);
  lines.push("");
  for (const aff of ["PRESS","TYPE","SELECT","TOGGLE","UPLOAD"]) {
    const g = s.groups[aff]; if (!g || !g.length) continue;
    lines.push(HEAD[aff]);
    const seen = new Set<string>();
    for (const e of g) {
      const k = e.label + "|" + (e.href || "");
      if (!e.label || !seen.has(k)) { seen.add(k); lines.push(fmtE(aff, e)); }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatDedup(s: ScanResult, prev: ScanState): string {
  const nI = new Set<number>(), cI = new Set<number>(), uI = new Set<number>();
  const cur = new Map<number, string>();
  for (const aff of ["PRESS","TYPE","SELECT","TOGGLE","UPLOAD"]) {
    for (const e of s.groups[aff] || []) {
      const sig = entrySig(e, aff); cur.set(e.id, sig);
      const ps = prev.elementSigs.get(e.id);
      if (ps === undefined) nI.add(e.id);
      else if (ps !== sig) cI.add(e.id);
      else uI.add(e.id);
    }
  }
  const rI = new Set<number>();
  for (const id of prev.elementSigs.keys()) if (!cur.has(id)) rI.add(id);
  const noCh = !nI.size && !cI.size && !rI.size;
  const lines: string[] = [`Page: ${s.title}`, `URL: ${s.url}`];
  if (noCh) {
    lines.push(`Elements: ${s.total} (unchanged since last scan, ids: ${compactIds([...uI])})`);
    return lines.join("\n");
  }
  const parts: string[] = [];
  if (nI.size) parts.push(`${nI.size} new`);
  if (cI.size) parts.push(`${cI.size} changed`);
  if (rI.size) parts.push(`${rI.size} gone`);
  if (uI.size) parts.push(`${uI.size} unchanged`);
  lines.push(`Elements: ${s.total} (${parts.join(", ")})`);
  lines.push("");
  if (rI.size) { lines.push(`GONE since last scan: ${compactIds([...rI])}`); lines.push(""); }
  for (const aff of ["PRESS","TYPE","SELECT","TOGGLE","UPLOAD"]) {
    const g = s.groups[aff]; if (!g || !g.length) continue;
    const nE = g.filter(e => nI.has(e.id));
    const cE = g.filter(e => cI.has(e.id));
    const uE = g.filter(e => uI.has(e.id));
    if (!nE.length && !cE.length && !uE.length) continue;
    lines.push(HEAD[aff]);
    for (const e of nE) lines.push(fmtE(aff, e) + "  ← new");
    for (const e of cE) lines.push(fmtE(aff, e) + "  ← changed");
    if (uE.length) {
      const byR = new Map<string, number[]>();
      for (const e of uE) { const r = e.region || "_unassigned"; if (!byR.has(r)) byR.set(r, []); byR.get(r)!.push(e.id); }
      const order = ["header","nav","search","main","aside","footer","modal","_unassigned"];
      const rs = [...byR.keys()].sort((a,b) => { const ia = order.indexOf(a), ib = order.indexOf(b); if (ia>=0 && ib>=0) return ia-ib; if (ia>=0) return -1; if (ib>=0) return 1; return a.localeCompare(b); });
      const sums: string[] = [];
      for (const r of rs) { const ids = byR.get(r)!; const d = r === "_unassigned" ? "?" : r; sums.push(`${d}: ${ids.length} (${compactIds(ids)})`); }
      lines.push(`  Unchanged — ${sums.join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

const s1 = await ev<ScanResult>(SCANNER_JS);
if (!s1) { console.log("scan1 fail"); process.exit(1); }
const st1 = snapshotState(s1);

const s2 = await ev<ScanResult>(SCANNER_JS);
if (!s2) { console.log("scan2 fail"); process.exit(1); }

console.log("============= scan #1 (full) =============");
console.log(formatFull(s1));
console.log("\n============= scan #2 (full) =============");
console.log(formatFull(s2));
console.log("\n============= scan #2 (dedup vs state #1) =============");
console.log(formatDedup(s2, st1));

await client.close();
