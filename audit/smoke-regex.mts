// Quick smoke test against the currently-active tab: run the new READ_JS,
// apply a regex filter the same way the handler does, print the result.

import CDP from "chrome-remote-interface";
import { READ_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const client = await CDP({ port: CDP_PORT });
const { Runtime } = client;

const pattern = process.argv[2] || "abstract|introduction";
const { result } = await Runtime.evaluate({
  expression: `${READ_JS}().text`,
  returnByValue: true, awaitPromise: true,
});
const text = (result.value as string) || "";

const re = new RegExp(pattern, "i");
const lines = text.split("\n");
const hits: number[] = [];
for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);

const windows: [number, number][] = [];
for (const h of hits) {
  const start = Math.max(0, h - 2), end = Math.min(lines.length, h + 5);
  const last = windows[windows.length - 1];
  if (last && start <= last[1]) last[1] = Math.max(last[1], end);
  else windows.push([start, end]);
}

console.log(`page: ${text.length} chars, ${lines.length} lines`);
console.log(`hits: ${hits.length}, windows: ${windows.length}`);
if (hits.length === 0) {
  console.log(`No matches for /${pattern}/i`);
} else {
  const body = windows.map(([s, e]) => lines.slice(s, e).join("\n")).join("\n---\n");
  console.log(`\n${hits.length} matches for /${pattern}/i:\n\n${body.slice(0, 2000)}`);
}

await client.close();
