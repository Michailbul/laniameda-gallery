// Grow. Point at any generated image on midjourney.com and press ⌥X: a card
// opens beside that picture (never on it when there is room) and the picture
// gets a coral ring, so it is clear which frame the writer sees. Pick a move
// (1–9, 0, L: new angles, close-ups, wides, cast, props, a story in six beats,
// a world kit, cinematic scenes, cinematic locations, replay of the last
// prompts, a location set) or type an idea and press Enter. The writer looks
// at the picture and the prompt that made it and writes new prompts in the
// same look; the frame's own codes and params (--sref, --profile, --ar …) are
// put back on every one by the gallery.
//
// "Use this image as" adds the picture to every result: none, a style
// reference (--sref), an image prompt at the head, or the frame for
// Midjourney's Edit model (--edit, V8.2). "Vary moodboards" swaps or adds one
// moodboard of the world per result (taste profiles stay), so the set comes
// back different. "Replay previous prompts" hands the writer the last 10
// Midjourney prompts to re-adapt in this frame's look.
//
// Every run is kept per picture (chrome.storage.local, 40 pictures): ⌥X on the
// same picture brings the card back with its runs; Recent reopens any of them.
// The card stays open while Michael works in the Imagine bar or the dock; a
// click elsewhere folds it into a small pill.
//
// Results: ↵ puts one in the Imagine bar to edit and send by hand, Q queues it,
// A queues the whole set as a new MJ Queue thread, C copies, E edits, D drops.
// Nothing is ever sent to Midjourney from here: every job stays his own Enter.

