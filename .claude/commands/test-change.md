# /test-change — Before/after comparison of the current change

Show the concrete difference your change makes on real websites.

## What to do

1. **Stash current changes.** `git stash`
2. **Build the old version.** `npx tsc`
3. **Run the relevant measurement** on 3-5 sites (see /benchmark for how to pick sites and metrics).
4. **Pop the stash.** `git stash pop`
5. **Build the new version.** `npx tsc`
6. **Run the same measurement** on the same sites.
7. **Show side-by-side.** For each site, show the BEFORE and AFTER output for the specific thing that changed. Not just numbers — show actual element labels, scan excerpts, or tool responses.

## When to use

Before committing. After you think a change works but haven't verified it doesn't regress. When the user asks "show me before and after."

## Philosophy

Numbers without examples are meaningless. "Element count dropped 15%" tells you nothing. "The Compose button disappeared from Gmail" tells you everything. Always show concrete examples alongside metrics.
