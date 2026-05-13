---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: confirmed
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, sessions/2026-05-12-token-cost-measurement.md, findings/chrome-redundancy-floods-scan-output.md, findings/perception-share-of-session-tokens.md, benchmarks/2026-05-12-region-detector-b0.md, benchmarks/2026-05-12-stateful-scan-dedup-v1.md]
tags: [scan, token-economy]
---

## Confirmed 2026-05-12

Shipped. Default-on (`VIMX_SCAN_DEDUP=0` to disable). Measured outcome on 20 sites ([benchmark](../benchmarks/2026-05-12-stateful-scan-dedup-v1.md)):
- **idle re-scan: −82.9%** avg token reduction
- **post-action re-scan: −88.7%** avg token reduction
- aggregate: ~104k of ~108k chars saved on the sample
- zero site failures; only regression on x.com/explore (+34 chars absolute on a 123-char output — noise)

These numbers exceed the predicted 15-25% session-wide win because the dedup applies to *every* scan-emitting tool (press / navigate / scroll / toggle / hover / dialog / switch_tab), and the worst chrome-bloated sites (Amazon, eBay, Hacker News) saved 95-99% per call. Q-design questions answered: cache-key = URL path; action-rescan dedup = always-on; cache lifetime = invalidates on explicit navigate + LRU bound 20 URLs. The full-text-search-style force-fresh tool deferred unless lost-context cases surface.

Implementation in [decisions/stateful-scan-with-region-dedup.md](../decisions/stateful-scan-with-region-dedup.md).

## Original hypothesis (preserved)

# Stateful scan with chrome dedup

**Predicted change.** Make scan-formatted output stateful per page URL. The first scan on a URL returns the full element list. Subsequent scans (whether emitted by explicit `scan()` OR by the auto-rescan inside `press`/`navigate`/`scroll`/`toggle`/`hover`/`dialog`/`switch_tab`) return only the changed regions plus a header like `Chrome unchanged: 14 nav, 8 sidebar`. When the agent navigates to a new URL, state resets.

**Scope.** The dedup must apply to ALL scan-emitting tools, not just `scan()`. Per [perception-share-of-session-tokens](../findings/perception-share-of-session-tokens.md), explicit `scan()` is only ~25% of perception bytes; the remaining ~75% lives inside action returns. A dedup scoped to `scan()` alone caps savings at ~12% of total session bytes; the wider scope caps at ~50%.

**Mechanism.** Hash element lists by semantic region (header / main / sidebar / footer — orthogonal to [semantic-landmark-grouping](semantic-landmark-grouping.md)). On every scan-formatted emission, compare regions to the last cached state for this URL; emit unchanged regions as collapsed markers, changed regions in full. Elements that aren't re-emitted remain referencable by id (the `__vimx[]` store is unaffected).

Cache invalidates on:
- Navigation to a different URL (most cases).
- Same URL but agent calls `scan(force_full=true)` — bail-out for when the agent suspects staleness.
- Tab switch — see [tab-switch-resets-scan-cache](tab-switch-resets-scan-cache.md).

**Predicted outcome.** Measured baselines from the [2026-05-12 token-cost measurement](../sessions/2026-05-12-token-cost-measurement.md):
- **7% lower bound** on bytes savable from literal element-line dedup alone (162,924 / 2,323,369 across 10 sessions).
- **15-25% realistic** total session savings once group headers (`PRESS → press(element)`, etc.) and "Page:/URL:/Elements:N" scaffolding are also deduped.
- **17% upper-case** observed in YT Music session 5a47ec04 (86,641 repeat bytes / 507,699 file size) — these are the sessions where the win is biggest.

Knock-on: fewer redundant tokens in context → less token pressure → fewer downstream strategy distortions (see [chrome-redundancy-floods-scan-output](../findings/chrome-redundancy-floods-scan-output.md)).

**How to test.**
1. Implement behind a flag, scoped to all scan-emitting tools.
2. Re-run the 10 vimx-dominant cursor session tasks on both modes (`--stateful` vs baseline).
3. Measure (using the same measurement script in the source artifact):
   - Total scan-output bytes per session.
   - Per-tool result-size distribution (`press`/`navigate`/`scroll`/explicit-scan).
   - Turn count to task completion.
   - Verification-step frequency (proxy for token-pressure relief).
4. Pass condition: ≥15% total-session-byte reduction with no regression in success rate.

**Open design questions** (deferred to implementation):
- **Q1 cache-key choice.** Full URL vs path-only vs template-detected prefix. LinkedIn messaging routes that look the same but have different DOM shape are the canonical counter-example. See log entry on the 2026-05-12 brainstorm.
- **Q2 action-rescan dedup policy.** Always-dedup vs never vs chrome-only. The auto-rescan after action has different agent needs than an explicit scan (the agent just *did* something and wants confirmation). May justify a separate policy. Worth A/B testing.
- **Q3 cache lifetime.** Per-session vs sliding window vs explicit-invalidate. Long sessions on a single page (YT Music dragging) want longer; multi-page browsing wants shorter.

**Risk.** If the agent learns to rely on chrome being present in every scan, dedup could confuse it. Mitigation: chrome elements remain referencable by id even when not re-emitted; only the *listing* is collapsed. When the chrome itself changes (sidebar gains a new playlist), the change must be surfaced — that's the whole point.

**Calibration.** Measurements are over **pre-viewport-bound-scan sessions** ([decisions/viewport-bound-scan.md](../decisions/viewport-bound-scan.md)). Current code already emits less per scan (~7× cheaper per the 99-site benchmark). The stateful-scan win stacks on top — it doesn't substitute. But re-baseline post-viewport-bound before claiming current-state savings.

**Source.** Highest-ranked recommendation in pass 2 of [the 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md). Tier-1 fix. Original ~30 LOC estimate is light now that the scope extends to all scan-emitters and includes a per-URL cache. Realistic: ~80-120 LOC with cache eviction and the flag plumbing.
