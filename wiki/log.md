## [2026-05-12] ingest | cursor-export 17-session analysis + AI-native philosophy pushback

Two-pass analysis of 17 cursor session transcripts (7 playwright-dominant, 10 webpilot-dominant) covering matched task families. Pass 1 mapped the agent's perception→plan→act→perceive loop on both tools and enumerated 12 structural flaws. Pass 2 was a philosophy exchange with the project owner: pushback on "agent needs 0 web knowledge" (refined to *0 implementation knowledge, full semantic knowledge*), plus 8 ranked hypotheses.

Source: `~/Projects/cursor-export/exported/cursor-session-*.md` (17 files). Conversation: claude-code current session.

Pages touched:
- sessions/2026-05-12-cursor-export-17-sessions.md (new, frozen)
- findings/chrome-redundancy-floods-scan-output.md (new)
- findings/verification-gap-after-actions.md (new)
- findings/agents-have-no-state-prediction.md (new)
- findings/custom-widget-thrash.md (new)
- findings/tool-rolodex-blind-spots.md (new)
- hypotheses/stateful-scan-chrome-dedup.md (new, status: open)
- hypotheses/page-state-diff-in-action-returns.md (new, status: open)
- hypotheses/find-query-tool.md (new, status: open)
- hypotheses/semantic-landmark-grouping.md (new, status: open)
- hypotheses/predicted-effect-annotations.md (new, status: open)
- hypotheses/page-state-meta-detection.md (new, status: open)
- principles/abstract-mechanics-not-goals.md (new)
- principles/affordance-grouping-over-dom-hierarchy.md (new)
- decisions/auto-rescan-after-mutation.md (new — documents existing code)
- decisions/read-filter-is-regex.md (new — documents existing code)
- decisions/read-surfaces-link-urls.md (new — documents existing code)
- decisions/chrome-strip-removed.md (new — documents existing code)
- index.md (new)
- log.md (this file, new)

## [2026-05-12] skills | /wiki-ingest /wiki-query /wiki-lint added

Skills in `.claude/commands/`. Project root `CLAUDE.md` got a wiki pointer so future sessions discover the wiki without needing to be told.

## [2026-05-12] ingest | claude-code /benchmark dev sessions

Mined 13 project sessions in `~/.claude/projects/-home-wookie-Projects-webpilot/` that contained `/benchmark` mentions. Real `/benchmark` execution data came from 4 sessions:

- `3cd0f551` — 4 runs (iframe-merge, read-zero-chars regression, layout-variability, chrome-strip)
- `f174aed7` — 2 runs (hit-test, scanner empty-label filter)
- `6b7a1271` — 2 runs (viewport-bound vs full, URL annotation)
- `464ca9cc` — 1 run (sleep/debounce CDP optimization)

Pages touched:
- benchmarks/2026-05-11-chrome-strip-validated.md (new)
- benchmarks/2026-05-11-hit-test-obscured.md (new)
- benchmarks/2026-05-11-iframe-merge-read.md (new)
- benchmarks/2026-05-11-read-zero-chars-regression.md (new)
- benchmarks/2026-05-11-read-layout-variability.md (new)
- benchmarks/2026-05-11-scanner-empty-label-filter.md (new)
- benchmarks/2026-05-11-sleep-debounce-cdp.md (new)
- benchmarks/2026-05-12-url-annotation-read.md (new)
- benchmarks/2026-05-12-viewport-bound-vs-full.md (new)
- decisions/viewport-bound-scan.md (new — viewport filter on `scan()`, ~7× cheaper per session)
- decisions/observe-before-act-cdp-events.md (new — no defensive sleeps; CDP events drive sync; 29–43× `key()` speedup)
- decisions/hit-test-obscured-detection.md (new — `elementFromPoint` for pre-action obscuration check)
- principles/benchmarks-validate-principles-decide.md (new — surfaced from the chrome-strip arc; canonical methodology page)
- decisions/chrome-strip-removed.md (updated — full added-then-removed arc with both commit refs)
- decisions/read-surfaces-link-urls.md (updated — variant-E selection backed by 19-site benchmark)
- index.md (updated — added Benchmarks section, 3 new decisions, 1 new principle)
- log.md (this entry)

### Calibration note

`grep -c '/benchmark' file.jsonl` overcounts. Many JSONL files showed multiple "hits" but contained no actual `/benchmark` runs — just meta-discussion or agent delegations naming the command. Real execution count across the 13 candidate sessions is **9**, not 33.

Lesson for future ingests: grep hit counts are a *sampling tool*, not a *load count*. Verify with targeted reads before promising downstream propagation. The `/wiki-ingest` skill's "find /benchmark sessions" path should pair the grep with a per-session sanity-check step before extraction.

### Surprise worth flagging

The viewport-bound scan decision is not arbitrary — it's backed by hard measurement (99 sites, ~7× per-session token cost difference). Worth remembering when future hypotheses propose surfacing more in scan: the cost ceiling is real and was paid for in benchmark time. Conversely, the chrome-strip arc is the inverse — a benchmark that *cleanly validated* a change still got the change removed on principle. Both directions matter when interpreting future ingests.

