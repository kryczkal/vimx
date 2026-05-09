// Injectable JS derived from Vimium's link_hints.js and dom_utils.js.
// Runs in the browser context via CDP Runtime.evaluate.
//
// The scanner's ONLY job is discovery: find interactive elements and report
// their affordance + screen coordinates. All interaction goes through CDP
// input events (mouse clicks, keyboard input) — never DOM manipulation.

export const SCANNER_JS = `(() => {
  // --- Visibility (from Vimium's DomUtils.getVisibleClientRect + cropRectToVisible) ---

  function cropRectToVisible(rect) {
    const bounded = {
      left: Math.max(rect.left, 0),
      top: Math.max(rect.top, 0),
      right: rect.right,
      bottom: rect.bottom,
      width: Math.min(rect.right, innerWidth) - Math.max(rect.left, 0),
      height: Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0),
    };
    if (bounded.top >= innerHeight - 4 || bounded.left >= innerWidth - 4) return null;
    if (bounded.width < 3 || bounded.height < 3) return null;
    return bounded;
  }

  function getVisibleRect(element) {
    const rects = element.getClientRects();
    for (const raw of rects) {
      if ((raw.width === 0 || raw.height === 0)) {
        for (const child of element.children) {
          const cs = getComputedStyle(child);
          if (cs.float === "none" && !["absolute", "fixed"].includes(cs.position)) continue;
          const childRect = getVisibleRect(child);
          if (childRect && childRect.width >= 3 && childRect.height >= 3) return childRect;
        }
        continue;
      }
      const cropped = cropRectToVisible(raw);
      if (!cropped || cropped.width < 3 || cropped.height < 3) continue;
      const cs = getComputedStyle(element);
      if (cs.visibility !== "visible") continue;
      return cropped;
    }
    return null;
  }

  // --- Element classification (from Vimium's DomUtils) ---

  const UNSELECTABLE_INPUT_TYPES = new Set([
    "button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"
  ]);

  function isTypeable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return !el.disabled && !el.readOnly;
    if (tag === "input") {
      if (el.disabled || el.readOnly) return false;
      return !UNSELECTABLE_INPUT_TYPES.has((el.type || "text").toLowerCase());
    }
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    if (role === "textbox") return true;
    return false;
  }

  function isSelectable(el) {
    return el.tagName.toLowerCase() === "select" && !el.disabled;
  }

  function isToggleable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.type || "").toLowerCase();
      return type === "checkbox" || type === "radio";
    }
    const role = (el.getAttribute("role") || "").toLowerCase();
    return role === "checkbox" || role === "radio" || role === "switch" ||
           role === "menuitemcheckbox" || role === "menuitemradio";
  }

  function getAffordance(el) {
    if (isTypeable(el)) return "TYPE";
    if (isSelectable(el)) return "SELECT";
    if (isToggleable(el)) return "TOGGLE";
    return "PRESS";
  }

  // --- Clickability detection (from Vimium's getLocalHintsForElement) ---

  function checkAngularJs(el) {
    if (!document.getElementsByClassName("ng-scope").length) return false;
    for (const prefix of ["", "data-", "x-"]) {
      for (const sep of ["-", ":", "_"]) {
        if (el.hasAttribute(prefix + "ng" + sep + "click")) return true;
      }
    }
    return false;
  }

  function isClickable(el) {
    const tag = el.tagName.toLowerCase();
    if (!tag) return false;

    const ariaDisabled = el.getAttribute("aria-disabled");
    if (ariaDisabled && ["", "true"].includes(ariaDisabled.toLowerCase())) return false;

    if (el.hasAttribute("onclick")) return true;
    if (checkAngularJs(el)) return true;

    const role = (el.getAttribute("role") || "").toLowerCase();
    const clickableRoles = [
      "button", "tab", "link", "checkbox", "menuitem",
      "menuitemcheckbox", "menuitemradio", "radio", "textbox"
    ];
    if (clickableRoles.includes(role)) return true;

    const ce = el.getAttribute("contentEditable");
    if (ce != null && ["", "contenteditable", "true"].includes(ce.toLowerCase())) return true;

    if (el.hasAttribute("jsaction")) {
      const rules = el.getAttribute("jsaction").split(";");
      for (const rule of rules) {
        const parts = rule.trim().split(":");
        if (parts.length >= 1 && parts.length <= 2) {
          const eventType = parts.length === 1 ? "click" : parts[0].trim();
          const ns = (parts.length === 1 ? parts[0] : parts[1]).trim().split(".")[0];
          if (eventType === "click" && ns !== "none") return true;
        }
      }
    }

    switch (tag) {
      case "a": return true;
      case "textarea": return !el.disabled && !el.readOnly;
      case "input": {
        const type = (el.getAttribute("type") || "").toLowerCase();
        return type !== "hidden" && !el.disabled;
      }
      case "button":
      case "select": return !el.disabled;
      case "object":
      case "embed": return true;
      case "label": return el.control != null && !el.control.disabled;
      case "details": return true;
      case "summary": return true;
      case "div":
      case "ol":
      case "ul":
        return el.clientHeight < el.scrollHeight && el.scrollHeight - el.clientHeight > 10;
    }

    const tabIdx = el.getAttribute("tabindex");
    if (tabIdx != null && parseInt(tabIdx) >= 0) return true;

    const cls = (el.getAttribute("class") || "").toLowerCase();
    if (cls.includes("button") || cls.includes("btn")) return true;

    return false;
  }

  // --- Label extraction (from Vimium's generateLinkText) ---

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      if (el.labels && el.labels.length > 0) {
        let lt = el.labels[0].textContent.trim();
        if (lt.endsWith(":")) lt = lt.slice(0, -1);
        return lt.substring(0, 80);
      }
      if (el.type === "file") return "Choose File";
      if (el.type !== "password") {
        return (el.value || el.placeholder || el.getAttribute("aria-label") || el.name || "").substring(0, 80);
      }
      return el.getAttribute("aria-label") || el.placeholder || "password";
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.substring(0, 80);
    if (tag === "a" && !el.textContent.trim() && el.querySelector("img")) {
      const img = el.querySelector("img");
      return (img.alt || img.title || "").substring(0, 80);
    }
    const text = el.textContent?.trim();
    if (text) return text.substring(0, 80);
    if (el.getAttribute("title")) return el.getAttribute("title").substring(0, 80);
    if (el.getAttribute("placeholder")) return el.getAttribute("placeholder").substring(0, 80);
    return "";
  }

  // --- Main scan ---

  function getAllElements(root, elements) {
    if (!elements) elements = [];
    for (const el of root.querySelectorAll("*")) {
      elements.push(el);
      if (el.shadowRoot) getAllElements(el.shadowRoot, elements);
    }
    return elements;
  }

  const elements = getAllElements(document.documentElement);
  const hints = [];
  // __webpilotRects stores the click-target coordinates for every element.
  // All interaction uses these coords via CDP input events.
  window.__webpilot = [];
  window.__webpilotRects = {};
  window.__webpilotLabels = {};
  window.__webpilotAffordances = {};
  let id = 0;

  for (const el of elements) {
    if (!isClickable(el)) continue;
    const rect = getVisibleRect(el);
    if (!rect) continue;
    hints.push({ el, rect, id });
  }

  // Scan same-origin iframes for editable elements invisible to the main DOM.
  // The input target lives in the iframe; the visible surface is in the main doc.
  // We find the iframe, then walk UP to its nearest visible ancestor for coords.
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const iDoc = iframe.contentDocument;
      if (!iDoc) continue;
      const editables = iDoc.querySelectorAll('[contenteditable="true"], [role="textbox"]');
      if (editables.length === 0) continue;

      // Walk from the iframe up through the main document ancestors to find
      // a visible element large enough to be the editor surface.
      let visibleRect = null;
      let node = iframe;
      while (node) {
        const r = node.getBoundingClientRect();
        const cropped = cropRectToVisible(r);
        if (cropped && cropped.width > 50 && cropped.height > 50) {
          visibleRect = cropped;
          break;
        }
        node = node.parentElement;
      }
      if (!visibleRect) continue;

      for (const el of editables) {
        const label = el.getAttribute("aria-label") || "editor";
        hints.push({ el, rect: visibleRect, id, iframeEditor: true, label });
      }
    } catch(e) {}
  }

  // False positive filtering (Vimium's descendant check)
  const filtered = [];
  const hintsByEl = new Map();
  for (const h of hints) hintsByEl.set(h.el, h);

  for (let i = hints.length - 1; i >= 0; i--) {
    const hint = hints[i];
    if (hint.iframeEditor) { filtered.push(hint); continue; }
    const tag = hint.el.tagName.toLowerCase();
    const cls = (hint.el.getAttribute("class") || "").toLowerCase();
    const isPossibleFP = tag === "span" || cls.includes("button") || cls.includes("btn");

    if (isPossibleFP) {
      let dominated = false;
      const children = hint.el.querySelectorAll("*");
      for (const child of children) {
        if (hintsByEl.has(child) && child !== hint.el) {
          dominated = true;
          break;
        }
      }
      if (dominated) continue;
    }
    filtered.push(hint);
  }
  filtered.reverse();

  // Overlap detection (Vimium's elementFromPoint check) — skip for iframe editors
  const results = [];
  for (const hint of filtered) {
    if (hint.iframeEditor) { results.push(hint); continue; }
    const r = hint.rect;
    const midX = r.left + r.width * 0.5;
    const midY = r.top + r.height * 0.5;
    const found = document.elementFromPoint(midX, midY);
    if (!found) continue;
    if (!(hint.el.contains(found) || found.contains(hint.el))) {
      let cornerHit = false;
      for (const y of [r.top + 0.1, r.top + r.height - 0.1]) {
        for (const x of [r.left + 0.1, r.left + r.width - 0.1]) {
          const el2 = document.elementFromPoint(x, y);
          if (el2 && (hint.el.contains(el2) || el2.contains(hint.el))) {
            cornerHit = true;
            break;
          }
        }
        if (cornerHit) break;
      }
      if (!cornerHit) continue;
    }
    results.push(hint);
  }

  // Build output grouped by affordance
  const groups = { PRESS: [], TYPE: [], SELECT: [], TOGGLE: [] };
  for (const hint of results) {
    const el = hint.el;
    const r = hint.rect;

    // Force iframe editor elements to TYPE regardless of main-doc classification
    const affordance = hint.iframeEditor ? "TYPE" : getAffordance(el);
    const tag = hint.iframeEditor ? "editor" : el.tagName.toLowerCase();
    const label = hint.iframeEditor ? hint.label : getLabel(el);
    const entry = { id: id, tag, label };

    if (affordance === "TYPE") {
      if (!hint.iframeEditor) {
        entry.value = el.value || el.textContent?.trim().substring(0, 200) || "";
        entry.inputType = (el.type || "text").toLowerCase();
        if (el.placeholder) entry.placeholder = el.placeholder;
      } else {
        entry.inputType = "editor";
      }
    } else if (affordance === "SELECT") {
      entry.value = el.value || "";
      entry.options = Array.from(el.options || []).map(o => o.textContent?.trim() || o.value).slice(0, 30);
    } else if (affordance === "TOGGLE") {
      entry.checked = !!el.checked;
      if (el.getAttribute("role")) {
        entry.checked = el.getAttribute("aria-checked") === "true";
      }
    } else {
      if (tag === "a" && el.href) {
        try {
          const url = new URL(el.href);
          entry.href = url.pathname + url.search + url.hash;
        } catch(e) {
          entry.href = el.getAttribute("href") || "";
        }
      }
    }

    window.__webpilot[id] = el;
    window.__webpilotRects[id] = {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
    window.__webpilotLabels[id] = label;
    window.__webpilotAffordances[id] = affordance;
    groups[affordance].push(entry);
    id++;
  }

  return {
    url: location.href,
    title: document.title,
    groups,
    total: id,
  };
})()`;

