// Midjourney prompt queue panel on midjourney.com. Agents queue prompts in the
// gallery with every reference set; here Michael reviews one, injects it into
// the Imagine bar, edits it if he wants and sends it himself. A send is always
// his own click on Send (or his own Enter in the bar): one job per click, no
// loops, no timers, nothing submitted in the background.
(function registerMjQueue(globalScope) {
  "use strict";

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const OPEN_KEY = "stgMjQueueOpen";
  const BATCH_KEY = "stgMjQueueBatch";
  const RAIL_KEY = "stgMjQueueRail";
  const SCOPE_KEY = "stgMjQueueScope";
  const REFRESH_OPEN_MS = 60000;
  const REFRESH_CLOSED_MS = 180000;
  const SEND_CONFIRM_MS = 5000;
  const JOB_WATCH_MS = 120000;
  const ROUTE_PATH = "/api/extension/mj-queue";
  const CANONICAL_API_HOST = "gallery.laniameda.space";
  const LEGACY_API_HOSTS = ["laniameda.gallery", "laniameda-galery.vercel.app"];
  const TRANSIENT = /message port closed|receiving end does not exist/i;

  const compose = () => globalScope.SaveToGalleryMjQueueCompose;
  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const capital = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

  // ── Pure helpers (tested) ──

  // The next item to inject in a batch: the first queued one after `afterId`
  // in order, else the first queued one from the top.
  function nextQueued(items, afterId) {
    const open = (item) => item.status === "queued";
    const list = items || [];
    const at = afterId ? list.findIndex((item) => item.id === afterId) : -1;
    return list.slice(at + 1).find(open) || list.find(open) || null;
  }

  function jobIdsIn(values) {
    const ids = new Set();
    for (const value of values || []) {
      for (const match of String(value || "").matchAll(UUID)) ids.add(match[0].toLowerCase());
    }
    return ids;
  }

  // The opening words of a prompt, as Midjourney's feed prints them.
  function promptNeedle(item) {
    return space(item && item.prompt).toLowerCase().split(" ").slice(0, 5).join(" ");
  }

  // One reference per line: a URL or an sref code, optionally "::weight".
  function parseRefLines(text, previous) {
    const byUrl = new Map((previous || []).filter((ref) => ref.url).map((ref) => [ref.url, ref]));
    const refs = [];
    for (const raw of String(text || "").split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      const match = /^(\S+?)(?:::(-?\d+(?:\.\d+)?))?$/.exec(line.split(/\s+/)[0]);
      if (!match) continue;
      const value = match[1];
      const weight = match[2] != null ? Number(match[2]) : undefined;
      const known = byUrl.get(value);
      // A gallery image keeps its asset id (the gallery re-reads its URL).
      const ref = known && known.assetId
        ? { assetId: `asset:${known.assetId}`, url: known.url }
        : /^(https?:\/\/|asset:)/i.test(value)
          ? { url: value }
          : { code: value };
      if (weight != null && Number.isFinite(weight)) ref.weight = weight;
      if (known && known.label) ref.label = known.label;
      refs.push(ref);
    }
    return refs;
  }

  function refLines(refs) {
    return (refs || [])
      .map((ref) => {
        const base = ref.url || ref.code || "";
        return typeof ref.weight === "number" ? `${base}::${ref.weight}` : base;
      })
      .filter(Boolean)
      .join("\n");
  }

  function writeTextareaValue(element, next) {
    const previous = element.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    const tracker = element._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Threads: one batch is one thread (an agent session's line of work) ──

  const left = (batch) => (batch.queued || 0) + (batch.injected || 0);

  function worldLabel(worldKey) {
    const key = space(worldKey);
    return key ? key.replace(/[-_]+/g, " ").toUpperCase() : "OTHER";
  }

  // The thread's own words: "Dear Annete · the monster's hand" → "the monster's hand"
  // when it sits under the Dear Annete group already.
  function threadName(batch) {
    const name = space(batch && batch.batch);
    const world = worldLabel(batch && batch.worldKey).toLowerCase();
    const parts = name.split(/\s+·\s+/);
    if (parts.length > 1 && parts[0].toLowerCase().replace(/[-_]+/g, " ") === world) return parts.slice(1).join(" · ");
    return name;
  }

  // Groups by world; inside a group, threads with prompts to send come first
  // (newest first), finished ones after. scope "open" leaves finished ones out.
  function threadGroups(batches, scope) {
    const groups = new Map();
    for (const batch of batches || []) {
      const done = left(batch) === 0;
      if (scope === "open" && done) continue;
      const key = space(batch.worldKey) || "";
      if (!groups.has(key)) groups.set(key, { worldKey: key, label: worldLabel(key), threads: [], left: 0 });
      const group = groups.get(key);
      group.threads.push({ ...batch, name: threadName(batch), left: left(batch), done });
      group.left += left(batch);
    }
    const byOpenThenNew = (a, b) => Number(a.done) - Number(b.done) || (b.updatedAt || 0) - (a.updatedAt || 0);
    const out = [...groups.values()];
    for (const group of out) group.threads.sort(byOpenThenNew);
    return out.sort((a, b) => b.left - a.left || a.label.localeCompare(b.label));
  }

  // The threads in rail order, for stepping with the keyboard.
  function threadOrder(batches, scope) {
    return threadGroups(batches, scope).flatMap((group) => group.threads.map((thread) => thread.batchKey));
  }

  const FILTERS = {
    open: (item) => item.status === "queued" || item.status === "injected",
    sent: (item) => item.status === "sent",
    skipped: (item) => item.status === "skipped",
    all: () => true,
  };

  // The items a filter shows; the one in the bar always stays in view.
  function filterItems(items, filter, activeId) {
    const keep = FILTERS[filter] || FILTERS.open;
    return (items || []).filter((item) => item.id === activeId || keep(item));
  }

  function filterCounts(items) {
    const counts = { open: 0, sent: 0, skipped: 0, all: 0 };
    for (const item of items || []) {
      counts.all += 1;
      for (const key of ["open", "sent", "skipped"]) if (FILTERS[key](item)) counts[key] += 1;
    }
    return counts;
  }

  // Thread counts from the items on hand, so a send shows in the rail at once.
  function recount(batches, items) {
    return (batches || []).map((batch) => {
      const own = (items || []).filter((item) => item.batchKey === batch.batchKey);
      if (!own.length) return batch;
      const count = (status) => own.filter((item) => item.status === status).length;
      return { ...batch, total: own.length, queued: count("queued"), injected: count("injected"), sent: count("sent"), skipped: count("skipped") };
    });
  }

  globalScope.SaveToGalleryMjQueue = {
    recount,
    nextQueued, jobIdsIn, promptNeedle, parseRefLines, refLines,
    threadName, threadGroups, threadOrder, filterItems, filterCounts,
  };

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  // ── State ──

  const state = {
    open: false,
    batches: [],
    items: [],
    batchKey: "",
    // Which items of the thread show: open (to send), sent, skipped, all.
    filter: "open",
    // The threads rail on the left, and whether it lists finished threads.
    railOpen: true,
    scope: "open",
    activeId: null,
    readback: "",
    sending: false,
    lastSentId: null,
    editingId: null,
    // What is typed in the open edit form, kept across re-renders.
    editDraft: null,
    message: "",
    error: "",
    loading: true,
  };
  let root = null;
  let launcher = null;
  let panel = null;
  let watchedArea = null;
  let pendingSend = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, className, onClick, title) => {
    const node = el("button", `stg-q-btn ${className || ""}`.trim(), label);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("mousedown", (event) => event.preventDefault());
    node.addEventListener("click", onClick);
    return node;
  };

  function findTextarea() {
    return (
      [...document.querySelectorAll("textarea")].find((area) =>
        /imagine/i.test(area.getAttribute("placeholder") || ""),
      ) || null
    );
  }

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  // ── Gallery calls ──

  function askBackground(message) {
    return new Promise((resolve) => {
      if (!extensionAlive()) {
        resolve({ ok: false, error: "Extension reloaded. Refresh the page." });
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: "mjQueue", ...message }, (res) => {
          const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (error) {
            resolve({ ok: false, error, transient: TRANSIENT.test(error) });
            return;
          }
          resolve(res || { ok: false, error: "No response.", transient: true });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  function routeUrl(rawApiUrl, query) {
    let url;
    try {
      url = new URL(String(rawApiUrl || "").trim() || `https://${CANONICAL_API_HOST}`);
    } catch {
      url = new URL(`https://${CANONICAL_API_HOST}`);
    }
    if (LEGACY_API_HOSTS.includes(url.hostname)) {
      url.protocol = "https:";
      url.hostname = CANONICAL_API_HOST;
    }
    url.pathname = ROUTE_PATH;
    url.search = "";
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    url.hash = "";
    return url.toString();
  }

  // The service worker can be mid-restart: ask the gallery directly then.
  async function fetchDirect(message) {
    let config;
    try {
      config = await chrome.storage.sync.get(["apiUrl", "apiToken"]);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    const token = String(config?.apiToken || "").trim();
    const post = message.method === "POST";
    let response;
    try {
      response = await fetch(routeUrl(config?.apiUrl, post ? null : message.query), {
        method: post ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(token ? { "X-Extension-Token": token } : {}) },
        body: post ? JSON.stringify(message.body || {}) : undefined,
      });
    } catch (err) {
      return { ok: false, error: `Network error: ${err?.message || err}` };
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      // body wasn't JSON
    }
    if (!response.ok || !data) return { ok: false, status: response.status, error: data?.error || `HTTP ${response.status}` };
    return data;
  }

  async function call(message) {
    let res = await askBackground(message);
    if (res.ok || !res.transient) return res;
    await new Promise((resolve) => setTimeout(resolve, 400));
    res = await askBackground(message);
    if (res.ok || !res.transient || !extensionAlive()) return res;
    return fetchDirect(message);
  }

  async function refresh(options = {}) {
    const res = await call({ method: "GET", query: {} });
    state.loading = false;
    if (!res.ok) {
      if (options.quiet && state.items.length) return;
      state.error = res.status === 401 || /unauthorized|token/i.test(res.error || "")
        ? "Gallery token missing. Open the extension settings."
        : `Could not load the queue. ${String(res.error || "").slice(0, 80)}`;
      render();
      return;
    }
    state.error = "";
    state.batches = Array.isArray(res.batches) ? res.batches : [];
    state.items = Array.isArray(res.items) ? res.items : [];
    if (!state.batches.some((batch) => batch.batchKey === state.batchKey)) {
      state.batchKey = threadOrder(state.batches, "open")[0] || threadOrder(state.batches, "all")[0] || "";
    }
    if (options.quiet) renderSoft();
    else render();
  }

  async function save(item, patch) {
    const res = await call({ method: "POST", body: { itemId: item.id, ...patch } });
    if (!res.ok) {
      state.error = `Not saved. ${String(res.error || "").slice(0, 120)}`;
      render();
      return null;
    }
    const index = state.items.findIndex((entry) => entry.id === item.id);
    if (index !== -1 && res.item) state.items[index] = res.item;
    state.batches = recount(state.batches, state.items);
    state.error = "";
    return res.item || null;
  }

  // ── The bar ──

  function batchItems() {
    return state.items
      .filter((item) => item.batchKey === state.batchKey)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  function visibleItems() {
    return filterItems(batchItems(), state.filter, state.activeId);
  }

  function remember(values) {
    try {
      chrome.storage.local.set(values);
    } catch {
      // storage unavailable after a reload
    }
  }

  function selectThread(batchKey) {
    if (!batchKey || batchKey === state.batchKey) return;
    state.batchKey = batchKey;
    state.activeId = null;
    state.editingId = null;
    state.editDraft = null;
    state.message = "";
    state.filter = "open";
    remember({ [BATCH_KEY]: batchKey });
    render();
    const list = panel && panel.querySelector(".stg-q-list");
    if (list) list.scrollTop = 0;
  }

  // ⌥⇧↓ / ⌥⇧↑: the next or previous thread in the rail.
  function stepThread(delta) {
    const order = threadOrder(state.batches, state.scope);
    if (!order.length) return;
    const at = order.indexOf(state.batchKey);
    const next = order[(at + delta + order.length) % order.length];
    if (!state.open) setOpen(true);
    selectThread(next);
  }

  function inject(item) {
    const area = findTextarea();
    if (!area) {
      state.message = "Open the Create page: no Imagine bar here.";
      render();
      return;
    }
    const { command } = compose().composeMjCommand(item);
    // The moodboard dock must not add its remembered -p flag to this command.
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    writeTextareaValue(area, command);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    state.activeId = item.id;
    state.readback = area.value;
    state.sending = false;
    state.message = "";
    state.editingId = null;
    watchArea(area);
    if (item.status !== "injected") {
      item.status = "injected";
      save(item, { status: "injected" }).then(render);
    }
    render();
    // Midjourney can rewrite the bar a moment later (it trims or re-renders).
    setTimeout(() => {
      if (state.activeId !== item.id || !area.isConnected) return;
      state.readback = area.value;
      render();
    }, 300);
  }

  function injectNext() {
    const items = batchItems();
    const next = nextQueued(items, state.activeId || state.lastSentId);
    if (!next) {
      state.message = "Nothing left to send in this batch.";
      render();
      return;
    }
    inject(next);
  }

  function snapshotJobIds() {
    const values = [];
    for (const node of document.querySelectorAll('a[href*="/jobs/"], img[src*="cdn.midjourney.com/"]')) {
      values.push(node.getAttribute("href") || node.getAttribute("src") || "");
    }
    return jobIdsIn(values);
  }

  // After his send: the first new job id on the page whose feed row prints
  // the prompt's opening words. Reads the page only; asks Midjourney nothing.
  function watchForJob(item, before) {
    const needle = promptNeedle(item);
    if (!needle) return;
    const started = Date.now();
    let timer = null;
    const check = () => {
      timer = null;
      for (const node of document.querySelectorAll('a[href*="/jobs/"], img[src*="cdn.midjourney.com/"]')) {
        const ids = jobIdsIn([node.getAttribute("href") || node.getAttribute("src") || ""]);
        for (const id of ids) {
          if (before.has(id)) continue;
          let row = node;
          for (let level = 0; level < 10 && row; level += 1, row = row.parentElement) {
            if (space(row.textContent).toLowerCase().includes(needle)) {
              observer.disconnect();
              save(item, { jobId: id }).then(renderSoft);
              return;
            }
          }
          before.add(id);
        }
      }
    };
    const observer = new MutationObserver(() => {
      if (Date.now() - started > JOB_WATCH_MS) {
        observer.disconnect();
        return;
      }
      if (!timer) timer = setTimeout(check, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
    setTimeout(() => observer.disconnect(), JOB_WATCH_MS);
    // The row may already be there by the time the send is recorded.
    check();
  }

  async function markSent(item, command, before) {
    state.sending = false;
    state.activeId = null;
    state.lastSentId = item.id;
    state.message = "Sent. Next is ready when you are.";
    item.status = "sent";
    render();
    await save(item, { status: "sent", sentCommand: command });
    render();
    watchForJob(item, before);
  }

  // Midjourney empties the bar when it takes a job. Wait for that.
  function confirmSend(item, command, before) {
    const area = findTextarea();
    pendingSend = { itemId: item.id };
    const started = Date.now();
    const tick = () => {
      if (!pendingSend || pendingSend.itemId !== item.id) return;
      const current = findTextarea();
      if (!current || space(current.value) !== space(command)) {
        pendingSend = null;
        markSent(item, command, before);
        return;
      }
      if (Date.now() - started > SEND_CONFIRM_MS) {
        pendingSend = null;
        state.sending = false;
        state.message = "Midjourney did not take it. Press Enter in the bar.";
        render();
        return;
      }
      setTimeout(tick, 150);
    };
    if (area) tick();
  }

  // Send: only from his own click. Presses Enter in the bar once, the way
  // he would; the bar's own command (with any edit he made there) is sent.
  function onSendClick(event, item) {
    if (!event.isTrusted || state.sending || state.activeId !== item.id) return;
    const area = findTextarea();
    if (!area || !space(area.value)) {
      state.message = "The bar is empty. Inject again.";
      render();
      return;
    }
    state.sending = true;
    render();
    const command = area.value;
    const before = snapshotJobIds();
    area.focus();
    const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    area.dispatchEvent(new KeyboardEvent("keydown", enter));
    area.dispatchEvent(new KeyboardEvent("keypress", enter));
    area.dispatchEvent(new KeyboardEvent("keyup", enter));
    confirmSend(item, command, before);
  }

  // His own Enter in the bar while a queued prompt is in it counts as Send.
  function onAreaKeydown(event) {
    if (!event.isTrusted || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const item = state.items.find((entry) => entry.id === state.activeId);
    if (!item || state.sending) return;
    const area = event.currentTarget;
    const command = area.value;
    if (!space(command)) return;
    state.sending = true;
    render();
    confirmSend(item, command, snapshotJobIds());
  }

  function onAreaInput(event) {
    if (!state.activeId) return;
    state.readback = event.currentTarget.value;
    renderActiveReadback();
  }

  function watchArea(area) {
    if (watchedArea === area) return;
    if (watchedArea) {
      watchedArea.removeEventListener("keydown", onAreaKeydown, true);
      watchedArea.removeEventListener("input", onAreaInput);
    }
    watchedArea = area;
    area.addEventListener("keydown", onAreaKeydown, true);
    area.addEventListener("input", onAreaInput);
  }

  // ── Render ──

  const STATUS_LABEL = { queued: "Queued", injected: "In the bar", sent: "Sent", skipped: "Skipped" };

  function thumb(ref, kind) {
    const box = el("span", "stg-q-thumb");
    box.title = [kind, ref.label, ref.url || ref.code].filter(Boolean).join("\n");
    const src = ref.thumbUrl || ref.url;
    if (src) {
      const img = el("img");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      box.appendChild(img);
    } else {
      box.appendChild(el("span", "stg-q-code", ref.code || "?"));
    }
    box.appendChild(el("span", "stg-q-kind", kind));
    return box;
  }

  function refsRow(item) {
    const row = el("div", "stg-q-refs");
    for (const ref of item.imagePrompts || []) row.appendChild(thumb(ref, "IMG"));
    for (const ref of item.styleRefs || []) row.appendChild(thumb(ref, "SREF"));
    if (item.omniRef) row.appendChild(thumb(item.omniRef, "OREF"));
    if (item.characterRef) row.appendChild(thumb(item.characterRef, "CREF"));
    for (const code of item.profileCodes || []) row.appendChild(el("span", "stg-q-pcode", `-p ${code}`));
    return row;
  }

  function editForm(item) {
    const form = el("div", "stg-q-edit");
    const kept = state.editDraft && state.editDraft.id === item.id ? state.editDraft.values : null;
    const field = (label, node) => {
      const wrap = el("label", "stg-q-field");
      wrap.append(el("span", "stg-q-flabel", label), node);
      form.appendChild(wrap);
      return node;
    };
    const input = (value) => {
      const node = el("input", "stg-q-input");
      node.value = value || "";
      return node;
    };
    const area = (value, rows) => {
      const node = el("textarea", "stg-q-input");
      node.rows = rows;
      node.value = value || "";
      return node;
    };
    const initial = kept || {
      title: item.title,
      prompt: item.prompt,
      images: refLines(item.imagePrompts),
      srefs: refLines(item.styleRefs),
      codes: (item.profileCodes || []).join(" "),
      params: item.params,
      note: item.note,
    };
    const title = field("Title", input(initial.title));
    const prompt = field("Prompt", area(initial.prompt, 5));
    const images = field("Image prompts · one URL a line, ::weight", area(initial.images, 2));
    const srefs = field("Style refs · URL or code a line, ::weight", area(initial.srefs, 3));
    const codes = field("Profile codes", input(initial.codes));
    const params = field("Params", input(initial.params));
    const note = field("Note", area(initial.note, 2));
    const keep = () => {
      state.editDraft = {
        id: item.id,
        values: {
          title: title.value, prompt: prompt.value, images: images.value, srefs: srefs.value,
          codes: codes.value, params: params.value, note: note.value,
        },
      };
    };
    const preview = el("div", "stg-q-cmd");
    const draft = () => ({
      ...item,
      prompt: prompt.value,
      imagePrompts: parseRefLines(images.value, item.imagePrompts),
      styleRefs: parseRefLines(srefs.value, item.styleRefs),
      profileCodes: codes.value.split(/\s+/).filter(Boolean),
      params: params.value,
    });
    const updatePreview = () => {
      preview.textContent = compose().composeMjCommand(draft()).command;
    };
    form.addEventListener("input", () => {
      keep();
      updatePreview();
    });
    updatePreview();
    form.append(el("span", "stg-q-flabel", "Command"), preview);
    const actions = el("div", "stg-q-actions");
    actions.append(
      button("Save", "stg-q-btn--primary", async () => {
        const saved = await save(item, {
          title: title.value.trim() || null,
          prompt: prompt.value,
          imagePrompts: parseRefLines(images.value, item.imagePrompts),
          styleRefs: parseRefLines(srefs.value, item.styleRefs),
          profileCodes: codes.value.split(/\s+/).filter(Boolean),
          params: params.value.trim() || null,
          note: note.value.trim() || null,
        });
        if (saved) {
          state.editingId = null;
          state.editDraft = null;
          state.message = state.activeId === item.id ? "Saved. Inject again to put the new version in the bar." : "Saved.";
        }
        render();
      }),
      button("Cancel", "", () => {
        state.editingId = null;
        state.editDraft = null;
        render();
      }),
    );
    form.appendChild(actions);
    return form;
  }

  function renderActiveReadback() {
    if (!panel) return;
    const box = panel.querySelector(".stg-q-readback");
    const item = state.items.find((entry) => entry.id === state.activeId);
    if (!box || !item) return;
    const { command } = compose().composeMjCommand(item);
    const same = compose().sameCommand(state.readback, command);
    box.textContent = "";
    box.append(
      el("span", `stg-q-rb-state ${same ? "stg-q-rb-state--ok" : "stg-q-rb-state--diff"}`, same ? "IN THE BAR · AS QUEUED" : "IN THE BAR · EDITED"),
      el("span", "stg-q-rb-text", state.readback || "(empty)"),
    );
  }

  function itemCard(item, index) {
    const active = state.activeId === item.id;
    const card = el("div", `stg-q-item stg-q-item--${item.status}${active ? " stg-q-item--active" : ""}`);
    card.dataset.itemId = item.id;
    const head = el("div", "stg-q-ihead");
    head.append(
      el("span", "stg-q-num", String(index + 1).padStart(2, "0")),
      el("span", "stg-q-title", item.title || space(item.prompt).split(" ").slice(0, 7).join(" ")),
      el("span", `stg-q-status stg-q-status--${item.status}`, STATUS_LABEL[item.status] || item.status),
    );
    card.appendChild(head);
    card.appendChild(refsRow(item));
    if (item.note) card.appendChild(el("div", "stg-q-note", item.note));
    for (const warning of item.warnings || []) card.appendChild(el("div", "stg-q-warn", warning));

    if (state.editingId === item.id) {
      card.appendChild(editForm(item));
      return card;
    }

    // In the bar, the readback shows the command; otherwise the queued one, clamped.
    if (active) {
      card.appendChild(el("div", "stg-q-readback"));
    } else {
      const cmd = el("div", "stg-q-cmd stg-q-cmd--clamp", item.command);
      cmd.title = "Click to show the whole command";
      cmd.addEventListener("click", () => cmd.classList.toggle("stg-q-cmd--clamp"));
      card.appendChild(cmd);
    }
    if (item.status === "sent") {
      const meta = [item.sentAt ? `Sent ${new Date(item.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Sent"];
      if (item.jobId) meta.push(`job ${item.jobId.slice(0, 8)}`);
      card.appendChild(el("div", "stg-q-meta", meta.join(" · ")));
    }

    const actions = el("div", "stg-q-actions");
    if (active) {
      const send = button(state.sending ? "Sending…" : "Send", "stg-q-btn--send", (event) => onSendClick(event, item), "Send this one job to Midjourney (your click)");
      send.disabled = state.sending;
      actions.appendChild(send);
    }
    if (item.status !== "skipped") {
      actions.appendChild(button(active ? "Inject again" : item.status === "sent" ? "Inject again" : "Inject", active ? "" : "stg-q-btn--primary", () => inject(item), "Put the full command in the Imagine bar"));
    }
    actions.appendChild(button("Edit", "", () => {
      state.editingId = item.id;
      state.editDraft = null;
      render();
    }));
    if (item.status === "skipped") {
      actions.appendChild(button("Restore", "", async () => {
        await save(item, { status: "queued" });
        render();
      }));
    } else if (item.status !== "sent") {
      actions.appendChild(button("Skip", "", async () => {
        if (state.activeId === item.id) state.activeId = null;
        await save(item, { status: "skipped" });
        render();
      }));
    }
    const moveUp = button("↑", "stg-q-btn--icon", async () => {
      await save(item, { position: Math.max(0, index - 1) });
      await refresh({ quiet: true });
    }, "Move up");
    moveUp.disabled = index === 0;
    actions.appendChild(moveUp);
    card.appendChild(actions);
    return card;
  }

  function openCount() {
    return state.items.filter((item) => item.status === "queued" || item.status === "injected").length;
  }

  function ago(time) {
    if (!time) return "";
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  function progressBar(batch) {
    const bar = el("span", "stg-q-pbar");
    const total = Math.max(1, batch.total || 0);
    for (const [key, value] of [["sent", batch.sent], ["injected", batch.injected], ["skipped", batch.skipped]]) {
      if (!value) continue;
      const part = el("span", `stg-q-pbar-part stg-q-pbar-part--${key}`);
      part.style.width = `${(100 * value) / total}%`;
      bar.appendChild(part);
    }
    return bar;
  }

  function renderRail() {
    const rail = el("nav", "stg-q-rail");
    rail.setAttribute("aria-label", "Threads");
    const head = el("div", "stg-q-rhead");
    head.append(
      el("span", "stg-q-rtitle", "Threads"),
      button(state.scope === "open" ? "Open" : "All", "stg-q-btn--ghost stg-q-btn--tiny", () => {
        state.scope = state.scope === "open" ? "all" : "open";
        remember({ [SCOPE_KEY]: state.scope });
        render();
      }, state.scope === "open" ? "Showing threads with prompts to send. Click to show finished ones too." : "Showing every thread. Click to show only open ones."),
    );
    rail.appendChild(head);
    const groups = threadGroups(state.batches, state.scope);
    if (!groups.length) rail.appendChild(el("div", "stg-q-rempty", state.batches.length ? "Every thread is sent." : "No threads yet."));
    for (const group of groups) {
      const section = el("div", "stg-q-rgroup");
      section.appendChild(el("div", "stg-q-rglabel", group.label));
      for (const thread of group.threads) {
        const row = el("button", `stg-q-thread${thread.batchKey === state.batchKey ? " stg-q-thread--active" : ""}${thread.done ? " stg-q-thread--done" : ""}`);
        row.type = "button";
        row.title = thread.batch;
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("click", () => selectThread(thread.batchKey));
        const top = el("span", "stg-q-trow");
        top.append(
          el("span", "stg-q-tname", capital(thread.name)),
          el("span", `stg-q-tcount${thread.left ? "" : " stg-q-tcount--done"}`, thread.left ? String(thread.left) : "✓"),
        );
        const meta = el("span", "stg-q-tmeta", `${thread.sent}/${thread.total} sent${thread.skipped ? ` · ${thread.skipped} skipped` : ""} · ${ago(thread.updatedAt)}`);
        row.append(top, progressBar(thread), meta);
        section.appendChild(row);
      }
      rail.appendChild(section);
    }
    return rail;
  }

  const FILTER_LABEL = { open: "To send", sent: "Sent", skipped: "Skipped", all: "All" };

  function render() {
    if (!root) return;
    const count = openCount();
    launcher.textContent = "";
    launcher.append(el("span", "stg-q-ltitle", "Queue"), el("span", "stg-q-lcount", String(count)));
    launcher.hidden = state.open || (count === 0 && !state.error);
    panel.hidden = !state.open;
    if (!state.open) return;

    panel.textContent = "";
    panel.classList.toggle("stg-q-panel--rail", state.railOpen);
    const top = el("div", "stg-q-top");
    top.append(
      button(state.railOpen ? "◧" : "☰", "stg-q-btn--icon", () => {
        state.railOpen = !state.railOpen;
        remember({ [RAIL_KEY]: state.railOpen });
        render();
      }, state.railOpen ? "Hide the threads" : "Show the threads"),
      el("span", "stg-q-brand", "MJ Queue"),
      el("span", "stg-q-total", count ? `${count} to send · ${threadOrder(state.batches, "open").length} threads` : "all sent"),
      button("↻", "stg-q-btn--icon", () => refresh(), "Refresh"),
      button("×", "stg-q-btn--icon", () => setOpen(false), "Close (⌥⇧Q)"),
    );
    panel.appendChild(top);

    const body = el("div", "stg-q-body");
    if (state.railOpen) body.appendChild(renderRail());
    const main = el("div", "stg-q-main");

    const batch = state.batches.find((entry) => entry.batchKey === state.batchKey);
    const items = batchItems();
    const head = el("div", "stg-q-thead");
    head.append(
      el("span", "stg-q-tworld", batch ? worldLabel(batch.worldKey) : ""),
      el("span", "stg-q-ttitle", batch ? capital(threadName(batch)) : "No thread"),
    );
    main.appendChild(head);

    const bar = el("div", "stg-q-bar");
    const counts = filterCounts(items);
    const tabs = el("div", "stg-q-tabs");
    for (const key of ["open", "sent", "skipped", "all"]) {
      const tab = button(`${FILTER_LABEL[key]} ${counts[key]}`, `stg-q-tab${state.filter === key ? " stg-q-tab--on" : ""}`, () => {
        state.filter = key;
        render();
      });
      tab.disabled = !counts[key] && key !== "open";
      tabs.appendChild(tab);
    }
    const next = button("Next →", "stg-q-btn--primary", injectNext, "Put the next prompt of this thread in the bar (⌥⇧N)");
    next.disabled = !counts.open;
    bar.append(tabs, next);
    main.appendChild(bar);

    if (state.error) main.appendChild(el("div", "stg-q-error", state.error));
    if (state.message) main.appendChild(el("div", "stg-q-message", state.message));

    const list = el("div", "stg-q-list");
    const shown = visibleItems();
    if (state.loading) list.appendChild(el("div", "stg-q-empty", "Loading the queue…"));
    else if (!state.batches.length) list.appendChild(el("div", "stg-q-empty", "No queued prompts yet. Agents add them in the gallery."));
    else if (!shown.length) list.appendChild(el("div", "stg-q-empty", state.filter === "open" ? "Everything in this thread is sent or skipped." : "Nothing here."));
    for (const item of shown) list.appendChild(itemCard(item, items.indexOf(item)));
    main.appendChild(list);
    body.appendChild(main);
    panel.appendChild(body);

    panel.appendChild(el("div", "stg-q-hint", "⌥⇧N next prompt · ⌥⇧↑↓ threads · ⌥⇧Q open/close · Send is your click or your Enter, one job each"));
    renderActiveReadback();
    const active = panel.querySelector(".stg-q-thread--active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  // Background updates (a captured job id, a quiet re-read) wait while an
  // edit form is open, so typing keeps its focus; the launcher still counts.
  function renderSoft() {
    if (state.editingId && state.open) return;
    render();
  }

  function setOpen(open) {
    state.open = open;
    try {
      chrome.storage.local.set({ [OPEN_KEY]: open });
    } catch {
      // storage unavailable after a reload
    }
    if (open) refresh({ quiet: true });
    render();
  }

  function build() {
    root = el("div", "stg-q-root");
    launcher = button("", "stg-q-launcher", () => setOpen(true), "Midjourney queue (⌥⇧Q)");
    panel = el("div", "stg-q-panel");
    panel.hidden = true;
    panel.addEventListener("keydown", (event) => event.stopPropagation());
    root.append(launcher, panel);
    document.body.appendChild(root);
  }

  function start() {
    build();
    try {
      chrome.storage.local.get([OPEN_KEY, BATCH_KEY, RAIL_KEY, SCOPE_KEY], (stored) => {
        state.open = Boolean(stored?.[OPEN_KEY]);
        state.batchKey = String(stored?.[BATCH_KEY] || "");
        state.railOpen = stored?.[RAIL_KEY] !== false;
        state.scope = stored?.[SCOPE_KEY] === "all" ? "all" : "open";
        refresh();
      });
    } catch {
      refresh();
    }
    document.addEventListener(
      "keydown",
      (event) => {
        if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
        if (event.code === "KeyN") {
          event.preventDefault();
          event.stopPropagation();
          injectNext();
        } else if (event.code === "ArrowDown" || event.code === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          stepThread(event.code === "ArrowDown" ? 1 : -1);
        } else if (event.code === "KeyQ") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(!state.open);
        }
      },
      true,
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh({ quiet: true });
    });
    // A quiet re-read: every minute while open, every three minutes closed.
    let lastRefresh = Date.now();
    setInterval(() => {
      if (document.visibilityState !== "visible" || state.editingId || state.sending) return;
      if (!state.open && Date.now() - lastRefresh < REFRESH_CLOSED_MS) return;
      lastRefresh = Date.now();
      refresh({ quiet: true });
    }, REFRESH_OPEN_MS);
    // Last in the page (the dock and packs sit right in front of it), so an
    // open queue covers them and Midjourney's grid cannot paint over it.
    new MutationObserver(() => {
      if (root && root !== document.body.lastElementChild) document.body.appendChild(root);
    }).observe(document.body, { childList: true });
  }

  start();
})(typeof globalThis !== "undefined" ? globalThis : self);
