// Measures cold-scan size overhead of adding [region] tags to every entry.
// This is the cost the dedup buys back on subsequent scans.

import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITES = [
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

interface ScanEntry { id: number; tag: string; label: string; value?: string; inputType?: string; placeholder?: string; options?: string[]; checked?: boolean; href?: string; region?: string; }
interface ScanResult { url: string; title: string; groups: Record<string, ScanEntry[]>; total: number; pageScrollable?: boolean; }

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

function fmtWithRegion(aff: string, e: ScanEntry): string {
  const reg = e.region ? ` [${e.region}]` : "";
  if (aff === "PRESS") {
    const href = e.href ? ` → ${cleanHref(e.href)}` : "";
    return `  [${e.id}] ${e.tag} "${e.label}"${href}${reg}`;
  }
  if (aff === "TYPE") return `  [${e.id}] ${e.tag}[${e.inputType||"text"}]${e.value?` value="${e.value}"`:""} "${e.label}"${reg}`;
  if (aff === "TOGGLE") return `  [${e.id}] ${e.tag} "${e.label}" ${e.checked?"✓":"○"}${reg}`;
  return `  [${e.id}] ${e.tag} "${e.label}"${reg}`;
}

function fmtNoRegion(aff: string, e: ScanEntry): string {
  if (aff === "PRESS") {
    const href = e.href ? ` → ${cleanHref(e.href)}` : "";
    return `  [${e.id}] ${e.tag} "${e.label}"${href}`;
  }
  if (aff === "TYPE") return `  [${e.id}] ${e.tag}[${e.inputType||"text"}]${e.value?` value="${e.value}"`:""} "${e.label}"`;
  if (aff === "TOGGLE") return `  [${e.id}] ${e.tag} "${e.label}" ${e.checked?"✓":"○"}`;
  return `  [${e.id}] ${e.tag} "${e.label}"`;
}

const HEAD: Record<string,string> = { PRESS: "PRESS → press(element)", TYPE: "TYPE → type(element, text)", SELECT: "SELECT → select(element, value)", TOGGLE: "TOGGLE → toggle(element)", UPLOAD: "UPLOAD → upload(element, filepath)" };

function format(scan: ScanResult, withRegion: boolean): string {
  const lines = [`Page: ${scan.title}`, `URL: ${scan.url}`, `Elements: ${scan.total}`];
  if (scan.pageScrollable) lines.push(`... more below — scroll() for next page`);
  lines.push("");
  for (const aff of ["PRESS","TYPE","SELECT","TOGGLE","UPLOAD"]) {
    const g = scan.groups[aff]; if (!g || !g.length) continue;
    lines.push(HEAD[aff]);
    const seen = new Set<string>();
    for (const e of g) {
      const k = e.label + "|" + (e.href || "");
      if (!e.label || !seen.has(k)) { seen.add(k); lines.push(withRegion ? fmtWithRegion(aff, e) : fmtNoRegion(aff, e)); }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const c = await CDP({ port: CDP_PORT });
const { Page, Runtime } = c;
await Promise.all([Page.enable(), Runtime.enable()]);

interface Row { url: string; with_region: number; no_region: number; pct: number; els: number; }
const rows: Row[] = [];

for (const url of SITES) {
  await Page.navigate({ url });
  await new Promise(r => setTimeout(r, 2500));
  await Runtime.evaluate({ expression: `(() => { delete window.__wpIdMap; delete window.__wpNextId; delete window.__vimx; delete window.__vimxRects; delete window.__vimxLabels; delete window.__vimxAffordances; delete window.__vimxRegions; })()` });
  const { result } = await Runtime.evaluate({ expression: SCANNER_JS, returnByValue: true });
  const s = result.value as ScanResult;
  if (!s) { console.log(`${url}: fail`); continue; }
  const wr = format(s, true).length;
  const nr = format(s, false).length;
  const els = s.total;
  const pct = nr > 0 ? ((wr - nr) / nr * 100) : 0;
  rows.push({ url, with_region: wr, no_region: nr, pct, els });
  console.log(`${url.replace(/^https?:\/\//, "").substring(0,46).padEnd(46)} | el=${els.toString().padStart(3)} | no_reg=${nr.toString().padStart(6)} | with_reg=${wr.toString().padStart(6)} | overhead=${pct.toFixed(1)}%`);
}

await c.close();

const avg = (xs: number[]) => xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : 0;
const avgPct = avg(rows.map(r => r.pct));
const totalNR = rows.reduce((a,b) => a + b.no_region, 0);
const totalWR = rows.reduce((a,b) => a + b.with_region, 0);
const aggPct = totalNR > 0 ? (totalWR - totalNR) / totalNR * 100 : 0;

console.log(`\nAvg per-site overhead: ${avgPct.toFixed(1)}%`);
console.log(`Aggregate (sum across sites): ${totalNR} -> ${totalWR} = +${aggPct.toFixed(1)}%`);
console.log(`Bytes added per element on avg: ${((totalWR - totalNR) / rows.reduce((a,b) => a + b.els, 0)).toFixed(1)}`);

writeFileSync(resolvePath(__dirname, "data/region-tag-overhead.json"), JSON.stringify(rows, null, 2));
