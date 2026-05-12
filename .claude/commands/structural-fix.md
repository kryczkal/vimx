# /structural-fix — Think before coding

You've identified a problem. Before writing any code, go through this process.

## What to do

1. **State the problem in one sentence.** If you can't, you don't understand it yet.

2. **Why is it a problem?** What fails, what breaks, what confuses the model? Show a concrete example from a real website.

3. **What's the option space?** List at least 3 different approaches. For each:
   - What it does
   - What it costs (complexity, tokens, performance)
   - What it risks (regressions, edge cases)
   - When it fails

4. **Test the hypothesis BEFORE implementing.** Run the detection/heuristic on 50+ real sites via CDP. Show the data. Don't guess — measure.
   - "I think ancestor text will disambiguate" → test it on HN, Amazon, Google, GitHub, Reddit
   - "I think opacity:0 elements are always hidden junk" → check Amazon (prices are opacity:0)
   - "I think containers >50% viewport are feeds" → check Gmail (sidebar is 30% but also a feed)

5. **Pick the approach** based on data, not intuition. The approach with fewest false positives wins, even if it catches fewer true positives. Precision over recall — wrong actions are worse than missed actions.

6. **Ship, test on real sites, iterate**

## Philosophy

Computation is cheap. Network I/O is expensive. Heuristics are fragile. Data beats intuition. The right structural fix is the one that works on 20 websites, not the one that's elegant in theory.

Test broadly
