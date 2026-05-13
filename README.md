# webpilot

**Vimium for AI agents.** An MCP server that gives LLM agents Vimium-style browser control via the Chrome DevTools Protocol — affordance-typed actions over filtered, hit-tested element refs, instead of megabyte DOM dumps.

```
npx webpilot   # runs the MCP server over stdio
```

## Why

Most browser tools for AI agents hand the model raw HTML and ask it to compute what's interactable. This:

- Floods context with structure the model has to re-derive every turn
- Has no native handle on visibility, foreground vs occluded, or focus
- Forces brittle ref tracking through framework re-renders
- Breaks on hover-revealed UI, virtualized lists, modals, cross-origin iframes, and accessibility-hostile sites

webpilot does what Vimium did for human users 15 years ago: **scan once, surface only what's clickable, resolve refs against live DOM at action-time.** The agent picks *which* element by id; the tool enforces *how* to interact with it.

- ~10× smaller scan output vs. accessibility-tree dumps
- Hit-test (`elementFromPoint`) confirms every action against foreground state
- Stateful scan dedup: idle re-scans drop 83%, post-action 89% (measured across 20 sites)
- Affordance-typed tools (`press` / `type` / `select` / `toggle`) — structurally impossible to call the wrong tool on a target

## Install

webpilot is a stdio MCP server. Add it to your MCP-aware client:

### Claude Code

```bash
claude mcp add webpilot -- npx -y webpilot
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "webpilot": {
      "command": "npx",
      "args": ["-y", "webpilot"]
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "webpilot": {
      "command": "npx",
      "args": ["-y", "webpilot"]
    }
  }
}
```

### Requirements

