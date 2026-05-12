---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: audit/region-detector-b0.mts; data in audit/data/region-detector-b0/
tags: [region-detection, scan, dedup, prerequisite]
---

# B0 — Region-detector comparison

Foundation benchmark for stateful-scan-chrome-dedup: pick the detection strategy that classifies interactive elements into semantic regions (header / nav / main / aside / footer / modal / list-item). The dedup machinery groups its "unchanged" summary by region, so detector quality is upstream of dedup ROI.

## Detectors compared

| Detector | Strategy |
|---|---|
| A | ARIA + HTML5 sections only (role + tag) |
| B | A, then position fallback (fixed/sticky elements) when ARIA yields <2 regions |
| C | Full pipeline: ARIA → HTML5 → heading subgroups → repeated patterns → position |

## Sample

20 sites: 6 ARIA-rich (Wikipedia, GitHub, Stack Overflow, BBC, MDN, W3) · 10 ARIA-poor SPAs (YouTube Music, LinkedIn, Amazon search/product, Google Flights, eBay, Booking, Airbnb, Reddit, X) · 4 edge (Hacker News, example.com, NYT, Notion).

## Result

```
group          | A coverage / hasMain | B coverage / hasMain | C coverage / hasMain
----------------------------------------------------------------------------------
aria-rich      | 96.0% (5/6)          | 96.0% (5/6)          | 96.0% (5/6)
aria-poor      | 72.8% (8/10)         | 72.8% (8/10)         | 67.7% (8/10)
edge           | 48.8% (2/4)          | 98.8% (4/4)          | 48.8% (2/4)

OVERALL        | A                    | B                    | C
avg coverage   | 75.0%                | 85.0%                | 72.4%
avg regions    | 2.5                  | 6.3                  | 5.5
zero-region    | 2 sites              | 0 sites              | 2 sites
```

B wins on the metric that matters most: **zero failures.** Hacker News and example.com produce no regions under A or C (no ARIA, no HTML5 sections); B's position fallback synthesizes `main` for them. C's heading-based sub-regions help on some sites (Wikipedia 6→8 regions) but degrades coverage on Booking.com (84% → 21%) when heading bboxes carve up main into tight slices that drop interactive elements at boundaries.

A regression in the inline implementation initially fired position-fallback only when ARIA produced fewer than 2 regions, missing Amazon (which has many ARIA navs but no `<main>`). Fix: synthesize `main` from viewport remainder whenever no main has been detected yet, regardless of total region count. Post-fix coverage:

| Site | Region coverage |
|---|---|
| en.wikipedia.org/wiki/Cat | 56/56 — {header, nav, main} |
| github.com/anthropics | 55/55 — {header, main} |
| news.ycombinator.com | 199/199 — {main} |
| amazon.com/s?k=keyboard | 81/82 — {header, main} |
| stackoverflow.com | 42/42 — {header, nav, main, aside} |

## Decision

Detector **B** ships in `src/scanner.ts` as inline JS within `SCANNER_JS`. Adds `entry.region` to every scan output element. ~80 LOC.

Heading-based sub-regions and repeated-pattern detection (detector C extras) are not shipped — coverage regression on Booking + minimal gain on most sites — but the implementation lives in `audit/region-detector-b0.mts` for future revisit.

## Source

- Script: `audit/region-detector-b0.mts`
- Raw results: `audit/data/region-detector-b0/results.json`, `audit/data/region-detector-b0/summary.json`
- Decision implemented in: `src/scanner.ts` (search for "Region detection (B0-validated detector B)")
