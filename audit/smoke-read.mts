import CDP from "chrome-remote-interface";
import { READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const client = await CDP({ port: CDP_PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);

async function nav(url: string) {
  await Page.navigate({ url });
  await Promise.race([Page.loadEventFired(), new Promise((_, r) => setTimeout(() => r(new Error("t")), 12000))]);
  await new Promise(r => setTimeout(r, 1500));
}
async function read(): Promise<string> {
  const { result } = await Runtime.evaluate({ expression: `(${READ_JS})().text`, returnByValue: true });
  return result.value as string;
}

for (const url of [
  "https://news.ycombinator.com/",
  "https://en.wikipedia.org/wiki/Cat",
  "https://www.bbc.com/news",
  "https://example.com/",
]) {
  await nav(url);
  const txt = await read();
  const urlCount = (txt.match(/https?:\/\/\S+/g) || []).length;
  console.log(`\n=== ${url} (${txt.length} chars, ${urlCount} URLs) ===`);
  console.log(txt.slice(0, 700));
}

await client.close();
