---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [hypotheses/find-query-tool.md]
tags: [api-design, agent-mental-model, primitive]
---

# Expose primitives, not search engines

**Claim.** Tool APIs that *accept natural-language queries* invite agents to use them as semantic search engines — regardless of the implementation. The API surface dictates the calling pattern: a `query` parameter signals "this tool understands intent." Models read that signal and call accordingly. When the implementation can't satisfy the call shape (substring matching on a query like "the button to add to cart"), the agent concludes the tool is broken and abandons it.

**Evidence.** webpilot previously shipped a `query` tool with this exact shape. Models made too-narrow / semantic-style calls. The owner pivoted to `read({regex})` precisely because of the failure pattern.

A reproducible failure mode: any "find(query)" or similar that *looks* smart will be called as if it is.

**Implication.**
- For "where is X on the page" / "is there a button for X" / "does the page say X" questions, the right interface is **regex**. Models know regex syntax. The semantics of "what to match" lives in the agent's head; the tool only mechanically matches characters.
- This is `abstract-mechanics-not-goals` applied to query shape: the tool owns *how* matching is done; the agent owns *what* to match. A natural-language query API blurs that boundary by appearing to own the semantics — which models then expect.
- Same lesson applies to other potential additions: a `summarize(page)` tool, a `click(intent="..." )` shortcut, etc. Expose primitives; let the agent compose.

**Counter-evidence considered.** Could a tool description constrain agents to use a query API only in "literal substring" mode? No — sessions show agents pattern-match on tool name + parameter name far more than on description prose. The shape wins.

**Implication for the "agents abandon webpilot for curl" symptom from sessions 98cd4dbf / fcdb27fe.** Those agents decided "webpilot can't search Wikipedia" — false. The real gap is discoverability of `read({regex})` and `navigate(site-search-URL)`. Two narrower follow-ups worth filing:

- Improve `read({regex})` tool description to lean into the "use this to find content" framing — currently it reads more like "extract page text with optional filter."
- Surface site-internal search affordances in scan output when `<input type="search">` / `[role="search"]` are detected — communicates "this page has search, use type+enter to drive it."

Neither is a new tool. Both are improvements to existing primitives.
