# vimx

**Vimium for AI agents.** A browser MCP that exposes affordance-typed tools — `press` / `type` / `select` / `toggle` / `read` — over a deterministic, Vimium-derived element scan. The agent picks _which_; the type system enforces _how_.

```
npx -y vimx-mcp   # runs the MCP server over stdio
```

## Why

Three patterns dominate the agent-browser MCP space. Each is a different tax:

- **Accessibility-tree snapshots + generic `click(ref)`** — Playwright-MCP, chrome-devtools-mcp, BrowserMCP, browser-use. The agent re-parses interactability every turn; the same call covers buttons, inputs, checkboxes, links. _Tax: context + ref staleness._
- **Natural-language acts translated by LLM per call** — Stagehand. Reads beautifully in dev scripts; resolves ambiguity silently. _Tax: a model call per action._
- **Pixel / VLM control** — Anthropic Computer Use, OpenAI Operator. Bypasses the DOM. _Tax: latency, cost, accuracy on dense UIs._

vimx is the fourth path. A deterministic, Vimium-derived scan returns only what an agent can act on; tools are split by affordance so the call site already encodes intent. No second LLM, no snapshot strings to stale, no pixel matching.

## How vimx compares

- **Playwright-MCP** (Microsoft) — a11y snapshot ref strings + generic `click` / `type`. Largest install base. Affordance discrimination only inside `fill_form`'s field type.
- **chrome-devtools-mcp** (Google) — Puppeteer a11y tree + `uid` strings; auto-snapshot is opt-in (inverse default).
- **browser-use** (`browser_use/mcp/server.py`) — full agent loop with a numbered-hint overlay over DOM/screenshot and a generic `click(index)`. Closest design neighbor; vimx is the primitive, browser-use is the platform.
- **Stagehand** (Browserbase) — `act("click sign in")` over a hybrid a11y+DOM snapshot, with per-call inference to translate intent into a selector. Different bet on where intelligence lives — at the SDK vs at the agent.

## Install

**Claude Code**

```bash
claude mcp add vimx -- npx -y vimx-mcp
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vimx": { "command": "npx", "args": ["-y", "vimx-mcp"] }
  }
}
```

**Cursor** — `~/.cursor/mcp.json`: same JSON block as above.

