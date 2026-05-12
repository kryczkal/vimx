---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session 3cd0f551-a79d-4e4e-aa95-c3584c7ab980
tags: [read, variability, content-types]
---

# read() output variability under layout change

**Tested.** Per-site char output and variability after a layout-related change to scanner/read.

**Sites.** 70.

**Metrics.** Pre/post ratios with wide variance:
- Hacker News +2.47× (4,132 → 10,198)
- BBC −0.27× (7,495 → 2,053)
- TechCrunch +1.80× (10,174 → 18,277)
- Nature +38.63×
- Guardian 0.09× ratio (−0.91× decline)
- Amazon −0.44×, eBay −0.88×

**Conclusion.** Mixed / diagnostic. High content-type sensitivity. News sites span 0.27×–2.57×; dev/docs sites more stable; e-commerce often collapses.

**Notes.** A benchmark whose conclusion is "high variance" is informative on its own — it surfaces that a change isn't uniformly applied. Worth identifying which content types are amplified and which collapse, so future read()-affecting changes have a known-fragile reference set to test against.

**Source.** Session `3cd0f551-a79d-4e4e-aa95-c3584c7ab980`, ~line 1710.
