---
created: 2026-05-13
last_verified: 2026-05-13
type: benchmark
status: planned
tags: [launch, benchmark, category-claim, comparison]
evidence: [../findings/perception-share-of-session-tokens.md, ../findings/chrome-redundancy-floods-scan-output.md, ../findings/custom-widget-thrash.md, ../findings/expose-primitives-not-search-engines.md]
harness: BU-Bench (../../../BU-Bench/)
---

# Vimx Bench v1 — the category benchmark

The point of this benchmark is not to prove vimx is faster. It is to prove that **DOM-dump browser tools and filtering-based browser tools belong to different categories** — that there exist whole classes of web tasks where the dump approach collapses and the filter approach succeeds. If we can't show categorical gaps (≥30pt success-rate deltas vs Playwright-MCP in ≥4 of 6 categories), the category claim is wishful thinking and we go back to incremental wins.

This is pre-registered: predictions in the **Predictions** section are public commitments, not retroactive narrative.

## Thesis

Browser agents are bottlenecked by the wrong abstraction. DOM-dump approaches (Playwright-MCP, Stagehand-by-default) hand the model raw HTML and ask it to compute interactability. Filtering approaches (Vimium, vimx) scan the page once, return only what is visible-and-clickable, and resolve refs against live DOM at action-time.

The wrong abstraction:
- Floods context with structure the model has to re-derive every turn
- Can't tell the model what's foreground vs occluded
- Forces brittle ref tracking through framework re-renders
- Has no native handle on hover-revealed UI, virtualized lists, cross-origin frames, or accessibility-hostile sites

Infinite tokens don't fix the wrong abstraction. They make the gap less visible at the top of the model curve and more painful everywhere else.

## What counts as a "category" claim

A pass-rate edge of 5–10pt is a feature. A pass-rate edge of 30pt+ on whole task classes is a category. We pre-commit to publishing both — average and per-category — and to retracting the category claim if the data doesn't support it.

## Failure-mode taxonomy

Six categories. Each picks a structural weakness of DOM-dump approaches that we expect filtering to dominate.

| Code | Category | Why DOM-dump loses | Why filtering wins |
|---|---|---|---|
| **LBF** | Long branching forms | 50k+ token DOM dumps per page; state across N pages explodes context; conditional reveals between pages cause re-derivation | Per-page scan returns only the visible inputs (≈10× smaller); state is the model's, not regurgitated in every prompt |
| **VL** | Virtualized lists / infinite scroll | Element refs captured pre-scroll point at recycled DOM nodes; clicks land on wrong rows | Re-scan after scroll regenerates refs against current DOM; affordances always tied to live elements |
| **AH** | Accessibility-hostile / legacy UIs | No ARIA, no `<label>`, divs-with-onclick, tables-for-layout — semantic queries miss everything | Hit-test + heuristic visibility detection works regardless of semantic markup; the same affordance types apply to a div as to a `<button>` |
| **MO** | Modal / overlay-heavy SPAs | Every modal sibling-visible in DOM; agent can't tell which layer is foreground; focus traps invisible | `elementFromPoint` confirms only foreground-clickable elements; obscured elements flagged before action |
| **HR** | Hover-revealed UI | Mega-nav children, tooltip actions, hover dropdowns aren't in the DOM until the cursor lands; ref-based clicks fire on empty space | Native `hover` tool surfaces dropdown children, then the next scan picks them up — affordance-typed action surface includes hover by design |
| **XI** | Cross-origin iframes | Most agents skip cross-origin frames or fail silently inside them; Stripe Elements / Calendly / OAuth break the loop | CDP-level frame traversal sees into every frame the user can interact with; same scan model applies inside iframes |

The categories aren't independent — a real task often crosses two (e.g. Notion has modals + virtualized rows). For scoring we tag each task by its **dominant** failure mode and lean tasks toward purity within their category.

## Task list (24 + 6 calibration)

Each task ships with a stable id, start URL, optional fixture, agent prompt, programmatic verifier, action budget, and wall-clock budget. Full task schema is in `Task schema` below.

### Calibration (CB) — every agent should pass these

