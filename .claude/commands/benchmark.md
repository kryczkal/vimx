# /benchmark — Test a change against real websites

You just made a change to webpilot. Now prove it works.

## What to do

1. **Read the diff.** `git diff HEAD~1` or the staged changes. Understand WHAT changed — scanner, formatter, tool handler, read walker, etc.

2. **Pick metrics that matter for THIS change.** Don't measure everything. Examples:
   - Changed label extraction? → measure label quality (empty labels, duplicate labels, label length)
   - Changed URL display? → measure token count of hrefs before/after
   - Changed element filtering? → measure element counts by tag type
   - Changed disambiguation? → measure unique vs duplicate labels
   - Changed read()? → measure content quality (hidden text leaking, structure preserved)
   - Changed affordance classification? → check misclassified elements

3. **Pick 5-10 diverse sites.** Always include:
   - 2 Google properties (Search, Flights, Gmail, Maps, Calendar)
   - 1 e-commerce (Amazon, eBay, Booking)
   - 1 content site (Wikipedia, HN, Reddit, BBC)
   - 1 dev tool (GitHub, Stack Overflow, MDN, NPM)
   - Sites where the change is most likely to regress

4. **Run the scanner** on each site via `CDP_PORT=9222 node dist/index.js` with navigate + scan. Collect the relevant metrics.

5. **Report as a table.** Site | Before | After | Change. Flag regressions.

6. **Check for regressions specifically.** Did anything get WORSE? Elements that were found before but aren't now? Labels that were clean but are now garbled? Actions that worked but now fail?

## Philosophy

The benchmark exists to catch regressions and validate improvements. It is NOT a dashboard. It measures what's relevant to the change you just made. If you can't articulate what metric matters, you don't understand the change well enough to ship it.
