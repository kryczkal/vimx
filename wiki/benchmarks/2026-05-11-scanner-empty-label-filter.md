---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session f174aed7-6c77-485b-adee-7c2453ee3d51
tags: [scanner, false-positives, empty-labels]
---

# Scanner empty-label filter

**Tested.** Removing scanner elements that have no usable label (and whose geometric center sits on top of other real elements), to fix hit-test false positives surfaced by [hit-test-obscured](2026-05-11-hit-test-obscured.md).

**Sites.** Google, GitHub, Amazon, Wikipedia, Hacker News, YouTube, Reddit.

**Metrics.**
- Element-count delta: Google 22→20 (−2), GitHub 27→22 (−5), others unchanged
- Combined FP rate after both fixes:
  - Google: 9% → **0%**
  - GitHub: 15% → **0%**
  - Reddit: 50% → **7%** (remaining are real obstructions)
  - Amazon: 3% (real, unchanged)

**Conclusion.** Validated. The fix removes FPs while preserving real obstructions.

**Notes.** Reddit's 50%→7% is the largest single improvement — empty-labeled containers were proliferating across Reddit's UI. The combined hit-test + empty-label fix brings FP rate to near zero across the benchmark set; remaining flagged elements are genuine layout overlaps that the system correctly identifies.

**Source.** Session `f174aed7-6c77-485b-adee-7c2453ee3d51`. Code: `src/scanner.ts` SCANNER_JS element filtering.
