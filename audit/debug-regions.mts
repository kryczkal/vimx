import CDP from "chrome-remote-interface";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);
const c = await CDP({ port: CDP_PORT });
const { Page, Runtime } = c;
await Promise.all([Page.enable(), Runtime.enable()]);

const url = process.argv[2] || "https://www.amazon.com/s?k=keyboard";
await Page.navigate({ url });
await new Promise(r => setTimeout(r, 3000));

const probe = `(() => {
  const rules = [
    ['[role="dialog"][aria-modal="true"], dialog[open]', 'modal'],
    ['[role="banner"], header', 'header'],
    ['[role="navigation"], nav', 'nav'],
    ['[role="search"]', 'search'],
    ['[role="main"], main', 'main'],
    ['[role="complementary"], aside', 'aside'],
    ['[role="contentinfo"], footer', 'footer'],
  ];
  const out = [];
  for (const [sel, kind] of rules) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      out.push({
        kind, sel,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        ariaLabel: (el.getAttribute('aria-label') || '').substring(0, 50),
        bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        visible: r.width > 50 && r.height > 30
      });
    }
  }
  return out;
})()`;

const { result } = await Runtime.evaluate({ expression: probe, returnByValue: true });
console.log(`URL: ${url}`);
console.log(`innerWidth: ${(await Runtime.evaluate({ expression: 'innerWidth', returnByValue: true })).result.value}`);
console.log(`innerHeight: ${(await Runtime.evaluate({ expression: 'innerHeight', returnByValue: true })).result.value}`);
console.log(`Found ${result.value.length} ARIA/HTML5 region candidates:\n`);
for (const r of result.value) {
  console.log(`  ${r.kind.padEnd(8)} ${r.tag.padEnd(8)} role=${r.role||"-"} bbox=${r.bbox.x},${r.bbox.y} ${r.bbox.w}x${r.bbox.h}  visible=${r.visible} aria="${r.ariaLabel}"`);
}
await c.close();
