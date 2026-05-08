import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type CDP from "chrome-remote-interface";
import { getClient, evaluate, listTabs, switchTab, navigateTo, waitForNavigation, serialized } from "./cdp.js";
import { SCANNER_JS, GET_RECT_JS, CHECK_JS, SELECT_JS, READ_JS } from "./scanner.js";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

// ── Helpers ──

interface ScanResult {
  url: string;
  title: string;
  groups: Record<string, { id: number; tag: string; label: string; value?: string; inputType?: string; placeholder?: string; options?: string[]; checked?: boolean; href?: string }[]>;
  total: number;
}

function formatScanResult(scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);
  lines.push(`Elements: ${scan.total}`);
  lines.push("");

  if (scan.groups.PRESS?.length > 0) {
    lines.push("PRESS → press(id)");
    for (const e of scan.groups.PRESS) {
      const href = e.href ? ` → ${e.href}` : "";
      lines.push(`  [${e.id}] ${e.tag} "${e.label}"${href}`);
    }
    lines.push("");
  }

  if (scan.groups.TYPE?.length > 0) {
    lines.push("TYPE → type(id, text)");
    for (const e of scan.groups.TYPE) {
      const val = e.value ? ` value="${e.value}"` : "";
      const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
      lines.push(`  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`);
    }
    lines.push("");
  }

  if (scan.groups.SELECT?.length > 0) {
    lines.push("SELECT → select(id, value)");
    for (const e of scan.groups.SELECT) {
      const opts = e.options?.join(", ") || "";
      lines.push(`  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`);
    }
    lines.push("");
  }

  if (scan.groups.TOGGLE?.length > 0) {
    lines.push("TOGGLE → toggle(id)");
    for (const e of scan.groups.TOGGLE) {
      const state = e.checked ? "✓" : "○";
      lines.push(`  [${e.id}] ${e.tag} "${e.label}" ${state}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function runScan(): Promise<string> {
  const client = await getClient(CDP_PORT);
  const result = await evaluate(client, SCANNER_JS) as ScanResult;
  return formatScanResult(result);
}

// Waits for DOM mutations to settle, then scans. Handles SPA transitions
// where the page has existing elements but new ones are still rendering.
async function waitForDomSettle(client: CDP.Client, timeoutMs = 4000): Promise<void> {
  await evaluate(client, `new Promise(resolve => {
    let timer;
    const done = () => { if (obs) obs.disconnect(); resolve(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(done, 400); };
    const obs = new MutationObserver(reset);
    obs.observe(document.body, { childList: true, subtree: true });
    reset();
    setTimeout(done, ${timeoutMs});
  })`);
}

async function scanWithRetry(): Promise<string> {
  const client = await getClient(CDP_PORT);
  await waitForDomSettle(client);
  return runScan();
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
}

async function getRect(client: CDP.Client, id: number): Promise<{ x: number; y: number } | null> {
  return await evaluate(client, `${GET_RECT_JS}(${id})`) as { x: number; y: number } | null;
}

async function checkElement(client: CDP.Client, id: number): Promise<{ error?: string; tag?: string; ok?: boolean }> {
  return await evaluate(client, `${CHECK_JS}(${id})`) as { error?: string; tag?: string; ok?: boolean };
}

// ── Server ──

const server = new McpServer({
  name: "webpilot",
  version: "0.2.0",
});

server.tool(
  "scan",
  "Scan the current page for all interactive elements, grouped by affordance (PRESS, TYPE, SELECT, TOGGLE). Returns element IDs you can use with press/type/select/toggle tools. Call this first before interacting with any page.",
  {},
  async () => {
    try {
      return ok(await runScan());
    } catch (e) {
      return err(`Scan failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "press",
  "Press a button, click a link, or activate a pressable element. Only works on elements listed under PRESS in scan results. Automatically re-scans after pressing.",
  { id: z.number().describe("Element ID from scan results (PRESS group)") },
  async ({ id }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
      const check = await checkElement(client, id);
      if (check.error === "not_found") return err("Element not found. Run scan first.");
      if (check.error === "stale") return err("Element is stale (page changed). Run scan again.");

      const rect = await getRect(client, id);
      if (!rect) return err("Element coordinates not found. Run scan first.");

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
        const text = await scanWithRetry();
        return ok(`Pressed [${id}] (${check.tag}).${navigated ? " Page navigated." : ""}\n\n${text}`);
      } catch {
        return ok(`Pressed [${id}] (${check.tag}). Page is loading — call scan when ready.`);
      }
    } catch (e) {
      return err(`Press failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "type",
  "Type text into an input field, textarea, or contenteditable element. Only works on elements listed under TYPE in scan results.",
  {
    id: z.number().describe("Element ID from scan results (TYPE group)"),
    text: z.string().describe("Text to type into the element"),
    clear: z.boolean().optional().default(true).describe("Clear existing value first (default: true)"),
  },
  async ({ id, text, clear }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
      const check = await checkElement(client, id);
      if (check.error === "not_found") return err("Element not found. Run scan first.");
      if (check.error === "stale") return err("Element is stale. Run scan again.");

      const rect = await getRect(client, id);
      if (!rect) return err("Element coordinates not found. Run scan first.");

      await cdpClick(client, rect.x, rect.y);
      await new Promise(r => setTimeout(r, 150));

      if (clear) {
        await cdpSelectAll(client);
        await cdpBackspace(client);
        await new Promise(r => setTimeout(r, 50));
      }

      await cdpType(client, text);

      // Widget inputs (time, date, color, range) ignore insertText —
      // their native picker UI intercepts input. Fall back to JS value set.
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

      return ok(`Typed into [${id}]. Text: "${text.substring(0, 80)}"`);
    } catch (e) {
      return err(`Type failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "select",
  "Select an option from a dropdown. Only works on elements listed under SELECT in scan results.",
  {
    id: z.number().describe("Element ID from scan results (SELECT group)"),
    value: z.string().describe("Option text or value to select"),
  },
  async ({ id, value }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
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
  "Toggle a checkbox, radio button, or switch. Only works on elements listed under TOGGLE in scan results.",
  { id: z.number().describe("Element ID from scan results (TOGGLE group)") },
  async ({ id }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
      const check = await checkElement(client, id);
      if (check.error === "not_found") return err("Element not found. Run scan first.");
      if (check.error === "stale") return err("Element is stale. Run scan again.");

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
  "key",
  `Send a keyboard key press. Use for confirming actions (Enter), dismissing popups (Escape), navigating fields (Tab), or moving through lists (ArrowDown/ArrowUp). Available keys: ${Object.keys(KEY_MAP).join(", ")}. Supports ctrl/shift/alt modifiers.`,
  {
    key: z.string().describe("Key name: enter, tab, escape, backspace, arrowdown, arrowup, space, etc."),
    ctrl: z.boolean().optional().default(false).describe("Hold Ctrl"),
    shift: z.boolean().optional().default(false).describe("Hold Shift"),
    alt: z.boolean().optional().default(false).describe("Hold Alt"),
  },
  async ({ key, ctrl, shift, alt }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
      let modifiers = 0;
      if (alt) modifiers |= 1;
      if (ctrl) modifiers |= 2;
      if (shift) modifiers |= 8;
      await cdpKey(client, key, modifiers);
      return ok(`Pressed ${[alt && "Alt", ctrl && "Ctrl", shift && "Shift", key].filter(Boolean).join("+")}`);
    } catch (e) {
      return err(`Key failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "read",
  "Read the text content of the current page. Extracts main content area, article, or largest text block. Use for reading articles, results, or any non-interactive content.",
  {},
  async () => {
    try {
      const client = await getClient(CDP_PORT);
      const result = await evaluate(client, READ_JS) as { text: string };
      return ok(result.text);
    } catch (e) {
      return err(`Read failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "navigate",
  "Navigate to a URL. Automatically scans the new page after loading.",
  { url: z.string().describe("URL to navigate to") },
  async ({ url }) => serialized(async () => {
    try {
      const client = await getClient(CDP_PORT);
      await navigateTo(client, url);
      const text = await scanWithRetry();
      return ok(`Navigated to ${url}.\n\n${text}`);
    } catch (e) {
      return err(`Navigation failed: ${e instanceof Error ? e.message : e}`);
    }
  }),
);

server.tool(
  "tabs",
  "List all open browser tabs with their IDs. Use switch_tab to change the active tab.",
  {},
  async () => {
    try {
      const tabs = await listTabs(CDP_PORT);
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
  { tab_id: z.string().describe("Tab ID from the tabs tool output") },
  async ({ tab_id }) => {
    try {
      await switchTab(CDP_PORT, tab_id);
      const text = await scanWithRetry();
      return ok(`Switched tab.\n\n${text}`);
    } catch (e) {
      return err(`Switch failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
