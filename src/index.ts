import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type CDP from "chrome-remote-interface";
import {
  getClient, evaluate, evaluateInFrame, listTabs, switchTab, navigateTo,
  waitForNavigation, serialized, type FrameInfo,
  createBrowserSession, destroyBrowserSession, getSessionClient,
  sessionSerialized, listSessionTabs, switchSessionTab,
} from "./cdp.js";
import { SCANNER_JS, FRAME_SCANNER_JS, GET_RECT_JS, CHECK_JS, RESOLVE_JS, SELECT_JS, READ_JS } from "./scanner.js";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

// ── Session routing ──

async function getEffectiveClient(browser?: string): Promise<CDP.Client> {
  if (browser) return getSessionClient(browser);
  return getClient(CDP_PORT);
}

function effectiveSerialized<T>(browser: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (browser) return sessionSerialized(browser, fn);
  return serialized(fn);
}

// ── Helpers ──

interface ScanEntry {
  id: number; tag: string; label: string; value?: string; inputType?: string;
  placeholder?: string; options?: string[]; checked?: boolean; href?: string;
  scrollContainer?: boolean; scrollMore?: number; affordance?: string;
  x?: number; y?: number; w?: number; h?: number;
}

interface ScanResult {
  url: string;
  title: string;
  groups: Record<string, ScanEntry[]>;
  total: number;
  pageScrollable?: boolean;
}

