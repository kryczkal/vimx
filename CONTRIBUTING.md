# Contributing to webpilot

Thanks for the interest. A few short rules.

## DCO sign-off

Every commit must be signed off — meaning the commit message ends with:

```
Signed-off-by: Your Name <your.email@example.com>
```

This is the [Developer Certificate of Origin](https://developercertificate.org/) — a lightweight statement that you wrote the patch (or have the right to contribute it) under this project's MIT license. The repo's DCO check enforces this on PRs.

Easiest way: `git commit -s` adds the sign-off line automatically. To configure it globally:

```
git config --global format.signoff true
```

## Scope of contributions

webpilot is the *primitive* — affordance-typed browser actions over a Vimium-derived scanner. Contributions that fit the kernel:

- Scanner heuristics (visibility, clickability, region detection)
- New affordance types or action primitives
- CDP-level performance improvements
- Bug fixes with a regression test, benchmark, or session analysis

Out of scope for the kernel (file an issue first to discuss):

- Agent loops or planning logic
- LLM-specific integrations or prompt engineering
- Site-specific patches (Notion handler, Slack handler, etc.) — these belong in adapter packages, not the kernel

## Code style and tests

See `CLAUDE.md` for the architecture overview. The `audit/` directory has the benchmark scripts; the `wiki/` documents design decisions and the project's epistemic discipline (hypotheses → benchmarks → findings → decisions). New features should land with a benchmark, a regression check, or a session-analysis page.

## License and relicense

By contributing under DCO sign-off you agree your patch is licensed under the project's MIT license. The project may relicense to Apache 2.0 in the future under conditions documented in [`wiki/decisions/license-mit-with-relicense-trigger.md`](wiki/decisions/license-mit-with-relicense-trigger.md). DCO sign-off provides the contributor authority needed for that relicense without re-soliciting individual consent.
