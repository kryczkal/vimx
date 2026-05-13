---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [agent-loop, perception, prediction, verification]
---

# Agents have no state prediction

**Claim.** Agents using both vimx and playwright run a reactive perceive→act loop. They don't form predicted outcomes before acting, so when reality diverges from what should have happened, no signal fires. Anomalies are silently absorbed into the next state.

**Evidence.**
- Zero of 17 sessions show the agent writing a predicted outcome before an action.
- Session a1775a65: agent navigated to a Madison Square Garden venue URL and got silently redirected to "Club Xscape - Salt Lake City". The navigation return's page title clearly said "Salt Lake City", but the next call assumed it was still on MSG. The signal was present; the agent had no slot for it.
- Session 19e1a97a: scrolling closed Google Flights' filter modal (a quirk of that UI). The agent didn't notice the dismissal until it tried to interact with a no-longer-present element two turns later.
- Session 5a47ec04: "Taylor was either removed successfully or the removal failed, but the result is 10 tracks." The agent could not assess its own action's outcome at all.

**Implication.** This is the deepest gap in agent UX of both tools. It's downstream of two things: (1) impoverished feedback channels (tool returns describe what's there but not what changed); (2) no scaffold prompting prediction. Two distinct lines of attack:
- **Tool-side**: surface state diffs explicitly after each action — see [page-state-diff-in-action-returns](../hypotheses/page-state-diff-in-action-returns.md).
- **Agent-side**: optional `predict=` parameter on action verbs so the agent declares what it expects; the tool reports the actual-vs-predicted gap. Open hypothesis, not yet filed.

This finding subsumes flaws 1, 3, 6, and 10 from the source session — they're all manifestations of the same hole.
