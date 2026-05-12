---
created: 2026-05-12
last_verified: 2026-05-12
type: principle
tags: [philosophy, design, contract]
---

# Abstract mechanics, not goals

**Claim.** The tool abstracts away the *implementation mechanics* of the web (DOM, selectors, frames, shadow DOM, stale element refs, click obscuration, scroll-into-view). It does NOT abstract away *task semantics* (what the agent wants to accomplish). The agent brings full semantic knowledge; the tool brings full implementation knowledge.

The wrong framing is "the agent needs 0 web knowledge." That collapses into either an omniscient tool (impossible) or a generic one (loses leverage).

The right framing is **0 implementation knowledge, full semantic knowledge.** The agent says "press the Save to playlist button on row 3." The tool resolves DOM, retries on stale refs, surfaces obstructions, returns state diffs. The contract is at the semantic layer, not the goal layer.

**Why this persists across pivots.** This sits upstream of any specific scan format or tool surface. Whether we group by affordance, by semantic landmark, or by something not yet invented, the load-bearing distinction is *who owns what* in the contract. Pivots can change the surface; this principle constrains them.

**Concrete present-day expressions.**
- Affordance-typed tools (`press` / `type` / `select` / `toggle`) — the agent picks WHICH element; the tool enforces HOW. See [affordance-grouping-over-dom-hierarchy](affordance-grouping-over-dom-hierarchy.md).
- `resolveElement` retry-after-rescan for stale refs — the agent never thinks about ref staleness.
- Element references in `window.__webpilot[]`, not CSS selectors — the agent never writes a selector.
- Auto re-scan after mutations — see [auto-rescan-after-mutation](../decisions/auto-rescan-after-mutation.md). The agent never asks "did the page change?" before its next action.
- `cleanHref` strips tracking junk from URLs — the agent doesn't need to know that `&aax_…&qid=…&ref=…` is noise.

**Tensions to watch.**
- Adding *task-aware* behavior to the tool (e.g. `scan(intent="...")` reranking — proposed in the 2026-05-12 analysis) drifts toward semantic-layer ownership by the tool. Acceptable as a re-ranker; not as a filter. The failure mode "tool hid the thing the agent needed" is catastrophic.
- Adding *meta-state detection* (cookie banners, sign-in walls — also proposed) is the *other* direction: it stays on the mechanics side ("the page has an interstitial blocking content"), not the semantics side. Worth doing because banner-handling is web-mechanic noise, not task content.
- The line is fuzzy in practice. When unsure, ask: *does this hide something the agent might semantically want, or does it normalize something mechanically extraneous?* If the former, it belongs to the agent. If the latter, it belongs to the tool.

**Source.** Crystallized in pass 2 of [the 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md) ("Pushback 1: 'Agent needs zero web knowledge' is wrong as a north star"). Validated by the 17-session evidence that agents do reason cleanly in `[id] tag "label"` lexicon while abandoning DOM thinking — they want semantic surfaces, but they bring semantic intent themselves.
