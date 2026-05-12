# wiki index

Navigation hub. See [CLAUDE.md](CLAUDE.md) for the operating manual and [IDEA.md](IDEA.md) for the general schema.

## Principles

- [abstract-mechanics-not-goals](principles/abstract-mechanics-not-goals.md) — the tool owns implementation; the agent owns task semantics. North-star contract.
- [affordance-grouping-over-dom-hierarchy](principles/affordance-grouping-over-dom-hierarchy.md) — scan output groups by what you can DO, not what an element IS.
- [benchmarks-validate-principles-decide](principles/benchmarks-validate-principles-decide.md) — benchmarks answer "is it safe?"; principles answer "should we?". The chrome-strip arc is the canonical case.

## Decisions (in code)

- [auto-rescan-after-mutation](decisions/auto-rescan-after-mutation.md) — every mutating tool returns a fresh scan inline.
- [stateful-scan-with-region-dedup](decisions/stateful-scan-with-region-dedup.md) — `scan()` is stateful per URL path; emits dedup output when prior state exists; region tag attached to every entry.
- [chrome-strip-removed](decisions/chrome-strip-removed.md) — `read()` returns full innerText; nav/footer/aside no longer stripped. Added then removed: benchmark-validated, principle-removed.
- [hit-test-obscured-detection](decisions/hit-test-obscured-detection.md) — `elementFromPoint` in `getRect`; near-zero post-fix FP rate; names the obstructor in errors.
- [observe-before-act-cdp-events](decisions/observe-before-act-cdp-events.md) — no defensive sleeps; CDP events drive sync; 29–43× `key()` speedup.
- [read-filter-is-regex](decisions/read-filter-is-regex.md) — `read({regex})` not `query`; case-insensitive, per-line, ±2/+5 context.
- [read-surfaces-link-urls](decisions/read-surfaces-link-urls.md) — `read()` formats `<a>` as `[text](url)`; benchmark-validated variant E.
- [viewport-bound-scan](decisions/viewport-bound-scan.md) — `scan()` filters to viewport; off-viewport navigation via `read()` URL annotation. ~7× cheaper per session.

## Findings

- [chrome-redundancy-floods-scan-output](findings/chrome-redundancy-floods-scan-output.md) — measured: 7% session-byte waste lower bound; 17% in worst case (YT Music).
- [perception-share-of-session-tokens](findings/perception-share-of-session-tokens.md) — ~50% of session bytes are scan-formatted output; `press` alone is 20.6%, more than explicit `scan`.
- [verification-gap-after-actions](findings/verification-gap-after-actions.md) — agents can't tell whether their own action succeeded.
- [agents-have-no-state-prediction](findings/agents-have-no-state-prediction.md) — reactive perceive→act, no predicted outcome to compare against.
- [custom-widget-thrash](findings/custom-widget-thrash.md) — biggest single failure pattern; custom dropdowns burn 6–12 turns of guessing.
- [tool-rolodex-blind-spots](findings/tool-rolodex-blind-spots.md) — hover/key/expand systematically underused even when scan output hints them.

## Hypotheses

Ranked by expected leverage (highest first):

1. [stateful-scan-chrome-dedup](hypotheses/stateful-scan-chrome-dedup.md) — diff repeated scans against page-state cache. **CONFIRMED** (2026-05-12): -83% idle, -89% post-action.
2. [semantic-landmark-grouping](hypotheses/semantic-landmark-grouping.md) — group scan by ARIA landmarks / HTML5 sections. **Partially shipped** with #1 (region tags on every entry).
3. [page-state-diff-in-action-returns](hypotheses/page-state-diff-in-action-returns.md) — emit URL/title/h1/badge diffs after every mutating action.
4. [find-query-tool](hypotheses/find-query-tool.md) — native `find(query)` replacing `read({regex})` workarounds.
5. [predicted-effect-annotations](hypotheses/predicted-effect-annotations.md) — heuristic `→ opens_modal` style hints on PRESS elements.
6. [page-state-meta-detection](hypotheses/page-state-meta-detection.md) — detect cookie banners, signin walls, captchas as named states.
7. [tab-switch-resets-scan-cache](hypotheses/tab-switch-resets-scan-cache.md) — safety-conservative: reset per-URL cache on tab activation to avoid background-mutation drift.

## Sessions

- [2026-05-12 cursor-export 17 sessions](sessions/2026-05-12-cursor-export-17-sessions.md) — two-pass analysis (UX map + AI-native pushback).
- [2026-05-12 token-cost measurement](sessions/2026-05-12-token-cost-measurement.md) — primary-source byte breakdown across 10 webpilot-dominant sessions; baseline pre-viewport-bound.

## Benchmarks

From `/benchmark` runs in claude-code dev sessions (2026-05-10 to 2026-05-12):

- [2026-05-12 stateful-scan dedup v1](benchmarks/2026-05-12-stateful-scan-dedup-v1.md) — 20 sites; -83% idle / -89% post-action scan output; 0 site failures; 1 noise-level regression.
- [2026-05-12 region-detector B0](benchmarks/2026-05-12-region-detector-b0.md) — 20 sites; detector B (ARIA + position fallback) chosen; 100% coverage post-fix.
- [2026-05-11 chrome-strip validated](benchmarks/2026-05-11-chrome-strip-validated.md) — 70 sites, 2.8% read() savings, zero regressions (feature later removed on principle).
- [2026-05-11 hit-test obscured detection](benchmarks/2026-05-11-hit-test-obscured.md) — `elementFromPoint` in `getRect`; FP 0–15% pre-scanner-fix.
- [2026-05-11 iframe-merge for read()](benchmarks/2026-05-11-iframe-merge-read.md) — 21ms overhead, gain on only 5.8% of sites.
- [2026-05-11 read() returning 0 chars](benchmarks/2026-05-11-read-zero-chars-regression.md) — diagnostic caught total read() failure across 70 sites.
- [2026-05-11 read() layout variability](benchmarks/2026-05-11-read-layout-variability.md) — content-type-sensitive output; 0.27×–38.63× variance.
- [2026-05-11 scanner empty-label filter](benchmarks/2026-05-11-scanner-empty-label-filter.md) — fixed hit-test FPs; Reddit 50%→7%.
- [2026-05-11 sleep/debounce CDP optimization](benchmarks/2026-05-11-sleep-debounce-cdp.md) — `key` 29–43×, scan 3–5×, scroll 6–8× speedup.
- [2026-05-12 URL annotation in read()](benchmarks/2026-05-12-url-annotation-read.md) — variant E (unfiltered) chosen across 19 sites; 52% of anchors off-viewport.
- [2026-05-12 viewport-bound vs full-page scan](benchmarks/2026-05-12-viewport-bound-vs-full.md) — 99 sites; viewport-bound ~7× cheaper per session.

## Operational

- [log.md](log.md) — chronological ingest record.
