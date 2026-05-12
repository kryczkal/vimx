// Probe failing sites to understand what's actually on them.
import CDP from "chrome-remote-interface";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const TARGETS = [
  // Captcha FPs
  { url: "https://stackoverflow.com/questions", probe: "captcha-fp" },
  { url: "https://www.bbc.com/", probe: "captcha-fp,cookie-fn" },
  { url: "https://www.reddit.com/r/programming", probe: "captcha-fp" },
  { url: "https://www.booking.com/", probe: "captcha-fp,cookie-fn" },
  // Cookie FNs
  { url: "https://www.theguardian.com/", probe: "cookie-fn" },
  { url: "https://www.nytimes.com/", probe: "cookie-fn" },
  { url: "https://www.spiegel.de/", probe: "cookie-fn" },
  { url: "https://www.aliexpress.com/", probe: "cookie-fn" },
  // Signin FNs
  { url: "https://www.linkedin.com/login", probe: "signin-fn" },
  { url: "https://accounts.google.com/signin/v2/identifier", probe: "signin-fn" },
];

const PROBE = `(() => {
  const out = { iframes: [], cookieCandidates: [], passwordInputs: [], visibleCaptchaAnchors: [] };

  // What iframes are present, what's their visibility/size/src?
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    const src = f.getAttribute('src') || '';
    out.iframes.push({
      src: src.substring(0, 120),
      w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 10 && r.height > 10 && cs.visibility !== 'hidden' && cs.display !== 'none',
      title: f.getAttribute('title') || '',
    });
  }

  // What elements look like cookie containers?
  const possibles = document.querySelectorAll('[class], [id], [aria-label]');
  for (const el of possibles) {
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 30) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility !== 'visible') continue;
    const sig = (el.className?.toString() || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '');
    if (/cookie|consent|gdpr|ccpa|privacy/i.test(sig)) {
      const text = (el.innerText || '').substring(0, 100).replace(/\\s+/g, ' ');
      out.cookieCandidates.push({
        tag: el.tagName.toLowerCase(),
        sig: sig.substring(0, 100),
        text,
        pos: cs.position,
        role: el.getAttribute('role'),
      });
      if (out.cookieCandidates.length > 6) break;
    }
  }

  // Password inputs
  for (const p of document.querySelectorAll('input[type="password"]')) {
    const r = p.getBoundingClientRect();
    out.passwordInputs.push({
      visible: r.width > 10 && r.height > 10,
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.left), y: Math.round(r.top),
      name: p.getAttribute('name') || '',
      autocomplete: p.getAttribute('autocomplete') || '',
    });
  }

  // Visible captcha anchors
  for (const sel of ['.g-recaptcha', '.h-captcha', '.cf-turnstile', '[data-sitekey]']) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      out.visibleCaptchaAnchors.push({
        selector: sel,
        visible: r.width > 10 && r.height > 10,
        w: Math.round(r.width), h: Math.round(r.height),
        sitekey: el.getAttribute('data-sitekey') || '',
      });
    }
  }

  return out;
})()`;

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function ev<T>(e: string): Promise<T | null> {
  try {
    const { result } = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    return result.value as T;
  } catch { return null; }
}

for (const t of TARGETS) {
  console.log(`\n=== ${t.probe} :: ${t.url} ===`);
  await Page.navigate({ url: t.url });
  await Promise.race([Page.loadEventFired(), new Promise(r => setTimeout(r, 12000))]);
  await new Promise(r => setTimeout(r, 3500));
  const out = await ev<any>(PROBE);
  if (!out) { console.log("  probe failed"); continue; }
  console.log(`  iframes (${out.iframes.length}):`);
  for (const f of out.iframes.slice(0, 5)) {
    console.log(`    ${f.w}x${f.h} visible=${f.visible} src="${f.src}" title="${f.title}"`);
  }
  console.log(`  cookieCandidates (${out.cookieCandidates.length}):`);
  for (const c of out.cookieCandidates.slice(0, 4)) {
    console.log(`    ${c.tag}[${c.role || '-'}] sig="${c.sig}" pos=${c.pos} text="${c.text.substring(0, 80)}"`);
  }
  console.log(`  passwordInputs (${out.passwordInputs.length}):`);
  for (const p of out.passwordInputs.slice(0, 2)) {
    console.log(`    ${p.w}x${p.h} @ (${p.x},${p.y}) visible=${p.visible} name="${p.name}" autocomplete="${p.autocomplete}"`);
  }
  console.log(`  captchaAnchors (${out.visibleCaptchaAnchors.length}):`);
  for (const a of out.visibleCaptchaAnchors.slice(0, 2)) {
    console.log(`    ${a.selector} ${a.w}x${a.h} visible=${a.visible} sitekey="${a.sitekey.substring(0,30)}"`);
  }
}

await client.close();
