// Midjourney prompt queue. Agents queue prompts in the gallery, grouped in
// threads, with every reference set. Michael reviews them in the extension's
// side panel (MJ Queue tab, mj-queue-panel.js); on midjourney.com this script
// is its hands: it puts a prompt in the Imagine bar, reads the bar back, and
// records the job once Michael sends it himself: his Enter in the bar or his
// click on Midjourney's send button. Then the thread's next prompt goes in the
// bar, unsent (a panel switch turns that off). ⌥⇧N puts the next one in, ⌥⇧S
// skips the one in the bar. Nothing here ever presses, clicks or submits:
// Midjourney read a scripted Enter as a bot and blocked the account on 14 Nov
// 2026, and a scripted click is just as untrusted. One job per press; no
// loops, no timers, nothing submitted in the background. The pure helpers
// below are shared with the panel.
(function registerMjQueue(globalScope) {
  "use strict";

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  // ── Pure helpers (tested) ──

  // Still to send: queued, or put in the bar earlier and never sent (a reload,
  // another tab, a closed panel leave it "injected"). Both go out with Next · Send.
  const isOpen = (item) => item.status === "queued" || item.status === "injected";

  // The next item to inject in a batch: the first open one after `afterId`
  // in order, else the first open one from the top.
  function nextQueued(items, afterId) {
    const open = isOpen;
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
    open: isOpen,
    sent: (item) => item.status === "sent",
    skipped: (item) => item.status === "skipped",
    all: () => true,
  };

  // The items a filter shows; the one in the bar always stays in view.
  function filterItems(items, filter, activeId) {
    const keep = FILTERS[filter] || FILTERS.open;
    return (items || []).filter((item) => item.id === activeId || keep(item));
  }

  // Stylize (--s / --stylize) across a thread: the panel's slider sets one
  // value on every prompt still to send (Michael, 12 Nov 2026).
  const STYLIZE_RE = /(^|\s)--(?:s|stylize)\s+(\d+)(?=\s|$)/g;

  function stylizeOf(params) {
    const found = [...String(params || "").matchAll(STYLIZE_RE)];
    return found.length ? Number(found[found.length - 1][2]) : null;
  }

  function withStylize(params, value) {
    const v = Math.max(0, Math.min(1000, Math.round(Number(value) || 0)));
    const text = String(params || "").replace(STYLIZE_RE, "").replace(/\s+/g, " ").trim();
    return `${text} --stylize ${v}`.trim();
  }

  // The prompts the slider touches (still to send) and their current value:
  // the shared one, or the most common when they differ (mixed).
  function threadStylize(items) {
    const open = (items || []).filter(isOpen);
    const tally = new Map();
    for (const item of open) {
      const value = stylizeOf(item.params);
      tally.set(value, (tally.get(value) || 0) + 1);
    }
    let value = null;
    let best = -1;
    for (const [key, count] of tally) if (count > best) { best = count; value = key; }
    return { items: open, count: open.length, value, mixed: tally.size > 1 };
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

  // ── Thread params: Raw / Standard, aspect, chaos, weird, exp (17 Nov 2026) ──
  // Applied to prompts still to send; sent ones keep theirs.
  const PARAM_FLAGS = { ar: ["ar", "aspect"], chaos: ["chaos", "c"], weird: ["weird", "w"], exp: ["exp"] };
  const PARAM_KEYS = Object.keys(PARAM_FLAGS);
  const flagPattern = (key) => new RegExp(`(^|\\s)--(?:${PARAM_FLAGS[key].join("|")})\\s+(\\S+)(?=\\s|$)`, "gi");
  const RAW_RE = /(^|\s)(?:--raw|--style\s+raw)(?=\s|$)/gi;
  const tidy = (text) => String(text || "").replace(/\s+/g, " ").trim();

  function paramOf(params, key) {
    if (!PARAM_FLAGS[key]) return null;
    const found = [...String(params || "").matchAll(flagPattern(key))];
    return found.length ? found[found.length - 1][2] : null;
  }

  // The params with that flag set to value (once, where it already was), or
  // removed for null / "".
  function withParam(params, key, value) {
    if (!PARAM_FLAGS[key]) return tidy(params);
    const v = value == null ? "" : String(value).trim();
    let placed = false;
    const pattern = new RegExp(`(^|\\s)--(${PARAM_FLAGS[key].join("|")})\\s+(\\S+)(?=\\s|$)`, "gi");
    const text = tidy(String(params || "").replace(pattern, (all, lead, flag) => {
      if (!v || placed) return lead;
      placed = true;
      return `${lead}--${flag} ${v}`;
    }));
    return v && !placed ? tidy(`${text} --${PARAM_FLAGS[key][0]} ${v}`) : text;
  }

  const isRaw = (params) => new RegExp(RAW_RE.source, "i").test(String(params || ""));

  function withRaw(params, on) {
    const text = tidy(String(params || "").replace(RAW_RE, "$1"));
    return on ? tidy(`${text} --raw`) : text;
  }

  // A typed value for the params editor, or why it is refused. "" clears.
  const PARAM_RANGES = { chaos: [0, 100], weird: [0, 3000], exp: [0, 100] };
  function cleanParamValue(key, raw) {
    const text = String(raw == null ? "" : raw).trim();
    if (!text) return { ok: true, value: null };
    if (key === "ar") {
      return /^\d{1,3}:\d{1,3}$/.test(text) ? { ok: true, value: text } : { ok: false, error: "Aspect is two numbers like 16:9." };
    }
    const range = PARAM_RANGES[key];
    const number = Number(text);
    if (!range || !Number.isFinite(number)) return { ok: false, error: `${key} needs a number.` };
    if (number < range[0] || number > range[1]) return { ok: false, error: `${capitalize(key)} is ${range[0]} to ${range[1]}.` };
    return { ok: true, value: String(Math.round(number)) };
  }
  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  // What the thread's prompts still to send hold: per flag the most common
  // value and whether they differ ("mixed").
  function threadParams(items) {
    const open = (items || []).filter(isOpen);
    const sum = (read) => {
      const tally = new Map();
      for (const item of open) {
        const value = read(item.params);
        tally.set(value, (tally.get(value) || 0) + 1);
      }
      let value = null;
      let best = -1;
      for (const [key, count] of tally) if (count > best) { best = count; value = key; }
      return { value, mixed: tally.size > 1 };
    };
    const out = { count: open.length, items: open, raw: sum(isRaw) };
    for (const key of PARAM_KEYS) out[key] = sum((params) => paramOf(params, key));
    return out;
  }

  // changes: { raw?: boolean, stylize?: number, ar|chaos|weird|exp?: string | null }
  // (undefined leaves a flag alone, null removes it). Returns only the
  // prompts still to send whose params change: [{ item, params }].
  function applyThreadParams(items, changes) {
    const out = [];
    for (const item of (items || []).filter(isOpen)) {
      let params = tidy(item.params);
      if (changes.stylize !== undefined && changes.stylize !== null) {
        const value = Math.max(0, Math.min(1000, Math.round(Number(changes.stylize) || 0)));
        if (stylizeOf(params) !== value || /(^|\s)--s\s/.test(params)) params = withStylize(params, value);
      }
      if (typeof changes.raw === "boolean" && isRaw(params) !== changes.raw) params = withRaw(params, changes.raw);
      for (const key of PARAM_KEYS) if (changes[key] !== undefined) params = withParam(params, key, changes[key]);
      if (params !== tidy(item.params)) out.push({ item, params });
    }
    return out;
  }

  // ── The Imagine bar's text, taken apart (Test and Random on the bar prompt) ──

  const PROFILE_FLAGS = /(^|\s)(?:--profile|--p|-p)((?:\s+[^\s-]\S*)+)/g;
  const BARE_PROFILE = /(^|\s)(?:--profile|--p|-p)(?=\s+--|\s*$)/g;

  function refToken(token) {
    const match = /^(\S+?)(?:::(-?\d+(?:\.\d+)?))?$/.exec(token);
    const value = match ? match[1] : token;
    const ref = /^https?:\/\//i.test(value) ? { url: value } : { code: value };
    if (match && match[2] != null) ref.weight = Number(match[2]);
    return ref;
  }

  // "url url words --sref a b::2 --iw 0.5 --profile x --ar 3:1" →
  // { imagePrompts, prompt, styleRefs, profileCodes, params }. Profile codes
  // come out; every other flag stays in params as typed.
  function parseBarCommand(text) {
    let body = space(String(text || "").replace(/(^|\s)[–—](?=[a-z])/gi, "$1--"));
    const profileCodes = [];
    body = body.replace(PROFILE_FLAGS, (all, lead, codes) => {
      profileCodes.push(...codes.trim().split(/\s+/));
      return lead;
    }).replace(BARE_PROFILE, "$1");
    const tokens = space(body).split(" ").filter(Boolean);
    const isFlag = (token) => /^--[a-z]/i.test(token);
    const imagePrompts = [];
    let at = 0;
    while (at < tokens.length && /^https?:\/\/\S+$/i.test(tokens[at])) imagePrompts.push({ url: tokens[at++] });
    const prose = [];
    while (at < tokens.length && !isFlag(tokens[at])) prose.push(tokens[at++]);
    const styleRefs = [];
    const rest = [];
    while (at < tokens.length) {
      const token = tokens[at];
      if (/^--sref$/i.test(token)) {
        at += 1;
        while (at < tokens.length && !isFlag(tokens[at])) styleRefs.push(refToken(tokens[at++]));
        continue;
      }
      if (/^--iw$/i.test(token) && imagePrompts.length && /^-?\d/.test(tokens[at + 1] || "")) {
        imagePrompts[0].weight = Number(tokens[at + 1]);
        at += 2;
        continue;
      }
      rest.push(token);
      at += 1;
    }
    return { imagePrompts, prompt: prose.join(" "), styleRefs, profileCodes: [...new Set(profileCodes)], params: rest.join(" ") };
  }

  const proseWords = (text) =>
    space(text).toLowerCase().replace(/[^\p{L}\p{N}\s'-]+/gu, " ").split(/\s+/).filter((word) => word.length > 1);

  // Is the bar still this queued prompt (as queued or edited), or has it been
  // rewritten into another prompt? Half of the prompt's opening words must
  // still be there; an image-only prompt needs one of its images.
  function belongsToItem(value, item) {
    if (!item || !space(value)) return false;
    const words = proseWords(item.prompt).slice(0, 12);
    if (!words.length) {
      const urls = (item.imagePrompts || []).map((ref) => ref && ref.url).filter(Boolean);
      return urls.some((url) => String(value).includes(url));
    }
    const have = new Set(proseWords(parseBarCommand(value).prompt));
    const kept = words.filter((word) => have.has(word)).length;
    return kept / words.length >= 0.5;
  }

  // ── Sending with the keyboard ──

  // ⌥⇧S (skip to next): never twice from one held key or a fast double press.
  const SEND_GUARD_MS = 1500;
  function sendKeyAllowed({ repeat, lastAt, now = Date.now() }) {
    if (repeat) return false;
    return !lastAt || now - lastAt >= SEND_GUARD_MS;
  }

  // How much a button next to the Imagine bar looks like Midjourney's own
  // send button, to recognise Michael's own (trusted) click on it. Hashed
  // class names change; labels, svg icons and the place at the right end of
  // the bar do not. 3 or more counts as the send button. Never clicked by us.
  function sendButtonScore({ label = "", text = "", hasSvg = false, type = "", disabled = false, ours = false, rightmost = false } = {}) {
    if (ours || disabled) return -1;
    let score = 0;
    const words = `${label} ${text}`.toLowerCase();
    if (/\b(submit|send|imagine|generate|create|run)\b/.test(words)) score += 5;
    if (/\b(setting|settings|attach|upload|add|image|remove|clear|close|menu|more|option|options|mode|speed|cancel|delete)\b/.test(words)) score -= 6;
    if (String(type).toLowerCase() === "submit") score += 3;
    if (hasSvg && !space(text)) score += 1;
    if (rightmost) score += 2;
    return score;
  }

  // ── Test and Random threads ──

  const VARIANT_KIND = { test: "Test", random: "Random", extreme: "Extreme" };
  const clampCount = (n) => Math.max(1, Math.min(12, Math.round(Number(n) || 4)));

  function firstWords(text, count = 5) {
    return space(text).split(" ").filter(Boolean).slice(0, count).join(" ");
  }

  function variantThreadName(kind, text) {
    const words = firstWords(String(text || "").replace(/https?:\/\/\S+/g, " ")) || "image prompt";
    return `${VARIANT_KIND[kind] || "Test"} · ${words}`;
  }

  // The dock's moodboards route answer → a randomizer pool.
  function poolFromMoodboards(res) {
    const names = {};
    const profiles = [];
    const boards = [];
    for (const profile of (res && res.profiles) || []) {
      const code = space(profile && profile.code);
      if (!code || profiles.includes(code)) continue;
      profiles.push(code);
      names[code] = space(profile.name) || code;
    }
    for (const board of (res && res.moodboards) || []) {
      const code = space(board && board.mjCode);
      if (!code || boards.includes(code) || profiles.includes(code)) continue;
      boards.push(code);
      names[code] = space(board.shortName || board.name) || code;
    }
    return { profiles, boards, names };
  }

  function variantList(kind, pool, n, R, rng) {
    if (!R) return [];
    if (kind === "test") return R.testSet(pool, { includeNone: true });
    return R.randomSet(pool, clampCount(n), kind === "extreme" ? "extreme" : "random", rng ? { rng } : {});
  }

  // What Test / Random copies: the queued item as it is (keeps its
  // references, frames and seed), or the bar's own text when it was edited
  // or never came from the queue.
  function variantSource(item, barValue, composeCommand) {
    const bar = space(barValue);
    if (item && (!bar || (composeCommand && space(composeCommand(item)) === bar))) return { mode: "item", item, words: item.prompt };
    if (bar) {
      const fields = parseBarCommand(bar);
      if (!fields.prompt && !fields.imagePrompts.length) return null;
      return { mode: "bar", fields, words: fields.prompt, item: item && belongsToItem(bar, item) ? item : null };
    }
    return null;
  }

  // The POST body that makes the thread (nothing is sent to Midjourney).
  function variantRequest({ kind, source, variants, worldKey, R }) {
    const batch = variantThreadName(kind, source.words);
    const createdBy = `extension · ${kind}`;
    if (source.mode === "item") {
      const params = String(source.item.params || "");
      const stripped = R && R.codesIn(params).length ? R.withCodes(params, []) : undefined;
      return {
        action: "fork", itemId: source.item.id, batch, createdBy,
        variants: variants.map((variant) => ({ title: variant.label, profileCodes: variant.codes, ...(stripped !== undefined ? { params: stripped } : {}) })),
      };
    }
    const fields = source.fields;
    const ref = (entry) => {
      const out = entry.url ? { url: entry.url } : { code: entry.code };
      if (typeof entry.weight === "number" && Number.isFinite(entry.weight)) out.weight = entry.weight;
      return out;
    };
    return {
      action: "queue", fresh: true, createdBy, batch,
      ...(worldKey ? { world: worldKey } : {}),
      items: variants.map((variant) => ({
        title: variant.label,
        prompt: fields.prompt,
        imagePrompts: fields.imagePrompts.map(ref),
        styleRefs: fields.styleRefs.map(ref),
        profileCodes: variant.codes,
        params: fields.params,
      })),
    };
  }

  // Builds a Test / Random thread end to end. io: { listMoodboards(world),
  // post(body), dockWorld() }. Returns { ok, batch, batchKey, items, count }.
  async function makeVariantThread({ kind, n, item, barValue, worldKey, io, R = globalScope.SaveToGalleryRandomize, composeCommand }) {
    const source = variantSource(item, barValue, composeCommand);
    if (!source) return { ok: false, error: "Nothing to test: put a prompt in the bar first." };
    const world = space((source.item && source.item.worldKey) || worldKey);
    if (!world) return { ok: false, error: "Pick a world in the dock first: Test uses the world's profiles." };
    const listed = await io.listMoodboards(world);
    if (!listed || listed.ok === false) return { ok: false, error: `Could not read the world's profiles. ${String((listed && listed.error) || "").slice(0, 100)}` };
    const pool = poolFromMoodboards(listed);
    if (!pool.profiles.length) return { ok: false, error: "This world has no Midjourney profiles yet." };
    const variants = variantList(kind, pool, n, R);
    if (!variants.length) return { ok: false, error: "The randomizer is not loaded. Reload the extension." };
    const body = variantRequest({ kind, source, variants, worldKey: world, R });
    const res = await io.post(body);
    if (!res || !res.ok) return { ok: false, error: `Not saved. ${String((res && res.error) || "").slice(0, 120)}` };
    const batchKey = res.batchKey || "";
    return { ok: true, batch: res.batch, batchKey, items: res.items || [], count: variants.length, world };
  }

  globalScope.SaveToGalleryMjQueue = {
    PACING, pacing, rateFromHistory,
    recount,
    nextQueued, jobIdsIn, promptNeedle, parseRefLines, refLines,
    threadName, threadGroups, threadOrder, filterItems, filterCounts, worldLabel,
    stylizeOf, withStylize, threadStylize,
    paramOf, withParam, isRaw, withRaw, cleanParamValue, threadParams, applyThreadParams,
    parseBarCommand, belongsToItem, sendKeyAllowed, SEND_GUARD_MS, sendButtonScore,
    variantThreadName, poolFromMoodboards, variantList, variantSource, variantRequest, makeVariantThread, clampCount,
  };

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  // A second copy of this script in the same page (the extension re-injects
  // after an update) takes over: the old copy's listeners and timers go, and
  // nodes an older, reloaded copy left behind are removed.
  try {
    globalScope.__stgMjqPage?.teardown?.();
  } catch {
    // an old copy that cannot be reached
  }
  for (const node of document.querySelectorAll(".stg-mjq-pill, .stg-mjq-toast")) node.remove();
  const cleanups = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // Midjourney can take a while to empty the bar (image prompts, a busy
  // queue): a send is given this long before it counts as not taken.
  const SEND_CONFIRM_MS = 12000;
  const JOB_WATCH_MS = 120000;
  // The bar emptied without his Enter or a click we saw: a job with the
  // prompt's words must show in the feed within this time to count as sent.
  const FEED_CONFIRM_MS = 25000;
  const BAR_POLL_MS = 600;
  const ROUTE_PATH = "/api/extension/mj-queue";
  const CANONICAL_API_HOST = "gallery.laniameda.space";
  const LEGACY_API_HOSTS = ["laniameda.gallery", "laniameda-galery.vercel.app"];
  const TRANSIENT = /message port closed|receiving end does not exist/i;
  const PANEL_BATCH_KEY = "stgMjqBatch";
  const DOCK_WORLD_KEY = "stgMoodboardWorld";
  const compose = () => globalScope.SaveToGalleryMjQueueCompose;

  // The prompt put in the bar from the queue, while it is there:
  // { item, command, lastValue, before (job ids on the page), feedWatch }.
  let active = null;
  let sending = false;
  let watchedArea = null;
  // Items marked sent from this page: each is marked exactly once.
  const marked = new Set();
  let lastSendKeyAt = 0;
  // Panel switch "Next in bar after send" (on unless he turned it off).
  const AUTO_NEXT_KEY = "stgMjqAutoNext";

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

  // Ask the side panel and wait for its answer; null when no panel answers.
  function askPanel(message) {
    return new Promise((resolve) => {
      if (!extensionAlive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res && res.handled ? res : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function readLocal(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (stored) => resolve(stored || {}));
      } catch {
        resolve({});
      }
    });
  }

  // ── A small note on the page ("Sent 3/12 · next in bar") ──

  let toast = null;
  let toastTimer = null;
  function hideToast() {
    clearTimeout(toastTimer);
    if (toast) toast.remove();
    toast = null;
  }
  function showToast(text, tone = "ok") {
    if (!toast || !toast.isConnected) {
      toast = document.createElement("div");
      toast.className = "stg-mjq-toast";
      toast.setAttribute("role", "status");
      toast.style.cssText = [
        "position:fixed", "left:50%", "bottom:74px", "transform:translateX(-50%)", "z-index:2147483001",
        "display:inline-flex", "align-items:center", "gap:10px", "padding:9px 15px 9px 13px", "max-width:min(560px,90vw)",
        "border:1px solid rgba(255,244,234,0.14)", "border-radius:999px", "background:rgba(10,8,5,0.94)",
        "color:#fff4ea", "font:600 12.5px/1.3 Inter,'Helvetica Neue',Arial,sans-serif", "letter-spacing:0.01em",
        "box-shadow:0 10px 30px rgba(0,0,0,0.45)", "pointer-events:none", "-webkit-backdrop-filter:blur(8px)", "backdrop-filter:blur(8px)",
      ].join(";");
      document.documentElement.appendChild(toast);
    }
    toast.textContent = "";
    const dot = document.createElement("span");
    dot.style.cssText = `flex:none;width:8px;height:8px;border-radius:50%;background:${tone === "warn" ? "#e8a838" : tone === "sent" ? "#5fbf86" : "#f26157"}`;
    const label = document.createElement("span");
    label.textContent = text;
    toast.append(dot, label);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, tone === "warn" ? 4200 : 2600);
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

  async function post(body) {
    let res = await askBackground({ method: "POST", body });
    if (!res.ok && res.transient) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      res = await askBackground({ method: "POST", body });
      if (!res.ok && res.transient) res = await postDirect(body);
    }
    return res;
  }

  async function save(itemId, patch) {
    const res = await post({ itemId, ...patch });
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
    active = { item, command, lastValue: area.value, before: snapshotJobIds(), feedWatch: null };
    sending = false;
    marked.delete(item.id);
    watchArea(area);
    startBarPoll();
    // Midjourney can rewrite the bar a moment later (it trims or re-renders).
    setTimeout(() => {
      if (active && active.item.id === item.id && area.isConnected) {
        active.lastValue = area.value || active.lastValue;
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

  const JOB_NODES = 'a[href*="/jobs/"], img[src*="cdn.midjourney.com/"]';

  function snapshotJobIds() {
    const values = [];
    for (const node of document.querySelectorAll(JOB_NODES)) {
      values.push(node.getAttribute("href") || node.getAttribute("src") || "");
    }
    return jobIdsIn(values);
  }

  // The first new job id on the page whose feed row prints the prompt's
  // opening words. Reads the page only; asks Midjourney nothing.
  function watchFeed(item, before, timeoutMs, onFound) {
    const needle = promptNeedle(item);
    if (!needle) return () => {};
    const seen = new Set(before);
    let timer = null;
    let done = false;
    const stop = () => {
      done = true;
      clearTimeout(timer);
      observer.disconnect();
    };
    const check = () => {
      timer = null;
      if (done) return;
      for (const node of document.querySelectorAll(JOB_NODES)) {
        for (const id of jobIdsIn([node.getAttribute("href") || node.getAttribute("src") || ""])) {
          if (seen.has(id)) continue;
          let row = node;
          for (let level = 0; level < 10 && row; level += 1, row = row.parentElement) {
            if (space(row.textContent).toLowerCase().includes(needle)) {
              stop();
              onFound(id);
              return;
            }
          }
          seen.add(id);
        }
      }
    };
    const observer = new MutationObserver(() => {
      if (!timer && !done) timer = setTimeout(check, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
    setTimeout(() => {
      if (!done) {
        stop();
        onFound(null);
      }
    }, timeoutMs);
    check();
    return stop;
  }

  // Sent, exactly once per item: the panel hears it, the gallery records it
  // with the command as it went, then the job id once the feed shows it.
  function markSent(item, command, before, via, jobId) {
    if (marked.has(item.id)) return false;
    marked.add(item.id);
    if (active && active.item.id === item.id) {
      active.feedWatch?.();
      active = null;
    }
    sending = false;
    rateCache = null;
    tellPanel({ action: "mjQueueSent", itemId: item.id, via });
    void nextAfterSend(item);
    if (jobId) {
      void save(item.id, { status: "sent", sentCommand: command, jobId });
      return true;
    }
    void save(item.id, { status: "sent", sentCommand: command }).then(() => {
      watchFeed(item, before, JOB_WATCH_MS, (found) => {
        if (found) void save(item.id, { jobId: found });
      });
    });
    return true;
  }

  // Midjourney empties the bar when it takes a job. Wait for that.
  // needEmpty: only an empty bar counts (a click whose button we are not sure of).
  function confirmSend(item, command, before, { via, needEmpty = false } = {}) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (marked.has(item.id)) {
          resolve({ ok: true, sent: true });
          return;
        }
        const current = findTextarea();
        const value = current ? space(current.value) : "";
        if (!current || !value || (!needEmpty && value !== space(command))) {
          markSent(item, command, before, via);
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

  // Send from the panel's Next: puts the cursor at the end of the prompt in
  // the bar and waits for his Enter, his click on Midjourney's send button,
  // Nothing here presses Enter or clicks (readyForEnter keeps that promise).
  function readyForEnter(itemId) {
    if (sending) return Promise.resolve({ ok: false, error: "Already sending." });
    if (!active || active.item.id !== itemId) return Promise.resolve({ ok: false, error: "Put it in the bar first." });
    const area = findTextarea();
    if (!area || !space(area.value)) return Promise.resolve({ ok: false, error: "The bar is empty. Put it in again." });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    return Promise.resolve({ ok: true, sent: false, waitingForEnter: true });
  }

  // The queued prompt is no longer what the bar holds (he wrote another one):
  // it stays to send, and nothing will mark it.
  function release(reason) {
    if (!active) return;
    const item = active.item;
    active.feedWatch?.();
    active = null;
    sending = false;
    tellPanel({ action: "mjQueueReleased", itemId: item.id, reason });
  }

  // He is about to send what the bar holds (his Enter or his click).
  function beginSend(value, via, needEmpty) {
    if (!active || sending || marked.has(active.item.id)) return;
    if (!space(value)) return;
    if (!belongsToItem(value, active.item)) {
      release("other prompt");
      return;
    }
    sending = true;
    const item = active.item;
    tellPanel({ action: "mjQueueSending", itemId: item.id });
    void confirmSend(item, value, active.before, { via, needEmpty }).then((res) => {
      if (res.ok) return;
      if (via === "enter") tellPanel({ action: "mjQueueNotSent", itemId: item.id, error: res.error });
      else tellPanel({ action: "mjQueueNotSent", itemId: item.id, error: "" });
    });
  }

  // The bar holds a prompt of the open thread that this copy of the script
  // did not put there (the extension reloaded after an update, or the page
  // was reloaded): find it among the thread's prompts still to send, so his
  // Enter still counts as its send and the next one follows.
  let adopting = false;
  async function adoptAndSend(value, before) {
    if (adopting || active) return;
    adopting = true;
    try {
      const key = await threadOf("");
      if (!key) return;
      const res = await askBackground({ method: "GET", query: { batch: key } });
      if (!res.ok || active) return;
      const open = (res.items || [])
        .filter((item) => item.batchKey === key && isOpen(item) && !marked.has(item.id) && belongsToItem(value, item))
        .sort((a, b) => Number(b.status === "injected") - Number(a.status === "injected") || a.order - b.order);
      const item = open[0];
      if (!item) return;
      active = { item, command: value, lastValue: value, before, feedWatch: null };
      sending = true;
      tellPanel({ action: "mjQueueInjected", item, readback: value });
      tellPanel({ action: "mjQueueSending", itemId: item.id });
      const sent = await confirmSend(item, value, before, { via: "enter", needEmpty: true });
      if (!sent.ok) {
        active = null;
        tellPanel({ action: "mjQueueNotSent", itemId: item.id, error: "" });
      }
    } finally {
      adopting = false;
    }
  }

  // His own Enter in the Imagine bar while a queued prompt is in it counts as
  // Send. Heard on the document, so a bar Midjourney redrew is still heard.
  function onAreaKeydown(event) {
    if (!extensionAlive()) return;
    if (!event.isTrusted || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const area = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!area || area !== findTextarea()) return;
    if (!active) {
      if (space(area.value)) void adoptAndSend(area.value, snapshotJobIds());
      return;
    }
    beginSend(area.value, "enter", false);
  }
  listen(document, "keydown", onAreaKeydown, true);

  function onAreaInput(event) {
    if (!active) return;
    active.lastValue = event.currentTarget.value || active.lastValue;
    tellPanel({ action: "mjQueueBar", itemId: active.item.id, value: event.currentTarget.value });
  }

  function watchArea(area) {
    if (watchedArea === area) return;
    if (watchedArea) watchedArea.removeEventListener("input", onAreaInput);
    watchedArea = area;
    area.addEventListener("input", onAreaInput);
  }
  cleanups.push(() => {
    if (!watchedArea) return;
    watchedArea.removeEventListener("input", onAreaInput);
    watchedArea = null;
  });

  // ── Midjourney's own send button ──

  // The box around the Imagine bar that holds its buttons.
  function promptBlock(area) {
    if (!area) return null;
    const fixed = area.closest("div.fixed");
    if (fixed) return fixed;
    let node = area;
    for (let level = 0; level < 4 && node.parentElement && node.parentElement !== document.body; level += 1) node = node.parentElement;
    return node;
  }

  const isOurs = (node) => Boolean(node.closest('[class*="stg-"]'));

  function buttonInfo(button, area, rightmost) {
    return {
      label: [button.getAttribute("aria-label"), button.getAttribute("title"), button.getAttribute("data-tooltip")].filter(Boolean).join(" "),
      text: button.textContent || "",
      hasSvg: Boolean(button.querySelector("svg")),
      type: button.getAttribute("type") || "",
      disabled: Boolean(button.disabled || button.getAttribute("aria-disabled") === "true"),
      ours: isOurs(button),
      rightmost: button === rightmost,
    };
  }

  // The rightmost button in the bar's row (where a send arrow sits).
  function rightmostButton(buttons, area) {
    const bar = area.getBoundingClientRect();
    let best = null;
    let bestRight = -Infinity;
    for (const button of buttons) {
      if (isOurs(button)) continue;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const overlaps = rect.bottom >= bar.top - 24 && rect.top <= bar.bottom + 24;
      if (overlaps && rect.right > bestRight) {
        best = button;
        bestRight = rect.right;
      }
    }
    return best;
  }

  function blockButtons(area) {
    const block = promptBlock(area);
    return block ? [...block.querySelectorAll('button, [role="button"]')] : [];
  }

  // His mouse click on Midjourney's send button counts as Send, like his Enter.
  // A click on another button of the bar counts only if the bar then empties
  // and the job shows in the feed (the bar poll below).
  listen(document, "click", (event) => {
    if (!extensionAlive() || !event.isTrusted || !active || sending) return;
    const area = findTextarea();
    const button = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null;
    if (!area || !button || isOurs(button)) return;
    const block = promptBlock(area);
    if (!block || !block.contains(button)) return;
    const rightmost = rightmostButton(blockButtons(area), area);
    if (sendButtonScore(buttonInfo(button, area, rightmost)) < 3) return;
    beginSend(area.value, "click", true);
  }, true);

  // ── Backstop: the bar emptied with no Enter or click we saw ──
  // Read the bar's text twice a second while a queued prompt is in it (a local
  // read, nothing asked of Midjourney or the gallery). Emptied: count it as
  // sent only when a new job with the prompt's words shows in the feed. A bar
  // cleared by hand makes no job, so nothing is marked; a bar rewritten into
  // another prompt lets the queued one go.
  let barPoll = null;
  function stopBarPoll() {
    clearInterval(barPoll);
    barPoll = null;
  }
  function startBarPoll() {
    if (barPoll) return;
    barPoll = setInterval(() => {
      if (!extensionAlive() || !active) {
        stopBarPoll();
        return;
      }
      const area = findTextarea();
      // Off Create (no bar) nothing is decided; the prompt waits.
      if (!area) return;
      const value = area.value;
      if (space(value)) {
        if (value !== active.lastValue) {
          active.lastValue = value;
          if (active.feedWatch) {
            // Filled again before the feed showed a job: it was not sent.
            active.feedWatch();
            active.feedWatch = null;
          }
        }
        return;
      }
      if (sending || active.feedWatch) return;
      const item = active.item;
      const last = active.lastValue;
      if (!belongsToItem(last, item)) {
        release("other prompt");
        return;
      }
      const before = active.before;
      active.feedWatch = watchFeed(item, before, FEED_CONFIRM_MS, (jobId) => {
        if (active && active.item.id === item.id) active.feedWatch = null;
        if (jobId) markSent(item, last, before, "feed", jobId);
      });
    }, BAR_POLL_MS);
  }
  cleanups.push(stopBarPoll);

  // ── The next prompt: the panel's open thread, or the gallery when no panel answers ──

  async function threadOf(batchKey) {
    let key = batchKey;
    if (!key) key = String((await readLocal([PANEL_BATCH_KEY]))[PANEL_BATCH_KEY] || "");
    return key;
  }

  // Puts the next prompt to send in the bar (never sends it). sentId: the one
  // just sent, so it is never picked again. Returns { ok, sent, total, done }.
  async function putNext({ batchKey = "", sentId = "", skipped = false } = {}) {
    const fromPanel = await askPanel({ action: "mjQueueNext", reply: true, batchKey, sentId: skipped ? "" : sentId, skippedId: skipped ? sentId : "", exclude: [...new Set([...(sentId ? [sentId] : []), ...marked])] });
    if (fromPanel) return fromPanel;
    const key = await threadOf(batchKey);
    if (!key) return { ok: false, error: "Open a thread in the MJ Queue panel first." };
    const res = await askBackground({ method: "GET", query: { batch: key } });
    if (!res.ok) return { ok: false, error: `Could not read the queue. ${String(res.error || "").slice(0, 80)}` };
    const items = (res.items || [])
      .filter((item) => item.batchKey === key)
      .map((item) => (item.id === sentId ? { ...item, status: skipped ? "skipped" : "sent" } : marked.has(item.id) ? { ...item, status: "sent" } : item))
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const counts = filterCounts(items);
    const next = nextQueued(items.filter((item) => item.id !== sentId), sentId || (active && active.item.id));
    if (!next) return { ok: true, done: true, sent: counts.sent, total: counts.all };
    const put = inject(next);
    if (!put.ok) return put;
    if (next.status !== "injected") void save(next.id, { status: "injected" });
    tellPanel({ action: "mjQueueInjected", item: next, readback: put.readback });
    return { ok: true, sent: counts.sent, total: counts.all };
  }

  function nextNote(res, sentFirst, skippedFirst = false) {
    if (!res || !res.ok) return { text: (res && res.error) || "Nothing put in the bar.", tone: "warn" };
    const tally = res.total ? ` ${res.sent}/${res.total}` : "";
    if (res.done) {
      if (sentFirst) return { text: `Sent${tally} · thread done`, tone: "sent" };
      return { text: skippedFirst ? "Skipped · nothing left in this thread" : "Nothing left to send in this thread.", tone: "warn" };
    }
    if (sentFirst) return { text: `Sent${tally} · next in bar · Enter to send`, tone: "sent" };
    if (skippedFirst) return { text: "Skipped · next in bar · Enter to send", tone: "ok" };
    return { text: `Next in bar${tally ? ` ·${tally} sent` : ""} · Enter to send`, tone: "ok" };
  }

  // After his own send: once Midjourney has emptied the bar, the thread's
  // next prompt goes in, unsent; his next Enter sends it. Off when the panel
  // switch "Next in bar after send" is off.
  async function nextAfterSend(item) {
    const stored = await readLocal([AUTO_NEXT_KEY]);
    if (stored[AUTO_NEXT_KEY] === false) return;
    const started = Date.now();
    while (Date.now() - started < SEND_CONFIRM_MS) {
      const area = findTextarea();
      if (!area) return;
      if (!space(area.value)) break;
      // He started a new prompt himself: leave the bar alone.
      if (!belongsToItem(area.value, item)) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const area = findTextarea();
    if (!area || space(area.value) || active) return;
    const res = await putNext({ batchKey: item.batchKey, sentId: item.id });
    const note = nextNote(res, true);
    showToast(note.text, note.tone);
  }

  // ⌥⇧S: skip the queued prompt in the bar (restorable in the panel) and put
  // the thread's next one in. An empty bar just gets the next one.
  async function skipKey({ repeat = false } = {}) {
    if (!sendKeyAllowed({ repeat, lastAt: lastSendKeyAt })) return { ok: false, ignored: true };
    lastSendKeyAt = Date.now();
    const area = findTextarea();
    if (!area) {
      showToast("Open Create: there is no Imagine bar here.", "warn");
      return { ok: false };
    }
    const value = area.value;
    if (!space(value)) {
      const res = await putNext({ batchKey: active ? active.item.batchKey : "" });
      const note = nextNote(res, false);
      showToast(note.text, note.tone);
      return res;
    }
    if (!active || !belongsToItem(value, active.item) || sending) {
      showToast("The bar holds a prompt that is not from the queue. Clear it to skip ahead.", "warn");
      return { ok: false };
    }
    const item = active.item;
    active.feedWatch?.();
    active = null;
    tellPanel({ action: "mjQueueSkipped", itemId: item.id });
    void save(item.id, { status: "skipped" });
    const res = await putNext({ batchKey: item.batchKey, sentId: item.id, skipped: true });
    const note = nextNote(res, false, true);
    showToast(note.text, note.tone);
    return res;
  }

  // ⌥⇧T: Test the bar prompt: a new thread with the same words once per
  // profile of the world plus once with no profile. Nothing is sent; the
  // first one goes in the bar, ⌥⇧S sends it.
  async function testKey() {
    const area = findTextarea();
    const value = area ? area.value : "";
    if (!space(value)) {
      showToast("Put a prompt in the bar first, then ⌥⇧T.", "warn");
      return;
    }
    const fromPanel = await askPanel({ action: "mjQueueTestBar", reply: true, value, itemId: active ? active.item.id : "" });
    if (fromPanel) {
      showToast(fromPanel.ok ? `Test · ${fromPanel.count} prompts · first in bar` : fromPanel.error || "Not made.", fromPanel.ok ? "ok" : "warn");
      return;
    }
    showToast("Making the test thread…");
    const dock = String((await readLocal([DOCK_WORLD_KEY]))[DOCK_WORLD_KEY] || "");
    const res = await makeVariantThread({
      kind: "test",
      item: active && belongsToItem(value, active.item) ? active.item : null,
      barValue: value,
      worldKey: dock,
      composeCommand: (entry) => compose().composeMjCommand(entry).command,
      io: {
        listMoodboards: (world) => new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: "listMoodboards", world }, (answer) => resolve(chrome.runtime.lastError ? null : answer));
          } catch {
            resolve(null);
          }
        }),
        post,
      },
    });
    if (!res.ok) {
      showToast(res.error, "warn");
      return;
    }
    try {
      chrome.storage.local.set({ [PANEL_BATCH_KEY]: res.batchKey });
    } catch {
      // storage unavailable
    }
    tellPanel({ action: "mjQueueOpenThread", batchKey: res.batchKey });
    const put = await putNext({ batchKey: res.batchKey });
    showToast(put.ok && !put.done ? `Test · ${res.count} prompts · first in bar` : `Test · ${res.count} prompts queued`);
  }

  // ── Messages from the side panel (this extension's own pages only) ──

  const onMessage = (message, sender, sendResponse) => {
    if (!extensionAlive()) return false;
    if (!message || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.action === "mjQueuePing") {
      notePanel(message.queue);
      const area = findTextarea();
      sendResponse({ ok: true, bar: Boolean(area), value: area ? area.value : "", activeId: active ? active.item.id : null, sending });
      return false;
    }
    if (message.action === "mjQueueInject") {
      sendResponse(message.item ? inject(message.item) : { ok: false, error: "No prompt." });
      return false;
    }
    if (message.action === "mjQueueSend") {
      readyForEnter(message.itemId).then(sendResponse);
      return true;
    }
    // The panel's Skip button or ⌥⇧S in the panel: the same as ⌥⇧S on the page.
    if (message.action === "mjQueueSkipNext") {
      skipKey().then(sendResponse);
      return true;
    }
    if (message.action === "mjQueueRate") {
      readRate(Boolean(message.force)).then(sendResponse);
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  cleanups.push(() => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // extension reloaded
    }
  });

  // ── "Next prompt" pill on the page ──
  // A click in the side panel keeps the keyboard in the panel, so his Enter
  // never reaches the bar. This pill sits on the Midjourney page: a click here
  // keeps the keyboard on the page, the next prompt goes in the bar with the
  // cursor at its end, and his own Enter sends it. Shown only while
  // the MJ Queue panel is open on a thread with prompts left (it pings).
  const PILL_STALE_MS = 20000;
  let pill = null;
  let pillHideTimer = null;
  function pillNode() {
    if (pill && pill.isConnected) return pill;
    pill = document.createElement("button");
    pill.type = "button";
    pill.className = "stg-mjq-pill";
    pill.hidden = true;
    // Keep focus where it is (the page), so the bar can take it after the fill.
    pill.addEventListener("mousedown", (event) => event.preventDefault());
    pill.addEventListener("click", (event) => {
      if (!event.isTrusted || sending || !extensionAlive()) return;
      pill.classList.add("stg-mjq-pill--busy");
      setTimeout(() => pill && pill.classList.remove("stg-mjq-pill--busy"), 900);
      void putNext({}).then((res) => {
        const note = nextNote(res, false);
        showToast(note.text, note.tone);
      });
    });
    document.documentElement.appendChild(pill);
    return pill;
  }
  function hidePill() {
    if (pill) pill.hidden = true;
  }
  function notePanel(queue) {
    const left = queue && Number(queue.open);
    const node = pillNode();
    if (!left || left < 1) {
      node.hidden = true;
      return;
    }
    node.textContent = "";
    const label = document.createElement("span");
    label.textContent = "Next prompt";
    const meta = document.createElement("span");
    meta.className = "stg-mjq-pill__meta";
    meta.textContent = `${left} left · then Enter`;
    node.append(label, meta);
    node.title = `${queue.thread ? queue.thread + ": " : ""}put the next prompt in the bar (⌥⇧N), then press Enter to send it`;
    node.hidden = false;
    clearTimeout(pillHideTimer);
    pillHideTimer = setTimeout(hidePill, PILL_STALE_MS);
  }
  cleanups.push(() => {
    clearTimeout(pillHideTimer);
    pill?.remove();
    hideToast();
  });

  // ── Keys on the page: ⌥⇧N next in bar · ⌥⇧S skip to next · ⌥⇧T test ──
  // On the window in the capture phase, so they work from anywhere on the
  // page, the Imagine bar included.
  listen(globalScope, "keydown", (event) => {
    if (event.key === "Escape" && toast) hideToast();
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (event.code !== "KeyN" && event.code !== "KeyS" && event.code !== "KeyT") return;
    if (!extensionAlive()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) return;
    if (event.code === "KeyN") {
      if (event.repeat) return;
      void putNext({ batchKey: active ? active.item.batchKey : "" }).then((res) => {
        const note = nextNote(res, false);
        showToast(note.text, note.tone);
      });
    } else if (event.code === "KeyS") {
      void skipKey({ repeat: event.repeat });
    } else if (!event.repeat) {
      void testKey();
    }
  }, true);

  // Midjourney is one page app: a route change takes the pill and the note away.
  let lastHref = location.href;
  const routeTimer = setInterval(() => {
    if (!extensionAlive()) {
      teardown();
      return;
    }
    if (location.href === lastHref) return;
    lastHref = location.href;
    hidePill();
    hideToast();
  }, 1000);
  cleanups.push(() => clearInterval(routeTimer));

  function teardown() {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // already gone
      }
    }
    active = null;
  }
  globalScope.__stgMjqPage = { teardown };
})(typeof globalThis !== "undefined" ? globalThis : self);
