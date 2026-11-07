// MJ Queue tab of the extension's side panel. Agents queue Midjourney prompts in
// the gallery, grouped in threads (one per direction or round, each with a
// copyable id thr-xxxxxxxx). Here Michael picks a thread, puts a prompt in the
// Imagine bar of the Midjourney tab, edits it if he wants and clicks Send: one
// job per click. The Midjourney page side (mj-queue.js) does the bar work.
// Nothing is ever submitted by a timer or a loop.
(function registerMjQueuePanel(globalScope) {
  "use strict";

  const root = document.getElementById("mjqRoot");
  if (!root || typeof chrome === "undefined" || !chrome.runtime) return;

  const H = () => globalScope.SaveToGalleryMjQueue;
  const C = () => globalScope.SaveToGalleryMjQueueCompose;
  const KEYS = { view: "stgMjqView", batch: "stgMjqBatch", scope: "stgMjqScope" };
  const REFRESH_MS = 60000;
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
    readback: "",
    sending: false,
    editingId: null,
    editDraft: null,
    tab: { id: null, onMidjourney: false, bar: false, reachable: false },
  };

  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const capital = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

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
    state.error = "";
    state.batches = Array.isArray(res.batches) ? res.batches : [];
    state.items = Array.isArray(res.items) ? res.items : [];
    if (!state.batches.some((batch) => batch.batchKey === state.batchKey)) {
      state.batchKey = H().threadOrder(state.batches, "open")[0] || H().threadOrder(state.batches, "all")[0] || "";
      if (state.view === "thread" && !state.batchKey) state.view = "threads";
    }
    if (state.editingId && quiet) return;
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

  // ── Actions ──

  function threadItems() {
    return state.items
      .filter((item) => item.batchKey === state.batchKey)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async function inject(item) {
    await readTab();
    if (!state.tab.onMidjourney) {
      state.message = "Open Midjourney Create in this tab first.";
      render();
      return;
    }
    const res = await toTab({ action: "mjQueueInject", item });
    if (!res.ok) {
      state.message = res.unreachable ? "Reload the Midjourney tab once so the extension can reach it." : res.error;
      render();
      return;
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
    render();
  }

  function injectNext() {
    if (state.view !== "thread") return;
    const next = H().nextQueued(threadItems(), state.activeId);
    if (!next) {
      state.message = "Nothing left to send in this thread.";
      render();
      return;
    }
    void inject(next);
  }

  // Send: only from his own click. The Midjourney page presses Enter once.
  async function send(event, item) {
    if (!event.isTrusted || state.sending || state.activeId !== item.id) return;
    state.sending = true;
    render();
    const res = await toTab({ action: "mjQueueSend", itemId: item.id });
    state.sending = false;
    if (res.ok && res.sent) {
      state.activeId = null;
      state.readback = "";
      state.message = "Sent. The next one is ready when you are.";
      item.status = "sent";
      state.batches = H().recount(state.batches, state.items);
      void refresh({ quiet: true });
    } else {
      state.message = res.error || "Not sent.";
    }
    render();
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
    root.querySelector(".mjq-list")?.scrollTo(0, 0);
  }

  function showThreads() {
    state.view = "threads";
    state.editingId = null;
    state.message = "";
    remember({ [KEYS.view]: "threads" });
    render();
  }

  function stepThread(delta) {
    const order = H().threadOrder(state.batches, state.scope);
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
    const left = state.items.filter((item) => item.status === "queued" || item.status === "injected").length;
    strip.appendChild(el("span", "mjq-total", `${left} to send`));
    strip.appendChild(button("↻", "mjq-btn--icon", () => refresh(), "Refresh"));
    return strip;
  }

  function renderThreads(box) {
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
    const groups = H().threadGroups(state.batches, state.scope);
    if (state.loading) box.appendChild(el("p", "mjq-empty", "Loading the queue…"));
    else if (!groups.length) box.appendChild(el("p", "mjq-empty", state.batches.length ? "Every thread is sent." : "No threads yet. Agents add them in the gallery."));
    for (const group of groups) {
      box.appendChild(el("p", "mjq-group", group.label));
      for (const thread of group.threads) {
        const row = el("div", `mjq-thread${thread.done ? " mjq-thread--done" : ""}${thread.batchKey === state.batchKey ? " mjq-thread--last" : ""}`);
        row.tabIndex = 0;
        row.addEventListener("click", () => openThread(thread.batchKey));
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter") openThread(thread.batchKey);
        });
        const top = el("div", "mjq-row");
        top.append(
          el("span", "mjq-tname", capital(thread.name)),
          el("span", `mjq-count${thread.left ? "" : " mjq-count--done"}`, thread.left ? String(thread.left) : "✓"),
        );
        const meta = el("div", "mjq-row mjq-tmeta");
        meta.append(
          idChip(thread),
          el("span", "mjq-mono", `${thread.sent}/${thread.total} sent${thread.skipped ? ` · ${thread.skipped} skipped` : ""} · ${ago(thread.updatedAt)}`),
        );
        row.append(top, progressBar(thread), meta);
        box.appendChild(row);
      }
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
    const prompt = field("Prompt", area(initial.prompt, 6));
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
    const head = el("div", "mjq-row");
    head.append(
      el("span", "mjq-num", String(index + 1).padStart(2, "0")),
      el("span", "mjq-title", item.title || space(item.prompt).split(" ").slice(0, 7).join(" ")),
      el("span", `mjq-status mjq-status--${item.status}`, STATUS_LABEL[item.status] || item.status),
    );
    card.appendChild(head);
    const refs = refsRow(item);
    if (refs) card.appendChild(refs);
    if (item.note) card.appendChild(el("p", "mjq-note", item.note));
    for (const warning of item.warnings || []) card.appendChild(el("p", "mjq-warn", warning));
    if (state.editingId === item.id) {
      card.appendChild(editForm(item));
      return card;
    }
    if (active) {
      card.appendChild(readbackBox(item));
    } else {
      const cmd = el("div", "mjq-cmd mjq-cmd--clamp", item.command);
      cmd.title = "Click to show the whole command";
      cmd.addEventListener("click", () => cmd.classList.toggle("mjq-cmd--clamp"));
      card.appendChild(cmd);
    }
    if (item.status === "sent") {
      const meta = [item.sentAt ? `Sent ${new Date(item.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Sent"];
      if (item.jobId) meta.push(`job ${item.jobId.slice(0, 8)}`);
      card.appendChild(el("p", "mjq-mono mjq-meta", meta.join(" · ")));
    }
    const actions = el("div", "mjq-actions");
    if (active) {
      const sendBtn = button(state.sending ? "Sending…" : "Send", "mjq-btn--send", (event) => send(event, item), "Send this one job to Midjourney (your click)");
      sendBtn.disabled = state.sending || !state.tab.bar;
      actions.appendChild(sendBtn);
    }
    if (item.status !== "skipped") {
      actions.appendChild(button(active || item.status === "sent" ? "Again" : "Put in bar", active ? "" : "mjq-btn--primary", () => inject(item), "Put the full command in the Imagine bar"));
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
    const up = button("↑", "mjq-btn--icon", async () => {
      await save(item, { position: Math.max(0, index - 1) });
      await refresh({ quiet: true });
    }, "Move up");
    up.disabled = index === 0;
    actions.appendChild(up);
    card.appendChild(actions);
    return card;
  }

  function renderThread(box) {
    const batch = state.batches.find((entry) => entry.batchKey === state.batchKey);
    if (!batch) {
      showThreads();
      return;
    }
    const items = threadItems();
    const nav = el("div", "mjq-row mjq-nav");
    nav.append(
      button("← Threads", "mjq-btn--ghost", showThreads, "All threads (Esc)"),
      el("span", "mjq-label mjq-grow", H().threadGroups([batch], "all")[0]?.label || ""),
      idChip(batch),
      button("‹", "mjq-btn--icon", () => stepThread(-1), "Previous thread (⌥⇧↑)"),
      button("›", "mjq-btn--icon", () => stepThread(1), "Next thread (⌥⇧↓)"),
    );
    box.appendChild(nav);
    box.appendChild(el("h2", "mjq-ttitle", capital(H().threadName(batch))));
    const bar = el("div", "mjq-row mjq-bar");
    const counts = H().filterCounts(items);
    const tabs = el("div", "mjq-tabs");
    for (const key of ["open", "sent", "skipped", "all"]) {
      const tab = button(`${FILTER_LABEL[key]} ${counts[key]}`, `mjq-tab${state.filter === key ? " mjq-tab--on" : ""}`, () => {
        state.filter = key;
        render();
      });
      tab.disabled = !counts[key] && key !== "open";
      tabs.appendChild(tab);
    }
    const next = button("Next →", "mjq-btn--primary", injectNext, "Put the next prompt in the bar (⌥⇧N)");
    next.disabled = !counts.open;
    bar.append(tabs, next);
    box.appendChild(bar);
    if (state.message) box.appendChild(el("p", "mjq-message", state.message));
    const list = el("div", "mjq-list");
    const shown = H().filterItems(items, state.filter, state.activeId);
    if (!shown.length) list.appendChild(el("p", "mjq-empty", state.filter === "open" ? "Everything in this thread is sent or skipped." : "Nothing here."));
    for (const item of shown) list.appendChild(itemCard(item, items.indexOf(item)));
    box.appendChild(list);
  }

  function render() {
    if (!state.visible) return;
    const focused = document.activeElement && root.contains(document.activeElement) && document.activeElement.matches("input, textarea");
    if (focused && state.editingId) return;
    root.textContent = "";
    root.appendChild(tabStrip());
    if (state.error) root.appendChild(el("p", "mjq-error", state.error));
    const box = el("div", "mjq-body");
    if (state.view === "thread" && state.batchKey) renderThread(box);
    else renderThreads(box);
    root.appendChild(box);
    root.appendChild(el("p", "mjq-hint", "⌥⇧N next prompt · ⌥⇧↑↓ threads · Esc threads · Send is your click or your Enter in the bar, one job each"));
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
          state.message = "Sent. The next one is ready when you are.";
        }
      }
      void refresh({ quiet: true });
    } else if (message.action === "mjQueueSending" && message.itemId === state.activeId) {
      state.sending = true;
      render();
    } else if (message.action === "mjQueueNext") {
      injectNext();
    }
    return false;
  });

  document.addEventListener("keydown", (event) => {
    if (!state.visible) return;
    if (event.key === "Escape" && state.view === "thread" && !state.editingId) {
      showThreads();
      return;
    }
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (event.code === "KeyN") {
      event.preventDefault();
      injectNext();
    } else if (event.code === "ArrowDown" || event.code === "ArrowUp") {
      event.preventDefault();
      stepThread(event.code === "ArrowDown" ? 1 : -1);
    }
  });

  chrome.tabs.onActivated.addListener(() => void readTab());
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tab.id && (info.status === "complete" || info.url)) void readTab();
  });

  let timer = null;
  // The side panel calls this when the MJ Queue tab is shown or hidden.
  function setVisible(visible) {
    state.visible = visible;
    root.hidden = !visible;
    clearInterval(timer);
    if (!visible) return;
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

  chrome.storage.local.get([KEYS.view, KEYS.batch, KEYS.scope], (stored) => {
    state.view = stored?.[KEYS.view] === "thread" ? "thread" : "threads";
    state.batchKey = String(stored?.[KEYS.batch] || "");
    state.scope = stored?.[KEYS.scope] === "all" ? "all" : "open";
    if (state.visible) render();
  });

  globalScope.SaveToGalleryMjQueuePanel = { setVisible };
})(typeof globalThis !== "undefined" ? globalThis : self);
