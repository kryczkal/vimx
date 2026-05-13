## [2026-05-14] decide | rename webpilot → vimx (project-wide)

Rebrand. "webpilot" collided with three+ active projects (Chrome extension, Chrome MCP server, SEO SaaS) — failed the basic uniqueness test. The "Vimium for AI agents" tagline is preserved, but the brand is now distinct.

Naming process: rejected metaphor lane (Sleuth, Shepherd) and pure-brandable lane (Hindle, Vyx) — those will be saved for the future glasses AI consumer product. For *this* under-the-hood Vimium-based MCP infra, infrastructure-feeling names won (vimx, vimkit, hint-mcp, dom-pry as the shortlist). Settled on **vimx**: Vim-tribute heritage, three letters, Unix-y `-x` suffix (httpx, swc, fd lane), npm name free, GitHub repo claimed.

Mass rename across 49 files (248 insertions / 244 deletions, commit 81d4f88):
- `webpilot` → `vimx` (226× — prose, npm name, bin, MCP server identity)
- `WEBPILOT` → `VIMX` (35× — env vars: `VIMX_PROFILE_TEMPLATE`, `VIMX_PROFILE_DIR`, `VIMX_HIGHLIGHT`, `VIMX_SCAN_DEDUP`)
- `WP-Bench` → `Vimx Bench` (10×)
- `wp-bench` → `vimx-bench` (9×)
- `Webpilot` → `Vimx` (4×)
- `wpbench` → `vimxbench` (1×)

API surface changes (breaking — no public adopters yet, so safe window):
- MCP server registers as `vimx`
- `window.__vimx[]` (was `window.__webpilot[]`) — page-side global ref store
- `/tmp/vimx-mcp-*` (was `/tmp/webpilot-mcp-*`) — ephemeral profile dir convention
- Env vars: `VIMX_*` not `WEBPILOT_*`
- npm package: `vimx`; bin: `vimx`

File rename: `wiki/launch/wp-bench-v1.md` → `wiki/launch/vimx-bench-v1.md`. Git remote URL updated to `git@github.com:kryczkal/vimx.git`. GitHub repo renamed via UI (auto-redirects from old URL indefinitely; local remote points at new directly).

Pages touched:
- All 49 modified files (see `git show 81d4f88 --stat`)
- THIRD-PARTY-NOTICES.md untouched (Vimium attribution preserved verbatim)
- `wiki/business.md` updated (gitignored — strategy doc)
- `~/.cursor/mcp.json` updated (server key + env var names)
- `~/.claude/settings.local.json` updated (`mcp__webpilot__*` → `mcp__vimx__*` permission entries)
- `wiki/log.md` (this entry)

Local-dev cleanup deferred:
- Project directory `/home/wookie/Projects/webpilot/` not renamed — would cascade into 5 worktree paths and the cwt config. Path is incidental; only the GitHub repo URL changed.
- Other worktree branches (`capture-bridge`, `code-quality`, `find-query`, `multi-browser`, `predicted-effect-annotations`) still contain `webpilot` references in their per-branch state. Each worktree's `.mcp.json` (`webpilot.code-quality/.mcp.json` etc.) still references the old name. Will resolve when each branch is rebased onto the new main; until then, those worktrees' MCP configs match their branch state and continue to function.
- Profile template path `/home/wookie/.local/state/webpilot/profile` left as-is (just storage; rename is cosmetic).

Calibration note: the GitHub push of the launch-prep batch triggered GitHub's secret-scanning protection — caught a real-format Stripe key (the canonical Stripe documentation example, value redacted to keep this log push-safe) inside `docs/PRODUCTION_JAVASCRIPT_GUIDE.md` at line 2159. Pre-push secret scan grepped for generic `api[_-]?key|secret|token|password|sk-` patterns but missed the `sk_(live|test)_*` Stripe-specific format. Filing for next time: include Stripe-format detection in the pre-push scan even though GitHub's scanner catches it post-push. Resolved via `git filter-branch` over 9 commits, replacing with a clearly-non-real placeholder. History was force-pushed.

