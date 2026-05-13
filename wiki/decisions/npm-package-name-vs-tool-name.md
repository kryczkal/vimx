---
created: 2026-05-14
last_verified: 2026-05-14
type: decision
code_anchors: [package.json, README.md]
tags: [naming, npm, governance, launch]
---

# Tool name is `vimx`; npm package is `vimx-mcp`

The two diverge intentionally. **Brand / tool / MCP server identity = `vimx`. npm registry name + CLI bin = `vimx-mcp`.** Don't try to "fix" the divergence without reading this page first.

## Why diverged

npm's typo-squat protection rejected the unscoped `vimx` name on first publish attempt:

> 403 Forbidden — Package name too similar to existing packages viem, vite, vm2, vuex, mime, jimp; try renaming your package to '@kryczkal/vimx' and publishing with 'npm publish --access=public' instead.

Two options were considered:

1. **Scoped: `@kryczkal/vimx`** — works around the check, but reads as "personal package" and ties the package to the author's npm handle. Less authoritative.
2. **Unscoped with suffix: `vimx-mcp`** — matches MCP-ecosystem naming convention (`@playwright/mcp`, `@modelcontextprotocol/server-*`, `chatmcp`, `mcp-installer`), self-describes, no scope.

Picked option 2. The bin name was renamed alongside the package (`bin: { "vimx-mcp": "dist/index.js" }`) so `npx -y vimx-mcp` resolves cleanly without the verbose `-p` flag.

Internal MCP server identity (`name: "vimx"` in `src/index.ts`) was **deliberately left as `vimx`** — that's what shows in MCP client UIs, what users type as the server key in their config, and what the brand stands behind.

## Surface map — where each name appears

| Surface | Identifier |
|---|---|
| Brand / product / tool | **vimx** |
| MCP server identity (`src/index.ts:930`) | **vimx** |
| Page-side global ref store | `window.__vimx[]` |
| Env var prefix | `VIMX_*` (`VIMX_PROFILE_TEMPLATE`, `VIMX_HIGHLIGHT`, etc.) |
| GitHub repo | `kryczkal/vimx` |
| Domain (when registered) | `vimx.*` |
| All prose — README, wiki, docs, code comments, log entries | **vimx** |
| MCP client config — server key | `"vimx"` (matches MCP server identity) |
| **npm package name** | **vimx-mcp** |
| **CLI bin name (matches package for `npx`-friendliness)** | **vimx-mcp** |
| **`/tmp/vimx-mcp-*` ephemeral profile dirs** | **vimx-mcp** (uses bin/package naming for filesystem clarity, predates the rename — coincidental match) |
| MCP client config — `args` field | `["-y", "vimx-mcp"]` |
| `npm install` / `npx` invocations | `vimx-mcp` |

## Adopter mental model

- Searches "mcp browser" on npm → finds `vimx-mcp` (the `-mcp` suffix discoverability matters)
- Runs `npm install vimx-mcp`
- Configures MCP client with `"vimx": { command: "npx", args: ["-y", "vimx-mcp"] }`
- Sees the server identified as `vimx` in their client's tool palette
- Refers to the tool as "vimx" in conversation

The divergence is mostly invisible to adopters except at install time.

## Operational rules for this codebase

- **Prose, code comments, wiki entries, log entries**: refer to the tool as **vimx**. Never `vimx-mcp` in prose unless explicitly discussing npm/install paths.
- **Install snippets, `npm` / `npx` commands, package metadata**: use **vimx-mcp**.
- **MCP server identity in client configs**: server key stays `"vimx"`, command args use `"vimx-mcp"`.
- **README's install section**: only place the divergence is explicit; documented inline so adopters aren't confused.

## If npm releases the unscoped `vimx` name later

Possible paths to claim it:

- File a name-dispute request with npm support if the conflicting packages stop shipping updates (unlikely soon — `viem` and `vite` are very active).
- Wait for npm's similarity threshold to relax (no precedent for this).
- Accept the divergence permanently — many successful packages have name/install divergence (e.g. `@types/*` packages don't match the libs they describe; `react-dom` was historically separate from `react`).

If we ever migrate to unscoped `vimx`: keep `vimx-mcp` as a deprecation alias for at least one minor-version cycle so existing configs don't break overnight.

## References

- Commit `b2cf0f8` — `chore(npm): publish as vimx-mcp (npm rejected vimx for similarity to viem/vite)`
- See [`license-mit-with-relicense-trigger.md`](license-mit-with-relicense-trigger.md) — trademark on the name "vimx" is held separately from the MIT code license.
- See `wiki/log.md` `[2026-05-14] decide | rename webpilot → vimx` for the broader rename context.
