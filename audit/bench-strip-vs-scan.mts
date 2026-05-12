// Follow-up: of the content stripped from read(), how much is just link
// labels that scan() already surfaces? Only the residual (prose-not-in-a-link)
// is a genuine blind spot.
//
// For each site: collect scan link labels + all anchor text in the page,
// classify each stripped line as "in scan" or "prose-not-in-link", report.

import CDP from "chrome-remote-interface";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRIP_DIR = resolvePath(__dirname, "data", "chrome-strip");
const OUT_DIR = resolvePath(__dirname, "data", "strip-vs-scan");
mkdirSync(OUT_DIR, { recursive: true });

// Pick a representative set spanning the patterns we already saw:
//   - Wikipedia bio (navboxes)
//   - Wikipedia article (article footer + navboxes)
//   - Marketing homepage (Anthropic — footer-as-content)
//   - News homepage (Guardian — story-card metadata)
//   - News homepage (NYT — section/topic groupings)
//   - E-commerce homepage (eBay — promo carousel)
//   - Gov / institutional (Congress — "News from..." card)
//   - LMS homepage (Khan — subject menu)
//   - SO question (sidebars)
const TARGETS = [
  { slug: "en_wikipedia_org_wiki_Geoffrey_Hinton", url: "https://en.wikipedia.org/wiki/Geoffrey_Hinton" },
  { slug: "en_wikipedia_org_wiki_Cornell_University", url: "https://en.wikipedia.org/wiki/Cornell_University" },
  { slug: "www_anthropic_com_", url: "https://www.anthropic.com/" },
  { slug: "www_theguardian_com_international", url: "https://www.theguardian.com/international" },
  { slug: "www_nytimes_com_", url: "https://www.nytimes.com/" },
  { slug: "www_ebay_com_", url: "https://www.ebay.com/" },
  { slug: "www_congress_gov_", url: "https://www.congress.gov/" },
  { slug: "www_khanacademy_org_", url: "https://www.khanacademy.org/" },
  { slug: "stackoverflow_com_questions_231767_what_does_the_yield_keywo", url: "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python" },
];

// Grab ALL link labels via a custom snippet — scan() only includes
// "interactive" ones, but for this comparison we want every <a> in the page,
// since a nav-link buried in chrome may not appear in scan due to deduping
// or visibility filtering. The fair comparison is "is this text accessible
// to the agent via SOME tool other than read()?"
const ALL_LINKS_JS = `(() => {
  const out = [];
  for (const a of document.querySelectorAll("a")) {
    const t = (a.innerText || a.textContent || "").trim();
    if (t) out.push(t);
    // also include aria-label, since scan uses it as a fallback label
    const al = (a.getAttribute("aria-label") || "").trim();
    if (al && al !== t) out.push(al);
  }
  return out;
})()`;

const list = await CDP.List({ port: CDP_PORT });
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

async function evalJSON<T>(expr: string): Promise<T | null> {
  try {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true, timeout: 8000,
    });
    if (exceptionDetails) return null;
    return result.value as T;
  } catch { return null; }
}

interface ScanEntry { id: number; tag: string; label: string; href?: string }
interface ScanResult { groups: Record<string, ScanEntry[]>; total: number }

interface Row {
  url: string;
  stripChars: number;
  stripLines: number;
  linesLinkOnly: number;
  linesProse: number;
  linkOnlyChars: number;
  proseChars: number;
  scanLinkCount: number;
  allLinkCount: number;
  samplesProse: string[];
}
const rows: Row[] = [];

