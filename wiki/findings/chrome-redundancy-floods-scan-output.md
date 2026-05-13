---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, sessions/2026-05-12-token-cost-measurement.md]
tags: [scan, token-economy, perception]
---

# Chrome redundancy floods scan output

**Claim.** vimx's `scan` is stateless. Each call re-states the full set of interactive elements including chrome (sidebar, nav, footer) the agent has already internalized. Over a long session, this accumulates into a large fraction of the token budget without adding information. Measurement: **7% of total session bytes lower-bound across 10 vimx-dominant sessions; 17% in the worst case** (YT Music, session 5a47ec04). True waste is higher because the lower bound counts only literal element-line duplicates, not the repeated group headers and "Page:N / Elements:N" scaffolding that re-emit on every scan-bearing tool return.

**Evidence (measured 2026-05-12).** Full numbers in [sessions/2026-05-12-token-cost-measurement.md](../sessions/2026-05-12-token-cost-measurement.md).

- Session 5a47ec04 (YouTube Music, 173 msgs): **86,641 repeat bytes (17.1% of file)**. The sidebar `tp-yt-paper-item` lines for items [19] and [21] each appear **70 times** verbatim across the session. Eight separate `ytmusic-play-button-renderer` rows appear 30-45× each.
- Session d1f51c1a (Google Forms, 137 msgs): **35,337 repeat bytes (13.6%)**. Form-field input/div lines repeat 26-45×.
- Session 19e1a97a (Google Flights, 134 msgs): **23,276 repeat bytes (9.3%)**. Flight search input fields repeat 30× each across filter iterations.
- Aggregate across all 10 vimx-dominant sessions: **162,924 repeat bytes / 2,323,369 total = 7.0% baseline waste**.
- Session 25cd64ca (Amazon search): individual scan returns also include long redirect URLs (~2KB each); `cleanHref` partially mitigates but doesn't eliminate.
- The agent doesn't ignore this. Token pressure visibly distorts strategy — skipping verification, reusing stale refs, over-narrow regex on `read()`. See [agents-have-no-state-prediction](agents-have-no-state-prediction.md) and Flaw 11 in the source analysis.

**Calibration note.** All measurements are over **pre-viewport-bound-scan sessions**. The viewport-bound decision ([decisions/viewport-bound-scan.md](../decisions/viewport-bound-scan.md)) shipped 2026-05-12 with a ~7× per-session cost reduction measured on a separate 99-site benchmark. Current-code chrome waste is smaller. The numbers above represent the worst-case ceiling we have receipts for.

**Implication.** The compression target is the **format of scan-formatted output**, regardless of which tool emitted it — see the companion finding [perception-share-of-session-tokens](perception-share-of-session-tokens.md), which shows that auto-rescans inside `press`/`navigate`/`scroll` returns emit more scan-formatted output than explicit `scan` calls do.

Hypothesis: [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md). The hypothesis's scope must include all scan-emitting tools, not just standalone `scan()`. Predicted savings: 7% of total session bytes from literal-line dedup, plausibly 15-25% with full chrome+header collapse.
