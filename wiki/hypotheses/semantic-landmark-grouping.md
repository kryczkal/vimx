---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/chrome-redundancy-floods-scan-output.md]
tags: [scan, hierarchy, disambiguation, landmarks]
---

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
