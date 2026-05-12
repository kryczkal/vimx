// Test candidate read() implementations against 20 representative sites.
//
// Hypothesis: keeping markdown link syntax for <a> elements while dropping
// every other markdown marker (#, **, -, ![alt], ~~) preserves URLs at a
// fraction of the OG walker's bloat.
//
// Variants:
//   A — current NOW (innerText), baseline
//   B — full OG walker (markdown everywhere), upper bound
//   C — innerText shape + [text](absolute url) for <a> only
//   D — C, but skip URL for same-origin links (text-only)
//
// For each variant: char count per site, total URL count, first-800-char
// sample for spot inspection.

import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import { READ_JS as OG_READ_JS_CAPPED } from "./scanner-og.ts";
import { READ_JS as NOW_READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

// All variants need to be uncapped for an apples-to-apples bloat comparison.
// NOW is already uncapped at the READ_JS layer (cap moved to handler at e2d09c6).
// OG had MAX=12000 baked in — strip it.
const OG_READ_JS = OG_READ_JS_CAPPED.replace("const MAX = 12000;", "const MAX = 999999;");

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Variant C: innerText shape + inline markdown URLs on <a> only ────────
//
// Walk semantics target what innerText already produces: visible text with
// block-level newlines, no markdown. The ONLY exception is <a> — render as
// `[text](abs-url)`. Cross-shadow descent matches NOW. Same multi-root rule.
const VARIANT_C_READ_JS = `((query) => {
  const MAX = 999999;
  const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","SVG","PATH","META","LINK","BR","IFRAME","CANVAS","NOEMBED","EMBED","OBJECT"]);
  const BLOCK = new Set(["P","DIV","SECTION","ARTICLE","HEADER","FOOTER","MAIN","NAV","ASIDE","LI","TR","TD","TH","DT","DD","BLOCKQUOTE","FIGCAPTION","DETAILS","SUMMARY","H1","H2","H3","H4","H5","H6","UL","OL","TABLE","HR","FORM","FIELDSET"]);

  function visState(el, isRoot) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return "skip";
    if (s.opacity === "0") return "hidden";
    if (!isRoot && !el.offsetParent && el.tagName !== "BODY" && el.tagName !== "HTML") return "skip";
    return "visible";
  }

  function walk(node, out, parentHidden, isRoot) {
    if (out.length > MAX) return;
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\\s+/g, " ");
      if (!t.trim()) return;
      if (parentHidden) out.push("[hidden] " + t);
      else out.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (SKIP.has(tag)) return;
    const vis = visState(node, isRoot);
    if (vis === "skip") return;
    const isHidden = parentHidden || vis === "hidden";

    if (tag === "A") {
      const text = (node.innerText || "").trim().replace(/\\s+/g, " ");
      const rawHref = node.getAttribute("href") || "";
      if (text && rawHref && !rawHref.startsWith("javascript:") && !rawHref.startsWith("#")) {
        let url;
        try { url = new URL(rawHref, location.href).href; } catch { url = rawHref; }
        out.push("[" + text.substring(0, 100) + "](" + url.substring(0, 150) + ")");
      } else if (text) {
        out.push(text);
      }
      return;
    }

    if (BLOCK.has(tag)) out.push("\\n");
    for (const child of node.childNodes) walk(child, out, isHidden, false);
    if (node.shadowRoot) {
      for (const child of node.shadowRoot.childNodes) walk(child, out, isHidden, false);
    }
    if (BLOCK.has(tag)) out.push("\\n");
  }

  const roots = [];
  const main = document.querySelector("main, article, [role=main]");
  if (main) {
    roots.push(main);
    for (const child of document.body.children) {
      if (child === main || main.contains(child) || child.contains(main)) continue;
      if (SKIP.has(child.tagName)) continue;
      const role = (child.getAttribute("role") || "").toLowerCase();
      const isDialog = role === "dialog" || role === "alertdialog" || child.getAttribute("aria-modal") === "true";
      const hasShadow = !!child.shadowRoot;
      if (!isDialog && !hasShadow) continue;
      roots.push(child);
    }
  } else {
    roots.push(document.body);
  }

  const parts = [];
  for (const root of roots) walk(root, parts, false, true);
  let md = parts.join(" ")
    .replace(/ +/g, " ")
    .replace(/\\n +/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  return { text: md.substring(0, MAX) };
})`;

// ── Variant D: like C, but drop URL on same-origin links ───────────────
const VARIANT_D_READ_JS = VARIANT_C_READ_JS.replace(
  `out.push("[" + text.substring(0, 100) + "](" + url.substring(0, 150) + ")");`,
  `if (new URL(url).origin === location.origin) { out.push(text.substring(0, 100)); }
        else { out.push("[" + text.substring(0, 100) + "](" + url.substring(0, 150) + ")"); }`
);

const SITES = [
  // long-form (high markdown bloat in OG)
  "https://en.wikipedia.org/wiki/Cat",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/API/Element",
  "https://nodejs.org/api/fs.html",
  // feed (URLs are the entire point)
  "https://news.ycombinator.com/",
  "https://old.reddit.com/r/news",
  "https://www.reddit.com/r/programming",
  "https://dev.to/",
  // news (mixed same/cross-origin)
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://arstechnica.com/",
  // dev / search-style
  "https://github.com/trending",
  "https://github.com/microsoft/vscode/issues",
  "https://stackoverflow.com/questions",
  // search results
  "https://www.google.com/search?q=hello",
  "https://duckduckgo.com/?q=cats&ia=web",
  // commerce
  "https://www.amazon.com/s?k=keyboard",
  "https://www.ebay.com/sch/i.html?_nkw=keyboard",
  // long-tail
  "https://example.com/",
  "https://arxiv.org/",
];

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
process.setMaxListeners(100);

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
      new Promise((_, r) => setTimeout(() => r(new Error("t")), 12000)),
    ]);
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch { return false; }
}

