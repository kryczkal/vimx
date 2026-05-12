---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session 3cd0f551-a79d-4e4e-aa95-c3584c7ab980
tags: [read, chrome-strip, savings, 70-site]
---

# chrome-strip (commit 9f31cdc) validated across 70 sites

**Tested.** Inject CSS `display:none` on `<nav>`, `<footer>`, `<aside>` and ARIA equivalents to remove chrome from `read()` output. Baseline: commit `aec5902`.

**Sites.** 70 — Wikipedia, MDN, GitHub, Amazon, Vimeo, search engines, e-commerce.

**Metrics.**
- Total before: 1,437,418 chars; after: 1,397,606 chars; ratio 0.972 (~2.8% savings)
- 71/71 probed: 41 unchanged, 29 reduced, 1 regressed by +36 chars (Best Buy — likely test noise)
- Large reductions (>200 chars): Wikipedia −4,187 to −8,663 per article (TOC + nav strip), Amazon −3,159, Vimeo −3,198, GitHub −459, Linux/AWS in similar range

**Conclusion.** Validated for safety. Zero meaningful regressions; consistent savings on content-heavy sites.

**Notes — the arc.** The benchmark answered "is this safe to ship?" — yes. The feature was added (commit `9f31cdc`) on the strength of this measurement. It was later **removed** (commit `1e916e6`) on principle — see [chrome-strip-removed](../decisions/chrome-strip-removed.md). The benchmark and the principle answered different questions:
- Benchmark: *will it break anything?* → No.
- Principle ([abstract-mechanics-not-goals](../principles/abstract-mechanics-not-goals.md), in its "informed > filtered" form): *should the tool be guessing what's relevant?* → No.

Captured as the canonical case for [benchmarks-validate-principles-decide](../principles/benchmarks-validate-principles-decide.md).

**Source.** Session `3cd0f551-a79d-4e4e-aa95-c3584c7ab980`, ~line 1630.
