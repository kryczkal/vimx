---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/agents-have-no-state-prediction.md, findings/custom-widget-thrash.md]
tags: [scan, prediction, agent-loop]
---

# Predicted-effect annotations on scan elements

**Predicted change.** Annotate each scan entry (especially PRESS) with a heuristically-inferred effect — what's likely to happen if the agent activates this element. Strictly advisory, never breaking.

Example output:
```
PRESS → press(element)
  [54] button "Save" → submits_form
  [78] button "Action menu" → opens_menu
  [120] a "Save to playlist" → opens_modal
  [177] input "Public" → opens_combobox  (use key("arrowdown") to navigate)
  [400] button "Select flight" → navigates_to /booking/passenger
```

**Mechanism.** During scan classification, infer effect by signals:
- `<a href=...>` → `navigates_to: <path>` (strip origin if same-host).
- `<button type="submit">` or inside a `<form>` → `submits_form`.
- `aria-haspopup="menu"` / `aria-expanded="false"` → `opens_menu` (and surface keyboard hint).
- `aria-controls` pointing to a `[role="dialog"]` or hidden modal → `opens_modal`.
- Inside a `[role="dialog"]` with class/aria suggesting close (`aria-label="Close"`, common close-button patterns) → `closes_dialog`.
- `role="combobox"`, `role="listbox"`, or `<select>` styled as div → `opens_combobox`.
- Otherwise → omit (don't bluff).

**Predicted outcome.** Two effects:
1. **Predictive perception.** Agents start writing "expected X, got Y" in thinking traces. Anomaly detection improves (see [agents-have-no-state-prediction](../findings/agents-have-no-state-prediction.md)).
2. **Custom-widget thrash drops.** The privacy-dropdown saga in 5a47ec04 doesn't happen if scan tells the agent `[177] input "Public" → opens_combobox  (use key("arrowdown"))` upfront. See [custom-widget-thrash](../findings/custom-widget-thrash.md).

**How to test.**
1. Implement classifier behind a flag.
2. Re-run a curated subset of session tasks that exhibited widget-thrash or wrong-button picks.
3. Measure: (a) widget-thrash turn count, (b) agent's use of predicted effects in subsequent reasoning, (c) anomaly detection rate when a click does something unexpected.
4. False-positive sweep: when the classifier emits an effect that doesn't fire, does the agent get more confused than baseline? Mitigate by being conservative (omit > guess).

**Risks.**
- A wrong prediction is worse than no prediction if the agent trusts it blindly. Mitigation: classifier only emits when signal is strong (explicit ARIA or href present); never infers from element name alone.
- Token cost: each annotation adds ~10-20 chars per PRESS element. Worth it only if it reduces downstream turn count by more than it adds.

**Related.** Pushback 5 in the 2026-05-12 analysis. Ranked #5 in the high-leverage hypothesis list there. Composes well with [semantic-landmark-grouping](semantic-landmark-grouping.md): once elements are landmark-grouped, the predicted effect plus the region gives agents enough context to plan ahead without rescanning.
