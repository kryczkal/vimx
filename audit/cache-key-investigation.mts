// (f) Cache-key correctness investigation.
//
// Two hypotheses:
//   F-query: ?q=A vs ?q=B on same path falsely share cache.
//   F-redir: navigate(/a) -> server 302 -> /b; cache for /b is stale.
//
// The bug only manifests when URL changes outside MCP's navigate() (which
// correctly invalidates). That means press-driven navigation, or same-page
// SPA state changes via filter clicks, etc. We simulate by using a SEPARATE
// CDP connection to navigate the underlying page while the MCP server is
// unaware.
//
// Test pattern:
//   1. MCP: navigate(/path?q=A); scan -> cache populated with A's state.
//   2. External CDP: Page.navigate(/path?q=B) -> page changes, MCP doesn't know.
//   3. MCP: scan -> hits cache (same path key), dedups vs stale A state.
//
// Measure: does MCP's scan output emit dedup form despite the page actually
// being a different state?

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

function isDedupOutput(text: string): boolean {
  return text.includes("No changes since last scan") ||
         text.includes("unchanged since last scan") ||
         /Unchanged — /.test(text);
}
function elementCount(text: string): number {
  const m = text.match(/Elements: (\d+)/);
  return m ? parseInt(m[1]) : -1;
}

async function main() {
  const CDP = (await import("chrome-remote-interface")).default;
  const sideClient = await CDP({ port: CDP_PORT });
  await Promise.all([sideClient.Page.enable(), sideClient.Runtime.enable()]);

  const mcp = new MCPClient();
  await mcp.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1" } });
  await new Promise(r => setTimeout(r, 300));

  async function sideNav(url: string) {
    await sideClient.Page.navigate({ url });
    await Promise.race([sideClient.Page.loadEventFired(), new Promise(r => setTimeout(r, 12000))]);
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log("=".repeat(80));
  console.log("F-query: ?q=A vs ?q=B on same path (Google Flights)");
  console.log("=".repeat(80));

  // 1. MCP navigates and scans — cache for /travel/flights populated with A.
  await mcp.tool("navigate", { url: "https://www.google.com/travel/flights?q=SFO+to+NRT+round+trip+July+4+2026" });
  await new Promise(r => setTimeout(r, 1500));
  const fA = await mcp.tool("scan", {});
  console.log(`  step 1 — MCP nav+scan to ?q=SFO->NRT: ${fA.text.length} chars, dedup=${isDedupOutput(fA.text)} (expected: dedup post-nav scan)`);

  // 2. External CDP navigates to different querystring — MCP doesn't know.
  await sideNav("https://www.google.com/travel/flights?q=NYC+to+LON+round+trip+September+2026");
  console.log(`  step 2 — side-channel nav to ?q=NYC->LON (MCP cache unaware)`);

  // 3. MCP scan — hits cache via path-only key, dedups against stale A state.
  const fB = await mcp.tool("scan", {});
  console.log(`  step 3 — MCP scan (page is now NYC->LON, cache thinks SFO->NRT): ${fB.text.length} chars, dedup=${isDedupOutput(fB.text)}`);
  console.log(`  >>> first line: ${fB.text.split("\n").slice(0, 3).join(" | ").substring(0, 200)}`);
  // If output uses dedup form -> bug. The page changed but cache thinks it didn't.
  // Real damage: agent's prior context referenced ids from A; on B those ids point to different elements.

  console.log("");
  console.log("=".repeat(80));
  console.log("F-redir: side-channel navigates to a redirect; MCP scan hits cache for resolved URL?");
  console.log("=".repeat(80));

  await mcp.tool("navigate", { url: "https://en.wikipedia.org/wiki/Main_Page" });
  await new Promise(r => setTimeout(r, 1500));
  const rA = await mcp.tool("scan", {});
  console.log(`  step 1 — MCP nav+scan /wiki/Main_Page: ${rA.text.length} chars, dedup=${isDedupOutput(rA.text)}`);

  // /wiki/Cat → 301 → no redirect actually; try a real redirect path.
  // Wikipedia: /wiki/USA → 301 → /wiki/United_States
  await sideNav("https://en.wikipedia.org/wiki/USA");
  console.log(`  step 2 — side-channel nav /wiki/USA (Wikipedia 301s to /wiki/United_States)`);
  const finalUrl = await sideClient.Runtime.evaluate({ expression: "location.href", returnByValue: true });
  console.log(`  step 2 — resolved URL: ${finalUrl.result.value}`);

  const rB = await mcp.tool("scan", {});
  console.log(`  step 3 — MCP scan: ${rB.text.length} chars, dedup=${isDedupOutput(rB.text)}`);
  console.log(`  >>> first line: ${rB.text.split("\n").slice(0, 3).join(" | ").substring(0, 200)}`);

  console.log("");
  console.log("=".repeat(80));
  console.log("Control: side-channel different path → should NOT cross-dedup");
  console.log("=".repeat(80));

  await mcp.tool("navigate", { url: "https://en.wikipedia.org/wiki/Cat" });
  await new Promise(r => setTimeout(r, 1500));
  await mcp.tool("scan", {});
  await sideNav("https://en.wikipedia.org/wiki/Dog"); // different path
  const ctrl = await mcp.tool("scan", {});
  console.log(`  MCP scan after side-nav /wiki/Dog: dedup=${isDedupOutput(ctrl.text)} (expected false — different paths)`);

  mcp.close();
  await sideClient.close();
}

await main();
