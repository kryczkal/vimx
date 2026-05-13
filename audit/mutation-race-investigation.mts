// (e) Stale-snapshot-during-mutation race investigation.
//
// Hypothesis from cursor-session-8bbfd98a lines 426-485:
//   agent presses element -> action triggers async DOM mutation -> auto-rescan
//   reports "unchanged" -> agent's defensive rescan THEN sees the mutation.
//   The dedup compare runs faster than the page's mutation render.
//
// Method:
//   1. Inject a MutationObserver in the page that counts DOM mutations.
//   2. Read the count immediately after a press auto-rescan returns.
//   3. Wait 500ms more; read count again.
//   4. If post-press mutationCount kept growing after scan finished →
//      scan ran before the mutation settled.

import CDP from "chrome-remote-interface";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

interface ScanEntry { id: number; tag: string; label: string; region?: string }
interface ScanResult { url: string; title: string; groups: Record<string, ScanEntry[]>; total: number }

const SITES_AND_TRIGGERS = [
  { url: "https://music.youtube.com/", label: "Initiate search", expect: "search expansion" },
  { url: "https://www.amazon.com/", label: "Hello, Sign in Account & Lists Returns & Orders", expect: "menu dropdown" },
  { url: "https://www.reddit.com/r/programming", label: "Sort by", expect: "dropdown" },
];

const INJECT_OBSERVER = `(() => {
  if (window.__wpMutWatch) return "already";
  window.__wpMutationCount = 0;
  window.__wpLastMutationAt = 0;
  const obs = new MutationObserver((muts) => {
    window.__wpMutationCount += muts.length;
    window.__wpLastMutationAt = performance.now();
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  window.__wpMutWatch = obs;
  return "ok";
})()`;

const READ_MUT = `(() => ({
  count: window.__wpMutationCount || 0,
  lastAt: window.__wpLastMutationAt || 0,
  now: performance.now(),
}))()`;

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime, Input } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function ev<T>(e: string): Promise<T | null> {
  try {
    const { result } = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    return result.value as T;
  } catch { return null; }
}

async function nav(url: string) {
  await Page.navigate({ url });
  await Promise.race([Page.loadEventFired(), new Promise(r => setTimeout(r, 12000))]);
  await new Promise(r => setTimeout(r, 2500));
}

async function findElementByLabel(label: string): Promise<{ id: number; x: number; y: number } | null> {
  return ev(`(() => {
    const labels = window.__vimxLabels || {};
    const q = ${JSON.stringify(label)}.toLowerCase();
    for (const id of Object.keys(labels)) {
      if (labels[id].toLowerCase().includes(q)) {
        const r = window.__vimxRects?.[id];
        if (r) return { id: parseInt(id), x: r.x, y: r.y };
      }
    }
    return null;
  })()`);
}

console.log("Investigating stale-snapshot-during-mutation race on", SITES_AND_TRIGGERS.length, "sites");
console.log("-".repeat(90));

const { SCANNER_JS } = await import("../src/scanner.ts");

for (const site of SITES_AND_TRIGGERS) {
  console.log(`\n[${site.url}] target: "${site.label}" (${site.expect})`);

  await nav(site.url);
  await ev(`(() => { delete window.__wpIdMap; delete window.__wpNextId; delete window.__vimx; delete window.__vimxRects; delete window.__vimxLabels; delete window.__vimxAffordances; delete window.__vimxRegions; delete window.__wpRegionMap; delete window.__wpMutWatch; })()`);

  // Initial scan to populate ids
  await ev<ScanResult>(SCANNER_JS);

  // Install mutation observer AFTER initial scan
  const inj = await ev<string>(INJECT_OBSERVER);
  console.log(`  observer: ${inj}`);

  // Find target
  const target = await findElementByLabel(site.label);
  if (!target) { console.log(`  target not found, skipping`); continue; }

  // Read mutation count BEFORE press
  const before = await ev<{ count: number; lastAt: number; now: number }>(READ_MUT);
  const t0 = performance.now();

  // Press the target via CDP
  await Input.dispatchMouseEvent({ type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await Input.dispatchMouseEvent({ type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });

  // Wait 250ms to simulate auto-rescan delay (rough proxy for waitForSettle)
  await new Promise(r => setTimeout(r, 250));

  // Scan now (simulates auto-rescan)
  const scanStart = performance.now();
  const postScan = await ev<ScanResult>(SCANNER_JS);
  const scanEnd = performance.now();

  // Read mutation count immediately after scan
  const afterScan = await ev<{ count: number; lastAt: number; now: number }>(READ_MUT);

  // Wait 500ms more
  await new Promise(r => setTimeout(r, 500));

  const after500 = await ev<{ count: number; lastAt: number; now: number }>(READ_MUT);

  if (!before || !afterScan || !after500 || !postScan) { console.log(`  read failed`); continue; }

  console.log(`  mutations: before-press=${before.count}  after-scan(~${Math.round(scanEnd - t0)}ms)=${afterScan.count}  after-500ms=${after500.count}`);
  console.log(`  scan finished at +${Math.round(scanEnd - t0)}ms, last mutation at +${Math.round(after500.lastAt - t0)}ms`);

  const mutationsDuringScan = afterScan.count - before.count;
  const mutationsAfterScan = after500.count - afterScan.count;

  if (mutationsAfterScan > 0 && mutationsAfterScan > mutationsDuringScan * 0.3) {
    console.log(`  >>> RACE LIKELY: ${mutationsAfterScan} mutations landed after scan finished`);
  } else if (mutationsDuringScan === 0 && mutationsAfterScan === 0) {
    console.log(`  >>> no detectable effect from press (target may be a no-op)`);
  } else {
    console.log(`  >>> race not detected on this site`);
  }
  console.log(`  scan saw ${postScan.total} elements`);
}

await client.close();
