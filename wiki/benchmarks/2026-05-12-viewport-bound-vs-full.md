---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: claude-code session 6b7a1271-2f98-4965-bac3-7cafe3273eb8
tags: [scanner, viewport, scan, token-economy, 99-site]
---

# Viewport-bound scan vs full-page scan — 99 sites

**Tested.** Cost of keeping `scan()` viewport-bound (current) vs removing the viewport filter to surface off-viewport elements.

**Sites.** 99 — Amazon search, Wikipedia (Cat, Python, Carl_Linnaeus, JavaScript), eBay, MDN, Node.js API docs, Hacker News, Reddit, StackOverflow.

**Metrics.**
- Elements per scan: Wikipedia/Cat 56 → **2,857** (unbounded); Amazon search +41,911 chars; nodejs/fs +17,857 chars
- Avg tokens per unbounded scan: +4,878 (~19,510 chars)
- Worst-case blowout per scan: Wikipedia/Cat +35,535 tokens; Amazon search +41,911 tokens
- Session-level (5 actions): unbounded scan **150–300k tokens**; URLs-in-read **+25k one-time**
- Off-viewport `<a>` tags: **52%** of all anchors

**Conclusion.** Decisional. Both work technically. Viewport-bound wins by **~7×** on per-session token cost. Off-viewport navigation is solved cheaper via [URL annotation in read()](2026-05-12-url-annotation-read.md).

**Notes.** Without the viewport filter, scan degrades to a 2,857-item action menu on a single Wikipedia article — unusable as a "what can I do right now" surface. The 52% off-viewport figure shows the *information* matters, but routing it through `read()` URL annotation costs 1/7th as much per session. This benchmark crystallized the architectural decision: `scan()` is "current actions"; `read()` is "page content". They are different surfaces with different cost/structure tradeoffs.

**Source.** Session `6b7a1271-2f98-4965-bac3-7cafe3273eb8`. Code: `src/scanner.ts` SCANNER_JS `cropRectToVisible`. Decision: [viewport-bound-scan](../decisions/viewport-bound-scan.md).
