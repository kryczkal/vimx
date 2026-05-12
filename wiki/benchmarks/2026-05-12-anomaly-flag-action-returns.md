---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: audit/anomaly-flag-bench.mts
tags: [type, toggle, select, verification, anomaly]
---

# Anomaly-flag in action returns (type / toggle / select)

Validates hypothesis [page-state-diff-in-action-returns](../hypotheses/page-state-diff-in-action-returns.md) (reframed as: *tool refuses silent failure*). Three heuristics shipped across the three mutating actions that already had readback state.

## The bigger surprise — what the bench actually discovered

Investigation revealed that `cdpSelectAll` was silently broken since it was written. CDP modifier `8` (used by the function) is `Shift`, not `Ctrl`. The function was dispatching `Shift+a` (uppercase A) instead of `Ctrl+A` (select all). The effect on `type(clear:true)`:

```
prior value: "Option 1"        | clear:true was set
1. cdpClick → cursor at end    | value: "Option 1"
2. cdpSelectAll → "A" typed    | value: "Option 1A"
3. cdpBackspace → delete one   | value: "Option 1"
4. cdpType("Option A") inserts | value: "Option 1Option A"
```

This is **exactly** the Forms session 8bbfd98a "Option AOption 1" shipped-broken pattern. The bug had been silently producing prior+typed concatenations for every `type` call with `clear:true` on a non-empty field.

Real-site sessions mostly typed into empty search bars (prior=""), where `clear` is a no-op — so the bug was invisible in the existing benchmarks.

Fix: replace `cdpSelectAll + cdpBackspace` with `clearField()` — direct DOM value-setter call dispatched as input+change. Covers `<input>`, `<textarea>`, contenteditable. Works against controlled React/Vue components via prototype-descriptor setter.

## Heuristics

**type()**: capture `prior_value` before clear. After type completes, anomaly if `clear=true AND prior != "" AND new.includes(prior) AND new.length > typed.length`. The length guard prevents false positives on idempotent re-types.

**toggle()**: snapshot pre-state before click. Anomaly if `preState === postState` — the click didn't flip the control.

**select()**: SELECT_JS already extracts `selected` (requested) and `actual` (shown). Anomaly if they differ — previously surfaced as info, now an error.

## Bench results

Four tests, all PASS:

| Test | Result | Output |
|---|---|---|
| SYN-type-bad (stubborn contenteditable with MutationObserver restoring text) | PASS | `clear:true did not clear prior value 'Option 1' — value is now 'Option AOption 1' (typed 'Option A')` |
| SYN-type-idempotent (normal input, type same value as prior with clear:true) | PASS | no error, value unchanged correctly |
| SYN-toggle-noop (checkbox with `preventDefault` on click) | PASS | `toggle [0]: state did not change (was ○ unchecked, still is)` |
| FP-sweep (8 real-site search bars: Google, GitHub, Wikipedia, DuckDuckGo, HN, Reddit, Amazon, Stack Overflow) | PASS | 0 false positives |

## Dedup regression check

Re-ran dedup-v1-bench after the clearField fix:
- cold scan: avg 5124 chars
- idle re-scan: -82.0% reduction
- post-action: -87.7% reduction
- 20/20 sites passed, no new failures

## Source

- Script: `audit/anomaly-flag-bench.mts`
- Implementation: `src/index.ts` (search "clearField", "type [", "toggle [", "select [")
- Synthetic test pages: data: URLs inline in the bench script
