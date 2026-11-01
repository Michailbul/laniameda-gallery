// usage: node lazyprobe.mjs <url> <out.json>  — mobile 390x844, focus emulated, no eager forcing.
import WebSocket from '/Users/eallincreative/openclaw-agents/_shared/bin/mj/node_modules/ws/index.js';
import fs from 'node:fs';
const [,, url, outPath] = process.argv;
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); });
const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank', background: true });
const { result: { sessionId: S } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, S); await send('Network.enable', {}, S); await send('Runtime.enable', {}, S);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
await send('Network.setCacheDisabled', { cacheDisabled: true }, S);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, S);
const pump = async (ms) => { const until = Date.now() + ms; while (Date.now() < until) { await send('Page.captureScreenshot', { format: 'jpeg', quality: 10, clip: { x: 0, y: 0, width: 50, height: 50, scale: 0.1 } }, S); await sleep(250); } };
const probe = `(() => {
  const vh = innerHeight;
  const tiles = [...document.querySelectorAll('#gallery-main-content img')];
  const r2 = performance.getEntriesByType('resource').filter(e => /r2\\.dev|laniameda/.test(e.name) && e.initiatorType === 'img');
  let inView = 0, near = 0, far = 0, farLoaded = 0, farRequested = 0;
  const requested = new Set(r2.map(e => e.name));
  for (const img of tiles) {
    const b = img.getBoundingClientRect();
    const dist = b.top > vh ? b.top - vh : b.bottom < 0 ? -b.bottom : 0;
    if (dist === 0) inView++; else if (dist < 1250) near++; else { far++; if (img.complete && img.naturalWidth) farLoaded++; if (img.currentSrc && requested.has(img.currentSrc)) farRequested++; }
  }
  const sc = document.querySelector('#gallery-main-content')?.closest('.overflow-y-auto') || document.scrollingElement;
  return { scrollTop: Math.round(sc.scrollTop), imgs: tiles.length, inView, near, far, farLoaded, farRequested, imgRequests: r2.length, imgKB: Math.round(r2.reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0) / 1024), domNodes: document.getElementsByTagName('*').length };
})()`;
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S)).result?.result?.value;
const out = { url, steps: [] };
try {
  await send('Page.navigate', { url }, S);
  for (let t = 0; t < 120 && !events.some(e => e.method === 'Page.loadEventFired'); t++) await sleep(250);
  await pump(9000);
  out.steps.push({ at: 'load', ...(await ev(probe)) });
  for (let i = 1; i <= 10; i++) {
    await ev(`(() => { const sc = document.querySelector('#gallery-main-content')?.closest('.overflow-y-auto') || document.scrollingElement; sc.scrollBy(0, innerHeight); return true; })()`);
    await pump(1500);
    if (i % 5 === 0) out.steps.push({ at: 'scroll' + i, ...(await ev(probe)) });
  }
  const netImgs = events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.type === 'Image').length;
  out.networkImageRequests = netImgs;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
} finally { await send('Target.closeTarget', { targetId }); ws.close(); }
