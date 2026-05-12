# webpilot

MCP server that gives AI agents Vimium-like browser control via Chrome DevTools Protocol.

## Architecture

Connects to a running Chrome instance via CDP, injects Vimium-derived JS to enumerate interactive elements, and exposes affordance-typed tools (scan, press, type, select, toggle, read).

Elements are classified by what you can DO with them, not what they ARE. The agent picks WHICH element, the tool enforces HOW to interact.

## Run

```bash
# Chrome must be running with remote debugging:
# chromium --remote-debugging-port=9222

npm install
CDP_PORT=9222 npx tsx src/index.ts        # dev (stdio MCP server)
CDP_PORT=9222 node dist/index.js          # production

# Or configure as MCP server in Claude Code settings
```

## Key files

- `src/scanner.ts` — Injectable JS derived from Vimium's link_hints.js and dom_utils.js
- `src/cdp.ts` — Chrome DevTools Protocol connection management
- `src/index.ts` — MCP server with tool definitions

## Design principles

- Affordance-typed tools: press/type/select/toggle — structurally impossible to misuse
- Auto re-scan after mutations so agent always has fresh state
- Element references stored in `window.__webpilot[]` — direct object refs, no fragile selectors
- Scanner derived from Vimium's battle-tested detection heuristics (visibility, clickability, false positive filtering, overlap detection)

## Wiki

`wiki/` accumulates project knowledge across hypotheses, sessions, benchmarks, findings, decisions, and principles. The schema and operating manual is `wiki/CLAUDE.md`; the general pattern is `wiki/IDEA.md`. Workflows:

- `/wiki-ingest <source>` — file a new artifact (file path, claude-code session UUID, or `benchmark` to discover unprocessed `/benchmark` runs)
- `/wiki-query <question>` — ask the accumulated knowledge a question
- `/wiki-lint` — periodic health check (stale pages, broken code_anchors, orphans, contradictions)