Meta-calibration: the *first* version of this very log entry repeated the leaked key value verbatim in the prose explaining the incident, which re-triggered push protection on the next push. Lesson: when documenting a secret-leak incident in a public-bound wiki, redact the literal value even in the meta-narrative. Updated the entry to refer to the format pattern instead.

## [2026-05-13] decide | license MIT with documented relicense trigger to Apache 2.0

Resolved the OSS-license question parked in `business.md`. Decision is MIT for v0, with four named triggers for relicense to Apache 2.0: enterprise legal ask, foundation entry (CNCF/LF/ASF), $1M ARR, or large-corp contributor blocked by employer policy. DCO sign-off on all contributions preserves relicense optionality without CLA friction.

Research basis: peer-license matrix at decision time was bimodal — indies (browser-use, Stagehand, Vimium) on MIT; big-company projects (Playwright-MCP, MCP TypeScript SDK) on Apache 2.0. v0 launch posture (indie agent builders, HN audience, max adoption velocity) puts us with the indies. The Apache 2.0 patent-grant value is deferred — enterprise/foundation/large-corp-contributor conversations are the trigger, not the current state. Source-available (BSL/FSL/SSPL) rejected as wrong-frame: pattern fits stateful managed-service businesses defending against AWS clones, not stateless library/server kernels like vimx. AGPL/MPL 2.0 rejected: AGPL spooks enterprise procurement; MPL 2.0's file-level copyleft conflicts with the "embed in your stack" kernel positioning.

Pages touched:
- LICENSE (new — SPDX MIT, Copyright (c) 2026 Łukasz Kryczka)
- CONTRIBUTING.md (new — DCO sign-off, scope guardrails for the kernel)
- package.json (added `"license": "MIT"` + `"author"` field)
- wiki/decisions/license-mit-with-relicense-trigger.md (new — type: decision, full alternatives + trigger gate documented)
- wiki/business.md (struck-through the resolved open question, linked to decision page)
- wiki/index.md (Decisions section: added at top)
- wiki/log.md (this entry)

Adjacent decisions captured in the decision page (not separate pages yet):
- Trademark "vimx" reserved separately — file intent-to-use USPTO when brand commits.
- Benchmark license: CC BY 4.0 for Vimx Bench task list + writeups (separate artifact from code).
- DCO GitHub App install (github.com/apps/dco) deferred until repo is public.

Calibration note: the original parked answer in business.md was "lean Apache 2.0; defer until first enterprise conversation." Research flipped the lean — the closest functional peers (browser-use, Stagehand) being MIT was the load-bearing data, not the Anthropic-SDK Apache 2.0 signal. First-draft conviction was wrong; the wiki-discipline check (separate research before committing) caught it before it became code.

## [2026-05-13] backfill | browser-lifecycle + profile-semantics decision

Eight shipped commits (May 12 → May 13) were absent from the wiki — a coherent architectural arc that moved the chromium from "MCP boot spawns it" to "LLM controls it via tools, profile semantics opt-in by env." The wiki had zero references to `browser_open`, `browser_close`, `VIMX_PROFILE_TEMPLATE`, or `VIMX_PROFILE_DIR`. Backfilled as a single decision page rather than per-commit, since they form one design.

Commits covered: `9f6f7a6` (auto-spawn per MCP server) → `17deedf` (`browser_open`/`browser_close` tools) → `2a1043e` (`VIMX_PROFILE_DIR`) → `ff739fc` (`VIMX_PROFILE_TEMPLATE`) → `6c8d70f` (stale-dir sweep) → `49d66d3` (attach-liveness fix via `/proc/cmdline` rather than CDP probe). Dev-side commits `463a4dc` + `3815a87` (per-worktree cwt hooks) referenced as supporting the attach branch.

Pages touched:
- wiki/decisions/browser-lifecycle-and-profile-semantics.md (new)
- wiki/index.md (added to Decisions list, top)
- wiki/log.md (this entry)

