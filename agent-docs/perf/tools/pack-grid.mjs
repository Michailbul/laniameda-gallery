// Run from the repository root after a production build. To compare revisions,
// run the same two benchmark files in each checkout.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { CARD_THUMB_WEBP_QUALITY, GRID_VARIANT_WEBP_QUALITY } from "../../../lib/card-thumbnail";

const bundle = await Bun.build({
  entrypoints: [join(import.meta.dir, "pack-grid-fixture.jsx")],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
});
if (!bundle.success) throw new AggregateError(bundle.logs, "Could not build grid fixture");
const script = bundle.outputs.find((file) => file.path.endsWith(".js"));
const cssDir = ".next/static/css";
const sheets = await Promise.all((await readdir(cssDir)).map((file) => readFile(join(cssDir, file), "utf8")));
const css = sheets.find((sheet) => sheet.includes(".pack-deck-layer"));
if (!css) throw new Error("Build the gallery first to get its tile styles.");

const scenes = ["slope", "lily-hand", "window", "towers", "ruins", "hands"];
const frames = new Map();
for (const [index, scene] of scenes.entries()) {
  const base = `public/world-hero/dear-annete/${scene}/p`;
  const composite = await sharp(base + "0.webp")
    .composite([1, 2, 3, 4, 5].map((i) => ({ input: base + i + ".webp" })))
    .png().toBuffer();
  for (const width of [480, 960, 1440]) {
    const data = await sharp(composite).resize(width, width)
      .webp({ quality: width === 480 ? GRID_VARIANT_WEBP_QUALITY : CARD_THUMB_WEBP_QUALITY }).toBuffer();
    frames.set(`${index}/${width}.webp`, data);
  }
}
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/grid.js") return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    const match = path.match(/^\/frames\/(\d+)\/(\d+\.webp)$/);
    if (match) return new Response(frames.get(`${Number(match[1]) % scenes.length}/${match[2]}`), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=3600" },
    });
    if (path !== "/") return new Response(null, { status: 404 });
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width">
      <style>${css}</style><div id="grid"></div><script type="module" src="/grid.js"></script>`,
      { headers: { "Content-Type": "text/html" } });
  },
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  for (let run = 1; run <= 3; run++) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, reducedMotion: "reduce",
    });
    page.on("pageerror", (error) => console.error(error.stack));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 80, downloadThroughput: 200000, uploadThroughput: 100000,
    });
    await page.goto(server.url.href, { waitUntil: "domcontentloaded" });
    await page.locator(".pack-deck-media").nth(3).waitFor();
    const initial = await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll(".pack-deck-media img,.pack-deck-layer img")];
      await Promise.all(imgs.map((img) => img.decode()));
      const requests = performance.getEntriesByType("resource").filter((r) => r.name.includes("/frames/"));
      return {
        frames: new Set(imgs.map((img) => img.currentSrc)).size,
        ms: Math.round(performance.now() - Math.min(...requests.map((r) => r.startTime))),
        bytes: requests.reduce((sum, r) => sum + r.encodedBodySize, 0),
      };
    });
    const tab = page.getByRole("tab", { name: "Show 4 of 6" }).first();
    // Measure the click and decode in the page's clock. Polling for a
    // visible element from the test driver would add its retry interval.
    await tab.evaluate((el) => el.addEventListener("click", () => {
      const start = performance.now();
      const observer = new MutationObserver(async () => {
        const img = document.querySelector('.pack-deck-frame[data-role="active"] img[alt="Frame 4"]');
        if (!img) return;
        observer.disconnect();
        await img.decode();
        performance.measure("pack-jump", { start, end: performance.now() });
      });
      observer.observe(document.getElementById("grid"), { subtree: true, childList: true, attributes: true });
    }, { once: true }));
    await tab.click();
    await page.waitForFunction(() => performance.getEntriesByName("pack-jump").length > 0);
    const jumpMs = await page.evaluate(() => Math.round(performance.getEntriesByName("pack-jump")[0].duration));
    if (initial.frames !== 12 || !initial.bytes) throw new Error("Incomplete first screen");
    console.log(JSON.stringify({ run, initial, jumpMs }));
    await page.context().close();
  }
} finally {
  await browser.close();
  server.stop();
}
