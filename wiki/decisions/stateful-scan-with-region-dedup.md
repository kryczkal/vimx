---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/scanner.ts, src/index.ts]
tags: [scan, dedup, region, token-economy]
---

# Stateful scan with region dedup

**The choice.** `scan()` is stateful per URL path. The first scan on a URL emits the full element list (with a `region` tag per entry — `header`, `nav`, `main`, `aside`, `footer`, `modal`, `search`). Subsequent scans on the same URL emit only the changed / new entries in full plus a per-region summary of unchanged elements (compact id ranges). Cache resets when the agent calls `navigate()` to that URL explicitly.

**Why.** [The 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md) identified scan-output token bloat as the highest-leverage UX problem: agents re-receive the same chrome 50+ times per session, training them to skim past noise. The [B0 region-detector benchmark](../benchmarks/2026-05-12-region-detector-b0.md) and [dedup v1 benchmark](../benchmarks/2026-05-12-stateful-scan-dedup-v1.md) measured **-83% idle and -89% post-action scan output** across 20 diverse sites, zero failures.

This is `affordance-grouping-over-dom-hierarchy` and `abstract-mechanics-not-goals` applied one level up: the tool now owns "what has the agent already seen" (mechanic), not just "what's interactive on the page" (mechanic). The agent's contract widens to include continuity-of-state.

**How it works.**

1. **Region detection** (in `src/scanner.ts`, inline within `SCANNER_JS`):
   - ARIA + HTML5 sections first: `role="main"`, `<main>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, `role="search"`, `role="dialog"[aria-modal]`.
   - Position fallback when ARIA underdelivers: fixed/sticky elements classified by viewport position.
   - Always synthesizes a `main` region from viewport remainder if none has been detected — covers Amazon-shape pages (many navs, no `<main>`) and HN-shape pages (no structural markup at all).
   - Each scan entry gets `entry.region` via smallest-containing-bbox match.

2. **ID stability** (already in `src/scanner.ts`): `window.__wpIdMap` is a `WeakMap<Element, id>` that survives across scans within a page. Same DOM node → same id. Navigation resets it naturally (new JS context).

3. **Server-side cache** (in `src/index.ts`):
   - `scanCache: Map<urlPath, ScanState>` with LRU bound of 20 URLs.
   - Cache key = `URL.origin + URL.pathname` (drops query/fragment).
   - Per-entry signature: `affordance | tag | label | href | value | checked | region`.
   - `emitScan(result, beforeIds?)` is the single entry point all tool handlers call.

4. **Dedup output shape** (`formatScanResultDedup`):
   - When nothing changed: one-line summary with compact id ranges (`Elements: 38 (unchanged since last scan, ids: 0-37)`).
   - When some changed: per-affordance group lists new/changed entries in full; unchanged elements summarized as `Unchanged — header: 6 (0-5) · main: 18 (8-25) · nav: 4 (26-29)`.

5. **Cache invalidation**: explicit `navigate(<url>)` deletes the cache entry for that URL path. Agents use navigate as a "fresh state" gesture; preserving the cache there would hand them stale dedup.

**Why not other options.**

- **Cross-page chrome dedup via URL templates** (e.g. collapse `/dp/*` to one cache key). Tempting for sibling pages with shared chrome. Rejected for v1: ids are page-scoped (WeakMap dies on navigation), so cross-page dedup would claim "ids 0-67 unchanged" while those ids point at different elements. Correctness risk outweighs theoretical token savings. Filed as a future hypothesis if measurement shows the LinkedIn-messaging-shaped case is common in practice.

- **Threshold-gated dedup** (only dedup if savings > X%). Rejected: the only regression in the benchmark was on x.com's 123-char output (+34 chars), noise level. Adding a threshold introduces a conditional output shape that the agent has to learn.

- **Always emit full** (current legacy behavior). Rejected by 20-site benchmark: 83-89% token savings is too large to leave on the table.

**Source.** Shipped 2026-05-12. Default-on via `WEBPILOT_SCAN_DEDUP=1` (default); disable for A/B testing via `=0`. Benchmark scripts: `audit/region-detector-b0.mts`, `audit/dedup-v1-bench.mts`.
