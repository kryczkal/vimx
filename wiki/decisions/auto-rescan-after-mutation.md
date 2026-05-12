---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts, src/scanner.ts]
tags: [scan, design, mutation]
---

# Auto re-scan after mutating actions

**The choice.** Every mutating tool (`press`, `type`, `select`, `toggle`, `key`) returns a fresh scan inline in its response. The agent never has to call `scan()` after taking an action.

**Why.** Two reasons:
1. Agents reliably forget to re-scan, ending up with stale state in mind.
2. When they do re-scan, it's an extra tool call — adding latency and tokens.

Auto-rescan eliminates both. Per [the 2026-05-12 analysis](../sessions/2026-05-12-cursor-export-17-sessions.md): "Out of ~110 webpilot tool calls in session 19e1a97a, only 35 were explicit scans — the rest happened automatically." The implicit rescan is doing real work.

The auto-rescan also enables a `NEW:` block: elements that didn't exist in the prior scan but appear in the new one (typically modal contents, newly-revealed dropdowns). Sessions show agents directly targeting `NEW:` elements on the next call — exactly the affordance the block was meant to surface.

This makes the agent's loop `action → react`, not `action → re-scan → react`. One fewer step per turn over a 50-100-turn session is significant.

**Compatible improvements.** [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md) would make the auto-rescan return a diff instead of a full scan, reducing redundancy further. They compose cleanly: auto-rescan is *when*, dedup is *what*.

**Connection to principle.** Auto-rescan is web-mechanic abstraction: pages mutate, the tool tracks that, the agent doesn't have to. See [abstract-mechanics-not-goals](../principles/abstract-mechanics-not-goals.md).

**Source.** Inherent to the design — see `src/index.ts` post-action handling and the `NEW:` block formatter. Predates the wiki.
