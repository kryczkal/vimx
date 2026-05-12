---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts]
tags: [read, navigation]
---

# read() surfaces absolute link URLs

**The choice.** `read()` output includes the URL after each `<a>` element's text, formatted `[text](url)`. URLs are absolute (resolved against page base).

**Why.** Agents follow links via `navigate(url)`. Without the URL in `read()` output, the agent has only the link text — which is often ambiguous ("learn more", "click here") or duplicated across the page. The agent then needs a separate scan + match step to recover the URL. Surfacing URLs inline collapses that to one tool call.

This was originally absent (commit `aec5902` argued read should be scan-only / text-only). The argument was wrong: the data shows agents systematically follow links from read-output, so withholding URLs forces extra steps without preventing the navigation.

**Source.** Commit `1260fb1` ("feat: read() appends absolute URLs after each `<a href>`").

**Benchmark evidence.** Variant E (unfiltered URL annotation) chosen after measuring 5 variants across 19 sites — see [2026-05-12-url-annotation-read](../benchmarks/2026-05-12-url-annotation-read.md). Variant Ef (with same-origin filter) would have removed exactly the off-viewport links read uniquely surfaces. 52% of `<a>` tags are off-viewport across the benchmark set, and `read()`-based annotation costs ~1/7th as much per session as the alternative (unbounded scan) — see [viewport-bound-scan](viewport-bound-scan.md).

**Connection to principle.** This is one of those cases where the line between "what the tool provides" and "what the agent figures out" matters. Following a link is navigation (mechanics); deciding which link to follow is task semantics. Surfacing the URL lets the agent decide while the tool handles resolution. See [abstract-mechanics-not-goals](../principles/abstract-mechanics-not-goals.md).