## [2026-05-12] refute | find(query) hypothesis based on owner's prior experience

Started implementing `find(query)` per the hypothesis. Owner stopped mid-implementation: webpilot previously shipped a `query` tool with this same API shape, and agents made too-narrow / semantic-style calls (treating it as a search engine that should understand intent). The owner pivoted to `read({regex})` precisely because of that failure pattern.

The shape of a "natural-language query" API invites semantic-search-style misuse regardless of how the implementation does matching. Substring matching can't satisfy `query("button to add product to cart")` — the agent concludes the tool is broken.

Reverted the in-progress implementation; marked hypothesis as `status: refuted`.

Pages touched:
- src/index.ts (reverted — find tool removed before commit)
- wiki/hypotheses/find-query-tool.md (status: open → refuted, evidence updated)
- wiki/findings/expose-primitives-not-search-engines.md (new — articulates the principle)
- wiki/index.md (hypothesis ranking note; new finding listed)
- wiki/log.md (this entry)

Two narrower follow-ups identified for the original "agents abandon webpilot for curl" symptom — both improvements to existing primitives, not new tools:
1. Improve `read({regex})` tool description to lean into "find content" framing.
2. Surface site-internal search affordances in scan output when `<input type="search">` / `[role="search"]` exist.

Calibration note: this is the cleanest refutation in the wiki so far — prior implementation experience trumped a hypothesis derived from session analysis. Worth bookmarking as evidence that owner-history is a first-class source alongside session data and benchmarks.

## [2026-05-12] ship | nail-the-dedup post-ship refinements

Post-ship session analysis (6 new cursor sessions) surfaced four structural edges in the v1 dedup that violated `abstract-mechanics-not-goals`. Three fixed cleanly, one investigated inconclusively, two correctness fixes shipped.

Decisions made by data, not opinion:
- **(a)** Full-elision wording: `"No changes since last scan. ... still current — act on what you saw"` replaces the misread-prone `"(unchanged since last scan, ids: ...)"`. Targeted at the 6/10 defensive-rescan rate seen in 8bbfd98a.
- **(b)** Error-state bypass via `aerr()` helper sets `nextScanForceFresh`. Verified by smoke test (press[bad id] → next scan emits full, not dedup).
- **(c)** Per-entry `[region]` suffix dropped; promoted to disambiguator. Re-bench: cold-scan dropped 5503 → 5050 chars (-8.2%). Regions now load-bearing only when they actually differentiate.
- **(d)** Region stability via `__wpRegionMap` WeakMap.
- **(e)** Mutation race: probed across 3 sites, targets produced 0 mutations in 750ms — couldn't reproduce. Marked inconclusive; the symptom is probably (a)'s problem in disguise.
- **(f)** Cache key now `origin + pathname + search`. Confirmed false dedup on Google Flights `?q` state via side-channel CDP test; verified fix re-running the same test.

Pages touched:
- src/scanner.ts (region disambig strategy, WeakMap, frame-element guard tweaks)
- src/index.ts (wording, aerr+forceFresh, fmtEntry without region, urlPathKey+search)
- audit/cache-key-investigation.mts (new, /ship-by-bench style: hypothesis → measure → fix → verify)
- audit/mutation-race-investigation.mts (new, inconclusive result documented)
- audit/data/cache-key-investigation/findings.txt (new)
- wiki/benchmarks/2026-05-12-cache-key-investigation.md (new)
- wiki/findings/post-ship-dedup-edges.md (new — A through F catalog)
- wiki/decisions/stateful-scan-with-region-dedup.md (updated — Post-ship refinements section)
- wiki/log.md (this entry)

Process note: the (c) presentation cycle — show real before/after on session data, get user OK, then ship + bench — is exactly the `/ship-by-bench` loop the skill encodes. Worked: 0 surprises in the re-bench.

## [2026-05-12] ship | stateful-scan-chrome-dedup v1

Shipped the hypothesis. Two benchmarks decided the design, one validated the ship.

- **B0 detector benchmark** (20 sites): compared ARIA-only / ARIA+position-fallback / full-pipeline. ARIA+position-fallback (detector B) chosen — 100% region coverage post-fix, zero failures.
- **Dedup v1 benchmark** (20 sites, same set): scan output dropped **−83% on idle re-scans** and **−89% post-action**. One regression on x.com/explore (+34 chars on 123-char output — noise). Aggregate: ~104k of ~108k sample chars saved.

