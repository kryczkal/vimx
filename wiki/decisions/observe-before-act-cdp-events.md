---
created: 2026-05-11
last_verified: 2026-05-11
type: decision
code_anchors: [src/cdp.ts, src/index.ts]
tags: [cdp, performance, latency, sync]
---

# Observe before act — CDP events instead of defensive sleeps

**The choice.** Webpilot does not sleep defensively before or after tool calls. Instead it listens for CDP events (`Page.frameNavigated`, DOM mutation signals) and proceeds when the relevant signal fires. Mutation debounce is tight (80–100ms), not loose (400ms).

**Why this over defensive sleeps.** Defensive sleeps are pessimistic — they assume worst-case settle time. CDP events are observational — they report when something actually happened. Measured impact — see [2026-05-11-sleep-debounce-cdp](../benchmarks/2026-05-11-sleep-debounce-cdp.md):
- `key`: 156–160ms → 4–5ms (**29–43×**)
- `scan`: 410–435ms → 90–135ms (3.1–4.6×)
- `scroll`: 709–784ms → 88–120ms (6.2–8.4×)
- `navigate`: 822–1723ms → 323–1357ms (1.0–2.5×)
- 60-call session: ~21s cumulative (~10% of wall time)
- Element counts identical across all sites — zero functional regressions

The `key` speedup is the cleanest validation — 150ms drop matches the two removed sleeps exactly.

**Tradeoff.** Slightly more code complexity (CDP listener wiring, debounce coordination). In exchange: order-of-magnitude latency improvement on the hottest tool paths. Worth it.

**Connection to principle.** [Abstract mechanics, not goals](../principles/abstract-mechanics-not-goals.md). Page-settle timing is a web mechanic; the tool owns it. The agent never thinks about "wait long enough."

**Source.** Code: `src/cdp.ts` (removed 300ms sleeps), `src/index.ts` (observe-before-act pattern, reduced debounce, CDP event listeners). Benchmark: session `464ca9cc-fd3b-4dc1-8ffc-b4324b51636c`.
