---
created: 2026-05-13
last_verified: 2026-05-13
type: decision
code_anchors: [src/cdp.ts, src/index.ts]
tags: [browser, lifecycle, profile, multi-agent, architecture]
---

# Explicit browser lifecycle tools + env-gated profile semantics

**The choice.** MCP boot no longer spawns chromium. The LLM calls `browser_open` to start (spawn or attach) and `browser_close` to tear down. Profile behaviour is selected by environment: ephemeral by default, persistent via `WEBPILOT_PROFILE_DIR`, clone-on-spawn via `WEBPILOT_PROFILE_TEMPLATE`, or external-attach via `CDP_TARGET` / `CDP_PORT`. The five branches live in `cdp.ts:spawnOrAttach` and are documented inline at `cdp.ts:115-139`.

**Why explicit lifecycle.** Previous design auto-spawned at MCP boot (`9f6f7a6`). That's wrong on three counts:

1. The LLM is the agent — the agent should own when its body exists, not have one forced at process start before any tool intent is known.
2. Some sessions never touch a browser; the auto-spawn paid the chromium cost regardless.
3. Surfacing the lifecycle as tools lets the LLM read about the modes in tool descriptions (cookies survive vs don't, attach vs spawn), which is the only place a model reliably reads them.

`browser_open` is idempotent — calling twice returns "already open" — so an LLM that forgets state doesn't double-spawn.

**Why four profile modes.** Each solves a real failure mode surfaced in use:

| Mode | Trigger | What it solves |
|---|---|---|
| **attach** | `CDP_TARGET` or `CDP_PORT` set | Dev workflow (`scripts/dev-chrome.sh`) and per-worktree dedicated chromium driven by cwt hooks. webpilot doesn't kill what it didn't spawn. |
| **template clone** | `WEBPILOT_PROFILE_TEMPLATE=/path` | Browser-per-agent **with consistent boot state**. Two agents (two MCP servers) each clone the template to their own `/tmp/webpilot-mcp-*`, so both start signed into Google without fighting over chromium's per-user-data-dir singleton lock. |
| **persistent** | `WEBPILOT_PROFILE_DIR=/path` | Cookies survive MCP restarts. Required for sites like Google that flag fresh-profile sessions as suspected automation. Single-share only — cannot be used by two MCP servers concurrently; an existing chromium on that dir is *attached*, not re-spawned. |
| **ephemeral** | neither env set | Default. Fresh `/tmp/webpilot-mcp-*` dir per `browser_open`, wiped on `browser_close`. Right for stateless one-off automation. |

`WEBPILOT_PROFILE_TEMPLATE` overrides `WEBPILOT_PROFILE_DIR` if both are set — clone semantics beat single-share.

**Crash recovery.** SIGKILLed MCP servers can't run cleanup paths. Each dir we create writes a `webpilot.pid` file; on the next MCP boot, `sweepStaleProfiles` (cdp.ts:162) walks `/tmp/webpilot-mcp-*` once, and for each dir whose owner pid is dead it: looks up any orphan chromium via `SingletonLock` → `/proc/<pid>/cmdline` verification, kills it, then wipes the dir. The `/proc/cmdline` check prevents pid-recycle disasters (a recycled pid that's now an unrelated process won't get SIGKILLed).

**Attach-liveness fix (`49d66d3`).** First persistent-dir implementation probed liveness via CDP. Hole: chromium can be alive but CDP briefly unreachable mid-startup, in which case we'd strip a live `SingletonLock` and our follow-up spawn would singleton-forward into it and exit — leaving the user with no controllable browser. Switched to playwright-mcp's pattern (their `browserFactory.ts:224-233`): read `SingletonLock`'s symlinked pid, verify via `/proc/<pid>/cmdline` that it's actually a chromium on this dir. If yes, attach with a 5s CDP timeout. If no, the lock is stale → clean and spawn.

**Architectural framing.** This is the same shift as the earlier "agent owns task semantics, tool owns mechanics" line — applied to process lifetime. The agent's affordances now include *having a body* and *not having one*; webpilot stops pretending the chromium is part of the MCP server itself. The profile-mode env vars are configuration of *which body, with what state*, not behaviour the agent has to think about per-call.

**Source.**
- Code: `src/cdp.ts:115-450` (lifecycle, `spawnOrAttach`, sweep, template clone, persistent-dir attach), `src/index.ts:933-962` (tool definitions), `src/index.ts:1609+` (fallback kill on MCP shutdown).
- Commits, in order: `9f6f7a6` (auto-spawn per MCP server), `17deedf` (explicit `browser_open`/`browser_close`), `2a1043e` (`WEBPILOT_PROFILE_DIR`), `ff739fc` (`WEBPILOT_PROFILE_TEMPLATE`), `6c8d70f` (stale-dir sweep), `49d66d3` (attach-liveness fix).
- Dev-side: `463a4dc` and `3815a87` wire per-worktree dedicated chromiums via cwt hooks — supports the attach branch.
