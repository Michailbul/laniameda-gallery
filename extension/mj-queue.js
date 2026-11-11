// Midjourney prompt queue. Agents queue prompts in the gallery, grouped in
// threads, with every reference set. Michael reviews them in the extension's
// side panel (MJ Queue tab, mj-queue-panel.js); on midjourney.com this script
// is its hands: it puts a prompt in the Imagine bar, reads the bar back,
// presses Enter once when he clicks Send in the panel (or he presses Enter
// himself), and records the job. One job per click; no loops, no timers,
// nothing submitted in the background. The pure helpers below are shared with
// the panel.
(function registerMjQueue(globalScope) {
  "use strict";

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

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

  // ── Pacing for "Next · Send" ──
  // Every send here is Michael's own click, so nothing blocks it (he lifted the
  // 30-an-hour stop and the two-in-flight hold, 11 Nov 2026: the CLAUDE.md caps
  // are for agents and scripts that submit by themselves). The counter shows
  // the account's jobs in the last hour from its own history; past hourNote it
  // shows a heads-up only. Midjourney's own queue still refuses when it is full.
  const PACING = { gapMs: 0, hourNote: 150 };

  // rate: { lastHour, inFlight, newestJobAt } from the account; lastSendAt: this panel's last send.
  function pacing({ rate, lastSendAt, now = Date.now() }) {
    const last = Math.max(lastSendAt || 0, (rate && rate.newestJobAt) || 0);
    const waitMs = last ? Math.max(0, last + PACING.gapMs - now) : 0;
    const lastHour = rate ? rate.lastHour : null;
    const reason = lastHour != null && lastHour >= PACING.hourNote
      ? `${lastHour} jobs in the last hour. Sending still works; Midjourney may slow the account down.`
      : "";
    return { ok: waitMs === 0, waitMs, lastHour, reason };
  }

  // Jobs in the last hour from Midjourney's own history rows (enqueue_time).
  function rateFromHistory(rows, queue, now = Date.now()) {
    const times = (rows || []).map((row) => Date.parse(row && row.enqueue_time)).filter(Number.isFinite);
    const inFlight = ((queue && queue.running) || []).length + ((queue && queue.waiting) || []).length;
    return {
      lastHour: times.filter((time) => now - time < 3600000).length + inFlight,
      inFlight,
      newestJobAt: times.length ? Math.max(...times) : 0,
    };
  }

  globalScope.SaveToGalleryMjQueue = {
    PACING, pacing, rateFromHistory,
    recount,
    nextQueued, jobIdsIn, promptNeedle, parseRefLines, refLines,
    threadName, threadGroups, threadOrder, filterItems, filterCounts, worldLabel,
  };

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  const SEND_CONFIRM_MS = 5000;
  const JOB_WATCH_MS = 120000;
  const ROUTE_PATH = "/api/extension/mj-queue";
  const CANONICAL_API_HOST = "gallery.laniameda.space";
  const LEGACY_API_HOSTS = ["laniameda.gallery", "laniameda-galery.vercel.app"];
  const TRANSIENT = /message port closed|receiving end does not exist/i;
  const compose = () => globalScope.SaveToGalleryMjQueueCompose;

  // The prompt Michael put in the bar from the panel, while it is there.
  let active = null;
  let sending = false;
  let watchedArea = null;

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

  // Tell the side panel (if open) what changed. Nobody listening is fine.
  function tellPanel(message) {
    if (!extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({ ...message, action: message.action }, () => void chrome.runtime.lastError);
    } catch {
      // extension reloaded
    }
  }

  // ── Gallery saves (sent, job id) ──

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

  function routeUrl(rawApiUrl) {
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
    url.hash = "";
    return url.toString();
  }

  // The service worker can be mid-restart: ask the gallery directly then.
  async function postDirect(body) {
    try {
      const config = await chrome.storage.sync.get(["apiUrl", "apiToken"]);
      const token = String(config?.apiToken || "").trim();
      const response = await fetch(routeUrl(config?.apiUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-Extension-Token": token } : {}) },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      return response.ok && data ? data : { ok: false, error: data?.error || `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function save(itemId, patch) {
    const body = { itemId, ...patch };
    let res = await askBackground({ method: "POST", body });
    if (!res.ok && res.transient) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      res = await askBackground({ method: "POST", body });
      if (!res.ok && res.transient) res = await postDirect(body);
    }
    tellPanel({ action: "mjQueueChanged", itemId, ok: Boolean(res.ok), error: res.ok ? "" : res.error });
    return res;
  }

  // ── The bar ──

  function inject(item) {
    const area = findTextarea();
    if (!area) return { ok: false, error: "No Imagine bar on this page. Open Create." };
    const { command } = compose().composeMjCommand(item);
    // The moodboard dock must not add its remembered -p flag to this command.
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    writeTextareaValue(area, command);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    active = { item, command };
    sending = false;
    watchArea(area);
    // Midjourney can rewrite the bar a moment later (it trims or re-renders).
    setTimeout(() => {
      if (active && active.item.id === item.id && area.isConnected) {
        tellPanel({ action: "mjQueueBar", itemId: item.id, value: area.value });
      }
    }, 300);
    return { ok: true, readback: area.value };
  }

  // The account's pace, read from Midjourney's own history at most every 20 s
  // (the pacing rule's gentle reading). Read only.
  let rateCache = null;
  function midjourneyUserId() {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    try {
      const fromSettings = uuid.exec(localStorage.getItem("settings_v30") || "");
      if (fromSettings) return fromSettings[0];
      for (const key of Object.keys(localStorage)) {
        const match = /:([0-9a-f-]{36})$/i.exec(key);
        if (match && uuid.test(match[1])) return match[1];
      }
    } catch {
      // storage blocked
    }
    return null;
  }
  async function readRate(force) {
    if (!force && rateCache && Date.now() - rateCache.at < 20000) return rateCache.value;
    const user = midjourneyUserId();
    if (!user) return { ok: false, error: "Sign in to Midjourney to read the pace." };
    const headers = { "Content-Type": "application/json", "X-CSRF-Protection": "1" };
    try {
      const [history, queue] = await Promise.all([
        fetch(`https://www.midjourney.com/api/imagine?user_id=${user}&page_size=100`, { credentials: "include", headers }).then((r) => r.json()),
        fetch("https://www.midjourney.com/api/user-queue", { credentials: "include", headers }).then((r) => r.json()).catch(() => null),
      ]);
      const rows = Array.isArray(history) ? history : history && history.data;
      if (!Array.isArray(rows)) return { ok: false, error: "Midjourney did not answer the history." };
      const value = { ok: true, ...rateFromHistory(rows, queue), at: Date.now() };
      rateCache = { at: Date.now(), value };
      return value;
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
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
    let observer = null;
    const check = () => {
      timer = null;
      for (const node of document.querySelectorAll('a[href*="/jobs/"], img[src*="cdn.midjourney.com/"]')) {
        const ids = jobIdsIn([node.getAttribute("href") || node.getAttribute("src") || ""]);
        for (const id of ids) {
          if (before.has(id)) continue;
          let row = node;
          for (let level = 0; level < 10 && row; level += 1, row = row.parentElement) {
            if (space(row.textContent).toLowerCase().includes(needle)) {
              observer?.disconnect();
              void save(item.id, { jobId: id });
              return;
            }
          }
          before.add(id);
        }
      }
    };
    observer = new MutationObserver(() => {
      if (Date.now() - started > JOB_WATCH_MS) {
        observer.disconnect();
        return;
      }
      if (!timer) timer = setTimeout(check, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
    setTimeout(() => observer.disconnect(), JOB_WATCH_MS);
    check();
  }

  // Midjourney empties the bar when it takes a job. Wait for that.
  function confirmSend(item, command, before) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const current = findTextarea();
        if (!current || space(current.value) !== space(command)) {
          sending = false;
          active = null;
          rateCache = null;
          void save(item.id, { status: "sent", sentCommand: command }).then(() => watchForJob(item, before));
          resolve({ ok: true, sent: true });
          return;
        }
        if (Date.now() - started > SEND_CONFIRM_MS) {
          sending = false;
          resolve({ ok: false, sent: false, error: "Midjourney did not take it. Press Enter in the bar." });
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // Send: only from his own click on Send in the side panel. Presses Enter in
  // the bar once, the way he would; the bar's own command (with any edit he
  // made there) is sent.
  function pressSend(itemId) {
    if (sending) return Promise.resolve({ ok: false, error: "Already sending." });
    if (!active || active.item.id !== itemId) return Promise.resolve({ ok: false, error: "Put it in the bar first." });
    const area = findTextarea();
    if (!area || !space(area.value)) return Promise.resolve({ ok: false, error: "The bar is empty. Put it in again." });
    sending = true;
    const command = area.value;
    const before = snapshotJobIds();
    area.focus();
    const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    area.dispatchEvent(new KeyboardEvent("keydown", enter));
    area.dispatchEvent(new KeyboardEvent("keypress", enter));
    area.dispatchEvent(new KeyboardEvent("keyup", enter));
    return confirmSend(active.item, command, before);
  }

  // His own Enter in the bar while a queued prompt is in it counts as Send.
  function onAreaKeydown(event) {
    if (!event.isTrusted || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (!active || sending) return;
    const command = event.currentTarget.value;
    if (!space(command)) return;
    sending = true;
    tellPanel({ action: "mjQueueSending", itemId: active.item.id });
    void confirmSend(active.item, command, snapshotJobIds());
  }

  function onAreaInput(event) {
    if (!active) return;
    tellPanel({ action: "mjQueueBar", itemId: active.item.id, value: event.currentTarget.value });
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

  // ── Messages from the side panel (this extension's own pages only) ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.action === "mjQueuePing") {
      const area = findTextarea();
      sendResponse({ ok: true, bar: Boolean(area), value: area ? area.value : "", activeId: active ? active.item.id : null, sending });
      return false;
    }
    if (message.action === "mjQueueInject") {
      sendResponse(message.item ? inject(message.item) : { ok: false, error: "No prompt." });
      return false;
    }
    if (message.action === "mjQueueSend") {
      pressSend(message.itemId).then(sendResponse);
      return true;
    }
    if (message.action === "mjQueueRate") {
      readRate(Boolean(message.force)).then(sendResponse);
      return true;
    }
    return false;
  });

  // ⌥⇧N on the page: the panel puts the next prompt of its thread in the bar.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey || event.code !== "KeyN") return;
      event.preventDefault();
      event.stopPropagation();
      tellPanel({ action: "mjQueueNext" });
    },
    true,
  );
})(typeof globalThis !== "undefined" ? globalThis : self);