Calibration note: this is a wiki-discipline miss worth flagging. The wiki's stated job (per wiki/CLAUDE.md) is "every page belongs to one of [hypothesis → finding → decision → principle] stages" — a decisions/ entry per shipped feature is the load-bearing claim. Eight commits without a corresponding decision page is the kind of drift the lint workflow should catch. Filing the backfill itself, not just the decision, so the gap is visible in the log.

## [2026-05-13] plan | Vimx Bench v1 spec + private business doc

Drafted the public-launch benchmark spec and the internal strategy doc. The benchmark is a new artifact category (external comparison, not internal tool-iteration measurement); filed under `wiki/launch/` to keep it separate from the existing `wiki/benchmarks/` perf record. Pre-registered predictions, pre-committed retraction threshold, and a 7-week W1→W7 launch sequence anchored on the BU-Bench harness (sibling repo).

The business doc is gitignored — strategy, GTM, indie-vs-venture decision gate at month 6. Not for public repos; lives in the wiki for the same reason source-of-truth docs do, with a `wiki/business.md` line in `.gitignore` to keep it private.

Pages touched:
- wiki/launch/vimx-bench-v1.md (new — type: benchmark, status: planned)
- wiki/business.md (new, gitignored — type: strategy)
- .gitignore (added `wiki/business.md`)
- wiki/index.md (new Launch section linking vimx-bench-v1)
- wiki/log.md (this entry)

Open questions parked in the spec: Stagehand may be the closer rival than Playwright-MCP (pending pilot); Computer Use action budget needs both capped/uncapped numbers; browser-use cloud vs local-headful for fairness; design-partner sequencing ahead of HN launch.

Decision gate: if Vimx Bench v1 shows ≤10pt gap vs Playwright-MCP in ≥3 categories, the category framing is retracted. The spec includes that as a pre-commitment, not a hedging clause.

## [2026-05-12] ingest | cursor-export 17-session analysis + AI-native philosophy pushback

Two-pass analysis of 17 cursor session transcripts (7 playwright-dominant, 10 vimx-dominant) covering matched task families. Pass 1 mapped the agent's perception→plan→act→perceive loop on both tools and enumerated 12 structural flaws. Pass 2 was a philosophy exchange with the project owner: pushback on "agent needs 0 web knowledge" (refined to *0 implementation knowledge, full semantic knowledge*), plus 8 ranked hypotheses.

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

