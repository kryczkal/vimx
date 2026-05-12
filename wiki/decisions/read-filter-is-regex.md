---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts]
tags: [read, api]
---

# read() filter is a regex, not a substring query

**The choice.** `read({regex})` takes a regex pattern. Case-insensitive, applied per-line. Matches return a ±2 line window before / +5 lines after each match.

**Why this over substring query.** Substring matching forces the agent to predict exact wording on the page. Regex lets the agent express disjunctions (`/required|wymag|obow/i` for multilingual pages — see session 19e1a97a where Polish UI required exactly this), alternations, and word-boundary anchors — all of which show up in real sessions. The cost is a small jump in syntactic complexity; the benefit is much higher hit rate per call.

**Behavior detail.** 0 matches returns an explicit error, not a silent full-page dump. This prevents the agent from interpreting "I got the page back" as confirmation that the query matched — a failure mode observed in earlier substring-mode sessions where agents proceeded on negative-result data.

**Page cap.** 200k character cap on the underlying text with a truncation marker when exceeded.

**Source.** Commit `8f20053` ("feat: read() filter is regex, not substring query"). Related: `e2d09c6` (200k cap with truncation marker), `1260fb1` ([read-surfaces-link-urls](read-surfaces-link-urls.md)), `1e916e6` ([chrome-strip-removed](chrome-strip-removed.md)).

**Known follow-up.** Per [the 2026-05-12 analysis](../sessions/2026-05-12-cursor-export-17-sessions.md), agents misuse `read({regex})` by interpreting 0 matches as "page is empty/broken" rather than "regex too narrow". The current error message could be improved to suggest broadening — open improvement, not yet a hypothesis page.