Requirements: Node.js ≥ 20, Chrome or Chromium on PATH. vimx auto-spawns it or attaches to a running instance — see [Browser lifecycle](#browser-lifecycle).

From source:

```bash
git clone https://github.com/kryczkal/vimx && cd vimx && npm install && npm run build
# then point your client at: node /abs/path/to/vimx/dist/index.js
```

## Tools

| Tool                             | What it does                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Affordance actions**           |                                                                                                                   |
| `press`                          | Click an element — buttons, links, anything actionable                                                            |
| `type`                           | Type into an input (`clear: true` clears via DOM, not Ctrl+A)                                                     |
| `select`                         | Select an option from a `<select>` or combobox                                                                    |
| `toggle`                         | Toggle a checkbox, switch, or `aria-checked` control                                                              |
| `upload`                         | Attach a file to a file input                                                                                     |
| **Observation**                  |                                                                                                                   |
| `scan`                           | Enumerate visible interactive elements grouped by affordance. Stateful per URL — emits diffs after the first scan |
| `read`                           | Page innerText with `<a>` URLs preserved as `[text](url)`; optional regex filter with ±N context lines            |
| **Navigation & state**           |                                                                                                                   |
| `navigate`                       | Go to a URL, back, or forward                                                                                     |
| `scroll`                         | Scroll the page or a specific scroll container                                                                    |
| `hover`                          | Reveal dropdowns, tooltips, mega-nav children                                                                     |
| `key`                            | Press a keyboard key (arrows, enter, escape, etc.)                                                                |
| `expand`                         | Expand collapsed regions / load-more / "show all"                                                                 |
| `dialog`                         | Accept or dismiss native alert / confirm / prompt                                                                 |
| **Browser & tabs**               |                                                                                                                   |
| `browser_open` / `browser_close` | Open the browser (or attach to a running one); close and release the profile                                      |
| `tabs` / `switch_tab`            | List open tabs; switch by id                                                                                      |

Every mutator returns a fresh scan in its result, so the agent always has current state.

## Browser lifecycle

Four profile modes, gated by env vars (default: **ephemeral**, fresh `/tmp` profile per session):

| Mode               | Env vars                                 | Behavior                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attach**         | `CDP_PORT=9222` or `CDP_TARGET=ws://...` | Connect to a Chromium already running with `--remote-debugging-port`. No spawn, no profile management.                                                                                                                                    |
| **Template clone** | `VIMX_PROFILE_TEMPLATE=/path`            | Clone the template to an MCP-server-scoped `/tmp` copy on first `browser_open`, reuse across open/close cycles, wipe on MCP exit. Multiple MCP servers can run simultaneously from the same logged-in template (e.g. signed into Google). |
| **Persistent**     | `VIMX_PROFILE_DIR=/path`                 | Use the dir directly, no copy. Persists across MCP restarts. Single-process — can't be shared across MCP servers concurrently.                                                                                                            |
| **Ephemeral**      | (default)                                | Fresh `/tmp` profile per `browser_open`, wiped on `browser_close`.                                                                                                                                                                        |

If both `_TEMPLATE` and `_DIR` are set, `_TEMPLATE` wins. If Chromium is already running against `_DIR`, vimx attaches instead of spawning a duplicate. Stale `/tmp/vimx-mcp-*` dirs from SIGKILL'd servers are swept on next launch.

Other env vars:

- `VIMX_HIGHLIGHT=0` — disable the visual element highlight (on by default; helps when watching the browser live)
- `VIMX_SCAN_DEDUP=0` — disable stateful scan dedup (on by default; saves ~80% on idle re-scans)

## Architecture

Three files, ~2k LOC:

- `src/scanner.ts` — Vimium-derived injectable JS: visibility, clickability heuristics, false-positive filtering, hit-test for obscuration, region inference.
- `src/cdp.ts` — CDP connection management, profile handling, event-driven synchronization (no defensive sleeps).
- `src/index.ts` — MCP server, affordance-typed tool definitions, stateful scan cache, anomaly heuristics on `type` / `toggle` / `select`.

Design notes accumulate in [`wiki/`](wiki/) — hypotheses, decisions-in-code, principles, benchmark findings — organized by the pattern in [`wiki/IDEA.md`](wiki/IDEA.md).

## Benchmarks

Public benchmark v1 in progress: [`wiki/launch/vimx-bench-v1.md`](wiki/launch/vimx-bench-v1.md). Six failure-mode categories where filtering should beat dumping, with pre-registered predictions against Playwright-MCP, Stagehand, browser-use, and Computer Use.

Preliminary numbers from the author's own Cursor sessions across ~20 sites — confirmation-of-hypothesis, not the v1 result:

- Scan output: ~10× smaller than equivalent accessibility-tree dumps
- Speed at real world task: ~2x faster than Playwright-MCP

Internal perf benchmarks (scan dedup, hit-test, viewport-bound scan) live in [`wiki/benchmarks/`](wiki/benchmarks/).

## Development

```bash
git clone https://github.com/kryczkal/vimx && cd vimx && npm install
npm run dev      # tsx
npm run build    # to dist/
npm start        # run built binary

CDP_PORT=9222 npm start    # against a running Chrome
# chromium --remote-debugging-port=9222 --user-data-dir=/tmp/vimx-dev-profile
```

## Contributing

PRs welcome. Short rules in [`CONTRIBUTING.md`](CONTRIBUTING.md):

- Commits sign off with `Signed-off-by:` ([DCO](https://developercertificate.org/)) — `git commit -s` adds it.
- The kernel stays small: scanner heuristics, affordance primitives, CDP-level perf. Site-specific patches and agent-loop logic belong in adapter packages, not here.
- New features land with a benchmark, regression check, or session-analysis page — see the wiki for the pattern.

## License

MIT — see [`LICENSE`](LICENSE). Scanner code derived from [Vimium](https://github.com/philc/vimium) (MIT); see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). May relicense to Apache 2.0 under [documented triggers](wiki/decisions/license-mit-with-relicense-trigger.md) (first enterprise legal request, foundation entry, $1M ARR, contributor blocked by employer policy); DCO sign-off on contributions preserves that optionality without a CLA.

## Acknowledgements

- [Vimium](https://github.com/philc/vimium) — Phil Crosby & Ilya Sukhar. The element-detection heuristics are downstream of theirs, refined for AI agents.
- [Model Context Protocol](https://modelcontextprotocol.io) — Anthropic & contributors.
