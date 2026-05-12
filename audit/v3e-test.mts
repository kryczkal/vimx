// Variant E: leverage the browser's innerText (already used by NOW), but
// surgically modify the DOM before calling it so URLs appear inline.
//
// Steps:
//   1. Inject the existing chrome-strip <style> (display:none nav/footer/aside).
//   2. Walk `<a href>` elements in the document; for each, append a text-node
//      child whose content is ` [<absolute-url>]` (or just paren markdown).
//      innerText reads descendant text, so the URL surfaces inline next to
//      the anchor's visible text — no walker rewrite needed.
//   3. Call innerText on each root.
//   4. Remove the appended text nodes and the style.
//
// Risks:
//   - MutationObservers fire async, after our cleanup. Safe.
//   - Anchors with explicit `::after { content: }` could mask appended text —
//     rare; if it bites we fall back to a walker.
//   - Page CSS that uses `[href]` selectors and `::after` won't be affected by
//     a text-node append.

import CDP from "chrome-remote-interface";
import { writeFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

import { READ_JS as NOW_READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Two flavors of E to test the format:
//   E1: " [<url>]"            — agent regex `\[https?://[^\]]+\]`
//   E2: " (https://...)"       — agent regex `\((https?://[^)]+)\)`
//   E3: markdown `[text](url)`  — requires wrapping the anchor text, more invasive

// E1: append text node with " [<url>]"
const E1_READ_JS = `((query) => {
  const roots = [];
  const main = document.querySelector("main, article, [role=main]");
  if (main) {
    roots.push(main);
    for (const child of document.body.children) {
      if (child === main || main.contains(child) || child.contains(main)) continue;
      const role = (child.getAttribute("role") || "").toLowerCase();
      const isDialog = role === "dialog" || role === "alertdialog" || child.getAttribute("aria-modal") === "true";
      const hasShadow = !!child.shadowRoot;
      if (!isDialog && !hasShadow) continue;
      roots.push(child);
    }
  } else {
    roots.push(document.body);
  }

  const stripStyle = document.createElement("style");
  stripStyle.textContent = 'nav, footer, aside, [role="navigation"], [role="contentinfo"], [role="complementary"] { display: none !important; }';
  document.head.appendChild(stripStyle);

  const anchorMods = [];
  try {
    for (const root of roots) {
      for (const a of root.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
        let url;
        try { url = new URL(href, location.href).href; } catch { continue; }
        if (url.length > 200) url = url.substring(0, 200);
        const text = document.createTextNode(" [" + url + "]");
        a.appendChild(text);
        anchorMods.push(text);
      }
    }
    var md = roots.map(r => r.innerText || "").join("\\n\\n").trim();
  } finally {
    stripStyle.remove();
    for (const node of anchorMods) node.remove();
  }

  if (query) {
    const q = query.toLowerCase();
    const lines = md.split("\\n");
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 5);
        matches.push(lines.slice(start, end).join("\\n"));
      }
    }
    if (matches.length > 0) {
      md = "Found " + matches.length + " sections matching '" + query + "':\\n\\n" + matches.join("\\n---\\n");
    }
  }

  return { text: md };
})`;

// Ef: empty-anchor skip + tighter shallow-same-origin filter.
// Empty anchors (img-only, icon-only) emit bare " [url]" lines that confuse
// the model. Skip if visible text < 2 chars after trim. Shallow same-origin
// paths (≤2 segments AND ≤30 chars) are nav chrome — drop URL.
const E_FILTERED_READ_JS = E1_READ_JS.replace(
  `if (url.length > 200) url = url.substring(0, 200);
        const text = document.createTextNode(" [" + url + "]");`,
  `const anchorText = (a.innerText || "").trim();
        if (anchorText.length < 2) continue;
        const u = new URL(url);
        if (u.origin === location.origin) {
          const segs = u.pathname.split("/").filter(Boolean);
          if (segs.length <= 2 && u.pathname.length < 30) continue;
        }
        if (url.length > 200) url = url.substring(0, 200);
        const text = document.createTextNode(" [" + url + "]");`
);

const SITES = [
  "https://en.wikipedia.org/wiki/Cat",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/API/Element",
  "https://news.ycombinator.com/",
  "https://old.reddit.com/r/news",
  "https://www.reddit.com/r/programming",
  "https://dev.to/",
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://github.com/trending",
  "https://github.com/microsoft/vscode/issues",
  "https://stackoverflow.com/questions",
  "https://www.google.com/search?q=hello",
  "https://duckduckgo.com/?q=cats&ia=web",
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
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) { console.error("eval err:", exceptionDetails.text); return null; }
    return result.value as T;
  } catch (e) { console.error("eval threw:", e); return null; }
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
  return (s.match(/\[https?:\/\//g) || []).length;
}

interface Row { url: string; a: number; e: number; ef: number; ec: number; efc: number }
const rows: Row[] = [];
const samples: Record<string, { a: string; e: string; ef: string }> = {};

console.log(`${"site".padEnd(54)} ${"A.now".padStart(8)} ${"E.all".padStart(10)} ${"Ef.filt".padStart(10)}`);
console.log("-".repeat(86));

for (const url of SITES) {
  if (!await nav(url)) { console.log(`  ${url} nav fail`); continue; }
  const a = await evalJS<string>(`(${NOW_READ_JS})(null).text`) || "";
  const e = await evalJS<string>(`(${E1_READ_JS})(null).text`) || "";
  const ef = await evalJS<string>(`(${E_FILTERED_READ_JS})(null).text`) || "";
  const row = { url, a: a.length, e: e.length, ef: ef.length, ec: urlCount(e), efc: urlCount(ef) };
  rows.push(row);
  samples[url] = { a: a.slice(0, 800), e: e.slice(0, 800), ef: ef.slice(0, 800) };
  console.log(
    `  ${url.replace(/^https?:\/\//, "").slice(0, 52).padEnd(52)}` +
    `${String(row.a).padStart(8)} ${(row.e + "/" + row.ec + "u").padStart(10)} ${(row.ef + "/" + row.efc + "u").padStart(10)}`
  );
}

writeFileSync(resolvePath(__dirname, "data", "v3e-results.json"), JSON.stringify({ rows, samples }, null, 2));

let A = 0, E = 0, EF = 0, EC = 0, EFC = 0;
for (const r of rows) { A += r.a; E += r.e; EF += r.ef; EC += r.ec; EFC += r.efc; }
console.log(`\n=== Aggregate (uncapped) ===`);
console.log(`A  (innerText, current)      chars=${A}        urls=0`);
console.log(`E  (innerText + all URLs)    chars=${E}  urls=${EC}   (${(((E-A)/A)*100).toFixed(1)}% bloat over A)`);
console.log(`Ef (E, filter shallow same)  chars=${EF}  urls=${EFC}   (${(((EF-A)/A)*100).toFixed(1)}% bloat over A)`);

await client.close();