Establishes the noise floor. If any frontier agent fails calibration tasks, infra is broken before the comparison starts.

| ID | Site | Task |
|---|---|---|
| CB-01 | google.com | Search `weather Tokyo`; return city + current temperature from top result |
| CB-02 | en.wikipedia.org | Open the page for "Claude Shannon"; return his birth year |
| CB-03 | amazon.com | Search `USB-C cable 6ft`; return price of first organic (non-sponsored) result |
| CB-04 | news.ycombinator.com | Return the title of the #1 post on the front page |
| CB-05 | weather.com | Look up forecast for ZIP 10001; return current temperature |
| CB-06 | github.com | Open `microsoft/vscode`; return star count |

### LBF — Long branching forms

Endpoint state matters; the agent must traverse 8–30 pages of branching reveals and not lose state.

- **LBF-01 FreeTaxUSA full return.** Fixture taxpayer: W-2 $65,000, 1099-INT $240, 1099-DIV $180, Schedule C ($12,000 revenue / $3,200 expenses), MFJ, standard deduction, two dependents (ages 8, 11). Sign up for a free account; complete the federal return; reach the page that displays the refund or owed amount. Verifier: page contains a refund value within $200 of ground-truth (cached, re-computed quarterly).
- **LBF-02 Progressive auto quote.** Fixture: 32M, single, ZIP 90024, 2022 Honda Civic LX, VIN 2HGFE2F50NH123456, 12k mi/yr commute, no accidents 5y, 100/300 BI, 50 PD, $500 ded, no PIP. Reach the bindable quote page with 6-month premium displayed. Verifier: page contains `$` + a numeric premium + "6-month" within 50 chars.
- **LBF-03 Healthcare.gov plan eligibility.** Fixture: ZIP 28202 (Charlotte NC), 38M single, $52k expected 2026 household income, no employer offer, no other coverage. Complete the Marketplace application; reach the plan-selection page with ≥5 plan cards visible. Verifier: scan output contains ≥5 plan-card affordances.
- **LBF-04 GEICO renters quote.** Fixture: ZIP 11201 (Brooklyn), $40k personal property, $300k liability, $500 deductible, no claims. Reach the final quote page with annual + monthly premium. Verifier: page contains both monthly and annual `$` values.

### VL — Virtualized lists

Target item is far enough down that the agent must scroll, and the framework recycles DOM nodes.

