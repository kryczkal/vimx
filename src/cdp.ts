import CDP from "chrome-remote-interface";
import { execSync, spawn } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
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

// ── Browser lifecycle ──
// MCP server starts cold; the LLM calls browser_open to spawn / attach, and
// browser_close to tear down. spawnOrAttach() has these branches:
//   1. CDP_TARGET set: attach to a remote websocket. Caller manages lifetime.
//   2. CDP_PORT set: attach to a local Chrome on that port. Started outside
//      this process (e.g. scripts/dev-chrome.sh), so we don't kill it.
//   3. VIMX_PROFILE_TEMPLATE set: clone the template dir to an
//      MCP-server-scoped /tmp dir on first open and reuse it across
//      open/close cycles. Each MCP server gets its own clone, so two
//      agents can run simultaneously with the same logged-in starting
//      state without fighting over chromium's per-user-data-dir
//      singleton lock. Cookies acquired mid-session persist across
//      open/close within the MCP lifetime, then die with the server.
//   4. VIMX_PROFILE_DIR set: use that dir directly, no copy.
//      Persists across MCP restarts but cannot be shared across MCP
//      servers concurrently. Best for "one debug browser I keep
//      around." If chromium is already running against the dir we
//      attach instead of spawning a duplicate.
//   5. neither: fresh /tmp dir per browser_open, wiped on close.
//
// Under SIGKILL of the MCP server the spawned chromium would otherwise
// become an orphan holding the profile dir. sweepStaleProfiles() handles
// this: every dir we create has a vimx.pid file with our pid, and on
// next MCP boot we sweep dirs whose owner is dead, killing any orphan
// chromium found there.

interface BrowserHandle {
  port: number;
  shutdown: () => void;
}

let currentHandle: BrowserHandle | null = null;

// Lazily cloned from VIMX_PROFILE_TEMPLATE on first browser_open.
// Held for the MCP server's lifetime so successive open/close cycles
// reuse the same cookies; wiped by syncShutdownCurrent() on MCP exit.
let templateClone: string | null = null;

// Sweep runs once per MCP server lifetime, on first browser_open. SIGKILLed
// MCP servers can't run their cleanup paths, leaving /tmp/vimx-mcp-*
// dirs (and sometimes orphan chromiums) behind. Each dir we own holds a
// vimx.pid file with our MCP server pid; on sweep, dirs whose pid is
// dead get their orphan chromium killed (verified via /proc/<pid>/cmdline
// to avoid pid-recycle disasters) and the dir wiped. Dirs without a pid
// file are treated as predating this feature and also swept.
let sweepDone = false;