- **Node.js ≥ 20**
- **Chrome or Chromium** on system PATH. webpilot auto-spawns it on first use, or attaches to a running instance — see [Browser lifecycle](#browser-lifecycle).

### From source (pre-publish or development)

```bash
git clone https://github.com/kryczkal/webpilot
cd webpilot
npm install
npm run build
```

Then point your MCP client at the built binary:

```json
{
  "mcpServers": {
    "webpilot": {
      "command": "node",
      "args": ["/absolute/path/to/webpilot/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `browser_open` | Open the browser (or attach to a running one) |
| `browser_close` | Close the browser and release the profile |
| `scan` | Enumerate visible, interactive elements grouped by affordance. Stateful per URL — emits diffs after the first scan |
| `press` | Click an element by scan id |
| `type` | Type into an input; `clear: true` clears via DOM, not Ctrl+A |
| `select` | Select an option from a `<select>` or combobox |
| `toggle` | Toggle a checkbox / switch / aria-checked control |
| `hover` | Hover an element — reveals dropdowns, tooltips, mega-nav children |
| `upload` | Attach a file to a file input |
| `key` | Press a keyboard key (arrows, enter, escape, etc.) |
| `read` | Return page innerText, optionally filtered by regex with context lines |
| `navigate` | Go to a URL, back, or forward |
| `scroll` | Scroll the page or a specific scroll container |
| `expand` | Expand collapsed regions / load-more / "show all" affordances |
| `tabs` | List open browser tabs |
| `switch_tab` | Switch to a tab by id |
| `dialog` | Accept or dismiss native browser dialogs (alert / confirm / prompt) |

Every mutating tool auto-emits a fresh scan in its return so the agent always has current state.

## Browser lifecycle

webpilot has four profile modes, gated by environment variables. The default is **ephemeral** — each `browser_open` gets a fresh `/tmp` profile that's wiped on close.

| Mode | Env vars | Behavior |
|---|---|---|
| **Attach** | `CDP_PORT=9222` or `CDP_TARGET=ws://...` | Connect to a chromium already running with `--remote-debugging-port`. No spawn, no profile management. |
| **Template clone** | `WEBPILOT_PROFILE_TEMPLATE=/path/to/profile` | Clone the template dir to an MCP-server-scoped `/tmp` copy on first open, reuse across open/close cycles, wipe on MCP exit. Multiple MCP servers can run simultaneously from the same logged-in template (e.g. signed into Google). |
| **Persistent** | `WEBPILOT_PROFILE_DIR=/path/to/profile` | Use the dir directly, no copy. Persists across MCP restarts. Single-process — can't be shared across MCP servers concurrently. |
| **Ephemeral** | (default) | Fresh `/tmp` profile per `browser_open`, wiped on `browser_close`. |

If both `_TEMPLATE` and `_DIR` are set, `_TEMPLATE` wins. If chromium is already running against `_DIR`, webpilot attaches instead of spawning a duplicate. Stale `/tmp/webpilot-mcp-*` dirs from SIGKILLed servers are swept on next launch.

### Other env vars

- `WEBPILOT_HIGHLIGHT=0` — disable the visual element highlight (on by default; helps when watching the browser live)
- `WEBPILOT_SCAN_DEDUP=0` — disable stateful scan dedup (on by default; saves ~80% on idle re-scans)

## Architecture

Three files, ~2k LOC total:

- `src/scanner.ts` — Vimium-derived injectable JS: visibility detection, clickability heuristics, false-positive filtering, hit-test for obscuration, region inference (main / nav / footer / etc.).
- `src/cdp.ts` — Chrome DevTools Protocol connection management, profile handling, event-driven synchronization (no defensive sleeps).
- `src/index.ts` — MCP server with affordance-typed tool definitions, stateful scan cache, anomaly-flag heuristics on `type` / `toggle` / `select`.

Element refs live in `window.__webpilot[]` — direct object refs, not selectors. Survives React/Vue re-renders within a scan window.

Design notes accumulate in [`wiki/`](wiki/) — hypotheses, decisions in code, principles, and benchmark findings, organized by the [pattern in `wiki/IDEA.md`](wiki/IDEA.md).

## Benchmarks

A public benchmark spec is in progress: [`wiki/launch/wp-bench-v1.md`](wiki/launch/wp-bench-v1.md). Six failure-mode categories where DOM-dump approaches collapse and filtering wins; pre-registered predictions vs. Playwright-MCP, Stagehand, browser-use, and Computer Use.

Internal perf benchmarks (scan dedup, hit-test, viewport-bound scan, etc.) live in [`wiki/benchmarks/`](wiki/benchmarks/).

## Development

```bash
git clone https://github.com/kryczkal/webpilot
cd webpilot
npm install

# dev (tsx, hot-ish)
npm run dev

# build to dist/
npm run build

# run built binary
npm start

# run against an existing Chrome on port 9222
CDP_PORT=9222 npm start
```

### Running Chrome for `CDP_PORT` mode

```bash
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/webpilot-dev-profile
```

## Contributing

PRs welcome. A few short rules in [`CONTRIBUTING.md`](CONTRIBUTING.md):

- Commits sign off with `Signed-off-by:` ([DCO](https://developercertificate.org/)) — `git commit -s` adds it automatically
- The kernel stays small: scanner heuristics, affordance primitives, CDP-level perf. Site-specific patches and agent-loop logic belong in adapter packages, not here
- New features land with a benchmark, a regression check, or a session-analysis page — see the [wiki's epistemic discipline](wiki/CLAUDE.md) (hypotheses → benchmarks → findings → decisions)

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Łukasz Kryczka.

`src/scanner.ts` includes code derived from [Vimium](https://github.com/philc/vimium) (MIT) — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

The project may relicense to Apache 2.0 in the future under documented triggers (first enterprise legal request, foundation entry, $1M ARR, or contributor blocked by employer policy). DCO sign-off on contributions preserves that optionality without a CLA. Full rationale: [`wiki/decisions/license-mit-with-relicense-trigger.md`](wiki/decisions/license-mit-with-relicense-trigger.md).

## Acknowledgements

- [Vimium](https://github.com/philc/vimium) — Phil Crosby & Ilya Sukhar. The element-detection heuristics are downstream of theirs, refined for AI-agent use cases.
- [Model Context Protocol](https://modelcontextprotocol.io) — Anthropic & contributors. The standard that lets a browser tool plug into any agent framework.
