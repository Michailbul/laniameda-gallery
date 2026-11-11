// First-load scripts and styles of a route on a production build, one line per
// file (transferred bytes, type, name), largest first. Run it against two
// builds and diff the lists: a total hides a module that moved into a new
// shared chunk.
//   bun run build && bunx next start -p 3402
//   node agent-docs/perf/tools/firstload.mjs http://localhost:3402 [/path]
import { chromium } from "playwright";
const base = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);
await client.send("Network.enable");
const types = new Map(); const out = [];
client.on("Network.responseReceived", (e) => types.set(e.requestId, { type: e.type, url: e.response.url }));
client.on("Network.loadingFinished", (e) => { const t = types.get(e.requestId); if (t && t.url.startsWith(base) && (t.type === "Script" || t.type === "Stylesheet")) out.push([e.encodedDataLength, t.type, t.url.replace(base, "").replace(/\?.*$/, "")]); });
await page.goto(base + (process.argv[3] ?? "/"), { waitUntil: "load" });
await page.waitForTimeout(7000);
out.sort((a, b) => b[0] - a[0]);
console.log(out.map((r) => r[0] + " " + r[1][0] + " " + r[2].split("/").pop()).join("\n"));
await browser.close();
