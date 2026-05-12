---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [scan, cache, lifecycle, multi-tab]
---

# Tab switch should reset the per-URL scan cache

**Predicted change.** When the agent calls `switch_tab`, the server-side scan-emit cache for the previously-active tab is preserved (it's keyed by URL path, not by tab), but the *active-tab* scan cache resets to fresh. On switching back, the agent gets a full re-emit on first scan, not a diff against the pre-switch state.

**Why this is its own hypothesis, not part of v1.** The baseline design (see [stateful-scan-chrome-dedup](stateful-scan-chrome-dedup.md)) does NOT reset on tab switch — agents often switch and return, and discarding the cache feels wasteful. But the "super safe" alternative is: any time the active tab changes, treat the new active tab as cold. This avoids a subtle failure mode where the agent switches to a tab whose DOM mutated while it was backgrounded (lazy-load, polling, server-pushed updates), and the dedup tells a small lie.

**Mechanism.** Hook the `select_page` / tab-switch transition. On activation of a tab, reset its per-URL emit cache (or treat the next scan as a forced full emit even if the URL hash hasn't changed).

**Predicted outcome (to measure).**
- Token cost increase: depends on tab-switch frequency in sessions. From the 17 source sessions, tab switches occurred only in session 19e1a97a near the end (~5 switches). Likely a small absolute increase in scan-output tokens.
- Safety win: zero silent-drift incidents from background-mutated tabs. Hard to measure unless we have known cases.

**How to test.**
1. Implement after stateful-scan-chrome-dedup ships.
2. Construct a synthetic test: open two tabs, mutate the inactive one via background script, switch back, scan. Verify the user-visible scan output accurately reflects the mutation.
3. Re-run the source sessions; measure net token impact.

**Risk.** A no-op in the common single-tab case. In multi-tab cases, the safety guarantee is the win — but if benchmark shows no real mutation issues, this hypothesis closes as `refuted` (the conservative choice wasn't needed).

**Source.** Q5-C in the 2026-05-12 brainstorm for [stateful-scan-chrome-dedup](stateful-scan-chrome-dedup.md). User flagged: "c sounds super safe."
