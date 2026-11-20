// Rerun random: a small bar under each job on Midjourney's Create feed, below
// the job's settings chips (chaos, ar, raw, profile …). One click puts the
// job's own prompt back in the Imagine bar with a fresh random mix of the
// dock world's profiles (1–2), plus one of its moodboards (switch), and the
// style reference as picked: keep the job's own, none, a random one of the
// world's styles, or one named sref from the world's styles and presets.
// It only fills the bar: Michael's own Enter sends it (Midjourney flagged a
// scripted send as a bot on 14 Nov 2026). Nothing here presses or submits.
//
// The bar stays in view for long prompts: when the job row clips it, it
// docks to the bottom of the row instead (mode "dock").
(function registerMjRerun(globalScope) {
  "use strict";

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const CHIP = /^(ar|aspect|chaos|c|stylize|s|weird|w|profile|p|raw|hd|sref|sw|sv|seed|v|version|niji|draft|exp|tile|q|quality|iw|oref|ow|cref|cw|no|stop|style|relax|fast|turbo)(\s|$)/i;
  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  // ── Pure helpers (tested) ──

  // A chip's text: short, starts with a Midjourney parameter name.
  function isChipText(text) {
    const value = space(text);
    return value.length > 0 && value.length <= 40 && CHIP.test(value);
  }

  // Every job is V8.2: an older --v in a rerun becomes --v 8.2.
  function onCurrentVersion(command) {
    return String(command || "").replace(/(^|\s)--(v|version)\s+(?!8\.2(?:\s|$))\d+(?:\.\d+)?(?=\s|$)/gi, "$1--v 8.2");
  }

  // The command that goes in the bar. sref: "keep" | "none" | "random" | a code.
  function rerunCommand({ command, pool, srefs, moodboard = true, sref = "keep", R, rng = Math.random }) {
    const avoid = R.signature(R.codesIn(command));
    const mix = R.rerunMix(pool, { moodboard, avoid, rng });
    let srefMode = sref;
    let srefPick = null;
    if (sref === "random") {
      const list = (srefs || []).filter((entry) => entry && entry.code);
      srefPick = list.length ? list[Math.floor(rng() * list.length)] : null;
      srefMode = srefPick ? srefPick.code : "keep";
    } else if (sref && sref !== "keep" && sref !== "none") {
      srefPick = (srefs || []).find((entry) => entry.code === sref) || { code: sref, label: sref };
    }
    const next = onCurrentVersion(R.withSref(R.withCodes(command, mix.codes), srefMode));
    return { command: next, mix, sref: srefPick };
  }

  globalScope.SaveToGalleryMjRerun = { isChipText, onCurrentVersion, rerunCommand };

  // ── The page ──

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  try {
    globalScope.__stgMjRerun?.teardown?.();
  } catch {
    // an older copy that cannot be reached
  }
  for (const node of document.querySelectorAll(".stg-rerun-host")) node.remove();

  const STORE = { moodboard: "stgRerunMoodboard", sref: "stgRerunSref" };
  const WORLD_KEY = "stgMoodboardWorld";
  const HOST_ATTR = "data-stg-rerun";
  const cleanups = [];
  const settings = { moodboard: true, sref: "keep", world: "" };
  const cache = { pool: new Map(), srefs: new Map() };
  // One request per world at a time, however many bars ask.
  const inflight = new Map();
  const once = (key, run) => {
    if (!inflight.has(key)) inflight.set(key, run().finally(() => inflight.delete(key)));
    return inflight.get(key);
  };

  function alive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function send(message) {
    return new Promise((resolve) => {
      if (!alive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function readStore() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORE.moodboard, STORE.sref, WORLD_KEY], (stored) => resolve(stored || {}));
      } catch {
        resolve({});
      }
    });
  }

  function writeStore(values) {
    try {
      void chrome.storage.local.set(values);
    } catch {
      // storage unavailable
    }
  }

  // The world's profiles and moodboards (the dock's list), kept 5 minutes.
  async function poolOf(world) {
    if (!world) return null;
    const hit = cache.pool.get(world);
    if (hit && Date.now() - hit.at < 300000) return hit.value;
    const res = await once(`pool:${world}`, () => send({ action: "listMoodboards", world }));
    if (!res || res.ok === false) return null;
    const value = globalScope.SaveToGalleryMjQueue?.poolFromMoodboards?.(res) || { profiles: [], boards: [], names: {} };
    cache.pool.set(world, { at: Date.now(), value });
    return value;
  }

  // The --sref codes the world's styles and presets use, kept 5 minutes.
  async function srefsOf(world) {
    if (!world) return [];
    const hit = cache.srefs.get(world);
    if (hit && Date.now() - hit.at < 300000) return hit.value;
    const res = await once(`srefs:${world}`, () => send({ action: "listWorldSrefs", world }));
    const value = res && res.ok !== false && Array.isArray(res.srefs) ? res.srefs : [];
    cache.srefs.set(world, { at: Date.now(), value });
    return value;
  }

  function findTextarea() {
    return [...document.querySelectorAll("textarea")].find((area) => /imagine/i.test(area.getAttribute("placeholder") || "")) || null;
  }

  function writeBar(area, next) {
    const previous = area.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(area, next);
    else area.value = next;
    const tracker = area._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // The job's full command, as the save widget reads it (job status, then the page).
  async function commandOf(row) {
    const mj = globalScope.SaveToGalleryMidjourney;
    if (!mj?.collectSaveMetadata || !row.imageUrl) return "";
    try {
      const collected = await mj.collectSaveMetadata({
        imageUrl: row.imageUrl,
        pageUrl: location.href,
        lightboxRoot: null,
        readPageJob: (jobId) => send({ action: "readMidjourneyPageJob", jobId }),
      });
      return space(collected?.promptText || "");
    } catch {
      return "";
    }
  }

  // ── Finding the job rows ──

  const jobIdOf = (img) => {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!/cdn\.midjourney\.com\//i.test(src)) return null;
    const match = UUID.exec(src);
    return match ? match[0].toLowerCase() : null;
  };

  const isOurs = (node) => Boolean(node.closest?.(".stg-rerun-host, [class*='stg-']"));

  function chipsIn(scope) {
    const out = [];
    for (const node of scope.querySelectorAll("button, [role='button'], span, div, a")) {
      if (node.childElementCount > 3 || isOurs(node)) continue;
      if ([...node.children].some((child) => !/^(svg|span|b|i|em|strong)$/i.test(child.tagName))) continue;
      if (!isChipText(node.textContent)) continue;
      // The outermost chip-like box only (a span inside a chip button is the same chip).
      if (node.parentElement && isChipText(node.parentElement.textContent) && node.parentElement.childElementCount <= 3 && out.includes(node.parentElement)) continue;
      out.push(node);
    }
    return out.filter((node) => !out.some((other) => other !== node && other.contains(node)));
  }

  function longText(scope) {
    for (const node of scope.querySelectorAll("p, span, div")) {
      if (isOurs(node) || node.childElementCount > 2) continue;
      if (space(node.textContent).length >= 40) return node;
    }
    return null;
  }

  // The chips' own row: the smallest element holding every chip.
  function chipRow(chips) {
    let node = chips[0].parentElement;
    while (node && !chips.every((chip) => node.contains(chip))) node = node.parentElement;
    return node;
  }

  // One row per job: the nearest ancestor of its image that also holds its
  // prompt and its chips, and no other job.
  function rowFor(img, jobId) {
    let node = img.parentElement;
    for (let level = 0; level < 14 && node && node !== document.body; level += 1, node = node.parentElement) {
      const ids = new Set();
      for (const other of node.querySelectorAll("img")) {
        const id = jobIdOf(other);
        if (id) ids.add(id);
        if (ids.size > 1) break;
      }
      if (ids.size > 1) return null;
      if (!longText(node)) continue;
      const chips = chipsIn(node);
      if (!chips.length) continue;
      const row = chipRow(chips);
      if (!row) continue;
      return { root: node, chips: row, jobId, imageUrl: img.currentSrc || img.src };
    }
    return null;
  }

  // ── The bar ──

  const CSS = `
    :host{all:initial;display:block;font-family:Inter,"Helvetica Neue",Arial,sans-serif}
    .bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:8px 0 2px;padding:5px;border:1px solid rgba(255,244,234,.10);border-radius:12px;background:rgba(10,8,5,.92);max-width:100%;box-sizing:border-box;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
    :host([data-mode="dock"]) .bar{margin:0;box-shadow:0 -10px 24px rgba(10,8,5,.85)}
    button,select{font:inherit;cursor:pointer}
    .go{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px 0 9px;border:0;border-radius:999px;background:#F26157;color:#191919;font:800 11px/1 Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .go:hover{background:#ff7a6f}
    .go:disabled{opacity:.55;cursor:wait}
    .go svg{width:14px;height:14px;flex:none}
    .pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid rgba(255,244,234,.14);border-radius:999px;background:#191919;color:rgba(255,244,234,.62);font:700 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .pill:hover{color:#FFF4EA;border-color:rgba(255,244,234,.3)}
    .pill i{width:7px;height:7px;border-radius:50%;background:rgba(255,244,234,.25)}
    .pill.on{color:#FFF4EA;border-color:rgba(121,183,145,.55)}
    .pill.on i{background:#79B791;box-shadow:0 0 6px rgba(121,183,145,.8)}
    select.pill{appearance:none;-webkit-appearance:none;padding:0 22px 0 10px;max-width:220px;text-overflow:ellipsis;overflow:hidden;background-image:linear-gradient(45deg,transparent 50%,rgba(255,244,234,.55) 50%),linear-gradient(135deg,rgba(255,244,234,.55) 50%,transparent 50%);background-position:calc(100% - 12px) 12px,calc(100% - 8px) 12px;background-size:4px 4px;background-repeat:no-repeat}
    select.pill option{background:#191919;color:#FFF4EA;text-transform:none}
    select.pill.on{border-color:rgba(232,168,56,.55);color:#FFF4EA}
    .world{font:700 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,244,234,.38);padding:0 4px;white-space:nowrap}
    .note{flex-basis:100%;font:600 11px/1.35 Inter,sans-serif;color:rgba(255,244,234,.62);padding:2px 6px 1px;overflow-wrap:anywhere}
    .note b{color:#FFF4EA;font-weight:700}
    .note.warn{color:#E8A838}
    .note:empty{display:none}
  `;

  const DICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/></svg>';

  const hosts = new Set();

  function worldName(key) {
    return space(String(key || "").replace(/[-_]+/g, " ")) || "";
  }

  function srefOptions(select, srefs) {
    const options = [
      ["keep", "Sref: its own"],
      ["none", "Sref: none"],
      ["random", srefs.length ? `Sref: random of ${srefs.length}` : "Sref: random (none in world)"],
      ...srefs.map((entry) => [entry.code, `${entry.label || "Sref"} · ${entry.code}`]),
    ];
    const current = settings.sref;
    select.replaceChildren(...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    // A named sref the world no longer lists falls back to "its own".
    select.value = options.some(([value]) => value === current) ? current : "keep";
    select.classList.toggle("on", select.value !== "keep");
    select.title = "Style reference for the rerun: the job's own, none, a random one of the world's styles, or one named sref from the world's styles and presets.";
  }

  function paintAll() {
    for (const host of hosts) host.__paint?.();
  }

  function makeHost(row) {
    const host = document.createElement("div");
    host.className = "stg-rerun-host";
    host.setAttribute(HOST_ATTR, row.jobId);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style>
      <div class="bar" role="group" aria-label="Rerun with a random profile">
        <button class="go" type="button">${DICE}<span>Rerun random</span></button>
        <button class="pill mb" type="button"><i></i>Moodboard</button>
        <select class="pill sref" aria-label="Style reference"></select>
        <span class="world"></span>
        <div class="note" aria-live="polite"></div>
      </div>`;
    const go = shadow.querySelector(".go");
    const mb = shadow.querySelector(".mb");
    const select = shadow.querySelector(".sref");
    const worldEl = shadow.querySelector(".world");
    const note = shadow.querySelector(".note");
    let noteTimer = null;
    const say = (html, warn = false) => {
      clearTimeout(noteTimer);
      note.innerHTML = html;
      note.classList.toggle("warn", warn);
      noteTimer = setTimeout(() => { note.textContent = ""; }, warn ? 6000 : 9000);
    };
    // Clicks in the bar stay in the bar (Midjourney opens the job on a row click).
    for (const type of ["click", "mousedown", "pointerdown"]) {
      shadow.querySelector(".bar").addEventListener(type, (event) => event.stopPropagation());
    }
    host.__paint = () => {
      mb.classList.toggle("on", settings.moodboard);
      mb.title = settings.moodboard ? "One of the world's moodboards rides with the random profiles. Click to leave moodboards out." : "Profiles only. Click to add one of the world's moodboards.";
      worldEl.textContent = settings.world ? worldName(settings.world) : "Pick a world in the dock";
      worldEl.title = "The world whose profiles, moodboards and srefs are mixed in: the moodboard dock's world.";
      void srefsOf(settings.world).then((srefs) => srefOptions(select, srefs));
    };
    mb.addEventListener("click", () => {
      settings.moodboard = !settings.moodboard;
      writeStore({ [STORE.moodboard]: settings.moodboard });
      paintAll();
    });
    select.addEventListener("change", () => {
      settings.sref = select.value;
      writeStore({ [STORE.sref]: settings.sref });
      paintAll();
    });
    go.title = "Put this job's prompt in the Imagine bar with random profiles of the world (and a moodboard, and the sref you picked). Nothing is sent: press Enter to run it.";
    go.addEventListener("click", async (event) => {
      if (!event.isTrusted || go.disabled) return;
      if (!settings.world) return say("Pick a world in the moodboard dock first: its profiles and moodboards are what get mixed in.", true);
      const area = findTextarea();
      if (!area) return say("No Imagine bar on this page. Open Create.", true);
      go.disabled = true;
      go.querySelector("span").textContent = "Reading…";
      try {
        const [command, pool, srefs] = await Promise.all([commandOf(row), poolOf(settings.world), srefsOf(settings.world)]);
        if (!command) return say("Could not read this job's prompt. Open the job once, then try again.", true);
        if (!pool || !pool.profiles.length) return say(`No profiles in ${worldName(settings.world)} yet.`, true);
        const R = globalScope.SaveToGalleryRandomize;
        const out = rerunCommand({ command, pool, srefs, moodboard: settings.moodboard, sref: settings.sref, R });
        // The moodboard dock must not add its remembered -p flag to this command.
        globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
        writeBar(area, out.command);
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
        const names = pool.names || {};
        const label = (code) => `<b>${escapeHtml(names[code] || code)}</b>`;
        const parts = [...out.mix.profiles.map(label), ...out.mix.boards.map((code) => `${label(code)} (moodboard)`)];
        const srefLine = out.sref ? ` · sref <b>${escapeHtml(out.sref.label || out.sref.code)}</b>` : settings.sref === "none" ? " · no sref" : "";
        say(`In the bar: ${parts.join(" + ")}${srefLine}. Press Enter to run it.`);
      } finally {
        go.disabled = false;
        go.querySelector("span").textContent = "Rerun random";
      }
    });
    hosts.add(host);
    host.__paint();
    return host;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  // The nearest ancestor (inside the row) that hides what overflows it.
  function clipperOf(node, root) {
    for (let at = node.parentElement; at && at !== root.parentElement; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) || /(hidden|clip)/.test(style.overflow)) return at;
    }
    return null;
  }

  // In the flow under the chips when it fits; docked to the bottom of the row
  // when a long prompt pushes it out of view.
  function place(host, row) {
    if (host.dataset.mode !== "dock") {
      if (host.previousElementSibling !== row.chips || host.parentElement !== row.chips.parentElement) row.chips.after(host);
      const clipper = clipperOf(host, row.root);
      const box = host.getBoundingClientRect();
      const limit = (clipper || row.root).getBoundingClientRect();
      if (box.height && box.bottom > limit.bottom + 1) dock(host, row);
      return;
    }
    if (host.parentElement !== row.root) dock(host, row);
  }

  function dock(host, row) {
    host.dataset.mode = "dock";
    const style = getComputedStyle(row.root);
    if (style.position === "static") row.root.style.position = "relative";
    const left = Math.max(0, row.chips.getBoundingClientRect().left - row.root.getBoundingClientRect().left);
    host.style.cssText = `position:absolute;left:${left}px;right:8px;bottom:8px;z-index:5`;
    row.root.appendChild(host);
  }

  // ── Scan: one bar per job row, put back when Midjourney redraws ──

  const rows = new Map();
  let relayout = true;
  function scan() {
    if (!alive()) return teardown();
    if (!/\/(imagine|create|organize|archive)/.test(location.pathname)) return;
    const seen = new Set();
    const reach = globalScope.innerHeight * 2;
    const layout = relayout;
    relayout = false;
    for (const img of document.querySelectorAll("img[src*='cdn.midjourney.com/']")) {
      const jobId = jobIdOf(img);
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      const known = rows.get(jobId);
      if (known && known.root.isConnected && known.chips.isConnected && known.host.isConnected) {
        if (layout) place(known.host, known);
        continue;
      }
      // Rows far off screen get their bar when they scroll near.
      const box = img.getBoundingClientRect();
      if (box.bottom < -reach || box.top > globalScope.innerHeight + reach) continue;
      const row = rowFor(img, jobId);
      if (!row) continue;
      const host = known?.host || document.querySelector(`.stg-rerun-host[${HOST_ATTR}="${jobId}"]`) || makeHost(row);
      host.dataset.mode = "";
      host.style.cssText = "";
      rows.set(jobId, { ...row, host });
      place(host, rows.get(jobId));
    }
    for (const [jobId, row] of rows) {
      if (!row.root.isConnected) {
        row.host.remove();
        hosts.delete(row.host);
        rows.delete(jobId);
      }
    }
  }

  let scanTimer = null;
  const scanSoon = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 500);
  };
  const observer = new MutationObserver((records) => {
    if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every((node) => node.nodeType === 1 && node.classList?.contains("stg-rerun-host")))) return;
    scanSoon();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());
  const onResize = () => { relayout = true; scanSoon(); };
  globalScope.addEventListener("resize", onResize);
  cleanups.push(() => globalScope.removeEventListener("resize", onResize));
  const onScroll = () => scanSoon();
  globalScope.addEventListener("scroll", onScroll, { passive: true, capture: true });
  cleanups.push(() => globalScope.removeEventListener("scroll", onScroll, { capture: true }));

  const onStorage = (changes, area) => {
    if (area !== "local") return;
    let changed = false;
    if (changes[WORLD_KEY]) { settings.world = String(changes[WORLD_KEY].newValue || ""); changed = true; }
    if (changes[STORE.moodboard]) { settings.moodboard = changes[STORE.moodboard].newValue !== false; changed = true; }
    if (changes[STORE.sref]) { settings.sref = String(changes[STORE.sref].newValue || "keep"); changed = true; }
    if (changed) paintAll();
  };
  try {
    chrome.storage.onChanged.addListener(onStorage);
    cleanups.push(() => chrome.storage.onChanged.removeListener(onStorage));
  } catch {
    // storage unavailable
  }

  function teardown() {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // already gone
      }
    }
    clearTimeout(scanTimer);
    for (const host of hosts) host.remove();
    hosts.clear();
    rows.clear();
  }
  globalScope.__stgMjRerun = { teardown };

  void readStore().then((stored) => {
    settings.world = String(stored[WORLD_KEY] || "");
    settings.moodboard = stored[STORE.moodboard] !== false;
    settings.sref = String(stored[STORE.sref] || "keep");
    scan();
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
