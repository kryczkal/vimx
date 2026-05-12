---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session f174aed7-6c77-485b-adee-7c2453ee3d51
tags: [scanner, hit-test, obscured-detection]
---

# Hit-test via elementFromPoint for obscured detection

**Tested.** Pre-action hit test via `elementFromPoint` in `getRect` to detect when visible elements are obscured by overlays/modals.

**Sites.** Wikipedia, Hacker News, YouTube, Amazon, Google, GitHub.

**Metrics.**
- False positive rate (visible element marked obscured): 0% (Wikipedia, HN, YouTube), 3% (Amazon — real layout overlap), 9% (Google), 15% (GitHub)
- Latency overhead per `getRect`: +0.10–0.40ms
- Shadow-DOM false positives: **0** across all sites

**Conclusion.** Validated. The high Google/GitHub FPs traced to scanner emitting empty-labeled container divs whose geometric centers landed on real buttons — a scanner issue, not a hit-test issue. The pre-action probe correctly catches real overlaps (Amazon's NBA Doubleheader).

**Notes.** The initial concern that `elementFromPoint` couldn't pierce shadow DOM did not materialize — zero shadow-DOM FPs in the benchmark set. Fixed by the follow-up [scanner empty-label filter](2026-05-11-scanner-empty-label-filter.md); combined post-fix FP rate is near zero, with remaining flagged elements being genuine layout overlaps.

**Source.** Session `f174aed7-6c77-485b-adee-7c2453ee3d51`. Code: `src/cdp.ts` `getRect`. Decision: [hit-test-obscured-detection](../decisions/hit-test-obscured-detection.md).
