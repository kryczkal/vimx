import CDP from "chrome-remote-interface";
import { execSync, spawn } from "child_process";

let activeClient: CDP.Client | null = null;
let activeTabId: string | null = null;

const RETRY_DELAYS = [200, 500, 1000, 2000];

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
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

async function connectToTab(port: number): Promise<CDP.Client> {
  const targets = await CDP.List({ port });
  const page = targets.find(t => t.type === "page" && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome://"))
    ?? targets.find(t => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error("No browser tab found.");
  const client = await CDP({ target: page, port });
  activeTabId = page.id;
  await client.Runtime.enable();
  await client.Page.enable();
  return client;
}

export async function getClient(port: number): Promise<CDP.Client> {
  if (activeClient) {
    try {
      await activeClient.Runtime.evaluate({ expression: "1" });
      return activeClient;
    } catch {
      try { await activeClient.close(); } catch {}
      activeClient = null;
      activeTabId = null;
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
  activeTabId = tabId;
  await activeClient.Runtime.enable();
  await activeClient.Page.enable();
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

export async function navigateTo(client: CDP.Client, url: string): Promise<void> {
  const { frameId } = await client.Page.navigate({ url });
  if (!frameId) throw new Error("Navigation failed — no frame returned.");

  // Wait for load, with timeout
  await Promise.race([
    client.Page.loadEventFired(),
    sleep(10_000),
  ]);

  // Extra settle time for SPAs that render after load
  await sleep(300);
}

export async function waitForNavigation(client: CDP.Client): Promise<void> {
  await Promise.race([
    client.Page.loadEventFired(),
    sleep(5_000),
  ]);
  await sleep(300);
}
