---
created: 2026-05-12
last_verified: 2026-05-12
type: benchmark
source: claude-code session 6b7a1271-2f98-4965-bac3-7cafe3273eb8
tags: [read, urls, navigation, 19-site]
---

# URL annotation in read() — 19 sites, 5 variants

**Tested.** Variants for surfacing link URLs in `read()`:
- Baseline (no URLs)
- Variant E: append `[url]` to every `<a>` (unfiltered)
- Variant Ef: variant E plus skip-empty + skip-shallow-same-origin filters
- (and others)

**Sites.** 19 — Reddit, Wikipedia, Node.js docs, Hacker News, eBay, MDN, StackOverflow.

**Metrics.**
- Off-viewport links with text: 7,290 / 14,143 (**52%** of all anchors)
- Cross-origin off-viewport: 2,533 (host-stripped in scan output, so otherwise unreachable from scan)
- Char inflation: variant E **+125%** (290k → 654k); variant Ef +58% (460k)
- Sites exceeding 200k cap: only Wikipedia/Cat (217k) — handled by truncation marker

**Conclusion.** Validated. Variant E (unfiltered) chosen.

**Notes.** Variant Ef's same-origin+short-path filter was "triple-wrong" — it would have removed exactly the off-viewport links read uniquely surfaces. The +125% size increase looked alarming in isolation but is cheap compared to the unbounded-scan alternative (see [viewport-bound-vs-full](2026-05-12-viewport-bound-vs-full.md)): +25k tokens per read vs 150–300k per session for unbounded scan.

Image-only anchors (~13% of `<a>`) are skipped today — fallback to `alt`/`title` is a future iteration if those routes turn out to matter.

**Source.** Session `6b7a1271-2f98-4965-bac3-7cafe3273eb8`. Code: `src/scanner.ts` READ_JS, ~12 lines. Decision: [read-surfaces-link-urls](../decisions/read-surfaces-link-urls.md).
