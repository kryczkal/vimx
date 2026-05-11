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
- Flat scan output + on-demand read() beats hierarchical trees for token efficiency (see Design considerations below)

## Design considerations

### Flat scan vs hierarchical output

Playwright MCP returns the full accessibility tree (YAML with nesting) after every action — ~4,500 tokens/turn including all content nodes. Webpilot returns a flat list of interactive elements only (~750 tokens) with deltas after actions (~200 tokens). Over a 10-step session this is roughly 18x fewer tokens.

The tradeoff: flat output loses co-location context (which button belongs to which dialog/form). Currently the disambiguator adds ancestor context only on label collisions ("Buy · Pro Plan" vs "Buy · Basic Plan"), which is zero-overhead for unique labels.

If disambiguation proves insufficient in practice, a lightweight alternative to full hierarchy: annotate every element with its nearest semantic ancestor in a parenthetical — `[5] button "Delete" (dialog)`. Preserves flat structure, adds context, minimal token cost. Avoid full hierarchical grouping — it forces decisions about which containers to show and how deep, and converges toward Playwright's token profile.
