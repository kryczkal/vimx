# /audit-sessions — Find structural tool issues in session transcripts

Read exported agent session logs and identify patterns of tool failure.

## What to do

1. **Find session files.** Check `tools/cursor-export/exported/` for Cursor session exports, or wherever the user points you.

2. **Read every session completely.** Don't skim. The failures are in the details — a type() that returned empty, a scan that missed an element, a press() that hit the wrong target.

3. **For each session, identify:**
   - What was the task?
   - Did it succeed or fail?
   - What tool calls were made?
   - Which ones returned unexpected results?
   - What did the model do in response to failures?

4. **Classify issues by type:**
   - **Tool returned wrong info** — scan missed elements, read showed hidden text, type reported success but field was empty
   - **Missing capability** — needed file upload, canvas reading, iframe access, etc.
   - **Label/resolution failures** — element existed but resolver couldn't find it (wrong affordance, non-Latin text, ambiguous label)
   - **Timing/ordering** — actions raced, scan returned stale data, page hadn't loaded
   - **Model confusion** — scan output was confusing (too many elements, duplicate labels, wrong IDs used)

5. **Rank by impact.** Task-blocking issues first. Then misleading-but-not-blocking. Then cosmetic.

6. **For each issue, note:** Is this already fixed? Is it a known gap? Is it new?

## Philosophy

Session logs are ground truth. They show what actually happens when a model uses the tool, not what we think should happen. Every failure pattern is a potential fix. Read them without ego — the tool is wrong until proven right.
