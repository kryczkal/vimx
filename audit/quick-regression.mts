import CDP from "chrome-remote-interface";
import { SCANNER_JS } from "../src/scanner.ts";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);

const c = await CDP({ port: CDP_PORT });
const { Page, Runtime } = c;
await Promise.all([Page.enable(), Runtime.enable()]);

const sites = [
  "https://en.wikipedia.org/wiki/Cat",
  "https://github.com/anthropics",
  "https://news.ycombinator.com/",
  "https://www.amazon.com/s?k=keyboard",
  "https://stackoverflow.com/questions",
];

for (const url of sites) {
  await Page.navigate({ url });
  await new Promise(r => setTimeout(r, 3000));
  const { result } = await Runtime.evaluate({ expression: SCANNER_JS, returnByValue: true });
  const s: any = result.value;
  const elements = (s.groups.PRESS?.length || 0) + (s.groups.TYPE?.length || 0) + (s.groups.SELECT?.length || 0) + (s.groups.TOGGLE?.length || 0) + (s.groups.UPLOAD?.length || 0);
  const allEntries = [...(s.groups.PRESS||[]), ...(s.groups.TYPE||[]), ...(s.groups.SELECT||[]), ...(s.groups.TOGGLE||[])];
  const withRegion = allEntries.filter((e: any) => e.region).length;
  const regions = [...new Set(allEntries.map((e: any) => e.region).filter(Boolean))].join(",");
  console.log(`${url.replace(/^https?:\/\//, "").substring(0,42).padEnd(42)} total=${s.total} grouped=${elements} withReg=${withRegion}/${elements} regions={${regions}}`);
}
await c.close();
