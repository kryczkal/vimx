---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts]
tags: [type, toggle, select, verification, error]
---

# Anomaly-flag action returns (type / toggle / select)

**The choice.** When the observable outcome of an action contradicts the action's intent, the response is `isError: true` (via `aerr()`) — not a value readback. The agent can't pattern-match-and-ignore an error result the way it ignored a value readback (Forms 8bbfd98a shipped-broken case).

Three heuristics live in three handlers.

## type()
After insert completes, if `clear=true AND prior != "" AND new.includes(prior) AND new.length > text.length` → return error.

The length guard means idempotent re-types (`prior="abc"`, `typed="abc"`, `new="abc"`) and legitimate extensions (`prior="abc"`, `typed="abcd"`, `new="abcd"`) don't fire. Only cases where the new value contains BOTH the prior content AND the typed text combined trigger.

## toggle()
Snapshot pre-state before click. After click, if `preState === postState` → return error. Catches checkboxes/radios that were prevented from changing (preventDefault on click, disabled-but-not-marked, controlled state that snapped back).

## select()
SELECT_JS already extracts `selected` (requested option) and `actual` (currently-shown option). If they differ after the set → return error. Previously surfaced as info in the OK readback.

**Why.** Hypothesis page-state-diff-in-action-returns was originally framed as "show the agent more diffs in action returns." Post-ship session 8bbfd98a showed that *showing* verification info isn't enough — the agent saw `value="Option AOption 1"` in a `← changed` line and shipped the broken form anyway. Information presented as readback can be pattern-matched-and-ignored. Information presented as `isError: true` interrupts the action loop.

Aligns with `abstract-mechanics-not-goals`: the tool encodes "did the action achieve what was asked," not just "did I dispatch the event."

**Why not other options.**

- **Show diffs without erroring.** Failed in 8bbfd98a — agent ignored the visible bug. Decisively refuted.
- **Anomaly check on `press()` too.** Too risky for v1 — many legitimate presses produce no scan-detectable change (scroll-to-anchor, modal open, async navigation). False-positive rate would be high. Deferred.
- **Strict equality (`new == typed`).** Would false-positive on autocomplete and input formatting (`type "go"` → autocompleted "google"; `type "1234567890"` → "(123) 456-7890"). The current heuristic is more conservative.

**Tradeoffs.**

- The heuristic is conservative — it'll miss some real failures where the bug doesn't take this exact shape. That's accepted; better than false positives that would derail legitimate flows.
- Together with the [clear-via-DOM fix](clear-via-dom-not-keyboard.md), this is two-layer defense: the root-cause bug is gone, and if any other clear-failure case surfaces in the wild, the heuristic catches it.

**Bench evidence.** [2026-05-12 anomaly-flag bench](../benchmarks/2026-05-12-anomaly-flag-action-returns.md) — 4/4 PASS:
- SYN-type-bad (contenteditable that restores via MutationObserver): heuristic fires correctly.
- SYN-type-idempotent (normal type cycle): no false positive.
- SYN-toggle-noop (`preventDefault` on click): heuristic fires correctly.
- FP-sweep (8 real-site search bars): 0 false positives.

**Source.** Shipped 2026-05-12. Implementation in `src/index.ts` (search for "Anomaly: " comments in the type/select/toggle handlers).
