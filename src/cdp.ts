import CDP from "chrome-remote-interface";
import { execSync, spawn } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let activeClient: CDP.Client | null = null;

// ── Dialog handling ──
// JS dialogs (alert/confirm/prompt/beforeunload) block all Runtime.evaluate
// calls, bricking the session. We listen for them on the CDP event channel
// (which keeps working) and either auto-dismiss (alert) or hold for the agent.

interface DialogInfo { type: string; message: string; defaultPrompt?: string }
let pendingDialog: DialogInfo | null = null;
let lastAlert: { message: string } | null = null;
let dialogResolvers: Array<() => void> = [];

export function getPendingDialog(): DialogInfo | null { return pendingDialog; }

export function consumeLastAlert(): { message: string } | null {
  const a = lastAlert;
  lastAlert = null;
  return a;
}

export function onDialog(): Promise<void> {
  return new Promise(r => { dialogResolvers.push(r); });
}

export async function handlePendingDialog(client: CDP.Client, accept: boolean, text?: string): Promise<void> {
  if (!pendingDialog) throw new Error("No dialog is currently open.");
  await client.Page.handleJavaScriptDialog({ accept, promptText: text });
  pendingDialog = null;
}

function setupDialogHandler(client: CDP.Client): void {
  (client as any).on("Page.javascriptDialogOpening", (params: { type: string; message: string; defaultPrompt?: string }) => {
    if (params.type === "alert") {
      lastAlert = { message: params.message };
      client.Page.handleJavaScriptDialog({ accept: true }).catch(() => {});
    } else {
      pendingDialog = { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt };
      for (const r of dialogResolvers) r();
      dialogResolvers = [];
    }
  });
}

// Direct websocket URL for remote CDP targets (e.g. BrowserUseCloud).
// When set, skips local Chrome discovery and connects directly.
const CDP_TARGET = process.env.CDP_TARGET;

const RETRY_DELAYS = [200, 500, 1000, 2000];

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Serializes all browser interactions so CDP events from one tool call
// are fully processed before the next call starts.
let actionQueue: Promise<unknown> = Promise.resolve();

export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = actionQueue.then(fn, fn);
  actionQueue = next.catch(() => {});
  return next;
}

