---
created: 2026-05-12
last_verified: 2026-05-12
type: principle
tags: [methodology, evidence, design]
---

# Benchmarks validate safety; principles decide direction

**Claim.** A benchmark answers "is this change safe?" — measuring regressions, metric shifts, side effects. A principle answers "should we make this change at all?" — judged against architectural commitments. The two are orthogonal. A change can be benchmark-validated (no regressions, real gain) and still be the wrong move on principle, or vice versa.

**Why this persists across pivots.** Both kinds of evidence will keep showing up. The temptation is to collapse them — to treat a clean benchmark as proof a change should ship, or to treat a principle violation as proof a change is broken. Neither holds. They answer different questions and need to be reconciled explicitly.

**Concrete case — the chrome-strip arc.** See [2026-05-11-chrome-strip-validated](../benchmarks/2026-05-11-chrome-strip-validated.md) and [chrome-strip-removed](../decisions/chrome-strip-removed.md).

- The benchmark across 70 sites: 2.8% savings, zero regressions. Verdict: *safe to ship*.
- The principle [abstract-mechanics-not-goals](abstract-mechanics-not-goals.md) (in its "informed > filtered" expression): the tool shouldn't guess what's relevant for the agent. Verdict: *don't ship*.
- The principle won. The feature was added in commit `9f31cdc` on the strength of the benchmark, then removed in commit `1e916e6` on the strength of the principle.

This isn't a contradiction. The benchmark answered "does this break anything?" — no. The principle answered "is this the right division of labor between tool and agent?" — no, that decision belongs to the agent's regex, not to the tool's pre-filter. Different question, different answer.

**How to apply.**
1. Benchmark the change. Confirm safety.
2. Check it against principles. Confirm direction.
3. **Both must pass.** A benchmark-clean change that violates a load-bearing principle is still the wrong move — document the tension and rebuild the decision around the principle.

**Tension to watch.** It is easy to dismiss principles when a benchmark looks good — the numbers feel concrete; principles feel abstract. The chrome-strip arc is a counterexample where the principle was the right call even with measurement on the other side. Be willing to remove a feature that benchmarks well if it violates how the tool should be carved up.
