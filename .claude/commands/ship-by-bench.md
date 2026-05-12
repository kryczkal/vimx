# /ship-by-bench — Build data-first; the wiki is your platform

The webpilot loop. Frame the work as a stack of decisions; benchmark each non-trivial one against real sites before writing the code that bakes it in; validate the ship the same way. Every loop reads `wiki/` on entry and writes `wiki/` on exit — that's how decisions stay traceable across many small shipping rounds.

## Read first

1. **Discover prior context in `wiki/`.** Read `wiki/index.md`, the relevant hypothesis page if one exists, its linked benchmarks (for site sets and methodology to stay comparable with), linked decisions (what's in code now), and `wiki/principles/` (durable constraints). Use `/wiki-query <q>` when you don't know if prior work exists. **Bias toward updating an existing hypothesis over creating a parallel one.**

## The loop

2. **Frame as a stack of decisions.** Non-trivial work gets a `wiki/hypotheses/<slug>.md` upfront with `status: open` — predicted change, mechanism, measurable outcome, pass condition. The page is the work item; evidence accumulates as you go. For each decision the implementation will force, mark **trivial** (95% confident, or cheaply reversible) or **non-trivial** (multiple plausible options with real consequences). Trivial: just decide. Non-trivial: benchmark first.

3. **Plan each benchmark BEFORE coding.** Question in one sentence. 2-3 variants. The metric that *actually* answers the question. State the decision rule before seeing the data. Site count by impact: **small (5-10)** for narrow confirmation or regression checks; **mid (15-25)** for choosing between plausible options; **big (50-100)** for subtle effects in the long tail. Compute is cheap — go bigger when surprised.

4. **Run on real CDP, real sites.** Imagined sites lie. Always include the sites where the answer is least obvious. **Per-site numbers** — aggregates hide regressions.

5. **The data IS the decision.** Don't override with intuition. Ties → simpler option wins. Surprises mean the problem isn't what you thought — pause, look, revise the hypothesis page.

6. **File the benchmark at the moment of decision.** `wiki/benchmarks/YYYY-MM-DD-<slug>.md` — frontmatter, per-site table, the decision the data drove, raw data path (`audit/data/<slug>/`). Frozen on creation; never edit later, file a follow-up instead. Link from the hypothesis page's `evidence:`.

7. **Implement only what's decided — to the quality bar of the rest of the codebase.** "Narrow in scope, full in quality." Don't generalize speculatively (features the bench hasn't picked are future hypotheses, not unimplemented TODOs). Don't cut corners on the chosen path either — error handling, edge cases, comments, tests at the codebase's existing bar. Each shipped piece should stand alone as production-grade for its scope. In code, comment each decision with the benchmark it traces to (`see audit/data/<slug>/`).

8. **Validate the integrated ship.** Same site set, before vs after; per-site regression check. Noise-level regressions on tiny pages aren't blockers; small regressions on high-traffic shapes are. If surprises surface, iterate (bench → fix → bench) — each iteration gets its own benchmark page. **Common trap: the standalone-tested detector behaves differently when wired in. Always re-bench the integrated path.** File a v1 validation benchmark.

9. **Close the loop in `wiki/`:**
   - `wiki/decisions/<slug>.md` — `code_anchors`, why-this-over-alternatives (cite benchmarks), what was deferred.
   - Flip hypothesis status: `open → confirmed | refuted | superseded`, bump `last_verified`, append new evidence.
   - Deferred follow-ups → new `wiki/hypotheses/<slug>.md` with `status: open`. Don't bury in commit messages.
   - `wiki/log.md` — `## [YYYY-MM-DD] ship | <title>` + one-line summary + pages touched + any surprise worth remembering.
   - `wiki/index.md` — re-rank hypotheses, list new benchmark + decision.

10. **Commit with the win in the title.** `feat: X -83% / -89% (measured on 20 sites)` beats `feat: stateful scan`. Body lists deferred follow-ups (already filed as hypotheses) and links the wiki pages.

11. **Run `/wiki-lint` periodically** to catch staleness — `last_verified` > 60 days, broken `code_anchors`, orphan pages, findings contradicted by recent benchmarks.

## How the wiki ties it together

- **Hypotheses** = work items; status tracks progress.
- **Benchmarks** = data trail; frozen on creation.
- **Findings** = distilled claims with evidence; longer-lived than the bench that produced them.
- **Decisions** = what's in code now, with `code_anchors`.
- **Principles** = durable beliefs that survive pivots; promote sparingly.
- **Sessions** = context (cursor-export analyses, brainstorms, real agent runs).

**Read order**: index → hypothesis (status, evidence) → its benchmarks/sessions → linked decisions → relevant principles.
**Write order**: hypothesis draft → bench script → bench page → impl → ship bench → decision page → hypothesis status flip → log entry → index.

## Anti-patterns

- **Shipping without filing the bench.** Folklore in 30 days.
- **Filing the hypothesis at ship time.** It frames the work — file BEFORE running benches.
- **Aggregate-only reporting.** Per-site table or it didn't happen.
- **Picking sites that confirm the hypothesis.** Include the sites where the answer is least obvious.
- **"It's just 30 LOC, no need to measure."** Small changes ship wrong silently.
- **Trusting the standalone bench result.** The integrated path can regress in ways the isolated detector can't — run a `quick-regression`-style check after wiring in.
- **Burying deferred follow-ups in commit messages.** File as `status: open` hypotheses.
- **Editing a decision in place when its code changes.** Add a new decision and link forward; the chrome-strip arc (added → benchmark-validated → removed on principle) is the canonical example.
- **Reading "narrow in scope" as "cut corners on the chosen path."** Narrow means: skip features the bench hasn't justified. It does NOT mean: skip error handling, edge cases, or comments on the code you ARE shipping. Each piece should stand on its own at the codebase's existing quality bar — otherwise the accumulation becomes the set-of-MVPs failure mode.

## Philosophy

webpilot is a 3k-LOC tool. Architecturally clean means every decision in the code traces to a measurement, not an opinion. "Narrow in scope, full in quality" is the rule — not "minimum viable." The two failure modes to avoid are *over-building speculative features the bench hasn't justified* and *under-building the path the bench did pick*. The wiki + bench discipline is what keeps the accumulation coherent: linked decisions, traceable evidence, deferred work filed as hypotheses, principles surviving pivots. Without that cohesion mechanism, lots of small ships compound into a junk drawer. With it, they compound into a clean architecture that emerged from what was actually measured to matter.

If work happens outside the wiki, it didn't happen. If data has no wiki page, it doesn't exist for the next iteration. Real sites are the ground truth.
