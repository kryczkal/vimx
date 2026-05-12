---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: partially-shipped
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/chrome-redundancy-floods-scan-output.md, benchmarks/2026-05-12-region-detector-b0.md, benchmarks/2026-05-12-stateful-scan-dedup-v1.md]
tags: [scan, hierarchy, disambiguation, landmarks]
---

## Partially shipped 2026-05-12

What landed (via the stateful-scan-chrome-dedup ship and its post-ship (c) refinement):
- Region detection runs inline in `SCANNER_JS` ([detector B from the B0 benchmark](../benchmarks/2026-05-12-region-detector-b0.md)). Each scan entry carries `region` internally — header/nav/main/aside/footer/modal/search.
- Regions are load-bearing in two places: (1) the scanner's disambiguator promotes them to label suffixes (`"Save in nav"` vs `"Save in main"`) when duplicate labels span distinct regions; (2) the dedup formatter's "Unchanged — header: 7 · main: 18 · nav: 4 · ..." summary line groups elided ids by region.
- Region assignment pinned via `__wpRegionMap` WeakMap so identity stays stable across rescans.

See [decisions/stateful-scan-with-region-dedup.md](../decisions/stateful-scan-with-region-dedup.md) for the full architecture.

What's NOT shipped: the **hierarchical scan output** envisioned in this hypothesis (region as the top-level grouping, affordance groups nested inside each region). The flat affordance grouping is still primary; regions are surfaced only via the disambiguator + summary line. Real-session evidence showed agents ignore per-entry region tags as decoration (the (c) refinement removed them), so the hierarchical reformat is on hold pending evidence that agents actually *would* use it. Reach for it again only if a session shows region-context reasoning is the missing piece.

# Semantic-landmark grouping in scan output

**Predicted change.** Replace the flat affordance-only scan with a two-level hierarchy: outer level is the semantic region the element lives in (header / nav / main / aside / footer / modal / specific `role="region"` blocks, plus heading-derived sub-regions). Inner level keeps the current affordance grouping inside each region.

Example:
```
Main: Results (12 flights)
  Result 1: United $1240 (Nonstop)
    PRESS:
      [400] button "Select flight"
      [401] button "More details"
  Result 2: ANA $1322 (1 stop)
    ...

Modal: All filters (open)
  Stops
    TOGGLE:
      [128] toggle "Nonstop only" ○
  Price
    TYPE:
      [358] input[range] value="16500" "max price"

Aside: Navigation (sidebar)
  PRESS:
    [3] a "Home" → /
    ...
```

**Mechanism.** During scan, use ARIA landmarks (`role="main"`, `role="navigation"`, `role="search"`, `role="region"`), HTML5 sectioning (`<header>`, `<main>`, `<nav>`, `<aside>`, `<footer>`), and heading hierarchy (h1/h2/h3) as the grouping anchors. NOT DOM nesting — DOM is noisy with layout wrappers. For each scanned element, walk up to the nearest landmark/section ancestor, attribute it there. Within each region, preserve the existing affordance subgrouping.

**Predicted outcome.** Three measurable effects:
1. Disambiguation: when scan currently emits `Save to playlist (1)` and `(2)` (5a47ec04), the suffixes become semantic (`In queue rail` vs `In main player`) for free.
2. First-attempt success rate on tasks involving repeated UI patterns (search results, multi-row lists) goes up. Expected: meaningful improvement on tasks where the agent currently picks the wrong row.
3. Combines well with [stateful-scan-chrome-dedup](stateful-scan-chrome-dedup.md): the "chrome unchanged" marker becomes a clean per-region collapse (`Aside (sidebar) unchanged: 8 items`).

**How to test.**
1. Implement behind a flag.
2. Re-run the 10 webpilot-dominant cursor session tasks. Measure: (a) turn count to completion, (b) wrong-row-selected errors, (c) total tokens in scan output.
3. Smoke-test on pages without semantic landmarks (many SPAs) to confirm graceful fallback to flat grouping.

**Risks.**
- Sites with poor ARIA semantics produce a flat-with-extra-headers output — no worse than current.
- DOM landmark walking has cost; should be measured per scan.
- Some pages have nested landmarks (`<main>` inside `<main>`); the heuristic must pick one canonical parent.

**Related.** Pushback 4 in the 2026-05-12 analysis. Ranked #2 in the high-leverage hypothesis list there.
