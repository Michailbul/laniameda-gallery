// Re-measure Convex websocket frames with timing and optional network throttle.
// usage: node wsframes.mjs <url> <out.json> [mobile] [throttle: none|4g|slow4g]
import WebSocket from '/Users/eallincreative/openclaw-agents/_shared/bin/mj/node_modules/ws/index.js';
import fs from 'node:fs';
const [,, url, outPath, mobileFlag, throttle='none'] = process.argv;
const mobile = mobileFlag === 'mobile';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); });
const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ct = await send('Target.createTarget', { url: 'about:blank', background: true });
const { targetId } = ct.result;
const { result: { sessionId: S } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, S); await send('Network.enable', {}, S); await send('Runtime.enable', {}, S);
await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile }, S);
const profiles = { none: null, '4g': { latency: 150, down: 1.6e6/8, up: 750e3/8 }, 'lte': { latency: 70, down: 10e6/8, up: 5e6/8 } };
const p = profiles[throttle]; if (p) await send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up }, S);
if (process.env.CPU) await send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) }, S);
try {
  await send('Page.navigate', { url }, S);
  for (let t = 0; t < 160 && !events.some(e => e.method === 'Page.loadEventFired'); t++) await sleep(250);
  await sleep(Number(process.env.SETTLE || 12000));
  const perf = await send('Runtime.evaluate', { expression: `JSON.stringify({paint: performance.getEntriesByType('paint').map(p=>({n:p.name,t:Math.round(p.startTime)})), lcp: (performance.getEntriesByType('largest-contentful-paint')||[]).map(e=>Math.round(e.startTime)), imgs: document.images.length, cards: document.querrySelectorAll ? 0 : document.querySelectorAll('[data-asset-id]').length})`, returnByValue: true }, S);
  let navAt = null; let hs = null; const q = new Map(); const frames = [];
  for (const e of events) {
    if (navAt === null && e.method === 'Network.requestWillBeSent' && e.params.type === 'Document') navAt = e.params.timestamp;
    if (e.method === 'Network.webSocketHandshakeResponseReceived') hs = e.params.response.headers;
    const rel = () => Math.round((e.params.timestamp - navAt) * 1000);
    if (e.method === 'Network.webSocketFrameSent') { let m; try { m = JSON.parse(e.params.response.payloadData); } catch { continue; }
      if (m.type === 'ModifyQuerySet') for (const mod of m.modifications ?? []) { if (mod.type === 'Add') q.set(mod.queryId, { udfPath: mod.udfPath, args: mod.args?.[0], sentAt: rel() }); if (mod.type === 'Remove') { const x = q.get(mod.queryId); if (x) x.removedAt = rel(); } } }
    if (e.method === 'Network.webSocketFrameReceived') { const raw = e.params.response.payloadData; let m; try { m = JSON.parse(raw); } catch { continue; }
      const f = { at: rel(), type: m.type, bytes: raw.length, queries: [] };
      if (m.type === 'Transition') for (const mod of m.modifications ?? []) if (mod.type === 'QueryUpdated' || mod.type === 'QueryFailed') { const x = q.get(mod.queryId) ?? {}; f.queries.push({ id: mod.queryId, udfPath: x.udfPath, bytes: JSON.stringify(mod.value ?? null).length, rows: Array.isArray(mod.value) ? mod.value.length : mod.value?.page?.length ?? null }); }
      frames.push(f); if (process.env.DUMP && m.type === "Transition") fs.appendFileSync(process.env.DUMP, raw + "\n"); }
  }
  const out = { url, mobile, throttle, cpu: process.env.CPU || null, handshake: { ext: hs?.['sec-websocket-extensions'] ?? hs?.['Sec-WebSocket-Extensions'] ?? null }, perf: JSON.parse(perf.result?.result?.value ?? 'null'), subs: [...q.entries()].map(([k, v]) => ({ id: k, ...v })), frames };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ throttle, ext: out.handshake.ext, perf: out.perf }));
  for (const f of frames) console.log(f.at, 'ms', f.type, f.bytes, 'B', f.queries.map(x => `${x.id}:${x.udfPath}=${x.bytes}`).join(' '));
  for (const s of out.subs) if (/Page/.test(s.udfPath)) console.log('sub', s.id, s.sentAt, s.removedAt ?? '', JSON.stringify(s.args));
} finally { await send('Target.closeTarget', { targetId }); ws.close(); }