for (const t of TARGETS) {
  console.error(`\n=== ${t.slug} ===`);
  if (!(await nav(t.url))) { console.error("nav fail"); continue; }

  const scan = await evalJSON<ScanResult>(SCANNER_JS);
  const allLinks = await evalJSON<string[]>(ALL_LINKS_JS);
  if (!scan || !allLinks) { console.error("eval fail"); continue; }

  const labelSet = new Set<string>();
  for (const group of Object.values(scan.groups || {})) {
    for (const e of group) if (e.label) labelSet.add(e.label.trim().toLowerCase());
  }
  const linkSet = new Set<string>(allLinks.map(s => s.trim().toLowerCase()).filter(Boolean));
  const everySurface = new Set([...labelSet, ...linkSet]);

  let diff: string;
  try { diff = readFileSync(resolvePath(STRIP_DIR, `${t.slug}.diff.txt`), "utf8"); }
  catch { console.error("no diff file"); continue; }

  const lines = diff.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let linkOnly = 0, prose = 0, linkChars = 0, proseChars = 0;
  const proseSamples: string[] = [];

  for (const line of lines) {
    const lc = line.toLowerCase();
    // Cover cases:
    //   1. exact line match in scan/link set
    //   2. line is a concatenation of multiple link labels (Wikipedia navboxes
    //      flatten "1976: Richter / Ting1977: P. W. Anderson…" — these aren't
    //      a single link but the page contains every fragment as separate <a>)
    let covered = everySurface.has(lc);
    if (!covered) {
      // Check whether removing all known link labels from the line leaves
      // mostly whitespace/punctuation. If yes, the line is link-text-only.
      let residual = line;
      // sort longest-first so we strip the most distinctive labels first
      const candidates = [...everySurface].filter(s => s.length >= 3).sort((a, b) => b.length - a.length).slice(0, 500);
      for (const c of candidates) {
        if (residual.toLowerCase().includes(c)) {
          const idx = residual.toLowerCase().indexOf(c);
          residual = residual.slice(0, idx) + residual.slice(idx + c.length);
        }
        if (residual.replace(/[\s\W]+/g, "").length < 5) break;
      }
      const residualClean = residual.replace(/[\s\W]+/g, "");
      if (residualClean.length < 8 || residualClean.length / line.length < 0.2) covered = true;
    }
    if (covered) { linkOnly++; linkChars += line.length; }
    else {
      prose++; proseChars += line.length;
      if (proseSamples.length < 8) proseSamples.push(line.slice(0, 200));
    }
  }

  const row: Row = {
    url: t.url, stripChars: diff.length, stripLines: lines.length,
    linesLinkOnly: linkOnly, linesProse: prose,
    linkOnlyChars: linkChars, proseChars,
    scanLinkCount: labelSet.size, allLinkCount: linkSet.size,
    samplesProse: proseSamples,
  };
  rows.push(row);
  console.error(`strip lines=${lines.length} link-only=${linkOnly} prose=${prose} prose-chars=${proseChars}/${diff.length}`);
  writeFileSync(resolvePath(OUT_DIR, `${t.slug}.prose.txt`), proseSamples.join("\n---\n"));
}

const md: string[] = [];
md.push("# strip-vs-scan: prose-only loss from chrome strip");
md.push("");
md.push("For each site: stripped lines classified as either (a) link text already surfaced by scan() / known <a> labels, or (b) prose-not-in-link (genuine blind spot).");
md.push("");
md.push("| site | strip chars | strip lines | link-only | prose | prose chars | prose % | scan labels | total links |");
md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const r of rows.sort((a, b) => b.proseChars - a.proseChars)) {
  const pct = r.stripChars > 0 ? Math.round((r.proseChars / r.stripChars) * 100) : 0;
  md.push(`| ${r.url} | ${r.stripChars} | ${r.stripLines} | ${r.linesLinkOnly} | ${r.linesProse} | ${r.proseChars} | ${pct} | ${r.scanLinkCount} | ${r.allLinkCount} |`);
}
md.push("");
md.push("## Prose samples per site (genuine blind spots)");
md.push("");
for (const r of rows) {
  md.push(`### ${r.url}`);
  md.push(`prose lines: ${r.linesProse}, prose chars: ${r.proseChars}`);
  md.push("```");
  md.push(r.samplesProse.join("\n---\n") || "(no prose-only lines)");
  md.push("```");
  md.push("");
}

writeFileSync(resolvePath(OUT_DIR, "REPORT.md"), md.join("\n"));
console.error(`\nReport: ${resolvePath(OUT_DIR, "REPORT.md")}`);

await client.close();
try { await CDP.Close({ port: CDP_PORT, id: newTab.id }); } catch {}