// Resolves a label string to an element ID. Supports exact, then substring match.
// If affordanceFilter is set, only matches elements of that affordance type.
export const RESOLVE_JS = `((query, affordanceFilter) => {
  const labels = window.__webpilotLabels;
  const affordances = window.__webpilotAffordances;
  if (!labels) return { error: "not_found", message: "No scan data. Run scan first." };

  const q = query.toLowerCase();
  const ids = Object.keys(labels).map(Number);
  const candidates = affordanceFilter
    ? ids.filter(id => affordances[id] === affordanceFilter)
    : ids;

  // Exact match (case-insensitive)
  const exact = candidates.filter(id => labels[id].toLowerCase() === q);
  if (exact.length === 1) return { id: exact[0], label: labels[exact[0]], match: "exact" };

  // Substring match
  const sub = candidates.filter(id => labels[id].toLowerCase().includes(q));
  if (sub.length === 1) return { id: sub[0], label: labels[sub[0]], match: "substring" };
  if (sub.length > 1 && sub.length <= 5) {
    return {
      error: "ambiguous",
      message: "Multiple matches for '" + query + "'",
      options: sub.map(id => ({ id, label: labels[id], affordance: affordances[id] })),
    };
  }

  // Reverse substring: label is contained in query
  const rev = candidates.filter(id => q.includes(labels[id].toLowerCase()) && labels[id].length > 0);
  if (rev.length === 1) return { id: rev[0], label: labels[rev[0]], match: "reverse" };

  if (sub.length > 5) {
    return { error: "too_many", message: sub.length + " matches for '" + query + "'. Be more specific." };
  }

  return { error: "not_found", message: "No element matching '" + query + "'." };
})`;

