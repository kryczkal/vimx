---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: refuted
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, findings/expose-primitives-not-search-engines.md]
tags: [search, agent-native, read]
---

## Refuted 2026-05-12 — prior implementation evidence

webpilot previously shipped a `query` tool that worked structurally like the proposed `find(query)`. Outcome: agents made too-narrow / semantic-style calls (e.g. `query("button to add product to cart")` expecting intent understanding). Substring matching can't satisfy that call shape; agents conclude the tool is broken and abandon it. The owner pivoted to `read({regex})` precisely because of this failure pattern.

The shape of the API — accepting a "natural-language query" — is what invites the misuse. Whether the implementation is substring, fuzzy, or anything short of full semantic search, the API promises intent-understanding it can't deliver. Models read the API surface and call accordingly.

**The principle**: don't expose tools that promise to understand agent intent. Expose primitives the agent composes. Regex is the right primitive for "find content on the page" — models know regex; let them own the query semantics. See [expose-primitives-not-search-engines](../findings/expose-primitives-not-search-engines.md).

**Implication for the "agents abandon webpilot for curl" symptom from sessions 98cd4dbf/fcdb27fe**: the actual fix isn't a new tool. It's better discoverability of `read({regex})` for search-shaped tasks, and/or surfacing search affordances explicitly when `<input type="search">` / `role="search"` exist on the page. Filed as a separate, narrower direction below.

## Original hypothesis (preserved)

**Predicted change.** Add a `find(query)` tool that takes a natural-language string and returns matching interactive elements (with their semantic-region context) plus matching text snippets, distinguished by region (`In nav`, `In main`, `In modal`). It's the agent-native equivalent of Cmd+F.

**Mechanism.** Search scan labels and page innerText simultaneously. Use simple substring or fuzzy match (not regex). For each match, emit the element or text snippet plus its containing semantic region. Example:

```
find("nonstop")
  In Filters > Stops:
    [128] toggle "Nonstop only" ○
  In Results:
    Result 1: "Nonstop · 11h 25m"
    Result 4: "Nonstop · 12h 10m"
```

**Predicted outcome.** Agents prefer `find()` over `read({regex})` when both exist, because natural language matches the agent's reasoning shape ("where's the nonstop option") better than regex syntax. Also closes the "webpilot can't search" mental-model gap that caused sessions 98cd4dbf and fcdb27fe to abandon webpilot for `curl`.

**How to test.**
1. Implement alongside existing `read()`.
2. Re-run the Wikipedia / Nobel laureate task that previously failed.
3. Measure: `find` vs `read` adoption ratio; success rate on search-shaped tasks.
4. Confirm: agents reach for `find` heavily; previously-failed tasks now succeed.

**Risk.** Overlap with `read({regex})` could confuse the agent's tool selection. Mitigation: position `find` as "where is X" (location-shaped) and `read` as "what does the page say" (content-shaped) in tool descriptions. Also re-check whether `find` *replaces* parts of `read({regex})` rather than supplementing it.

**Source.** Pushback 7 in pass 2 of [the 2026-05-12 session analysis](../sessions/2026-05-12-cursor-export-17-sessions.md).
