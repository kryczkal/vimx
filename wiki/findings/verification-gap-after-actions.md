---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [action-returns, verification, perception]
---

# Verification gap after actions

**Claim.** After most actions, agents cannot tell whether the action succeeded in any non-trivial way. Tool returns describe element-level deltas but not page-level state changes (URL, title, headings, badge counts, modal open/close). Agents move forward uncertain.

**Evidence.**
- Session 5a47ec04: "Taylor was either removed successfully or the removal failed, but the result is 10 tracks." Direct quote from the agent's own thinking.
- Across all 17 sessions, the only reliable verification signal is URL/title change after `navigate`. Beyond that, verification is sporadic.
- vimx already surfaces `Value now: "..."` after `type()` and explicit state after `toggle()` / `select()`. The gap is `press()` — the highest-frequency action, and the one whose effects are most variable.

**Implication.** Hypothesis: track page-state signals (URL, title, h1, badge counts, modal-present) and surface diffs after every action that could change them — see [page-state-diff-in-action-returns](../hypotheses/page-state-diff-in-action-returns.md). Without a verification channel, no amount of better perception fixes the agent loop, because the agent can't close the loop on its own work. This finding is the direct cause of much of [agents-have-no-state-prediction](agents-have-no-state-prediction.md): even if the agent *did* predict, it can't compare prediction to outcome without state-diff feedback.
