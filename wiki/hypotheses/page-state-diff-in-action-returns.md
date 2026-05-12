---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/verification-gap-after-actions.md, findings/agents-have-no-state-prediction.md]
tags: [action-returns, verification]
---

# Page-state diff in action returns

**Predicted change.** After every mutating action (`press`, `type`, `toggle`, `select`, `key`), include a page-state diff: URL change, title change, h1 change, badge/count changes, modal open/close, focus shift. Currently we surface element-level deltas (`NEW:` block) but not page-state-level changes.

**Mechanism.** Snapshot a small page-state object before and after each action:
```
{
  url, title, h1_text, modal_present, focused_element,
  badge_counts: { cart: 2, notifications: 0, ... }   // ARIA-derived where possible
}
```
Diff and emit non-empty changes:
```
Pressed [400] "Select flight".
State changes:
  URL: /flights?... → /booking/passenger
  Title: "Choose a flight" → "Passenger details"
  Heading: "Choose a flight" → "Tell us about you"

NEW:
  [29] input[text] "First name"
  ...
```

**Predicted outcome.** Near-zero "did my action work?" reasoning in agent thinking. Agents start chaining actions confidently because they can verify each step in O(1) tokens. Closes the deepest part of the verification gap.

**How to test.**
1. Implement against a fixed set of tasks where verification failures are documented (e.g. session 5a47ec04's "either removed or not" moment).
2. Re-run, look for the agent now explicitly noting state changes in its reasoning.
3. Confirm: fewer uncertain-outcome statements in agent thinking; fewer redundant re-scans to confirm action effects; the silent-redirect cases (session a1775a65) get caught.

**Risk.** Badge/count heuristics are fragile and site-specific. Mitigation: start with the unambiguous signals (URL, title, h1) and add badge tracking via ARIA `aria-live` regions / `role="status"`, which are well-specified.

**Source.** Pushback 6 in pass 2 of [the 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md). One of the two changes recommended to build first.
