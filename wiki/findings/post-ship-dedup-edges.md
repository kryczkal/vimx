---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md, benchmarks/2026-05-12-cache-key-investigation.md]
tags: [scan, dedup, post-ship]
---

# Post-ship dedup edges (refined 2026-05-12)

**Claim.** The v1 dedup ship was a real token win but had four structural edges that violated the "tool yields to agent semantics" principle. All four shown by post-ship cursor sessions; three fixed, one inconclusive.

## Evidence and fixes

### A — Full-elision framed as withholding, not assertion (FIXED)
Sessions 8bbfd98a (Google Forms), 85a6ca6c (Flights), 296dc5de (aborted): agents responded to `Elements: 56 (unchanged since last scan, ids: ...)` by immediately re-scanning. 6/10 full-elision events triggered a defensive rescan in 8bbfd98a. The agent read the elision as "I am withholding info," not "your prior view is current."

Fix: rephrase to a positive assertion about page state. New form: `No changes since last scan. 56 elements (ids ...) still current — act on what you saw.`

### B — Error-state scans still dedup (FIXED)
Session 296dc5de: agent press → "obscured by ..." error → next scan emitted full elision (no labels) → agent stuck → user aborted. After action errors the agent needs full element labels to diagnose. Dedup is mechanic; recovery is semantics.

Fix: `aerr()` helper marks a `nextScanForceFresh` flag on interactive errors (obscured / not-found / stale / wrong-type). Next `emitScan` bypasses dedup, emits full, clears flag.

### C — Per-entry region tags as decoration (FIXED)
5 post-ship sessions, 0 agent thinking traces reasoned about `[main]/[nav]/[header]` etc. ~10% cold-scan token cost without benefit. Regions also showed instability — id 117 in 85a6ca6c flipped `[search]` → `[header]` across scans.

Fix:
1. Dropped per-entry `[region]` suffix (saves -8.2% on cold scans, measured).
2. Promoted regions to scanner-side disambiguator: duplicate labels spanning distinct regions now suffix as `"Save in nav"` / `"Save in main"` (semantic) instead of `(1)` / `(2)` (opaque).
3. Region assignment pinned via WeakMap (`__wpRegionMap`) — same DOM node keeps same region across rescans.
4. Dedup summary line still uses regions: `Unchanged — header: 7 · main: 18 · ...` — this is where regions earn their tokens.

### D — Region tag instability (FIXED via WeakMap)
Same as part of C above. Pinned to first observation per element.

### E — Stale-snapshot-during-mutation race (INCONCLUSIVE)
Hypothesized from 8bbfd98a 426-485 (defensive rescan after press). Probed via `MutationObserver` in 3 sites with targets expected to trigger async expansions. Targets produced 0 mutations in 750ms window — couldn't reproduce. The "defensive rescan storm" symptom is more plausibly explained by A (wording) than by a timing race. Not fixed; revisit if A doesn't reduce the storm in next session round.

### F — Path-only cache key causes false dedup on SPA state (FIXED)
Confirmed via side-channel CDP navigation: Google Flights `?q=SFO->NRT` cache hit on subsequent `?q=NYC->LON` scan, emitted "13 new, 13 changed, 13 gone, 21 unchanged" against a genuinely-different page. The "21 unchanged" were chrome elements whose signatures coincidentally matched.

Fix: cache key now includes `URL.search` (was just `origin + pathname`). See [cache-key-investigation benchmark](../benchmarks/2026-05-12-cache-key-investigation.md).

## Implication

The dedup v1 ship was a token economy fix. The agent UX flaws it actually moved: only Flaw 11 (token economy distorts strategy). The other 11 reasoning flaws unchanged. Three new edges discovered post-ship (A, B, F) revealed places the dedup mechanic was overriding agent semantics — fixing those aligns the ship with the `abstract-mechanics-not-goals` principle. The remaining structural quality work (verification gap, prediction gap, agent's invented limitations) is downstream of hypotheses 3-6 in `wiki/index.md`, which are about agent reasoning, not output economy.
