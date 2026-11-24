// Fast helper. Point at a generated picture on midjourney.com and press ⌥F
// (or hold ⌥ and click the EDIT tag): a card opens beside the frame. Type
// what to change (or click a quick chip), pick a model (1–4 while the line is
// empty), how many takes (⇧1–⇧3), and press Enter. The gallery runs it on fal
// with its own key; the takes come back into the card next to the source.
//
// Review: ←/→ pick a take, hold Space (or press on the picture) to see the
// source, 1 keep (saves it to the gallery in the world), 2 drop, E edit this
// take further, R run again, B put it in the Imagine bar as an image prompt
// (never Enter), F send it to Fantasy Studio as a waiting Seedance 2.5 draft.
// ⇧-click another frame on the page, or drag one in, to add it as a reference.
// Nothing here ever sends a Midjourney job.

(function registerMjFastHelper(globalScope) {
  "use strict";

  // ── Pure helpers (tested) ──

  // Beside the picture; over an edge only when neither side has room.
  function placeBeside(rect, view, size, gap = 12, margin = 10) {
    const roomRight = view.width - rect.right - gap - margin;
    const roomLeft = rect.left - gap - margin;
    let x;
    if (roomRight >= size.width) x = rect.right + gap;
    else if (roomLeft >= size.width) x = rect.left - gap - size.width;
    else if (roomRight >= roomLeft) x = view.width - size.width - margin;
    else x = margin;
    const y = Math.min(Math.max(margin, rect.top), Math.max(margin, view.height - size.height - margin));
    return { x: Math.round(Math.max(margin, x)), y: Math.round(y) };
  }

  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  // The bar text with a picture as the first image prompt. Image prompts lead
  // a Midjourney command; one already there is left where it is.
  function barWithImage(barText, url) {
    const text = clean(barText);
    if (!url) return text;
    if (text.split(" ").includes(url)) return text;
    return text ? `${url} ${text}` : `${url} `;
  }

  // The addresses to read a Midjourney tile from: the PNG original, the WebP,
  // then whatever the page rendered.
  function frameUrls(tile, rendered) {
    const out = [];
    if (tile && tile.jobId) {
      out.push(`https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.png`);
      out.push(`https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.webp`);
    }
    if (rendered && /^https:\/\//.test(rendered) && !out.includes(rendered)) out.push(rendered);
    return out;
  }

  // A Midjourney picture address from a drop: uri-list first, then plain text, then an <img src> in the html.
  function urlFromDrop(drop) {
    const fromList = String(drop?.uri || "").split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
    const fromText = clean(drop?.text);
    const fromHtml = /<img[^>]+src="([^"]+)"/i.exec(String(drop?.html || ""))?.[1];
    for (const candidate of [fromList, fromText, fromHtml]) {
      if (candidate && /^https:\/\/([a-z0-9-]+\.)*(midjourney\.com|mj\.run)\//i.test(candidate)) return candidate.replace(/&amp;/g, "&");
    }
    return "";
  }

  const inFlight = (run) => Boolean(run && (run.status === "queued" || run.status === "running"));
  const anyInFlight = (runs) => (runs || []).some(inFlight);

  // The takes on screen, newest run first, each with its run.
  function flattenTakes(runs) {
    const out = [];
    for (const run of runs || []) {
      for (const take of run.takes || []) out.push({ run, take, key: `${run._id}:${take.index}` });
    }
    return out;
  }

  function stepSelection(count, current, delta) {
    if (!count) return -1;
    if (current < 0) return delta < 0 ? count - 1 : 0;
    return Math.min(count - 1, Math.max(0, current + delta));
  }

  function takeLabel(run, take) {
    const n = (take?.index ?? 0) + 1;
    return `${run?.count > 1 ? `Take ${n}/${run.count}` : "Take"} · ${run?.modelName || ""}`.trim();
  }

  // The plain line a Fantasy draft carries, so Michael sees where it came from.
  function fantasyNote(run) {
    const what = clean(run?.instruction).slice(0, 120);
    return `From Midjourney · ${run?.modelName || "fast helper"}${what ? `: ${what}` : ""}`.slice(0, 200);
  }

  const usd = (n) => `$${Number(n || 0).toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
  function priceText(perTake, count) {
    if (!(perTake > 0)) return "";
    return count > 1 ? `≈ ${usd(perTake * count)}` : `≈ ${usd(perTake)}`;
  }

  globalScope.SaveToGalleryFastHelper = {
    placeBeside, barWithImage, frameUrls, urlFromDrop, anyInFlight, flattenTakes, stepSelection, takeLabel, fantasyNote, priceText,
  };

  const panelMode = typeof location !== "undefined" && location.protocol === "chrome-extension:" && location.pathname.endsWith("/image-edit.html");
  if (typeof document === "undefined" || typeof location === "undefined" || (!panelMode && !/(^|\.)midjourney\.com$/i.test(location.hostname))) return;
  if (globalScope.__saveToGalleryFastHelper) return;
  globalScope.__saveToGalleryFastHelper = true;

  // A reloaded extension leaves the old copy's nodes behind.
  document.querySelectorAll(".stg-fh-root, .stg-fh-tag, .stg-fh-ring, .stg-fh-toast").forEach((node) => node.remove());

  const adapter = () => globalScope.SaveToGalleryMidjourney;
  const STORE = { model: "stgFhModel", count: "stgFhCount", section: "stgFhSection", world: "stgFhWorld", dockWorld: "stgMoodboardWorld", project: "stgFhFantasyProject", asRef: "stgFhFantasyAsRef" };
  const CARD_WIDTH = 432;
  const POLL_MS = 3000;
  const SECTIONS = [["scene", "Scene"], ["location", "Location"], ["character", "Character"], ["inspiration", "Inspiration"]];
  const FALLBACK_MODELS = [
    { id: "seedream-5.5", chip: "Seedream 5.5", name: "Seedream 5.5", hint: "Edit and restyle. Keeps the look of the frame.", default: true },
    { id: "krea-3", chip: "Krea 3", name: "Krea 3", hint: "The edit model. Keeps the frame, changes what you name." },
    { id: "gpt-flare", chip: "GPT 2.6", name: "GPT Image 2.6 Flare", hint: "Change one thing. Never for composing scenes." },
    { id: "nano-21", chip: "Nano 2.1", name: "Nano Banana 2.1", hint: "Good at keeping a face from a reference." },
    { id: "upscale-2k", chip: "Upscale 2K", name: "SeedVR2 upscale", hint: "Twice the size, same picture.", tool: true },
  ];
  const FALLBACK_TEMPLATES = [
    { key: "night", label: "Night", instruction: "Make it night: the same place and moment after dark, lit by its own lamps, windows and moonlight. Keep the composition, the camera and every person as they are." },
    { key: "wider", label: "Wider shot", instruction: "Pull the camera back to a wide shot of the same place: show more of the surroundings around the same subject, same light and same style." },
    { key: "face", label: "Close-up of the face", instruction: "A close-up of the main person's face from this frame: the same person, the same light and the same style, framed from the shoulders up." },
    { key: "clean", label: "Remove text and logos", instruction: "Remove every piece of text, lettering, watermark, signature and logo. Change nothing else." },
    { key: "angle", label: "Same place, other angle", instruction: "The same place and the same moment seen from another camera angle: a different camera position looking across the scene, same light and same style." },
    { key: "upscale", label: "Upscale 2K", instruction: "Upscale", model: "upscale-2k" },
  ];

  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const ask = (action, payload = {}) => new Promise((resolve) => {
    if (!alive()) { resolve({ ok: false, error: "Extension reloaded. Refresh the page." }); return; }
    try {
      chrome.runtime.sendMessage({ action: `fast:${action}`, ...payload }, (res) => {
        const error = chrome.runtime.lastError?.message;
        resolve(error ? { ok: false, error } : res || { ok: false, error: "No answer." });
      });
    } catch (err) { resolve({ ok: false, error: String(err?.message || err) }); }
  });
  const local = (keys) => new Promise((resolve) => { try { chrome.storage.local.get(keys, (v) => resolve(v || {})); } catch { resolve({}); } });
  const setLocal = (value) => { try { chrome.storage.local.set(value); } catch { /* reloaded */ } };
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const el = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  const noFocusSteal = (node) => node.addEventListener("mousedown", (event) => { if (!event.target.closest("input, textarea, select")) event.preventDefault(); });

  // ── Which picture ──

  let pointer = { x: -1, y: -1 };
  document.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { capture: true, passive: true });

  const isOurs = (node) => Boolean(node && node.closest && node.closest(".stg-fh-root, .stg-fh-tag"));

  function mediaAt(x, y) {
    const mj = adapter();
    if (!mj || x < 0) return null;
    const candidates = [];
    for (const node of document.querySelectorAll("img")) {
      if (isOurs(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 96 || rect.height < 96) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (!mj.isMidjourneyMediaUrl(mj.getMediaUrl(node))) continue;
      candidates.push(node);
    }
    if (candidates.length <= 1) return candidates[0] || null;
    for (const node of document.elementsFromPoint(x, y)) {
      if (isOurs(node)) continue;
      const hit = candidates.find((candidate) => node === candidate || node.contains(candidate));
      if (hit) return hit;
    }
    return candidates[0];
  }

  function mainMedia() {
    const mj = adapter();
    if (!mj || !mj.getJobPageSelection(location.href)) return null;
    let best = null;
    for (const node of document.querySelectorAll("img")) {
      if (isOurs(node)) continue;
      const rect = node.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width < 200 || rect.height < 200 || !mj.isMidjourneyMediaUrl(mj.getMediaUrl(node))) continue;
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      if (!best || area > best.area) best = { node, area };
    }
    return best?.node || null;
  }

  function sourceOf(node) {
    const mj = adapter();
    const rendered = mj.getMediaUrl(node);
    const tile = mj.getSaveSelection(rendered, location.href);
    return {
      key: tile ? `${tile.jobId}-${tile.index}` : rendered,
      rendered,
      tile,
      urls: frameUrls(tile, rendered),
      pageUrl: tile ? `https://www.midjourney.com/jobs/${tile.jobId}?index=${tile.index}` : location.href,
      aspect: node.naturalWidth && node.naturalHeight ? node.naturalWidth / node.naturalHeight : 16 / 9,
      command: "",
      upload: null,
    };
  }

  function readCommand(source) {
    const mj = adapter();
    if (!source.tile || !mj?.collectSaveMetadata) return Promise.resolve("");
    return mj.collectSaveMetadata({
      imageUrl: source.urls[0],
      pageUrl: location.href,
      lightboxRoot: document.querySelector("#lightboxPrompt"),
      readPageJob: (jobId) => new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: "readMidjourneyPageJob", jobId }, (res) => { void chrome.runtime.lastError; resolve(res || null); }); } catch { resolve(null); }
      }),
    }).then((collected) => clean(collected?.promptText || "")).catch(() => "");
  }

  // ── The bar ──

  function findBar() {
    return [...document.querySelectorAll("textarea")].find((area) => /imagine/i.test(area.getAttribute("placeholder") || "")) || null;
  }
  function writeBar(text) {
    const area = findBar();
    if (!area) return { ok: false, error: "No Imagine bar on this page. Open Create." };
    const previous = area.value;
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(area, text); else area.value = text;
    const tracker = area._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
    area.focus();
    area.setSelectionRange(text.length, text.length);
    return { ok: true };
  }

  // ── DOM ──

  const ring = el("div", "stg-fh-ring");
  const tag = el("div", "stg-fh-tag", "<i></i>Edit<kbd>⌥Z</kbd>");
  const toast = el("div", "stg-fh-toast");
  const root = el("div", "stg-fh-root");
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Image edit");
  root.innerHTML = `
    <div class="stg-fh-head">
      <div class="stg-fh-name"><i></i>Image edit</div>
      <select class="stg-fh-world" title="Keep saves into this world"></select>
      <button type="button" class="stg-fh-x" title="Close (Esc)">×</button>
    </div>
    <div class="stg-fh-threadbar"><select class="stg-fh-threads" aria-label="Edit threads"><option value="">Edit threads</option></select><button type="button" class="stg-fh-new">New</button><button type="button" class="stg-fh-original">Original</button></div>
    <div class="stg-fh-source-drop" tabindex="0">Drop a Midjourney image to start an edit · ⌥Z on a frame</div>
    <div class="stg-fh-stage">
      <img class="stg-fh-main" alt="">
      <div class="stg-fh-pip" title="The source. Hold Space, or press on the picture, to see it full size."><img alt=""></div>
      <div class="stg-fh-chip"></div>
      <div class="stg-fh-wait"><span class="stg-fh-spin"></span><span></span></div>
    </div>
    <div class="stg-fh-src"></div>
    <div class="stg-fh-takes"></div>
    <div class="stg-fh-acts"></div>
    <div class="stg-fh-fantasy"></div>
    <div class="stg-fh-chatlog" role="log" aria-label="Edit conversation"></div>
    <div class="stg-fh-chatopts"><label><input type="checkbox" class="stg-fh-gallery"> Gallery access</label><select class="stg-fh-writer" aria-label="Prompt writer"></select></div>
    <div class="stg-fh-chatbox"><textarea class="stg-fh-chatinput" rows="2" maxlength="6000" placeholder="Tell the agent what to polish…"></textarea><button type="button" class="stg-fh-chatgo">Ask agent</button></div>
    <label class="stg-fh-draftlabel">Edit prompt · review it, then Run</label>
    <div class="stg-fh-ask">
      <textarea class="stg-fh-idea" rows="3" maxlength="2000" spellcheck="false" autocomplete="off" placeholder="Write an edit prompt, or ask the agent above"></textarea>
      <button type="button" class="stg-fh-go" title="Run (Enter)">Run</button>
    </div>
    <div class="stg-fh-tpls"></div>
    <div class="stg-fh-row">
      <div class="stg-fh-models"></div>
    </div>
    <div class="stg-fh-row stg-fh-row--refs">
      <div class="stg-fh-refs"></div>
      <div class="stg-fh-count" title="How many takes (⇧1–⇧3)"></div>
    </div>
    <div class="stg-fh-line"></div>
    <div class="stg-fh-recent"><b>Recent</b><div class="stg-fh-strip"></div></div>
    <div class="stg-fh-keys"></div>`;

  const $ = (selector) => root.querySelector(selector);
  const ui = {
    threads: $(".stg-fh-threads"), sourceDrop: $(".stg-fh-source-drop"), original: $(".stg-fh-original"), newThread: $(".stg-fh-new"),
    chatlog: $(".stg-fh-chatlog"), chatinput: $(".stg-fh-chatinput"), chatgo: $(".stg-fh-chatgo"), gallery: $(".stg-fh-gallery"), writer: $(".stg-fh-writer"),
    world: $(".stg-fh-world"), stage: $(".stg-fh-stage"), main: $(".stg-fh-main"), pip: $(".stg-fh-pip"), pipImg: $(".stg-fh-pip img"),
    chip: $(".stg-fh-chip"), wait: $(".stg-fh-wait"), src: $(".stg-fh-src"), takes: $(".stg-fh-takes"), acts: $(".stg-fh-acts"),
    fantasy: $(".stg-fh-fantasy"), idea: $(".stg-fh-idea"), go: $(".stg-fh-go"), tpls: $(".stg-fh-tpls"), models: $(".stg-fh-models"),
    count: $(".stg-fh-count"), refs: $(".stg-fh-refs"), line: $(".stg-fh-line"), recent: $(".stg-fh-recent"), strip: $(".stg-fh-strip"), keys: $(".stg-fh-keys"),
  };

  const mount = () => {
    if (!alive()) { teardown(); return false; }
    for (const node of [ring, tag, toast, root]) if (!node.isConnected) (panelMode ? document.body : document.documentElement).appendChild(node);
    return true;
  };
  function teardown() {
    for (const node of [ring, tag, toast, root]) node.remove();
    state.open = false;
  }

  const state = {
    thread: null, threads: [], threadReady: null, chatting: false, requestKey: null, requestThreadId: null,
    open: false, node: null, source: null, catalog: null, models: FALLBACK_MODELS, templates: FALLBACK_TEMPLATES,
    model: "seedream-5.5", count: 1, section: "scene", worlds: [], worldKey: "", refs: [],
    runs: [], sel: -1, comparing: false, fantasyOpen: false, projects: null, project: "", asRef: false, motion: "",
    busy: false, recent: [], href: location.href,
  };
  const bySource = new Map(); // source key → runs started on it this session

  function framePayload(source) {
    return { url: source.upload?.url || source.rendered, ...(source.upload || {}),
      ...(source.tile ? { mjJobId: source.tile.jobId, mjIndex: source.tile.index } : {}),
      ...(source.pageUrl ? { pageUrl: source.pageUrl } : {}), ...(source.command ? { prompt: source.command.slice(0, 6000) } : {}) };
  }
  function sourceFromFrame(frame, key) {
    return { key: key || `run:${frame.parentRunId}:${frame.parentIndex}`, rendered: frame.url, tile: frame.mjJobId ? { jobId: frame.mjJobId, index: frame.mjIndex || 0 } : null,
      urls: [], pageUrl: frame.pageUrl, command: frame.prompt || "", aspect: frame.width && frame.height ? frame.width / frame.height : 16 / 9, upload: { ...frame } };
  }
  function paintChat() {
    ui.gallery.checked = Boolean(state.thread?.galleryEnabled);
    ui.chatgo.disabled = state.chatting || !state.thread;
    ui.idea.disabled = state.chatting;
    ui.threads.disabled = state.chatting || state.busy;
    ui.chatlog.replaceChildren(...(state.thread?.messages || []).map(message => {
      const row = el("div", `stg-fh-message stg-fh-message--${message.role}`);
      const label = el("b"); label.textContent = message.role === "michael" ? "You" : "Agent";
      const text = el("p"); text.textContent = message.text;
      row.append(label, text);
      if (message.prompt) {
        const use = el("button"); use.type = "button"; use.textContent = "Use this prompt";
        use.addEventListener("click", () => { ui.idea.value = message.prompt; void saveThread({ draft: message.prompt }); }); row.append(use);
      }
      if (message.reads?.length) { const reads = el("small"); reads.textContent = `Gallery read: ${message.reads.join(", ")}`; row.append(reads); }
      if (message.role === "michael" && !state.thread.messages.some(entry => entry.id === `${message.id}:answer`)) {
        const retry = el("button"); retry.type = "button"; retry.textContent = "Retry answer"; retry.disabled = state.chatting;
        retry.addEventListener("click", () => void chat(message.id)); row.append(retry);
      }
      return row;
    }));
    ui.chatlog.scrollTop = ui.chatlog.scrollHeight;
    scheduleLayout();
  }
  async function loadThreads() {
    const res = await ask("threadList");
    if (!res?.ok) return;
    state.threads = res.threads || [];
    ui.threads.replaceChildren(new Option("Edit threads…", ""), ...state.threads.map(thread => new Option(thread.title, thread.id)));
    ui.threads.value = state.thread?._id || "";
  }
  function adoptThread(thread, runs, keepSource) {
    state.thread = thread;
    state.model = thread.model; state.count = Math.min(3, thread.count); state.worldKey = thread.world || "";
    ui.idea.value = thread.draft;
    const restored = sourceFromFrame(thread.activeSource, thread.activeSource.parentRunId ? undefined : thread.key);
    if (keepSource && state.source) Object.assign(state.source, restored); else state.source = restored;
    state.runs = runs || []; state.sel = state.runs.length ? 0 : -1;
    state.refs = []; state.fantasyOpen = false;
    setLocal({ stgImageEditLastThread: thread._id });
    paintChat(); paintSource(); paintRefs(); paintWorlds(); paintControls(); paintAll(); pollSoon();
  }
  async function loadThread(id) {
    if (state.chatting || state.busy) return;
    const res = await ask("threadRead", { id });
    if (!res?.ok) { setLine(esc(res?.error || "Could not reopen the edit."), "err"); return; }
    state.node = null;
    state.open = true; mount(); root.classList.add("stg-fh-show", "stg-fh-in");
    adoptThread(res.thread, res.runs);
    state.threadReady = Promise.resolve();
    void loadThreads(); layout();
  }
  async function ensureThread(source) {
    try {
      const upload = source.upload || await prepareSource(source);
      if (!source.command) source.command = await readCommand(source);
      source.upload = upload;
      const res = await ask("threadCreate", { body: { key: source.key, source: framePayload(source) } });
      if (!res?.ok || !res.thread) throw new Error(res?.error || "Could not save the edit thread.");
      const full = await ask("threadRead", { id: res.thread._id });
      if (!full?.ok) throw new Error(full?.error || "Could not read the edit thread.");
      if (state.source !== source) return;
      // A reopened frame resumes the last selected take, with every earlier run.
      adoptThread(full.thread, full.runs, !full.thread.activeSource.parentRunId);
      void loadThreads();
    } catch (error) { if (state.source === source) setLine(esc(error?.message || error), "err"); }
  }
  async function saveThread(patch, id = state.thread?._id) {
    if (!id) return;
    const res = await ask("threadUpdate", { body: { id, ...patch } });
    if (!res?.ok) throw new Error(res?.error || "Could not save the edit.");
    if (state.thread?._id === id) { state.thread = res.thread; paintChat(); }
    return res.thread;
  }
  let draftTimer;
  function saveControls() {
    clearTimeout(draftTimer);
    const id = state.thread?._id;
    const patch = { draft: ui.idea.value, model: state.model, count: state.count, world: state.worldKey };
    draftTimer = setTimeout(() => { void saveThread(patch, id).catch(error => setLine(esc(error.message), "err")); }, 400);
  }
  async function chat(retryId) {
    if (state.chatting) return;
    const text = retryId ? state.thread?.messages.find(message => message.id === retryId)?.text : ui.chatinput.value.trim(); if (!text) return;
    await state.threadReady;
    const id = state.thread?._id; if (!id) { setLine("Open an image first.", "err"); return; }
    state.chatting = true; paintChat();
    clearTimeout(draftTimer);
    const messageId = retryId || crypto.randomUUID();
    try {
      const consent = globalScope.SaveToGalleryEditConsent?.galleryConsent(text);
      if (!retryId) await saveThread({ draft: ui.idea.value, model: state.model, count: state.count, world: state.worldKey, activeSource: framePayload(state.source),
        ...(consent !== undefined ? { galleryEnabled: consent } : {}), message: { id: messageId, role: "michael", text } }, id);
      if (!retryId) ui.chatinput.value = "";
      setLine("<span class='stg-fh-spin'></span><span>Preparing your edit prompt…</span>");
      const res = await ask("chat", { id, messageId });
      if (!res?.ok) throw new Error(res?.error || "The writer could not answer.");
      if (state.thread?._id !== id) return;
      if (res.thread) { state.thread = res.thread; ui.idea.value = res.thread.draft; }
      paintChat(); setLine("Prompt ready. Review it, then Run.");
    } catch (error) { setLine(esc(error?.message || error), "err"); }
    finally { state.chatting = false; paintChat(); }
  }
  ui.chatgo.addEventListener("click", () => void chat());
  ui.chatinput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void chat(); } });
  ui.gallery.addEventListener("change", () => void saveThread({ galleryEnabled: ui.gallery.checked }).catch(error => setLine(esc(error.message), "err")));
  ui.idea.addEventListener("input", saveControls);
  ui.threads.addEventListener("change", () => { if (ui.threads.value) void loadThread(ui.threads.value); });
  ui.newThread.addEventListener("click", () => {
    if (!state.thread || state.busy || state.chatting) return;
    const source = sourceFromFrame(state.thread.source, `edit:${crypto.randomUUID()}`);
    state.source = source; state.thread = null; state.runs = []; state.sel = -1; state.requestKey = null;
    ui.idea.value = ""; paintAll(); paintChat();
    state.threadReady = ensureThread(source);
  });
  ui.original.addEventListener("click", () => {
    if (!state.thread || state.busy || state.chatting) return;
    state.source = sourceFromFrame(state.thread.source, state.thread.key);
    void saveThread({ activeSource: state.thread.source }).catch(error => setLine(esc(error.message), "err"));
    paintSource(); paintStage(); setLine("Editing the original image.");
  });
  void ask("writer").then(res => {
    if (res?.ok) globalScope.SaveToGalleryWriterChoice?.fill(ui.writer, res, { vision: true });
  });
  ui.writer.addEventListener("change", () => {
    const choice = globalScope.SaveToGalleryWriterChoice?.parse(ui.writer.value);
    if (choice) void ask("writer", { choice });
  });

  function openUrl(url) {
    const tile = adapter()?.getSaveSelection(url, "");
    const source = { key: tile ? `${tile.jobId}-${tile.index}` : url, rendered: url, tile, urls: frameUrls(tile, url), pageUrl: tile ? `https://www.midjourney.com/jobs/${tile.jobId}?index=${tile.index}` : "", command: "", aspect: 16 / 9, upload: null };
    state.source = source; state.node = null; state.thread = null; state.runs = []; state.sel = -1;
    state.open = true; mount(); root.classList.add("stg-fh-show", "stg-fh-in");
    paintSource(); paintControls(); paintAll(); paintChat();
    state.threadReady = ensureThread(source);
    void loadCatalog(); void loadThreads(); scheduleLayout();
  }
  ui.sourceDrop.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); });
  ui.sourceDrop.addEventListener("drop", event => {
    event.preventDefault(); event.stopPropagation();
    const dt = event.dataTransfer;
    const url = urlFromDrop({ uri: dt?.getData("text/uri-list"), text: dt?.getData("text/plain"), html: dt?.getData("text/html") });
    if (url) openUrl(url); else setLine("Drop a Midjourney image here.");
  });

  let toastTimer = null;
  function showToast(text) {
    if (!mount()) return;
    toast.textContent = text;
    toast.classList.add("stg-fh-toast--in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("stg-fh-toast--in"), 2400);
  }
  function setLine(html, kind = "") {
    ui.line.className = `stg-fh-line${kind ? ` stg-fh-line--${kind}` : ""}`;
    ui.line.innerHTML = html;
  }

  // ── Layout ──

  let frame = 0;
  function layout() {
    if (!state.open) return;
    if (panelMode) return;
    const node = state.node;
    const rect = node && node.isConnected ? node.getBoundingClientRect() : null;
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
    if (visible) Object.assign(ring.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    else ring.style.display = "none";
    const anchor = visible ? rect : { left: innerWidth, right: innerWidth, top: 70, bottom: 70 };
    const spot = placeBeside(anchor, { width: innerWidth, height: innerHeight }, { width: root.offsetWidth || CARD_WIDTH, height: root.offsetHeight || 480 });
    root.style.left = `${spot.x}px`;
    root.style.top = `${spot.y}px`;
  }
  const scheduleLayout = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  addEventListener("scroll", scheduleLayout, true);
  addEventListener("resize", scheduleLayout);

  // ── Models, count, templates, world ──

  const modelOf = (id) => state.models.find((model) => model.id === id) || state.models[0];
  const editModels = () => state.models.filter((model) => !model.tool).slice(0, 4);

  function paintControls() {
    ui.models.replaceChildren(...editModels().map((model, index) => {
      const button = el("button", `stg-fh-model${model.id === state.model ? " stg-fh-on" : ""}`, `<kbd>${index + 1}</kbd>${esc(model.chip || model.name)}`);
      button.type = "button";
      button.title = `${model.name}: ${model.hint || ""}\n${index + 1} while the line is empty.`;
      noFocusSteal(button);
      button.addEventListener("click", () => pickModel(model.id));
      return button;
    }));
    ui.count.replaceChildren(...[1, 2, 3].map((n) => {
      const button = el("button", `stg-fh-n${n === state.count ? " stg-fh-on" : ""}`, `×${n}`);
      button.type = "button";
      button.title = `${n} take${n > 1 ? "s" : ""} (⇧${n})`;
      noFocusSteal(button);
      button.addEventListener("click", () => pickCount(n));
      return button;
    }));
    ui.tpls.replaceChildren(...state.templates.map((template) => {
      const button = el("button", "stg-fh-tpl", esc(template.label));
      button.type = "button";
      button.title = template.model ? modelOf(template.model)?.hint || template.label : template.instruction;
      noFocusSteal(button);
      button.addEventListener("click", () => useTemplate(template));
      return button;
    }));
    paintPrice();
  }

  function perTake(modelId) {
    const model = state.catalog?.models?.find((entry) => entry.id === modelId);
    return model ? model.perTakeUsd : 0;
  }
  function paintPrice() {
    const tool = modelOf(state.model)?.tool;
    const price = priceText(perTake(state.model), state.count);
    ui.go.innerHTML = `${tool ? esc(modelOf(state.model).chip) : "Run"}${price ? `<em>${esc(price)}</em>` : ""}`;
    ui.go.disabled = state.busy || state.chatting || !state.source || !state.thread;
  }

  function pickModel(id) {
    state.model = id;
    setLocal({ [STORE.model]: id });
    paintControls();
    saveControls();
  }
  function pickCount(n) {
    state.count = n;
    setLocal({ [STORE.count]: n });
    paintControls();
    saveControls();
  }
  function useTemplate(template) {
    if (template.model) {
      // A tool chip runs at once (the upscaler takes no words).
      void run({ model: template.model, instruction: template.instruction, count: 1 });
      return;
    }
    ui.idea.value = template.instruction;
    ui.idea.focus();
    ui.idea.setSelectionRange(0, ui.idea.value.length);
  }

  async function loadCatalog() {
    const upload = state.source?.upload;
    const res = await ask("catalog", { width: upload?.width, height: upload?.height, refs: state.refs.length });
    if (!res?.ok) return;
    state.catalog = res;
    if (Array.isArray(res.models) && res.models.length) state.models = res.models;
    if (Array.isArray(res.templates) && res.templates.length) state.templates = res.templates;
    if (!state.models.some((model) => model.id === state.model)) state.model = (state.models.find((model) => model.default) || state.models[0]).id;
    paintControls();
  }

  function paintWorlds() {
    const options = [{ key: "", name: "No world" }, ...state.worlds];
    ui.world.replaceChildren(...options.map((world) => {
      const option = document.createElement("option");
      option.value = world.key;
      option.textContent = world.name;
      option.selected = world.key === state.worldKey;
      return option;
    }));
  }
  let worldsLoaded = false;
  async function loadWorlds() {
    // The dock's world unless a world was picked here.
    state.worldKey = state.thread?.world || "";
    paintWorlds();
    if (worldsLoaded) return;
    const res = await ask("worlds");
    if (!res?.ok) return;
    worldsLoaded = true;
    state.worlds = res.worlds || [];
    if (state.worldKey && !state.worlds.some((world) => world.key === state.worldKey)) state.worldKey = "";
    paintWorlds();
  }
  ui.world.addEventListener("change", () => { state.worldKey = ui.world.value; setLocal({ [STORE.world]: state.worldKey }); saveControls(); });
  const currentWorld = () => state.worlds.find((world) => world.key === state.worldKey) || null;

  // ── References ──

  function paintRefs() {
    const tiles = state.refs.map((ref, index) => {
      const tile = el("div", "stg-fh-ref", `<img alt="" src="${esc(ref.preview)}"><button type="button" title="Remove">×</button>`);
      tile.querySelector("button").addEventListener("click", () => { state.refs.splice(index, 1); paintRefs(); void loadCatalog(); });
      noFocusSteal(tile);
      return tile;
    });
    const hint = el("span", "stg-fh-refhint", state.refs.length ? `${state.refs.length} reference${state.refs.length > 1 ? "s" : ""}` : "⇧-click or drop frames to add references");
    ui.refs.replaceChildren(...tiles, hint);
  }

  function addRef(node) {
    const mj = adapter();
    const rendered = node ? mj.getMediaUrl(node) : "";
    const tile = mj.getSaveSelection(rendered, "");
    addRefUrl(rendered, tile);
  }
  function addRefUrl(url, tile) {
    if (!url) return;
    const mj = adapter();
    const sel = tile || mj.getSaveSelection(url, "");
    const key = sel ? `${sel.jobId}-${sel.index}` : url;
    if (state.source && key === state.source.key) { showToast("That is the frame itself"); return; }
    if (state.refs.some((ref) => ref.key === key)) return;
    if (state.refs.length >= 6) { showToast("Up to 6 references"); return; }
    state.refs.push({ key, preview: url, urls: frameUrls(sel, url), tile: sel });
    paintRefs();
    void loadCatalog();
  }

  root.addEventListener("dragover", (event) => { event.preventDefault(); root.classList.add("stg-fh-drop"); });
  root.addEventListener("dragleave", (event) => { if (!root.contains(event.relatedTarget)) root.classList.remove("stg-fh-drop"); });
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    root.classList.remove("stg-fh-drop");
    const dt = event.dataTransfer;
    const url = urlFromDrop({ uri: dt?.getData("text/uri-list"), text: dt?.getData("text/plain"), html: dt?.getData("text/html") });
    if (url) addRefUrl(url); else showToast("Drop a Midjourney frame");
  });

  // ── Open / close ──

  function open(node) {
    if (!adapter()) return;
    const target = node || mediaAt(pointer.x, pointer.y) || mainMedia();
    if (!target) { showToast("Point at a picture, then ⌥Z"); return; }
    if (!mount()) return;
    globalScope.SaveToGalleryExpand?.close?.();
    hideTag();
    const source = sourceOf(target);
    const same = state.source && state.source.key === source.key;
    state.node = target;
    state.href = location.href;
    if (!same) {
      state.source = source;
      state.runs = bySource.get(source.key) || [];
      state.sel = state.runs.length ? 0 : -1;
      state.refs = [];
      state.fantasyOpen = false;
      state.thread = null;
      ui.idea.value = "";
      void readCommand(source).then((command) => { source.command = command; if (state.source === source) paintSource(); });
      void prepareSource(source);
      state.threadReady = ensureThread(source);
    }
    if (same && !state.thread) state.threadReady = ensureThread(state.source);
    state.open = true;
    root.classList.add("stg-fh-show");
    requestAnimationFrame(() => root.classList.add("stg-fh-in"));
    paintSource();
    paintRefs();
    paintControls();
    paintAll();
    void loadWorlds();
    void loadCatalog();
    void loadRecent();
    void loadThreads();
    pollSoon();
    layout();
    ui.idea.focus();
  }

  // A run loaded from Recent: its own source, no frame on the page.
  function openRun(run) {
    const source = {
      key: run.source.mjJobId ? `${run.source.mjJobId}-${run.source.mjIndex ?? 0}` : `run:${run._id}`,
      rendered: run.source.url, tile: run.source.mjJobId ? { jobId: run.source.mjJobId, index: run.source.mjIndex ?? 0 } : null,
      urls: [], pageUrl: run.source.pageUrl, command: run.source.prompt || "", aspect: run.source.width && run.source.height ? run.source.width / run.source.height : 16 / 9,
      upload: { url: run.source.url, width: run.source.width, height: run.source.height, parentRunId: run.source.parentRunId, parentIndex: run.source.parentIndex },
    };
    state.source = source;
    const kept = bySource.get(source.key) || [];
    state.runs = [run, ...kept.filter((entry) => entry._id !== run._id)];
    bySource.set(source.key, state.runs);
    state.sel = 0;
    state.refs = [];
    state.node = null;
    state.thread = null;
    state.threadReady = ensureThread(source);
    paintSource();
    paintRefs();
    paintAll();
    pollSoon();
    scheduleLayout();
    root.focus();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.comparing = false;
    root.classList.remove("stg-fh-in", "stg-fh-show");
    ring.style.display = "none";
    clearTimeout(pollTimer);
  }

  // Read the frame once and hand it to the gallery's storage, so Run is quick.
  function prepareSource(source) {
    if (source.ready) return source.ready;
    source.ready = ask("upload", { urls: source.urls }).then((res) => {
      if (!res?.ok) { source.ready = null; throw new Error(res?.error || "Could not read the picture."); }
      source.upload = { r2Key: res.r2Key, width: res.width, height: res.height };
      if (state.source === source) void loadCatalog();
      return source.upload;
    });
    source.ready.catch(() => {});
    return source.ready;
  }

  function paintSource() {
    const source = state.source;
    if (!source) return;
    ui.pipImg.src = source.rendered || "";
    const command = clean(source.command).replace(/(^|\s)--\S+(\s+[^-\s]\S*)*/g, " ").replace(/https?:\/\/\S+/g, "").trim();
    ui.src.textContent = command || (source.tile ? "Midjourney frame" : "A take from an earlier run");
    ui.src.title = source.command || "";
  }

  // ── Run ──

  async function refPayloads() {
    const out = [];
    for (const ref of state.refs) {
      if (ref.upload) { out.push(ref.upload); continue; }
      const res = await ask("upload", { urls: ref.urls });
      if (!res?.ok) throw new Error(res?.error || "Could not read a reference.");
      ref.upload = { r2Key: res.r2Key, ...(ref.tile ? { mjJobId: ref.tile.jobId, mjIndex: ref.tile.index } : {}) };
      out.push(ref.upload);
    }
    return out;
  }

  async function run(opts = {}) {
    if (state.busy || state.chatting || !state.source) return;
    clearTimeout(draftTimer);
    const model = opts.model || state.model;
    const instruction = clean(opts.instruction != null ? opts.instruction : ui.idea.value);
    if (!instruction && !modelOf(model)?.tool) { setLine("Say what to change, or click a chip."); ui.idea.focus(); return; }
    let source = opts.source || state.source;
    if (opts.source) state.source = opts.source;
    state.busy = true;
    paintPrice();
    setLine(`<span class="stg-fh-spin"></span><span>${source.upload?.r2Key || source.upload?.url ? "Sending to fal…" : "Reading the frame…"}</span>`);
    try {
      await state.threadReady;
      const thread = state.thread;
      source = opts.source || state.source;
      if (!thread) throw new Error("The edit thread is not ready. Reopen the image and try again.");
      if (state.requestThreadId !== thread._id) { state.requestKey = null; state.requestThreadId = thread._id; }
      await saveThread({ draft: instruction, model, count: opts.count || state.count, activeSource: framePayload(source) });
      const upload = source.upload?.url ? source.upload : await prepareSource(source);
      const refs = opts.refs || await refPayloads();
      const world = currentWorld();
      const res = await ask("start", {
        run: {
          threadId: thread._id, requestKey: state.requestKey || (state.requestKey = crypto.randomUUID()),
          model, instruction, count: opts.count || state.count,
          source: {
            ...(upload.r2Key ? { r2Key: upload.r2Key } : { url: upload.url }),
            ...(source.tile ? { mjJobId: source.tile.jobId, mjIndex: source.tile.index } : {}),
            ...(source.pageUrl ? { pageUrl: source.pageUrl } : {}),
            ...(source.command ? { prompt: source.command.slice(0, 6000) } : {}),
            ...(upload.parentRunId ? { parentRunId: upload.parentRunId, parentIndex: upload.parentIndex } : {}),
            ...(upload.width ? { width: upload.width } : {}),
            ...(upload.height ? { height: upload.height } : {}),
          },
          refs,
          ...(world ? { world: { key: world.key, name: world.name, folderId: world.worldId || undefined } } : {}),
        },
      });
      if (!res?.ok || !res.run) throw new Error(res?.error || "The gallery did not start it.");
      state.requestKey = null;
      if (state.source !== source) return;
      state.runs = [res.run, ...state.runs];
      bySource.set(source.key, state.runs);
      state.sel = 0;
      setLine(`<span class="stg-fh-spin"></span><span>${esc(res.run.modelName)} · ${res.run.count} take${res.run.count > 1 ? "s" : ""} · ${esc(priceText(res.estimateUsd / res.run.count, res.run.count))}</span>`);
      paintAll();
      pollSoon(POLL_MS);
      root.focus();
    } catch (err) {
      setLine(esc(err?.message || err), "err");
    } finally {
      state.busy = false;
      paintPrice();
      paintChat();
    }
  }

  // ── Poll (every 3 s, only while a run is in flight and the card is open) ──

  let pollTimer = null;
  function pollSoon(delay = 0) {
    clearTimeout(pollTimer);
    if (!state.open || !anyInFlight(state.runs)) return;
    pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (!state.open || !alive()) return;
    const ids = state.runs.filter((entry) => entry.status === "queued" || entry.status === "running").map((entry) => entry._id);
    const threadId = state.thread?._id;
    if (!ids.length) return;
    const res = await ask("runs", { ids });
    if (state.thread?._id !== threadId) return;
    if (res?.ok && Array.isArray(res.runs)) {
      const fresh = new Map(res.runs.map((entry) => [entry._id, entry]));
      const before = state.runs.map((entry) => entry.status).join();
      state.runs = state.runs.map((entry) => fresh.get(entry._id) || entry);
      if (state.source) bySource.set(state.source.key, state.runs);
      paintAll();
      const after = state.runs.map((entry) => entry.status).join();
      if (before !== after && !anyInFlight(state.runs)) {
        const latest = state.runs[0];
        const errors = (latest?.takes || []).filter((take) => take.status === "error");
        if (latest?.status === "error") setLine(esc(errors[0]?.error || latest.error || "Nothing came back."), "err");
        else setLine(`<span>${esc(latest.modelName)} · ${latest.takes.filter((t) => t.status === "done").length} back${latest.costUsd ? ` · ${esc(usd(latest.costUsd))}` : ""}${errors.length ? ` · ${errors.length} failed` : ""}</span>`);
        void loadRecent(true);
      }
    }
    pollSoon(POLL_MS);
  }

  // ── Takes and review ──

  const takes = () => flattenTakes(state.runs);
  const selected = () => takes()[state.sel] || null;

  function paintAll() {
    const list = takes();
    if (state.sel >= list.length) state.sel = list.length - 1;
    paintStage();
    ui.takes.replaceChildren(...list.map((entry, index) => {
      const { take, run: owner } = entry;
      const cls = ["stg-fh-take"];
      if (index === state.sel) cls.push("stg-fh-sel");
      if (take.review === "dropped") cls.push("stg-fh-dropped");
      const pending = take.status !== "done" && take.status !== "error";
      const tile = el("button", cls.join(" "), pending
        ? `<span class="stg-fh-spin"></span>`
        : take.status === "error"
          ? `<span class="stg-fh-x2">!</span>`
          : `<img alt="" loading="lazy" decoding="async" src="${esc(take.thumbUrl || take.url)}">`);
      tile.type = "button";
      tile.title = take.status === "error" ? take.error || "Failed" : `${takeLabel(owner, take)}\n${owner.instruction}`;
      if (take.review === "kept") tile.appendChild(el("u", "stg-fh-pill", "Kept"));
      if (take.fantasyDraftIds?.length) tile.appendChild(el("s", "stg-fh-pill stg-fh-pill--fs", "Fantasy"));
      noFocusSteal(tile);
      tile.addEventListener("click", () => { state.sel = index; state.fantasyOpen = false; paintAll(); root.focus(); });
      return tile;
    }));
    ui.takes.classList.toggle("stg-fh-has", list.length > 0);
    paintActions();
    paintFantasy();
    paintKeys();
    scheduleLayout();
  }

  function paintStage() {
    const entry = selected();
    const source = state.source;
    const take = entry?.take;
    const showSource = state.comparing || !take || take.status !== "done";
    const src = showSource ? source?.rendered : take.url;
    if (src && ui.main.getAttribute("src") !== src) ui.main.src = src;
    if (source?.aspect) ui.stage.style.aspectRatio = String(take?.width && take?.height && !showSource ? take.width / take.height : source.aspect);
    ui.pip.style.display = take && take.status === "done" && !state.comparing ? "block" : "none";
    ui.chip.textContent = showSource ? "Source" : takeLabel(entry.run, take);
    ui.chip.classList.toggle("stg-fh-chip--src", showSource);
    const waiting = take && take.status !== "done" && take.status !== "error";
    ui.wait.style.display = waiting ? "flex" : "none";
    if (waiting) ui.wait.lastElementChild.textContent = `${entry.run.modelName} is working…`;
    ui.stage.classList.toggle("stg-fh-dim", Boolean(take?.review === "dropped" && !showSource));
  }

  function paintActions() {
    const entry = selected();
    const done = entry && entry.take.status === "done";
    if (!done) { ui.acts.replaceChildren(); ui.acts.classList.remove("stg-fh-has"); return; }
    const { take } = entry;
    const act = (key, label, fn, cls = "") => {
      const button = el("button", `stg-fh-act ${cls}`.trim(), `<kbd>${key}</kbd>${label}`);
      button.type = "button";
      noFocusSteal(button);
      button.addEventListener("click", () => void fn());
      return button;
    };
    const section = el("select", "stg-fh-section");
    section.title = "What the piece is, for the gallery";
    for (const [value, label] of SECTIONS) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; option.selected = value === state.section;
      section.appendChild(option);
    }
    section.addEventListener("change", () => { state.section = section.value; setLocal({ [STORE.section]: state.section }); root.focus(); });
    ui.acts.replaceChildren(
      act("1", take.review === "kept" ? "Kept" : "Keep", keep, take.review === "kept" ? "stg-fh-act--done" : "stg-fh-act--main"),
      section,
      act("2", take.review === "dropped" ? "Undrop" : "Drop", drop),
      act("E", "Edit", editFurther),
      act("R", "Again", again),
      act("B", "Bar", toBar),
      act("F", take.fantasyDraftIds?.length ? "In Fantasy" : "Fantasy", toggleFantasy, take.fantasyDraftIds?.length ? "stg-fh-act--done" : ""),
    );
    ui.acts.classList.add("stg-fh-has");
  }

  function paintKeys() {
    const reviewing = takes().length > 0;
    ui.keys.innerHTML = reviewing
      ? "<span><b>←→</b> pick</span><span><b>Space</b> source</span><span><b>1</b> keep</span><span><b>2</b> drop</span><span><b>E</b> edit</span><span><b>/</b> type</span><span><b>Esc</b> close</span>"
      : "<span><b>↵</b> run</span><span><b>1–4</b> model</span><span><b>⇧1–3</b> takes</span><span><b>⇧-click</b> add reference</span><span><b>Esc</b> close</span>";
  }

  function replaceRun(updated) {
    if (!updated?._id) return;
    state.runs = state.runs.map((entry) => (entry._id === updated._id ? updated : entry));
    if (state.source) bySource.set(state.source.key, state.runs);
    paintAll();
  }
  function flash() { ui.takes.querySelector(".stg-fh-sel")?.classList.add("stg-fh-flash"); }

  async function keep() {
    const entry = selected();
    if (!entry || entry.take.status !== "done") return;
    if (entry.take.review === "kept") { showToast("Already in the gallery"); return; }
    const world = currentWorld();
    setLine(`<span class="stg-fh-spin"></span><span>Saving to ${esc(world?.name || "the gallery")}…</span>`);
    const res = await ask("save", { body: { runId: entry.run._id, index: entry.take.index, section: state.section, ...(world?.worldId ? { folderId: world.worldId } : {}) } });
    if (!res?.ok) { setLine(esc(res?.error || "Could not save."), "err"); return; }
    if (res.run) replaceRun(res.run);
    flash();
    setLine(`<span>Kept in ${esc(world?.name || "the gallery")}${res.already ? " (it was already there)" : ""}.</span>`);
  }

  async function drop() {
    const entry = selected();
    if (!entry || entry.take.status !== "done" || entry.take.review === "kept") return;
    const review = entry.take.review === "dropped" ? "pending" : "dropped";
    const res = await ask("review", { body: { runId: entry.run._id, index: entry.take.index, review } });
    if (!res?.ok) { setLine(esc(res?.error || "Could not drop it."), "err"); return; }
    replaceRun(res.run);
    if (review === "dropped") {
      const next = stepSelection(takes().length, state.sel, 1);
      if (next !== state.sel) { state.sel = next; paintAll(); }
    }
  }

  // E: the take becomes the source of a new run (a chained edit).
  function editFurther() {
    const entry = selected();
    if (!entry || entry.take.status !== "done") return;
    const { run: owner, take } = entry;
    const source = {
      key: `run:${owner._id}:${take.index}`,
      rendered: take.url, tile: null, urls: [], pageUrl: owner.source.pageUrl, command: owner.source.prompt || "",
      aspect: take.width && take.height ? take.width / take.height : state.source?.aspect || 16 / 9,
      upload: { url: take.url, width: take.width, height: take.height, parentRunId: owner._id, parentIndex: take.index },
    };
    state.source = source;
    state.fantasyOpen = false;
    ui.idea.value = "";
    void saveThread({ activeSource: framePayload(source), draft: "" }).catch(error => setLine(esc(error.message), "err"));
    paintSource();
    paintAll();
    setLine("<span>Editing that take. Say what to change next.</span>");
    ui.idea.focus();
  }

  // R: the same run again, same frame, words, model and count.
  function again() {
    const entry = selected();
    const owner = entry?.run || state.runs[0];
    if (!owner) return;
    const source = state.source;
    const repeatedSource = sourceFromFrame(owner.source, source?.key);
    void run({ model: owner.model, instruction: owner.instruction, count: Math.min(3, owner.count), source: repeatedSource });
  }

  function toBar() {
    const entry = selected();
    if (!entry || entry.take.status !== "done") return;
    const bar = findBar();
    const done = writeBar(barWithImage(bar ? bar.value : "", entry.take.url));
    if (!done.ok) { setLine(esc(done.error), "err"); return; }
    close();
    showToast("In the bar as an image prompt. Edit it, then Enter.");
  }

  // ── To Fantasy · Seedance 2.5 ──

  function toggleFantasy() {
    const entry = selected();
    if (!entry || entry.take.status !== "done") return;
    state.fantasyOpen = !state.fantasyOpen;
    paintFantasy();
    if (state.fantasyOpen) void loadProjects();
  }

  async function loadProjects(fresh = false) {
    if (state.projects && !fresh) { paintFantasy(); return; }
    state.projects = { loading: true };
    paintFantasy();
    const stored = await local([STORE.project, STORE.asRef]);
    state.asRef = stored[STORE.asRef] === true;
    const res = await ask("fantasyProjects");
    state.projects = res?.ok ? { list: res.projects || [] } : { error: res?.error || "Open Fantasy Studio first.", offline: Boolean(res?.offline) };
    const list = state.projects.list || [];
    const remembered = String(stored[STORE.project] || "");
    state.project = list.some((project) => project.id === remembered) ? remembered : list[0]?.id || "";
    paintFantasy();
  }

  function paintFantasy() {
    const entry = selected();
    const show = state.fantasyOpen && entry && entry.take.status === "done";
    ui.fantasy.classList.toggle("stg-fh-has", Boolean(show));
    if (!show) { ui.fantasy.replaceChildren(); return; }
    const projects = state.projects;
    const head = el("div", "stg-fh-fs-head", "<b>To Fantasy</b><span>Seedance 2.5 · a waiting draft, nothing runs</span>");
    if (!projects || projects.loading) { ui.fantasy.replaceChildren(head, el("div", "stg-fh-fs-msg", '<span class="stg-fh-spin"></span>Looking for Fantasy Studio…')); return; }
    if (projects.error) {
      const msg = el("div", "stg-fh-fs-msg", `${esc(projects.offline ? "Open Fantasy Studio first." : projects.error)} `);
      const retry = el("button", "stg-fh-link", "Check again");
      retry.type = "button";
      retry.addEventListener("click", () => void loadProjects(true));
      msg.appendChild(retry);
      ui.fantasy.replaceChildren(head, msg);
      return;
    }
    if (!projects.list.length) { ui.fantasy.replaceChildren(head, el("div", "stg-fh-fs-msg", "Fantasy Studio has no project yet.")); return; }
    const select = el("select", "stg-fh-fs-project");
    for (const project of projects.list) {
      const option = document.createElement("option");
      option.value = project.id; option.textContent = project.name; option.selected = project.id === state.project;
      select.appendChild(option);
    }
    select.addEventListener("change", () => { state.project = select.value; setLocal({ [STORE.project]: state.project }); });
    const motion = el("input", "stg-fh-fs-motion");
    motion.type = "text";
    motion.placeholder = "Motion: what moves, how the camera goes (else a slow push-in)";
    motion.value = state.motion;
    motion.spellcheck = false;
    motion.addEventListener("input", () => { state.motion = motion.value; });
    motion.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void sendFantasy(); } });
    const as = el("div", "stg-fh-seg");
    for (const [value, label, title] of [[false, "First frame", "The take opens the shot"], [true, "Reference", "The take guides the look"]]) {
      const button = el("button", value === state.asRef ? "stg-fh-on" : "", label);
      button.type = "button";
      button.title = title;
      noFocusSteal(button);
      button.addEventListener("click", () => { state.asRef = value; setLocal({ [STORE.asRef]: value }); paintFantasy(); });
      as.appendChild(button);
    }
    const send = el("button", "stg-fh-fs-send", "Send to Fantasy");
    send.type = "button";
    noFocusSteal(send);
    send.addEventListener("click", () => void sendFantasy());
    const row = el("div", "stg-fh-fs-row");
    row.append(select, as);
    const row2 = el("div", "stg-fh-fs-row");
    row2.append(motion, send);
    ui.fantasy.replaceChildren(head, row, row2);
  }

  async function sendFantasy() {
    const entry = selected();
    if (!entry || entry.take.status !== "done" || !state.project) return;
    const project = state.projects?.list?.find((item) => item.id === state.project);
    setLine(`<span class="stg-fh-spin"></span><span>Sending to ${esc(project?.name || "Fantasy")}…</span>`);
    const res = await ask("fantasySend", {
      project: state.project, projectName: project?.name, imageUrl: entry.take.url, prompt: clean(state.motion),
      note: fantasyNote(entry.run), asReference: state.asRef, runId: entry.run._id, index: entry.take.index,
    });
    if (!res?.ok) {
      if (res?.offline) { state.projects = { error: "Open Fantasy Studio first.", offline: true }; paintFantasy(); }
      setLine(esc(res?.offline ? "Open Fantasy Studio first. Nothing was lost." : res?.error || "Fantasy Studio refused it."), "err");
      return;
    }
    if (res.run) replaceRun(res.run);
    state.fantasyOpen = false;
    paintAll();
    setLine(`<span>In ${esc(project?.name || "Fantasy")}: a Seedance 2.5 draft waits in Drafts. Nothing ran.</span>`);
  }

  // ── Recent ──

  let recentAt = 0;
  async function loadRecent(fresh = false) {
    if (!fresh && Date.now() - recentAt < 15000) { paintRecent(); return; }
    recentAt = Date.now();
    const res = await ask("recent");
    if (res?.ok) state.recent = res.runs || [];
    paintRecent();
  }
  function paintRecent() {
    const runs = state.recent || [];
    ui.recent.classList.toggle("stg-fh-has", runs.length > 0);
    ui.strip.replaceChildren(...runs.map((entry) => {
      const take = entry.takes.find((item) => item.review === "kept") || entry.takes.find((item) => item.status === "done");
      const tile = el("button", `stg-fh-rec${state.runs.some((own) => own._id === entry._id) ? " stg-fh-on" : ""}`,
        `<img alt="" src="${esc(take?.thumbUrl || entry.source.url || "")}">${entry.takes.some((item) => item.review === "kept") ? "<u></u>" : ""}`);
      tile.type = "button";
      tile.title = `${entry.modelName}: ${entry.instruction}`;
      noFocusSteal(tile);
      tile.addEventListener("click", () => openRun(entry));
      return tile;
    }));
  }

  // ── Keys ──

  const plain = (event) => !event.metaKey && !event.ctrlKey && !event.altKey;
  function onCardKey(event) {
    const active = document.activeElement;
    if (active === ui.chatinput && event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void chat(); return; }
    const inIdea = active === ui.idea;
    const inField = Boolean(active && active !== ui.idea && active.matches?.("input, textarea, select"));
    const digit = /^Digit([1-4])$/.exec(event.code)?.[1];

    if (event.key === "Escape") {
      event.preventDefault();
      if (state.fantasyOpen) { state.fantasyOpen = false; paintFantasy(); root.focus(); } else close();
      return;
    }
    if (digit && Number(digit) <= 3 && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !inField) { event.preventDefault(); pickCount(Number(digit)); return; }
    if (inField) return;
    if (inIdea) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void run(); return; }
      if (digit && plain(event) && !ui.idea.value) { event.preventDefault(); const model = editModels()[Number(digit) - 1]; if (model) pickModel(model.id); return; }
      if (event.key === "ArrowUp" && takes().length && !ui.idea.value) { event.preventDefault(); root.focus(); return; }
      return;
    }
    if (!plain(event)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === " ") {
      event.preventDefault();
      if (!state.comparing) { state.comparing = true; paintStage(); }
      return;
    }
    const handlers = {
      ArrowRight: () => { state.sel = stepSelection(takes().length, state.sel, 1); state.fantasyOpen = false; paintAll(); },
      ArrowLeft: () => { state.sel = stepSelection(takes().length, state.sel, -1); state.fantasyOpen = false; paintAll(); },
      1: () => void keep(), 2: () => void drop(),
      e: editFurther, r: again, b: toBar, f: toggleFantasy,
      "/": () => ui.idea.focus(), i: () => ui.idea.focus(), Tab: () => ui.idea.focus(),
      Enter: () => ui.idea.focus(),
    };
    const handler = handlers[key];
    if (handler) { event.preventDefault(); handler(); }
  }

  function showTag() {
    if (state.open) return;
    const node = mediaAt(pointer.x, pointer.y);
    if (!node || !mount()) return;
    const rect = node.getBoundingClientRect();
    // Right of Grow's tag when it shows, else where Grow's would be.
    const grow = document.getElementById("stg-expand")?.shadowRoot?.querySelector(".tag");
    const growRect = grow && grow.style.display !== "none" ? grow.getBoundingClientRect() : null;
    const left = growRect && growRect.width ? growRect.right + 6 : Math.max(8, rect.left + 8);
    tag.style.left = `${left}px`;
    tag.style.top = `${Math.max(8, rect.bottom - 30)}px`;
    tag.classList.add("stg-fh-tag--in");
    tag.__node = node;
  }
  let altTimer = null;
  const hideTag = () => { clearTimeout(altTimer); tag.classList.remove("stg-fh-tag--in"); };
  tag.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  tag.addEventListener("click", (event) => { event.stopPropagation(); const node = tag.__node; hideTag(); open(node && node.isConnected ? node : null); });

  window.addEventListener("keydown", (event) => {
    if (!alive()) { teardown(); return; }
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && ["KeyF", "KeyZ"].includes(event.code)) {
      if (event.target?.closest?.("input, textarea, [contenteditable='true']") || event.isComposing || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      hideTag();
      const under = mediaAt(pointer.x, pointer.y);
      const other = under && state.open && state.source && sourceOf(under).key !== state.source.key;
      if (state.open && !other) close(); else open(under);
      return;
    }
    // Grow (⌥X) opening closes this card.
    if (state.open && event.altKey && event.code === "KeyX") { close(); return; }
    if (event.key === "Alt" && !state.open && !event.repeat) { clearTimeout(altTimer); altTimer = setTimeout(showTag, 380); return; }
    if (!state.open) return;
    if (!event.composedPath().includes(root)) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    event.stopPropagation();
    onCardKey(event);
  }, true);
  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") hideTag();
    if (state.open && event.composedPath().includes(root)) {
      event.stopPropagation();
      if (event.key === " " && state.comparing) { state.comparing = false; paintStage(); }
    }
  }, true);
  window.addEventListener("keypress", (event) => { if (state.open && event.composedPath().includes(root)) event.stopPropagation(); }, true);
  addEventListener("blur", () => { hideTag(); if (state.comparing) { state.comparing = false; paintStage(); } });

  // Press on the picture: the source while held.
  ui.stage.addEventListener("pointerdown", (event) => { event.preventDefault(); state.comparing = true; paintStage(); });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) {
    ui.stage.addEventListener(type, () => { if (state.comparing) { state.comparing = false; paintStage(); } });
  }

  // A click elsewhere closes the card; ⇧-click on a frame adds it as a reference.
  document.addEventListener("mousedown", (event) => {
    if (panelMode) return;
    if (!state.open || !alive()) return;
    if (event.composedPath().includes(root) || event.composedPath().includes(tag)) return;
    if (event.shiftKey) {
      const node = mediaAt(event.clientX, event.clientY);
      if (node) { event.preventDefault(); event.stopPropagation(); if (node !== state.node) addRef(node); return; }
    }
    if (state.busy) return;
    close();
  }, true);
  document.addEventListener("click", (event) => {
    // The ⇧-click that added a reference must not also open the frame.
    if (state.open && event.shiftKey && !event.composedPath().includes(root) && mediaAt(event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  ui.go.addEventListener("click", () => void run());
  $(".stg-fh-x").addEventListener("click", close);
  noFocusSteal(ui.go);

  // Midjourney is a single-page app: a route change closes the card. A dead
  // extension context takes every node with it.
  setInterval(() => {
    if (!alive()) { teardown(); return; }
    if (state.open && location.href !== state.href) close();
  }, 500);

  void local([STORE.model, STORE.count, STORE.section]).then((stored) => {
    if (typeof stored[STORE.model] === "string") state.model = stored[STORE.model];
    const n = Number(stored[STORE.count]);
    if (n >= 1 && n <= 3) state.count = n;
    if (SECTIONS.some(([value]) => value === stored[STORE.section])) state.section = stored[STORE.section];
  });

  globalScope.SaveToGalleryFastHelper.open = open;
  globalScope.SaveToGalleryFastHelper.close = close;
  let refreshingThread = false;
  setInterval(async () => {
    if (!state.open || state.busy || state.chatting || !state.thread || refreshingThread || root.contains(document.activeElement) && document.activeElement?.matches("input, textarea, select")) return;
    refreshingThread = true;
    const id = state.thread._id;
    try {
      const head = await ask("threadHead", { id });
      if (!head?.ok || state.thread?._id !== id || head.updatedAt <= state.thread.updatedAt) return;
      const fresh = await ask("threadRead", { id });
      if (fresh?.ok && state.thread?._id === id && !state.busy && !state.chatting) {
        const selection = state.sel;
        adoptThread(fresh.thread, fresh.runs);
        state.sel = Math.min(selection, takes().length - 1); paintAll();
      }
    } finally { refreshingThread = false; }
  }, 15000);
  if (panelMode) {
    mount(); state.open = true; root.classList.add("stg-fh-show", "stg-fh-in");
    paintControls(); paintChat(); void loadThreads(); void loadWorlds();
    void local("stgImageEditLastThread").then(stored => { if (stored.stgImageEditLastThread) void loadThread(stored.stgImageEditLastThread); });
    addEventListener("message", event => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "image-edit-visible") return;
      state.open = Boolean(event.data.visible); if (state.open) pollSoon(); else clearTimeout(pollTimer);
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
