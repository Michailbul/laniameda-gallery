// MJ Queue tab of the extension's side panel. Agents queue Midjourney prompts in
// the gallery, grouped in threads (one per direction or round, each with a
// copyable id thr-xxxxxxxx). Here Michael picks a thread and sends it:
// "Next" puts the next queued prompt in the Imagine bar of the Midjourney tab;
// Michael sends it with his own Enter in the bar. The extension never presses
// Enter for him: Midjourney flagged the scripted Enter as a bot (14 Nov 2026).
// One job per Enter, never a timer or a loop. Nothing caps his own sends; the
// counter shows the account's last hour. The Midjourney page side (mj-queue.js) does the
// bar work and reads the account's pace.
//
// Layout follows the panel's width: narrow is one column (threads, then a
// thread); wide shows the threads on the left and the open thread on the
// right, cards in a grid when there is room. Threads are grouped by world
// with collapsible headers; a world or a thread can be pinned to the top
// (chrome.storage.sync, so pins follow him across his Chromes).
(function registerMjQueuePanel(globalScope) {
  "use strict";

  const root = document.getElementById("mjqRoot");
  if (!root || typeof chrome === "undefined" || !chrome.runtime) return;

  const H = () => globalScope.SaveToGalleryMjQueue;
  const C = () => globalScope.SaveToGalleryMjQueueCompose;
  const KEYS = {
    view: "stgMjqView", batch: "stgMjqBatch", scope: "stgMjqScope",
    collapsed: "stgMjqCollapsed", lastSend: "stgMjqLastSend",
    pins: "stgMjqPins", // sync
  };
  // New prompts from agents (MCP queue_mj_prompts) show within a few seconds.
  const REFRESH_MS = 4000;
  // The account's pace is read at most this often (gentle reading).
  const RATE_MS = 30000;
  const WIDE_PX = 680;
  const CREATE_URL = "https://www.midjourney.com/imagine";
  const STATUS_LABEL = { queued: "Queued", injected: "In the bar", sent: "Sent", skipped: "Skipped" };
  const FILTER_LABEL = { open: "To send", sent: "Sent", skipped: "Skipped", all: "All" };

  const state = {
    visible: false,
    loading: true,
    error: "",
    message: "",
    batches: [],
    items: [],
    view: "threads",
    batchKey: "",
    scope: "open",
    filter: "open",
    activeId: null,
    signature: "",
    readback: "",
    sending: false,
    editingId: null,
    editDraft: null,
    tab: { id: null, onMidjourney: false, bar: false, reachable: false },
    wide: false,
    pins: { worlds: [], threads: [] },
    collapsed: {},
    lastSendAt: 0,
    rate: null,
    rateError: "",
    rateAt: 0,
    stylizing: false,
    sliding: false,
    requeuing: false,
  };

  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const capital = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, className, onClick, title) => {
    const node = el("button", `mjq-btn ${className || ""}`.trim(), label);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("click", onClick);
    return node;
  };

  const remember = (values) => {
    try {
      void chrome.storage.local.set(values);
    } catch {
      // storage unavailable
    }
  };

  function ago(time) {
    if (!time) return "";
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  // ── Gallery calls (through the background worker) ──

  function call(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: "mjQueue", ...message }, (res) => {
          const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          resolve(error ? { ok: false, error } : res || { ok: false, error: "No response." });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  async function refresh({ quiet = false } = {}) {
    const res = await call({ method: "GET", query: {} });
    state.loading = false;
    if (!res.ok) {
      if (quiet && state.items.length) return;
      state.error = res.status === 401 || /unauthorized|token/i.test(res.error || "")
        ? "Gallery token missing: set it in the Add to gallery tab, Workspace."
        : `Could not load the queue. ${String(res.error || "").slice(0, 100)}`;
      render();
      return;
    }
    const batches = Array.isArray(res.batches) ? res.batches : [];
    let items = Array.isArray(res.items) ? res.items : [];
    // The full list is capped, so a thread's own prompts are loaded on their own:
    // a thread past the cap would otherwise open empty.
    const threadKey = state.batchKey;
    if (threadKey && batches.some((batch) => batch.batchKey === threadKey)) {
      const own = await call({ method: "GET", query: { batch: threadKey } });
      if (own.ok && Array.isArray(own.items)) {
        items = items.filter((item) => item.batchKey !== threadKey).concat(own.items);
      }
    }
    // Quiet polls redraw only when something changed, so the list never flickers or jumps.
    const signature = JSON.stringify([batches, items]);
    if (quiet && !state.error && signature === state.signature) return;
    state.signature = signature;
    state.error = "";
    state.batches = batches;
    state.items = items;
    if (!state.batches.some((batch) => batch.batchKey === state.batchKey)) {
      state.batchKey = railOrder()[0] || H().threadOrder(state.batches, "all")[0] || "";
      if (state.view === "thread" && !state.batchKey) state.view = "threads";
    }
    if ((state.editingId || state.sliding || state.stylizing) && quiet) return;
    render();
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
    state.batches = H().recount(state.batches, state.items);
    state.error = "";
    return res.item || null;
  }

  // Sent prompts queued again: each comes back as a new copy at the end of the
  // thread (same words, codes and seed), so a round can be rerun at another
  // stylize. The sent original keeps its job and frames.
  async function requeue(items) {
    if (!items.length || state.requeuing) return;
    state.requeuing = true;
    state.message = `Queueing ${items.length} again…`;
    render();
    let added = 0;
    let failed = "";
    for (let at = 0; at < items.length; at += 50) {
      const res = await call({ method: "POST", body: { action: "requeue", itemIds: items.slice(at, at + 50).map((item) => item.id) } });
      if (!res.ok) { failed = String(res.error || "").slice(0, 120); break; }
      added += (res.items || []).length;
      state.items = state.items.concat(res.items || []);
    }
    state.batches = H().recount(state.batches, state.items);
    state.requeuing = false;
    state.filter = "open";
    state.message = failed
      ? `${added} queued again; the rest not saved. ${failed}`
      : `${added} queued again at the end of this thread. Set the stylize, then Next · Send.`;
    render();
    void refresh({ quiet: true });
  }

  // ── The Midjourney tab ──

  // ?mjqTab=<tab id> pins the panel to one tab (testing the panel as a page).
  const pinnedTab = Number(new URLSearchParams(location.search).get("mjqTab")) || null;

  async function readTab() {
    let tab = null;
    try {
      tab = pinnedTab ? await chrome.tabs.get(pinnedTab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    } catch {
      tab = null;
    }
    const onMidjourney = Boolean(tab && /^https?:\/\/([a-z]+\.)?midjourney\.com(\.localhost(:\d+)?)?\//.test(tab.url || ""));
    const next = { id: tab?.id ?? null, onMidjourney, bar: false, reachable: false };
    if (onMidjourney && tab?.id != null) {
      const res = await toTab({ action: "mjQueuePing" }, tab.id);
      next.reachable = Boolean(res && res.ok);
      next.bar = Boolean(res && res.bar);
      if (res && res.ok && res.activeId && res.activeId === state.activeId) state.readback = res.value;
    }
    const changed = JSON.stringify(next) !== JSON.stringify(state.tab);
    state.tab = next;
    if (next.reachable && Date.now() - state.rateAt > RATE_MS) void readRate();
    if (changed) render();
  }

  function toTab(message, tabId = state.tab.id) {
    return new Promise((resolve) => {
      if (tabId == null) {
        resolve({ ok: false, error: "No tab." });
        return;
      }
      try {
        chrome.tabs.sendMessage(tabId, message, (res) => {
          const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
          resolve(error ? { ok: false, error, unreachable: true } : res || { ok: false, error: "No answer." });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err), unreachable: true });
      }
    });
  }

  // ── Pace (Midjourney pacing rule) ──

  async function readRate(force = false) {
    if (!state.tab.reachable) return state.rate;
    state.rateAt = Date.now();
    const res = await toTab({ action: "mjQueueRate", force });
    if (res && res.ok) {
      state.rate = { lastHour: res.lastHour, inFlight: res.inFlight, newestJobAt: res.newestJobAt };
      state.rateError = "";
    } else {
      state.rateError = (res && res.error) || "Could not read the pace.";
      // A miss (the tab still loading, an old copy of the page script) tries again soon.
      state.rateAt = Date.now() - RATE_MS + 5000;
    }
    paintPace();
    return state.rate;
  }

  const gate = () => H().pacing({ rate: state.rate, lastSendAt: state.lastSendAt });

  // Repaints only the pace bits (button countdown, counter) once a second.
  let ticker = null;
  function paintPace() {
    const now = gate();
    for (const node of root.querySelectorAll("[data-pace-count]")) {
      node.textContent = state.rate ? `${state.rate.lastHour}` : state.rateError ? "?" : "…";
      node.classList.toggle("mjq-pace--hot", Boolean(state.rate && state.rate.lastHour >= H().PACING.hourNote));
      node.title = state.rateError || "Jobs on this Midjourney account in the last hour (finished and running), from its own history.";
    }
    for (const node of root.querySelectorAll("[data-next-send]")) {
      const left = Math.ceil(now.waitMs / 1000);
      const open = H().filterCounts(threadItems()).open > 0;
      node.disabled = state.sending || !open || !now.ok || !state.tab.bar;
      node.textContent = state.sending ? "Sending…" : left > 0 ? `${left}s` : "Next";
      node.classList.toggle("mjq-btn--waiting", left > 0);
      node.title = !state.tab.bar ? "Open Midjourney Create in this tab." : now.reason || "Put the next prompt in the bar; press Enter on Midjourney to send it (⌥⇧S).";
    }
    for (const node of root.querySelectorAll("[data-pace-reason]")) {
      node.textContent = now.reason || "";
      node.hidden = !now.reason;
    }
    clearTimeout(ticker);
    if (state.visible && now.waitMs > 0) ticker = setTimeout(paintPace, Math.min(1000, now.waitMs));
  }

  // ── Actions ──

  function threadItems() {
    return state.items
      .filter((item) => item.batchKey === state.batchKey)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  // Prompts opened to full length, kept across redraws.
  const expanded = new Set();
  const activeItem = () => state.items.find((item) => item.id === state.activeId) || null;

  async function inject(item, { quietRender = false } = {}) {
    await readTab();
    if (!state.tab.onMidjourney) {
      state.message = "Open Midjourney Create in this tab first.";
      render();
      return false;
    }
    const res = await toTab({ action: "mjQueueInject", item });
    if (!res.ok) {
      state.message = res.unreachable ? "Reload the Midjourney tab once so the extension can reach it." : res.error;
      render();
      return false;
    }
    state.activeId = item.id;
    state.readback = res.readback || "";
    state.sending = false;
    state.message = "";
    state.editingId = null;
    if (item.status !== "injected" && item.status !== "sent") {
      item.status = "injected";
      await save(item, { status: "injected" });
    }
    if (!quietRender) render();
    return true;
  }

  function injectNext() {
    if (!state.batchKey) return;
    const next = H().nextQueued(threadItems(), state.activeId);
    if (!next) {
      state.message = "Nothing left to send in this thread.";
      render();
      return;
    }
    void inject(next);
  }

  // After the gate: readies the bar for his Enter (the page never presses it).
  async function doSend(item) {
    state.sending = true;
    render();
    const res = await toTab({ action: "mjQueueSend", itemId: item.id });
    state.sending = false;
    if (res.ok && res.waitingForEnter) {
      // The page never presses Enter for him (Midjourney flags it as a bot).
      state.message = "In the bar. Click the bar on Midjourney and press Enter to send.";
      render();
      return false;
    }
    if (res.ok && res.sent) {
      state.lastSendAt = Date.now();
      remember({ [KEYS.lastSend]: state.lastSendAt });
      state.activeId = null;
      state.readback = "";
      const left = threadItems().filter((entry) => (entry.status === "queued" || entry.status === "injected") && entry.id !== item.id).length;
      state.message = left ? `Sent. ${left} left in this thread.` : "Sent. That was the last one in this thread.";
      item.status = "sent";
      state.batches = H().recount(state.batches, state.items);
      void refresh({ quiet: true });
      setTimeout(() => void readRate(true), 4000);
    } else {
      state.message = res.error || "Not sent.";
    }
    render();
    return Boolean(res.ok && res.sent);
  }

  // Next: the prompt in the bar if one is waiting there, else the next queued
  // one; put in the bar with the cursor at its end. Only from his own click;
  // his own Enter on Midjourney sends it.
  async function nextSend(event) {
    if (!event.isTrusted || state.sending || !state.batchKey) return;
    await readRate(true);
    const now = gate();
    if (!now.ok) {
      state.message = now.reason || `Midjourney pacing: wait ${Math.ceil(now.waitMs / 1000)} s.`;
      render();
      return;
    }
    const waiting = activeItem();
    const item = waiting && waiting.batchKey === state.batchKey && waiting.status === "injected"
      ? waiting
      : H().nextQueued(threadItems(), state.activeId);
    if (!item) {
      state.message = "Nothing left to send in this thread.";
      render();
      return;
    }
    state.sending = true;
    paintPace();
    if (state.activeId !== item.id) {
      const ok = await inject(item, { quietRender: true });
      if (!ok) { state.sending = false; render(); return; }
      // Midjourney can rewrite the bar a moment after it is filled.
      await sleep(450);
    }
    state.sending = false;
    await doSend(item);
  }

  function openThread(batchKey) {
    state.batchKey = batchKey;
    state.view = "thread";
    state.filter = "open";
    state.activeId = state.items.some((item) => item.id === state.activeId && item.batchKey === batchKey) ? state.activeId : null;
    state.editingId = null;
    state.editDraft = null;
    state.message = "";
    remember({ [KEYS.view]: "thread", [KEYS.batch]: batchKey });
    render();
    root.querySelector(".mjq-main")?.scrollTo(0, 0);
    if (!state.wide) globalScope.scrollTo(0, 0);
    // Load this thread's own prompts (the full list is capped).
    void refresh({ quiet: true });
  }

  function showThreads() {
    state.view = "threads";
    state.editingId = null;
    state.message = "";
    remember({ [KEYS.view]: "threads" });
    render();
  }

  function stepThread(delta) {
    const order = railOrder();
    if (!order.length) return;
    const at = order.indexOf(state.batchKey);
    openThread(order[(at + delta + order.length) % order.length]);
  }

  async function copyId(chip, id) {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const area = el("textarea");
      area.value = id;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    chip.textContent = "Copied";
    chip.classList.add("mjq-id--done");
    setTimeout(() => {
      chip.textContent = id;
      chip.classList.remove("mjq-id--done");
    }, 1200);
  }

  function idChip(batch) {
    const id = C().threadIdOf(batch.batchKey);
    const chip = button(id, "mjq-id", (event) => {
      event.stopPropagation();
      void copyId(chip, id);
    }, `Copy this thread's id to hand it to an agent (${batch.batch})`);
    return chip;
  }

  // ── Pins and groups ──

  const isPinnedWorld = (key) => state.pins.worlds.includes(key);
  const isPinnedThread = (key) => state.pins.threads.includes(key);

  function togglePin(kind, key) {
    const list = state.pins[kind];
    const next = list.includes(key) ? list.filter((entry) => entry !== key) : [key, ...list].slice(0, 60);
    state.pins = { ...state.pins, [kind]: next };
    try {
      void chrome.storage.sync.set({ [KEYS.pins]: state.pins });
    } catch {
      // storage unavailable
    }
    render();
  }

  // The rail: pinned threads on top, then worlds (pinned worlds first).
  function railGroups() {
    const groups = H().threadGroups(state.batches, state.scope);
    const pinned = [];
    for (const group of groups) {
      group.threads = group.threads.filter((thread) => {
        if (!isPinnedThread(thread.batchKey)) return true;
        pinned.push({ ...thread, worldLabel: group.label });
        return false;
      });
    }
    const worlds = groups
      .filter((group) => group.threads.length)
      .sort((a, b) => Number(isPinnedWorld(b.worldKey)) - Number(isPinnedWorld(a.worldKey)));
    return { pinned, worlds };
  }

  function railOrder() {
    const { pinned, worlds } = railGroups();
    return [...pinned, ...worlds.flatMap((group) => group.threads)].map((thread) => thread.batchKey);
  }

  // ── Render ──

  function progressBar(batch) {
    const bar = el("span", "mjq-pbar");
    const total = Math.max(1, batch.total || 0);
    for (const key of ["sent", "injected", "skipped"]) {
      if (!batch[key]) continue;
      const part = el("span", `mjq-pbar-${key}`);
      part.style.width = `${(100 * batch[key]) / total}%`;
      bar.appendChild(part);
    }
    return bar;
  }

  function tabStrip() {
    const strip = el("div", "mjq-tabstate");
    const dot = el("span", "mjq-dot");
    let text;
    if (!state.tab.onMidjourney) {
      dot.classList.add("mjq-dot--off");
      text = "This tab is not Midjourney";
    } else if (!state.tab.reachable) {
      dot.classList.add("mjq-dot--warn");
      text = "Midjourney · reload the tab once";
    } else if (!state.tab.bar) {
      dot.classList.add("mjq-dot--warn");
      text = "Midjourney · open Create for the bar";
    } else {
      text = "Midjourney · Create, ready";
    }
    strip.append(dot, el("span", "mjq-tabtext", text));
    if (!state.tab.onMidjourney) {
      strip.appendChild(button("Open Create", "mjq-btn--small", async () => {
        if (state.tab.id != null) await chrome.tabs.update(state.tab.id, { url: CREATE_URL });
        else await chrome.tabs.create({ url: CREATE_URL });
      }));
    } else if (!state.tab.reachable) {
      strip.appendChild(button("Reload", "mjq-btn--small", async () => {
        if (state.tab.id != null) await chrome.tabs.reload(state.tab.id);
        setTimeout(readTab, 2500);
      }));
    }
    const pace = el("span", "mjq-pace");
    const paceCount = el("b", "mjq-pace-count");
    paceCount.dataset.paceCount = "1";
    pace.append(el("span", "mjq-pace-label", "last hour"), paceCount);
    strip.appendChild(pace);
    const left = state.items.filter((item) => item.status === "queued" || item.status === "injected").length;
    strip.appendChild(el("span", "mjq-total", `${left} to send`));
    strip.appendChild(button("↻", "mjq-btn--icon", () => { void refresh(); void readRate(true); }, "Refresh"));
    return strip;
  }

  function pinButton(kind, key, label) {
    const on = kind === "worlds" ? isPinnedWorld(key) : isPinnedThread(key);
    const pin = button(on ? "Pinned" : "Pin", `mjq-pin${on ? " mjq-pin--on" : ""}`, (event) => {
      event.stopPropagation();
      togglePin(kind, key);
    }, on ? `Unpin ${label}` : `Pin ${label} to the top (follows you across your Chromes)`);
    return pin;
  }

  function threadRow(thread, worldLabel) {
    const selected = thread.batchKey === state.batchKey && (state.wide || state.view === "thread");
    const row = el("div", `mjq-thread${thread.done ? " mjq-thread--done" : ""}${selected ? " mjq-thread--on" : ""}`);
    row.tabIndex = 0;
    row.addEventListener("click", () => openThread(thread.batchKey));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openThread(thread.batchKey);
    });
    const top = el("div", "mjq-row");
    top.append(
      el("span", "mjq-tname", capital(thread.name)),
      pinButton("threads", thread.batchKey, "this thread"),
      el("span", `mjq-count${thread.left ? "" : " mjq-count--done"}`, thread.left ? String(thread.left) : "✓"),
    );
    const meta = el("div", "mjq-row mjq-tmeta");
    if (worldLabel) meta.appendChild(el("span", "mjq-wtag", worldLabel));
    meta.append(
      idChip(thread),
      el("span", "mjq-mono", `${thread.sent}/${thread.total} sent${thread.skipped ? ` · ${thread.skipped} skipped` : ""} · ${ago(thread.updatedAt)}`),
    );
    row.append(top, progressBar(thread), meta);
    return row;
  }

  function groupHead(key, label, counts, { pinKind = null, collapsible = true } = {}) {
    const collapsed = collapsible && Boolean(state.collapsed[key]);
    const head = el("div", `mjq-ghead${collapsed ? " mjq-ghead--closed" : ""}`);
    const toggle = el("button", "mjq-gtoggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.append(el("span", "mjq-caret", collapsible ? (collapsed ? "▸" : "▾") : "◆"), el("span", "mjq-glabel", label), el("span", "mjq-gcount", counts));
    if (collapsible) {
      toggle.addEventListener("click", () => {
        state.collapsed = { ...state.collapsed, [key]: !collapsed };
        remember({ [KEYS.collapsed]: state.collapsed });
        render();
      });
    }
    head.appendChild(toggle);
    if (pinKind) head.appendChild(pinButton(pinKind, key, label));
    return { head, collapsed };
  }

  function renderRail(box) {
    const head = el("div", "mjq-row mjq-head");
    head.append(
      el("span", "mjq-label", "Threads"),
      button(state.scope === "open" ? "Open" : "All", "mjq-btn--ghost", () => {
        state.scope = state.scope === "open" ? "all" : "open";
        remember({ [KEYS.scope]: state.scope });
        render();
      }, state.scope === "open" ? "Showing threads with prompts to send. Click to show finished ones." : "Showing every thread. Click for open ones only."),
    );
    box.appendChild(head);
    const { pinned, worlds } = railGroups();
    if (state.loading) box.appendChild(el("p", "mjq-empty", "Loading the queue…"));
    else if (!pinned.length && !worlds.length) box.appendChild(el("p", "mjq-empty", state.batches.length ? "Every thread is sent." : "No threads yet. Agents add them in the gallery."));
    if (pinned.length) {
      const left = pinned.reduce((sum, thread) => sum + thread.left, 0);
      const { head: ph, collapsed } = groupHead("__pinned", "Pinned", `${pinned.length} · ${left} to send`);
      ph.classList.add("mjq-ghead--pinned");
      box.appendChild(ph);
      if (!collapsed) for (const thread of pinned) box.appendChild(threadRow(thread, thread.worldLabel));
    }
    for (const group of worlds) {
      const counts = `${group.threads.length} thread${group.threads.length === 1 ? "" : "s"} · ${group.left} to send`;
      const { head: gh, collapsed } = groupHead(group.worldKey || "__other", group.label, counts, { pinKind: "worlds" });
      if (isPinnedWorld(group.worldKey)) gh.classList.add("mjq-ghead--pinned");
      box.appendChild(gh);
      if (!collapsed) for (const thread of group.threads) box.appendChild(threadRow(thread));
    }
  }

  function thumb(ref, kind) {
    const box = el("span", "mjq-thumb");
    box.title = [kind, ref.label, ref.url || ref.code].filter(Boolean).join("\n");
    const src = ref.thumbUrl || ref.url;
    if (src) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      box.appendChild(img);
    } else {
      box.appendChild(el("span", "mjq-mono", ref.code || "?"));
    }
    box.appendChild(el("span", "mjq-kind", kind));
    return box;
  }

  function refsRow(item) {
    const row = el("div", "mjq-refs");
    for (const ref of item.imagePrompts || []) row.appendChild(thumb(ref, "IMG"));
    for (const ref of item.styleRefs || []) row.appendChild(thumb(ref, "SREF"));
    if (item.omniRef) row.appendChild(thumb(item.omniRef, "OREF"));
    if (item.characterRef) row.appendChild(thumb(item.characterRef, "CREF"));
    for (const ref of item.editRefs || []) row.appendChild(thumb(ref, "FRAME"));
    if (item.describe?.sourceUrl) row.appendChild(thumb({ url: item.describe.sourceUrl, label: "Described from" }, "SOURCE"));
    for (const code of item.profileCodes || []) row.appendChild(el("span", "mjq-pcode", `-p ${code}`));
    return row.childNodes.length ? row : null;
  }

  function editForm(item) {
    const form = el("div", "mjq-edit");
    const kept = state.editDraft && state.editDraft.id === item.id ? state.editDraft.values : null;
    const initial = kept || {
      title: item.title,
      prompt: item.prompt,
      images: H().refLines(item.imagePrompts),
      srefs: H().refLines(item.styleRefs),
      codes: (item.profileCodes || []).join(" "),
      params: item.params,
      note: item.note,
    };
    const field = (label, node) => {
      const wrap = el("label", "mjq-field");
      wrap.append(el("span", "mjq-label", label), node);
      form.appendChild(wrap);
      return node;
    };
    const input = (value) => Object.assign(el("input", "mjq-input"), { value: value || "" });
    const area = (value, rows) => Object.assign(el("textarea", "mjq-input"), { value: value || "", rows });
    const title = field("Title", input(initial.title));
    const prompt = field("Prompt", area(initial.prompt, 7));
    const images = field("Image prompts · one URL a line, ::weight", area(initial.images, 2));
    const srefs = field("Style refs · URL or code a line, ::weight", area(initial.srefs, 3));
    const codes = field("Profile codes", input(initial.codes));
    const params = field("Params", input(initial.params));
    const note = field("Note", area(initial.note, 2));
    const values = () => ({
      title: title.value, prompt: prompt.value, images: images.value, srefs: srefs.value,
      codes: codes.value, params: params.value, note: note.value,
    });
    const draft = () => ({
      ...item,
      prompt: prompt.value,
      imagePrompts: H().parseRefLines(images.value, item.imagePrompts),
      styleRefs: H().parseRefLines(srefs.value, item.styleRefs),
      profileCodes: codes.value.split(/\s+/).filter(Boolean),
      params: params.value,
    });
    const preview = el("div", "mjq-cmd");
    const update = () => {
      preview.textContent = C().composeMjCommand(draft()).command;
    };
    form.addEventListener("input", () => {
      state.editDraft = { id: item.id, values: values() };
      update();
    });
    update();
    form.append(el("span", "mjq-label", "Command"), preview);
    const actions = el("div", "mjq-actions");
    actions.append(
      button("Save", "mjq-btn--primary", async () => {
        const saved = await save(item, {
          title: title.value.trim() || null,
          prompt: prompt.value,
          imagePrompts: H().parseRefLines(images.value, item.imagePrompts),
          styleRefs: H().parseRefLines(srefs.value, item.styleRefs),
          profileCodes: codes.value.split(/\s+/).filter(Boolean),
          params: params.value.trim() || null,
          note: note.value.trim() || null,
        });
        if (saved) {
          state.editingId = null;
          state.editDraft = null;
          state.message = state.activeId === item.id ? "Saved. Put it in the bar again for the new version." : "Saved.";
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

  function readbackBox(item) {
    const box = el("div", "mjq-readback");
    const { command } = C().composeMjCommand(item);
    const same = C().sameCommand(state.readback, command);
    box.append(
      el("span", `mjq-rb ${same ? "mjq-rb--ok" : "mjq-rb--diff"}`, same ? "IN THE BAR · AS QUEUED" : "IN THE BAR · EDITED"),
      el("div", "mjq-rbtext", state.readback || "(empty)"),
    );
    return box;
  }

  function itemCard(item, index) {
    const active = state.activeId === item.id;
    const card = el("article", `mjq-item mjq-item--${item.status}${active ? " mjq-item--active" : ""}`);
    const head = el("div", "mjq-row mjq-ihead");
    head.append(
      el("span", "mjq-num", String(index + 1).padStart(2, "0")),
      el("span", "mjq-title", item.title || space(item.prompt).split(" ").slice(0, 7).join(" ")),
      el("span", `mjq-status mjq-status--${item.status}`, STATUS_LABEL[item.status] || item.status),
    );
    if (item.requeuedFrom) {
      const again = el("span", "mjq-again", "Again");
      again.title = "Queued again from a sent prompt";
      head.insertBefore(again, head.lastChild);
    }
    card.appendChild(head);
    // A restyle of a locked location prompt: which place, in which style, how.
    if (item.lockedPromptId) {
      const tags = el("div", "mjq-locked");
      tags.append(el("span", "", item.placeLabel || "Locked location"));
      if (item.runId) {
        if (item.presetLabel) tags.append(el("span", "", item.presetLabel));
        tags.append(el("span", "", `${item.variantLabel || item.variantKey || "wording"} · seed ${item.seed}`));
        if (item.screen) tags.append(el("span", "", "Screening"));
      } else {
        if (item.styleLabel) tags.append(el("span", "", `in ${item.styleLabel}`));
        tags.append(el("span", "", item.restyleMode === "frame" ? "Same layout · locked frame" : "Same prompt + seed"));
      }
      card.appendChild(tags);
    }
    const refs = refsRow(item);
    if (refs) card.appendChild(refs);
    for (const warning of item.warnings || []) card.appendChild(el("p", "mjq-warn", warning));
    if (state.editingId === item.id) {
      card.appendChild(editForm(item));
      return card;
    }
    if (active) card.appendChild(readbackBox(item));
    else {
      // Two lines; a click opens the whole prompt (he reads it in Midjourney anyway).
      const cmd = el("div", `mjq-cmd${expanded.has(item.id) ? "" : " mjq-cmd--clamp"}`);
      cmd.appendChild(el("span", "mjq-cmd-text", item.command));
      cmd.title = expanded.has(item.id) ? "Click to fold" : "Click to show the whole prompt";
      cmd.addEventListener("click", () => {
        if (getSelection()?.toString()) return;
        if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id);
        cmd.classList.toggle("mjq-cmd--clamp", !expanded.has(item.id));
        cmd.title = expanded.has(item.id) ? "Click to fold" : "Click to show the whole prompt";
      });
      card.appendChild(cmd);
    }
    if (item.status === "sent") {
      const meta = [item.sentAt ? `Sent ${new Date(item.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Sent"];
      if (item.jobId) meta.push(`job ${item.jobId.slice(0, 8)}`);
      card.appendChild(el("p", "mjq-mono mjq-meta", meta.join(" · ")));
    }
    const actions = el("div", "mjq-actions");
    if (active) {
      const now = gate();
      actions.appendChild(el("span", "mjq-mono mjq-meta", state.sending ? "Sending…" : now.ok ? "In the bar · press Enter on Midjourney" : now.reason || "In the bar"));
    }
    if (item.status !== "skipped") {
      actions.appendChild(button(active || item.status === "sent" ? "Again" : "Put in bar", "", () => inject(item), "Put the full command in the Imagine bar, to edit it there first"));
    }
    actions.appendChild(button("Edit", "", () => {
      state.editingId = item.id;
      state.editDraft = null;
      render();
    }));
    if (item.status === "sent") {
      const again = button("Queue again", "", () => requeue([item]), "Queue a copy of this prompt at the end of the thread, to send it again (e.g. at another stylize). This one stays sent.");
      again.disabled = state.requeuing;
      actions.appendChild(again);
    }
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
    const up = button("↑", "mjq-btn--icon", async () => {
      await save(item, { position: Math.max(0, index - 1) });
      await refresh({ quiet: true });
    }, "Move up");
    up.disabled = index === 0;
    actions.appendChild(up);
    card.appendChild(actions);
    return card;
  }

  // One stylize for the whole thread: drag, let go, and every prompt still to
  // send (queued or left in the bar) gets that --stylize. Sent prompts keep
  // what they went out with; "Queue again" brings them back to rerun.
  function stylizeBar(items) {
    const info = H().threadStylize(items);
    const bar = el("div", "mjq-stylize");
    const label = el("span", "mjq-stylize-label", "Stylize");
    const start = info.value == null ? 100 : info.value;
    const slider = el("input", "mjq-stylize-range");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.step = "25";
    slider.value = String(start);
    slider.disabled = !info.count || state.stylizing;
    slider.setAttribute("aria-label", "Stylize for every prompt in this thread");
    const readout = el("b", "mjq-stylize-value", info.value == null ? "—" : String(start));
    const meta = el("span", "mjq-stylize-meta", !info.count
      ? "nothing left to send"
      : `${info.mixed ? "mixed · " : ""}${info.count} to send`);
    slider.addEventListener("pointerdown", () => { state.sliding = true; });
    slider.addEventListener("input", () => { readout.textContent = slider.value; });
    slider.addEventListener("change", () => {
      state.sliding = false;
      void applyStylize(Number(slider.value));
    });
    // A click that changes nothing must not leave the panel frozen (render waits while sliding).
    const release = () => {
      if (!state.sliding) return;
      state.sliding = false;
      if (Number(slider.value) === start) render();
    };
    slider.addEventListener("pointerup", () => setTimeout(release, 0));
    slider.addEventListener("pointercancel", release);
    slider.addEventListener("blur", release);
    bar.append(label, slider, readout, meta);
    return bar;
  }

  async function applyStylize(value) {
    const { items } = H().threadStylize(threadItems());
    const todo = items.filter((item) => H().stylizeOf(item.params) !== value || /--s\s/.test(item.params || ""));
    if (!todo.length) {
      state.message = `Every prompt to send is already at stylize ${value}.`;
      render();
      return;
    }
    state.stylizing = true;
    state.message = `Setting stylize ${value} on ${todo.length} prompts…`;
    render();
    let done = 0;
    let failed = 0;
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        const saved = await save(item, { params: H().withStylize(item.params, value) });
        if (saved) done += 1;
        else failed += 1;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    state.stylizing = false;
    state.message = failed
      ? `Stylize ${value} on ${done} prompts; ${failed} not saved, try again.`
      : `Stylize ${value} on ${done} prompts.`;
    render();
  }

  function renderThread(box) {
    const batch = state.batches.find((entry) => entry.batchKey === state.batchKey);
    if (!batch) {
      if (state.wide) box.appendChild(el("p", "mjq-empty", state.loading ? "Loading…" : "Pick a thread on the left."));
      else showThreads();
      return;
    }
    const items = threadItems();
    const nav = el("div", "mjq-row mjq-nav");
    if (!state.wide) nav.appendChild(button("← Threads", "mjq-btn--ghost", showThreads, "All threads (Esc)"));
    nav.append(
      el("span", "mjq-label mjq-grow", H().threadGroups([batch], "all")[0]?.label || ""),
      idChip(batch),
      button("‹", "mjq-btn--icon", () => stepThread(-1), "Previous thread (⌥⇧↑)"),
      button("›", "mjq-btn--icon", () => stepThread(1), "Next thread (⌥⇧↓)"),
    );
    box.appendChild(nav);
    box.appendChild(el("h2", "mjq-ttitle", capital(H().threadName(batch))));
    const counts = H().filterCounts(items);

    // The send bar: one click puts the next prompt in the bar; his Enter sends it.
    const sendBar = el("div", "mjq-sendbar");
    const next = button("Next", "mjq-btn--next", nextSend);
    next.dataset.nextSend = "1";
    const pace = el("div", "mjq-pacebox");
    const count = el("b", "mjq-pace-count");
    count.dataset.paceCount = "1";
    pace.append(count, el("span", "mjq-pace-label", "jobs in the last hour"));
    sendBar.append(next, pace);
    box.appendChild(sendBar);
    box.appendChild(stylizeBar(items));
    const reason = el("p", "mjq-pace-reason");
    reason.dataset.paceReason = "1";
    reason.hidden = true;
    box.appendChild(reason);

    const tabs = el("div", "mjq-tabs");
    for (const key of ["open", "sent", "skipped", "all"]) {
      const tab = button(`${FILTER_LABEL[key]} ${counts[key]}`, `mjq-tab${state.filter === key ? " mjq-tab--on" : ""}`, () => {
        state.filter = key;
        render();
      });
      tab.disabled = !counts[key] && key !== "open";
      tabs.appendChild(tab);
    }
    box.appendChild(tabs);
    if (state.filter === "sent" && counts.sent) {
      const sentItems = items.filter((item) => item.status === "sent");
      const bulk = el("div", "mjq-requeue");
      const all = button(state.requeuing ? "Queueing…" : `Queue all ${sentItems.length} again`, "mjq-btn--primary", () => requeue(sentItems),
        "Copy every sent prompt of this thread back into the queue, to send the round again (e.g. at another stylize). The sent ones stay as they are.");
      all.disabled = state.requeuing;
      bulk.append(all, el("span", "mjq-requeue-meta", "Same words, codes and seeds. Then set the stylize."));
      box.appendChild(bulk);
    }
    if (state.message) box.appendChild(el("p", "mjq-message", state.message));
    const list = el("div", "mjq-list");
    const shown = H().filterItems(items, state.filter, state.activeId);
    if (!shown.length) list.appendChild(el("p", "mjq-empty", state.filter === "open" ? "Everything in this thread is sent or skipped." : "Nothing here."));
    for (const item of shown) list.appendChild(itemCard(item, items.indexOf(item)));
    box.appendChild(list);
  }

  function render() {
    if (!state.visible || state.sliding) return;
    const focused = document.activeElement && root.contains(document.activeElement) && document.activeElement.matches("input, textarea");
    if (focused && state.editingId) return;
    const railScroll = root.querySelector(".mjq-rail")?.scrollTop || 0;
    const mainScroll = root.querySelector(".mjq-main")?.scrollTop || 0;
    root.textContent = "";
    root.classList.toggle("mjq--wide", state.wide);
    root.appendChild(tabStrip());
    if (state.error) root.appendChild(el("p", "mjq-error", state.error));
    if (state.wide) {
      const split = el("div", "mjq-split");
      const rail = el("div", "mjq-rail");
      const main = el("div", "mjq-main");
      renderRail(rail);
      renderThread(main);
      split.append(rail, main);
      root.appendChild(split);
      rail.scrollTop = railScroll;
      main.scrollTop = mainScroll;
    } else {
      const box = el("div", "mjq-body");
      if (state.view === "thread" && state.batchKey) renderThread(box);
      else renderRail(box);
      root.appendChild(box);
    }
    root.appendChild(el("p", "mjq-hint", "Next puts the next prompt in the bar; press Enter on Midjourney to send it · ⌥⇧N on the Midjourney page: next in bar, then Enter · ⌥⇧↑↓ threads"));
    paintPace();
  }

  // ── Wiring ──

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !state.visible) return false;
    if (message.action === "mjQueueBar" && message.itemId === state.activeId) {
      state.readback = message.value || "";
      const box = root.querySelector(".mjq-item--active .mjq-readback");
      if (box) {
        const item = state.items.find((entry) => entry.id === state.activeId);
        if (item) box.replaceWith(readbackBox(item));
      }
    } else if (message.action === "mjQueueChanged") {
      if (message.itemId === state.activeId) {
        const item = state.items.find((entry) => entry.id === state.activeId);
        if (item && item.status === "injected") {
          // A send he made with his own Enter in the bar.
          state.activeId = null;
          state.lastSendAt = Date.now();
          remember({ [KEYS.lastSend]: state.lastSendAt });
          state.message = "Sent. The next one is ready when you are.";
        }
      }
      void refresh({ quiet: true });
    } else if (message.action === "mjQueueSending" && message.itemId === state.activeId) {
      state.sending = true;
      render();
    } else if (message.action === "mjQueueNotSent" && message.itemId === state.activeId) {
      state.sending = false;
      state.message = message.error || "Not sent.";
      render();
    } else if (message.action === "mjQueueNext") {
      injectNext();
    }
    return false;
  });

  document.addEventListener("keydown", (event) => {
    if (!state.visible) return;
    if (event.key === "Escape" && state.view === "thread" && !state.editingId && !state.wide) {
      showThreads();
      return;
    }
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (event.code === "KeyN") {
      event.preventDefault();
      injectNext();
    } else if (event.code === "KeyS") {
      event.preventDefault();
      void nextSend(event);
    } else if (event.code === "ArrowDown" || event.code === "ArrowUp") {
      event.preventDefault();
      stepThread(event.code === "ArrowDown" ? 1 : -1);
    }
  });

  chrome.tabs.onActivated.addListener(() => void readTab());
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tab.id && (info.status === "complete" || info.url)) void readTab();
  });

  // Pins follow him across his Chromes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[KEYS.pins]) {
      state.pins = normalizePins(changes[KEYS.pins].newValue);
      render();
    }
  });

  // The layout follows the panel's width.
  new ResizeObserver(() => {
    const wide = root.clientWidth >= WIDE_PX;
    if (wide === state.wide) return;
    state.wide = wide;
    render();
  }).observe(root);

  // Coming back to the window or the panel reads the queue at once.
  const refreshNow = () => {
    if (state.visible && document.visibilityState === "visible" && !state.editingId && !state.sending) void refresh({ quiet: true });
  };
  document.addEventListener("visibilitychange", refreshNow);
  globalScope.addEventListener("focus", refreshNow);

  let timer = null;
  // The side panel calls this when the MJ Queue tab is shown or hidden.
  function setVisible(visible) {
    state.visible = visible;
    root.hidden = !visible;
    clearInterval(timer);
    if (!visible) return;
    state.wide = root.clientWidth >= WIDE_PX;
    render();
    void readTab();
    void refresh({ quiet: !state.loading });
    timer = setInterval(() => {
      if (document.visibilityState === "visible" && !state.editingId && !state.sending) {
        void refresh({ quiet: true });
        void readTab();
      }
    }, REFRESH_MS);
  }

  function normalizePins(value) {
    const list = (entry) => (Array.isArray(entry) ? entry.filter((key) => typeof key === "string").slice(0, 60) : []);
    return { worlds: list(value?.worlds), threads: list(value?.threads) };
  }

  chrome.storage.local.get([KEYS.view, KEYS.batch, KEYS.scope, KEYS.collapsed, KEYS.lastSend], (stored) => {
    state.view = stored?.[KEYS.view] === "thread" ? "thread" : "threads";
    state.batchKey = String(stored?.[KEYS.batch] || "");
    state.scope = stored?.[KEYS.scope] === "all" ? "all" : "open";
    state.collapsed = stored?.[KEYS.collapsed] && typeof stored[KEYS.collapsed] === "object" ? stored[KEYS.collapsed] : {};
    state.lastSendAt = Number(stored?.[KEYS.lastSend]) || 0;
    if (state.visible) render();
  });
  chrome.storage.sync.get([KEYS.pins], (stored) => {
    state.pins = normalizePins(stored?.[KEYS.pins]);
    if (state.visible) render();
  });

  globalScope.SaveToGalleryMjQueuePanel = { setVisible };
})(typeof globalThis !== "undefined" ? globalThis : self);