function sweepStaleProfiles(): void {
  if (sweepDone) return;
  sweepDone = true;

  const tmp = tmpdir();
  let entries: string[];
  try { entries = readdirSync(tmp); } catch { return; }

  for (const name of entries) {
    if (!name.startsWith("vimx-mcp-")) continue;
    const dir = join(tmp, name);

    let ownerAlive = false;
    try {
      const pid = parseInt(readFileSync(join(dir, "vimx.pid"), "utf8").trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        try { process.kill(pid, 0); ownerAlive = true; } catch { /* ESRCH = dead */ }
      }
    } catch { /* no pid file = predates feature, treat as stale */ }
    if (ownerAlive) continue;

    // Owner dead. Orphan chromium may still be holding the dir.
    const orphanPid = getChromiumPidOwning(dir);
    if (orphanPid !== null) {
      try { process.kill(-orphanPid, "SIGKILL"); } catch {}
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function writeOwnershipPid(dir: string): void {
  try { writeFileSync(join(dir, "vimx.pid"), String(process.pid)); } catch {}
}

// Returns the pid of a live chromium currently holding profileDir, or null if
// none does. Reads chromium's SingletonLock symlink (target is "<host>-<pid>")
// and verifies via /proc/<pid>/cmdline that the pid is actually a chromium
// process running against this dir — guards against pid recycling and
// against treating a defunct lock as live. Cribbed from playwright-mcp's
// browserFactory.ts.
function getChromiumPidOwning(profileDir: string): number | null {
  try {
    const target = readlinkSync(join(profileDir, "SingletonLock"));
    const pid = parseInt(target.split("-").pop() ?? "", 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (cmdline.includes("chromium") && cmdline.includes(profileDir)) {
      return pid;
    }
    return null;
  } catch {
    return null;
  }
}

function ensureTemplateClone(): string | null {
  const template = process.env.VIMX_PROFILE_TEMPLATE;
  if (!template) return null;
  if (templateClone) return templateClone;

  if (!existsSync(template)) {
    throw new Error(`VIMX_PROFILE_TEMPLATE='${template}' does not exist`);
  }
  const dir = mkdtempSync(join(tmpdir(), "vimx-mcp-"));
  try {
    cpSync(template, dir, { recursive: true, preserveTimestamps: true, dereference: false });
  } catch (e) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    throw new Error(`Failed to clone VIMX_PROFILE_TEMPLATE: ${e instanceof Error ? e.message : e}`);
  }
  // The template may carry stale lock state if the user pre-launched
  // chromium against it (e.g. for the initial Google login); strip so
  // the fresh chromium doesn't show "previous session crashed" UI.
  for (const f of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { rmSync(join(dir, f), { force: true }); } catch {}
  }
  writeOwnershipPid(dir);
  templateClone = dir;
  return dir;
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

async function spawnOrAttach(): Promise<BrowserHandle> {
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

  // Reap leaks from prior SIGKILLed MCP servers before creating our own
  // dirs (so we don't accidentally sweep one mid-creation by another MCP).
  sweepStaleProfiles();

  const cloned = ensureTemplateClone();
  const persistDir = cloned ? null : process.env.VIMX_PROFILE_DIR;
  let profile: string;
  let ephemeral: boolean;
  if (cloned) {
    profile = cloned;
    ephemeral = false;
    // Stale singleton state from the previous browser_open in this same
    // MCP session — chromium SIGKILLed by browser_close leaves these.
    for (const f of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { rmSync(join(profile, f), { force: true }); } catch {}
    }
  } else if (persistDir) {
    profile = persistDir;
    mkdirSync(profile, { recursive: true });
    ephemeral = false;

    // Gate on whether a real chromium is actually running against this dir
    // via SingletonLock (vs CDP probe, which can false-negative on slow
    // start and would then strip locks of a live chromium — the spawn
    // would singleton-forward to the existing chromium and our process
    // would exit with no controllable browser). If yes, attach with a
    // generous CDP timeout. If no, lock files are stale; clean and spawn.
    const livePid = getChromiumPidOwning(profile);
    if (livePid !== null) {
      try {
        const existingPort = await readActivePort(profile, 5000);
        await CDP.List({ port: existingPort });
        return { port: existingPort, shutdown: () => {} };
      } catch {
        throw new Error(
          `chromium pid ${livePid} owns profile '${profile}' but CDP isn't reachable. ` +
          `Either kill it or relaunch with --remote-debugging-port=0.`,
        );
      }
    }

    for (const f of ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { rmSync(join(profile, f), { force: true }); } catch {}
    }
  } else {
    profile = mkdtempSync(join(tmpdir(), "vimx-mcp-"));
    writeOwnershipPid(profile);
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

export function isBrowserOpen(): boolean {
  return currentHandle !== null;
}

export async function openBrowser(): Promise<{ port: number; alreadyOpen: boolean }> {
  if (currentHandle) {
    return { port: currentHandle.port, alreadyOpen: true };
  }
  currentHandle = await spawnOrAttach();
  return { port: currentHandle.port, alreadyOpen: false };
}

export async function closeBrowser(): Promise<{ wasOpen: boolean }> {
  if (!currentHandle) return { wasOpen: false };

  if (activeClient) {
    try { await activeClient.close(); } catch {}
    activeClient = null;
  }

  try { currentHandle.shutdown(); } catch {}
  currentHandle = null;

  // Stale dialog state from the dead chromium would confuse the next open.
  pendingDialog = null;
  lastAlert = null;
  dialogResolvers = [];

  return { wasOpen: true };
}

// Sync-only cleanup for process-exit hooks (signal handlers can't await).
// Skips the graceful CDP client close — chrome is dying anyway. Kills the
// process group, wipes the per-open profile if we spawned one, and wipes
// the MCP-server-scoped template clone (which browser_close intentionally
// preserves across opens).
export function syncShutdownCurrent(): void {
  if (currentHandle) {
    try { currentHandle.shutdown(); } catch {}
    currentHandle = null;
  }
  if (templateClone) {
    try { rmSync(templateClone, { recursive: true, force: true }); } catch {}
    templateClone = null;
  }
}

function requirePort(): number {
  if (!currentHandle) {
    throw new Error("No browser is open. Call browser_open first.");
  }
  return currentHandle.port;
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

export async function getClient(): Promise<CDP.Client> {
  const port = requirePort();
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

  // openBrowser already verified the port is reachable (spawn path waits for
  // DevToolsActivePort; attach path called ensureBrowser). If chrome died
  // mid-session, connect fails here and the error surfaces — the LLM can
  // recover by calling browser_close + browser_open.
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

export async function listTabs(): Promise<{ id: string; title: string; url: string }[]> {
  if (CDP_TARGET) return [];
  const port = requirePort();
  const targets = await CDP.List({ port });
  return targets
    .filter(t => t.type === "page" && !t.url.startsWith("devtools://"))
    .map(t => ({ id: t.id, title: t.title, url: t.url }));
}

export async function switchTab(tabId: string): Promise<void> {
  const port = requirePort();
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
    worldName: "vimx-scanner",
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
