---
created: 2026-05-12
last_verified: 2026-05-12
type: principle
tags: [scan, design, affordance, type-system]
---

# Affordance grouping over DOM hierarchy

**Claim.** Group scan output by what the agent can DO with each element (press / type / select / toggle), not by what the element IS (button / input / div) or where it sits in the DOM tree. Affordance grouping IS the type system: it forces the right verb at the API surface.

**Why this persists across pivots.** The agent's atomic act is *deciding what to do next*. The scan output's job is to make that decision easy. Affordance groups present elements pre-filtered to the actions the agent is choosing between — eliminating the "what kind of element is this, what verb should I use" step. Playwright sessions show what happens without it: agents drop into `evaluate(...)` to probe element shapes (`for (const r of ['menuitem','menuitemcheckbox','option','listitem'])`) before they can act. Reasoning quality drops immediately.

The data is unambiguous: agents pick the right verb when the group makes the affordance explicit. The toggle/select/press confusion that Playwright sessions show is mostly absent in vimx.

**Concrete present-day expressions.**
- `scan()` groups output under PRESS / TYPE / SELECT / TOGGLE headers.
- Tool functions are affordance-typed: `press(id)`, `type(id, text)`, `select(id, value)`, `toggle(id)`. You cannot call `press` on a `<select>` and get a confusing error — the affordance group has already excluded it.
- Source: `src/scanner.ts` — classification heuristics derived from Vimium's `link_hints.js` and `dom_utils.js`.

**Compatible improvements** (refine, don't violate):
- *Semantic landmark grouping* (open hypothesis): add an outer grouping by semantic region (`Main: Results`, `Modal: All filters`) on top of inner affordance groups. The two axes are orthogonal — region tells you WHERE, affordance tells you WHAT.
- *Predicted-effect annotations* (open hypothesis): annotate PRESS elements with what they likely do (`opens_menu`, `submits_form`). Refines the affordance type, doesn't replace it.

**Tensions to watch.**
- When an element is genuinely ambiguous (e.g. a `<div>` with `role="button"` that opens a custom dropdown), affordance grouping has to commit. Currently this surfaces as `press` failures followed by agent thrash on custom widgets (the YouTube Music privacy dropdown is the canonical example — see the source session for the 6-step recovery sequence).
- The right move is *refining classification* (detect `aria-haspopup`, `aria-expanded`, `role="combobox"` and route to a `select`/keyboard-aware affordance), not *abandoning the principle*.
- If a single element has multiple affordances (e.g. a contenteditable that can be both pressed and typed into), the scanner has to surface that — possibly by listing the element in multiple groups with an explanatory tag. Open design question.

**Source.** Confirmed by the 2026-05-12 analysis ("Vimx wins for the common case... affordance grouping IS the type system. The auto-rescan kills a whole class of stale-state bugs."). One of the foundations of the project per `CLAUDE.md`: "Affordance-typed tools: press/type/select/toggle — structurally impossible to misuse."
