---
created: 2026-05-12
last_verified: 2026-05-12
type: hypothesis
status: open
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [scan, page-state, cookie-banner, signin, captcha]
---

# Page-state meta-detection (cookie banners, signin walls, captchas)

**Predicted change.** Detect common interrupting page-states — cookie banners, signin walls/modals, captcha challenges — as named first-class signals in scan output. Surface them at the top of scan so the agent processes them before reading the element list.

Example output:
```
Page: Amazon.com
URL: https://www.amazon.com
State:
  cookie_banner: present → press("Accept cookies") or press("Reject all") to dismiss
  signin_required: no
  captcha: no
Elements: 47
... (normal scan output)
```

When `signin_required: yes` or `captcha: detected`, the scan output additionally suggests escalation to the user:
```
State:
  signin_required: yes (this page requires login to proceed)
```

**Mechanism.** Detection heuristics:
- **Cookie banner**: visible element matching common patterns — `[role="dialog"]` or fixed-position element containing words like "cookies", "consent", "GDPR", or buttons labeled "Accept all" / "Reject" / "Manage preferences" near the bottom of the viewport. The OneTrust / CookieBot / Cookielaw / Didomi class names are also strong signals.
- **Signin wall**: a `[role="dialog"]` containing a password input, OR a navigation that just landed on a URL containing `/signin`, `/login`, `/auth`, OR a page where the primary content is replaced by a login form. The agent doesn't always know it hit a signin wall; the tool can flag it.
- **Captcha**: presence of a reCAPTCHA / hCaptcha / Cloudflare-Turnstile iframe, or visible challenge text like "Verify you're a human", "Select all images with".

**Predicted outcome.**
- Cold-visit pages with cookie banners: -2 to -3 turns before the agent reaches primary task content (it dismisses the banner immediately instead of rediscovering it).
- Signin-wall pages: the agent escalates to the user faster (or attempts a known auth flow) instead of wandering.
- Captcha pages: the agent stops trying to automate immediately, reports cleanly to user.

**How to test.**
1. Implement detection heuristics, gated behind a flag.
2. Take a curated set of 20-30 popular sites' cold landing pages (no prior session state). Run scan, measure detection accuracy by hand-labeled ground truth.
3. Re-run session tasks that involved cookie/signin walls (25cd64ca for Amazon's checkout wall, plus new task fixtures specifically targeting first-visit Amazon, NYT, GDPR-zone Google).
4. Measure: detection precision (no false positives that block real interactions) > 95%; recall on the curated set > 80%.

**Risks.**
- False positives are worse than false negatives here: incorrectly tagging a modal as "cookie banner" could mislead the agent into dismissing the wrong thing.
- Sites localize banner text (Polish, Japanese, etc.) — detection must lean on structural signals (class names, modal patterns, position) more than text.
- Cookie-banner libraries change shape; the heuristic will need periodic refresh. Document the source as "best-effort, periodically re-validated."

**Related.** Pushback 8 in the 2026-05-12 analysis. Ranked #6 in the hypothesis list there. Lower priority than scan-output structure hypotheses, but high-leverage on cold-visit sessions. Composes with the [find-query-tool](find-query-tool.md) if a banner is detected but the agent wants to read it before dismissing.