// Returns { x, y } click coordinates for an element, or null if not found.
export const GET_RECT_JS = `((id) => {
  return window.__webpilotRects?.[id] ?? null;
})`;

// Check if element exists and is connected. Returns tag name or error.
export const CHECK_JS = `((id) => {
  const el = window.__webpilot?.[id];
  if (!el) return { error: "not_found" };
  if (!el.isConnected) return { error: "stale" };
  return { tag: el.tagName.toLowerCase(), ok: true };
})`;

export const SELECT_JS = `((id, value) => {
  const el = window.__webpilot?.[id];
  if (!el) return { error: "Element not found. Run scan first." };
  if (!el.isConnected) return { error: "Element is stale. Run scan again." };
  const tag = el.tagName.toLowerCase();
  if (tag !== "select") return { error: "Element is not a <select>." };
  const option = Array.from(el.options).find(o => o.value === value || o.textContent.trim() === value);
  if (!option) {
    const available = Array.from(el.options).map(o => o.textContent.trim());
    return { error: "Option not found. Available: " + JSON.stringify(available) };
  }
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (set) set.call(el, option.value);
  else el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selected: option.textContent.trim(), actual: el.options[el.selectedIndex]?.textContent?.trim() };
})`;

export const READ_JS = `(() => {
  const main = document.querySelector("main") || document.querySelector("article");
  if (main) return { text: main.innerText.substring(0, 8000) };

  let best = document.body;
  let bestLen = 0;
  for (const el of document.querySelectorAll("div, section")) {
    const len = el.innerText?.length || 0;
    if (len > bestLen && len < 50000) {
      bestLen = len;
      best = el;
    }
  }
  return { text: best.innerText.substring(0, 8000) };
})()`;
