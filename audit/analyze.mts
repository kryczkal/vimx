// Read audit/data/examples.jsonl and produce a per-tool regression report.
//
// What the model sees from a vimx tool is the raw "og" / "now" text we
// stored. This analyzer's job is to make the size, shape, and contents of
// those differences inspectable at a glance.
//
// Output: stdout summary + a markdown report at audit/data/REPORT.md that
// walks through the top deltas with side-by-side excerpts.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolvePath(__dirname, "data");
const EXAMPLES_PATH = resolvePath(DATA_DIR, "examples.jsonl");
const REPORT_PATH = resolvePath(DATA_DIR, "REPORT.md");

interface Example {
  site: string;
  tool: string;
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

const examples: Example[] = readFileSync(EXAMPLES_PATH, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

console.log(`Loaded ${examples.length} examples`);

// ── Group by tool ──────────────────────────────────────────────────────────

const byTool = new Map<string, Example[]>();
for (const ex of examples) {
  if (!byTool.has(ex.tool)) byTool.set(ex.tool, []);
  byTool.get(ex.tool)!.push(ex);
}

console.log("\n=== Examples per tool ===");
for (const [tool, exs] of byTool) console.log(`  ${tool.padEnd(24)} ${exs.length}`);

// ── Per-tool aggregate stats ──────────────────────────────────────────────

function pctChange(og: number, now: number): string {
  if (og === 0 && now === 0) return "—";
  if (og === 0) return `∞ (+${now})`;
  const pct = ((now - og) / og) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function structuralMarkers(text: string): {
  md_headings: number;
  md_links: number;
  md_images: number;
  md_lists: number;
  md_bold: number;
  md_strike: number;
  iframe_sections: number;
  newlines: number;
} {
  return {
    md_headings: (text.match(/^#{1,6} /gm) || []).length,
    md_links: (text.match(/\[[^\]]+\]\([^)]+\)/g) || []).length,
    md_images: (text.match(/!\[[^\]]*\]/g) || []).length,
    md_lists: (text.match(/^- /gm) || []).length,
    md_bold: (text.match(/\*\*[^*]+\*\*/g) || []).length,
    md_strike: (text.match(/~~[^~]+~~/g) || []).length,
    iframe_sections: (text.match(/^--- iframe: /gm) || []).length,
    newlines: (text.match(/\n/g) || []).length,
  };
}

console.log("\n=== Scan (SCANNER_JS disambig change) ===");
{
  const scans = byTool.get("scan") || [];
  const changed = scans.filter(s => !s.meta.identical);
  console.log(`  Total scans:               ${scans.length}`);
  console.log(`  Identical og/now:          ${scans.length - changed.length}`);
  console.log(`  Different og/now:          ${changed.length}`);

  // The disambig change ADDS labels at NOW that didn't exist at OG (when
  // duplicate buttons were collapsed). Quantify: how many extra elements
  // appear in NOW vs OG total counts.
  let extraElems = 0;
  let losses = 0;
  for (const s of scans) {
    const ogTotalNote = (s.meta.notes || []).find(n => n.startsWith("og_total="));
    const nowTotalNote = (s.meta.notes || []).find(n => n.startsWith("now_total="));
    if (ogTotalNote && nowTotalNote) {
      const ogN = parseInt(ogTotalNote.split("=")[1], 10);
      const nowN = parseInt(nowTotalNote.split("=")[1], 10);
      if (nowN > ogN) extraElems += nowN - ogN;
      else if (nowN < ogN) losses += ogN - nowN;
    }
  }
  console.log(`  Total elements OG → NOW:   gained ${extraElems}, lost ${losses}`);

  // Count "[disambig]" suffixes in NOW output that aren't in OG
  let disambigLines = 0;
  for (const s of scans) {
    if (s.meta.identical) continue;
    const nowSuffixes = (s.now.match(/"[^"]+ \[[^\]]+\]"/g) || []).length;
    const ogSuffixes = (s.og.match(/"[^"]+ \[[^\]]+\]"/g) || []).length;
    disambigLines += Math.max(0, nowSuffixes - ogSuffixes);
  }
  console.log(`  New "label [disambig]" lines exposed to model: ${disambigLines}`);
}

console.log("\n=== Read.no_query (READ_JS rewrite) ===");
{
  const reads = byTool.get("read.no_query") || [];
  const changed = reads.filter(r => !r.meta.identical);
  console.log(`  Total reads:               ${reads.length}`);
  console.log(`  Identical og/now:          ${reads.length - changed.length}`);
  console.log(`  Different og/now:          ${changed.length}`);

  let ogChars = 0, nowChars = 0;
  for (const r of reads) { ogChars += r.og.length; nowChars += r.now.length; }
  console.log(`  Total chars OG:            ${ogChars.toLocaleString()}`);
  console.log(`  Total chars NOW:           ${nowChars.toLocaleString()}`);
  console.log(`  Delta:                     ${pctChange(ogChars, nowChars)}`);

  // Aggregate markdown markers
  let og = { md_headings: 0, md_links: 0, md_images: 0, md_lists: 0, md_bold: 0, md_strike: 0, iframe_sections: 0, newlines: 0 };
  let now = { ...og };
  for (const r of reads) {
    const o = structuralMarkers(r.og); const n = structuralMarkers(r.now);
    for (const k of Object.keys(og) as (keyof typeof og)[]) { og[k] += o[k]; now[k] += n[k]; }
  }
  console.log("\n  Structural markers seen by model (summed across all sites):");
  console.log(`  ${"marker".padEnd(20)} ${"OG".padStart(10)}  ${"NOW".padStart(10)}  ${"delta".padStart(10)}`);
  for (const k of Object.keys(og) as (keyof typeof og)[]) {
    console.log(`  ${k.padEnd(20)} ${String(og[k]).padStart(10)}  ${String(now[k]).padStart(10)}  ${pctChange(og[k], now[k]).padStart(10)}`);
  }

  // Per-site sites where NOW gained content (iframes / portal dialogs):
  const nowGains = reads.filter(r => r.now.length > r.og.length).sort((a, b) => (b.now.length - b.og.length) - (a.now.length - a.og.length));
  console.log("\n  Top 5 sites where NOW > OG:");
  for (const r of nowGains.slice(0, 5)) {
    console.log(`    ${r.site.replace(/^https?:\/\//, "").slice(0, 55).padEnd(55)}  og=${r.og.length}  now=${r.now.length}  Δ=+${r.now.length - r.og.length}`);
  }

  const ogGains = reads.filter(r => r.og.length > r.now.length).sort((a, b) => (b.og.length - b.now.length) - (a.og.length - a.now.length));
  console.log("\n  Top 5 sites where OG > NOW (content the model LOST):");
  for (const r of ogGains.slice(0, 5)) {
    console.log(`    ${r.site.replace(/^https?:\/\//, "").slice(0, 55).padEnd(55)}  og=${r.og.length}  now=${r.now.length}  Δ=${r.now.length - r.og.length}`);
  }
}

console.log("\n=== Read.query (query filter rewrite) ===");
{
  const reads = byTool.get("read.query") || [];
  const changed = reads.filter(r => !r.meta.identical);
  console.log(`  Total query reads:         ${reads.length}`);
  console.log(`  Identical og/now:          ${reads.length - changed.length}`);
  console.log(`  Different og/now:          ${changed.length}`);
  let ogChars = 0, nowChars = 0;
  for (const r of reads) { ogChars += r.og.length; nowChars += r.now.length; }
  console.log(`  Total chars OG:            ${ogChars}`);
  console.log(`  Total chars NOW:           ${nowChars}`);
  console.log(`  Delta:                     ${pctChange(ogChars, nowChars)}`);

  // Check structure of results: og used in-JS filter (returns concatenated
  // section text); now uses TS-side line filter (wraps with "Found N sections
  // matching '...':" header).
  const nowHasHeader = reads.filter(r => r.now.startsWith("Found ")).length;
  const ogHasHeader = reads.filter(r => r.og.startsWith("Found ")).length;
  console.log(`  Reads with "Found N sections" header — og: ${ogHasHeader}  now: ${nowHasHeader}`);
}

console.log("\n=== Resolve.same_input (label string identical, regime differs) ===");
{
  const rs = byTool.get("resolve.same_input") || [];
  console.log(`  Total resolves:            ${rs.length}`);
  const identical = rs.filter(r => r.meta.identical).length;
  console.log(`  Identical og/now:          ${identical}`);

  const ogOK = rs.filter(r => /og.matched=true/.test((r.meta.notes || []).join(" "))).length;
  const nowOK = rs.filter(r => /now.matched=true/.test((r.meta.notes || []).join(" "))).length;
  const ogAmbig = rs.filter(r => r.og.startsWith("AMBIGUOUS")).length;
  const nowAmbig = rs.filter(r => r.now.startsWith("AMBIGUOUS")).length;
  console.log(`  OG matched:                ${ogOK}   ambiguous: ${ogAmbig}`);
  console.log(`  NOW matched:               ${nowOK}  ambiguous: ${nowAmbig}`);

  // Where OG succeeded but NOW returned ambig — that's a regression for the
  // common case where the model uses the same label.
  const regressions = rs.filter(r =>
    /og.matched=true/.test((r.meta.notes || []).join(" ")) &&
    r.now.startsWith("AMBIGUOUS")
  );
  console.log(`  Regressions (og OK → now ambig): ${regressions.length}`);
  for (const r of regressions.slice(0, 5)) {
    console.log(`    ${r.site.replace(/^https?:\/\//, "").slice(0, 50)}  label="${(r.input as { label: string }).label.slice(0, 40)}"`);
  }
}

console.log("\n=== Resolve.scan_label (each regime uses its OWN scan label) ===");
{
  const rs = byTool.get("resolve.scan_label") || [];
  console.log(`  Total resolves:            ${rs.length}`);
  if (rs.length === 0) {
    console.log(`  (No disambig'd labels in NOW with bare-prefix in OG — see analyzer note)`);
  } else {
    const ogOK = rs.filter(r => /og.matched=true/.test((r.meta.notes || []).join(" "))).length;
    const nowOK = rs.filter(r => /now.matched=true/.test((r.meta.notes || []).join(" "))).length;
    console.log(`  OG matched (with bare label):   ${ogOK}`);
    console.log(`  NOW matched (with disambig'd):  ${nowOK}`);
  }
}

// ── Markdown report ──────────────────────────────────────────────────────

function excerpt(text: string, chars: number): string {
  return text.length > chars ? text.slice(0, chars) + "…" : text;
}

const md: string[] = [];
md.push("# Vimx tool audit — commit 5 vs current");
md.push("");
md.push(`Examples captured: **${examples.length}**, across ${byTool.size} tool flavors.`);
md.push("");
md.push("- **OG** = commit 5 = `d7d84e3` (before disambig fix, custom-markdown read walker).");
md.push("- **NOW** = working tree (after `aec5902` innerText refactor + WIP iframe-merge in index.ts).");
md.push("");

// SCAN
md.push("## scan — disambiguation behavior");
md.push("");
const scans = byTool.get("scan") || [];
md.push(`${scans.filter(s => !s.meta.identical).length} of ${scans.length} sites produced a different scan output.`);
md.push("");
md.push("OG SCANNER_JS skipped disambig when all duplicates shared the same href, including the all-empty case (most `<button>`s). The formatter's `dedup` then collapsed the buttons by `label|href` key, so the model only ever saw ONE row per group of identical-labelled buttons, even though `window.__vimx[]` held all of them. Action on the dropped buttons was effectively unreachable.");
md.push("");
md.push("NOW disambiguates buttons too. Duplicates get `Label [unique-context]` suffixes, the formatter no longer collapses them, and the model sees every clickable.");
md.push("");
md.push("### Sites with the most new disambig'd labels exposed");
md.push("");
const scanWithSuffixes = scans
  .map(s => {
    const nowSuffixes = (s.now.match(/"[^"]+ \[[^\]]+\]"/g) || []).length;
    const ogSuffixes = (s.og.match(/"[^"]+ \[[^\]]+\]"/g) || []).length;
    return { ex: s, delta: nowSuffixes - ogSuffixes };
  })
  .filter(x => x.delta > 0)
  .sort((a, b) => b.delta - a.delta)
  .slice(0, 8);
md.push("| site | new disambig'd labels | scan total OG → NOW |");
md.push("|------|----------------------:|---------------------|");
for (const { ex, delta } of scanWithSuffixes) {
  const ogN = ((ex.meta.notes || []).find(n => n.startsWith("og_total=")) || "=0").split("=")[1];
  const nowN = ((ex.meta.notes || []).find(n => n.startsWith("now_total=")) || "=0").split("=")[1];
  md.push(`| ${ex.site} | +${delta} | ${ogN} → ${nowN} |`);
}
md.push("");

// pick one site for a side-by-side excerpt
const scanExemplar = scanWithSuffixes[0]?.ex;
if (scanExemplar) {
  md.push(`### Side-by-side excerpt: ${scanExemplar.site}`);
  md.push("");
  md.push("**OG scan (first 1200 chars):**");
  md.push("```");
  md.push(excerpt(scanExemplar.og, 1200));
  md.push("```");
  md.push("**NOW scan (first 1200 chars):**");
  md.push("```");
  md.push(excerpt(scanExemplar.now, 1200));
  md.push("```");
  md.push("");
}

// READ
md.push("## read — output shape and content");
md.push("");
const reads = byTool.get("read.no_query") || [];
let ogChars = 0, nowChars = 0;
for (const r of reads) { ogChars += r.og.length; nowChars += r.now.length; }
md.push(`Total chars across ${reads.length} sites — OG: **${ogChars.toLocaleString()}**, NOW: **${nowChars.toLocaleString()}** (${pctChange(ogChars, nowChars)}).`);
md.push("");
md.push("Two layered changes:");
md.push("");
md.push("1. **`aec5902` (read() refactor)** — dropped the markdown walker (`#` headings, `[text](url)` links, `**bold**`, `~~strike~~`, `- ` lists, `![alt]` images). NOW returns `roots.map(r => r.innerText).join('\\n\\n')` — visible text only, no link URLs, no heading levels, no markdown.");
md.push("2. **Multi-root walk** — still in place: `<main>` plus body-level `[role=dialog]`/`aria-modal`/shadow-host siblings. Catches portal-rendered overlays.");
md.push("3. **WIP `readFrames` in `src/index.ts`** — iframe content is merged into the read output with `--- iframe: <url> ---` section markers. OG had no iframe walk at all.");
md.push("");
md.push("Aggregate markdown-marker counts across all read outputs:");
md.push("");
let og = { md_headings: 0, md_links: 0, md_images: 0, md_lists: 0, md_bold: 0, md_strike: 0, iframe_sections: 0, newlines: 0 };
let now = { ...og };
for (const r of reads) {
  const o = structuralMarkers(r.og); const n = structuralMarkers(r.now);
  for (const k of Object.keys(og) as (keyof typeof og)[]) { og[k] += o[k]; now[k] += n[k]; }
}
md.push("| marker | OG | NOW | delta |");
md.push("|--------|---:|----:|------:|");
for (const k of Object.keys(og) as (keyof typeof og)[]) {
  md.push(`| ${k} | ${og[k]} | ${now[k]} | ${pctChange(og[k], now[k])} |`);
}
md.push("");

const ogGains = reads.filter(r => r.og.length > r.now.length).sort((a, b) => (b.og.length - b.now.length) - (a.og.length - a.now.length));
md.push("### Top 5 sites where NOW lost the most content");
md.push("");
md.push("| site | OG chars | NOW chars | delta |");
md.push("|------|---------:|----------:|------:|");
for (const r of ogGains.slice(0, 5)) {
  md.push(`| ${r.site} | ${r.og.length} | ${r.now.length} | ${r.now.length - r.og.length} |`);
}
md.push("");

const exemplar = ogGains[0];
if (exemplar) {
  md.push(`### Side-by-side excerpt: ${exemplar.site} (top loss)`);
  md.push("");
  md.push("**OG read (first 1500 chars):**");
  md.push("```");
  md.push(excerpt(exemplar.og, 1500));
  md.push("```");
  md.push("**NOW read (first 1500 chars):**");
  md.push("```");
  md.push(excerpt(exemplar.now, 1500));
  md.push("```");
  md.push("");
}

const nowGains = reads.filter(r => r.now.length > r.og.length).sort((a, b) => (b.now.length - b.og.length) - (a.now.length - a.now.length));
md.push("### Top 5 sites where NOW added content (multi-root / iframes)");
md.push("");
md.push("| site | OG chars | NOW chars | delta |");
md.push("|------|---------:|----------:|------:|");
for (const r of nowGains.slice(0, 5)) {
  md.push(`| ${r.site} | ${r.og.length} | ${r.now.length} | +${r.now.length - r.og.length} |`);
}
md.push("");

const nowExemplar = nowGains.find(r => r.now.includes("--- iframe:")) || nowGains[0];
if (nowExemplar) {
  md.push(`### Side-by-side excerpt: ${nowExemplar.site} (top gain)`);
  md.push("");
  md.push("**OG read (first 1500 chars):**");
  md.push("```");
  md.push(excerpt(nowExemplar.og, 1500));
  md.push("```");
  md.push("**NOW read (first 1500 chars):**");
  md.push("```");
  md.push(excerpt(nowExemplar.now, 1500));
  md.push("```");
  md.push("");
}

// READ.QUERY
md.push("## read with `query` argument");
md.push("");
const qreads = byTool.get("read.query") || [];
md.push(qreads.length + " sites had a query hit. Filter implementation moved from JS-side (OG: substring match inside the walker, returning matching block text) to TS-side (NOW: line-based filter with ±2 surrounding lines and a `Found N sections matching '<q>':` wrapper).");
md.push("");
const qSample = qreads.find(r => !r.meta.identical);
if (qSample) {
  md.push(`### Side-by-side excerpt: ${qSample.site} (query="${(qSample.input as { query: string }).query}")`);
  md.push("");
  md.push("**OG read.query:**");
  md.push("```");
  md.push(excerpt(qSample.og, 1500));
  md.push("```");
  md.push("**NOW read.query:**");
  md.push("```");
  md.push(excerpt(qSample.now, 1500));
  md.push("```");
  md.push("");
}

// RESOLVE
md.push("## resolve — label resolution");
md.push("");
md.push("`RESOLVE_JS` itself is byte-identical between OG and NOW. But because SCANNER_JS now rewrites duplicate-button labels with `[disambig]` suffixes, the *label space* that resolve probes is different.");
md.push("");
const sameIn = byTool.get("resolve.same_input") || [];
md.push(`### resolve.same_input (identical query string in both regimes)`);
md.push("");
md.push(`Picks labels that exist in both OG and NOW scan output (typically non-duplicated labels). Probes whether the same string still finds an element under each regime.`);
md.push("");
const ogOK = sameIn.filter(r => /og.matched=true/.test((r.meta.notes || []).join(" "))).length;
const nowOK = sameIn.filter(r => /now.matched=true/.test((r.meta.notes || []).join(" "))).length;
const nowAmbig = sameIn.filter(r => r.now.startsWith("AMBIGUOUS")).length;
md.push(`- OG matched: **${ogOK}** / ${sameIn.length}`);
md.push(`- NOW matched: **${nowOK}** / ${sameIn.length}`);
md.push(`- NOW returned AMBIGUOUS: **${nowAmbig}**`);
md.push("");
md.push("Where NOW returns AMBIGUOUS but OG matched, the model now has to pick a more specific label — but it has the disambig'd labels in the error's option list, so it CAN, where under OG it could not (same string was returned for every option).");
md.push("");

const ambSample = sameIn.find(r => /og.matched=true/.test((r.meta.notes || []).join(" ")) && r.now.startsWith("AMBIGUOUS"));
if (ambSample) {
  md.push(`#### Side-by-side: ${ambSample.site} — label "${(ambSample.input as { label: string }).label}"`);
  md.push("```");
  md.push(`OG: ${ambSample.og}`);
  md.push(``);
  md.push(`NOW: ${ambSample.now}`);
  md.push("```");
  md.push("");
}

const scanLab = byTool.get("resolve.scan_label") || [];
md.push(`### resolve.scan_label (each regime uses its OWN scan label)`);
md.push("");
md.push(`Realistic comparison: at commit 5, the model would have read \`"Reply"\` from scan and called \`press("Reply")\`. At HEAD, it reads \`"Reply [in /r/cats — by user42]"\` and calls \`press("Reply [in /r/cats — by user42]")\`.`);
md.push("");
md.push(`${scanLab.length} disambig pairs probed.`);
md.push("");
if (scanLab.length > 0) {
  const sl = scanLab[0];
  md.push(`#### Side-by-side: ${sl.site}`);
  md.push("```");
  md.push(`OG  label: "${(sl.input as { og_label: string }).og_label}"`);
  md.push(`OG  result: ${sl.og}`);
  md.push(``);
  md.push(`NOW label: "${(sl.input as { now_label: string }).now_label}"`);
  md.push(`NOW result: ${sl.now}`);
  md.push("```");
  md.push("");
}

// Tools not exercised
md.push("## Tools not exercised (unchanged between OG and NOW)");
md.push("");
md.push(`- **press** — RESOLVE_JS, GET_RECT_JS, cdpClick, and the post-action delta formatter are byte-identical. Any difference seen by the model would be in the embedded post-action scan, which is covered by the \`scan\` examples above.`);
md.push(`- **type** — same as press; readback formatting unchanged.`);
md.push(`- **select** — SELECT_JS unchanged.`);
md.push(`- **toggle**, **hover**, **scroll**, **expand** — output formatters unchanged.`);
md.push(`- **key**, **dialog**, **navigate**, **tabs**, **switch_tab**, **upload** — unchanged.`);
md.push("");

writeFileSync(REPORT_PATH, md.join("\n"));
console.log(`\nReport written to ${REPORT_PATH}`);
