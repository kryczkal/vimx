---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: audit/dedup-v1-bench.mts; data in audit/data/dedup-v1/
tags: [scan, dedup, token-economy]
---

# Stateful-scan-chrome-dedup v1

Validates [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md) on the same 20-site set as the [region-detector benchmark](2026-05-12-region-detector-b0.md). Measures scan-output character count across three scenarios per site:

1. **cold scan** — no prior cache (both modes emit full output; sanity check that there's no first-scan regression)
2. **idle scan** — same URL, no mutation between scans (pure dedup win zone)
3. **post-action scan** — after pressing the first PRESS element (real-world mutation pattern)

## Result

```
Scenario       | avg full chars | avg dedup chars | reduction
----------------------------------------------------------------
scan #1 (cold) |          5503  |           5503  |   0.0%
scan #2 (idle) |          5503  |            217  |  82.9%
scan #3 (post) |          5786  |            220  |  88.7%
```

Across 20 sites with zero failures, idle scans drop 83% and post-action scans drop 89%. Aggregate token savings on the sample: ~104k chars saved out of ~108k total.

## Per-site (chars, scan #2 full → dedup)

```
en.wikipedia.org/wiki/Cat              3460 → 179   −95%
stackoverflow.com/questions            3166 → 177   −94%
github.com/anthropics/claude-code      6155 → 494   −92%
www.bbc.com/news                       1645 → 221   −87%
developer.mozilla.org                  3149 → 228   −93%
www.w3.org/                             626 → 126   −80%
music.youtube.com/                     2986 → 226   −92%
www.linkedin.com/                      3214 → 109   −97%
www.amazon.com/s?k=keyboard           35645 → 246   −99%
www.amazon.com/dp/B0CX4QTCCR           7710 → 418   −95%
www.google.com/travel/flights          1777 → 290   −84%
www.ebay.com/sch/i.html                6373 → 251   −96%
www.booking.com/searchresults         8388 → 231   −97%
www.airbnb.com/                        5089 → 193   −96%
www.reddit.com/r/programming           3332 → 173   −95%
x.com/explore                           123 → 157   +28%   ← regression (tiny page)
news.ycombinator.com/                 13915 → 146   −99%
example.com/                            130 →  94   −28%
www.nytimes.com/                       2430 → 194   −92%
www.notion.so/                          738 → 186   −75%
```

## Regression

Single regression: x.com/explore with 123 chars of full output grew to 157 chars under dedup (+34 chars absolute). The dedup header overhead (`Page:`, `URL:`, `Elements: N (...)`) exceeds the savings when the original output is already in the noise band (<200 chars). On the aggregate budget this is negligible; not worth threshold-gating for v1.

## What was implemented

1. **Region detection** (B0 detector B) added inline in `SCANNER_JS` in `src/scanner.ts`. Each scan entry now carries `region: "header" | "nav" | "main" | "aside" | "footer" | "modal" | "search"`.
2. **Server-side scan cache** in `src/index.ts`: `Map<urlPath, ScanState>` with LRU bound (20 URLs). Element signatures keyed by id; signature includes affordance, tag, label, href, value, checked, region.
3. **Dedup formatter** `formatScanResultDedup`: emits new/changed entries in full + per-region summary of unchanged elements with compact id ranges.
4. **Cache invalidation on `navigate()`**: explicit navigate resets the cache for the target URL so the agent always gets fresh full output after a navigation.
5. **Default-on** via env var `WEBPILOT_SCAN_DEDUP=1` (default) / `=0` (legacy NEW: delta).

## What was not implemented

- **Cross-page chrome dedup** (template-detected URL keying). Per-site path keying ships; template keying (e.g. `/wiki/*`, `/dp/*` collapse) deferred. Cross-page dedup would break the agent's "id N from last scan still works" guarantee — ids are scoped per-page-load. Filing as future hypothesis if data shows it'd help.
- **Force-fresh scan tool** for the lost-context edge case (agent's prior scan got compacted out). Workaround for now: `navigate(<currentUrl>)` invalidates the cache. Add a tool param if real sessions show pain.

## Source

- Script: `audit/dedup-v1-bench.mts`
- Raw results: `audit/data/dedup-v1/results.json`
- Eyeball tool: `audit/dedup-v1-eyeball.mts <url>`
- Region coverage check: `audit/quick-regression.mts`
- Implementation: `src/scanner.ts` (region detection) + `src/index.ts` (`emitScan`, `formatScanResultDedup`, `scanCache`)