Pages touched:
- src/scanner.ts (region detection inline in SCANNER_JS; ~80 LOC)
- src/index.ts (scanCache, emitScan entry point, formatScanResultDedup; ~200 LOC)
- audit/region-detector-b0.mts + audit/data/region-detector-b0/ (B0 benchmark)
- audit/dedup-v1-bench.mts + audit/data/dedup-v1/ (v1 benchmark)
- audit/dedup-v1-eyeball.mts (single-site visualization tool)
- audit/quick-regression.mts (post-change scanner sanity check)
- audit/debug-regions.mts (ARIA region probe)
- wiki/benchmarks/2026-05-12-region-detector-b0.md (new)
- wiki/benchmarks/2026-05-12-stateful-scan-dedup-v1.md (new)
- wiki/decisions/stateful-scan-with-region-dedup.md (new)
- wiki/hypotheses/stateful-scan-chrome-dedup.md (status: open → confirmed)
- wiki/index.md (hypothesis ranking updated, new benchmark+decision listed)

Default on (`WEBPILOT_SCAN_DEDUP=0` to disable).

Notes for future revisits:
- Coverage bug fix mid-implementation: position fallback was gated behind `regs.length < 2`, which prevented `main` synthesis on Amazon-shape pages (many navs, no `<main>`). Moved the synthesize-main step out of the gate. Caught only by post-change regression check, not the B0 benchmark — emphasizing that detector quality and assignment-coverage are different things.
- Cross-page chrome dedup (template URL keying) deferred. Filed as future work if LinkedIn-messaging-shaped cases prove common.
- Force-fresh scan tool deferred. Workaround: `navigate(<currentUrl>)` invalidates cache.

## [2026-05-12] brainstorm | stateful-scan-chrome-dedup design exchange

Brainstorm pass on hypothesis #1 surfaced one new hypothesis and two open-question benchmarks. Q1 was answered B (couple with semantic-landmark grouping) — v1 scope is larger than the simulate-ux recommendation but architecturally cleaner.

Pages touched:
- hypotheses/tab-switch-resets-scan-cache.md (new — surfaced from Q5; safety-conservative cache reset on tab activation)
- index.md (updated — added tab-switch hypothesis to ranked list)
- log.md (this entry)

Open benchmarks (deferred to implementation phase):
- B1 cache-key choice (Q4): URL path vs. template-detected prefix vs. full URL — LinkedIn-messaging-shaped cases motivate the test
- B2 post-action dedup (Q8): always-dedup vs. never vs. chrome-only — before/after token measurement on the 10 webpilot session tasks

## [2026-05-12] ingest | token-cost measurement on 10 webpilot sessions

Primary-source byte breakdown of where tokens actually go in webpilot usage. Replaced prior estimates ("50-100k redundant tokens", "~140 sidebar repeats") with measured numbers. Source: regex over the same 10 webpilot-dominant cursor session exports analyzed in the prior ingest; conversation thread did the measurement and analysis.

Key numbers (across 2.32M total chars in 10 sessions):
- ~50% of all session bytes are scan-formatted output
- `press` alone is 20.6% — more than explicit `scan` (12.2%)
- `read` is 14.3%, agent prose 24%, schema bootstrap only 3.1%
- Chrome literal-line duplication: 7% lower bound (162,924 / 2,323,369), 17% worst case (YT Music)

Pages touched:
- sessions/2026-05-12-token-cost-measurement.md (new — frozen measurement artifact)
- findings/chrome-redundancy-floods-scan-output.md (updated — replaced estimates with measured 7% / 17% figures; added top-offender table)
- findings/perception-share-of-session-tokens.md (new — auto-rescan dominates explicit scan; ~75:25 ratio of perception bytes)
- hypotheses/stateful-scan-chrome-dedup.md (updated — scope extended to ALL scan-emitters not just explicit `scan()`; predicted savings refined to 7-25% with measured backing; LOC estimate revised up; open design questions Q1-Q3 surfaced)
- index.md (updated — new finding + new session entry; chrome-redundancy summary line updated with measured figures)
- log.md (this entry)

### Calibration

Measurements are over **pre-viewport-bound-scan sessions**. The viewport-bound decision (2026-05-12) measured ~7× per-session cost reduction on a separate 99-site benchmark. These numbers represent the worst-case historical ceiling, not current-code state. Re-baselining post-viewport-bound is deferred until a current-code session corpus exists. The *ratio* between auto-rescan and explicit-scan bytes (~3:1) should be more stable across that pivot but is not yet confirmed.

### Methodology callout

Two regex pitfalls cost time before the measurements landed:
1. Tool name regex initially missed `MCP  ` prefix used in cursor exports.
2. Element-line dedup initially looked for real newlines; cursor export embeds scan output as JSON-escaped strings, so element lines appear as literal `\n  [N] ...` in the file bytes. Switched to matching the doubly-escaped form directly.

Filing these here so a future ingest doesn't redo the same false starts.

### Surprise worth flagging

Pre-measurement intuition (mine, in the prior analysis): "schema bootstrap is real but not the priority." Confirmed empirically — schema reads were 3.14%, much smaller than they felt in the qualitative read-through. Conversely, the action-return-vs-explicit-scan split (3:1 perception bytes from auto-rescans) was NOT in the qualitative analysis at all — it only surfaced from measurement. This is a case where the quantitative pass corrected the qualitative one. The hypothesis update reflects that.
