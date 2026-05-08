import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getClient, evaluate, listTabs, switchTab, navigateTo, waitForNavigation, ensureBrowser } from "./cdp.js";
import { SCANNER_JS, PRESS_JS, TYPE_JS, SELECT_JS, TOGGLE_JS, READ_JS } from "./scanner.js";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

interface ScanResult {
  url: string;
  title: string;
  groups: {
    PRESS: ScanEntry[];
    TYPE: ScanEntry[];
    SELECT: ScanEntry[];
    TOGGLE: ScanEntry[];
  };
  total: number;
}

interface ScanEntry {
  id: number;
  tag: string;
  label: string;
  value?: string;
  inputType?: string;
  placeholder?: string;
  options?: string[];
  checked?: boolean;
  href?: string;
}

function formatScanResult(scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Page: ${scan.title}`);
  lines.push(`URL: ${scan.url}`);
  lines.push(`Elements: ${scan.total}`);
  lines.push("");

  if (scan.groups.PRESS.length > 0) {
    lines.push("PRESS → use press(id)");
    for (const e of scan.groups.PRESS) {
      const href = e.href ? ` → ${e.href}` : "";
      lines.push(`  [${e.id}] ${e.tag} "${e.label}"${href}`);
    }
    lines.push("");
  }

  if (scan.groups.TYPE.length > 0) {
    lines.push("TYPE → use type(id, text)");
    for (const e of scan.groups.TYPE) {
      const val = e.value ? ` value="${e.value}"` : "";
      const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : "";
      lines.push(`  [${e.id}] ${e.tag}[${e.inputType || "text"}]${val}${ph} "${e.label}"`);
    }
    lines.push("");
  }

  if (scan.groups.SELECT.length > 0) {
    lines.push("SELECT → use select(id, value)");
    for (const e of scan.groups.SELECT) {
      const opts = e.options?.join(", ") || "";
      lines.push(`  [${e.id}] select "${e.label}" value="${e.value}" options=[${opts}]`);
    }
    lines.push("");
  }

  if (scan.groups.TOGGLE.length > 0) {
    lines.push("TOGGLE → use toggle(id)");
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

async function scanWithRetry(): Promise<string> {
  const delays = [500, 1200, 2500];
  for (const delay of delays) {
    try {
      const client = await getClient(CDP_PORT);
      const result = await evaluate(client, SCANNER_JS) as ScanResult;
      if (result.total > 0) return formatScanResult(result);
    } catch {
      // Connection lost during navigation — retry
    }
    await new Promise(r => setTimeout(r, delay));
  }
  return runScan();
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

const server = new McpServer({
  name: "webpilot",
  version: "0.1.0",
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
  async ({ id }) => {
    try {
      const client = await getClient(CDP_PORT);

      const check = await evaluate(client, `(() => {
        const el = window.__webpilot?.[${id}];
        if (!el) return { error: "not_found" };
        if (!el.isConnected) return { error: "stale" };
        return { tag: el.tagName.toLowerCase(), href: el.href || null, ok: true };
      })()`) as { error?: string; tag?: string; href?: string | null; ok?: boolean };

      if (check.error === "not_found") return err("Element not found. Run scan first.");
      if (check.error === "stale") return err("Element is stale (page changed). Run scan again.");

      const urlBefore = await evaluate(client, "location.href") as string;

      await evaluate(client, `${PRESS_JS}(${id})`);

      // Detect if press triggered navigation
      await new Promise(r => setTimeout(r, 300));
      let navigated = false;
      try {
        const urlAfter = await evaluate(client, "location.href") as string;
        navigated = urlAfter !== urlBefore;
        if (navigated) {
          await waitForNavigation(client);
        }
      } catch {
        // Connection lost = full page navigation, need to reconnect
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
  },
);

server.tool(
  "type",
  "Type text into an input field, textarea, or contenteditable element. Only works on elements listed under TYPE in scan results.",
  {
    id: z.number().describe("Element ID from scan results (TYPE group)"),
    text: z.string().describe("Text to type into the element"),
    clear: z.boolean().optional().default(true).describe("Clear existing value first (default: true)"),
  },
  async ({ id, text, clear }) => {
    try {
      const client = await getClient(CDP_PORT);

      // Check if this is an iframe element — needs CDP-level input
      const isIframe = await evaluate(client, `!!window.__webpilotIframes?.[${id}]`) as boolean;

      if (isIframe) {
        // Focus the element by clicking its area, then use CDP Input.insertText
        // This works for Google Docs, canvas editors, any iframe-based input
        const rect = await evaluate(client, `(() => {
          const el = window.__webpilot?.[${id}];
          if (!el) return null;
          el.focus();
          // Walk up to find the iframe's rect in the main document
          let node = el;
          while (node && node.tagName !== "IFRAME" && node !== document.documentElement) {
            node = node.ownerDocument?.defaultView?.frameElement || node.parentElement;
          }
          if (!node) return null;
          const r = node.getBoundingClientRect ? node.getBoundingClientRect() : el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`) as { x: number; y: number } | null;

        if (!rect) return err("Element not found. Run scan first.");

        // Click to focus the editor area
        await client.Input.dispatchMouseEvent({ type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await new Promise(r => setTimeout(r, 200));

        if (clear) {
          // Select all + delete
          await client.Input.dispatchKeyEvent({ type: "keyDown", key: "a", code: "KeyA", modifiers: 8 }); // Ctrl+A
          await client.Input.dispatchKeyEvent({ type: "keyUp", key: "a", code: "KeyA", modifiers: 8 });
          await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Backspace", code: "Backspace" });
          await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Backspace", code: "Backspace" });
          await new Promise(r => setTimeout(r, 100));
        }

        // Insert text at browser level — bypasses DOM entirely
        await client.Input.insertText({ text });
        return ok(`Typed into [${id}] (via CDP input). Text: "${text.substring(0, 80)}"`);
      }

      const result = await evaluate(client, `${TYPE_JS}(${id}, ${JSON.stringify(text)}, ${clear})`) as {
        ok?: boolean; error?: string; value?: string;
      };
      if (result.error) return err(result.error);
      return ok(`Typed into [${id}]. Value: "${result.value}"`);
    } catch (e) {
      return err(`Type failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "select",
  "Select an option from a dropdown. Only works on elements listed under SELECT in scan results.",
  {
    id: z.number().describe("Element ID from scan results (SELECT group)"),
    value: z.string().describe("Option text or value to select"),
  },
  async ({ id, value }) => {
    try {
      const client = await getClient(CDP_PORT);
      const result = await evaluate(client, `${SELECT_JS}(${id}, ${JSON.stringify(value)})`) as {
        ok?: boolean; error?: string; value?: string;
      };
      if (result.error) return err(result.error);
      return ok(`Selected "${result.value}" on [${id}].`);
    } catch (e) {
      return err(`Select failed: ${e instanceof Error ? e.message : e}`);
    }
  },
);

server.tool(
  "toggle",
  "Toggle a checkbox, radio button, or switch. Only works on elements listed under TOGGLE in scan results.",
  { id: z.number().describe("Element ID from scan results (TOGGLE group)") },
  async ({ id }) => {
    try {
      const client = await getClient(CDP_PORT);
      const result = await evaluate(client, `${TOGGLE_JS}(${id})`) as {
        ok?: boolean; error?: string; checked?: boolean;
      };
      if (result.error) return err(result.error);
      return ok(`Toggled [${id}]. Now: ${result.checked ? "✓ checked" : "○ unchecked"}`);
    } catch (e) {
      return err(`Toggle failed: ${e instanceof Error ? e.message : e}`);
    }
  },
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
  async ({ url }) => {
    try {
      const client = await getClient(CDP_PORT);
      await navigateTo(client, url);
      const text = await scanWithRetry();
      return ok(`Navigated to ${url}.\n\n${text}`);
    } catch (e) {
      return err(`Navigation failed: ${e instanceof Error ? e.message : e}`);
    }
  },
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
