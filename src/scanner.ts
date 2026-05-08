// Injectable JS derived from Vimium's link_hints.js and dom_utils.js.
// Runs in the browser context via CDP Runtime.evaluate.

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
        // Check for floated/absolute children (Vimium's trick)
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

  // --- Affordance assignment ---

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

    // jsaction (Google's event system)
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

    // tabindex
    const tabIdx = el.getAttribute("tabindex");
    if (tabIdx != null && parseInt(tabIdx) >= 0) return true;

    // Class name heuristic (Vimium's "button"/"btn" check)
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
  window.__webpilot = [];
  window.__webpilotIframes = {};
  let id = 0;

  for (const el of elements) {
    if (!isClickable(el)) continue;
    const rect = getVisibleRect(el);
    if (!rect) continue;
    hints.push({ el, rect, id });
  }

  // Scan same-origin iframes for editable elements (Google Docs, TinyMCE, etc.)
  // These editors hide a contenteditable inside an offscreen iframe for keystroke
  // capture. The visible editor surface is usually a sibling element (canvas, div).
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const iDoc = iframe.contentDocument;
      if (!iDoc) continue;
      const editables = iDoc.querySelectorAll('[contenteditable="true"], [role="textbox"]');
      if (editables.length === 0) continue;

      // The iframe itself may be offscreen (Google Docs puts it at top:-10000).
      // Find the visible editor surface — look for known editor containers.
      const editorSelectors = [
        ".kix-appview-editor",       // Google Docs
        ".kix-page",                 // Google Docs page
        "[role='textbox']",          // Generic ARIA textbox
        ".editor-container",         // Common pattern
        "[contenteditable='true']",  // Direct contenteditable in main doc
        "canvas",                    // Canvas-based editors
      ];
      let visibleRect = null;
      for (const sel of editorSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          const cropped = cropRectToVisible(r);
          if (cropped && cropped.width > 50 && cropped.height > 50) {
            visibleRect = cropped;
            break;
          }
        }
      }

      // Fallback: use iframe rect if it's actually visible
      if (!visibleRect) {
        const iframeR = iframe.getBoundingClientRect();
        const cropped = cropRectToVisible(iframeR);
        if (cropped && cropped.width > 3 && cropped.height > 3) {
          visibleRect = cropped;
        }
      }

      if (!visibleRect) continue;

      for (const el of editables) {
        const label = el.getAttribute("aria-label") || el.getAttribute("role") || "editor";
        hints.push({ el, rect: visibleRect, id, iframe: true });
      }
    } catch(e) {
      // Cross-origin iframe — skip
    }
  }

  // False positive filtering (Vimium's descendant check)
  const filtered = [];
  const hintsByEl = new Map();
  for (const h of hints) hintsByEl.set(h.el, h);

  for (let i = hints.length - 1; i >= 0; i--) {
    const hint = hints[i];
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

  // Overlap detection (Vimium's elementFromPoint check)
  const results = [];
  for (const hint of filtered) {
    const r = hint.rect;
    const midX = r.left + r.width * 0.5;
    const midY = r.top + r.height * 0.5;
    const found = document.elementFromPoint(midX, midY);
    if (!found) continue;
    if (!(hint.el.contains(found) || found.contains(hint.el))) {
      // Check corners
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
    const affordance = getAffordance(el);
    const tag = el.tagName.toLowerCase();
    const label = getLabel(el);
    const entry = { id: id, tag, label };

    if (affordance === "TYPE") {
      entry.value = el.value || el.textContent?.trim().substring(0, 200) || "";
      entry.inputType = (el.type || "text").toLowerCase();
      if (el.placeholder) entry.placeholder = el.placeholder;
    } else if (affordance === "SELECT") {
      entry.value = el.value || "";
      entry.options = Array.from(el.options || []).map(o => o.textContent?.trim() || o.value).slice(0, 30);
    } else if (affordance === "TOGGLE") {
      entry.checked = !!el.checked;
      if (el.getAttribute("role")) {
        entry.checked = el.getAttribute("aria-checked") === "true";
      }
    } else {
      // PRESS
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
    if (hint.iframe) {
      window.__webpilotIframes[id] = true;
      entry.iframe = true;
    }
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

export const PRESS_JS = `((id) => {
  const el = window.__webpilot?.[id];
  if (!el) return { error: "Element not found. Run scan first." };
  if (!el.isConnected) return { error: "Element is stale (DOM changed). Run scan again." };
  el.click();
  return { ok: true };
})`;

export const TYPE_JS = `((id, text, clearFirst) => {
  const el = window.__webpilot?.[id];
  if (!el) return { error: "Element not found. Run scan first." };
  if (!el.isConnected) return { error: "Element is stale. Run scan again." };

  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

  const isContentEditable = el.isContentEditable && el.tagName.toLowerCase() !== "input" && el.tagName.toLowerCase() !== "textarea";
  const isInput = el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea";

  if (clearFirst) {
    if (isContentEditable) {
      // Select all content and delete it
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete", false);
    } else if (isInput) {
      // Use native setter to clear — triggers React's internal tracking
      const proto = el.tagName.toLowerCase() === "textarea"
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(el, "");
      } else {
        el.value = "";
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
  }

  if (isContentEditable) {
    // execCommand triggers the full browser input pipeline:
    // beforeinput → input → DOM mutation — exactly what LinkedIn, Slack, etc. expect
    document.execCommand("insertText", false, text);
  } else if (isInput) {
    // Native setter trick: set value through the prototype setter so React's
    // value tracking sees it as a real change, not a programmatic override
    const proto = el.tagName.toLowerCase() === "textarea"
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return { ok: true, value: el.value ?? el.textContent?.substring(0, 200) };
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
  el.value = option.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: option.textContent.trim() };
})`;

export const TOGGLE_JS = `((id) => {
  const el = window.__webpilot?.[id];
  if (!el) return { error: "Element not found. Run scan first." };
  if (!el.isConnected) return { error: "Element is stale. Run scan again." };
  el.click();
  const checked = el.checked ?? el.getAttribute("aria-checked") === "true";
  return { ok: true, checked };
})`;

export const READ_JS = `(() => {
  // Try <main>, then <article>, then largest text block
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
