// Grow. Point at any generated image on midjourney.com and press ⌥X: a card
// opens beside that picture (never on it when there is room) and the picture
// gets a coral ring, so it is clear which frame the writer sees. Pick a move
// (1–7: new angles, close-ups, wides, cast, props, a story in six beats, a
// world kit) or type an idea and press Enter. The gallery's writer (Haiku 5.5)
// looks at the picture and the prompt that made it and writes new prompts in
// the same look; the frame's own codes and params (--sref, --profile, --ar …)
// are put back on every one, unchanged.
//
// Results: ↵ puts one in the Imagine bar to edit and send by hand, Q queues it,
// A queues the whole set as a new MJ Queue thread, C copies, E edits, D drops.
// Nothing is ever sent to Midjourney from here: every job stays his own Enter.

(function registerMjExpand(globalScope) {
  "use strict";

  // ── Pure helpers (tested) ──

  const MOVES = [
    { key: "angles", label: "Angles", count: 3, hint: "The same moment from three other camera positions." },
    { key: "close", label: "Close-ups", count: 3, hint: "Three close shots cut from this frame." },
    { key: "wide", label: "Wides", count: 3, hint: "The place: establishing wide, wide reverse, the full room or street." },
    { key: "cast", label: "Cast", count: 3, hint: "Three people or creatures who live in this world." },
    { key: "details", label: "Props", count: 4, hint: "Four objects of this world, each alone in the frame." },
    { key: "story", label: "Story", count: 6, hint: "A short story from this frame: six shots, ready as a thread." },
    { key: "world", label: "World kit", count: 8, hint: "Eight frames that turn this picture into a world." },
  ];

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
  // queue them. An edited result keeps its tail exactly as typed.
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
      if (made.rest) item.params = made.rest;
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
      else if (key === "profile" || key === "p") profiles.push(...values);
      else if (key !== "seed" && key !== "iw") rest.push(`--${name}${values.length ? ` ${values.join(" ")}` : ""}`);
    }
    return { images: parts.images, words: parts.words, srefs, profiles, rest: rest.join(" ") };
  }

  globalScope.SaveToGalleryExpand = { MOVES, placeBeside, threadLabel, splitText, queueItemOf, codeLine };

  if (typeof document === "undefined" || typeof location === "undefined" || !/(^|\.)midjourney\.com$/i.test(location.hostname)) return;
  if (globalScope.__saveToGalleryExpand) return;
  globalScope.__saveToGalleryExpand = true;

  const adapter = () => globalScope.SaveToGalleryMidjourney;
  const STORE = { world: "mjExpandWorld", dockWorld: "stgMoodboardWorld", sref: "mjExpandSrefThis", qePrompts: "quickEditPrompts" };
  const CARD_WIDTH = 384;

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
  const local = (keys) => new Promise((resolve) => { try { chrome.storage.local.get(keys, (v) => resolve(v || {})); } catch { resolve({}); } });
  const setLocal = (value) => { try { chrome.storage.local.set(value); } catch { /* reloaded */ } };
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // The quick edit's world notes cover Dear Annete and Andromeda worlds; every
  // world's own WORLD.md is read by the gallery when the writer runs.
  const quickEditKeyFor = (worldKey) => (/^dear-annete/.test(worldKey || "") ? "dear-annete" : /^andromeda/.test(worldKey || "") ? "andromeda-anya" : "none");
  async function systemPromptFor(worldKey) {
    const stored = await local([STORE.qePrompts]);
    const key = quickEditKeyFor(worldKey);
    const own = stored[STORE.qePrompts]?.[key];
    return typeof own === "string" ? own : globalScope.SaveToGalleryQuickEditDefaults?.byKey(key)?.prompt || "";
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
    .name{flex:1;font:800 11px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:7px}
    .name i{width:6px;height:6px;border-radius:1px;background:var(--coral)}
    select{max-width:150px;height:22px;padding:0 4px;border-radius:6px;border:1px solid var(--line);background:#191919;color:var(--ink);
      font:700 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;outline:none;cursor:pointer}
    select:focus{border-color:var(--coral)}
    .x{width:22px;height:22px;border:1px solid var(--line);border-radius:6px;background:#191919;color:var(--ink2);cursor:pointer;font:600 12px/1 system-ui;padding:0}
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
  </style>
  <div class="ring"><b><i></i>The writer sees this</b></div>
  <div class="tag" title="Grow this frame into more prompts (⌥X)"><i></i>Grow<kbd>⌥X</kbd></div>
  <div class="card" role="dialog" aria-label="Grow from this frame" tabindex="-1">
    <div class="head">
      <img class="thumb" alt="">
      <div class="meta">
        <div class="top"><span class="name"><i></i>Grow</span><select title="World: its rules steer the writer, and queued prompts go to its threads."></select><button class="x" type="button" title="Close (Esc)">×</button></div>
        <div class="src"></div>
      </div>
    </div>
    <div class="codes"></div>
    <div class="ask"><input class="idea" type="text" spellcheck="false" autocomplete="off" placeholder="Say what you want next, or press 1–7"><button class="go" type="button" title="Write it (Enter)">↵</button></div>
    <div class="moves"></div>
    <div class="line"></div>
    <div class="set"><b></b><span></span></div>
    <div class="list"></div>
    <div class="foot"></div>
  </div>
  <div class="toast"></div>`;

  const $ = (selector) => shadow.querySelector(selector);
  const ring = $(".ring");
  const tag = $(".tag");
  const card = $(".card");
  const thumb = $(".thumb");
  const srcEl = $(".src");
  const codesEl = $(".codes");
  const worldSelect = $("select");
  const idea = $(".idea");
  const go = $(".go");
  const movesEl = $(".moves");
  const line = $(".line");
  const setEl = $(".set");
  const list = $(".list");
  const foot = $(".foot");
  const toast = $(".toast");

  const mount = () => {
    if (!alive()) { host.remove(); return false; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    return true;
  };

  const state = {
    open: false, el: null, source: null, sourceReady: null, prepared: null,
    worlds: [], world: "none", srefThis: false, keepImages: false,
    busy: false, move: null, items: [], sel: 0, set: "", logline: "", editing: -1, thread: "", runId: "",
  };
  const cache = new Map(); // picture key → last results

  MOVES.forEach((move, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move";
    button.dataset.key = move.key;
    button.title = `${move.hint}\n${index + 1}, or ⌃${index + 1} with an idea typed.`;
    button.innerHTML = `<kbd>${index + 1}</kbd>${esc(move.label)}<em>×${move.count}</em>`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => void run(move.key));
    movesEl.appendChild(button);
  });

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
  addEventListener("scroll", scheduleLayout, true);
  addEventListener("resize", scheduleLayout);

  // ── The source picture and its command ──

  function describeSource(el) {
    const mj = adapter();
    const rendered = mj.getMediaUrl(el);
    // The picture's own link names its tile; the page URL stands in on a job page.
    const tile = mj.getSaveSelection(rendered, location.href);
    const jobUrl = tile ? `https://www.midjourney.com/jobs/${tile.jobId}?index=${tile.index}` : location.href;
    return {
      key: tile ? `${tile.jobId}-${tile.index}` : rendered,
      rendered,
      // The full frame for the writer (webp is 3–5× lighter than the PNG).
      imageUrl: tile ? `https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.webp` : rendered,
      srefUrl: tile ? `https://cdn.midjourney.com/${tile.jobId}/0_${tile.index}.png` : (/^https:/.test(rendered) ? rendered : ""),
      pageUrl: jobUrl,
      tile,
      command: "",
    };
  }

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
    if (parts.profiles.length) kept(`profile ${parts.profiles.join(" ")}`, "Personalization and moodboard codes: kept on every new prompt.");
    if (parts.rest) kept(parts.rest, "Settings: kept on every new prompt.");
    if (!chips.length) { const none = document.createElement("span"); none.className = "code"; none.textContent = "no codes on this frame"; chips.push(none); }
    const toggle = (label, title, on, flip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-pressed", String(on));
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => { flip(); paintSource(); });
      chips.push(button);
    };
    if (source.srefUrl) toggle(state.srefThis ? "+ this frame as sref ✓" : "+ this frame as sref", "Add this picture as a style reference (--sref) on every new prompt. Use it when the frame has no codes of its own.", state.srefThis, () => { state.srefThis = !state.srefThis; setLocal({ [STORE.sref]: state.srefThis }); });
    if (parts.images.length) toggle(state.keepImages ? "image prompt kept ✓" : "image prompt left out", "The source used an image prompt. Left out by default: it pins the layout. Click to keep it.", state.keepImages, () => { state.keepImages = !state.keepImages; });
    codesEl.replaceChildren(...chips);
  }

  // ── Worlds ──

  function paintWorlds() {
    const options = [{ key: "none", name: "No world" }, ...state.worlds];
    worldSelect.replaceChildren(...options.map((world) => {
      const option = document.createElement("option");
      option.value = world.key;
      option.textContent = world.name;
      option.selected = world.key === state.world;
      return option;
    }));
  }
  const worldName = () => (state.world === "none" ? "" : state.worlds.find((world) => world.key === state.world)?.name || "");
  let worldsLoaded = false;
  async function loadWorlds() {
    const stored = await local([STORE.world, STORE.dockWorld, STORE.sref]);
    state.srefThis = stored[STORE.sref] === true;
    state.world = stored[STORE.world] || "none";
    paintWorlds();
    if (worldsLoaded) return;
    const res = await ask("worlds");
    if (res?.ok) {
      worldsLoaded = true;
      state.worlds = res.worlds || [];
      if (state.world !== "none" && !state.worlds.some((world) => world.key === state.world)) state.world = "none";
      paintWorlds();
    }
  }
  worldSelect.addEventListener("change", () => {
    state.world = worldSelect.value;
    setLocal({ [STORE.world]: state.world });
    idea.focus();
  });

  // ── Open / close ──

  function open(el) {
    const mj = adapter();
    if (!mj) return;
    const target = el || mediaAt(pointer.x, pointer.y) || mainMedia();
    if (!target) { showToast("Point at a picture, then ⌥X"); return; }
    if (!mount()) return;
    tag.style.display = "none";
    const source = describeSource(target);
    const same = state.source && state.source.key === source.key;
    state.open = true;
    state.el = target;
    if (!same) {
      state.source = source;
      state.prepared = null;
      state.editing = -1;
      const kept = cache.get(source.key);
      Object.assign(state, kept ? { ...kept } : { items: [], sel: 0, set: "", logline: "", move: null, thread: "", runId: "" });
      state.sourceReady = readCommand(source).then((ready) => { ready.commandRead = true; if (state.source === ready) { paintSource(); scheduleLayout(); } return ready; });
      setLine("");
      idea.value = "";
      idea.placeholder = state.items.length ? "Steer it again, or ↓ to pick" : "Say what you want next, or press 1–7";
    }
    card.style.display = "flex";
    requestAnimationFrame(() => card.classList.add("in"));
    paintSource();
    paintMoves();
    renderResults();
    void loadWorlds();
    layout();
    idea.focus();
  }

  function close() {
    if (!state.open) return;
    if (state.source && state.items.length) {
      cache.set(state.source.key, { items: state.items, sel: state.sel, set: state.set, logline: state.logline, move: state.move, thread: state.thread, runId: state.runId });
      if (cache.size > 30) cache.delete(cache.keys().next().value);
    }
    state.open = false;
    card.classList.remove("in");
    card.style.display = "none";
    ring.style.display = "none";
  }

  // ── Run ──

  function paintMoves() {
    movesEl.querySelectorAll(".move").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.key === state.move));
      button.disabled = state.busy;
    });
    go.disabled = state.busy;
    ring.classList.toggle("busy", state.busy);
  }

  async function run(moveKey) {
    if (state.busy || !state.source) return;
    const steer = idea.value.trim();
    if (!moveKey && !steer) { setLine("Pick a move (1–7) or type an idea."); idea.focus(); return; }
    const move = MOVES.find((entry) => entry.key === moveKey) || null;
    const source = state.source;
    state.busy = true;
    state.move = move?.key || null;
    paintMoves();
    setLine(`<span class="spin"></span><span>Looking at the picture…</span>`);
    try {
      await state.sourceReady;
      if (!state.prepared) {
        let image = await ask("prepare", { imageUrl: source.imageUrl });
        if (!image?.ok && source.rendered !== source.imageUrl) image = await ask("prepare", { imageUrl: source.rendered });
        if (!image?.ok) throw new Error(image?.error || "Could not read the picture.");
        if (state.source !== source) return;
        state.prepared = image;
      }
      setLine(`<span class="spin"></span><span>Writing ${move ? `${move.label.toLowerCase()} ×${move.count}` : "your idea"}…</span>`);
      const res = await ask("run", {
        image: state.prepared.dataUrl,
        command: source.command || undefined,
        preset: move?.key,
        idea: steer || undefined,
        world: state.world === "none" ? undefined : state.world,
        system: state.world === "none" ? undefined : await systemPromptFor(state.world),
        keepImages: state.keepImages || undefined,
        srefUrl: state.srefThis && source.srefUrl ? source.srefUrl : undefined,
        width: state.prepared.width, height: state.prepared.height,
      });
      if (state.source !== source) return;
      if (!res?.ok) throw new Error(res?.error || "Could not write the prompts.");
      state.items = (res.items || []).map((item) => ({ ...item, text: item.prompt, queued: false }));
      state.sel = 0;
      state.editing = -1;
      state.set = res.set || move?.label || "";
      state.logline = res.logline || "";
      state.runId = Date.now().toString(36);
      state.thread = threadLabel(worldName(), state.set, steer.split(/\s+/).slice(0, 5).join(" "));
      renderResults();
      setLine(`<span>${esc(res.model)} · ${(res.ms / 1000).toFixed(1)}s${res.world ? ` · ${esc(String(res.world).toUpperCase())} rules` : ""}${res.notes?.length ? ` · ${esc(res.notes[0])}` : ""}</span>`);
      idea.value = "";
      idea.placeholder = "Steer it again, or ↓ to pick";
      card.focus();
    } catch (err) {
      setLine(esc(err?.message || err), "err");
    } finally {
      state.busy = false;
      paintMoves();
      scheduleLayout();
    }
  }

  // ── Results ──

  function renderResults() {
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
        <div class="t"><span>${esc(item.title)}</span>${item.queued ? "<u>Queued</u>" : ""}${clean(item.text) !== clean(item.prompt) ? "<u>Edited</u>" : ""}</div>
        ${editing ? "" : `<div class="p">${esc(parts.words)}${index === state.sel && parts.tail ? ` <s>${esc(parts.tail)}</s>` : ""}</div>`}`;
      if (editing) {
        const area = document.createElement("textarea");
        area.className = "ed";
        area.value = item.text;
        area.spellcheck = false;
        area.addEventListener("input", () => { item.text = area.value; });
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
      foot.innerHTML = `<span><b>↑↓</b> pick</span><span><b>↵</b> in bar</span><span><b>Q</b> queue</span><span><b>R</b> again</span><span><b>/</b> steer</span>
        <button class="all" type="button" title="Queue every prompt not yet queued as one MJ Queue thread: ${esc(state.thread)}">${left ? `<b>A</b> queue all ${left} → thread` : "all queued ✓"}</button>`;
      foot.querySelector(".all").addEventListener("click", () => void queueAll());
    }
    const selected = list.querySelector(".item.sel");
    if (selected) selected.scrollIntoView({ block: "nearest" });
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

  async function toBar() {
    const item = current();
    if (!item) return;
    const done = writeBar(clean(item.text));
    if (!done.ok) { setLine(esc(done.error), "err"); return; }
    close();
    showToast(`In the bar: ${item.title}. Edit it, then Enter.`);
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
    const res = await ask("queue", { batch: state.thread, world: state.world === "none" ? undefined : state.world, items });
    if (!res?.ok) { setLine(esc(res?.error || "Could not queue."), "err"); return; }
    for (const index of picked) state.items[index].queued = true;
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
  function stopEdit() { state.editing = -1; renderResults(); card.focus(); }
  function dropOne() {
    if (!current()) return;
    state.items.splice(state.sel, 1);
    state.sel = Math.min(state.sel, Math.max(0, state.items.length - 1));
    state.editing = -1;
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
    const digit = /^Digit([1-7])$/.exec(event.code)?.[1];

    if (event.key === "Escape") {
      event.preventDefault();
      if (inEdit) stopEdit(); else close();
      return;
    }
    if (digit && event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); void run(MOVES[Number(digit) - 1].key); return; }
    if (inSelect) return;
    if (inEdit) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); state.editing = -1; void toBar(); }
      return;
    }
    if (inIdea) {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        if (idea.value.trim()) void run(null);
        else if (state.items.length) void toBar();
        return;
      }
      if (digit && plain(event) && !event.shiftKey && !idea.value) { event.preventDefault(); void run(MOVES[Number(digit) - 1].key); return; }
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
      "/": () => idea.focus(), i: () => idea.focus(), Tab: () => idea.focus(),
    };
    if (digit && !event.shiftKey) { event.preventDefault(); void run(MOVES[Number(digit) - 1].key); return; }
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
  const hideTag = () => { clearTimeout(altTimer); tag.style.display = "none"; };
  tag.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  tag.addEventListener("click", () => { const el = tag.__el; hideTag(); open(el && el.isConnected ? el : null); });

  window.addEventListener("keydown", (event) => {
    if (!alive()) return;
    // ⌥X on the picture under the pointer: open, or close when it is open.
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.code === "KeyX") {
      event.preventDefault();
      event.stopPropagation();
      hideTag();
      const under = mediaAt(pointer.x, pointer.y);
      const other = under && state.open && state.source && describeSource(under).key !== state.source.key;
      if (state.open && !other) close(); else open(under);
      return;
    }
    // Holding ⌥ over a picture shows where Grow is (a click works too).
    if (event.key === "Alt" && !state.open && !event.repeat) { clearTimeout(altTimer); altTimer = setTimeout(showTag, 350); return; }
    if (!state.open) return;
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

  // A click elsewhere closes the card (its results are kept for that picture).
  document.addEventListener("mousedown", (event) => {
    if (!state.open || state.busy || event.composedPath().includes(host)) return;
    close();
  }, true);

  globalScope.SaveToGalleryExpand.open = open;
  globalScope.SaveToGalleryExpand.close = close;
})(typeof globalThis !== "undefined" ? globalThis : self);
