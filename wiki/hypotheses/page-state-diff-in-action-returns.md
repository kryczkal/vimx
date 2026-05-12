---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: confirmed
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/verification-gap-after-actions.md, findings/agents-have-no-state-prediction.md, benchmarks/2026-05-12-anomaly-flag-action-returns.md]
tags: [action-returns, verification, anomaly]
---

## Confirmed 2026-05-12

Shipped — anomaly heuristics for `type` / `toggle` / `select`. Bench: 4/4 PASS, 0 false positives on 8 real sites. Decisions in [anomaly-flag-action-returns](../decisions/anomaly-flag-action-returns.md).

**Major surprise**: the bench surfaced that `cdpSelectAll` was silently broken (CDP modifier 8 = Shift, not Ctrl), meaning every `type(clear:true)` on a non-empty field actually produced `prior + typed`. This was the actual root cause of the Forms session 8bbfd98a "Option AOption 1" shipped-broken case. Fixed via DOM value-setter (`clearField`). See [clear-via-dom-not-keyboard](../decisions/clear-via-dom-not-keyboard.md).

The anomaly heuristic remains as a second layer of defense after the root-cause fix.

# Anomaly flagging in action returns

**Reframed 2026-05-12** (was: "Page-state diff in action returns"). Post-ship session 8bbfd98a showed: just *displaying* state diffs to the agent isn't enough — the agent saw `value="Option AOption 1"` in the `← changed` line and shipped a broken form anyway. The verification gap (Flaw 6) is downstream of how the agent processes info, not what info is shown.

The reframed principle: **the tool refuses silent failure**. When an action's observable outcome contradicts the action's intent, the response is `isError: true`, not a value readback. Agents can't pattern-match-and-ignore an error result the way they pattern-matched-and-ignored a status string.

## Concrete heuristics (narrow scope, full quality)

Three mutating actions, three different anomaly tests:

### type()
Capture `prior_value` before any clear/insert. After the type completes, compare `new_value` to `prior_value` and the typed `text`. Anomaly when:

```
clear=true AND prior_value != "" AND new_value.includes(prior_value)
                                AND new_value.length > text.length
```

This catches the Forms case exactly: `prior="Option 1"`, `typed="Option A"`, `new="Option AOption 1"`. `clear:true` was set but the prior content remained. Returns:

```
clear:true did not clear prior value 'Option 1' — value is now 'Option AOption 1' (typed 'Option A')
```

False-positive safety: requires `new.length > text.length`. An idempotent re-type (`prior="abc"`, `typed="abc"`, `new="abc"`) doesn't fire. An autocomplete extension where `prior=""` doesn't fire (no prior to detect). A type that genuinely extends content (`prior="abc"`, `typed="abcd"`) doesn't fire because `new.length == text.length`.

### toggle()
Pre-state and post-state are already extracted. Anomaly when:

```
pre_checked == post_checked   // toggle did nothing
```

Today this returns a readback; promoted to error. Real cases this catches: pressing a radio in a group that auto-reverts; toggling a disabled control; toggling something whose state is managed elsewhere and snaps back.

### select()
Already extracts both `selected` (requested) and `actual` (shown). Today returns OK with the discrepancy in the readback. Anomaly when:

```
result.selected != result.actual
```

## How to test

1. **Forms regression** — synthetic test: navigate to a typeable element with known prior value (via `evaluate` to set it). Call `type` with `clear=true` but use page-side JS to *append* instead of replace (simulating the bug). Verify the heuristic fires.
2. **False-positive sweep** — drive normal type/toggle/select on 10-15 real sites (Google search, GitHub, Reddit, Wikipedia search, Amazon, etc.). Count fires. Decision rule: **zero false positives** on common interactions, or the heuristic stays unshipped.
3. **Integrated session re-run** — replay session 8bbfd98a's Forms task on the post-ship build; verify the Option AOption typing trip would have errored out where it didn't before.

## Predicted outcome

Forms-style "shipped broken" failures become impossible: the type call returns an error, agent retries, breaks the loop. Verification gap (Flaw 6) closes for the three actions that account for ~80% of state-mutating calls in sessions.

## Risk

False positives could derail legitimate flows (autocomplete extensions, masked inputs, instant-formatting fields). Heuristic guards above limit the surface. Bench step #2 is the gate before ship.

## Source

Pushback 6 in pass 2 of [the 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md). Reframed from "show diffs" to "refuse silent failure" after evidence in [post-ship-dedup-edges](../findings/post-ship-dedup-edges.md) and the Forms shipped-broken case (cursor-session-8bbfd98a).
