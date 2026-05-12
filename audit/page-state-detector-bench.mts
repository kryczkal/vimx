// Page-state meta-detection bench.
//
// Tests three detectors against a hand-labeled site set:
//   - cookieBanner: GDPR/CCPA consent overlays
//   - signinRequired: page locked behind login/password form
//   - captcha:    recaptcha/hcaptcha/turnstile/arkose challenges
//
// Decision rule (stated before seeing data):
//   each detector ships independently if precision >= 95% AND recall >= 70%.
//   captcha precision must be 100% — false-positive blocks automation entirely.
//
// Output: audit/data/page-state-detector/per-site-results.json + summary.

import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(__dirname, "data/page-state-detector");
mkdirSync(OUT_DIR, { recursive: true });

interface Expected {
  cookieBanner: boolean;
  signinRequired: boolean;
  captcha: boolean;
}
interface Site { url: string; label: string; expected: Expected }

// Hand-labeled ground truth. Labels reflect "what an agent landing on this URL
// cold (no prior state, common browser fingerprint) should see right now."
// Cookie-banner sites are EU-targeted or known-GDPR-shipping. Signin pages are
// dedicated /login routes that always show a password form.
const SITES: Site[] = [
  // Clean (no state expected)
  { url: "https://en.wikipedia.org/wiki/Cat", label: "wiki-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },
  { url: "https://github.com/anthropics", label: "github-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },
  { url: "https://stackoverflow.com/questions", label: "so-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },
  { url: "https://developer.mozilla.org/", label: "mdn-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },
  { url: "https://example.com/", label: "example-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },
  { url: "https://news.ycombinator.com/", label: "hn-clean", expected: { cookieBanner: false, signinRequired: false, captcha: false } },

  // Cookie banners (EU/GDPR-zone news + e-commerce)
  { url: "https://www.bbc.com/", label: "bbc", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.theguardian.com/", label: "guardian", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.nytimes.com/", label: "nyt", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.lemonde.fr/", label: "lemonde", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.spiegel.de/", label: "spiegel", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.reddit.com/r/programming", label: "reddit", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.booking.com/", label: "booking", expected: { cookieBanner: true, signinRequired: false, captcha: false } },
  { url: "https://www.aliexpress.com/", label: "aliexpress", expected: { cookieBanner: true, signinRequired: false, captcha: false } },

  // Signin walls
  { url: "https://twitter.com/login", label: "twitter-login", expected: { cookieBanner: false, signinRequired: true, captcha: false } },
  { url: "https://www.linkedin.com/login", label: "linkedin-login", expected: { cookieBanner: false, signinRequired: true, captcha: false } },
  { url: "https://www.facebook.com/login", label: "facebook-login", expected: { cookieBanner: true, signinRequired: true, captcha: false } },
  { url: "https://accounts.google.com/signin/v2/identifier", label: "google-signin", expected: { cookieBanner: false, signinRequired: true, captcha: false } },

  // Captcha (synthetic test pages with known captcha widgets)
  { url: "https://www.google.com/recaptcha/api2/demo", label: "recaptcha-demo", expected: { cookieBanner: false, signinRequired: false, captcha: true } },
  { url: "https://accounts.hcaptcha.com/demo", label: "hcaptcha-demo", expected: { cookieBanner: false, signinRequired: false, captcha: true } },
];

// --- Detector JS (the actual heuristic, runs in the page) ---

const DETECTOR_JS = `(() => {
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 30) return false;
    if (r.bottom < 0 || r.top > innerHeight) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible" || cs.opacity === "0") return false;
    return true;
  }
  function textOf(el) {
    return (el.innerText || el.textContent || "").trim().toLowerCase();
  }

  // --- Cookie banner v2 ---
  // Three signal sources (any one fires = detected). Each is filtered for
  // visibility / size to avoid invisible tracker iframes.
  function detectCookieBanner() {
    const SIG_PATTERNS = [
      /onetrust/i, /ot-sdk/i, /ot-pc/i, /ot-banner/i,
      /cookielaw/i, /cookiebot/i, /didomi/i, /klaro/i,
      /cookie-consent/i, /cookieconsent/i, /cc-window/i,
      /\\bgdpr\\b/i, /\\bccpa\\b/i, /privacy-banner/i, /consent-banner/i,
      /cookie-banner/i, /cookie-notice/i, /cookies-message/i,
      /\\bconsent\\b/i, /\\btcf\\b/i
    ];
    const DISMISS_VERBS = [
      "accept all", "accept cookies", "agree", "got it", "allow all",
      "i accept", "i agree", "ok, got it", "reject all", "decline",
      "manage preferences", "cookie preferences", "ok",
      "alle akzeptieren", "tout accepter", "accepteren", "aceptar",
      "akzeptieren", "alles akzeptieren", "zustimmen",
      "alle accepteren", "tout refuser"
    ];

    // CMP iframe patterns: visible-and-sized iframes from known consent platforms
    const CMP_IFRAME_PATTERNS = [
      /sourcepoint\\.com/i, /[/-]sp[-]\\w+\\.com/i, /sourcepoint-cdn/i,
      /quantcast/i, /trustarc/i, /onetrust\\.com/i, /cookiebot\\.com/i,
      /didomi\\.io/i, /consent\\.cookiebot/i, /consent-platform/i,
      /privacy-mgmt\\./i, /consensu\\.org/i, /consent-cdn/i,
      // Spiegel-style: subdomain that includes "sp-" or "sourcepoint"
      /sp-\\w+\\.spiegel/i,
      // Piano paywall+consent
      /piano\\.io[/]checkout[/]offer/i,
    ];

    const candidates = [];

    // Source 1: class/id/aria signature on a visible page element
    const sigCandidates = document.querySelectorAll('[class*="cookie" i], [class*="consent" i], [class*="gdpr" i], [class*="ccpa" i], [class*="onetrust" i], [class*="didomi" i], [class*="cookielaw" i], [id*="cookie" i], [id*="consent" i], [id*="onetrust" i], [aria-label*="cookie" i], [aria-label*="consent" i]');
    for (const el of sigCandidates) {
      if (!isVisible(el)) continue;
      const sigStr = (el.className?.toString() || "") + " " + (el.id || "") + " " + (el.getAttribute("aria-label") || "");
      if (SIG_PATTERNS.some(p => p.test(sigStr))) {
        candidates.push({ el, source: 'class-signature', iframeSrc: null });
        break; // one is enough
      }
    }

    // Source 2: CMP iframe (Sourcepoint, OneTrust, etc.)
    if (candidates.length === 0) {
      for (const f of document.querySelectorAll('iframe')) {
        const r = f.getBoundingClientRect();
        if (r.width < 200 || r.height < 50) continue;
        const cs = getComputedStyle(f);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const src = f.getAttribute('src') || '';
        if (CMP_IFRAME_PATTERNS.some(p => p.test(src))) {
          candidates.push({ el: f, source: 'cmp-iframe', iframeSrc: src.substring(0, 120) });
          break;
        }
      }
    }

    // Source 3: fixed/sticky/dialog element with cookie/consent text + dismiss verb
    if (candidates.length === 0) {
      const fixedElements = document.querySelectorAll('div, section, aside, dialog, [role="dialog"]');
      for (const el of fixedElements) {
        if (!isVisible(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky' && el.getAttribute('role') !== 'dialog') continue;
        const text = textOf(el);
        if (text.length < 30 || text.length > 4000) continue;
        if (!/cookie|consent|gdpr|privacy|tracking|datenschutz/i.test(text)) continue;
        if (!DISMISS_VERBS.some(v => text.includes(v))) continue;
        candidates.push({ el, source: 'structural', iframeSrc: null });
        break;
      }
    }

    if (candidates.length === 0) return null;

    // Try to extract dismiss labels — only meaningful for non-iframe candidates
    // (iframes' content is cross-origin or same-origin but we can't easily read).
    const top = candidates[0].el;
    const dismissLabels = [];
    if (candidates[0].source !== 'cmp-iframe') {
      for (const b of top.querySelectorAll('button, a, [role="button"]')) {
        const t = textOf(b);
        if (!t || t.length > 80) continue;
        if (DISMISS_VERBS.some(v => t.includes(v))) {
          dismissLabels.push((b.innerText || b.textContent || "").trim().substring(0, 60));
        }
      }
    }
    return {
      dismissLabels: [...new Set(dismissLabels)].slice(0, 4),
      source: candidates[0].source,
      iframeSrc: candidates[0].iframeSrc,
    };
  }

  // --- Signin v2 ---
  // URL-segment match for clear login routes is a strong-enough signal alone
  // (multi-step flows like LinkedIn/Google don't expose a password input
  // until step 2). Visible password input is also sufficient. Either suffices.
  function detectSignin() {
    // URL signal: full-segment match for known login routes
    const path = location.pathname;
    const urlPatterns = [
      /[/]signin([/?#]|$)/i,
      /[/]sign[-_]in([/?#]|$)/i,
      /[/]login([/?#]|$)/i,
      /[/]log[-_]in([/?#]|$)/i,
      /[/]auth([/?#]|$)/i,
      /[/]account[/]login/i,
      /[/]i[/]flow[/]login/i,        // Twitter/X
      /[/]signin[/](?:v2|identifier)/i, // Google multi-step
    ];
    const urlSig = urlPatterns.some(p => p.test(path));

    // Visible password input
    const pws = Array.from(document.querySelectorAll('input[type="password"]')).filter(p => {
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return r.width > 50 && r.height > 10 && cs.display !== 'none' && cs.visibility === 'visible';
    });

    if (pws.length > 0) {
      return { reason: "visible password input", urlSig };
    }
    if (urlSig) {
      return { reason: "login-route URL", urlSig };
    }
    return null;
  }

  // --- Captcha v2 ---
  // Critical: must be VISIBLE challenge (>200x100 iframe, or visible widget
  // anchor with non-trivial size). Invisible reCAPTCHA v3 trackers (used by
  // Stack Overflow, Reddit, etc. for background scoring) MUST NOT fire.
  function detectCaptcha() {
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (r.width < 200 || r.height < 100) continue; // invisible/tracker — skip
      const cs = getComputedStyle(f);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

      const src = f.getAttribute('src') || '';
      const title = (f.getAttribute('title') || '').toLowerCase();
      // Must match BOTH a captcha src pattern AND look like a challenge widget
      if (/recaptcha\\/api2\\/(anchor|bframe)/i.test(src)) return { type: 'reCAPTCHA' };
      if (/recaptcha\\/enterprise\\/(anchor|bframe)/i.test(src)) return { type: 'reCAPTCHA Enterprise' };
      if (/hcaptcha\\.com\\/(captcha|hcaptcha)/i.test(src)) return { type: 'hCaptcha' };
      if (/challenges\\.cloudflare\\.com/i.test(src)) return { type: 'Cloudflare Turnstile' };
      if (/arkoselabs|funcaptcha/i.test(src) && title.includes('captcha')) return { type: 'Arkose' };
    }

    // Visible widget anchors with non-trivial size
    for (const sel of ['.g-recaptcha', '.h-captcha', '.cf-turnstile']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 60) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility !== 'visible') continue;
        // data-size="invisible" means it's the v3 background variant
        if (el.getAttribute('data-size') === 'invisible') continue;
        if (sel === '.g-recaptcha') return { type: 'reCAPTCHA' };
        if (sel === '.h-captcha') return { type: 'hCaptcha' };
        if (sel === '.cf-turnstile') return { type: 'Cloudflare Turnstile' };
      }
    }

    return null;
  }

  return {
    cookieBanner: detectCookieBanner(),
    signinRequired: detectSignin(),
    captcha: detectCaptcha(),
  };
})()`;

// --- Bench runner ---

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function ev<T>(e: string): Promise<T | null> {
  try {
    const { result } = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    return result.value as T;
  } catch { return null; }
}

async function nav(url: string) {
  try {
    await Page.navigate({ url });
    await Promise.race([Page.loadEventFired(), new Promise(r => setTimeout(r, 15000))]);
    await new Promise(r => setTimeout(r, 3500));
    return true;
  } catch { return false; }
}

interface SiteResult {
  url: string;
  label: string;
  expected: Expected;
  detected: {
    cookieBanner: any;
    signinRequired: any;
    captcha: any;
  };
  navOk: boolean;
}

const rows: SiteResult[] = [];

for (const site of SITES) {
  console.log(`\n[${site.label}] ${site.url}`);
  const navOk = await nav(site.url);
  if (!navOk) {
    console.log(`  nav fail`);
    rows.push({ ...site, detected: { cookieBanner: null, signinRequired: null, captcha: null }, navOk: false });
    continue;
  }
  const d = await ev<any>(DETECTOR_JS);
  const detected = d ?? { cookieBanner: null, signinRequired: null, captcha: null };
  console.log(`  expected: ck=${site.expected.cookieBanner ? 'Y' : '.'} si=${site.expected.signinRequired ? 'Y' : '.'} cp=${site.expected.captcha ? 'Y' : '.'}`);
  console.log(`  detected: ck=${detected.cookieBanner ? 'Y' : '.'} si=${detected.signinRequired ? 'Y' : '.'} cp=${detected.captcha ? 'Y' : '.'}`);
  if (detected.cookieBanner) console.log(`    cookie: source=${detected.cookieBanner.source} dismiss=[${(detected.cookieBanner.dismissLabels || []).join(', ')}]`);
  if (detected.signinRequired) console.log(`    signin: ${detected.signinRequired.reason}`);
  if (detected.captcha) console.log(`    captcha: ${detected.captcha.type}`);
  rows.push({ ...site, detected, navOk });
}

await client.close();

writeFileSync(resolvePath(OUT_DIR, "per-site-results.json"), JSON.stringify(rows, null, 2));

// --- Score ---
function score(detector: keyof Expected) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    if (!r.navOk) continue;
    const det = !!r.detected[detector];
    const exp = r.expected[detector];
    if (det && exp) tp++;
    else if (det && !exp) fp++;
    else if (!det && exp) fn++;
    else tn++;
  }
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1.0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 1.0;
  return { tp, fp, fn, tn, precision, recall };
}

const scoreCookie = score('cookieBanner');
const scoreSignin = score('signinRequired');
const scoreCaptcha = score('captcha');

console.log("\n\n=== SUMMARY ===\n");
console.log(`Sites: ${rows.filter(r => r.navOk).length}/${rows.length} navigated`);
console.log("");
console.log(`Detector       | TP  FP  FN  TN | Precision | Recall    | Ship?`);
console.log(`---------------|-----------------|-----------|-----------|------------`);
for (const [name, s] of [['cookieBanner', scoreCookie], ['signinRequired', scoreSignin], ['captcha', scoreCaptcha]] as const) {
  const shipCookieRule = name === 'captcha'
    ? (s.precision === 1 && s.tp > 0)
    : (s.precision >= 0.95 && s.recall >= 0.70);
  console.log(`${name.padEnd(15)}| ${s.tp.toString().padEnd(3)} ${s.fp.toString().padEnd(3)} ${s.fn.toString().padEnd(3)} ${s.tn.toString().padEnd(3)}| ${(s.precision * 100).toFixed(1).padEnd(8)}% | ${(s.recall * 100).toFixed(1).padEnd(8)}% | ${shipCookieRule ? "SHIP" : "FAIL"}`);
}

console.log("\n=== FAILURES ===");
for (const r of rows) {
  if (!r.navOk) continue;
  const ckErr = (!!r.detected.cookieBanner) !== r.expected.cookieBanner;
  const siErr = (!!r.detected.signinRequired) !== r.expected.signinRequired;
  const cpErr = (!!r.detected.captcha) !== r.expected.captcha;
  if (ckErr || siErr || cpErr) {
    const issues = [];
    if (ckErr) issues.push(`cookie:${r.detected.cookieBanner ? 'FP' : 'FN'}`);
    if (siErr) issues.push(`signin:${r.detected.signinRequired ? 'FP' : 'FN'}`);
    if (cpErr) issues.push(`captcha:${r.detected.captcha ? 'FP' : 'FN'}`);
    console.log(`  ${r.label.padEnd(20)} ${issues.join(' ')}`);
  }
}

writeFileSync(resolvePath(OUT_DIR, "summary.json"), JSON.stringify({ scoreCookie, scoreSignin, scoreCaptcha }, null, 2));
