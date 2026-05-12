---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/scanner.ts]
tags: [scanner, viewport, scan, architecture]
---

# scan() returns viewport-bound elements only

**The choice.** `scan()` filters to elements within the current viewport. Off-viewport elements are excluded from scan output. Off-viewport link navigation is handled separately via [URL annotation in read()](read-surfaces-link-urls.md).

**Why this over full-page scan.** Measured cost — see [2026-05-12-viewport-bound-vs-full](../benchmarks/2026-05-12-viewport-bound-vs-full.md):
- Avg +4,878 tokens per unbounded scan; worst case +41,911 (Amazon search) or +35,535 (Wikipedia/Cat)
- Per-session cost (5 actions): unbounded ~150–300k tokens; viewport-bound ~25k
- Unbounded scan degrades to a 2,857-item action menu on a single Wikipedia article — unusable

Off-viewport `<a>` tags are 52% of all anchors — the information matters. But routing it through `read()` URL annotation costs ~1/7th as much per session, and keeps `scan()` clean as the "current actions" surface.

**Architectural framing.** `scan()` is "what can I do right now"; `read()` is "what does this page contain". Off-viewport elements live in the latter category. Conflating them inflates scan and confuses the agent's mental model.

**Connection to principle.** [Abstract mechanics, not goals](../principles/abstract-mechanics-not-goals.md) — the tool's job is to surface affordances in the right shape. Scrolling to make an off-viewport element interactable is a web mechanic; the agent shouldn't have to choose between "scroll to it" and "scan for it" simultaneously.

**Source.** Code: `src/scanner.ts` SCANNER_JS `cropRectToVisible`. Benchmark: 99 sites in session `6b7a1271-2f98-4965-bac3-7cafe3273eb8`.
