---
created: 2026-05-13
last_verified: 2026-05-13
type: decision
code_anchors: [LICENSE, THIRD-PARTY-NOTICES.md, package.json, CONTRIBUTING.md]
tags: [license, oss, launch, governance]
---

# License: MIT, with documented re-license trigger to Apache 2.0

## The choice

vimx is MIT-licensed as of v0.1.0. Two adjacent governance decisions land alongside:

- Contributions use **DCO sign-off** (`Signed-off-by:` trailer), not a CLA.
- Trademark "vimx" is reserved separately — the license covers code, not the name.

## Alternatives considered

**Apache 2.0** — the strongest alternative. Explicit patent grant + patent-retaliation clause; ecosystem-aligned with the MCP TypeScript SDK and Playwright-MCP (the launch foil). Rejected for v0 because:

1. **Vimium upstream is MIT.** vimx's scanner derives from Vimium's `link_hints.js` / `dom_utils.js` (see [`../../THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)). MIT → MIT is the cleanest derivative-work narrative.
2. **Closest peers are MIT.** browser-use (philosophical rival) and Stagehand (ecosystem peer) are both MIT. Matching them removes one friction axis for adopters considering a switch.
3. **Adoption-first launch posture.** Indie agent builders and the HN audience read MIT as the default permissive license. Apache 2.0's NOTICE-file + modification-marking obligations are minor compliance friction that compounds across many adopters.
4. **Contributor friction.** Apache 2.0's irrevocable patent grant creates an "is this OK with my employer" check for engineers at large companies. MIT skips that check. The contributor pool at v0 is exactly those engineers.
5. **Patent-grant value is deferred.** No enterprise customers, no foundation conversations, no large-corp contribution offers — yet. Each of those is a *trigger* for the relicense, not the current state.

**Source-available (BSL / FSL / SSPL / Elastic License)** — rejected as wrong-frame. The MongoDB / Elastic / HashiCorp / Redis pattern that produced these is about defending managed-service businesses from cloud-provider undercutting. vimx is a stateless library/server; the closest analogs (Puppeteer, Playwright) are permissive-licensed and have never faced "AWS clones us" pressure. Source-available would solve a problem we don't have while creating the "is it really open source" debate we don't want during launch.

**AGPL / MPL 2.0** — rejected. AGPL spooks enterprise procurement reviews; MPL 2.0 is file-level copyleft, which conflicts with the kernel positioning ("embed me in your stack without thinking about it").

## Peer-license matrix at decision time

| Project | License | Role in our framing |
|---|---|---|
| Vimium | MIT | Upstream — scanner derives from it |
| browser-use | MIT | Closest philosophical rival |
| Stagehand | MIT | Ecosystem peer |
| Playwright-MCP | Apache 2.0 | Launch foil |
| MCP TypeScript SDK | Apache 2.0 (legacy MIT in older code) | Ecosystem standard (Anthropic-led) |

The ecosystem is bimodal, not converging. Indie / startup projects → MIT; big-company projects → Apache 2.0. v0 sits with the indies.

## Re-license trigger to Apache 2.0

Relicense MIT → Apache 2.0 when **any one** of these lands:

- First enterprise customer's legal team requests Apache 2.0 during procurement
- First conversation about joining CNCF / Linux Foundation / Apache Software Foundation
- First $1M ARR (signals enterprise relevance is the operating reality, not a future hope)
- First contribution offer from a large-corp engineer blocked by their employer's MIT/Apache policy

MIT → Apache 2.0 is the easy relicense direction. Required precondition: **all contributions accepted under DCO sign-off**, which gives the project the contributor authority to relicense without re-soliciting consent from each contributor.

## Why DCO over CLA

A CLA (Contributor License Agreement) is heavyweight — contributors sign a separate legal document granting the project broad rights including future relicensing. DCO is a `Signed-off-by:` trailer in the commit, asserting "I have the right to contribute this patch" under the project's existing license. Linux kernel uses DCO; GitHub has a built-in DCO check via the [DCO GitHub App](https://github.com/apps/dco).

For a solo-maintainer project at launch, CLA friction loses more indie contributions than it protects against. DCO is the modern lightweight default and provides the relicense optionality we need.

## What this does NOT cover

- **Trademark.** "vimx" is a separate IP concern. File an intent-to-use trademark application (~$350, USPTO, ~6-month process) once brand commitment is firm. License does not cover the name.
- **Benchmark license.** Vimx Bench v0/v1 task list + writeups are intended for **CC BY 4.0** (attribution-required, commercial use OK, allows derivative benchmarks). Code and benchmark data are different artifacts.
- **Documentation license.** README / CLAUDE.md / wiki defaults to MIT for simplicity — only the benchmark surface gets a different license.

## Implementation

- [`../../LICENSE`](../../LICENSE) — SPDX-compliant MIT text, Copyright (c) 2026 Łukasz Kryczka
- [`../../package.json`](../../package.json) — `"license": "MIT"` field
- [`../../THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) — Vimium attribution preserved
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — DCO sign-off requirement documented
- DCO GitHub App: install at https://github.com/apps/dco once the repo is public (manual GitHub UI action, not a code change)

## References

- [browser-use LICENSE (MIT)](https://github.com/browser-use/browser-use/blob/main/LICENSE)
- [Stagehand LICENSE (MIT)](https://github.com/browserbase/stagehand/blob/main/LICENSE)
- [Playwright-MCP LICENSE (Apache 2.0)](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)
- [MCP TypeScript SDK LICENSE (Apache 2.0 with legacy MIT)](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE)
- [Developer Certificate of Origin (developercertificate.org)](https://developercertificate.org/)
- [DCO GitHub App](https://github.com/apps/dco)
