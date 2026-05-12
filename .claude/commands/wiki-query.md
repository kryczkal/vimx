# /wiki-query — Answer a question from the webpilot wiki

Synthesize an answer from accumulated wiki knowledge. Full conventions in `wiki/CLAUDE.md`.

## Workflow

1. **Read `wiki/index.md` first** — it's the catalog. Use it to find candidate pages relevant to $1.
2. **Read each candidate.** Check `last_verified` in frontmatter. If stale (>60 days) or the question hinges on current code state, verify against `src/` or recent sessions before relying on the claim. Memory of "what was true on date X" is fine; treating stale memory as current is not.
3. **Synthesize the answer with citations.** Use markdown links to the wiki pages you drew on — readers should be able to drill in. Be specific about which page supports which claim.
4. **If the answer is substantive and reusable, file it back.** Add a new finding or analysis page, append a log entry. This is how queries compound into the knowledge base — don't let useful syntheses disappear into chat history.

## Bar

- Cite specific pages, not "the wiki" in general.
- Disagree with the wiki when current evidence does. Then update the wiki — don't leave it stale.
- If no wiki material is usable, say so. Then suggest what ingest would close the gap — that's how the wiki grows toward the question.
- Don't paraphrase memory when you can read the page. The frontmatter dates matter; the body details matter.
