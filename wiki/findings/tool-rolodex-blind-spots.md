---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [tool-use, hover, key, expand, agent-loop]
---

# Tool-rolodex blind spots

**Claim.** Even when the right vimx tool exists for a situation, agents systematically don't reach for it. The default toolbelt is `press / type / scan / read / navigate`. Everything else (`hover`, `key`, `expand`, `select` on non-`<select>`) is a last resort, often discovered only after several failures.

**Evidence.**
- `hover` is almost never used across the 10 vimx sessions — even on pages with explicitly hover-revealed UI (Amazon row-actions, flight-result detail overlays). Vimium's whole *raison d'être* (revealing hover-only menus) is unexercised.
- `key` is used reactively for `escape` after a modal is in the agent's face; it's almost never used *proactively* for keyboard navigation in custom widgets until everything else has been tried. See [custom-widget-thrash](custom-widget-thrash.md).
- `expand` is mentioned by name in scan output (`... N more — scroll() or expand("label")`) but agents still try `scroll` first roughly half the time.
- `select` is sometimes invoked on non-`<select>` elements (Google Forms listbox in d1f51c1a). The error response is clean but the attempt itself is a wasted turn.

**Implication.** Two distinct mechanisms could close this:
- **Surface the right tool at the right scan element.** If a PRESS element is actually a hover-target (only emits sub-elements on `mouseenter`), the scan entry could be annotated `→ hover() to reveal menu`. If a TYPE element is part of a custom combobox, annotate `→ key("arrowdown") to navigate options`.
- **Stuck-state hints.** After 2+ failed actions on the same target, the next tool response could append a tool-rolodex line: `Tried: press, scroll. Consider: hover, key, expand.`

Not yet filed as a hypothesis on its own — the impact overlaps with [predicted-effect-annotations](../hypotheses/predicted-effect-annotations.md) and [custom-widget-thrash](custom-widget-thrash.md). Worth filing if those don't close the gap.