function formatGroup(entries: ScanEntry[], formatter: (e: ScanEntry) => string): string[] {
  const lines: string[] = [];
  let lastScrollMore: number | null = null;
  let lastScrollLabel: string | null = null;

  for (const e of entries) {
    lines.push(formatter(e));
    if (e.scrollContainer && e.scrollMore) {
      lastScrollMore = e.scrollMore;
      lastScrollLabel = e.label;
    } else if (lastScrollMore !== null && !e.scrollContainer) {
      lines.splice(lines.length - 1, 0, `  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
      lastScrollMore = null;
      lastScrollLabel = null;
    }
  }
  if (lastScrollMore !== null) {
    lines.push(`  ... ${lastScrollMore} more — scroll("${lastScrollLabel}") or expand("${lastScrollLabel}")`);
  }
  return lines;
}

// Strip tracking params from URLs for display. Full URLs are preserved in
// stored element refs — press() uses coordinates, not URLs. The model never
// copies tracking URLs from scan output (verified across all session logs).
//
// Two complementary detections (combo strips if EITHER matches):
//   B: value > 16 chars + no 4-letter lowercase word → hex/base64 tokens
//   A: value > 32 chars + no structure chars → long opaque blobs
// Tested on 9 sites (Google×3, Amazon, Reddit, eBay, Wikipedia, GitHub,
// Booking.com): -28% total chars, zero false positives.
//
// REVISIT IF: models start constructing URLs from scan hrefs instead of using
// press(label) or building URLs from scratch.
function cleanHref(href: string): string {
  const qIdx = href.indexOf("?");
  if (qIdx === -1) return href;
  const path = href.substring(0, qIdx);
  const params = href.substring(qIdx + 1).split("&");
  const kept = params.filter(p => {
    const eq = p.indexOf("=");
    if (eq === -1) return true;
    const val = p.substring(eq + 1);
    // B: short or contains a word → keep
    // A: short or contains structure (spaces, url-encoded separators) → keep
    const hasWord = /[a-z]{4,}/.test(val);
    const hasStructure = /[+]|%20|%3A|%26|%2F|%3D/i.test(val);
    const bStrip = val.length > 16 && !hasWord;
    const aStrip = val.length > 32 && !hasStructure;
    return !(bStrip || aStrip);
  });
  if (kept.length === 0) return path;
  return path + "?" + kept.join("&");
}

function formatScanResult(scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);
  lines.push(`Elements: ${scan.total}`);
  if (scan.pageScrollable) {
    lines.push(`... more below — scroll() for next page`);
  }
  lines.push("");

  if (scan.groups.PRESS?.length > 0) {
    lines.push("PRESS → press(id)");
    lines.push(...formatGroup(scan.groups.PRESS, e => {
      const href = e.href ? ` → ${cleanHref(e.href)}` : "";
      return `  [${e.id}] ${e.tag} "${e.label}"${href}`;
    }));
    lines.push("");
  }

  if (scan.groups.TYPE?.length > 0) {
    lines.push("TYPE → type(id, text)");
    lines.push(...formatGroup(scan.groups.TYPE, e => {
      const val = e.value ? ` value="${e.value}"` : "";
      const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
      return `  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`;
    }));
    lines.push("");
  }

  if (scan.groups.SELECT?.length > 0) {
    lines.push("SELECT → select(id, value)");
    lines.push(...formatGroup(scan.groups.SELECT, e => {
      const opts = e.options?.join(", ") || "";
      return `  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`;
    }));
    lines.push("");
  }

  if (scan.groups.TOGGLE?.length > 0) {
    lines.push("TOGGLE → toggle(id)");
    lines.push(...formatGroup(scan.groups.TOGGLE, e => {
      const state = e.checked ? "✓" : "○";
      return `  [${e.id}] ${e.tag} "${e.label}" ${state}`;
    }));
    lines.push("");
  }

  if (scan.groups.UPLOAD?.length > 0) {
    lines.push("UPLOAD → upload(element, filepath)");
    lines.push(...formatGroup(scan.groups.UPLOAD, e => {
      return `  [${e.id}] input[file] "${e.label}"`;
    }));
    lines.push("");
  }

  return lines.join("\n");
}

async function runScan(browser?: string): Promise<ScanResult> {
  const client = await getEffectiveClient(browser);
  await evaluate(client, `new Promise(resolve => {
    let timer;
    const done = () => { if (obs) obs.disconnect(); resolve(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(done, 400); };
    const obs = new MutationObserver(reset);
    obs.observe(document.body, { childList: true, subtree: true });
    reset();
    setTimeout(done, 4000);
  })`);
  const result = await evaluate(client, SCANNER_JS) as ScanResult;

  // Scan child frames for additional interactive elements
  try {
    const frameElements = await scanFrames(client);
    if (frameElements.length > 0) {
      // Merge frame elements into main scan, storing them with stable IDs
      // in the main page's __webpilot so press/type/toggle can find them
      const mergeResult = await evaluate(client, `((frameEls) => {
        if (!window.__wpIdMap) window.__wpIdMap = new WeakMap();
        if (!window.__wpNextId) window.__wpNextId = 0;
        const added = [];
        for (const fe of frameEls) {
          const id = window.__wpNextId++;
          window.__webpilotRects[id] = { x: fe.x, y: fe.y };
          window.__webpilotLabels[id] = fe.label;
          window.__webpilotAffordances[id] = fe.affordance;
          // No DOM element ref for cross-frame elements — mark as frame element
          window.__webpilot[id] = { __frameElement: true, x: fe.x, y: fe.y };
          added.push({ ...fe, id });
        }
        return added;
      })(${JSON.stringify(frameElements)})`) as ScanEntry[];

      for (const entry of mergeResult) {
        const aff = entry.affordance || "PRESS";
        const group = result.groups[aff];
        if (group) group.push(entry);
      }
      result.total += mergeResult.length;
    }
  } catch {
    // Frame scanning failed — continue with main frame results only
  }

  return result;
}

interface FrameElement {
  tag: string;
  label: string;
  affordance: string;
  x: number;
  y: number;
  value?: string;
  inputType?: string;
  placeholder?: string;
  options?: string[];
  checked?: boolean;
  href?: string;
}

async function scanFrames(client: CDP.Client): Promise<FrameElement[]> {
  // Get frame tree
  let frameTree;
  try {
    const ft = await client.Page.getFrameTree();
    frameTree = ft.frameTree;
  } catch {
    return [];
  }

  const mainFrameId = (frameTree as { frame: { id: string } }).frame.id;
  const allFrames: { frameId: string; parentFrameId?: string }[] = [];

  function collectFrames(node: { frame: { id: string; parentId?: string }; childFrames?: unknown[] }) {
    if (node.frame.id !== mainFrameId) {
      allFrames.push({ frameId: node.frame.id, parentFrameId: node.frame.parentId });
    }
    for (const child of (node.childFrames || []) as typeof node[]) {
      collectFrames(child);
    }
  }
  collectFrames(frameTree as Parameters<typeof collectFrames>[0]);

  if (allFrames.length === 0) return [];

  // Build frame offset chain: for each frame, compute its viewport offset
  // by getting the iframe element's rect in the parent frame
  const frameOffsets = new Map<string, { x: number; y: number }>();
  frameOffsets.set(mainFrameId, { x: 0, y: 0 });

  for (const frame of allFrames) {
    try {
      // Get the iframe element's rect in the parent frame
      const parentId = frame.parentFrameId || mainFrameId;
      const iframeRect = await evaluateInFrame(client, parentId, `(() => {
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          // Match by checking if this iframe's contentWindow corresponds to our target frame
          const r = iframe.getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            return { x: r.left, y: r.top, w: r.width, h: r.height, src: iframe.src || "" };
          }
        }
        return null;
      })()`) as { x: number; y: number } | null;

      // Simple approach: accumulate parent offset + iframe position
      const parentOffset = frameOffsets.get(parentId) || { x: 0, y: 0 };
      if (iframeRect) {
        frameOffsets.set(frame.frameId, {
          x: parentOffset.x + iframeRect.x,
          y: parentOffset.y + iframeRect.y,
        });
      }
    } catch {
      // Frame not accessible
    }
  }

  // Scan each frame
  const allElements: FrameElement[] = [];
  for (const frame of allFrames) {
    const offset = frameOffsets.get(frame.frameId);
    if (!offset) continue;

    try {
      const frameResult = await evaluateInFrame(client, frame.frameId, FRAME_SCANNER_JS) as {
        elements: FrameElement[];
        childIframes: { x: number; y: number }[];
      };

      for (const el of frameResult.elements) {
        allElements.push({
          ...el,
          x: el.x + offset.x,
          y: el.y + offset.y,
        });
      }
    } catch {
      // Frame scan failed — skip
    }
  }

  return allElements;
}

async function snapshotIds(client: CDP.Client): Promise<Set<number>> {
  const ids = await evaluate(client, `Object.keys(window.__webpilotRects || {}).map(Number)`) as number[];
  return new Set(ids || []);
}

function formatDelta(before: Set<number>, result: ScanResult): string {
  const full = formatScanResult(result);
  const entries = [
    ...(result.groups.PRESS || []),
    ...(result.groups.TYPE || []),
    ...(result.groups.SELECT || []),
    ...(result.groups.TOGGLE || []),
  ];
  const newEntries = entries.filter(e => !before.has(e.id));
  if (newEntries.length === 0) return full;

  const lines: string[] = ["NEW:"];
  for (const e of newEntries) {
    const label = e.label ? ` "${(e.label as string).substring(0, 60)}"` : "";
    lines.push(`  [${e.id}] ${e.tag}${label}`);
  }
  lines.push("");
  return lines.join("\n") + "\n" + full;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// ── CDP input primitives ──
// Every interaction goes through these. No DOM manipulation for interaction.

async function cdpClick(client: CDP.Client, x: number, y: number) {
  await client.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function cdpType(client: CDP.Client, text: string) {
  await client.Input.insertText({ text });
}

async function cdpSelectAll(client: CDP.Client) {
  await client.Input.dispatchKeyEvent({ type: "keyDown", key: "a", code: "KeyA", modifiers: 8 });
  await client.Input.dispatchKeyEvent({ type: "keyUp", key: "a", code: "KeyA", modifiers: 8 });
}

async function cdpBackspace(client: CDP.Client) {
  await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Backspace", code: "Backspace" });
  await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Backspace", code: "Backspace" });
}

const KEY_MAP: Record<string, { key: string; code: string }> = {
  enter: { key: "Enter", code: "Enter" },
  tab: { key: "Tab", code: "Tab" },
  escape: { key: "Escape", code: "Escape" },
  backspace: { key: "Backspace", code: "Backspace" },
  delete: { key: "Delete", code: "Delete" },
  arrowup: { key: "ArrowUp", code: "ArrowUp" },
  arrowdown: { key: "ArrowDown", code: "ArrowDown" },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft" },
  arrowright: { key: "ArrowRight", code: "ArrowRight" },
  space: { key: " ", code: "Space" },
  home: { key: "Home", code: "Home" },
  end: { key: "End", code: "End" },
  pageup: { key: "PageUp", code: "PageUp" },
  pagedown: { key: "PageDown", code: "PageDown" },
};

async function cdpKey(client: CDP.Client, keyName: string, modifiers = 0) {
  const mapped = KEY_MAP[keyName.toLowerCase()];
  if (!mapped) throw new Error(`Unknown key: ${keyName}. Available: ${Object.keys(KEY_MAP).join(", ")}`);
  await client.Input.dispatchKeyEvent({ type: "keyDown", ...mapped, modifiers });
  await client.Input.dispatchKeyEvent({ type: "keyUp", ...mapped, modifiers });

  // CDP dispatchKeyEvent fires DOM events but doesn't trigger the browser's
  // default actions (form submit, button activate). Apply them via JS.
  if (modifiers === 0 && keyName.toLowerCase() === "enter") {
    await evaluate(client, `(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return;
      const form = el.closest?.("form");
      if (form) { form.requestSubmit(); return; }
      if (el.tagName === "A" || el.tagName === "BUTTON" ||
          el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
        el.click();
      }
    })()`);
  }

  if (modifiers === 0 && keyName.toLowerCase() === "space") {
    await evaluate(client, `(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return;
      const tag = el.tagName;
      if (tag === "INPUT" && (el.type === "text" || el.type === "search" || el.type === "password")) return;
      if (tag === "TEXTAREA") return;
      if (el.isContentEditable) return;
      if (tag === "BUTTON" || tag === "A" ||
          el.getAttribute("role") === "button" ||
          (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio"))) {
        el.click();
      }
    })()`);
  }
}

async function getRect(client: CDP.Client, id: number): Promise<{ x: number; y: number } | null> {
  // Scroll element into view if needed, then return fresh coordinates
  return await evaluate(client, `(() => {
    const el = window.__webpilot?.[${id}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    // If outside viewport, scroll into view first
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r2 = el.getBoundingClientRect();
      return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`) as { x: number; y: number } | null;
}

async function checkElement(client: CDP.Client, id: number): Promise<{ error?: string; tag?: string; ok?: boolean }> {
  return await evaluate(client, `${CHECK_JS}(${id})`) as { error?: string; tag?: string; ok?: boolean };
}

interface ResolveResult {
  id?: number;
  label?: string;
  match?: string;
  error?: string;
  message?: string;
  options?: { id: number; label: string; affordance: string }[];
}

async function resolveElement(
  client: CDP.Client,
  idOrLabel: number | string,
  affordanceFilter?: string,
): Promise<{ id: number } | { error: string }> {
  if (typeof idOrLabel === "number") {
    const check = await checkElement(client, idOrLabel);
    if (check.error === "not_found") return { error: "Element not found. Run scan first." };
    if (check.error === "stale") return { error: "Element is stale. Run scan again." };
    return { id: idOrLabel };
  }

  const result = await evaluate(
    client,
    `${RESOLVE_JS}(${JSON.stringify(idOrLabel)}, ${affordanceFilter ? JSON.stringify(affordanceFilter) : "null"})`,
  ) as ResolveResult;

  if (result.error === "ambiguous") {
    const opts = result.options!.map(o => `  [${o.id}] "${o.label}"`).join("\n");
    return { error: `Multiple matches for "${idOrLabel}":\n${opts}\nUse a more specific label or pass the id.` };
  }
  if (result.error) return { error: result.message! };

  const check = await checkElement(client, result.id!);
  if (check.error) return { error: `Matched "${result.label}" but element is stale. Run scan again.` };
  return { id: result.id! };
}

// Schema for tools that accept id or label
const elementRef = z.union([
  z.number().describe("Element ID from scan results"),
  z.string().describe("Element label text (matched against scan labels)"),
]);

const browserRef = z.string().optional().describe("Browser session ID from new_browser. Omit for default browser.");

// ── Server ──

const server = new McpServer({
  name: "webpilot",
  version: "0.2.0",
});

server.tool(
  "scan",
  "Scan the current page for all interactive elements, grouped by affordance (PRESS, TYPE, SELECT, TOGGLE). Returns element IDs you can use with press/type/select/toggle tools. Call this first before interacting with any page.",
  { browser: browserRef },
  async ({ browser }) => {
    try {
      return ok(formatScanResult(await runScan(browser)));
    } catch (e) {
      return err(`Scan failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "press",
  "Press a button, click a link, or activate a pressable element. Accepts element id (number) or label text (string).",
  { element: elementRef.describe("Element ID or label text"), browser: browserRef },
  async ({ element, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const resolved = await resolveElement(client, element, "PRESS");
      if ("error" in resolved) return err(resolved.error);
      const id = resolved.id;

      const rect = await getRect(client, id);
      if (!rect) return err("Element coordinates not found. Run scan first.");

      const before = await snapshotIds(client);
      const urlBefore = await evaluate(client, "location.href") as string;
      await cdpClick(client, rect.x, rect.y);

      await new Promise(r => setTimeout(r, 300));
      let navigated = false;
      try {
        const urlAfter = await evaluate(client, "location.href") as string;
        navigated = urlAfter !== urlBefore;
        if (navigated) await waitForNavigation(client);
      } catch {
        await new Promise(r => setTimeout(r, 1000));
        navigated = true;
      }

      try {
        const result = await runScan(browser);
        const text = formatDelta(before, result);
        return ok(`Pressed [${id}].${navigated ? " Page navigated." : ""}\n\n${text}`);
      } catch {
        return ok(`Pressed [${id}]. Page is loading — call scan when ready.`);
      }
    } catch (e) {
      return err(`Press failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "type",
  "Type text into an input field, textarea, or contenteditable element. Accepts element id (number) or label text (string). Optionally press a confirm key (enter/tab/escape) after typing.",
  {
    element: elementRef.describe("Element ID or label text"),
    text: z.string().describe("Text to type into the element"),
    clear: z.boolean().optional().default(true).describe("Clear existing value first (default: true)"),
    confirm: z.string().optional().describe("Key to press after typing to confirm (enter, tab, escape). Use for autocomplete fields."),
    browser: browserRef,
  },
  async ({ element, text, clear, confirm, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const resolved = await resolveElement(client, element, "TYPE");
      if ("error" in resolved) return err(resolved.error);
      const id = resolved.id;

      const rect = await getRect(client, id);
      if (!rect) return err("Element coordinates not found. Run scan first.");

      // Focus via JS — more reliable than CDP click for establishing focus.
      // CDP dispatchMouseEvent doesn't always trigger focus on some pages.
      // Click the element via CDP (for side effects like opening dropdowns),
      // then ensure focus via JS as the authoritative step.
      await cdpClick(client, rect.x, rect.y);
      await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (el && document.activeElement !== el) el.focus();
      })()`);
      await new Promise(r => setTimeout(r, 100));

      if (clear) {
        await cdpSelectAll(client);
        await cdpBackspace(client);
        await new Promise(r => setTimeout(r, 50));
      }

      await cdpType(client, text);

      // Widget inputs (time, date, color, range) ignore insertText
      await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el || el.tagName !== "INPUT") return;
        const widgetTypes = ["time","date","datetime-local","month","week","number","range","color"];
        if (!widgetTypes.includes(el.type)) return;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (set) set.call(el, ${JSON.stringify(text)});
        else el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);

      if (confirm) {
        await new Promise(r => setTimeout(r, 400));
        await cdpKey(client, confirm);
      }

      // Readback: check the target element first, but if it's empty and a
      // different element has focus (swap-on-focus pattern), read that instead.
      const readback = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        const targetVal = (el?.value ?? el?.textContent ?? "").substring(0, 200);
        if (targetVal) return targetVal;
        const active = document.activeElement;
        if (active && active !== el && active !== document.body) {
          return (active.value ?? active.textContent ?? "").substring(0, 200);
        }
        return targetVal;
      })()`) as string;

      return ok(`Typed into [${id}]. Value now: "${readback}"${confirm ? ` (confirmed with ${confirm})` : ""}`);
    } catch (e) {
      return err(`Type failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "select",
  "Select an option from a dropdown. Accepts element id (number) or label text (string).",
  {
    element: elementRef.describe("Element ID or label text"),
    value: z.string().describe("Option text or value to select"),
    browser: browserRef,
  },
  async ({ element, value, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const resolved = await resolveElement(client, element, "SELECT");
      if ("error" in resolved) return err(resolved.error);
      const id = resolved.id;
      const result = await evaluate(client, `${SELECT_JS}(${id}, ${JSON.stringify(value)})`) as {
        ok?: boolean; error?: string; selected?: string; actual?: string;
      };
      if (result.error) return err(result.error);
      return ok(`Selected "${result.selected}" on [${id}]. Showing: "${result.actual}"`);
    } catch (e) {
      return err(`Select failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "toggle",
  "Toggle a checkbox, radio button, or switch. Accepts element id (number) or label text (string).",
  { element: elementRef.describe("Element ID or label text"), browser: browserRef },
  async ({ element, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const resolved = await resolveElement(client, element, "TOGGLE");
      if ("error" in resolved) return err(resolved.error);
      const id = resolved.id;

      const rect = await getRect(client, id);
      if (!rect) return err("Element coordinates not found. Run scan first.");

      await cdpClick(client, rect.x, rect.y);

      // Read back state
      const state = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el) return { checked: false };
        return { checked: el.checked ?? el.getAttribute("aria-checked") === "true" };
      })()`) as { checked: boolean };

      return ok(`Toggled [${id}]. Now: ${state.checked ? "✓ checked" : "○ unchecked"}`);
    } catch (e) {
      return err(`Toggle failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "upload",
  "Upload a file to a file input element. Only works on elements listed under UPLOAD in scan results. Accepts element id (number) or label text (string).",
  {
    element: elementRef.describe("Element ID or label text"),
    filepath: z.string().describe("Absolute path to the file to upload"),
    browser: browserRef,
  },
  async ({ element, filepath, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const resolved = await resolveElement(client, element, "UPLOAD");
      if ("error" in resolved) return err(resolved.error);
      const id = resolved.id;

      // Get the DOM node ID for CDP DOM.setFileInputFiles
      const nodeInfo = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el) return null;
        return { tagName: el.tagName, type: el.type };
      })()`) as { tagName: string; type: string } | null;

      if (!nodeInfo) return err("Element not found. Run scan first.");

      // Use DOM.querySelector to get the backend node ID
      const { root } = await client.DOM.getDocument();
      const { nodeId } = await client.DOM.querySelector({
        nodeId: root.nodeId,
        selector: `input[type="file"]`,
      });

      if (!nodeId) return err("Could not locate file input in DOM.");

      // If there are multiple file inputs, find the right one by matching
      // against our stored element
      const allFileInputs = await evaluate(client, `(() => {
        const inputs = document.querySelectorAll('input[type="file"]');
        const target = window.__webpilot?.[${id}];
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i] === target) return i;
        }
        return 0;
      })()`) as number;

      // Get the right node ID
      const { nodeIds } = await client.DOM.querySelectorAll({
        nodeId: root.nodeId,
        selector: `input[type="file"]`,
      });

      const targetNodeId = nodeIds[allFileInputs] || nodeId;

      await client.DOM.setFileInputFiles({
        files: [filepath],
        nodeId: targetNodeId,
      });

      // Verify by reading back the file name
      const filename = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el || !el.files || el.files.length === 0) return "";
        return el.files[0].name;
      })()`) as string;

      if (filename) {
        return ok(`Uploaded "${filename}" to [${id}].`);
      }
      return ok(`Upload command sent to [${id}]. File: ${filepath.split("/").pop()}`);
    } catch (e) {
      return err(`Upload failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "key",
  `Send a keyboard key press. Use for confirming actions (Enter), dismissing popups (Escape), navigating fields (Tab), or moving through lists (ArrowDown/ArrowUp). Available keys: ${Object.keys(KEY_MAP).join(", ")}. Supports ctrl/shift/alt modifiers.`,
  {
    key: z.string().describe("Key name: enter, tab, escape, backspace, arrowdown, arrowup, space, etc."),
    ctrl: z.boolean().optional().default(false).describe("Hold Ctrl"),
    shift: z.boolean().optional().default(false).describe("Hold Shift"),
    alt: z.boolean().optional().default(false).describe("Hold Alt"),
    browser: browserRef,
  },
  async ({ key, ctrl, shift, alt, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      let modifiers = 0;
      if (alt) modifiers |= 1;
      if (ctrl) modifiers |= 2;
      if (shift) modifiers |= 8;
      await cdpKey(client, key, modifiers);

      await new Promise(r => setTimeout(r, 100));

      // Return focused element context so the model knows where it landed
      const focus = await evaluate(client, `(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "Focus: none";
        const tag = el.tagName.toLowerCase();
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "";
        const val = (el.value ?? el.textContent ?? "").substring(0, 80);
        return "Focus: " + tag + (label ? ' "' + label + '"' : "") + (val ? ' value="' + val + '"' : "");
      })()`) as string;

      const keyName = [alt && "Alt", ctrl && "Ctrl", shift && "Shift", key].filter(Boolean).join("+");
      return ok(`Pressed ${keyName}. ${focus}`);
    } catch (e) {
      return err(`Key failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "read",
  "Read the page content as structured markdown. Preserves headings, links, lists, bold, strikethrough (sale prices). Optionally pass a query to filter for relevant sections only.",
  {
    query: z.string().optional().describe("Filter content to sections matching this text (e.g. 'sale', 'price', 'boots')"),
    browser: browserRef,
  },
  async ({ query, browser }) => {
    try {
      const client = await getEffectiveClient(browser);
      const result = await evaluate(client, `${READ_JS}(${query ? JSON.stringify(query) : "null"})`) as { text: string };
      return ok(result.text);
    } catch (e) {
      return err(`Read failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "navigate",
  "Navigate to a URL. Automatically scans the new page after loading.",
  { url: z.string().describe("URL to navigate to"), browser: browserRef },
  async ({ url, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      await navigateTo(client, url);
      const text = formatScanResult(await runScan(browser));
      return ok(`Navigated to ${url}.\n\n${text}`);
    } catch (e) {
      return err(`Navigation failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "scroll",
  "Scroll down the page or a specific scrollable container. Use when scan shows '... more below' or '... N more' on a list. Re-scans after scrolling.",
  {
    target: z.string().optional().describe("Label of an element inside the scrollable container. If omitted, scrolls the page."),
    browser: browserRef,
  },
  async ({ target, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      if (target) {
        await evaluate(client, `(() => {
          const labels = window.__webpilotLabels || {};
          const q = ${JSON.stringify(target)}.toLowerCase();
          for (const id of Object.keys(labels)) {
            if (labels[id].toLowerCase().includes(q)) {
              const el = window.__webpilot[id];
              if (!el) continue;
              let node = el.parentElement;
              while (node && node !== document.body) {
                const s = getComputedStyle(node);
                if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10) {
                  node.scrollBy({ top: node.clientHeight * 0.8, behavior: "instant" });
                  return;
                }
                node = node.parentElement;
              }
            }
          }
        })()`);
      } else {
        await evaluate(client, `window.scrollBy({ top: window.innerHeight * 0.8, behavior: "instant" })`);
      }
      await new Promise(r => setTimeout(r, 300));
      const text = formatScanResult(await runScan(browser));
      return ok(`Scrolled${target ? ` "${target}"` : ""} down.\n\n${text}`);
    } catch (e) {
      return err(`Scroll failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "expand",
  "Show ALL items in a scrollable list (time picker, dropdown, etc.). Use when scan shows '... N more' on a bounded list. Returns all items from that container.",
  {
    target: z.string().describe("Label of an element inside the scrollable container to expand"),
    browser: browserRef,
  },
  async ({ target, browser }) => effectiveSerialized(browser, async () => {
    try {
      const client = await getEffectiveClient(browser);
      const items = await evaluate(client, `(() => {
        const labels = window.__webpilotLabels || {};
        const q = ${JSON.stringify(target)}.toLowerCase();
        // Find the element matching the label
        for (const id of Object.keys(labels)) {
          if (!labels[id].toLowerCase().includes(q)) continue;
          const el = window.__webpilot[id];
          if (!el) continue;
          // Walk up to find the scroll container
          let node = el.parentElement;
          while (node && node !== document.body) {
            const s = getComputedStyle(node);
            if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10) {
              // Found the scroll container — get ALL clickable children
              const items = [];
              for (const child of node.querySelectorAll("*")) {
                const r = child.getBoundingClientRect();
                if (r.width < 3 || r.height < 3) continue;
                const text = (child.innerText || "").trim().replace(/\\n+/g, " ");
                if (!text || text.length > 80) continue;
                if (child.children.length > 2) continue;
                items.push(text);
              }
              // Deduplicate
              return [...new Set(items)];
            }
            node = node.parentElement;
          }
        }
        return null;
      })()`) as string[] | null;

      if (!items) return err(`No scrollable container found near "${target}".`);
      const text = items.map((item, i) => `  ${item}`).join("\n");
      return ok(`Expanded list near "${target}" (${items.length} items):\n${text}`);
    } catch (e) {
      return err(`Expand failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "tabs",
  "List all open browser tabs with their IDs. Use switch_tab to change the active tab.",
  { browser: browserRef },
  async ({ browser }) => {
    try {
      const tabs = browser ? await listSessionTabs(browser) : await listTabs(CDP_PORT);
      const text = tabs
        .map((t, i) => `[${i}] ${t.title}\n    ${t.url}\n    id: ${t.id}`)
        .join("\n\n");
      return ok(text || "No tabs found.");
    } catch (e) {
      return err(`Tabs failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "switch_tab",
  "Switch to a different browser tab by its ID (from the tabs tool).",
  { tab_id: z.string().describe("Tab ID from the tabs tool output"), browser: browserRef },
  async ({ tab_id, browser }) => {
    try {
      if (browser) await switchSessionTab(browser, tab_id);
      else await switchTab(CDP_PORT, tab_id);
      const text = formatScanResult(await runScan(browser));
      return ok(`Switched tab.\n\n${text}`);
    } catch (e) {
      return err(`Switch failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "new_browser",
  "Launch a new isolated browser instance. Returns a session ID to pass as `browser` to all other tools. Use this for concurrent browser work — each session gets its own Chrome.",
  {},
  async () => {
    try {
      const id = await createBrowserSession();
      return ok(`Browser session started: ${id}\nPass browser="${id}" to all subsequent tool calls.`);
    } catch (e) {
      return err(`Failed to launch browser: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "close_browser",
  "Close a browser session and kill its Chrome instance. Frees resources when done with a concurrent browser task.",
  { browser: z.string().describe("Browser session ID to close") },
  async ({ browser }) => {
    try {
      await destroyBrowserSession(browser);
      return ok(`Browser session ${browser} closed.`);
    } catch (e) {
      return err(`Failed to close browser: ${e instanceof Error ? e.message : e}`);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
