# /debug-element — Why doesn't the scanner see this element?

An element exists on the page but doesn't appear in the scan. Trace why.

## What to do

1. **Find the element in the DOM.** Use CDP to query for it by selector, text content, or aria-label. Confirm it exists.

2. **Walk through the scanner's pipeline:**

   a. **isClickable check** — Does it pass? Check: tag name, onclick, role, tabindex, jsaction, contentEditable, cursor:pointer. If it fails here, the scanner never considers it.

   b. **SKIP_TAGS** — Is the tag in the skip list (svg, img, path, script, etc.)? These are excluded before any other check.

   c. **getVisibleRect** — Does it have a visible bounding rect?
      - `getBoundingClientRect()` — width > 3, height > 3?
      - `cropRectToVisible` — inside the viewport?
      - `getComputedStyle().visibility === "visible"`?
      - If 0x0: is it a lazy-rendered widget (Gmail To field)? Inside an iframe?

   d. **Scroll container** — Is it off-screen inside a scroll container? Our scanner only includes off-screen items from containers < 50% viewport.

   e. **False positive filter** — Is it a non-semantic element (div/span) whose parent contains a clickable child? The dedup filter removes it.

   f. **Overlap detection** — Does `elementFromPoint(center)` return this element or a descendant/ancestor? If not, it's considered occluded. Check shadow DOM boundaries.

   g. **Affordance classification** — It passed all filters but ended up in the wrong group (PRESS vs TYPE vs TOGGLE). Check isTypeable, isSelectable, isToggleable.

   h. **Label extraction** — It's in the scan but with an empty or wrong label. Check getLabel: labels[0].textContent, aria-label, innerText, synthetic fallbacks.

3. **Report which step failed** and what the element's actual state is at that step.

## Common causes

- **0x0 rect** — lazy widget, hidden until focused (Gmail To, Google Flights Gotowe)
- **Inside iframe** — scanner only finds contenteditable in same-origin iframes, not form elements (fixed with frame scanning)
- **opacity:0** — scanner skips these (they pass isClickable but fail getVisibleRect). read() tags them as [hidden].
- **Shadow DOM** — elementFromPoint doesn't descend into shadow roots (fixed with deepElementFromPoint)
- **CSS cursor not pointer** — element made clickable via addEventListener without cursor:pointer styling

## Philosophy

The scanner is a pipeline. Debug it like a pipeline — find which stage rejects the element and why. Don't guess. Check each stage with actual DOM data.