function urlCount(s: string): number {
  return (s.match(/\]\(https?:\/\//g) || []).length + (s.match(/\]\(\//g) || []).length;
}

interface Row { url: string; a: number; b: number; c: number; d: number; ac: number; bc: number; cc: number; dc: number }
const rows: Row[] = [];
const samples: Record<string, { a: string; b: string; c: string; d: string }> = {};

console.log(`${"site".padEnd(54)} ${"A.now".padStart(7)} ${"B.og".padStart(7)} ${"C.urls".padStart(7)} ${"D.cross".padStart(7)}`);
console.log("-".repeat(96));

for (const url of SITES) {
  if (!await nav(url)) { console.log(`  ${url} nav fail`); continue; }
  const a = await evalJS<string>(`(${NOW_READ_JS})(null).text`) || "";
  const b = await evalJS<string>(`(${OG_READ_JS})(null).text`) || "";
  const c = await evalJS<string>(`(${VARIANT_C_READ_JS})(null).text`) || "";
  const d = await evalJS<string>(`(${VARIANT_D_READ_JS})(null).text`) || "";
  const row = {
    url, a: a.length, b: b.length, c: c.length, d: d.length,
    ac: urlCount(a), bc: urlCount(b), cc: urlCount(c), dc: urlCount(d),
  };
  rows.push(row);
  samples[url] = { a: a.slice(0, 1000), b: b.slice(0, 1000), c: c.slice(0, 1000), d: d.slice(0, 1000) };
  console.log(
    `  ${url.replace(/^https?:\/\//, "").slice(0, 52).padEnd(52)}` +
    `${String(row.a).padStart(7)} ${String(row.b).padStart(7)} ` +
    `${(row.c + "/" + row.cc + "u").padStart(11)} ${(row.d + "/" + row.dc + "u").padStart(11)}`
  );
}

writeFileSync(resolvePath(__dirname, "data", "v3-results.json"), JSON.stringify({ rows, samples }, null, 2));

console.log("\n=== Aggregate ===");
let A = 0, B = 0, C = 0, D = 0, AURL = 0, BURL = 0, CURL = 0, DURL = 0;
for (const r of rows) { A += r.a; B += r.b; C += r.c; D += r.d; AURL += r.ac; BURL += r.bc; CURL += r.cc; DURL += r.dc; }
console.log(`A (innerText, now)         chars=${A}  urls=${AURL}`);
console.log(`B (OG markdown walker)     chars=${B}  urls=${BURL}`);
console.log(`C (innerText + [t](url))   chars=${C}  urls=${CURL}`);
console.log(`D (C, cross-origin only)   chars=${D}  urls=${DURL}`);
console.log(`\nRelative to A:`);
console.log(`  B: ${((B/A - 1)*100).toFixed(1)}%, brings ${BURL-AURL} URLs`);
console.log(`  C: ${((C/A - 1)*100).toFixed(1)}%, brings ${CURL-AURL} URLs`);
console.log(`  D: ${((D/A - 1)*100).toFixed(1)}%, brings ${DURL-AURL} URLs`);

await client.close();
