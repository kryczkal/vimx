---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [search, agent-native, read]
---

# find(query) as a native tool

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
