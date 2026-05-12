# webpilot wiki — operating manual

This wiki accumulates the project's knowledge as it iterates: hypotheses about agent UX, session analyses, benchmark findings, design decisions in code, and durable meta-principles. Its primary purpose is to stay honest about what we currently believe vs. what's gone stale — the tool evolves fast, and most claims have a half-life.

The general pattern is in `IDEA.md`. This file is the project-specific instantiation.

## Domain

webpilot is an AI-agent-native MCP server for browser automation. The iteration loop is:

  **hypothesis → test (session analysis or benchmark) → finding → decision (in code) → sometimes a principle**

Every page belongs to one of those stages. Mixing them is what makes wikis rot, because evidence has a different lifetime than conclusions: a benchmark measurement is true on the date it was taken; a finding extracted from it may persist longer; a principle distilled from many findings should survive pivots.

The system's job is to keep those distinct, so when the tool changes we can re-check the right layer and propagate forward without losing the historical record.

## Where things live

Raw artifacts (immutable, outside `wiki/`):
- `../audit/` — benchmark scripts, raw measurement output
- `../src/` — the tool itself; commit history is the source of truth for "what changed"
- session transcripts — outside the repo (e.g. `~/Projects/cursor-export/exported/`)

Inside `wiki/`:
- `sessions/` — date-prefixed, frozen-in-time analyses of real agent sessions. Once written, never edited; they are the historical record. Use the date the analysis was *run*, not when the session occurred.
- `benchmarks/` — frozen-in-time benchmark writeups, linked to scripts in `../audit/`.
- `findings/` — distilled insights extracted from sessions/benchmarks. One claim per page, with evidence and implications. Updated when new evidence reinforces or challenges them.
- `hypotheses/` — testable predictions with a measurable outcome. Status field tracks open / testing / confirmed / refuted / superseded.
- `decisions/` — design choices currently in the code, with rationale and code anchors. When the underlying code changes, the decision updates or gets archived.
- `principles/` — durable claims about agent-native tool design that we expect to survive pivots. Append-mostly. If a principle gets refuted, that's a major event worth recording explicitly, not erasing.
- `gaps/` — known problems with the current tool, ranked by suspected leverage. Often spawn hypotheses.

Create folders lazily — no empty placeholders.

## Page conventions

Every page starts with YAML frontmatter:

```yaml
---
created: 2026-05-12
last_verified: 2026-05-12
type: finding | hypothesis | decision | principle | session | benchmark | gap
status: open | testing | confirmed | refuted | superseded   # hypotheses only
code_anchors: [src/scanner.ts, src/index.ts]                 # decisions only
evidence: [sessions/2026-05-12-foo.md]                       # findings / hypotheses
tags: [scan, perception, token-economy]
---
```

Body conventions:
- **Findings** — state the claim in one sentence, then evidence (cite session/benchmark), then implications. Don't reproduce the source; link to it.
- **Hypotheses** — name the predicted change, the mechanism, the measurable outcome, the expected size of effect, how to test. Without a measurable outcome it isn't a hypothesis.
- **Decisions** — explain *this choice over the alternative*. Cite the commit if known. Link to the file(s) that implement it.
- **Principles** — one-sentence claim, then *why we believe it persists across pivots*. Be skeptical: promote a finding to principle only when it shows up across multiple sources or under multiple framings.

Link liberally with relative markdown paths (`../findings/foo.md`). Avoid wikilinks (`[[foo]]`) — they're viewer-specific and break grep. The cross-reference graph is most of the value.

## Workflows

### Ingest a session or benchmark

1. Save the raw artifact in `sessions/YYYY-MM-DD-<slug>.md` (or `benchmarks/`). Frozen after creation.
2. Extract distinct claims. For each:
   - If a matching finding exists, update it: add new evidence, sharpen the wording, bump `last_verified`.
   - If new, create `findings/<slug>.md`.
3. For each finding, check downstream:
   - Does it validate or challenge a decision? Update that decision (or move it to a "questioned" state).
   - Does it suggest a hypothesis? Create one with `status: open`.
   - Does it look like a principle? Only promote if seen across multiple sources.
4. Append to `log.md`: `## [YYYY-MM-DD] ingest | <title>` plus a one-line summary and which pages were touched.
5. Update `index.md` with new pages.

A single ingest typically touches 5–15 pages. That's correct; that's the whole point.

### Answer a query

1. Read `index.md` first to find candidate pages.
2. Read candidates; check `last_verified`. If stale (>60 days) or the question hinges on current code state, verify against `../src/` or recent sessions before relying on the claim.
3. Synthesize with citations.
4. If the answer is substantive and reusable, file it back as a new finding or analysis page.

### Lint

Periodically scan for:
- Pages with `last_verified` older than 60 days
- Hypotheses stuck at `status: open` with no recent activity
- Decisions whose `code_anchors` no longer exist (check with `ls` against `../src/`)
- Findings with no decision/hypothesis link (unconnected = uncited)
- Principles that recent findings undermine
- Orphan pages (not reachable from `index.md`)

### Staleness — when the tool changes

When code or design pivots:
- **Decisions**: mark stale (don't bump `last_verified`), link to the commit that superseded them. Don't delete; they're history.
- **Hypotheses**: if the pivot makes them irrelevant, set `status: superseded` with a forwarding link.
- **Findings**: re-check evidence. Still valid post-pivot → bump `last_verified`. Invalidated → note the reason inline.
- **Principles**: examine carefully. A pivot that refutes a principle is a major event — document the refutation explicitly.

## Epistemic hygiene

The four-stage framework exists to keep evidence traceable. Findings without evidence are speculation. Decisions without rationale are folklore. Principles without multiple supporting findings are wishful thinking. When this gets sloppy, flag it.

It's OK — encouraged — to surface findings that contradict an existing decision. That's how we learn the tool is wrong. Don't suppress those. Let the lint pass surface them and let the human decide whether to update the code or update the belief.
