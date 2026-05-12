---
created: 2026-05-11
last_verified: 2026-05-11
type: benchmark
source: claude-code session 464ca9cc-fd3b-4dc1-8ffc-b4324b51636c
tags: [performance, cdp, latency, observe-before-act]
---

# Sleep/debounce removal — observe-before-act via CDP events

**Tested.** Coordinated timing changes:
- Mutation debounce 400ms → 80–100ms
- Removed pre-scan sleeps (300ms in press/scroll, 100ms in key)
- Removed redundant 300ms post-navigation sleeps in `cdp.ts`
- Replaced heuristic navigation detection with CDP `Page.frameNavigated` events

**Sites.** example.com, Wikipedia, Hacker News, GitHub, Google Search.

**Metrics — old → new latency per tool call.**
- `navigate`: 822–1723ms → 323–1357ms (1.0–2.5×)
- `scan`: 410–435ms → 90–135ms (3.1–4.6×)
- `key`: **156–160ms → 4–5ms (29–43×)**
- `scroll`: 709–784ms → 88–120ms (6.2–8.4×)
- Element counts identical across all sites (zero functional regressions)
- 60-call session cumulative: **~21s wall-time saved (~10%)**

**Conclusion.** Validated. The `key` speedup is the cleanest signal — the 150ms drop matches the two removed sleeps exactly.

**Notes.** Predictions from cursor-export latency analysis were conservative; actual per-call gains exceeded estimates. Pattern: defensive sleeps assume worst-case settle time; CDP events report when something actually happened. The latter is faster in steady state and at least as safe.

**Source.** Session `464ca9cc-fd3b-4dc1-8ffc-b4324b51636c`. Code: `src/cdp.ts` (removed 300ms sleeps in navigation/dialog paths), `src/index.ts` (observe-before-act, reduced debounce, CDP event listeners). Decision: [observe-before-act-cdp-events](../decisions/observe-before-act-cdp-events.md).