(function registerMjExpand(globalScope) {
  "use strict";

  // ── Pure helpers (tested) ──

  // `hot` is the key on the card: 1–9, 0, L. ⌃ + the key runs it steered by the typed idea.
  const MOVES = [
    { key: "angles", label: "Angles", count: 3, hot: "1", hint: "The same moment from three other camera positions." },
    { key: "close", label: "Close-ups", count: 3, hot: "2", hint: "Three close shots cut from this frame." },
    { key: "wide", label: "Wides", count: 3, hot: "3", hint: "The place: establishing wide, wide reverse, the full room or street." },
    { key: "cast", label: "Cast", count: 3, hot: "4", hint: "Three real-looking people who live in this world." },
    { key: "details", label: "Props", count: 4, hot: "5", hint: "Four objects of this world, each alone in the frame." },
    { key: "story", label: "Story", count: 6, hot: "6", hint: "A short story from this frame: six shots, ready as a thread." },
    { key: "world", label: "World kit", count: 8, hot: "7", hint: "Eight frames that turn this picture into a world." },
    { key: "scene", label: "Cinematic scene", count: 4, hot: "8", hint: "Four moments from a real film set in this world." },
    { key: "place", label: "Cinematic location", count: 4, hot: "9", hint: "Four other places of this world, each an establishing wide." },
    { key: "replay", label: "Replay", count: 10, hot: "0", hint: "Your last 10 Midjourney prompts, rewritten one by one in this frame's look." },
    { key: "location", label: "Location", count: 6, hot: "L", hint: "Six wide views of the place this frame is in: establishing, reverse, doorway, high, dusk, one small figure." },
  ];
  /** The move for a key event's code (Digit1 … Digit0, KeyL), or null. */
  function moveForCode(code) {
    const hot = /^Digit(\d)$/.exec(code || "")?.[1] || (code === "KeyL" ? "L" : "");
    return hot ? MOVES.find((move) => move.hot === hot) || null : null;
  }

  // "Use this image as" (Michael, 17 Nov 2026).
  const ATTACH = [
    { key: "none", label: "None", hint: "The picture rides on nothing: only its codes and params are kept." },
    { key: "sref", label: "Style ref", hint: "This frame as a style reference (--sref <its link>) on every prompt." },
    { key: "image", label: "Image ref", hint: "This frame's link at the start of every prompt (an image prompt)." },
    { key: "edit", label: "Edit", hint: "This frame for Midjourney's Edit model (--edit <its link>, V8.2) on every prompt: each prompt reworks the frame. Queued items carry it too." },
  ];
  const attachOf = (key) => (ATTACH.some((entry) => entry.key === key) ? key : "none");

  // Where the card sits: beside the picture; over an edge only when neither
  // side has room. `rect` is the picture, `view` the viewport, `size` the card.
  function placeBeside(rect, view, size, gap = 12, margin = 10) {
    const roomRight = view.width - rect.right - gap - margin;
    const roomLeft = rect.left - gap - margin;
    let x;
    let side;
    if (roomRight >= size.width) { x = rect.right + gap; side = "right"; }
    else if (roomLeft >= size.width) { x = rect.left - gap - size.width; side = "left"; }
    else if (roomRight >= roomLeft) { x = view.width - size.width - margin; side = "over-right"; }
    else { x = margin; side = "over-left"; }
    const y = Math.min(Math.max(margin, rect.top), Math.max(margin, view.height - size.height - margin));
    return { x: Math.round(Math.max(margin, x)), y: Math.round(y), side };
  }

  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  // The MJ Queue thread a set goes to: "<World> · <set name>".
  function threadLabel(worldName, setName, fallback) {
    const world = clean(worldName).split(/\s[—·-]\s/)[0] || "Explore";
    const set = clean(setName) || clean(fallback) || "Grown";
    return `${world} · ${set}`.slice(0, 120);
  }

  // A command split at its first flag, image links at the head taken apart.
  function splitText(text) {
    let rest = clean(text);
    const images = [];
    for (;;) {
      const match = /^(https?:\/\/\S+)\s*/.exec(rest);
      if (!match) break;
      images.push(match[1]);
      rest = rest.slice(match[0].length);
    }
    const at = rest.search(/(^|\s)--[a-z]/i);
    return { images, words: (at < 0 ? rest : rest.slice(0, at)).trim(), tail: at < 0 ? "" : rest.slice(at).trim() };
  }

  // One result as an MJ Queue item: words, codes and params apart, as agents
  // queue them. An edited result keeps its tail exactly as typed. A frame for
  // the Edit model rides in the params as "--edit <link>" (the queue's
  // composer keeps it, as for locked-frame restyles).
  function queueItemOf(made, source, key) {
    const text = clean(made.text != null ? made.text : made.prompt);
    const edited = text !== clean(made.prompt);
    const item = { ingestKey: key, title: clean(made.title).slice(0, 120) || undefined, note: source && source.note ? source.note : undefined };
    if (edited) {
      const parts = splitText(text);
      item.prompt = parts.words;
      if (parts.tail) item.params = parts.tail;
      if (parts.images.length) item.imagePrompts = parts.images.slice(0, 5).map((url) => ({ url }));
    } else {
      item.prompt = made.words;
      const params = [clean(made.rest), (made.edits || []).length ? `--edit ${made.edits.slice(0, 4).join(" ")}` : ""].filter(Boolean).join(" ");
      if (params) item.params = params;
      if (made.profiles && made.profiles.length) item.profileCodes = made.profiles.slice(0, 10);
      if (made.srefs && made.srefs.length) {
        item.styleRefs = made.srefs.slice(0, 10).map((ref) => {
          const out = ref.url ? { url: ref.url } : { code: ref.code };
          if (typeof ref.weight === "number") out.weight = ref.weight;
          return out;
        });
      }
      if (made.images && made.images.length) item.imagePrompts = made.images.slice(0, 5).map((url) => ({ url }));
    }
    if (made.change) item.note = [item.note, `Moodboard: ${made.change}`].filter(Boolean).join(" · ").slice(0, 900);
    if (source && /^https:/.test(source.imageUrl || "")) {
      item.describe = { sourceUrl: source.imageUrl, pageUrl: source.pageUrl || undefined, descriptions: [], mode: "keep" };
    }
    return item;
  }

  // "2 srefs · 1 profile · --ar 16:9 --stylize 250" for the card's code line.
  function codeLine(command) {
    const parts = splitText(command);
    const srefs = [];
    const profiles = [];
    const rest = [];
    const flags = parts.tail.split(/\s+(?=--[a-z])/i).filter(Boolean);
    for (const flag of flags) {
      const [name, ...values] = flag.replace(/^--/, "").split(/\s+/);
      const key = name.toLowerCase();
      if (key === "sref") srefs.push(...values);
      else if (key === "profile" || key === "p") profiles.push(...values.filter((code) => code.toLowerCase() !== "n9iqix8"));
      else if (key !== "seed" && key !== "iw") rest.push(`--${name}${values.length ? ` ${values.join(" ")}` : ""}`);
    }
    return { images: parts.images, words: parts.words, srefs, profiles, rest: rest.join(" ") };
  }

  // ── Vary moodboards ──
  // Each result swaps one moodboard of the world for another, or adds one when
  // the source has none of the world's moodboards. Taste profiles and codes
  // from outside the world's moodboard list stay. Results take different
  // moodboards in turn, so the set comes back different. `pool` is
  // { boards: [codes], names: {code: label} }; `withCodes` rewrites a prompt's
  // --profile flag (SaveToGalleryRandomize.withCodes).
  function varyMoodboards(items, pool, options = {}) {
    const rng = options.rng || Math.random;
    const withCodes = options.withCodes || globalScope.SaveToGalleryRandomize?.withCodes;
    const banned = globalScope.SaveToGalleryRandomize?.BANNED_CODES || new Set(["n9iqix8"]);
    const boards = [...new Set(((pool && pool.boards) || []).map(clean).filter((code) => code && !banned.has(code)))];
    const names = (pool && pool.names) || {};
    const name = (code) => names[code] || code;
    if (!boards.length || typeof withCodes !== "function") return items.map((item) => ({ ...item }));
    const offset = Math.floor(rng() * boards.length);
    return items.map((item, index) => {
      const codes = (item.profiles || []).slice();
      const present = codes.filter((code) => boards.includes(code));
      const spare = boards.filter((code) => !codes.includes(code));
      if (!spare.length) return { ...item };
      const pick = spare[(offset + index) % spare.length];
      let next;
      let change;
      if (present.length) {
        const out = present[Math.floor(rng() * present.length)];
        next = codes.map((code) => (code === out ? pick : code));
        change = `${name(out)} → ${name(pick)}`;
      } else {
        next = [pick, ...codes];
        change = `+ ${name(pick)}`;
      }
      const prompt = withCodes(item.prompt, next);
      const edited = item.text != null && clean(item.text) !== clean(item.prompt);
      return { ...item, profiles: next, prompt, text: edited ? withCodes(item.text, next) : prompt, change };
    });
  }

  // ── Previous prompts (Replay) ──
  // The last Midjourney prompts, newest first, read from Midjourney's own job
  // history (/api/imagine, the rows the queue's pace counter reads). `read`
  // turns a row into its command (SaveToGalleryMidjourney.reconstructPrompt).
  function previousPrompts(rows, read, count = 10) {
    const fallback = (row) => (row && (row.full_command || (row.prompt && row.prompt.full_command) || (typeof row.prompt === "string" ? row.prompt : ""))) || "";
    const textOf = (row) => clean((typeof read === "function" && read(row)) || fallback(row));
    const sorted = (rows || []).filter(Boolean).slice().sort((a, b) => (Date.parse(b.enqueue_time) || 0) - (Date.parse(a.enqueue_time) || 0));
    const seen = new Set();
    const out = [];
    for (const row of sorted) {
      const text = textOf(row);
      const words = splitText(text).words.toLowerCase();
      if (!words || seen.has(words)) continue;
      seen.add(words);
      out.push(text);
      if (out.length >= count) break;
    }
    return out;
  }
  // Gentle reading: reuse a read under a minute old; never read twice within 20 s.
  const HISTORY_READ = { reuseMs: 60000, gapMs: 20000 };
  function historyDecision({ cache, lastReadAt, now = Date.now() }) {
    if (cache && now - cache.at < HISTORY_READ.reuseMs) return "reuse";
    if (lastReadAt && now - lastReadAt < HISTORY_READ.gapMs) return cache ? "reuse" : "wait";
    return "read";
  }

  // What the card sends to the writer for one run.
  function runRequest({ image, source, move, idea, world, frame, system, keepImages, attach, previous, replay }) {
    const mode = attachOf(attach);
    const url = source && /^https:\/\//.test(source.srefUrl || "") ? source.srefUrl : "";
    const wantsPrevious = Boolean(replay) || (move && move.key === "replay");
    return {
      image: image && image.dataUrl,
      command: (source && source.command) || undefined,
      preset: move ? move.key : undefined,
      idea: clean(idea) || undefined,
      world: world && world !== "none" ? world : undefined,
      frame: frame || undefined,
      system: system || undefined,
      keepImages: keepImages || undefined,
      attach: mode !== "none" && url ? mode : undefined,
      attachUrl: mode !== "none" && url ? url : undefined,
      previous: wantsPrevious && previous && previous.length ? previous.slice(0, 10) : undefined,
      width: image && image.width, height: image && image.height,
    };
  }

  // ── History: every run kept per picture ──
  const HISTORY = { key: "growHistory", images: 40, runs: 8 };
  // The picture's key: its Midjourney job and index, else its link.
  const historyKey = (tile, url) => (tile && tile.jobId ? `${tile.jobId}-${tile.index ?? 0}` : clean(url));
  function slimItem(item) {
    const out = { title: item.title, words: item.words, prompt: item.prompt, rest: item.rest || "", profiles: item.profiles || [], srefs: item.srefs || [], images: item.images || [], edits: item.edits || [] };
    if (item.text != null && clean(item.text) !== clean(item.prompt)) out.text = item.text;
    if (item.queued) out.queued = true;
    if (item.change) out.change = item.change;
    return out;
  }
  const slimRun = (run) => ({ ...run, items: (run.items || []).map(slimItem) });
  /** The list with this run first under its picture (picture moved to the front); caps kept. */
  function recordRun(list, source, run) {
    const key = source && source.key;
    if (!key) return list || [];
    const rows = (list || []).filter((entry) => entry && entry.key !== key);
    const old = (list || []).find((entry) => entry && entry.key === key);
    const runs = [slimRun(run), ...((old && old.runs) || []).filter((entry) => entry.id !== run.id)].slice(0, HISTORY.runs);
    const entry = {
      key, thumb: source.rendered || (old && old.thumb) || "", imageUrl: source.imageUrl || (old && old.imageUrl) || "",
      srefUrl: source.srefUrl || (old && old.srefUrl) || "", pageUrl: source.pageUrl || (old && old.pageUrl) || "",
      command: source.command || (old && old.command) || "", tile: source.tile || (old && old.tile) || null,
      at: run.at || Date.now(), runs,
    };
    return [entry, ...rows].slice(0, HISTORY.images);
  }
  /** The list with one run of one picture changed by `fn` (queued marks, edits, drops). */
  function updateRun(list, key, runId, fn) {
    return (list || []).map((entry) => (entry.key !== key ? entry : {
      ...entry, runs: entry.runs.map((run) => (run.id === runId ? slimRun(fn(run)) : run)),
    }));
  }
  const entryOf = (list, key) => (list || []).find((entry) => entry && entry.key === key) || null;
  /** The Recent list: one row per picture, newest first. */
  function recentRows(list, count = 12) {
    return (list || []).slice(0, count).map((entry) => {
      const run = (entry.runs || [])[0] || { items: [] };
      const items = run.items || [];
      return { key: entry.key, thumb: entry.thumb || entry.imageUrl, set: run.set || run.move || "Grown", count: items.length, queued: items.filter((item) => item.queued).length, runs: (entry.runs || []).length, at: entry.at };
    });
  }
  // "Grow · 6 prompts" on the folded card.
  function pillText(count, busy) {
    if (busy) return "writing…";
    return count ? `${count} prompt${count === 1 ? "" : "s"}` : "no prompts yet";
  }
  // "2 h", "5 min", "now" for the Recent list.
  function ago(at, now = Date.now()) {
    const minutes = Math.max(0, Math.round((now - (at || now)) / 60000));
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
  }

  // The writer switch: what the button shows for a status ({mode, model, up})
  // and what one click changes it to. Haiku on this Mac, Sonnet on this Mac,
  // then the gallery's providers; without the bridge there is only the cloud.
  function writerView(status) {
    const up = Boolean(status?.up);
    const cloud = status?.mode === "cloud" || !up;
    if (cloud) {
      return {
        label: "Cloud", local: false,
        title: up ? "Writer: the gallery's providers. Click to write on this Mac instead."
          : status?.mode === "local" ? "The local writer is not running on this Mac, so nothing can be written. Click to check again."
            : "Writer: the gallery's providers (the local writer is not running on this Mac). Click to check again.",
      };
    }
    const sonnet = status?.model === "sonnet";
    return { label: sonnet ? "Sonnet · Mac" : "Haiku · Mac", local: true, title: `Writer: Claude ${sonnet ? "Sonnet" : "Haiku"} 5.5 on this Mac. Click to switch.` };
  }
  function nextWriter(status) {
    if (!status?.up) return { mode: "auto" };
    if (status.mode === "cloud") return { mode: "auto", model: "haiku" };
    return status.model === "sonnet" ? { mode: "cloud" } : { mode: "auto", model: "sonnet" };
  }

  // The world picker's first option: the world read from the frame's own
  // codes by the gallery (found = {world: {key, name}, tie: [names]}).
  function autoWorldLabel(found) {
    if (found?.world?.name) return `Auto · ${found.world.name}`;
    if (found?.tie?.length) return "Auto · two worlds fit, pick one";
    return found ? "Auto · no world in these codes" : "Auto";
  }
  // What the writer was given, for the status line: "DEAR ANNETE: rules, cast, bible".
  function briefLine(res) {
    if (res?.world) return `${String(res.world).toUpperCase()}${res.read?.length ? `: ${res.read.join(", ")}` : " rules"}`;
    if (res?.worldTie?.length) return `no world read (${res.worldTie.join(" or ")}? pick one)`;
    return "";
  }

  globalScope.SaveToGalleryExpand = {
    MOVES, ATTACH, HISTORY, HISTORY_READ, moveForCode, attachOf, placeBeside, threadLabel, splitText, queueItemOf, codeLine,
    varyMoodboards, previousPrompts, historyDecision, runRequest, historyKey, recordRun, updateRun, entryOf, recentRows, pillText, ago,
    writerView, nextWriter, autoWorldLabel, briefLine,
  };

  if (typeof document === "undefined" || typeof location === "undefined" || !/(^|\.)midjourney\.com$/i.test(location.hostname)) return;
  if (globalScope.__saveToGalleryExpand) return;
  globalScope.__saveToGalleryExpand = true;

  const adapter = () => globalScope.SaveToGalleryMidjourney;
  const STORE = {
    world: "mjExpandWorldPick", dockWorld: "stgMoodboardWorld", oldSref: "mjExpandSrefThis", qePrompts: "quickEditPrompts",
    attach: "growAttach", vary: "growVaryMoodboards", replay: "growReplayPrevious", history: HISTORY.key,
  };
  const CARD_WIDTH = 396;

  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const ask = (op, payload = {}) => new Promise((resolve) => {
    if (!alive()) { resolve({ ok: false, error: "Extension reloaded. Refresh the page." }); return; }
    try {
      chrome.runtime.sendMessage({ action: "mjExpand", op, ...payload }, (res) => {
        const error = chrome.runtime.lastError?.message;
        resolve(error ? { ok: false, error } : res || { ok: false, error: "No answer." });
      });
    } catch (err) { resolve({ ok: false, error: String(err?.message || err) }); }
  });
  const sendRaw = (message) => new Promise((resolve) => {
    if (!alive()) { resolve({ ok: false }); return; }
    try { chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res || { ok: false }); }); } catch { resolve({ ok: false }); }
  });
  const local = (keys) => new Promise((resolve) => { try { chrome.storage.local.get(keys, (v) => resolve(v || {})); } catch { resolve({}); } });
  const setLocal = (value) => { try { chrome.storage.local.set(value); } catch { /* reloaded */ } };
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // The quick edit's world notes cover Dear Annete and Andromeda worlds; every
  // world's own files (rules, learnings, cast, bible) are read by the gallery
  // when the writer runs.
  const quickEditKeyFor = (worldKey) => (/^dear-annete/.test(worldKey || "") ? "dear-annete" : /^andromeda/.test(worldKey || "") ? "andromeda-anya" : "none");
  async function systemPromptFor(worldKey) {
    const stored = await local([STORE.qePrompts]);
    const key = quickEditKeyFor(worldKey);
    const own = stored[STORE.qePrompts]?.[key];
    const d = globalScope.SaveToGalleryQuickEditDefaults;
    return d?.resolve ? d.resolve(key, own) : typeof own === "string" ? own : d?.byKey(key)?.prompt || "";
  }

  // ── The bar ──

  function findTextarea() {
    return [...document.querySelectorAll("textarea")].find((area) => /imagine/i.test(area.getAttribute("placeholder") || "")) || null;
  }
  function writeBar(text) {
    const area = findTextarea();
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
  // The Imagine bar's own box (the textarea and the buttons around it) and the
  // dock: a click there keeps the card open (Michael, 17 Nov 2026).
  const KEEP_OPEN = ".stg-mb-dock, .stg-mb-snap, .stg-pp-bar, .stg-mjq-pill, #stg-quick-edit";
  function keepsCardOpen(event) {
    const path = event.composedPath();
    if (path.some((node) => node instanceof Element && node.matches?.(KEEP_OPEN))) return true;
    const area = findTextarea();
    if (!area) return false;
    let box = area;
    for (let level = 0; level < 6 && box.parentElement; level += 1) {
      const parent = box.parentElement;
      if (parent === document.body || parent.getBoundingClientRect().height > 320) break;
      box = parent;
    }
    return path.includes(box) || path.some((node) => node instanceof Node && box.contains(node));
  }

  // ── Which picture ──

  let pointer = { x: -1, y: -1 };
  document.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { capture: true, passive: true });

  const isOurs = (el) => Boolean(el && (el === host || host.contains(el)));

  function mediaAt(x, y) {
    const mj = adapter();
    if (!mj || x < 0) return null;
    const candidates = [];
    for (const el of document.querySelectorAll("img, video")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 96 || rect.height < 96) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (!mj.isMidjourneyMediaUrl(mj.getMediaUrl(el))) continue;
      candidates.push(el);
    }
    if (candidates.length <= 1) return candidates[0] || null;
    // Several pictures under the pointer (a viewer over the grid): the one on top.
    for (const el of document.elementsFromPoint(x, y)) {
      if (isOurs(el)) continue;
      const hit = candidates.find((candidate) => el === candidate || el.contains(candidate));
      if (hit) return hit;
    }
    return candidates[0];
  }

  // On a job page with the pointer elsewhere: the page's main picture.
  function mainMedia() {
    const mj = adapter();
    if (!mj || !mj.getJobPageSelection(location.href)) return null;
    let best = null;
    for (const el of document.querySelectorAll("img")) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width < 200 || rect.height < 200 || !mj.isMidjourneyMediaUrl(mj.getMediaUrl(el))) continue;
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      if (!best || area > best.area) best = { el, area };
    }
    return best?.el || null;
  }

  // ── UI (shadow DOM; the newest extension copy's card wins) ──

  const instance = Math.random().toString(36).slice(2, 10);
  let retire = document.getElementById("stg-expand-retire");
  if (!retire) {
    retire = document.createElement("style");
    retire.id = "stg-expand-retire";
    (document.head || document.documentElement).appendChild(retire);
  }
  retire.textContent = `#stg-expand:not([data-stg-instance="${instance}"]){display:none!important}`;
  document.querySelectorAll("#stg-expand").forEach((node) => node.remove());

  const host = document.createElement("div");
  host.id = "stg-expand";
  host.dataset.stgInstance = instance;
  Object.assign(host.style, { position: "fixed", inset: "0 auto auto 0", width: "0", height: "0", zIndex: "2147483646" });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box}
    .ring{position:fixed;display:none;pointer-events:none;border-radius:6px;box-shadow:0 0 0 2px #F26157,0 0 0 5px rgba(242,97,87,.22),0 0 34px rgba(242,97,87,.35);transition:box-shadow .2s}
    .ring b{position:absolute;left:8px;top:8px;padding:4px 7px 4px 6px;border-radius:5px;background:rgba(10,8,5,.86);color:#FFF4EA;
      font:700 9px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
    .ring b i{width:6px;height:6px;border-radius:1px;background:#F26157}
    .ring.busy{animation:pulse 1.1s ease-in-out infinite}
    @keyframes pulse{50%{box-shadow:0 0 0 2px #F26157,0 0 0 9px rgba(242,97,87,.12),0 0 46px rgba(242,97,87,.5)}}
    .tag{position:fixed;display:none;align-items:center;gap:6px;height:22px;padding:0 8px 0 7px;border-radius:999px;cursor:pointer;user-select:none;
      background:#0A0805;color:#FFF4EA;border:1px solid rgba(255,244,234,.2);box-shadow:0 6px 18px rgba(0,0,0,.4);
      font:700 9.5px/1 Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase}
    .tag i{width:6px;height:6px;border-radius:1px;background:#F26157}
    .tag kbd{font:600 9px/1 "JetBrains Mono",ui-monospace,monospace;color:rgba(255,244,234,.55)}
    .card{--ink:#FFF4EA;--ink2:rgba(255,244,234,.64);--ink3:rgba(255,244,234,.4);--line:rgba(255,244,234,.13);--line2:rgba(255,244,234,.28);--coral:#F26157;
      position:fixed;display:none;flex-direction:column;width:${CARD_WIDTH}px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);border-radius:14px;
      background:#0A0805;color:var(--ink);border:1px solid rgba(255,244,234,.16);box-shadow:0 18px 54px rgba(0,0,0,.55);outline:none;overflow:hidden;
      font:500 12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;opacity:0;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease}
    .card.in{opacity:1;transform:none}
    .card *{font-family:inherit}
    .head{display:flex;gap:10px;padding:10px 10px 8px;align-items:flex-start}
    .thumb{flex:0 0 auto;width:54px;height:54px;border-radius:8px;object-fit:cover;background:#191919;border:1px solid var(--line)}
    .meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
    .top{display:flex;align-items:center;gap:6px}
    .name{flex:1 0 auto;font:800 11px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:7px}
    .name i{width:6px;height:6px;border-radius:1px;background:var(--coral)}
    select{max-width:150px;min-width:0;flex:0 1 auto;height:22px;padding:0 4px;border-radius:6px;border:1px solid var(--line);background:#191919;color:var(--ink);
      font:700 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;outline:none;cursor:pointer}
    select:focus{border-color:var(--coral)}
    .wr{flex:none;height:22px;padding:0 7px;border:1px solid var(--line);border-radius:6px;background:#191919;color:var(--ink2);cursor:pointer;font:700 8.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}
    .wr.mac{color:#79B791;border-color:rgba(121,183,145,.45)}
    .wr:hover{color:var(--ink)}
    .x{flex:none;width:22px;height:22px;border:1px solid var(--line);border-radius:6px;background:#191919;color:var(--ink2);cursor:pointer;font:600 12px/1 system-ui;padding:0}
    .src{font:400 11px/1.4 Inter,system-ui,sans-serif;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .codes{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 8px}
    .code{height:19px;padding:0 6px;border-radius:5px;border:1px solid var(--line);color:var(--ink2);display:inline-flex;align-items:center;gap:5px;max-width:100%;
      font:600 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent}
    .code.kept{color:var(--ink)}
    .code.kept::before{content:"";width:5px;height:5px;border-radius:50%;background:#79B791;flex:0 0 auto}
    button.code{cursor:pointer}
    button.code[aria-pressed="true"]{border-color:var(--coral);color:var(--coral)}
    .ask{display:flex;gap:5px;padding:0 10px}
    .idea{flex:1;min-width:0;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:#191919;color:var(--ink);
      font:500 13px/1 Inter,system-ui,sans-serif;outline:none}
    .idea:focus{border-color:var(--coral)}
    .idea::placeholder{color:var(--ink3)}
    .go{flex:0 0 auto;width:34px;height:32px;border:0;border-radius:8px;background:var(--coral);color:#0A0805;cursor:pointer;font:800 13px/1 system-ui}
    .go:disabled{opacity:.45;cursor:default}
    .moves{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px 2px}
    .move{height:26px;padding:0 8px 0 5px;border-radius:7px;border:1px solid var(--line);background:#191919;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:6px;
      font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
    .move:hover{border-color:var(--line2)}
    .move kbd{min-width:15px;height:15px;border-radius:4px;background:rgba(255,244,234,.1);color:var(--ink2);display:inline-flex;align-items:center;justify-content:center;font:700 9px/1 "JetBrains Mono",ui-monospace,monospace}
    .move em{font:600 9px/1 "JetBrains Mono",ui-monospace,monospace;font-style:normal;color:var(--ink3);letter-spacing:0}
    .move[aria-pressed="true"]{border-color:var(--coral)}
    .move[aria-pressed="true"] kbd{background:var(--coral);color:#0A0805}
    .move:disabled{opacity:.5;cursor:default}
    .line{min-height:0;padding:7px 10px 5px;display:flex;align-items:center;gap:7px;font:600 10px/1.35 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3)}
    .line:empty{padding:0 0 9px}
    .line .err{color:var(--coral)}
    .line button{background:none;border:0;padding:0;color:var(--ink);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
    .line .sp{flex:1}
    .spin{width:10px;height:10px;border:1.5px solid var(--line2);border-top-color:var(--coral);border-radius:50%;animation:s .7s linear infinite;flex:0 0 auto}
    @keyframes s{to{transform:rotate(360deg)}}
    .set{display:none;padding:2px 10px 6px;gap:3px;flex-direction:column}
    .set.show{display:flex}
    .set b{font:800 11.5px/1.25 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
    .set span{font:400 11px/1.4 Inter,system-ui,sans-serif;color:var(--ink2)}
    .list{flex:1 1 auto;min-height:0;overflow:auto;padding:0 6px 6px;display:flex;flex-direction:column;gap:3px;scrollbar-width:thin;scrollbar-color:rgba(255,244,234,.2) transparent}
    .item{position:relative;border:1px solid transparent;border-radius:10px;padding:7px 8px 7px 34px;cursor:pointer}
    .item:hover{background:rgba(255,244,234,.04)}
    .item.sel{background:#191919;border-color:var(--line2)}
    .card:focus .item.sel,.card:focus-within .item.sel{border-color:var(--coral)}
    .item .n{position:absolute;left:9px;top:8px;font:700 10px/1.3 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3)}
    .item.sel .n{color:var(--coral)}
    .item .t{font:800 10.5px/1.3 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;display:flex;gap:6px;align-items:center}
    .item .t u{text-decoration:none;padding:2px 5px;border-radius:4px;background:rgba(121,183,145,.16);color:#79B791;font:700 8.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.1em}
    .item .p{margin-top:3px;font:400 11.5px/1.45 Inter,system-ui,sans-serif;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .item.sel .p{-webkit-line-clamp:7;color:var(--ink)}
    .item .p s{text-decoration:none;color:var(--ink3);font:500 10px/1.4 "JetBrains Mono",ui-monospace,monospace}
    .item textarea{display:block;width:100%;min-height:150px;margin-top:5px;resize:vertical;padding:7px 8px;border-radius:7px;border:1px solid var(--coral);background:#0A0805;color:var(--ink);
      font:400 11.5px/1.5 "JetBrains Mono",ui-monospace,monospace;outline:none}
    .acts{display:none;gap:3px;margin-top:6px;flex-wrap:wrap}
    .item.sel .acts{display:flex}
    .acts button{height:22px;padding:0 6px 0 4px;border-radius:6px;border:1px solid var(--line2);background:transparent;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:5px;
      font:700 9.5px/1 Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase}
    .acts button kbd{min-width:14px;height:14px;padding:0 3px;border-radius:4px;background:rgba(255,244,234,.1);color:var(--ink2);display:inline-flex;align-items:center;justify-content:center;font:700 8.5px/1 "JetBrains Mono",ui-monospace,monospace}
    .acts button.main{background:var(--ink);color:#0A0805;border-color:var(--ink)}
    .acts button.main kbd{background:rgba(10,8,5,.14);color:#0A0805}
    .acts button.done{border-color:#79B791;color:#79B791}
    .foot{display:none;gap:10px;flex-wrap:wrap;padding:7px 10px 8px;border-top:1px solid var(--line);font:600 9px/1.2 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3);letter-spacing:.03em}
    .foot.show{display:flex}
    .foot b{color:var(--ink2);font-weight:700}
    .foot .all{margin-left:auto;background:none;border:0;padding:0;color:var(--ink);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
    .flash{animation:flash .5s ease}
    @keyframes flash{0%{background:rgba(242,97,87,.28)}100%{background:#191919}}
    .toast{position:fixed;display:none;left:50%;bottom:120px;transform:translateX(-50%);padding:8px 12px;border-radius:9px;background:#0A0805;color:#FFF4EA;border:1px solid rgba(255,244,234,.18);
      box-shadow:0 10px 30px rgba(0,0,0,.45);font:600 11px/1.3 Inter,system-ui,sans-serif}
  
    .opts{display:flex;flex-direction:column;gap:5px;padding:0 10px 8px}
    .opt{display:flex;align-items:center;gap:6px;min-width:0}
    .opt > b{flex:0 0 auto;font:700 8.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
    .seg{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:7px;background:#191919;flex:1;min-width:0}
    .seg button{flex:1;height:20px;border:0;border-radius:5px;background:transparent;color:var(--ink3);cursor:pointer;padding:0 4px;
      font:700 9px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .seg button:hover{color:var(--ink)}
    .seg button[aria-pressed="true"]{background:var(--ink);color:#0A0805}
    .seg button:disabled{opacity:.35;cursor:default}
    .flip{height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--ink3);cursor:pointer;display:inline-flex;align-items:center;gap:6px;
      font:700 9px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .flip::before{content:"";width:9px;height:9px;border-radius:3px;border:1px solid var(--line2);flex:0 0 auto}
    .flip[aria-pressed="true"]{color:var(--ink);border-color:var(--line2)}
    .flip[aria-pressed="true"]::before{background:#79B791;border-color:#79B791}
    .opt-note{font:500 10px/1.35 Inter,system-ui,sans-serif;color:var(--ink3)}
    .move.loc{border-color:var(--line2)}
    .runs{display:none;align-items:center;gap:6px;padding:0 10px 6px;font:600 9.5px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3)}
    .runs.show{display:flex}
    .runs button{height:20px;min-width:20px;padding:0 6px;border-radius:5px;border:1px solid var(--line);background:#191919;color:var(--ink2);cursor:pointer;font:700 9px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}
    .runs button:hover{color:var(--ink);border-color:var(--line2)}
    .runs button:disabled{opacity:.35;cursor:default}
    .runs span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .item .t u.mb{background:rgba(255,244,234,.08);color:var(--ink2);text-transform:none;letter-spacing:.02em;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .recent{display:none;flex-direction:column;gap:3px;padding:0 6px 8px;overflow:auto;min-height:0;flex:1 1 auto}
    .recent.show{display:flex}
    .recent h4{margin:2px 4px 4px;font:800 10px/1 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
    .rrow{display:flex;gap:9px;align-items:center;padding:5px;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--ink);cursor:pointer;text-align:left}
    .rrow:hover{background:#191919;border-color:var(--line)}
    .rrow img{width:40px;height:40px;border-radius:6px;object-fit:cover;background:#191919;flex:0 0 auto}
    .rrow b{display:block;font:800 10.5px/1.25 Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase}
    .rrow span{display:block;margin-top:3px;font:600 9.5px/1.2 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3)}
    .rrow.here{background:#191919;border-color:var(--line2)}
    .mini{position:fixed;right:18px;bottom:160px;display:none;align-items:center;gap:8px;height:34px;padding:0 6px 0 4px;border-radius:999px;cursor:pointer;user-select:none;
      background:#0A0805;color:#FFF4EA;border:1px solid rgba(255,244,234,.2);box-shadow:0 10px 28px rgba(0,0,0,.45);font:800 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase}
    .mini:hover{border-color:#F26157}
    .mini img{width:26px;height:26px;border-radius:50%;object-fit:cover;background:#191919}
    .mini em{font:600 9.5px/1 "JetBrains Mono",ui-monospace,monospace;font-style:normal;letter-spacing:.02em;text-transform:none;color:rgba(255,244,234,.6)}
    .mini .mx{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:rgba(255,244,234,.45);font:600 13px/1 system-ui}
    .mini .mx:hover{color:#FFF4EA;background:rgba(255,244,234,.08)}
  </style>
  <div class="ring"><b><i></i>The writer sees this</b></div>
  <div class="tag" title="Grow this frame into more prompts (⌥X)"><i></i>Grow<kbd>⌥X</kbd></div>
  <div class="mini" role="button" title="Open Grow again"><img alt=""><span>Grow</span><em></em><span class="mx" title="Close (Esc)">×</span></div>
  <div class="card" role="dialog" aria-label="Grow from this frame" tabindex="-1">
    <div class="head">
      <img class="thumb" alt="">
      <div class="meta">
        <div class="top"><span class="name"><i></i>Grow</span><select title="World: its rules steer the writer, its moodboards vary the results, and queued prompts go to its threads."></select><button class="wr" type="button"></button><button class="x" type="button" title="Close (Esc)">×</button></div>
        <div class="src"></div>
      </div>
    </div>
    <div class="codes"></div>
    <div class="opts">
      <div class="opt"><b>Use image as</b><div class="seg attach" role="group" aria-label="Use this image as"></div></div>
      <div class="opt"><button class="flip vary" type="button" title="Each result swaps or adds one moodboard of this world. Taste profiles stay.">Vary moodboards</button><button class="flip replay" type="button" title="The writer gets your last 10 Midjourney prompts and reuses their subjects and views in this frame's look.">Replay previous prompts</button></div>
      <div class="opt-note"></div>
    </div>
    <div class="ask"><input class="idea" type="text" spellcheck="false" autocomplete="off" placeholder="Say what you want next, or press 1–9, 0, L"><button class="go" type="button" title="Write it (Enter)">↵</button></div>
    <div class="moves"></div>
    <div class="line"></div>
    <div class="set"><b></b><span></span></div>
    <div class="runs"><button type="button" data-run="older" title="Older run ([)">‹</button><span></span><button type="button" data-run="newer" title="Newer run (])">›</button><button type="button" data-run="recent" title="Pictures you grew before (H)">Recent</button></div>
    <div class="recent"></div>
    <div class="list"></div>
    <div class="foot"></div>
  </div>
  <div class="toast"></div>`;

  const $ = (selector) => shadow.querySelector(selector);
  const ring = $(".ring");
  const tag = $(".tag");
  const mini = $(".mini");
  const card = $(".card");
  const thumb = $(".thumb");
  const srcEl = $(".src");
  const codesEl = $(".codes");
  const worldSelect = $("select");
  const writerButton = $(".wr");
  const attachSeg = $(".seg.attach");
  const varyButton = $(".flip.vary");
  const replayButton = $(".flip.replay");
  const optNote = $(".opt-note");
  const idea = $(".idea");
  const go = $(".go");
  const movesEl = $(".moves");
  const line = $(".line");
  const setEl = $(".set");
  const runsEl = $(".runs");
  const recentEl = $(".recent");
  const list = $(".list");
  const foot = $(".foot");
  const toast = $(".toast");

  let watcher = 0;
  const teardown = () => { clearInterval(watcher); host.remove(); };
  const mount = () => {
    if (!alive()) { teardown(); return false; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    return true;
  };

  const state = {
    open: false, folded: false, el: null, source: null, sourceReady: null, prepared: null,
    worlds: [], world: "auto", found: null, keepImages: false,
    attach: "none", vary: true, replay: false,
    busy: false, move: null, items: [], sel: 0, set: "", logline: "", editing: -1, thread: "", runId: "",
    runs: [], runAt: 0, showRecent: false, history: [],
  };

  MOVES.forEach((move) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `move${move.key === "location" ? " loc" : ""}`;
    button.dataset.key = move.key;
    button.title = `${move.hint}\n${move.hot}, or ⌃${move.hot} with an idea typed.`;
    button.innerHTML = `<kbd>${move.hot}</kbd>${esc(move.label)}<em>×${move.key === "replay" ? "10" : move.count}</em>`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => void run(move.key));
    movesEl.appendChild(button);
  });

  ATTACH.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.attach = entry.key;
    button.textContent = entry.label;
    button.title = entry.hint;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => { state.attach = entry.key; setLocal({ [STORE.attach]: entry.key }); paintOptions(); });
    attachSeg.appendChild(button);
  });
  for (const [button, key] of [[varyButton, "vary"], [replayButton, "replay"]]) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      state[key] = !state[key];
      setLocal({ [key === "vary" ? STORE.vary : STORE.replay]: state[key] });
      paintOptions();
    });
  }

  function paintOptions() {
    const canAttach = Boolean(state.source && /^https:\/\//.test(state.source.srefUrl || ""));
    attachSeg.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.attach === (canAttach ? state.attach : "none")));
      button.disabled = !canAttach && button.dataset.attach !== "none";
    });
    varyButton.setAttribute("aria-pressed", String(state.vary));
    replayButton.setAttribute("aria-pressed", String(state.replay));
    const notes = {
      none: "",
      sref: "Every prompt gets --sref with this frame.",
      image: "Every prompt starts with this frame's link.",
      edit: "Every prompt gets --edit with this frame: Midjourney's Edit model (V8.2) reworks the frame toward the words. Put in bar and Queue both carry it.",
    };
    const note = canAttach ? notes[state.attach] : "This picture has no Midjourney link to attach.";
    optNote.textContent = note;
    optNote.style.display = note ? "" : "none";
  }

  function setLine(html, kind = "") { line.innerHTML = kind === "err" ? `<span class="err">${html}</span>` : html; }

  let toastTimer = null;
  function showToast(text) {
    if (!mount()) return;
    toast.textContent = text;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2200);
  }

  // ── Layout: the card beside the picture, the ring on it ──

  let frame = 0;
  function layout() {
    if (!state.open) return;
    const el = state.el;
    const rect = el && el.isConnected ? el.getBoundingClientRect() : null;
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
    if (visible) {
      Object.assign(ring.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    } else {
      ring.style.display = "none";
    }
    const anchor = visible ? rect : { left: innerWidth, right: innerWidth, top: 70, bottom: 70 };
    const spot = placeBeside(anchor, { width: innerWidth, height: innerHeight }, { width: card.offsetWidth || CARD_WIDTH, height: card.offsetHeight || 300 });
    card.style.left = `${spot.x}px`;
    card.style.top = `${spot.y}px`;
  }
  const scheduleLayout = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  addEventListener("scroll", () => { scheduleLayout(); hideTag(); }, true);
  addEventListener("resize", scheduleLayout);

  // ── The source picture and its command ──

  function describeSource(el) {
    const mj = adapter();
    const rendered = mj.getMediaUrl(el);
    // The picture's own link names its tile; the page URL stands in on a job page.
    const tile = mj.getSaveSelection(rendered, location.href);
    const jobUrl = tile ? `https://www.midjourney.com/jobs/${tile.jobId}?index=${tile.index}` : location.href;
    return {
      key: historyKey(tile, rendered),
      rendered,
      // The full frame for the writer (webp is 3–5× lighter than the PNG).
      imageUrl: tile ? `https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.webp` : rendered,
      srefUrl: tile ? `https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.png` : (/^https:/.test(rendered) ? rendered : ""),
      pageUrl: jobUrl,
      tile,
      command: "",
    };
  }
  // A picture from the history: no element on the page, its prompt already read.
  const sourceOfEntry = (entry) => ({
    key: entry.key, rendered: entry.thumb || entry.imageUrl, imageUrl: entry.imageUrl, srefUrl: entry.srefUrl, pageUrl: entry.pageUrl,
    tile: entry.tile || null, command: entry.command || "", commandRead: true,
  });

  function readCommand(source) {
    const mj = adapter();
    if (!source.tile || !mj?.collectSaveMetadata) return Promise.resolve(source);
    return mj.collectSaveMetadata({
      imageUrl: source.imageUrl,
      pageUrl: location.href,
      lightboxRoot: document.querySelector("#lightboxPrompt"),
      readPageJob: (jobId) => new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: "readMidjourneyPageJob", jobId }, (res) => { void chrome.runtime.lastError; resolve(res || null); }); } catch { resolve(null); }
      }),
    }).then((collected) => {
      source.command = clean(collected?.promptText || "");
      return source;
    }).catch(() => source);
  }

  function paintSource() {
    const source = state.source;
    if (!source) return;
    thumb.src = source.rendered;
    paintOptions();
    if (!source.commandRead) {
      srcEl.textContent = "Reading its prompt…";
      codesEl.replaceChildren();
      return;
    }
    const parts = codeLine(source.command);
    srcEl.textContent = parts.words || "No prompt on this picture: the writer reads the look from the image.";
    srcEl.title = parts.words;
    const chips = [];
    const kept = (text, title) => { const chip = document.createElement("span"); chip.className = "code kept"; chip.textContent = text; chip.title = title; chips.push(chip); };
    if (parts.srefs.length) kept(`sref ${parts.srefs.map((code) => (/^https?:/.test(code) ? "image" : code)).join(" ")}`, "Style references: kept on every new prompt.");
    if (parts.profiles.length) kept(`profile ${parts.profiles.join(" ")}`, "Personalization and moodboard codes: kept on every new prompt (Vary moodboards swaps one moodboard).");
    if (parts.rest) kept(parts.rest, "Settings: kept on every new prompt.");
    if (!chips.length) { const none = document.createElement("span"); none.className = "code"; none.textContent = "no codes on this frame"; chips.push(none); }
    if (parts.images.length) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code";
      button.textContent = state.keepImages ? "its image prompt kept ✓" : "its image prompt left out";
      button.title = "The source used an image prompt. Left out by default: it pins the layout. Click to keep it.";
      button.setAttribute("aria-pressed", String(state.keepImages));
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => { state.keepImages = !state.keepImages; paintSource(); });
      chips.push(button);
    }
    codesEl.replaceChildren(...chips);
  }

  // ── Worlds ──

  // "Auto" reads the world from the frame's codes; a named world overrides it.
  function paintWorlds() {
    const options = [{ key: "auto", name: autoWorldLabel(state.found) }, { key: "none", name: "No world" }, ...state.worlds];
    worldSelect.replaceChildren(...options.map((world) => {
      const option = document.createElement("option");
      option.value = world.key;
      option.textContent = world.name;
      option.selected = world.key === state.world;
      return option;
    }));
    worldSelect.title = state.world === "auto"
      ? state.found?.world ? `${state.found.by === "frame" ? "This frame is saved in" : "This frame's codes point at"} ${state.found.world.name}. The writer reads its own files: ${(state.found.read || []).join(", ") || "its rule file"}.` : "The world is read from where the frame is saved, or from its codes. Pick one here to set it yourself."
      : state.world === "none" ? "No world: the writer works from the picture and its prompt only." : "The writer reads this world's own files (rules, learnings, cast, bible).";
  }
  // The world the writer will read for: the picked one, or the one found.
  const worldKey = () => (state.world === "auto" ? state.found?.world?.key || "" : state.world === "none" ? "" : state.world);
  const worldName = () => (state.world === "auto" ? state.found?.world?.name || "" : state.world === "none" ? "" : state.worlds.find((world) => world.key === state.world)?.name || "");
  let worldsLoaded = false;
  async function loadSettings() {
    const stored = await local([STORE.world, STORE.oldSref, STORE.attach, STORE.vary, STORE.replay]);
    state.world = stored[STORE.world] || "auto";
    state.attach = stored[STORE.attach] ? attachOf(stored[STORE.attach]) : stored[STORE.oldSref] === true ? "sref" : "none";
    state.vary = stored[STORE.vary] !== false;
    state.replay = stored[STORE.replay] === true;
    paintOptions();
    paintWorlds();
    if (worldsLoaded) return;
    const res = await ask("worlds");
    if (res?.ok) {
      worldsLoaded = true;
      state.worlds = res.worlds || [];
      if (state.world !== "none" && state.world !== "auto" && !state.worlds.some((world) => world.key === state.world)) state.world = "auto";
      paintWorlds();
    }
  }
  // The frame's own Midjourney link: a frame already saved in a world names it.
  const frameLink = (source) => (/^https:\/\/cdn\.midjourney\.com\//.test(source?.imageUrl || "") ? source.imageUrl : undefined);
  // Ask the gallery which world this frame belongs to (where it is saved, or
  // what its codes point at), so it is on screen before anything is written.
  async function findWorld(source) {
    state.found = null;
    paintWorlds();
    const frame = frameLink(source);
    if (!source?.command && !frame) return;
    const res = await ask("worldOf", { command: source.command || "", frame });
    if (state.source !== source) return;
    state.found = res?.ok ? { world: res.world || null, tie: res.tie || [], read: res.read || [], by: res.by } : null;
    paintWorlds();
  }
  // Where the writer runs: on this Mac (Haiku 5.5 or Sonnet 5.5 through the
  // local bridge) or through the gallery's providers. Click to switch.
  const paintWriter = (status) => {
    const view = writerView(status);
    writerButton.textContent = view.label;
    writerButton.title = view.title;
    writerButton.classList.toggle("mac", view.local);
    state.writer = status;
  };
  paintWriter({ mode: "auto", model: "haiku", up: false });
  async function loadWriter(fresh = false) {
    const res = await ask("writer", { fresh });
    if (res?.ok) paintWriter(res);
  }
  writerButton.addEventListener("click", async () => {
    const next = nextWriter(state.writer);
    const res = await ask("writer", { do: "set", ...next, fresh: true });
    if (res?.ok) paintWriter(res);
  });
  worldSelect.addEventListener("change", () => {
    state.world = worldSelect.value;
    setLocal({ [STORE.world]: state.world });
    idea.focus();
  });

  // The world's moodboards for Vary moodboards (the dock's own list), kept 5 minutes.
  const boardCache = new Map();
  async function moodboardPool(key) {
    if (!key) return null;
    const hit = boardCache.get(key);
    if (hit && Date.now() - hit.at < 300000) return hit.pool;
    const res = await sendRaw({ action: "listMoodboards", world: key });
    if (!res || res.ok === false || !Array.isArray(res.moodboards)) return null;
    const names = {};
    const boards = [];
    for (const board of res.moodboards) {
      const code = clean(board.mjCode);
      if (!code || boards.includes(code)) continue;
      boards.push(code);
      names[code] = board.shortName || board.name || code;
    }
    const pool = { boards, names };
    boardCache.set(key, { at: Date.now(), pool });
    return pool;
  }

  // ── Previous prompts: Midjourney's own history, read gently ──
  // Shares the last read with the queue's pace counter when it leaves one in
  // globalThis.__stgMjHistory ({at, rows}); never reads twice within 20 s.
  let ownHistory = null;
  let lastHistoryRead = 0;
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
  async function readPrevious() {
    const shared = globalScope.__stgMjHistory && Array.isArray(globalScope.__stgMjHistory.rows) ? globalScope.__stgMjHistory : null;
    const cache = [ownHistory, shared].filter(Boolean).sort((a, b) => b.at - a.at)[0] || null;
    const decision = historyDecision({ cache, lastReadAt: lastHistoryRead });
    const read = (row) => adapter()?.reconstructPrompt?.(row) || "";
    if (decision === "reuse") return { ok: true, prompts: previousPrompts(cache.rows, read) };
    if (decision === "wait") return { ok: false, error: "Midjourney's history was read a moment ago. Try again in a few seconds." };
    const user = midjourneyUserId();
    if (!user) return { ok: false, error: "Sign in to Midjourney to read your last prompts." };
    lastHistoryRead = Date.now();
    try {
      const response = await fetch(`https://www.midjourney.com/api/imagine?user_id=${user}&page_size=100`, { credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" } });
      const data = await response.json();
      const rows = Array.isArray(data) ? data : data && data.data;
      if (!Array.isArray(rows)) return { ok: false, error: "Midjourney did not answer the history." };
      ownHistory = { at: Date.now(), rows };
      if (!shared || shared.at < ownHistory.at) globalScope.__stgMjHistory = ownHistory;
      return { ok: true, prompts: previousPrompts(rows, read) };
    } catch (err) {
      return { ok: false, error: `Could not read your last prompts: ${err?.message || err}` };
    }
  }

  // ── History of runs (chrome.storage.local) ──

  async function loadHistory() {
    const stored = await local([STORE.history]);
    state.history = Array.isArray(stored[STORE.history]) ? stored[STORE.history] : [];
    return state.history;
  }
  let saveTimer = null;
  function saveHistory() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setLocal({ [STORE.history]: state.history }), 150);
  }
  // The open run back into the history (queued marks, edits, drops).
  function keepRun() {
    if (!state.source || !state.runId) return;
    state.history = updateRun(state.history, state.source.key, state.runId, (run) => ({ ...run, items: state.items, set: state.set, logline: state.logline, thread: state.thread }));
    state.runs = entryOf(state.history, state.source.key)?.runs || state.runs;
    saveHistory();
  }
  function showRun(run) {
    if (!run) {
      Object.assign(state, { items: [], sel: 0, set: "", logline: "", move: null, thread: "", runId: "", runAt: 0 });
      return;
    }
    Object.assign(state, {
      items: (run.items || []).map((item) => ({ ...item, text: item.text != null ? item.text : item.prompt })),
      sel: 0, editing: -1, set: run.set || "", logline: run.logline || "", move: run.move || null, thread: run.thread || "", runId: run.id, runAt: run.at || 0,
    });
  }
  function stepRun(delta) {
    if (!state.runs.length) return;
    const at = Math.max(0, state.runs.findIndex((run) => run.id === state.runId));
    const next = state.runs[Math.min(state.runs.length - 1, Math.max(0, at + delta))];
    if (!next || next.id === state.runId) return;
    showRun(next);
    renderResults();
  }

  // ── Open / fold / close ──

  function present() {
    if (!mount()) return;
    state.open = true;
    state.folded = false;
    tag.style.display = "none";
    mini.style.display = "none";
    card.style.display = "flex";
    requestAnimationFrame(() => card.classList.add("in"));
    paintSource();
    paintMoves();
    renderResults();
    void loadSettings();
    void loadWriter(true);
    layout();
    idea.focus();
  }

  async function adopt(source, el) {
    state.el = el || null;
    if (state.source && state.source.key === source.key) return;
    state.source = source;
    state.prepared = null;
    state.editing = -1;
    state.showRecent = false;
    const entry = entryOf(await loadHistory(), source.key);
    if (state.source !== source) return;
    state.runs = entry?.runs || [];
    showRun(state.runs[0]);
    if (!source.command && entry?.command) source.command = entry.command;
    state.sourceReady = source.commandRead ? Promise.resolve(source) : readCommand(source).then((ready) => {
      ready.commandRead = true;
      if (state.source === ready) { paintSource(); scheduleLayout(); void findWorld(ready); }
      return ready;
    });
    if (source.commandRead) void findWorld(source);
    setLine(state.runs.length ? `<span>${state.runs.length} earlier run${state.runs.length > 1 ? "s" : ""} on this picture</span>` : "");
    idea.value = "";
    idea.placeholder = state.items.length ? "Steer it again, or ↓ to pick" : "Say what you want next, or press 1–9, 0, L";
  }

  async function open(el) {
    const mj = adapter();
    if (!mj) return;
    const target = el || mediaAt(pointer.x, pointer.y) || mainMedia();
    if (!target) {
      if (state.source) { present(); return; }
      showToast("Point at a picture, then ⌥X");
      return;
    }
    await adopt(describeSource(target), target);
    present();
  }

  // From the Recent list or the side panel: a picture grown before.
  async function openKey(key) {
    const entry = entryOf(await loadHistory(), key);
    if (!entry) { showToast("That picture is not in Grow's history any more."); return false; }
    const onPage = [...document.querySelectorAll("img")].find((img) => adapter() && historyKey(adapter().getSaveSelection(adapter().getMediaUrl(img), location.href), adapter().getMediaUrl(img)) === key) || null;
    if (state.source?.key !== key) state.source = null;
    await adopt(sourceOfEntry(entry), onPage);
    present();
    return true;
  }

  // A click elsewhere on the page folds the card into a pill; its runs are kept.
  function fold() {
    if (!state.open) return;
    if (!state.items.length && !state.busy) { close(); return; }
    state.open = false;
    state.folded = true;
    card.classList.remove("in");
    card.style.display = "none";
    ring.style.display = "none";
    paintMini();
  }
  function paintMini() {
    if (!state.folded || !state.source) { mini.style.display = "none"; return; }
    if (!mount()) return;
    mini.querySelector("img").src = state.source.rendered || "";
    mini.querySelector("em").textContent = pillText(state.items.length, state.busy);
    mini.style.display = "flex";
  }
  function close() {
    if (state.source && state.runId) keepRun();
    state.open = false;
    state.folded = false;
    state.showRecent = false;
    card.classList.remove("in");
    card.style.display = "none";
    ring.style.display = "none";
    mini.style.display = "none";
  }
  mini.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  mini.addEventListener("click", (event) => {
    if (event.target?.classList?.contains("mx")) { close(); return; }
    present();
  });

  // ── Run ──

  function paintMoves() {
    movesEl.querySelectorAll(".move").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.key === state.move));
      button.disabled = state.busy;
    });
    go.disabled = state.busy;
    ring.classList.toggle("busy", state.busy);
    paintMini();
  }

  async function run(moveKey) {
    if (state.busy || !state.source) return;
    const steer = idea.value.trim();
    if (!moveKey && !steer) { setLine("Pick a move (1–9, 0, L) or type an idea."); idea.focus(); return; }
    const move = MOVES.find((entry) => entry.key === moveKey) || null;
    const source = state.source;
    const settings = { attach: state.attach, vary: state.vary, replay: state.replay, world: state.world };
    state.busy = true;
    state.move = move?.key || null;
    state.showRecent = false;
    paintMoves();
    setLine(`<span class="spin"></span><span>Looking at the picture…</span>`);
    try {
      await state.sourceReady;
      let previous;
      if (settings.replay || move?.key === "replay") {
        setLine(`<span class="spin"></span><span>Reading your last prompts…</span>`);
        const read = await readPrevious();
        if (!read.ok) throw new Error(read.error);
        if (!read.prompts.length && move?.key === "replay") throw new Error("No earlier prompts in your Midjourney history.");
        previous = read.prompts;
      }
      if (!state.prepared) {
        let image = await ask("prepare", { imageUrl: source.imageUrl });
        if (!image?.ok && source.rendered !== source.imageUrl) image = await ask("prepare", { imageUrl: source.rendered });
        if (!image?.ok) throw new Error(image?.error || "Could not read the picture.");
        if (state.source !== source) return;
        state.prepared = image;
      }
      const count = move?.key === "replay" ? (previous || []).length : move?.count;
      setLine(`<span class="spin"></span><span>Writing ${move ? `${move.label.toLowerCase()} ×${count}` : "your idea"}…</span>`);
      const res = await ask("run", runRequest({
        image: state.prepared, source, move, idea: steer, world: settings.world, frame: frameLink(source),
        system: worldKey() ? await systemPromptFor(worldKey()) : undefined,
        keepImages: state.keepImages, attach: settings.attach, previous, replay: settings.replay,
      }));
      if (state.source !== source) return;
      if (!res?.ok) throw new Error(res?.error || "Could not write the prompts.");
      if (settings.world === "auto" && res.worldKey) { state.found = { world: { key: res.worldKey, name: res.world }, tie: [], read: res.read || [], by: res.worldBy }; paintWorlds(); }
      let items = (res.items || []).map((item) => ({ ...item, text: item.prompt, queued: false }));
      let varied = "";
      if (settings.vary && items.length) {
        const pool = await moodboardPool(res.worldKey || worldKey());
        if (pool?.boards?.length) {
          items = varyMoodboards(items, pool);
          varied = items.some((item) => item.change) ? " · moodboards varied" : "";
        } else {
          varied = " · no moodboards in this world to vary";
        }
      }
      const runId = Date.now().toString(36);
      const set = res.set || move?.label || "";
      const thread = threadLabel(res.world || worldName(), set, steer.split(/\s+/).slice(0, 5).join(" "));
      const record = { id: runId, at: Date.now(), move: move?.key || null, idea: steer, ...settings, set, logline: res.logline || "", thread, items };
      state.history = recordRun(await loadHistory(), source, record);
      saveHistory();
      state.runs = entryOf(state.history, source.key)?.runs || [record];
      showRun(state.runs[0]);
      renderResults();
      const brief = briefLine(res);
      setLine(`<span>${esc(res.model)} · ${(res.ms / 1000).toFixed(1)}s${brief ? ` · ${esc(brief)}` : ""}${previous?.length ? ` · ${previous.length} earlier prompts` : ""}${esc(varied)}${res.notes?.length ? ` · ${esc(res.notes[0])}` : ""}</span>`);
      idea.value = "";
      idea.placeholder = "Steer it again, or ↓ to pick";
      if (state.open) card.focus();
    } catch (err) {
      setLine(esc(err?.message || err), "err");
    } finally {
      state.busy = false;
      paintMoves();
      scheduleLayout();
    }
  }

  // ── Results ──

  function paintRuns() {
    const at = state.runs.findIndex((run) => run.id === state.runId);
    const show = state.runs.length > 0 || state.history.length > 1;
    runsEl.classList.toggle("show", show);
    if (!show) return;
    const run = state.runs[at];
    const label = run ? `Run ${state.runs.length - at} of ${state.runs.length} · ${MOVES.find((move) => move.key === run.move)?.label || (run.idea ? "Idea" : "Run")} · ${ago(run.at)}` : "No runs on this picture yet";
    runsEl.querySelector("span").textContent = label;
    runsEl.querySelector("span").title = run?.idea ? `Idea: ${run.idea}` : "";
    runsEl.querySelector('[data-run="older"]').disabled = at < 0 || at >= state.runs.length - 1;
    runsEl.querySelector('[data-run="newer"]').disabled = at <= 0;
    runsEl.querySelector('[data-run="recent"]').setAttribute("aria-pressed", String(state.showRecent));
  }
  runsEl.addEventListener("mousedown", (event) => event.preventDefault());
  runsEl.addEventListener("click", (event) => {
    const act = event.target?.dataset?.run;
    if (act === "older") stepRun(1);
    if (act === "newer") stepRun(-1);
    if (act === "recent") { state.showRecent = !state.showRecent; renderResults(); }
  });

  function renderRecent() {
    const rows = recentRows(state.history, 12);
    recentEl.replaceChildren();
    const head = document.createElement("h4");
    head.textContent = rows.length ? "Recent pictures" : "Nothing grown yet";
    recentEl.appendChild(head);
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rrow${row.key === state.source?.key ? " here" : ""}`;
      button.innerHTML = `<img alt="" src="${esc(row.thumb)}"><div><b>${esc(row.set)}</b><span>${row.count} prompt${row.count === 1 ? "" : "s"}${row.queued ? ` · ${row.queued} queued` : ""} · ${row.runs} run${row.runs === 1 ? "" : "s"} · ${esc(ago(row.at))}</span></div>`;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => { state.showRecent = false; void openKey(row.key); });
      recentEl.appendChild(button);
    }
  }

  function renderResults() {
    paintRuns();
    recentEl.classList.toggle("show", state.showRecent);
    if (state.showRecent) {
      renderRecent();
      list.style.display = "none";
      setEl.classList.remove("show");
      foot.classList.remove("show");
      scheduleLayout();
      return;
    }
    list.style.display = "";
    const has = state.items.length > 0;
    setEl.classList.toggle("show", has && Boolean(state.set || state.logline));
    setEl.querySelector("b").textContent = state.set || "";
    setEl.querySelector("span").textContent = state.logline || "";
    setEl.querySelector("span").style.display = state.logline ? "" : "none";
    list.replaceChildren(...state.items.map((item, index) => {
      const row = document.createElement("div");
      row.className = `item${index === state.sel ? " sel" : ""}`;
      row.dataset.index = String(index);
      const parts = splitText(item.text);
      const editing = state.editing === index;
      row.innerHTML = `<span class="n">${String(index + 1).padStart(2, "0")}</span>
        <div class="t"><span>${esc(item.title)}</span>${item.queued ? "<u>Queued</u>" : ""}${clean(item.text) !== clean(item.prompt) ? "<u>Edited</u>" : ""}${item.change ? `<u class="mb" title="Moodboard change on this prompt">${esc(item.change)}</u>` : ""}</div>
        ${editing ? "" : `<div class="p">${esc(parts.words)}${index === state.sel && parts.tail ? ` <s>${esc(parts.tail)}</s>` : ""}</div>`}`;
      if (editing) {
        const area = document.createElement("textarea");
        area.className = "ed";
        area.value = item.text;
        area.spellcheck = false;
        area.addEventListener("input", () => { item.text = area.value; });
        area.addEventListener("blur", keepRun);
        row.appendChild(area);
        requestAnimationFrame(() => { area.focus(); area.setSelectionRange(parts.words.length, parts.words.length); });
      }
      const acts = document.createElement("div");
      acts.className = "acts";
      const act = (label, key, fn, cls = "") => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = cls;
        button.innerHTML = `<kbd>${key}</kbd>${label}`;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => { event.stopPropagation(); state.sel = index; void fn(); });
        acts.appendChild(button);
      };
      act("Bar", "↵", toBar, "main");
      act(item.queued ? "Queued" : "Queue", "Q", queueOne, item.queued ? "done" : "");
      act("Copy", "C", copyOne);
      act(editing ? "Done" : "Edit", editing ? "Esc" : "E", editing ? stopEdit : startEdit);
      act("Drop", "D", dropOne);
      row.appendChild(acts);
      row.addEventListener("click", (event) => {
        if (event.target.closest("textarea, button")) return;
        if (state.sel !== index) { state.sel = index; state.editing = -1; renderResults(); }
        card.focus();
      });
      return row;
    }));
    foot.classList.toggle("show", has);
    if (has) {
      const left = state.items.filter((item) => !item.queued).length;
      foot.innerHTML = `<span><b>↑↓</b> pick</span><span><b>↵</b> in bar</span><span><b>Q</b> queue</span><span><b>R</b> again</span><span><b>[ ]</b> runs</span><span><b>H</b> recent</span>
        <button class="all" type="button" title="Queue every prompt not yet queued as one MJ Queue thread: ${esc(state.thread)}">${left ? `<b>A</b> queue all ${left} → thread` : "all queued ✓"}</button>`;
      foot.querySelector(".all").addEventListener("click", () => void queueAll());
    }
    const selected = list.querySelector(".item.sel");
    if (selected) selected.scrollIntoView({ block: "nearest" });
    paintMini();
    scheduleLayout();
  }

  const current = () => state.items[state.sel] || null;
  function move(delta) {
    if (!state.items.length) return;
    state.sel = Math.min(state.items.length - 1, Math.max(0, state.sel + delta));
    state.editing = -1;
    renderResults();
  }
  function flash() { list.querySelector(".item.sel")?.classList.add("flash"); }

  // In the bar, never sent. The card stays: Michael edits in the bar and comes back.
  async function toBar() {
    const item = current();
    if (!item) return;
    const done = writeBar(clean(item.text));
    if (!done.ok) { setLine(esc(done.error), "err"); return; }
    setLine(`<span>In the bar: ${esc(item.title)}. Edit it, then Enter.</span>`);
    flash();
  }

  function sourceNote() {
    return `Grown from a frame${state.move ? ` (${MOVES.find((entry) => entry.key === state.move)?.label || state.move})` : ""}${state.logline ? `. ${state.logline}` : ""}`.slice(0, 900);
  }

  async function queueItems(indexes) {
    const source = state.source;
    const picked = indexes.filter((index) => state.items[index] && !state.items[index].queued);
    if (!picked.length) return;
    const items = picked.map((index) => queueItemOf(state.items[index], { imageUrl: source.srefUrl || source.imageUrl, pageUrl: source.pageUrl, note: sourceNote() }, `grow:${source.key}:${state.runId}:${index}`));
    setLine(`<span class="spin"></span><span>Queueing ${picked.length}…</span>`);
    const res = await ask("queue", { batch: state.thread, world: worldKey() || undefined, items });
    if (!res?.ok) { setLine(esc(res?.error || "Could not queue."), "err"); return; }
    for (const index of picked) state.items[index].queued = true;
    keepRun();
    renderResults();
    flash();
    setLine(`<span>${picked.length} in thread “${esc(state.thread)}”</span><span class="sp"></span><button type="button" data-act="queue">Open queue</button>`);
  }
  const queueOne = () => queueItems([state.sel]);
  const queueAll = () => queueItems(state.items.map((_, index) => index));

  async function copyOne() {
    const item = current();
    if (!item) return;
    try { await navigator.clipboard.writeText(clean(item.text)); setLine(`Copied: ${esc(item.title)}`); flash(); }
    catch { setLine("The clipboard refused.", "err"); }
  }
  function startEdit() { if (!current()) return; state.editing = state.sel; renderResults(); }
  function stopEdit() { state.editing = -1; keepRun(); renderResults(); card.focus(); }
  function dropOne() {
    if (!current()) return;
    state.items.splice(state.sel, 1);
    state.sel = Math.min(state.sel, Math.max(0, state.items.length - 1));
    state.editing = -1;
    keepRun();
    renderResults();
    if (!state.items.length) idea.focus();
  }

  line.addEventListener("click", (event) => {
    if (event.target?.dataset?.act === "queue") void ask("openQueue");
  });
  go.addEventListener("click", () => void run(null));
  $(".x").addEventListener("click", close);

  // ── Keys ──
  // One listener at the window, capture phase: Midjourney's own shortcuts
  // (arrows, letters) must not fire while the card has the keyboard.

  const plain = (event) => !event.metaKey && !event.ctrlKey && !event.altKey;

  function onCardKey(event) {
    const active = shadow.activeElement;
    const inIdea = active === idea;
    const inEdit = Boolean(active && active.classList?.contains("ed"));
    const inSelect = active === worldSelect;
    const hot = moveForCode(event.code);

    if (event.key === "Escape") {
      event.preventDefault();
      if (inEdit) stopEdit();
      else if (state.showRecent) { state.showRecent = false; renderResults(); }
      else close();
      return;
    }
    if (hot && event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); void run(hot.key); return; }
    if (inSelect) return;
    if (inEdit) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); state.editing = -1; keepRun(); void toBar(); }
      return;
    }
    if (inIdea) {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        if (idea.value.trim()) void run(null);
        else if (state.items.length) void toBar();
        return;
      }
      // Digits run a move from an empty idea; L only from the list (it starts words).
      if (hot && hot.hot !== "L" && plain(event) && !event.shiftKey && !idea.value) { event.preventDefault(); void run(hot.key); return; }
      if (event.key === "ArrowDown" && state.items.length) { event.preventDefault(); card.focus(); return; }
      return;
    }
    // The list has the keyboard.
    if (!plain(event)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const handlers = {
      ArrowDown: () => move(1), j: () => move(1),
      ArrowUp: () => { if (state.sel === 0) idea.focus(); else move(-1); }, k: () => move(-1),
      Enter: () => void toBar(),
      q: () => void queueOne(),
      a: () => void queueAll(),
      c: () => void copyOne(),
      e: () => startEdit(),
      d: () => dropOne(), Backspace: () => dropOne(),
      r: () => void run(state.move),
      "[": () => stepRun(1), "]": () => stepRun(-1),
      h: () => { state.showRecent = !state.showRecent; renderResults(); },
      "/": () => idea.focus(), i: () => idea.focus(), Tab: () => idea.focus(),
    };
    if (hot && !event.shiftKey) { event.preventDefault(); void run(hot.key); return; }
    const handler = handlers[key];
    if (handler) { event.preventDefault(); handler(); }
  }

  let altTimer = null;
  function showTag() {
    if (state.open) return;
    const el = mediaAt(pointer.x, pointer.y);
    if (!el || !mount()) return;
    const rect = el.getBoundingClientRect();
    tag.style.display = "flex";
    tag.style.left = `${Math.max(8, rect.left + 8)}px`;
    tag.style.top = `${Math.max(8, rect.bottom - 30)}px`;
    tag.__el = el;
  }
  function hideTag() { clearTimeout(altTimer); tag.style.display = "none"; }
  tag.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  tag.addEventListener("click", () => { const el = tag.__el; hideTag(); void open(el && el.isConnected ? el : null); });

  window.addEventListener("keydown", (event) => {
    if (!alive()) { teardown(); return; }
    // ⌥X on the picture under the pointer: open (with its earlier runs), or close when it is open.
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyX") {
      event.preventDefault();
      event.stopPropagation();
      hideTag();
      const under = mediaAt(pointer.x, pointer.y);
      const other = under && state.source && describeSource(under).key !== state.source.key;
      if (state.open && !other) close();
      else if (state.folded && !under) present();
      else void open(under);
      return;
    }
    // Holding ⌥ over a picture shows where Grow is (a click works too).
    if (event.key === "Alt" && !state.open && !event.repeat) { clearTimeout(altTimer); altTimer = setTimeout(showTag, 350); return; }
    if (event.key === "Escape" && tag.style.display !== "none") hideTag();
    if (!state.open) {
      // Esc outside any field puts the folded pill away too.
      if (state.folded && event.key === "Escape" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) close();
      return;
    }
    if (!event.composedPath().includes(host)) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    event.stopPropagation();
    onCardKey(event);
  }, true);
  for (const type of ["keyup", "keypress"]) {
    window.addEventListener(type, (event) => {
      if (type === "keyup" && event.key === "Alt") hideTag();
      if (state.open && event.composedPath().includes(host)) event.stopPropagation();
    }, true);
  }
  addEventListener("blur", hideTag);

  // A click in the Imagine bar or the dock keeps the card; anywhere else folds it.
  document.addEventListener("mousedown", (event) => {
    if (!state.open || event.composedPath().includes(host)) return;
    if (keepsCardOpen(event)) return;
    fold();
  }, true);

  // Midjourney is one page: a new address folds the card (its runs stay),
  // and a reloaded extension takes its nodes with it.
  let lastHref = location.href;
  watcher = setInterval(() => {
    if (!alive()) { teardown(); return; }
    if (location.href === lastHref) return;
    lastHref = location.href;
    hideTag();
    if (state.open) fold();
  }, 600);

  // The side panel's Recent list opens a picture here.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || sender.id !== chrome.runtime.id || sender.tab) return false;
      if (message.action === "grow:open" && message.key) { void openKey(String(message.key)).then((ok) => sendResponse({ ok })); return true; }
      return false;
    });
  } catch { /* extension reloaded */ }

  globalScope.SaveToGalleryExpand.open = open;
  globalScope.SaveToGalleryExpand.close = close;
  globalScope.SaveToGalleryExpand.openKey = openKey;
})(typeof globalThis !== "undefined" ? globalThis : self);
