---
created: 2026-05-12
last_verified: 2026-05-12
type: finding
evidence: [sessions/2026-05-12-cursor-export-17-sessions.md]
tags: [scan, custom-widgets, dropdown, keyboard]
---

# Custom-widget thrash

**Claim.** Custom dropdowns / menus / comboboxes (the ones that aren't native `<select>` elements) are the single most expensive failure pattern in vimx sessions. The scan output doesn't distinguish "real button" from "menu trigger that opens with Enter/Space" — so the agent tries every tool in sequence before stumbling onto keyboard navigation.

**Evidence.**
- Session 5a47ec04 (YouTube Music privacy dropdown, lines 287-447): six failed attempts in order — `scroll → press("Private") → read({regex}) → expand → select → finally key(arrowdown, enter)`. The actual mechanism (open with click, navigate with arrows, commit with Enter) was the *last* thing tried. Net cost: ~10 wasted turns on one widget.
- Session d1f51c1a (Google Forms question-type picker): similar pattern. Agent tries `press` on the menu items before opening the menu, then `expand` (fails — not a scrollable container), then `select` (fails — not a `<select>`), then `scroll` (closes the menu), before finally landing on click + arrow keys.
- Across the 10 vimx-dominant sessions, every long session contains at least one widget-thrash episode.

**Implication.** Vimx can't currently tell the agent "this is a custom dropdown that opens with Enter/Space and navigates with arrows." Two complementary fixes:
- **Tag the trigger.** During scan, detect `aria-haspopup`, `aria-expanded`, `role="combobox"`, `role="listbox"` and surface a semantic hint (`combobox-trigger`, `menu-opener`) — see [predicted-effect-annotations](../hypotheses/predicted-effect-annotations.md).
- **Better error recovery.** When `press` succeeds but the agent then fails repeatedly to access children, the next failure message could hint at keyboard navigation explicitly. (Not yet filed as a hypothesis; lower leverage than tagging the trigger.)

This finding is the most concrete vindication of the "predictive perception" gap described in [agents-have-no-state-prediction](agents-have-no-state-prediction.md): if scan told the agent "[177] combobox-trigger → opens listbox; navigate with arrows", the trial-and-error never happens.
