---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session 3cd0f551-a79d-4e4e-aa95-c3584c7ab980
tags: [read, iframe, performance, 70-site]
---

# iframe-merge for read() across 70 sites

**Tested.** Merging `<iframe>` content into `read()` output by walking child frames and appending each frame's read output when ≥50 chars.

**Sites.** 70 diverse — Wikipedia, MDN, docs, news, GitHub, Amazon, YouTube.

**Metrics.**
- Total before: 353,199 chars across 69 sites
- Total after: 355,815 chars; ratio 1.007×
- Sites with any frame: 23/69 (33%)
- Sites with substantive frames (>200 chars gained): **4/69 (5.8%)** — Guardian +999, Economist +494, Vimeo +717, iframe-inception +406
- Frame-walk overhead: ~21ms avg per page

**Conclusion.** Validated. Negligible cost, marginal real-world gain.

**Notes.** Most sites either lack frames or use them for ads/tracking, not body content. The feature is safe to ship but doesn't move the needle on read() coverage. Worth re-checking if iframe-heavy task domains (e.g. doc viewers, embedded videos) become important.

**Source.** Session `3cd0f551-a79d-4e4e-aa95-c3584c7ab980`, ~line 1658.
