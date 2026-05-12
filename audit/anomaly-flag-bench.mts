// Anomaly-flag bench for type / toggle / select.
//
// Tests:
//   SYN-type: synthetic data: URL with a contenteditable that resists clear
//             (simulates Forms shipped-broken case). Expect anomaly fire.
//   SYN-idem: normal input typed with the same value as prior. Expect NO fire
//             (since new.length == typed.length).
//   SYN-toggle-noop: a disabled checkbox. Expect anomaly fire (state didn't flip).
//   FP-sweep: real-site type interactions on 8 search bars. Expect 0 fires.
//
// Spawns the production MCP server and drives it via stdio MCP.

import { spawn } from "child_process";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

interface ToolResult { id: number; text: string; isError: boolean }

class MCPClient {
  proc; buf = ""; pending = new Map<number, (r: ToolResult) => void>(); id = 1;
  constructor() {
    this.proc = spawn("node", ["dist/index.js"], {
      env: { ...process.env},
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout!.on("data", (d: Buffer) => {
      this.buf += d.toString();
      let nl;
      while ((nl = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.substring(0, nl);
        this.buf = this.buf.substring(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const text = msg.result?.content?.[0]?.text ?? msg.error?.message ?? "";
            this.pending.get(msg.id)!({ id: msg.id, text, isError: !!msg.result?.isError });
            this.pending.delete(msg.id);
          }
        } catch {}
      }
    });
    this.proc.stderr!.on("data", (d: Buffer) => process.stderr.write("[mcp] " + d));
  }
  async call(method: string, params: any): Promise<ToolResult> {
    const id = this.id++;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async tool(name: string, args: any) { return this.call("tools/call", { name, arguments: args }); }
  close() { this.proc.kill(); }
}

// --- Synthetic pages ---
// Contenteditable div with a stubborn MutationObserver that restores prior
// text. Simulates a controlled component that owns its state and reverts
// any external mutation. clearField's textContent = "" gets clobbered before
// cdpType runs — heuristic should detect the clear failure.
const SYN_TYPE_BAD_URL =
  "data:text/html;charset=utf-8," + encodeURIComponent(`
<!doctype html><meta charset=utf-8>
<title>Synthetic - stubborn contenteditable</title>
<style>body{font:14px sans-serif;padding:20px} #x{font:14px monospace;padding:8px;border:1px solid #888;width:300px;min-height:1.5em}</style>
<div id=x contenteditable>Option 1</div>
<script>
const x = document.getElementById('x');
const stored = 'Option 1';
// Resist clear: any time text doesn't contain the stored value, restore it.
const obs = new MutationObserver(() => {
  const cur = x.textContent || '';
  if (!cur.includes(stored)) {
    x.textContent = stored + cur;
  }
});
obs.observe(x, { childList: true, subtree: true, characterData: true });
</script>
`);

// Normal input with the same prior. type the SAME text — readback should equal
// prior; heuristic should NOT fire because new.length == typed.length.
const SYN_TYPE_GOOD_URL =
  "data:text/html;charset=utf-8," + encodeURIComponent(`
<!doctype html><meta charset=utf-8>
<title>Synthetic - normal</title>
<input id=x value="Option 1">
`);

// Checkbox that preventDefaults the click — looks enabled to the scanner
// but doesn't actually toggle. Pre-state and post-state both false.
const SYN_TOGGLE_DISABLED_URL =
  "data:text/html;charset=utf-8," + encodeURIComponent(`
<!doctype html><meta charset=utf-8>
<title>Synthetic - toggle-noop</title>
<label><input type=checkbox id=x> Noop checkbox</label>
<script>
document.getElementById('x').addEventListener('click', e => e.preventDefault());
</script>
`);

// FP sweep targets — real sites with single search inputs.
const FP_SITES = [
  { url: "https://www.google.com/", search: "search", text: "test query" },
  { url: "https://github.com/", search: "Search", text: "anthropic" },
  { url: "https://en.wikipedia.org/wiki/Main_Page", search: "Search", text: "claude" },
  { url: "https://duckduckgo.com/", search: "search", text: "anthropic" },
  { url: "https://news.ycombinator.com/", search: "Search", text: "rust" },
  { url: "https://www.reddit.com/", search: "Search Reddit", text: "programming" },
  { url: "https://www.amazon.com/", search: "Search Amazon", text: "keyboard" },
  { url: "https://stackoverflow.com/", search: "Search…", text: "typescript" },
];

async function main() {
  const mcp = new MCPClient();
  await mcp.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1" } });
  await new Promise(r => setTimeout(r, 300));

  console.log("=".repeat(80));
  console.log("SYN-type-bad: clear:true should NOT clear the resists-clear input");
  console.log("=".repeat(80));
  await mcp.tool("navigate", { url: SYN_TYPE_BAD_URL });
  await new Promise(r => setTimeout(r, 800));
  const t1 = await mcp.tool("type", { element: "Option 1", text: "Option A" });
  console.log(`  isError=${t1.isError}`);
  console.log(`  text: ${t1.text.substring(0, 250)}`);
  const pass1 = t1.isError && t1.text.includes("did not clear");
  console.log(`  >>> ${pass1 ? "PASS — heuristic fired on intentional bug" : "FAIL — heuristic missed the bug"}`);

  console.log("");
  console.log("=".repeat(80));
  console.log("SYN-type-idempotent: type 'Option 1' over 'Option 1' — should NOT fire");
  console.log("=".repeat(80));
  await mcp.tool("navigate", { url: SYN_TYPE_GOOD_URL });
  await new Promise(r => setTimeout(r, 600));
  const t2 = await mcp.tool("type", { element: "Option 1", text: "Option 1" });
  console.log(`  isError=${t2.isError}`);
  console.log(`  text: ${t2.text.substring(0, 200)}`);
  const pass2 = !t2.isError;
  console.log(`  >>> ${pass2 ? "PASS — heuristic did NOT fire (correct)" : "FAIL — false positive on idempotent re-type"}`);

  console.log("");
  console.log("=".repeat(80));
  console.log("SYN-toggle-disabled: toggle a disabled checkbox — should fire");
  console.log("=".repeat(80));
  await mcp.tool("navigate", { url: SYN_TOGGLE_DISABLED_URL });
  await new Promise(r => setTimeout(r, 600));
  const t3 = await mcp.tool("toggle", { element: "Noop checkbox" });
  console.log(`  isError=${t3.isError}`);
  console.log(`  text: ${t3.text.substring(0, 250)}`);
  const pass3 = t3.isError && t3.text.includes("state did not change");
  console.log(`  >>> ${pass3 ? "PASS — heuristic fired" : "FAIL — heuristic missed (or toggle silently no-op'd successfully)"}`);

  console.log("");
  console.log("=".repeat(80));
  console.log("FP-sweep: 8 real-site search-bar types — should fire 0 times");
  console.log("=".repeat(80));
  let fires = 0;
  for (const site of FP_SITES) {
    await mcp.tool("navigate", { url: site.url });
    await new Promise(r => setTimeout(r, 2000));
    const r = await mcp.tool("type", { element: site.search, text: site.text });
    const fired = r.isError && (r.text.includes("did not clear") || r.text.includes("state did not change"));
    console.log(`  ${site.url.padEnd(40)} isError=${r.isError} fired=${fired}`);
    if (fired) {
      console.log(`     >>> ${r.text.substring(0, 200)}`);
      fires++;
    }
  }
  console.log(`  >>> fires: ${fires}/${FP_SITES.length} (target: 0)`);

  console.log("");
  console.log("=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  console.log(`  SYN-type-bad        : ${pass1 ? "PASS" : "FAIL"}`);
  console.log(`  SYN-type-idempotent : ${pass2 ? "PASS" : "FAIL"}`);
  console.log(`  SYN-toggle-disabled : ${pass3 ? "PASS" : "FAIL"}`);
  console.log(`  FP-sweep            : ${fires === 0 ? "PASS" : "FAIL"} (${fires} false positives)`);

  mcp.close();
}

await main();
