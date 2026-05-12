---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-token-cost-measurement.md]
tags: [scan, token-economy, perception, auto-rescan]
---

# Perception is ~half the session, and auto-rescan dominates explicit scan

**Claim.** Across the 10 webpilot-dominant cursor sessions, **~49.5% of all bytes are scan-formatted output** — the agent's perception channel. Of that perception spend, only ~25% comes from explicit `scan()` calls; the remaining ~75% comes from the auto-rescan that ships inline with every mutating tool's return. **`press` alone is the largest single byte consumer in any session.**

**Evidence (measured 2026-05-12).** Full table in [sessions/2026-05-12-token-cost-measurement.md](../sessions/2026-05-12-token-cost-measurement.md). Across 2,323,369 total chars in 10 sessions:

| Tool emitting scan output | Calls | Total bytes | % of session |
|---|---|---|---|
| `press` (action + auto-rescan) | 125 | 479,107 | **20.6%** |
| `navigate` (action + auto-rescan) | 98 | 309,984 | 13.3% |
| `scan` (explicit) | 57 | 283,796 | 12.2% |
| `scroll` (action + auto-rescan) | 22 | 75,995 | 3.3% |
| Other scan-emitters (toggle/hover/dialog/switch_tab) | small | <1,000 | <0.1% |
| **TOTAL scan-formatted output** | — | **~1,148,882** | **~49.5%** |

For comparison, the next largest categories: `read` returns 332,749 bytes (14.3%); `read_file_v2` (mostly schema bootstrap) 264,322 bytes (11.4%); non-tool prose (agent reasoning + user + separators) 558,543 bytes (24.0%).

**Why this matters.** Two consequences:

1. **The compression target is wider than "the `scan` tool".** A chrome-dedup that only triggers on explicit `scan()` calls hits 12% of session bytes. The same dedup applied across all scan-emitting tools hits ~50%. The hypothesis [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md) must scope to all scan-emitters to capture the realistic ceiling.

2. **Action-return scan output is inherently DIFFERENT from explicit-scan output.** Explicit scans happen at agent-chosen moments — the agent often wants a full picture. Auto-rescans happen after every action — the agent wants confirmation + new affordances. The format requirements may diverge: action-return scans can be more aggressive about collapsing unchanged chrome since the agent's mental state was just refreshed by the action being explicit. Explicit scans may need to surface more.

**Calibration caveat.** Measurements are over **pre-viewport-bound-scan sessions** ([decisions/viewport-bound-scan.md](../decisions/viewport-bound-scan.md)). Current code emits substantially less per scan. The 49.5% figure represents the historical baseline; current emission is smaller. The *ratio* between auto-rescan and explicit scan (~3:1) should be more stable post-viewport-bound, but is not yet re-measured.

**Implication.**
- Update [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md) to explicitly scope to all scan-emitters.
- The action-rescan vs explicit-scan distinction may justify separate dedup policies. Worth flagging at hypothesis-design time.
- A "perception budget" framing — what fraction of a session SHOULD be perception? — could become a benchmark metric. Likely target: <30% with stateful dedup.
