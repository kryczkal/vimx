---
created: 2026-05-11
last_verified: 2026-05-11
type: decision
code_anchors: [src/cdp.ts]
tags: [scanner, obscured-detection, hit-test]
---

# Hit-test in getRect to detect obscured elements

**The choice.** Before reporting an element's rect, webpilot runs an `elementFromPoint` hit test from the element's geometric center. If the topmost element there isn't the target (or a descendant), the element is flagged as obscured. The error names the obstructing element.

**Why this over click-and-fail.** Without pre-action hit-testing, the agent calls `press(N)`, the click silently lands on an overlay, and the agent has no signal except a possibly-unrelated page change. With hit-testing, the tool returns `Element [N] is obscured by div[role='dialog'] 'Cookie consent'. Dismiss it or scroll.` — precise diagnosis at the failure point.

**Cost.** +0.10–0.40ms per `getRect`. Trivial. Measured across 6 sites in [hit-test-obscured](../benchmarks/2026-05-11-hit-test-obscured.md).

**False-positive arc.** Initial benchmark showed 9% FP on Google, 15% on GitHub — traced to scanner emitting empty-labeled container divs whose geometric centers landed on real buttons. Fixed by [scanner empty-label filter](../benchmarks/2026-05-11-scanner-empty-label-filter.md). Post-fix FP rate is near zero; remaining flagged elements are genuine layout overlaps.

**Shadow-DOM concern (resolved).** Initial worry that `elementFromPoint` wouldn't pierce shadow DOM did not materialize — zero shadow-DOM FPs in the benchmark set.

**Connection to principle.** [Abstract mechanics, not goals](../principles/abstract-mechanics-not-goals.md). Obscuration detection is a web mechanic the tool owns; the agent never has to ask "is this clickable right now?"

**Source.** Code: `src/cdp.ts` `getRect`. Benchmarks: session `f174aed7-6c77-485b-adee-7c2453ee3d51` (hit-test + scanner filter).
