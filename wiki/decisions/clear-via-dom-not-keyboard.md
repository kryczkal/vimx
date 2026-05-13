---
created: 2026-05-12
last_verified: 2026-05-12
type: decision
code_anchors: [src/index.ts]
tags: [type, clear, cdp, regression-history]
---

# Clear input via DOM value setter, not Ctrl+A keystroke

**The choice.** `type({clear: true})` clears the field by directly setting `element.value = ""` (or `element.textContent = ""` for contenteditable) via the prototype-descriptor setter, then dispatching `input` + `change` events. Not via simulated `Ctrl+A` + `Backspace` keystrokes.

**Why.** CDP's `Input.dispatchKeyEvent` only fires renderer-side DOM events. Browser-level editing-command handlers (the thing that interprets `Ctrl+A` as "select all") live in the Chromium browser process, not the renderer that CDP talks to. **A keystroke-based select-all never selects anything via CDP.**

The previous implementation (`cdpSelectAll + cdpBackspace`) was silently broken in a worse way: it dispatched `Shift+a` (modifier `8` is Shift in CDP, not Ctrl which is `2`). On a non-empty field with `clear:true`, the sequence was:

```
prior:               "Option 1"
cdpSelectAll:        types capital A     → "Option 1A"
cdpBackspace:        deletes one char     → "Option 1"
cdpType("Option A"): insertText at end    → "Option 1Option A"
```

Every `type(clear:true)` call into a non-empty field actually produced `prior + typed`, but agents never noticed because:
1. Most types target empty fields (search bars) where `prior == ""` and `clear` is a no-op
2. When fields *did* have prior content, the readback string ("Value now: ...") presented the bug as a successful type

The Forms session 8bbfd98a "Option AOption 1" shipped-broken case is the exact symptom: agent typed "Option A" with `clear:true` into a field with prior value "Option 1"; got back "Value now: Option AOption 1"; didn't catch it; shipped a broken form.

Surfaced by [anomaly-flag bench](../benchmarks/2026-05-12-anomaly-flag-action-returns.md) when the idempotent-re-type synthetic test ("type 'Option 1' over 'Option 1' on a normal input") fired the heuristic — meaning even a normal input wasn't being cleared.

**How it works.**

```typescript
async function clearField(client: CDP.Client, id: number) {
  await evaluate(client, `(() => {
    const el = window.__vimx?.[${id}];
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, "");
      else el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
}
```

Going through the *prototype descriptor* (not the element's own `.value` property) is important for React/Vue controlled components — those frameworks intercept the React-internal setter, but the native prototype setter dispatches input events the framework's `onChange` handlers pick up to update state.

**Why not other options.**

- **Keep `cdpSelectAll` and fix the modifier (8 → 2).** Tried in the bench iteration; still didn't work because CDP keyboard events don't reach Chromium's editing-command handler. The fix has to go through DOM.
- **Use `Input.dispatchKeyEvent` with `commands: ["selectAll"]`.** CDP supports this, but it's flaky across renderer states and adds an async roundtrip per type. The DOM approach is one synchronous call.
- **Layer the anomaly check without fixing the underlying clear.** The heuristic would catch the bug at the action layer, but every type-with-clear would still error — the agent would constantly have to retry with `clear:false`. Fix the root cause; keep the heuristic as a safety net.

**Source.** Discovered and fixed 2026-05-12 during the anomaly-flag bench. Implementation in `src/index.ts` `clearField()`. The anomaly heuristic remains in place to catch any *other* case where clear genuinely can't work (controlled components that revert via setTimeout, custom elements with shadow DOM, etc.).
