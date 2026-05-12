# /wiki-lint — Health-check the webpilot wiki

Walk the wiki, find what's gone stale, contradictory, or orphaned. Full conventions in `wiki/CLAUDE.md`.

## Look for

- **`last_verified` older than 60 days.** Re-check the page against current code/sessions. Bump if still accurate; annotate or downgrade if not.
- **Hypotheses stuck at `status: open`** with no recent activity in `wiki/log.md`. Either run the test, refute, supersede, or note why they're parked. Open-forever is a smell.
- **Decisions whose `code_anchors` no longer exist.** `ls` each anchor; flag missing ones. The decision may need updating to current code, archiving, or splitting. Don't delete history — link to the commit that removed the anchor.
- **Findings with no decision/hypothesis link.** Unconnected = uncited. Either propagate downstream (which decision does it inform? which hypothesis does it generate?) or remove if it doesn't carry weight anymore.
- **Principles that recent findings undermine.** A pivot refuting a principle is a major event — document the refutation explicitly, don't quietly remove the page.
- **Orphan pages.** Not reachable from `wiki/index.md`. Either link them or remove them.
- **Contradictions across pages.** Two findings making opposing claims should not both have current `last_verified` dates.

## How to run

Scan `wiki/index.md` for the catalog, then walk each subdirectory. Use `ls` for `code_anchors`, `grep` for cross-references, and inspect frontmatter dates with `head` on each page.

## Output

A punch list in priority order:
1. **Critical** — claims that conflict with current code or each other; decisions whose anchors are gone
2. **Stale** — pages overdue for verification
3. **Hygiene** — orphans, unconnected findings, hypotheses parked too long

Surface the list; don't fix things silently. The user picks what to update.
