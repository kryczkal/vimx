Simulate the user/agent experience of a proposed feature before implementing it.

Target: $ARGUMENTS

If $ARGUMENTS is empty, look at the most recent feature, tool, or behavior change discussed in the conversation.

---

## What this does

You are a design reviewer. Your job is to walk through exactly what the user or agent will experience — the literal inputs they provide and outputs they see — before any code is written. This catches structural mistakes that code review cannot.

## Process

### 1. Understand the feature

Read relevant code to understand the current system. Identify:
- What exists today
- What the proposed change adds or modifies
- Who the user is (human, AI agent, API consumer)

### 2. Identify the state machine

Every feature has states and transitions. Make them explicit:
- What states can the system be in?
- What moves it between states?
- What happens in each state when the user does something unexpected?

Present this as a simple table or list — not a diagram. Keep it tight.

### 3. Simulate each scenario

For each scenario, show the **exact** inputs and outputs as the user would see them. Not descriptions — literal text. Format as a conversation:

```
→ tool_name(param: value)
← Exact response text the user would see.
   Every line of it.
```

Cover these scenarios in order:
- **Happy paths** — the thing works as intended (2-3 scenarios)
- **Decision points** — where the user must choose, show both/all branches
- **Wrong-state interactions** — user does X when the system is in state Y
- **Edge cases** — empty input, already-done, concurrent, timeout
- **Control case** — the existing behavior still works (no false positives)

### 4. Challenge the structure

After simulating, ask yourself:
- Does the user have enough information to make the right decision?
- Is there a scenario where the system does something the user didn't intend?
- Could a different split of responsibility (auto vs manual, eager vs lazy, one tool vs two) eliminate a failure mode?
- Is the user doing unnecessary work? (Extra round-trips, confirming obvious things)

If you find a structural issue, say what it is and what the alternative looks like. Show the alternative's simulation too.

### 5. Present

Give the user:
1. The state machine (short)
2. All simulated scenarios
3. Any structural issues found
4. Your recommendation: build as designed, or change the approach

## Rules

- **Show, don't describe.** "The user would see an error" is wrong. Show the exact error text.
- **Simulate from the user's perspective.** They don't see internal state. They see tool responses.
- **Every scenario must be complete.** Start to finish, including what happens after.
- **Question the defaults.** If every scenario auto-accepts something, ask whether the user should decide. If the user must always confirm something obvious, ask whether it should be automatic.
- **Stay in simulation.** Do not write code, create files, or implement anything. Your only output is the simulation and your assessment.