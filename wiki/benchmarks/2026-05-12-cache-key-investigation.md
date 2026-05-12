---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: audit/cache-key-investigation.mts; data in audit/data/cache-key-investigation/
tags: [scan, dedup, cache, correctness]
---

# Cache-key correctness investigation

Follow-up to [stateful-scan-dedup-v1](2026-05-12-stateful-scan-dedup-v1.md). Post-ship session evidence (cursor-session-85a6ca6c line 1208) suggested same-path different-querystring navigations on SPAs (Google Flights filter state) caused false dedup. Confirmed via side-channel CDP navigation that bypassed MCP's `navigate()` invalidation.

## Method

Each test pattern:
1. MCP `navigate(URL_A)` + `scan()` — cache populated with A's state under path-only key.
2. External CDP `Page.navigate(URL_B)` — page changes; MCP unaware.
3. MCP `scan()` — hits same path key, dedups against stale A.

Bug manifests when step 3's response uses dedup form (`No changes`, `← new`, `Unchanged — ...`) despite the page being a different state.

## Results

| Test | Step 3 output | Verdict |
|---|---|---|
| F-query (Google Flights `?q=SFO->NRT` → `?q=NYC->LON`) | `Elements: 47 (13 new, 13 changed, 13 gone, 21 unchanged)` | **bug confirmed** — 21 elements claimed unchanged on a different page |
| F-redir (Wikipedia `/wiki/USA`) | full emit, `dedup=false` | not confirmed (Wikipedia preserves requested URL; no client-side 301) |
| Control (`/wiki/Cat` → `/wiki/Dog`) | full emit, `dedup=false` | correct — different paths kept separate |

## Fix

`urlPathKey(url)` changed from `origin + pathname` to `origin + pathname + search`. Fragment still dropped.

Tradeoff:
- (+) SPA state changes via querystring no longer trigger false dedup.
- (-) URLs differing only in tracking params (`?ref=abc`) become different cache entries. Acceptable: those URLs rarely repeat per-session.

## Verification

Re-ran the investigation after fix. F-query step 3 now correctly emits full output (`Elements: 47`, no `← new/changed/gone` markers, no `Unchanged —` summary).

`dedup-v1-bench` re-run post-fix: cold avg 5080 (essentially unchanged from pre-fix 5050), idle -76.6%, post-action -81.9% — within run variance of the prior bench. No regression on the primary path.

## Source

- Script: `audit/cache-key-investigation.mts`
- Data + notes: `audit/data/cache-key-investigation/findings.txt`
- Implementation: `src/index.ts` `urlPathKey()`