function isChromeRunning(): boolean {
  try {
    execSync("pgrep -f chromium", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launchChrome(port: number): void {
  const child = spawn("chromium", [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function waitForCDP(port: number): Promise<void> {
  for (const delay of [300, 500, 800, 1000, 1500, 2000, 3000]) {
    try {
      await CDP.List({ port });
      return;
    } catch {
      await sleep(delay);
    }
  }
  throw new Error(`Chrome not responding on port ${port} after launch.`);
}

export async function ensureBrowser(port: number): Promise<void> {
  if (CDP_TARGET) return;

  try {
    await CDP.List({ port });
    return;
  } catch {
    // CDP not responding
  }

  if (!isChromeRunning()) {
    launchChrome(port);
  }
  await waitForCDP(port);
}

// ── Server boot ──
// One MCP server process == one browser. Three branches:
//   1. CDP_TARGET set: attach to a remote websocket. Caller manages lifetime.
//   2. CDP_PORT set: attach to a local Chrome on that port. Started outside
//      this process (e.g. scripts/dev-chrome.sh), so we don't kill it.
//   3. neither set: spawn a fresh headed chromium on an OS-assigned port.
//      Default profile is a fresh /tmp dir wiped on shutdown. Set
//      WEBPILOT_PROFILE_DIR to use a persistent profile instead — needed
//      for sites like Google that block fresh-profile OAuth as suspected
//      automation. With a persistent profile, if chromium is already
//      running against that dir we attach to it; otherwise we spawn.
//
// TODO (headless future): under SIGKILL the spawned chromium becomes an
// orphan. With a visible window the user can close it manually; once we
// support headless that won't be possible. Fix is a startup sweep of
// /tmp/webpilot-mcp-* dirs whose PID file points at a dead PID.

export interface BrowserHandle {
  port: number;
  shutdown: () => void;
}

async function readActivePort(profile: string, timeoutMs = 10_000): Promise<number> {
  const path = join(profile, "DevToolsActivePort");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = readFileSync(path, "utf8");
      const firstLine = content.split("\n")[0]?.trim() ?? "";
      const port = parseInt(firstLine, 10);
      if (port > 0) return port;
    } catch {
      // not written yet
    }
    await sleep(100);
  }
  throw new Error(`Chromium did not write DevToolsActivePort at ${path} within ${timeoutMs}ms`);
}

export async function startBrowser(): Promise<BrowserHandle> {
  if (CDP_TARGET) {
    return { port: 0, shutdown: () => {} };
  }

  const fixedPortEnv = process.env.CDP_PORT;
  if (fixedPortEnv) {
    const port = parseInt(fixedPortEnv, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid CDP_PORT='${fixedPortEnv}'`);
    }
    await ensureBrowser(port);
    return { port, shutdown: () => {} };
  }

  const persistDir = process.env.WEBPILOT_PROFILE_DIR;
  let profile: string;
  let ephemeral: boolean;
  if (persistDir) {
    profile = persistDir;
    mkdirSync(profile, { recursive: true });
    ephemeral = false;

    // If a chromium is already running against this profile (e.g. user
    // launched it manually to log into Google), attach instead of spawning
    // a second instance — chromium would otherwise forward to the existing
    // singleton and exit, leaving us with no controllable process.
    try {
      const existingPort = await readActivePort(profile, 200);
      await CDP.List({ port: existingPort });
      return { port: existingPort, shutdown: () => {} };
    } catch {
      // not running, fall through to spawn
    }

    // Singleton* and DevToolsActivePort are stale after a SIGKILLed run;
    // a fresh chromium would otherwise show "previous session crashed" UI
    // or, worse, a stale port pointing at nothing.
    for (const f of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { rmSync(join(profile, f), { force: true }); } catch {}
    }
  } else {
    profile = mkdtempSync(join(tmpdir(), "webpilot-mcp-"));
    ephemeral = true;
  }

  // detached:true puts chromium in its own process group so we can SIGKILL the
  // whole group (parent + zygote + renderers + gpu-process + …) in one syscall
  // via process.kill(-pid). Without that, killing only the parent leaves child
  // chromium procs holding profile files open, and the immediately-following
  // rmSync races them and partial-fails.
  const child = spawn("chromium", [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
  ], { detached: true, stdio: "ignore" });
  child.unref();

  let killed = false;
  const shutdown = () => {
    if (killed) return;
    killed = true;
    if (child.pid) {
      // Negative pid = process group. SIGKILL because we don't owe chromium
      // a graceful exit; cookies are flushed eagerly so the persistent
      // profile keeps your login state regardless.
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
    if (ephemeral) {
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  };

  try {
    const port = await readActivePort(profile);
    return { port, shutdown };
  } catch (e) {
    shutdown();
    throw e;
  }
}

async function connectToTab(port: number): Promise<CDP.Client> {
  if (CDP_TARGET) {
    const client = await CDP({ target: CDP_TARGET });
    await client.Runtime.enable();
    await client.Page.enable();
    setupDialogHandler(client);
    return client;
  }

  const targets = await CDP.List({ port });
  const page = targets.find(t => t.type === "page" && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome://"))
    ?? targets.find(t => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error("No browser tab found.");
  const client = await CDP({ target: page, port });
  await client.Runtime.enable();
  await client.Page.enable();
  setupDialogHandler(client);
  return client;
}

export async function getClient(port: number): Promise<CDP.Client> {
  if (activeClient) {
    if (pendingDialog) return activeClient;
    try {
      await activeClient.Runtime.evaluate({ expression: "1" });
      return activeClient;
    } catch {
      try { await activeClient.close(); } catch {}
      activeClient = null;
    }
  }

  await ensureBrowser(port);

  for (const delay of RETRY_DELAYS) {
    try {
      activeClient = await connectToTab(port);
      return activeClient;
    } catch {
      await sleep(delay);
    }
  }

  activeClient = await connectToTab(port);
  return activeClient;
}

export async function listTabs(port: number): Promise<{ id: string; title: string; url: string }[]> {
  if (CDP_TARGET) return [];

  await ensureBrowser(port);
  const targets = await CDP.List({ port });
  return targets
    .filter(t => t.type === "page" && !t.url.startsWith("devtools://"))
    .map(t => ({ id: t.id, title: t.title, url: t.url }));
}

export async function switchTab(port: number, tabId: string): Promise<void> {
  if (activeClient) {
    try { await activeClient.close(); } catch {}
  }
  activeClient = await CDP({ target: tabId, port });
  await activeClient.Runtime.enable();
  await activeClient.Page.enable();
  setupDialogHandler(activeClient);
}

export async function evaluate(client: CDP.Client, expression: string): Promise<unknown> {
  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description ||
                result.exceptionDetails.text ||
                "Unknown JS error";
    throw new Error(msg);
  }
  return result.result.value;
}

export async function evaluateInFrame(
  client: CDP.Client,
  frameId: string,
  expression: string,
): Promise<unknown> {
  // Create an isolated world in the frame to evaluate our expression
  const { executionContextId } = await client.Page.createIsolatedWorld({
    frameId,
    worldName: "webpilot-scanner",
    grantUniveralAccess: true, // CDP protocol typo — leave as-is
  });

  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
    contextId: executionContextId,
  });

  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description ||
                result.exceptionDetails.text ||
                "Unknown JS error in frame";
    throw new Error(msg);
  }
  return result.result.value;
}

export async function navigateTo(client: CDP.Client, url: string): Promise<void> {
  // Fire and forget — Page.navigate's promise itself blocks until any
  // beforeunload dialog is resolved. We watch for load/dialog events instead.
  client.Page.navigate({ url }).catch(() => {});

  await Promise.race([
    client.Page.loadEventFired(),
    onDialog(),
    sleep(10_000),
  ]);
}

export async function waitForNavigation(client: CDP.Client): Promise<void> {
  await Promise.race([
    client.Page.loadEventFired(),
    sleep(5_000),
  ]);
}

export async function startObserving(client: CDP.Client): Promise<void> {
  await evaluate(client, `(() => {
    if (window.__wpObs?.observer) window.__wpObs.observer.disconnect();
    window.__wpObs = { count: 0, lastTime: 0 };
    const obs = new MutationObserver(() => {
      window.__wpObs.count++;
      window.__wpObs.lastTime = Date.now();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__wpObs.observer = obs;
  })()`);
}

export async function waitForSettle(client: CDP.Client): Promise<void> {
  await evaluate(client, `new Promise(resolve => {
    const obs = window.__wpObs;
    if (!obs || !obs.observer) { resolve(); return; }
    const QUIET = 80;
    const CAP = 2000;
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > CAP) { obs.observer.disconnect(); resolve(); return; }
      if (obs.count === 0) {
        setTimeout(() => {
          if (obs.count === 0) { obs.observer.disconnect(); resolve(); }
          else check();
        }, QUIET);
        return;
      }
      const elapsed = Date.now() - obs.lastTime;
      if (elapsed >= QUIET) { obs.observer.disconnect(); resolve(); }
      else setTimeout(check, QUIET - elapsed);
    };
    check();
  })`);
}

// On SPA route changes, the DOM goes quiet between "skeleton rendered" and
// "XHR results arrive". waitForSettle catches that quiet pause and returns
// too early; scan sees nav chrome only and the model concludes the page is
// broken (LinkedIn search session, May 11 2026).
//
// We wait for visible loading indicators to disappear before scanning.
// Selectors chosen by measurement (test-loading-detect.mts): aria-busy=true
// and class*=skeleton fired during loading on a synthetic gold-standard
// page AND YouTube search, cleared after content arrived, zero hits on
// Wikipedia/MDN/HN/GitHub controls. spinner/loader/loading/placeholder
// patterns were too noisy (permanent spinners, false matches).
//
// Returns true if it actually waited. Caller should re-settle after.
export async function waitForLoadingIndicators(client: CDP.Client, maxMs = 2500): Promise<boolean> {
  return await evaluate(client, `new Promise(resolve => {
    const SEL = '[aria-busy="true"], [class*="skeleton" i]';
    function hasVisible() {
      for (const el of document.querySelectorAll(SEL)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        return true;
      }
      return false;
    }
    if (!hasVisible()) { resolve(false); return; }
    const start = Date.now();
    const observer = new MutationObserver(() => {
      if (!hasVisible()) { observer.disconnect(); resolve(true); }
    });
    observer.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['aria-busy', 'class'],
    });
    setTimeout(() => { observer.disconnect(); resolve(true); }, ${maxMs});
  })`) as boolean;
}
