---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session 3cd0f551-a79d-4e4e-aa95-c3584c7ab980
tags: [read, regression, diagnostic]
---

# Diagnostic: read() returning 0 chars across all sites

**Tested.** Diagnostic scan after a read() implementation change. Compared "og" (original) vs "now" (new).

**Sites.** 70.

**Metrics.**
- og: 1,391,941 total chars across 69 sites
- now: **0 chars** — every site returned empty
- 67/69 sites showing >20% reduction; 0 showing increase

**Conclusion.** Regressed — critical. read() broken; likely a READ_JS evaluation misconfiguration. Caught within the same session as the iframe-merge work, before shipping.

**Notes.** This is exactly what `/benchmark` exists to catch. The prior iframe-merge benchmark looked clean; a follow-up change introduced a silent total regression that would have been invisible without measurement. Worth keeping the diagnostic on hand as a sanity check after read()-adjacent changes.

**Source.** Session `3cd0f551-a79d-4e4e-aa95-c3584c7ab980`, ~line 1690.
