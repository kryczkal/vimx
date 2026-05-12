# /agent-ux-audit — Structural audit of how an AI agent uses a tool

Read agent session transcripts and produce a structural map of the agent's perception-plan-act-feedback loop, the failure modes, and testable hypotheses for tool changes.

This is NOT bug-hunting (use `/audit-sessions` for that). This is the deeper question: **what shape of perception and what action verbs let the model do the task best?**

## When to use

- You have a batch of new session exports and want to understand how agents reason while using your tool
- You're considering a structural change and want evidence from real sessions
- You want to compare two tools (yours vs another) from the agent's POV, not the tool's

## What to do

### 1. Find sessions

Default path: `/home/wookie/Projects/cursor-export/exported/cursor-session-*.md`. If the user points elsewhere, use that. List sizes; flag anything < 30KB as likely short and 100KB+ as worth a deep read.

### 2. Classify by tool

One-pass `grep -c` per session for tool-namespace markers:
- `playwright|mcp_playwright|browser_navigate|browser_snapshot` → Playwright-dominant
- `webpilot|mcp_webpilot|press\|scan\|toggle\|hover` → webpilot-dominant
- mixed sessions exist; tag them as such

Report counts. Pick 3-5 sessions per tool for deep read, biased toward large/long-running ones (more material), with at least one short session per tool (different failure modes).

### 3. Dispatch parallel deep-read agents

**Always parallel, always in one message.** Use `general-purpose` subagent type. Typical fan-out:

- **Agent A**: 3 sessions of Tool 1, map mental model + action patterns + stumbles
- **Agent B**: 3 sessions of Tool 2, same prompt structure
- **Agent C**: 4-5 sessions, ruthless failure-mode forensic — categorize what went wrong
- **Agent D** (if comparing tools): cross-tool comparison of how the agent sees the same task

Each agent prompt must include:
- Specific file paths and sizes
- The tool's actual tool surface (read `src/index.ts` or equivalent first; paste tool list into the prompt so the agent knows what verbs were available)
- 10 specific questions about the agent's experience (not the tool's design):
  1. What was the user's actual goal?
  2. Walk through first ~10 tool calls — what did agent call, get back, do next?
  3. What's the agent's mental model? What abstractions does it use?
  4. The decision loop: what does the agent base each next decision on?
  5. Specific patterns: scrolling, finding, forms, dialogs, dynamic content?
  6. Where does it stumble? Quote the failure precisely.
  7. Tool-output verbosity: overwhelmed? starved?
  8. Post-action behavior: re-snapshot? trust state?
  9. How does it identify elements? By id, label, text, ref?
  10. What's MISSING — what does the agent ask the user / hallucinate / work around?

Tell each agent: **"Be specific. Quote actual tool calls and reasoning chunks. Ground-truth observations, not generic descriptions. Save report in your final message — no need to write to a file."**

### 4. Synthesize

Don't repeat the agents back. Write your own analysis using their evidence. Structure:

**§1 Three loops side by side.** Human-on-website vs Agent-on-Tool-A vs Agent-on-Tool-B. Show the actual mechanics of each. This frames everything.

**§2 What the agent actually "sees".** Table: information channels (visible text, position, prominence, color, focus, animation, loading state, z-order) × what each tool exposes. Most rows will be "no" for the agent — that gap is the story.

**§3 Current map of how the agent uses each tool.** Cross-cutting patterns, drawn from the agents' reports. Quote actual reasoning chunks.

**§4 Fundamental thinking flaws.** Aim for 10-12 distinct structural flaws. Each one needs:
- A one-line description
- Specific evidence (session ID, line context, quoted thinking trace or tool call)
- Whether it's a reasoning flaw or a tool-design flaw enabling the reasoning flaw

Common categories that recur (use as a starting checklist, not a template):
- No theory of what the page IS (flat list vs designed artifact)
- Confuses identification with persistence (stale refs/ids)
- Doesn't predict outcomes before acting
- Shallow recovery (retry, escape, navigate-reload; no diagnosis)
- Invents tool capabilities/limitations
- Doesn't verify outcomes
- No upfront plan, reactive loop
- Tool-rolodex blind spots (underuses available tools)
- Doesn't learn within or across sessions
- Wrong model of time (page is dynamic, snapshots are frozen)
- Token economy distorts strategy
- Assumes page is cooperative (no cookies, walls, captchas)

**§5 Structural insight.** What's the single biggest cross-cutting theme? Usually something like "agent's loop is reactive, but good interaction is predictive" or "agent's perception of TIME is wrong". Make it sharp.

**§6 Comparison table if multiple tools.** Dimensions × tools. Where each wins, where each loses.

**§7 Hypotheses to test, ranked by leverage.** This is the payoff. Each hypothesis must include:
- The change in one sentence
- The expected effect (with rough magnitude)
- How to measure it
- Why this leverage > others

Frame as hypotheses, not features. The user thinks in tests, not roadmaps.

**§8 The one thing to build first.** Single recommendation. Lowest risk, biggest signal, foundation for later moves.

## Output style

- Dense and evidence-grounded. Every claim cites a session.
- No emojis. No motivational language.
- Headers and tables OK; long unstructured prose is not.
- Length is whatever the evidence supports; don't pad, don't elide.
- Frame tool changes as testable hypotheses, not roadmap items.
- Push back on the tool design where the evidence warrants. Don't just enumerate the tool's wins.

## Philosophy

Session logs are ground truth for **agent UX**, not just tool bugs. They reveal:
- How the agent's perception breaks when the tool's output shape doesn't match the agent's reasoning shape
- Which tool verbs the agent actually reaches for, and which it ignores even when they exist
- Where the agent's mental model of the tool diverges from reality

The deepest improvements come from **richer perception**, not more verbs. A flat list of every element on the page is technically complete and practically useless. A semantically-organized, state-aware, change-annotated view is what the agent actually needs.

The agent is good at planning when it has good perception. Most "agent reasoning failures" are upstream perception failures wearing reasoning-failure costumes.