- **VL-01 Linear backlog needle.** Pre-seeded workspace with 500 issues. Target: "Fix race condition in onboarding webhook" at sort position ≈250. Set priority to Urgent; save. Verifier: Linear GraphQL `issue(id:…) { priority }` returns 1 (Urgent).
- **VL-02 Gmail attachment retrieval.** Fixture inbox with ≈2000 seeded messages. Target: message from `noreply@stripe-fixture.test` dated 2025-11-14 with attachment `invoice-Q4.pdf`. Star the message; download the attachment to the agent's working directory. Verifier: Gmail API `messages.get(id=...)` shows `STARRED` label + local file `invoice-Q4.pdf` exists and SHA matches.
- **VL-03 Notion 1000-row DB edit.** Pre-seeded workspace; database `Customers` with 1000 rows. Target: row "Aurelius Pemberton-Whitlock" at row ≈720. Set Status property to `Done`. Verifier: Notion API confirms `Status == "Done"` on that page.
- **VL-04 GitHub deep-paginated issue.** Real site: `github.com/microsoft/vscode/issues?q=is%3Aissue+is%3Aopen+label%3Abug+sort%3Aupdated-asc`. Open the 17th issue under that sort; add a 👀 reaction. Ground-truth issue ID resolves at run-start (the verifier re-queries the GitHub API with the same query to determine the correct issue ID at scoring time, so site changes don't break the task). Verifier: GitHub API `reactions` lists `eyes` from the test account on the resolved issue.

### AH — Accessibility-hostile / legacy UIs

Sites that ship div-soup with onclick handlers, no ARIA, and 2003-era table layouts.

- **AH-01 TCAD parcel lookup.** Site: `traviscad.org`. Address: `1100 Congress Ave, Austin TX 78701`. Return: 2025 appraised value, 2024 appraised value, legal description. Verifier: structured-output match against ground truth (LLM judge with strict field match).
- **AH-02 NJ MVC REAL ID appointments.** Site: `telegov.njportal.com/njmvc/AppointmentWizard/`. Find the next 3 available REAL ID appointment slots at the nearest MVC office to ZIP 07302. Return: list of (office, date, time) triples. Verifier: each office must be in the known NJ MVC location set; each date ≥ today; each time in HH:MM format.
- **AH-03 FEC contributor lookup.** Site: `fec.gov/data/`. Find individual contributions over $1,000 made by `Sam Bankman-Fried` in the 2020 cycle. Return: list of (recipient, amount, date). Verifier: result set matches cached FEC ground truth (re-pulled quarterly).
- **AH-04 Maricopa County court records.** Site: county clerk records portal (publicly searchable). Find civil case filings from 2024 mentioning party `Acme Corp` (a sentinel name we know returns a stable set). Return: case numbers + filing dates. Verifier: cached ground truth set match.

### MO — Modal / overlay-heavy SPAs

Multi-modal flows. The agent must dismiss / traverse / nest modals correctly.

- **MO-01 Notion database creation.** Create a new page titled `Q1 Roadmap`. Add an inline database with 3 properties: `Date` (date, first row 2026-01-15), `Owner` (select; options Alice/Bob/Carol), `Status` (select; options Backlog/In Progress/Done). Add 5 rows. Switch the view to Board grouped by Status. Share the page with edit access to `editor@fixture.test`. Verifier: Notion API confirms full structure.
- **MO-02 Linear cycle setup.** Create a new cycle for next week (Mon–Sun). Move 5 specific issues (titles in fixture) from backlog into the cycle. Set the cycle goal to `Ship onboarding redesign`. Verifier: Linear API confirms cycle + members + goal.
- **MO-03 Slack DM with file.** Open a DM with `@qa-bot`. Upload a file `sample.txt` (content: `hello world`). Send the message `Final draft attached`. React to your own message with 🎉. Verifier: Slack API confirms all four side-effects.
- **MO-04 Figma file duplicate + move.** In team `Marketing`, locate file `Site v2`. Duplicate it. Rename the duplicate to `Site v3 (draft)`. Move it to project `Drafts`. Verifier: Figma API confirms file existence + name + location.

### HR — Hover-revealed UI

Search-bar usage is explicitly forbidden; the agent must navigate via hover-revealed mega-nav.

- **HR-01 Home Depot drill nav.** Site: `homedepot.com`. Without using the search bar, navigate Tools → Power Tools → Drills → Cordless Drills. Add SKU 2997-22 (Milwaukee M18 Hammer Drill/Impact Driver Kit) to cart. Verifier: cart contains item with SKU 2997-22.
- **HR-02 Costco TV nav.** Site: `costco.com`. Without using search, navigate Electronics → TVs → 65-Inch TVs. Filter to OLED only. Sort by price ascending. Add the cheapest OLED TV to cart. Verifier: cart contains 1 item with `OLED` in title.
- **HR-03 AWS console S3 nav.** Logged-in AWS console. Without using the top search bar, use the `Services` hover menu to reach S3. Create a bucket `vimx-bench-<uuid>` in `us-west-2`, default settings. Verifier: AWS API `s3.list_buckets()` includes the bucket.
- **HR-04 Best Buy laptop nav.** Site: `bestbuy.com`. Without using search, navigate Computers & Tablets → Laptops → MacBooks. Apply filters: RAM ≥16GB, Storage ≥512GB, Color Silver. Add the first result to cart. Verifier: cart contains a MacBook matching the filter set.

### XI — Cross-origin iframes

Iframes from a different origin than the host page. Most agents either skip them or fail silently inside.

- **XI-01 Stripe test checkout.** Fixture demo store using Stripe Elements (we host a tiny Next.js fixture). Complete checkout with card `4242 4242 4242 4242`, exp 12/30, CVC 123, ZIP 12345. Reach payment confirmation. Verifier: page text contains `Payment successful` + order ID matches Stripe API record.
- **XI-02 Stripe 3DS challenge.** Same demo store; card `4000 0027 6000 3184` (3DS required). Complete the 3DS popup; reach confirmation. Verifier: as above.
- **XI-03 Calendly booking.** Site: `calendly.com/vimx-bench-fixture/30min` (we own this event). Book next Friday at 2pm ET; name `Test User`; email `test@fixture.test`. Verifier: Calendly API confirms booking with matching email + slot.
- **XI-04 OAuth sign-in.** Fixture OAuth-protected app we host (`oauth.vimxbench.example`). Sign in via "Sign in with GitHub". Reach the `logged in as <user>` page. Verifier: app session log records successful auth from the test GitHub account.

## Task schema

Each task is a JSON object compatible with BU-Bench's `confirmed_task` shape, with Vimx Bench extension fields the harness picks up via the existing task-loading path.

```json
{
  "task_id": "LBF-01",
  "category": "Vimx Bench/LBF",
  "confirmed_task": "Complete a federal tax return on freetaxusa.com for taxpayer profile [JSON]. Reach the page that displays the refund or owed amount. Do not file.",
  "start_url": "https://www.freetaxusa.com/",
  "fixture": {
    "kind": "embedded",
    "data": { "filing_status": "MFJ", "w2_wages": 65000, "...": "..." }
  },
  "verifier": {
    "kind": "regex_on_final_text",
    "pattern": "Federal\\s+(Refund|Tax\\s+Owed)[:\\s]+\\$([0-9,]+)",
    "ground_truth_band": { "field": "refund", "low": 3800, "high": 4200 }
  },
  "action_budget": 300,
  "wall_clock_budget_s": 1200,
  "expected_difficulty": 4,
  "answer": null
}
```

`verifier.kind` is one of:

- `regex_on_final_text` — apply regex to the agent's final result string; capture groups feed into a band check
- `api_call` — call a Python verifier function (path relative to `BU-Bench/verifiers/`) with the agent trace
- `llm_judge` — fall back to gemini-2.5-flash judge with a per-task rubric prompt
- `composite` — AND/OR of the above

`fixture.kind` is one of:

- `embedded` — data inline in the task
- `seeded` — a fixture-setup script must run before the task (writes test data to Linear/Notion/Gmail/Slack/etc.); script path in `fixture.setup`
- `external` — a long-lived asset we maintain (Calendly event, fixture OAuth app)

## Scoring

For each (agent, task) pair we run **N=3 attempts**. Per attempt we record:

- `passed` ∈ {0, 1}
- `wall_clock_s`
- `tool_calls` (total)
- `total_tokens` (input + output, per the BU-Bench `token_cost_service` plumbing already in `run_eval.py`)
- `cost_usd`

Per-agent aggregates:

- **Pass rate per category** = passes / (4 tasks × 3 attempts) = passes / 12. This is the headline.
- **Median wall-clock** on passed attempts.
- **Median tool calls** on passed attempts.
- **Median tokens** on passed attempts.
- **Median cost** on passed attempts (priced at standard public rates per provider).

Failure attribution (recorded but not used in scoring): for each failed attempt, the LLM judge categorizes the failure into one of: `nav-stuck`, `wrong-element`, `state-loss`, `frame-skip`, `timeout`, `tool-error`, `verification-mismatch`. Powers the post-mortem table.

### Cross-attempt collapse

For the headline pass rate, an attempt counts as passed if the verifier returns true. We report two collapses:
- **Best-of-3** (lenient — does the agent ever succeed?)
- **Mean-of-3** (default headline — robustness)

Both go in the writeup; mean-of-3 is the headline number we cite externally.

## Agents under test

| Agent | Version | Browser backend | Model |
|---|---|---|---|
| **vimx** | current `main` | local headful via CDP (existing vimx path) | claude-sonnet-4-6 |
| **Playwright-MCP** | latest `@playwright/mcp` | bundled | claude-sonnet-4-6 |
| **browser-use** | 0.11.5 (current vendored version) | browser-use cloud | bu-2-0 (default) AND claude-sonnet-4-6 (parity) |
| **Stagehand** | latest | bundled Playwright | claude-sonnet-4-6 |
| **Computer Use** | Anthropic computer-use tool | local headful | claude-sonnet-4-6 |

**Model parity matters.** vimx, Playwright-MCP, Stagehand, and Computer Use all run on claude-sonnet-4-6 — same brain, different bodies. browser-use is reported twice: once on its default bundled model (ecosystem reference) and once on claude-sonnet-4-6 (head-to-head). If the bundled model dominates, that's a model-stack story, not an abstraction story; we want both numbers.

## Harness — what BU-Bench needs

BU-Bench already supports vimx (`vimx_eval.py`), Playwright-MCP (`playwright_eval.py`), and browser-use (built-in). To run Vimx Bench v1 we add:

1. **New task loader.** Today `run_eval.py:91` loads `BU_Bench_V1.enc` via Fernet (key `b"BU_Bench_V1"`). Add `--task-set vimx-bench-v1` flag that loads `wp_bench_v1_tasks.json` (plaintext; no contamination concern — these tasks are novel and we want them indexed by future models so the benchmark stays honest if it stays public).
2. **Verifier dispatch.** New module `BU-Bench/verifiers/__init__.py`: `def verify(task, trace) -> bool`. Switches on `task["verifier"]["kind"]`. Replaces the current judge-only path when a task declares a programmatic verifier; falls back to the existing gemini-judge for `kind: llm_judge`.
3. **Fixture lifecycle.** New module `BU-Bench/fixtures/`. For `kind: seeded` tasks, run a setup script before each attempt (idempotent per workspace state) and tear-down after.
4. **Stagehand adapter.** New `stagehand_eval.py` parallel to `vimx_eval.py`.
5. **Computer Use adapter.** New `computer_use_eval.py`. Uses Anthropic's computer-use tool against the same headful Chrome instance.
6. **Action budget + wall-clock budget enforcement.** Today `TASK_TIMEOUT = 1800` (`run_eval.py:46`) is a global. Switch to per-task `wall_clock_budget_s` from the task spec. Action budget enforced by counting agent.history steps and aborting via the existing `asyncio.wait_for` wrapper.
7. **Failure attribution post-pass.** After each run, a second gemini call categorizes failures into the 7-category schema above. New field on the saved trace JSON.

LOC estimate: ~600 net across `run_eval.py`, two new adapter files, the verifiers module, and the fixtures module. No changes to existing `vimx_eval.py` / `playwright_eval.py` / browser providers.

## Predictions (pre-registered)

These are bets, not summaries. If they're wrong by ≥10pt the writeup admits it.

| Category | vimx | Playwright-MCP | Stagehand | browser-use (claude) | Computer Use |
|---|---|---|---|---|---|
| Calibration | 100% | 100% | 100% | 100% | 95% |
| LBF | 75% | 25% | 50% | 60% | 40% |
| VL | 70% | 15% | 40% | 50% | 30% |
| AH | 65% | 20% | 35% | 45% | 55% |
| MO | 70% | 30% | 50% | 60% | 35% |
| HR | 80% | 10% | 35% | 55% | 40% |
| XI | 75% | 25% | 40% | 55% | 30% |

**Category claim threshold.** vimx must beat Playwright-MCP by ≥30pt in **≥4 of 6** core categories (excluding calibration). Anything less means we're not a category yet — we ship the data, retract the framing, and iterate.

**Secondary token-economy prediction.** On passed attempts, median total tokens for vimx is ≤40% of Playwright-MCP's. This is independent of the success-rate claim and is reported separately; it doesn't gate the category framing.

## What this benchmark does NOT prove

- That filtering > VLM in the long run — Computer Use is included as reference, but the comparison is asymmetric (different model surface, different runtime cost). VL/HR/MO categories tilt against pixel-only approaches by design; AH tilts toward them. The bench measures the cells we care about, not a universal verdict.
- That vimx wins on multi-session, long-horizon, stateful work (auth churn, MFA, account creation in production environments). That's a separate benchmark — Vimx Bench v2 or *Agent Continuity Bench*.
- That vimx wins on tasks where the bottleneck is reasoning, not navigation. We deliberately excluded riddle / trivia tasks from BU-Bench V1 (the GAIA / BrowseComp / Pokemon-defiant set) because they don't test the abstraction.

## Anti-shenanigans

Real-site benchmarks degrade. Counter-measures:

- **Ground-truth refresh.** Verifier outputs that depend on third-party site state (FEC, GitHub queries, county records) re-resolve at run time when possible. Cached-with-quarterly-refresh otherwise.
- **Site-blacklist hygiene.** No agent has site-specific instructions or fine-tuned heuristics. If a vimx release lands a Notion-specific patch and Notion-task numbers jump, that's flagged in the changelog and the task is rotated out of v1.
- **Reproducibility.** Each run dumps the full agent trace + screenshots to `BU-Bench/run_data/<run-key>/`. Re-runnable from the trace alone.
- **Decryption fairness.** Unlike BU-Bench V1, Vimx Bench v1 tasks are plaintext. The trade-off: future training data may include them. We accept this — the benchmark is meant to last 6–12 months, after which we cut v2. Contamination resistance is not free; we'd rather have a transparent, reproducible benchmark for the launch window than an encrypted-but-stale one a year out.

## Launch sequence

- **W1.** Fixtures + verifiers. LBF/AH/HR/XI categories first (most off-the-shelf). Build the 5 fixture sites we own (Stripe demo store, OAuth fixture, Calendly event, NJ MVC handle, ACME-Corp sentinel filings if needed).
- **W2.** VL + MO fixtures. Seed scripts for Linear/Notion/Gmail/Slack test workspaces.
- **W3.** Pilot: 1 task per category × all 5 agents. Debug verifiers, calibrate action/wall-clock budgets, surface fixture flakiness.
- **W4.** Full run: 24 × 3 × 5 = **360 attempts**. ~50–80 hours of wall-clock at MAX_CONCURRENT=3; budget a week with retries.
- **W5.** Analysis + writeup. Per-category breakdown, failure attribution, token-economy supplement, qualitative side-by-side traces for the 6 most diagnostic tasks.
- **W6.** 60-second video. Same agent, same task, vimx vs Playwright-MCP, side-by-side. Recommended task: **LBF-01 FreeTaxUSA** — the context counter on Playwright-MCP explodes visibly while vimx just clicks through the form. The narrative writes itself.
- **W7.** Launch: soft → MCP community (Discord/Slack) → HN → X. Lead with "Vimium for AI agents" + the per-category bar chart.

## Open questions before W1

Picked up at the next planning session — flagged here so they don't get lost.

- **Stagehand vs `claude-sonnet-4-6` model.** Stagehand's `observe`/`act` API is closer to filtering than Playwright-MCP's `aria_snapshot`; we may find Stagehand is the closer rival, not Playwright-MCP. If so, the video foil shifts.
- **Computer Use action budget.** VLM agents take many more actions per task. Capping at the same budget as vimx may unfairly penalize them. Decision: report both capped and uncapped numbers; flag the cap in the chart legend.
- **Should browser-use run with their headless cloud OR local headful?** Cloud is their canonical setup; local headful makes the browser comparison fair. Decision: run both; cloud is the headline number for their column, local headful is a footnoted sensitivity check.
- **Pre-launch dogfooding.** Need 3–5 agent builders running vimx in production before the public launch. The benchmark proves the gap; design-partner quotes prove it matters. Sequence dogfooding ahead of W7 not after.

## Cross-references

- Internal token-economy backing: [perception-share-of-session-tokens](../findings/perception-share-of-session-tokens.md), [chrome-redundancy-floods-scan-output](../findings/chrome-redundancy-floods-scan-output.md)
- Internal failure-mode evidence (custom widgets ↔ HR/MO categories): [custom-widget-thrash](../findings/custom-widget-thrash.md)
- Why we don't ship a "natural-language query" API in vimx (relevant to harness fairness): [expose-primitives-not-search-engines](../findings/expose-primitives-not-search-engines.md)
- Internal benchmark methodology principle (for analogy, not direct apply — internal benchmarks are different from external comparison): [benchmarks-validate-principles-decide](../principles/benchmarks-validate-principles-decide.md)
- Harness home: `../../../BU-Bench/` (sibling repo)
