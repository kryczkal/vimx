---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts]
tags: [read, perception]
---

# read() no longer strips chrome (nav/footer/aside)

**The choice.** `read()` returns the full document innerText. Previously it stripped `<nav>`, `<footer>`, `<aside>` to reduce noise. That stripping has been removed.

**Why.** **Informed > filtered.** Stripping was the tool guessing about what's "not relevant" — and it was sometimes wrong. Nav menus contain breadcrumbs, search affordances, and important state cues; footers carry legal context that occasionally matters. The agent has the regex filter (see [read-filter-is-regex](read-filter-is-regex.md)) to narrow down what it actually reads. The tool's job is to give the agent the full picture and let the agent decide what to focus on.

This is [abstract-mechanics-not-goals](../principles/abstract-mechanics-not-goals.md) in action: implementation mechanics (innerText extraction) belong to the tool; semantic relevance (what's worth reading on this page for this task) belongs to the agent.

**Source.** Commit `1e916e6` ("fix: read() no longer strips `<nav>`/`<footer>`/`<aside>`"). Originally introduced by `aec5902`; the rationale for stripping turned out to be wrong.

**Tension noted in the 2026-05-12 analysis.** Chrome redundancy in `scan` output is a separate problem (see [chrome-redundancy-floods-scan-output](../findings/chrome-redundancy-floods-scan-output.md) and the [stateful-scan-chrome-dedup](../hypotheses/stateful-scan-chrome-dedup.md) hypothesis). Don't confuse the two: removing chrome from `read()` was the right move (full text, agent filters); collapsing chrome in repeated `scan()` is also right (stateful, dedup what the agent has already seen). Both are forms of "informed > filtered" applied to different surfaces.

**The full arc — benchmark validated, principle removed.** The chrome-strip feature was added in commit `9f31cdc` on the strength of [2026-05-11-chrome-strip-validated](../benchmarks/2026-05-11-chrome-strip-validated.md): 70 sites, 2.8% savings, zero regressions. The benchmark cleanly answered *is it safe to ship?* — yes. But the principle answered a different question: *should the tool be guessing what's relevant for the agent?* — no. That question was answered by commit `1e916e6`, which removed the feature. The canonical case for [benchmarks-validate-principles-decide](../principles/benchmarks-validate-principles-decide.md).
