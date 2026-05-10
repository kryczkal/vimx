// This file contains code derived from Vimium
// (https://github.com/philc/vimium), specifically link_hints.js and
// dom_utils.js. Used under the MIT License:
//
//   Copyright (c) 2010 Phil Crosby, Ilya Sukhar
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the "Software"),
//   to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense,
//   and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
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

  // Check if element is inside a SMALL scroll container (dropdown, picker, panel).
  // Skips large scroll areas (email lists, feeds) — those are main content, not
  // bounded option lists. Threshold: container height < 50% of viewport.
  function getScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const overflowY = style.overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight + 10 &&
          node.clientHeight < innerHeight * 0.5) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // For elements inside scroll containers: return a rect even if off-viewport.
  // We just need non-zero dimensions — the tools will scrollIntoView before clicking.
  function getRect(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) return null;
    const cs = getComputedStyle(element);
    if (cs.display === "none" || cs.visibility !== "visible") return null;
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
             width: rect.width, height: rect.height };
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

  function isUploadable(el) {
    return el.tagName.toLowerCase() === "input" && (el.type || "").toLowerCase() === "file";
  }

  function getAffordance(el) {
    if (isTypeable(el)) return "TYPE";
    if (isUploadable(el)) return "UPLOAD";
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

  const SKIP_TAGS = new Set(["path","circle","rect","line","polyline","polygon","ellipse","g","use","defs","clippath","mask","pattern","image","text","tspan","symbol","marker","img","svg","br","hr","head","meta","link","script","style","noscript"]);

  function isClickable(el) {
    const tag = el.tagName.toLowerCase();
    if (!tag) return false;
    if (SKIP_TAGS.has(tag)) return false;

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
      case "label": return false;
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

  // --- Label extraction (from Vimium's generateLinkText + synthetic fallbacks) ---

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();

    // Input-specific: associated <label>, then value/placeholder/aria
    if (tag === "input") {
      if (el.labels && el.labels.length > 0) {
        let lt = el.labels[0].textContent.trim();
        if (lt.endsWith(":")) lt = lt.slice(0, -1);
        if (lt) return lt.substring(0, 80);
      }
      if (el.type === "file") return "Choose File";
      if (el.type !== "password") {
        const v = el.value || el.placeholder || el.getAttribute("aria-label") || el.name || "";
        if (v) return v.substring(0, 80);
      } else {
        const v = el.getAttribute("aria-label") || el.placeholder || "password";
        if (v) return v.substring(0, 80);
      }
    }

    // Semantic labels (developer-intended)
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.substring(0, 80);

    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy);
      if (ref?.textContent?.trim()) return ref.textContent.trim().substring(0, 80);
    }

    const title = el.getAttribute("title");
    if (title) return title.substring(0, 80);

    // Image alt inside links
    if (tag === "a" && el.querySelector("img")) {
      const img = el.querySelector("img");
      const alt = img.alt || img.title;
      if (alt) return alt.substring(0, 80);
    }

    // Visible text only — innerText skips display:none, visibility:hidden,
    // and 0-dimension elements. Newlines collapsed to spaces so container
    // elements get a single-line summary of their visible sub-content.
    const text = el.innerText?.trim().replace(/\\n+/g, " ").replace(/ +/g, " ");
    if (text) return text.substring(0, 80);

    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.substring(0, 80);

    // --- Synthetic fallbacks for elements with no visible text ---

    // Data attributes (tooltips, titles)
    for (const attr of ["data-tooltip", "data-title", "data-label", "data-original-title"]) {
      const v = el.getAttribute(attr);
      if (v) return v.substring(0, 80);
    }

    // SVG <title> child
    const svgTitle = el.querySelector("svg > title, svg title");
    if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim().substring(0, 80);

    // Link href path
    if (tag === "a" && el.href) {
      try {
        const path = new URL(el.href).pathname;
        const seg = path.split("/").filter(Boolean).pop();
        if (seg && seg.length > 1 && seg.length < 40) return seg.replace(/[-_]/g, " ");
      } catch(e) {}
    }

    // Element id or name, cleaned (camelCase → words, kebab → words)
    const elId = el.id || el.getAttribute("name");
    if (elId && elId.length > 1 && elId.length < 40) {
      return elId.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    }

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

  // Stable ID assignment via WeakMap. Same DOM node → same ID across rescans.
  // WeakMap entries vanish when the element is GC'd (removed from DOM).
  // Full navigation resets JS context → fresh start from 0.
  if (!window.__wpIdMap) window.__wpIdMap = new WeakMap();
  if (!window.__wpNextId) window.__wpNextId = 0;

  function stableId(el) {
    if (window.__wpIdMap.has(el)) return window.__wpIdMap.get(el);
    const id = window.__wpNextId++;
    window.__wpIdMap.set(el, id);
    return id;
  }

  window.__webpilot = {};
  window.__webpilotRects = {};
  window.__webpilotLabels = {};
  window.__webpilotAffordances = {};

  // Track scroll containers and their off-screen item counts for annotations
  const scrollContainerCounts = new Map();

  for (const el of elements) {
    if (!isClickable(el)) continue;
    const rect = getVisibleRect(el);
    if (rect) {
      hints.push({ el, rect, id: stableId(el) });
      continue;
    }
    // Off-screen: count for annotation but don't add to scan
    const scrollParent = getScrollParent(el);
    if (scrollParent) {
      scrollContainerCounts.set(scrollParent, (scrollContainerCounts.get(scrollParent) || 0) + 1);
    }
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
        hints.push({ el, rect: visibleRect, id: stableId(el), iframeEditor: true, label });
      }
    } catch(e) {}
  }

  // Noise reduction: skip container elements that wrap clickable children.
  // A div containing a button is not itself an action — the button is.
  // Semantic elements (a, button, input, select, textarea) are never skipped.
  const SEMANTIC = new Set(["a","button","input","select","textarea","summary","details","label"]);
  const filtered = [];
  const hintsByEl = new Map();
  for (const h of hints) hintsByEl.set(h.el, h);

  for (let i = hints.length - 1; i >= 0; i--) {
    const hint = hints[i];
    if (hint.iframeEditor) { filtered.push(hint); continue; }
    const tag = hint.el.tagName.toLowerCase();
    const role = (hint.el.getAttribute("role") || "").toLowerCase();

    // Semantic elements and elements with explicit roles always survive
    if (SEMANTIC.has(tag) || role) {
      filtered.push(hint);
      continue;
    }

    // Non-semantic elements (div, span, etc.): skip if they contain
    // a clickable child — the child is the real action target.
    // Exception: keep if it has cursor:pointer and NO clickable child —
    // it might be a JS-only button (addEventListener without DOM signals).
    let hasClickableChild = false;
    for (const child of hint.el.querySelectorAll("*")) {
      if (hintsByEl.has(child) && child !== hint.el) {
        hasClickableChild = true;
        break;
      }
    }
    if (hasClickableChild) continue;

    // Leaf non-semantic element with no clickable children: keep only if
    // it has cursor:pointer (likely intentionally interactive) or has
    // meaningful text content (likely a styled button/link).
    const hasCursor = getComputedStyle(hint.el).cursor === "pointer";
    const hasText = (hint.el.innerText || "").trim().length > 0;
    if (!hasCursor && !hasText) continue;

    filtered.push(hint);
  }
  filtered.reverse();

  // Descend into shadow roots to find the deepest element at a point.
  // document.elementFromPoint stops at shadow boundaries — this continues.
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const deeper = el.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === el) break;
      el = deeper;
    }
    return el;
  }

  function elContains(a, b) {
    if (a.contains(b)) return true;
    // Check across shadow boundaries
    let node = b;
    while (node) {
      if (node === a) return true;
      node = node.parentNode || node.host;
    }
    return false;
  }

  // Overlap detection — uses shadow-aware elementFromPoint
  const results = [];
  for (const hint of filtered) {
    if (hint.iframeEditor) { results.push(hint); continue; }
    const r = hint.rect;
    const midX = r.left + r.width * 0.5;
    const midY = r.top + r.height * 0.5;
    const found = deepElementFromPoint(midX, midY);
    if (!found) continue;
    if (!(elContains(hint.el, found) || elContains(found, hint.el))) {
      let cornerHit = false;
      for (const y of [r.top + 0.1, r.top + r.height - 0.1]) {
        for (const x of [r.left + 0.1, r.left + r.width - 0.1]) {
          const el2 = deepElementFromPoint(x, y);
          if (el2 && (elContains(hint.el, el2) || elContains(el2, hint.el))) {
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
  const groups = { PRESS: [], TYPE: [], SELECT: [], TOGGLE: [], UPLOAD: [] };
  for (const hint of results) {
    const el = hint.el;
    const r = hint.rect;

    // Force iframe editor elements to TYPE regardless of main-doc classification
    const affordance = hint.iframeEditor ? "TYPE" : getAffordance(el);
    const tag = hint.iframeEditor ? "editor" : el.tagName.toLowerCase();
    const label = hint.iframeEditor ? hint.label : getLabel(el);
    const id = hint.id;
    const entry = { id, tag, label };

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

    // Tag elements inside scroll containers for annotation grouping
    const sp = getScrollParent(el);
    if (sp && scrollContainerCounts.has(sp)) {
      entry.scrollContainer = true;
      entry.scrollMore = scrollContainerCounts.get(sp);
    }

    groups[affordance].push(entry);
  }

  const total = Object.keys(window.__webpilotRects).length;
  const pageScrollable = document.documentElement.scrollHeight > innerHeight + 50;
  return {
    url: location.href,
    title: document.title,
    groups,
    total,
    pageScrollable,
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

  // No match in target affordance — check ALL affordances for a cross-affordance hint
  if (affordanceFilter) {
    const allExact = ids.filter(id => labels[id].toLowerCase() === q);
    if (allExact.length > 0) {
      const aff = affordances[allExact[0]];
      const tool = aff === "TYPE" ? "type" : aff === "TOGGLE" ? "toggle" : aff === "SELECT" ? "select" : aff === "UPLOAD" ? "upload" : "press";
      return { error: "wrong_tool", message: "'" + query + "' is a " + aff + " element. Use " + tool + "() instead." };
    }
    const allSub = ids.filter(id => labels[id].toLowerCase().includes(q));
    if (allSub.length > 0 && allSub.length <= 3) {
      const hints = allSub.map(id => affordances[id] + ': "' + labels[id].substring(0, 40) + '"');
      return { error: "wrong_tool", message: "'" + query + "' not found in this tool. Found in: " + hints.join(", ") };
    }
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

export const READ_JS = `((query) => {
  const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","SVG","PATH","META","LINK","BR"]);
  const BLOCK = new Set(["P","DIV","SECTION","ARTICLE","HEADER","FOOTER","MAIN","LI","TR","TD","TH","DT","DD","BLOCKQUOTE","FIGCAPTION","DETAILS","SUMMARY"]);
  const MAX = 12000;

  function visState(el) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return "skip";
    if (s.opacity === "0") return "hidden";
    if (!el.offsetParent && el.tagName !== "BODY" && el.tagName !== "HTML") return "skip";
    return "visible";
  }

  function walk(node, out, depth, parentHidden) {
    if (out.length > MAX) return;
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (t) {
        if (parentHidden) out.push("\\n[hidden] " + t);
        else out.push(t);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (SKIP.has(tag)) return;
    const vis = visState(node);
    if (vis === "skip") return;
    const isHidden = parentHidden || vis === "hidden";

    // Headings
    const hMatch = tag.match(/^H([1-6])$/);
    if (hMatch) {
      const text = node.textContent.trim();
      if (text) out.push("\\n" + "#".repeat(parseInt(hMatch[1])) + " " + text + "\\n");
      return;
    }

    // Links
    if (tag === "A") {
      const text = node.textContent.trim();
      const href = node.getAttribute("href") || "";
      if (text && href && !href.startsWith("javascript:")) {
        out.push("[" + text.substring(0, 80) + "](" + href.substring(0, 120) + ")");
      } else if (text) {
        out.push(text);
      }
      return;
    }

    // Images
    if (tag === "IMG") {
      const alt = node.alt || node.title;
      if (alt) out.push("![" + alt.substring(0, 60) + "]");
      return;
    }

    // List items
    if (tag === "LI") {
      out.push("\\n- ");
    }

    // Table rows — walk into cells, add newlines between rows
    if (tag === "TR") {
      out.push("\\n");
    }

    // Strong/bold
    if (tag === "STRONG" || tag === "B") {
      const text = node.textContent.trim();
      if (text) out.push("**" + text + "**");
      return;
    }

    // Emphasis
    if (tag === "EM" || tag === "I") {
      const text = node.textContent.trim();
      if (text) out.push("*" + text + "*");
      return;
    }

    // Strikethrough (useful for sale prices)
    if (tag === "DEL" || tag === "S") {
      const text = node.textContent.trim();
      if (text) out.push("~~" + text + "~~");
      return;
    }

    // Block elements get newlines
    if (BLOCK.has(tag)) out.push("\\n");

    for (const child of node.childNodes) {
      walk(child, out, depth + 1, isHidden);
    }

    if (BLOCK.has(tag)) out.push("\\n");
  }

  // Find root: main > article > largest section > body
  let root = document.querySelector("main")
    || document.querySelector("article")
    || document.querySelector("[role=main]");
  if (!root) {
    root = document.body;
  }

  const parts = [];
  walk(root, parts, 0, false);
  let md = parts.join(" ")
    .replace(/ +/g, " ")
    .replace(/\\n +/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  // If query provided, extract relevant sections
  if (query) {
    const q = query.toLowerCase();
    const lines = md.split("\\n");
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 5);
        matches.push(lines.slice(start, end).join("\\n"));
      }
    }
    if (matches.length > 0) {
      md = "Found " + matches.length + " sections matching '" + query + "':\\n\\n" + matches.join("\\n---\\n");
    }
  }

  return { text: md.substring(0, MAX) };
})`;

// Lightweight scanner injected into each iframe via CDP frame targeting.
// Returns elements with frame-relative coordinates — the caller offsets them.
export const FRAME_SCANNER_JS = `(() => {
  const SKIP_TAGS = new Set(["path","circle","rect","line","polyline","polygon","ellipse","g","use","defs","clippath","mask","pattern","image","text","tspan","symbol","marker","img","svg","br","hr","head","meta","link","script","style","noscript"]);
  const UNSELECTABLE = new Set(["button","checkbox","color","file","hidden","image","radio","reset","submit"]);

  function isTypeable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return !el.disabled && !el.readOnly;
    if (tag === "input") {
      if (el.disabled || el.readOnly) return false;
      return !UNSELECTABLE.has((el.type || "text").toLowerCase());
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function isToggleable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") return el.type === "checkbox" || el.type === "radio";
    const role = (el.getAttribute("role") || "").toLowerCase();
    return ["checkbox","radio","switch"].includes(role);
  }

  function getAffordance(el) {
    if (isTypeable(el)) return "TYPE";
    if (el.tagName.toLowerCase() === "input" && (el.type || "").toLowerCase() === "file") return "UPLOAD";
    if (el.tagName.toLowerCase() === "select" && !el.disabled) return "SELECT";
    if (isToggleable(el)) return "TOGGLE";
    return "PRESS";
  }

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && el.labels?.length > 0) {
      let lt = el.labels[0].textContent.trim();
      if (lt.endsWith(":")) lt = lt.slice(0, -1);
      if (lt) return lt.substring(0, 80);
    }
    if (tag === "input" && el.type !== "password") {
      return (el.value || el.placeholder || el.getAttribute("aria-label") || el.name || "").substring(0, 80);
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.substring(0, 80);
    const text = (el.innerText || "").trim().replace(/\\n+/g, " ").replace(/ +/g, " ");
    if (text) return text.substring(0, 80);
    return el.getAttribute("title") || el.getAttribute("placeholder") || el.id || "";
  }

  const results = [];
  const els = document.querySelectorAll("a, button, input, select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=textbox], [contenteditable=true], [tabindex]");

  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === "label") continue;
    if (el.disabled) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible") continue;

    const affordance = getAffordance(el);
    const label = getLabel(el);
    const entry = {
      tag, label, affordance,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      w: rect.width,
      h: rect.height,
    };

    if (affordance === "TYPE") {
      entry.value = el.value || "";
      entry.inputType = (el.type || "text").toLowerCase();
      if (el.placeholder) entry.placeholder = el.placeholder;
    } else if (affordance === "SELECT") {
      entry.value = el.value || "";
      entry.options = Array.from(el.options || []).map(o => o.textContent?.trim() || o.value).slice(0, 30);
    } else if (affordance === "TOGGLE") {
      entry.checked = !!el.checked || el.getAttribute("aria-checked") === "true";
    } else if (tag === "a" && el.href) {
      try {
        entry.href = new URL(el.href).pathname + new URL(el.href).search;
      } catch(e) {
        entry.href = el.getAttribute("href") || "";
      }
    }

    results.push(entry);
  }

  // Also check for nested iframes (report their rects for recursive scanning)
  const childIframes = [];
  for (const iframe of document.querySelectorAll("iframe")) {
    const r = iframe.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) {
      childIframes.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
  }

  return { elements: results, childIframes };
})()`;