Mined 13 project sessions in the local claude-code project history (`~/.claude/projects/<path-encoded>/`, where the encoded form is the project's absolute path with `/` replaced by `-`) that contained `/benchmark` mentions. Real `/benchmark` execution data came from 4 sessions:

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

## [2026-05-12] parked | read → find rename / split

Started the rename `read` → `find` per the "improve discoverability of search-shaped functionality" follow-up from the find(query) refutation. Implemented the rename, then surfaced a semantic split: "where is X" (regex) and "read this article" (no regex) don't comfortably share a tool name. Split into `read()` (no args, full ingest) + `find(regex)` (required regex, locate). Built clean.

Smoke testing the split exposed an infrastructure issue: my bench scripts and smoke tests hardcoded `CDP_PORT=9222`, which is the user-level shared chromium. Other agents driving that chromium contaminated my tests (navigated to Wikipedia, read returned Stack Overflow content). The cwt-per-worktree setup allocates dedicated chromiums per worktree (port from `.mcp.json`) precisely to prevent this — but my current cwd is the primary repo (no `.mcp.json`).

Decision: revert the rename + split. Park as a backlog item until worktree/CDP-port infra is sorted. State preserved in [expose-primitives-not-search-engines](../findings/expose-primitives-not-search-engines.md) "Deferred direction" section.

Pages touched:
- src/index.ts (reverted to single `read(regex?)` tool)
- wiki/findings/expose-primitives-not-search-engines.md (added "Deferred direction" section)
- wiki/log.md (this entry)

Reverted (no longer present):
- wiki/decisions/read-renamed-to-find.md (created then deleted)
- header notes in wiki/decisions/read-filter-is-regex.md / read-surfaces-link-urls.md / chrome-strip-removed.md

Calibration note: bench scripts should read CDP_PORT from `.mcp.json` rather than hardcode 9222. Filing as a small infra follow-up — important for any future smoke test that needs an isolated chromium.

## [2026-05-12] refute | find(query) hypothesis based on owner's prior experience

Started implementing `find(query)` per the hypothesis. Owner stopped mid-implementation: vimx previously shipped a `query` tool with this same API shape, and agents made too-narrow / semantic-style calls (treating it as a search engine that should understand intent). The owner pivoted to `read({regex})` precisely because of that failure pattern.

The shape of a "natural-language query" API invites semantic-search-style misuse regardless of how the implementation does matching. Substring matching can't satisfy `query("button to add product to cart")` — the agent concludes the tool is broken.

Reverted the in-progress implementation; marked hypothesis as `status: refuted`.

Pages touched:
- src/index.ts (reverted — find tool removed before commit)
- wiki/hypotheses/find-query-tool.md (status: open → refuted, evidence updated)
- wiki/findings/expose-primitives-not-search-engines.md (new — articulates the principle)
- wiki/index.md (hypothesis ranking note; new finding listed)
- wiki/log.md (this entry)

Two narrower follow-ups identified for the original "agents abandon vimx for curl" symptom — both improvements to existing primitives, not new tools:
1. Improve `read({regex})` tool description to lean into "find content" framing.
2. Surface site-internal search affordances in scan output when `<input type="search">` / `[role="search"]` exist.

Calibration note: this is the cleanest refutation in the wiki so far — prior implementation experience trumped a hypothesis derived from session analysis. Worth bookmarking as evidence that owner-history is a first-class source alongside session data and benchmarks.

## [2026-05-12] descope | page-state-meta-detection (cookies/signin/captcha)

Started the bench loop on hypothesis #6. First-pass detector scored:
- cookieBanner: precision 100%, recall 22% (missed Sourcepoint/Piano CMP iframes)
- signinRequired: precision 100%, recall 50% (missed multi-step flows)
- captcha: precision 33% (Stack Overflow / Reddit / Booking flagged as captcha via invisible reCAPTCHA v3 trackers)

Iteration v2 was queued (filter to visible captcha challenges, add CMP iframe patterns, URL-only signin signal). Owner stopped before v2:

> "look realistically. we skip cookies/captchas for this iteration of the tool. its not relevant until the tool is better/cheaper than playwright"

Calibration: page-state meta-detection is polish — useful when the tool's core UX is already ahead. The axes that widen the vimx-vs-Playwright gap are token economy (won via dedup), reliability on common actions (won via anomaly-flag + clearField), affordance-typed structural correctness, and speed. Cookie detection doesn't move any of those.

Bench artifacts preserved (audit/page-state-detector-bench.mts, audit/page-state-inspect.mts, audit/data/page-state-detector/) — pickable if we ever return.

Status flipped: open → superseded.

Pages touched:
- wiki/hypotheses/page-state-meta-detection.md (status flip + reasoning)
- wiki/index.md (annotated in ranked list)
- wiki/log.md (this entry)

Bench scripts kept untracked for now (no commit) until we decide whether they should live in the repo's audit/ surface.

## [2026-05-12] ship | anomaly-flag action returns + cdpSelectAll bug fix

Bench-driven loop on hypothesis #3 (page-state-diff-in-action-returns), reframed to "tool refuses silent failure" — three anomaly heuristics across `type` / `toggle` / `select`. Bench: 4/4 PASS including 0 false positives on 8 real-site search-bar typings.

**Bigger surprise**: the bench discovered `cdpSelectAll` had been silently broken since written. CDP modifier `8` is Shift, not Ctrl — `cdpSelectAll` dispatched `Shift+a` (capital A) instead of `Ctrl+A`. Every `type(clear:true)` on a non-empty field actually produced `prior + typed`. Agents never noticed because most types target empty search bars where `clear` is a no-op. **This was the actual root cause of the Forms session 8bbfd98a "Option AOption 1" shipped-broken case** — not a controlled-component edge case, just a vimx bug.

Fix: replaced `cdpSelectAll + cdpBackspace` with `clearField()` — DOM-side native value setter call dispatched as input+change. Works against controlled React/Vue components via prototype descriptor.

Decisions made by data:
- Anomaly heuristics: stayed in code as second layer of defense after the root-cause fix.
- Heuristic shape (length-guard against false positives): validated by SYN-type-idempotent passing AND FP-sweep zero fires.

Pages touched:
- src/index.ts (clearField, aerr-based anomaly heuristics for type/toggle/select)
- audit/anomaly-flag-bench.mts (new — synthetic + FP-sweep)
- wiki/benchmarks/2026-05-12-anomaly-flag-action-returns.md (new)
- wiki/decisions/clear-via-dom-not-keyboard.md (new — the cdpSelectAll bug arc)
- wiki/decisions/anomaly-flag-action-returns.md (new)
- wiki/hypotheses/page-state-diff-in-action-returns.md (status: open → confirmed; surprise note about cdpSelectAll)
- wiki/index.md (this hypothesis confirmed; new decisions listed)
- wiki/log.md (this entry)

Calibration note: this is the second instance in the wiki where a hypothesis bench surfaced a deeper root-cause bug than the hypothesis itself addressed. The first was chrome-strip (which validated a feature that was then removed on principle). Pattern: bench discipline keeps finding things we didn't know to ask about.

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

Default on (`VIMX_SCAN_DEDUP=0` to disable).

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
- B2 post-action dedup (Q8): always-dedup vs. never vs. chrome-only — before/after token measurement on the 10 vimx session tasks

## [2026-05-12] ingest | token-cost measurement on 10 vimx sessions

Primary-source byte breakdown of where tokens actually go in vimx usage. Replaced prior estimates ("50-100k redundant tokens", "~140 sidebar repeats") with measured numbers. Source: regex over the same 10 vimx-dominant cursor session exports analyzed in the prior ingest; conversation thread did the measurement and analysis.

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

## [2026-05-12] phase | post-ship data gathering; predicted-effect-annotations queued next

Holding new hypothesis work pending real-session data on this week's ship cycle. Shipped since the last cursor-export batch:

- stateful-scan-chrome-dedup (v1 + post-ship a/b/c/d/f refinements)
- anomaly-flag in action returns (type / toggle / select)
- clearField — the actual fix for the Forms shipped-broken case (cdpSelectAll was dispatching Shift+A, not Ctrl+A — every `type(clear:true)` on a non-empty field had been silently producing `prior + typed` since the function was written)

The next session export should measure these deltas. Specifically watch for:
- Aggregate session tokens on tasks with prior cursor-export pairs (Flights, Forms, Amazon cart, Dayton)
- Does the Forms task ship clean (no more `Option AOption A` style breakage)?
- Does the obscured-element abort pattern (session 296dc5de) recover, with the (b) error-bypass returning full scan after an interactive failure?
- Does the agent reference "still current" framing of full-elision (the (a) wording fix)?
- Does the agent stumble on querystring-state navigation that previously false-dedupped (the (f) cache-key fix)?

**Next hypothesis to test once new data is in**: [predicted-effect-annotations](hypotheses/predicted-effect-annotations.md). Reframed to **action-prescriptive** (`→ combobox, navigate with key("arrowdown")`) targeting the custom-widget thrash failure mode from cursor-session-5a47ec04. The risk pattern that killed per-entry region tags (decoration agents ignore) applies here too — the reframe is the gate on whether this is worth shipping.

Pages touched:
- wiki/hypotheses/predicted-effect-annotations.md (queued + reframe note)
- wiki/index.md (annotated #5 as NEXT TO TEST)
- wiki/log.md (this entry)
