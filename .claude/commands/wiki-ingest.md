# /wiki-ingest — Ingest a source into the vimx wiki

Run the ingest workflow on a new source. Full conventions in `wiki/CLAUDE.md` — read it before doing anything else; the folder layout, frontmatter, and downstream propagation rules live there, not here.

## Resolve $1

- **File path** (`/path/to/file.md`) → ingest that file directly.
- **Claude-code session UUID** (8-4-4-4-12 hex) → load `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, where `<encoded-cwd>` is the project's absolute path with `/` replaced by `-` (e.g. `/home/alice/code/vimx` → `-home-alice-code-vimx`). Find the relevant portion (typically the output of a slash command); don't ingest the whole conversation.
- **`benchmark`** → find recent `/benchmark` runs in the project's claude-code history:
  ```bash
  proj="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')"
  grep -l '"/benchmark"\|/benchmark\b' "$proj"/*.jsonl
  ```
  Cross-reference against `wiki/log.md` (every ingest is logged with its source UUID) to skip ones already processed. Within each session, the relevant content is the assistant's response *after* the `/benchmark` user message — that's the benchmark report. Extract that, not the surrounding development chat.
- **(no argument)** → list unprocessed `/benchmark` sessions, ask the user to pick one. Don't ingest silently.

## Workflow

1. **Save artifact.** Under `wiki/sessions/` or `wiki/benchmarks/` as `YYYY-MM-DD-<slug>.md`. For session-derived artifacts save the *relevant excerpt*, not the whole transcript. Frontmatter must include `created`, `source` (cite the UUID), `type` (`session | benchmark`), and tags. Frozen after creation.
2. **Extract findings.** Walk distinct claims one at a time. For each:
   - Does an existing finding cover it? Update: add evidence, sharpen the wording, bump `last_verified`.
   - New? Create `wiki/findings/<slug>.md`. Link evidence back to the artifact.
3. **Propagate downstream.** For each finding:
   - Validates or challenges a decision? Update or move to questioned. Don't silently invalidate code-anchored claims.
   - Suggests a hypothesis? File one with `status: open`. **Without a measurable outcome it isn't a hypothesis — don't file half-baked.**
   - Looks like a principle? Promote only when seen across multiple sources.
4. **Append to `wiki/log.md`:** `## [YYYY-MM-DD] ingest | <title>` + one-line summary + the list of pages touched + cite the source (file path or UUID).
5. **Update `wiki/index.md`** with new pages.

A single ingest typically touches 5–15 pages. That's the whole point.

## Bar

- Cite primary-source quotes with line refs when possible.
- Quality > quantity. A small set of well-evidenced findings beats many speculative ones.
- If new data contradicts a prior claim — even one from a previous ingest — record the correction in the log. The wiki gets *more* honest over time, not less.
- Don't suppress findings that contradict existing decisions. Surface them. The lint pass catches them later anyway; better to flag now.

## When NOT to ingest

- Single anecdote with no recurring pattern → not a finding yet. Note in log if interesting, but don't manufacture a page.
- Speculation without a source → belongs in a brainstorm, not the wiki.
- Content that duplicates what's already there → update the existing page, don't create a parallel one.
