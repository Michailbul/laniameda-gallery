(function registerMoodboardDock(globalScope) {
  "use strict";

  const WORLD_STORAGE_KEY = "stgMoodboardWorld";
  const STICKY_STORAGE_KEY = "stgMoodboardSticky";
  const PRESETS_STORAGE_PREFIX = "stgMjPresets:";
  const DEFAULT_WORLD_KEY = "dear-annete";
  const REFRESH_INTERVAL_MS = 45000;
  const DOCK_GAP_PX = 6;
  const CANONICAL_API_HOST = "gallery.laniameda.space";
  const LEGACY_API_HOSTS = ["laniameda.gallery", "laniameda-galery.vercel.app"];
  const MOODBOARDS_ROUTE_PATH = "/api/extension/moodboards";
  const TRANSIENT_RUNTIME_ERROR = /message port closed|receiving end does not exist/i;
  const PROFILE_FLAG_PATTERN = /(^|\s)(--profile|--p|-p)((?:\s+[^\s-]\S*)+)/g;

  // Sets exactly one gallery moodboard code in the prompt's profile flag and
  // keeps every other (taste profile) code. Clicking the only active
  // moodboard code again clears it. Everything outside the flags is untouched.
  function applyMoodboardToPrompt(promptText, code, moodboardCodes) {
    const prompt = String(promptText || "");
    const boardCodes = new Set(moodboardCodes || []);
    const flags = [];
    PROFILE_FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROFILE_FLAG_PATTERN.exec(prompt))) {
      const start = match.index + match[1].length;
      flags.push({
        start,
        end: match.index + match[0].length,
        leadStart: match.index,
        codes: match[3].trim().split(/\s+/),
      });
    }

    if (flags.length === 0) {
      const flag = `-p ${code}`;
      if (!prompt || /\s$/.test(prompt)) return prompt + flag;
      return `${prompt} ${flag}`;
    }

    const all = flags.flatMap((flag) => flag.codes);
    const boards = all.filter((entry) => boardCodes.has(entry));
    const taste = all.filter((entry) => !boardCodes.has(entry));
    const clearing = boards.length === 1 && boards[0] === code;
    const codes = clearing ? taste : [code, ...taste];
    const replacement = codes.length ? `-p ${codes.join(" ")}` : "";

    let result = prompt;
    for (let index = flags.length - 1; index >= 0; index -= 1) {
      const flag = flags[index];
      if (index === 0 && replacement) {
        result = result.slice(0, flag.start) + replacement + result.slice(flag.end);
      } else if (flag.leadStart < flag.start) {
        // Drop the space in front of the flag along with the flag.
        result = result.slice(0, flag.leadStart) + result.slice(flag.end);
      } else {
        // Flag opens the prompt: drop the space after it instead.
        const tail = result.slice(flag.end).replace(/^\s+/, "");
        result = result.slice(0, flag.start) + tail;
      }
    }
    return result;
  }

  // Adds or removes one taste profile code in the prompt's profile flag. The
  // moodboard code and every other code stay. Removing the last code drops
  // the flag. Everything outside the flags is untouched.
  function toggleProfileInPrompt(promptText, code) {
    const prompt = String(promptText || "");
    const flags = [];
    PROFILE_FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROFILE_FLAG_PATTERN.exec(prompt))) {
      const start = match.index + match[1].length;
      flags.push({
        start,
        end: match.index + match[0].length,
        leadStart: match.index,
        codes: match[3].trim().split(/\s+/),
      });
    }
    if (flags.length === 0) {
      const flag = `-p ${code}`;
      if (!prompt || /\s$/.test(prompt)) return prompt + flag;
      return `${prompt} ${flag}`;
    }
    const all = flags.flatMap((flag) => flag.codes);
    const codes = all.includes(code) ? all.filter((entry) => entry !== code) : [...all, code];
    const replacement = codes.length ? `-p ${codes.join(" ")}` : "";
    let result = prompt;
    for (let index = flags.length - 1; index >= 0; index -= 1) {
      const flag = flags[index];
      if (index === 0 && replacement) {
        result = result.slice(0, flag.start) + replacement + result.slice(flag.end);
      } else if (flag.leadStart < flag.start) {
        result = result.slice(0, flag.leadStart) + result.slice(flag.end);
      } else {
        const tail = result.slice(flag.end).replace(/^\s+/, "");
        result = result.slice(0, flag.start) + tail;
      }
    }
    return result;
  }

  function flagCodes(promptText) {
    const found = [];
    PROFILE_FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROFILE_FLAG_PATTERN.exec(String(promptText || "")))) {
      found.push(...match[3].trim().split(/\s+/));
    }
    return found;
  }

  // The flag a new prompt gets from the remembered selection: the board code
  // first, then the profiles, each only while it still exists in the world.
  function stickyCodes(sticky, moodboardCodes, profileCodes) {
    const boards = new Set(moodboardCodes || []);
    const profiles = new Set(profileCodes || []);
    const codes = [];
    if (sticky && sticky.board && boards.has(sticky.board)) codes.push(sticky.board);
    for (const code of (sticky && sticky.profiles) || []) {
      if (profiles.has(code) && !codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  // A prompt that was empty a moment ago and now has words but no profile
  // flag gets the remembered flag at its end. The caret stays where the
  // words are being typed. A prompt that already has a flag is left alone.
  function withStickyFlag(promptText, codes) {
    const prompt = String(promptText || "");
    if (!codes.length || !prompt.trim() || flagCodes(prompt).length) return null;
    const body = prompt.replace(/\s+$/, "");
    return `${body} -p ${codes.join(" ")}`;
  }

  function activeBoardCodes(promptText, moodboardCodes) {
    const boardCodes = new Set(moodboardCodes || []);
    const found = [];
    PROFILE_FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROFILE_FLAG_PATTERN.exec(String(promptText || "")))) {
      for (const entry of match[3].trim().split(/\s+/)) {
        if (boardCodes.has(entry)) found.push(entry);
      }
    }
    return found;
  }

  function writeTextareaValue(element, next) {
    const previous = element.value;
    if (previous === next) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    const tracker = element._valueTracker;
    if (tracker && typeof tracker.setValue === "function") {
      tracker.setValue(previous);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Two boards can shorten to the same word ("World"). When that happens,
  // use the part before the dot, without a leading "DA ".
  function chipLabel(board, boards) {
    const short = board.shortName || board.name || board.mjCode;
    const twins = (boards || []).filter(
      (other) => (other.shortName || other.name) === short,
    );
    if (twins.length < 2) return short;
    const head = String(board.name || "")
      .split("\u00b7")[0]
      .replace(/^DA\s+/i, "")
      .trim();
    return head || short;
  }

  // Picture URLs for a board's hover snapshot. The full image, so the
  // sheet is sharp. A thumb is only the fallback. At most 6, no repeats.
  function snapshotImages(board) {
    const urls = [];
    const list = Array.isArray(board && board.previews) ? board.previews : [];
    for (const item of list) {
      const url = item && (item.url || item.thumbUrl);
      if (typeof url === "string" && url && !urls.includes(url)) urls.push(url);
    }
    if (!urls.length && board && typeof board.thumbUrl === "string" && board.thumbUrl) {
      urls.push(board.thumbUrl);
    }
    return urls.slice(0, 6);
  }

  // Midjourney's settings panel (Stylize, Weirdness, Variety, Model...) opens
  // as a scrolling box right under the prompt (or right over it when the
  // prompt sits at the bottom). Returns its rectangle, or null when closed.
  function findPromptPanel(area) {
    if (!area || typeof document === "undefined") return null;
    const prompt = area.getBoundingClientRect();
    let root = area;
    for (let level = 0; level < 4 && root.parentElement; level += 1) root = root.parentElement;
    for (const node of root.querySelectorAll("div")) {
      if (node.closest(".stg-mb-dock, .stg-pp-bar, .stg-mb-snap")) continue;
      const rect = node.getBoundingClientRect();
      if (rect.height < 150 || rect.width < 300) continue;
      const below = rect.top >= prompt.bottom - 8 && rect.top <= prompt.bottom + 80;
      const above = rect.bottom <= prompt.top + 8 && rect.bottom >= prompt.top - 80;
      if (!below && !above) continue;
      const overflow = getComputedStyle(node).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      return { top: rect.top, bottom: rect.bottom, below };
    }
    return null;
  }

  // Replaces every profile flag with one flag of exactly these codes; with
  // no codes the flag goes. Everything else in the prompt is untouched.
  function setProfileFlag(promptText, codes) {
    const prompt = String(promptText || "");
    const list = (codes || []).filter(Boolean);
    const replacement = list.length ? `-p ${list.join(" ")}` : "";
    const flags = [];
    PROFILE_FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROFILE_FLAG_PATTERN.exec(prompt))) {
      flags.push({ start: match.index + match[1].length, end: match.index + match[0].length, leadStart: match.index });
    }
    if (!flags.length) {
      if (!replacement) return prompt;
      return !prompt || /\s$/.test(prompt) ? prompt + replacement : `${prompt} ${replacement}`;
    }
    let result = prompt;
    for (let index = flags.length - 1; index >= 0; index -= 1) {
      const flag = flags[index];
      if (index === 0 && replacement) {
        result = result.slice(0, flag.start) + replacement + result.slice(flag.end);
      } else if (flag.leadStart < flag.start) {
        result = result.slice(0, flag.leadStart) + result.slice(flag.end);
      } else {
        const tail = result.slice(flag.end).replace(/^\s+/, "");
        result = result.slice(0, flag.start) + tail;
      }
    }
    return result;
  }

  // The Midjourney settings a preset keeps: aspect, stylize, chaos, weird,
  // version, raw, style, quality ... Image references, seeds and the profile
  // flag are never part of a preset. Short and long names are one setting.
  const PARAM_NAMES = {
    ar: ["ar", "aspect"],
    s: ["s", "stylize"],
    c: ["c", "chaos"],
    w: ["w", "weird"],
    v: ["v", "version"],
    q: ["q", "quality"],
    niji: ["niji"],
    style: ["style"],
    exp: ["exp"],
    sw: ["sw"],
    sv: ["sv"],
    raw: ["raw"],
    tile: ["tile"],
    hd: ["hd"],
    draft: ["draft"],
  };
  const VALUELESS_PARAMS = new Set(["raw", "tile", "hd", "draft"]);
  const paramKeyOf = (name) =>
    Object.keys(PARAM_NAMES).find((key) => PARAM_NAMES[key].includes(String(name).toLowerCase())) || null;

  // Every kept setting in the prompt, as written ("--ar 16:9 --s 250 --raw").
  function readParams(promptText) {
    const tokens = String(promptText || "").split(/\s+/).filter(Boolean);
    const out = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const match = /^--([a-z]+)$/i.exec(tokens[index]);
      const key = match && paramKeyOf(match[1]);
      if (!key) continue;
      if (VALUELESS_PARAMS.has(key)) {
        out.push(`--${match[1].toLowerCase()}`);
        continue;
      }
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) continue;
      out.push(`--${match[1].toLowerCase()} ${value}`);
      index += 1;
    }
    return out.join(" ");
  }

  // [{ key, text }] for a settings string, one entry per setting.
  function parseParams(paramsText) {
    const parts = readParams(paramsText).match(/--[a-z]+(?:\s+(?!--)\S+)?/gi) || [];
    return parts.map((text) => ({ key: paramKeyOf(text.slice(2).split(/\s+/)[0]), text }));
  }

  // Puts each setting in the prompt, replacing the same setting where it is
  // already written (under its short or long name), else at the end.
  function setParams(promptText, paramsText) {
    let prompt = String(promptText || "");
    const wanted = parseParams(paramsText);
    if (!wanted.length) return prompt;
    for (const param of wanted) {
      const names = PARAM_NAMES[param.key].join("|");
      const value = VALUELESS_PARAMS.has(param.key) ? "" : "(?:\\s+(?!-)\\S+)?";
      const pattern = new RegExp(`(^|\\s)--(?:${names})(?=\\s|$)${value}`, "gi");
      prompt = prompt.replace(pattern, "");
    }
    const body = prompt.replace(/\s+$/, "");
    const tail = wanted.map((param) => param.text).join(" ");
    return body ? `${body} ${tail}` : tail;
  }

  // Takes the preset's settings out of the prompt (only where they still
  // carry the preset's value).
  function removeParams(promptText, paramsText) {
    let prompt = String(promptText || "");
    for (const param of parseParams(paramsText)) {
      const [name, ...rest] = param.text.slice(2).split(/\s+/);
      const escaped = rest.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const value = rest.length ? `\\s+${escaped}` : "";
      const names = PARAM_NAMES[param.key].includes(name) ? PARAM_NAMES[param.key].join("|") : name;
      prompt = prompt.replace(new RegExp(`(^|\\s)--(?:${names})${value}(?=\\s|$)`, "gi"), "");
    }
    return prompt.replace(/\s+$/, "");
  }

  // True when every setting of the preset is in the prompt with its value.
  function hasParams(promptText, paramsText) {
    const present = new Map(parseParams(promptText).map((param) => [param.key, param.text.split(/\s+/).slice(1).join(" ")]));
    return parseParams(paramsText).every(
      (param) => present.has(param.key) && present.get(param.key) === param.text.split(/\s+/).slice(1).join(" "),
    );
  }

  globalScope.SaveToGalleryMoodboardDock = {
    setProfileFlag,
    readParams,
    setParams,
    removeParams,
    hasParams,
    applyMoodboardToPrompt,
    toggleProfileInPrompt,
    flagCodes,
    stickyCodes,
    withStickyFlag,
    findPromptPanel,
    activeBoardCodes,
    chipLabel,
    snapshotImages,
  };

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  const state = {
    worlds: [],
    worldKey: "",
    moodboards: [],
    profiles: [],
    // The board and profiles picked last, per world: every new prompt gets them.
    sticky: {},
    signature: "",
    worldsSignature: "",
    loading: true,
    error: "",
    requestId: 0,
    fetchedAt: 0,
    // Saved presets of the current world (chrome.storage.sync, per world).
    presets: [],
  };
  let dock = null;
  let worldSelect = null;
  let activeLabel = null;
  let strip = null;
  let profileSep = null;
  let profileStrip = null;
  let statusLine = null;
  let packs = null;
  let presetBox = null;
  let saveButton = null;
  let saveInput = null;
  let note = null;
  let noteTimer = null;
  let textarea = null;
  let layoutQueued = false;
  let snapshot = null;
  let wasShown = false;
  // True while the prompt is empty: the next words typed get the remembered flag.
  let freshPrompt = true;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // engaged: a click or a key in the prompt since this page opened. Midjourney
  // focuses the prompt on every page by itself, so focus alone means nothing.
  const compose = { hover: new Set(), holdUntil: 0, engaged: false, href: "" };
  const COMPOSE_HOLD_MS = 350;

  // The dock shows only while a prompt is being written: the prompt or the
  // dock has focus, or the pointer rests on the dock. The rest of the time it
  // folds away and the page (the grid, a single image) is clear.
  function isComposing() {
    if (location.href !== compose.href) {
      compose.href = location.href;
      compose.engaged = false;
    }
    const active = document.activeElement;
    if (textarea && active === textarea && (compose.engaged || wordsOf(textarea.value))) return true;
    if (active && active.closest && active.closest(".stg-mb-dock")) return true;
    if (compose.hover.size > 0) return true;
    return Date.now() < compose.holdUntil;
  }

  function setHover(name, on) {
    if (on) compose.hover.add(name);
    else compose.hover.delete(name);
    if (!on) compose.holdUntil = Date.now() + COMPOSE_HOLD_MS;
    notifyCompose();
  }

  let composeTimer = null;
  function notifyCompose() {
    queueLayout();
    clearTimeout(composeTimer);
    composeTimer = setTimeout(queueLayout, COMPOSE_HOLD_MS + 30);
  }

  function engage() {
    if (compose.engaged) return;
    compose.engaged = true;
    notifyCompose();
  }

  // The queue panel injects a finished command: the remembered flag must not
  // be added to it.
  globalScope.SaveToGalleryMoodboardDock.holdSticky = () => {
    freshPrompt = false;
  };
  globalScope.SaveToGalleryMoodboardDock.isComposing = isComposing;
  globalScope.SaveToGalleryMoodboardDock.setHover = setHover;

  function findTextarea() {
    // Midjourney shortens the placeholder to "Imagine" when the bar is narrow.
    return (
      [...document.querySelectorAll("textarea")].find((area) =>
        /imagine/i.test(area.getAttribute("placeholder") || ""),
      ) || null
    );
  }

  function findBar(area) {
    if (!area) return null;
    // Narrow Create puts the prompt in a fixed bar. The wide page does not.
    return area.closest("div.fixed") || area.parentElement?.parentElement || area.parentElement;
  }

  // Looking for Midjourney's settings panel walks many boxes, so the answer
  // is kept for a moment; a resize, a click or a focus change asks afresh.
  const PANEL_TTL_MS = 250;
  const panelCache = { at: 0, area: null, value: null };
  function promptPanel(area) {
    const now = Date.now();
    if (panelCache.area === area && now - panelCache.at < PANEL_TTL_MS) return panelCache.value;
    panelCache.area = area;
    panelCache.at = now;
    panelCache.value = findPromptPanel(area);
    return panelCache.value;
  }
  const forgetPanel = () => {
    panelCache.at = 0;
  };

  function boardCodes() {
    return state.moodboards.map((board) => board.mjCode);
  }

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function hideSnapshot() {
    if (snapshot) snapshot.hidden = true;
  }

  // The small thumb shows at once (usually cached); the full picture replaces
  // it when it has loaded, so the sheet is quick and then sharp.
  function showSnapshot(board, chip) {
    if (!dock || !snapshot) return;
    snapshot.textContent = "";
    const row = el("div", "stg-mb-snap-row");
    const empty = el("div", "stg-mb-snap-empty", "No images yet");
    const list = Array.isArray(board.previews) ? board.previews : [];
    const urls = snapshotImages(board);
    let shown = urls.length;
    if (!urls.length) row.appendChild(empty);
    for (const url of urls) {
      const img = el("img", "stg-mb-snap-img");
      img.alt = "";
      img.decoding = "async";
      const thumb = list.find((item) => item && item.url === url)?.thumbUrl;
      img.addEventListener("error", () => {
        // A thumb that fails still gets the full picture before giving up.
        if (img.dataset.full !== "1" && thumb && thumb !== url) {
          img.dataset.full = "1";
          img.src = url;
          return;
        }
        img.remove();
        shown -= 1;
        if (shown <= 0 && !empty.isConnected) row.appendChild(empty);
      });
      if (thumb && thumb !== url) {
        img.src = thumb;
        const full = new Image();
        full.decoding = "async";
        full.addEventListener("load", () => {
          if (img.isConnected && img.dataset.full !== "1") {
            img.dataset.full = "1";
            img.src = url;
          }
        });
        full.src = url;
      } else {
        img.src = url;
      }
      row.appendChild(img);
    }
    const meta = el("div", "stg-mb-snap-meta");
    meta.append(
      el("span", "stg-mb-snap-name", board.name || board.shortName || board.mjCode),
      el("span", "stg-mb-snap-code", board.flag || `-p ${board.mjCode}`),
    );
    snapshot.append(row, meta);
    snapshot.hidden = false;
    placeSnapshot(chip);
  }

  // Opens on the side of the dock away from the prompt bar, so the bar stays
  // clear. Tiles have a fixed height, so the sheet never jumps as pictures land.
  function placeSnapshot(chip) {
    if (!dock || !snapshot || snapshot.hidden || !chip.isConnected) return;
    const dockRect = dock.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const width = snapshot.offsetWidth;
    const left = Math.max(
      4,
      Math.min(
        chipRect.left + chipRect.width / 2 - width / 2,
        window.innerWidth - width - 4,
      ),
    );
    snapshot.style.left = `${Math.round(left)}px`;
    if (dockRect.top > window.innerHeight * 0.5) {
      snapshot.style.top = "auto";
      snapshot.style.bottom = `${Math.round(window.innerHeight - dockRect.top + DOCK_GAP_PX)}px`;
    } else {
      snapshot.style.bottom = "auto";
      snapshot.style.top = `${Math.round(dockRect.bottom + DOCK_GAP_PX)}px`;
    }
  }

  function dropDock() {
    document
      .querySelectorAll(".stg-mb-dock, .stg-mb-snap, .stg-pp-bar")
      .forEach((node) => node.remove());
    dock = null;
    snapshot = null;
    packs = null;
  }

  function askBackground(world) {
    return new Promise((resolve) => {
      if (!extensionAlive()) {
        dropDock();
        resolve({ ok: false, error: "Extension reloaded." });
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: "listMoodboards", world }, (res) => {
          const message = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (message) {
            if (/invalidated/i.test(message)) dropDock();
            resolve({ ok: false, error: message, transient: TRANSIENT_RUNTIME_ERROR.test(message) });
            return;
          }
          resolve(res || { ok: false, error: "No response.", transient: true });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  function moodboardsUrl(rawApiUrl, world) {
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
    url.pathname = MOODBOARDS_ROUTE_PATH;
    url.search = world ? `?world=${encodeURIComponent(world)}` : "";
    url.hash = "";
    return url.toString();
  }

  // The service worker can be mid-restart (Chrome stops it when idle, or the
  // extension was reloaded under an open tab): then the message port closes
  // with no answer. Ask the gallery directly; the route allows any origin.
  async function fetchDirect(world) {
    let config;
    try {
      config = await chrome.storage.sync.get(["apiUrl", "apiToken"]);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    const token = String(config?.apiToken || "").trim();
    let response;
    try {
      response = await fetch(moodboardsUrl(config?.apiUrl, world), {
        headers: token ? { "X-Extension-Token": token } : {},
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
    if (!response.ok || !data) {
      return { ok: false, status: response.status, error: data?.error || `HTTP ${response.status}` };
    }
    return data;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function send(world) {
    let res = await askBackground(world);
    for (const delay of [250, 800]) {
      if (res.ok || !res.transient) return res;
      await wait(delay);
      res = await askBackground(world);
    }
    if (res.ok || !res.transient || !extensionAlive()) return res;
    return fetchDirect(world);
  }

  function isAuthFailure(res) {
    return res.status === 401 || /unauthorized|token/i.test(res.error || "");
  }

  function pickWorldKey(worlds, saved) {
    const keys = worlds.map((world) => world.key);
    if (saved && keys.includes(saved)) return saved;
    if (keys.includes(DEFAULT_WORLD_KEY)) return DEFAULT_WORLD_KEY;
    return keys[0] || "";
  }

  // Codes are fetched when the page opens, on a world switch, on ↻, and when
  // a prompt starts more than 45 s after the last fetch. Nothing polls in the
  // background. A failed refresh keeps the codes already shown; the error
  // appears only when nothing is loaded or on a ↻ click.
  async function refresh(options = {}) {
    const requestId = ++state.requestId;
    state.fetchedAt = Date.now();
    let key = state.worldKey || DEFAULT_WORLD_KEY;
    let res = await send(key);
    if (!res.ok && !isAuthFailure(res) && res.status) {
      // The saved or default world is gone. Ask for the list and fall back.
      const list = await send(null);
      if (list.ok) {
        key = pickWorldKey(list.worlds || [], state.worldKey);
        res = key ? await send(key) : list;
      }
    }
    if (requestId !== state.requestId) return;
    state.loading = false;
    if (!res.ok) {
      state.fetchedAt = 0;
      if (!extensionAlive()) return;
      if (!options.manual && state.moodboards.length && !isAuthFailure(res)) return;
      const detail = String(res.error || "").replace(/^HTTP \d+\s*/, "").slice(0, 80);
      state.error = isAuthFailure(res)
        ? "Gallery token missing. Open the extension settings."
        : detail
          ? `Could not load moodboards. ${detail}`
          : "Could not load moodboards.";
      render();
      return;
    }
    state.error = "";
    state.worlds = Array.isArray(res.worlds) ? res.worlds : state.worlds;
    state.worldKey = res.world?.key || key;
    const next = Array.isArray(res.moodboards) ? res.moodboards : [];
    const profiles = Array.isArray(res.profiles) ? res.profiles : [];
    const signature = JSON.stringify([state.worldKey, next, profiles]);
    if (signature !== state.signature) {
      state.signature = signature;
      state.moodboards = next;
      state.profiles = profiles;
    }
    render();
  }

  function refreshIfStale() {
    if (Date.now() - state.fetchedAt > REFRESH_INTERVAL_MS) refresh();
  }

  function profileCodes() {
    return state.profiles.map((profile) => profile.code);
  }

  // What every next prompt starts with: the board and profiles picked last,
  // plus the settings and packs of the preset picked last.
  function stickyFor(key = state.worldKey) {
    return state.sticky[key] || { board: null, profiles: [], params: "", packs: [] };
  }

  function saveSticky() {
    try {
      chrome.storage.local.set({ [STICKY_STORAGE_KEY]: state.sticky });
    } catch {
      // storage unavailable after an extension reload
    }
  }

  const wordsOf = (value) => String(value || "").replace(PROFILE_FLAG_PATTERN, "").trim();

  // The flag given here becomes what every next prompt starts with.
  function rememberSelection(value) {
    const codes = flagCodes(value);
    const boards = new Set(boardCodes());
    const profiles = new Set(profileCodes());
    const previous = stickyFor();
    state.sticky[state.worldKey] = {
      board: codes.find((code) => boards.has(code)) || null,
      profiles: codes.filter((code) => profiles.has(code)),
      params: previous.params || "",
      packs: previous.packs || [],
    };
    saveSticky();
  }

  // The current selection as a flag: the prompt's own when it has words,
  // else the remembered one (an empty prompt only arms the next prompt).
  function selectionSource() {
    const value = textarea ? textarea.value : "";
    if (wordsOf(value)) return { value, live: true };
    const codes = stickyCodes(stickyFor(), boardCodes(), profileCodes());
    return { value: codes.length ? `-p ${codes.join(" ")}` : "", live: false };
  }

  function applySelection(next, live) {
    rememberSelection(next);
    if (live) writeTextareaValue(textarea, next);
    else freshPrompt = true;
    textarea.focus();
    syncActive();
  }

  function onChipClick(board) {
    if (!textarea || !textarea.isConnected) return;
    const source = selectionSource();
    applySelection(applyMoodboardToPrompt(source.value, board.mjCode, boardCodes()), source.live);
  }

  // Midjourney empties the prompt after a submit. The first words of the next
  // prompt bring the remembered board and profiles back.
  function onPromptInput() {
    if (!textarea) return;
    const value = textarea.value;
    if (!wordsOf(value)) {
      freshPrompt = true;
      syncActive();
      return;
    }
    if (freshPrompt) {
      freshPrompt = false;
      const sticky = stickyFor();
      const codes = stickyCodes(sticky, boardCodes(), profileCodes());
      const extras = Boolean(sticky.params) || (sticky.packs || []).length > 0;
      if (withStickyFlag(value, codes) || extras) {
        // Runs after Midjourney has handled the keystroke. Uses the text as it
        // is by then, so fast typing never loses the flag.
        setTimeout(() => {
          if (!textarea || !textarea.isConnected) return;
          const base = textarea.value;
          const next = withPresetExtras(withStickyFlag(base, codes) ?? base, sticky);
          if (next === base) return;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          writeTextareaValue(textarea, next);
          textarea.setSelectionRange(start, end);
          syncActive();
        }, 0);
      }
    }
    syncActive();
  }

  function onProfileClick(profile) {
    if (!textarea || !textarea.isConnected) return;
    const source = selectionSource();
    applySelection(toggleProfileInPrompt(source.value, profile.code), source.live);
  }

  function syncActive() {
    if (!dock) return;
    const value = textarea ? textarea.value : "";
    const active = activeBoardCodes(value, boardCodes());
    const codes = flagCodes(value);
    const sticky = stickyCodes(stickyFor(), boardCodes(), profileCodes());
    const waiting = !wordsOf(value);
    for (const chip of strip.children) {
      const on = active.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-chip--on", on);
      chip.classList.toggle("stg-mb-chip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const chip of profileStrip.children) {
      const on = codes.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-pchip--on", on);
      chip.classList.toggle("stg-mb-pchip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const armed = stickyFor();
    let label = "";
    if (!waiting && codes.length) label = `-p ${codes.join(" ")}`;
    else if (waiting && (sticky.length || armed.params)) {
      label = ["next ·", sticky.length ? `-p ${sticky.join(" ")}` : "", armed.params || ""].filter(Boolean).join(" ");
    }
    activeLabel.textContent = label;
    activeLabel.title = label;
    activeLabel.classList.toggle("stg-mb-active--next", waiting);
    for (const chip of presetBox.querySelectorAll(".stg-mb-preset")) {
      const preset = state.presets.find((entry) => entry.id === chip.dataset.id);
      const on = Boolean(preset) && !waiting && presetInPrompt(value, preset);
      const isArmed = Boolean(preset) && waiting && presetArmed(preset);
      chip.classList.toggle("stg-mb-preset--on", on);
      chip.classList.toggle("stg-mb-preset--armed", isArmed);
      chip.setAttribute("aria-pressed", on || isArmed ? "true" : "false");
    }
    const selection = currentSelection();
    const hasSelection = Boolean(selection.codes.length || selection.params || selection.packs.length);
    saveButton.classList.toggle("stg-mb-save--idle", !hasSelection);
    packs?.sync();
  }

  /* ── Presets: a board, profiles, settings and packs under one name ── */

  const PRESET_LIMIT = 16;
  const presetKey = (world = state.worldKey) => `${PRESETS_STORAGE_PREFIX}${world}`;
  const packsApi = () => globalScope.SaveToGalleryPromptPacks;
  function packPhrase(id) {
    for (const group of globalScope.SaveToGalleryPromptPackData || []) {
      const pack = group.packs.find((entry) => entry.id === id);
      if (pack) return pack;
    }
    return null;
  }

  // The settings and packs of a preset go into a prompt that has words: the
  // settings at the end, the packs after the words.
  function withPresetExtras(text, preset) {
    let next = text;
    if (preset.params && !hasParams(next, preset.params)) next = setParams(next, preset.params);
    const api = packsApi();
    for (const id of preset.packs || []) {
      const pack = packPhrase(id);
      if (pack && api && !api.hasPack(next, pack.phrase)) next = api.insertPack(next, pack.phrase, { mode: "after" }).text;
    }
    return next;
  }

  function sameCodes(a, b) {
    return a.length === b.length && a.every((code) => b.includes(code));
  }

  function presetInPrompt(value, preset) {
    const api = packsApi();
    return (
      sameCodes(flagCodes(value), preset.codes || []) &&
      hasParams(value, preset.params || "") &&
      (preset.packs || []).every((id) => {
        const pack = packPhrase(id);
        return !pack || !api || api.hasPack(value, pack.phrase);
      })
    );
  }

  function presetArmed(preset) {
    const sticky = stickyFor();
    const codes = stickyCodes(sticky, boardCodes(), profileCodes());
    return (
      sameCodes(codes, (preset.codes || []).filter((code) => boardCodes().includes(code) || profileCodes().includes(code))) &&
      (sticky.params || "") === (preset.params || "") &&
      sameCodes(sticky.packs || [], preset.packs || [])
    );
  }

  // What Save would keep: the prompt's own selection when it has words, else
  // what the next prompt is armed with.
  function currentSelection() {
    const value = textarea ? textarea.value : "";
    if (wordsOf(value)) {
      const api = packsApi();
      const packIds = [];
      for (const group of globalScope.SaveToGalleryPromptPackData || []) {
        for (const pack of group.packs) if (api && api.hasPack(value, pack.phrase)) packIds.push(pack.id);
      }
      return { codes: flagCodes(value), params: readParams(value), packs: packIds };
    }
    const sticky = stickyFor();
    return { codes: stickyCodes(sticky, boardCodes(), profileCodes()), params: sticky.params || "", packs: sticky.packs || [] };
  }

  function armSticky(preset) {
    const boards = new Set(boardCodes());
    const profiles = new Set(profileCodes());
    const codes = preset ? preset.codes || [] : [];
    state.sticky[state.worldKey] = {
      board: codes.find((code) => boards.has(code)) || null,
      profiles: codes.filter((code) => profiles.has(code)),
      params: preset ? preset.params || "" : "",
      packs: preset ? preset.packs || [] : [],
    };
    saveSticky();
  }

  // One click sets the whole look; a second click on the lit preset takes it
  // out again. An empty prompt is only armed: the first words bring it in.
  function onPresetClick(preset) {
    if (!textarea || !textarea.isConnected) return;
    const value = textarea.value;
    const live = Boolean(wordsOf(value));
    const turningOff = live ? presetInPrompt(value, preset) : presetArmed(preset);
    if (turningOff) {
      armSticky(null);
      if (live) {
        let next = setProfileFlag(value, flagCodes(value).filter((code) => !(preset.codes || []).includes(code)));
        next = removeParams(next, preset.params || "");
        const api = packsApi();
        for (const id of preset.packs || []) {
          const pack = packPhrase(id);
          if (pack && api) next = api.removePack(next, pack.phrase).text;
        }
        writeTextareaValue(textarea, next);
      }
    } else {
      armSticky(preset);
      if (live) {
        writeTextareaValue(textarea, withPresetExtras(setProfileFlag(value, preset.codes || []), preset));
      } else {
        freshPrompt = true;
      }
    }
    textarea.focus();
    syncActive();
  }

  function showNote(text, action) {
    if (!note) return;
    clearTimeout(noteTimer);
    note.textContent = text;
    if (action) {
      const button = el("button", "stg-mb-note-act", action.label);
      button.type = "button";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        action.run();
        note.hidden = true;
      });
      note.append(" ", button);
    }
    note.hidden = false;
    noteTimer = setTimeout(() => {
      note.hidden = true;
    }, 6000);
  }

  function storePresets(list) {
    state.presets = list;
    try {
      chrome.storage.sync.set({ [presetKey()]: list });
    } catch {
      // storage unavailable after an extension reload
    }
    renderPresets();
    syncActive();
  }

  function loadPresets() {
    const world = state.worldKey;
    try {
      chrome.storage.sync.get([presetKey(world)], (stored) => {
        if (world !== state.worldKey) return;
        const list = stored?.[presetKey(world)];
        state.presets = Array.isArray(list) ? list : [];
        renderPresets();
        syncActive();
      });
    } catch {
      // storage unavailable after an extension reload
    }
  }

  function suggestName(selection) {
    const names = [];
    for (const code of selection.codes) {
      const board = state.moodboards.find((entry) => entry.mjCode === code);
      const profile = state.profiles.find((entry) => entry.code === code);
      if (board) names.push(chipLabel(board, state.moodboards));
      else if (profile) names.push(profile.name);
    }
    const ar = /--(?:ar|aspect)\s+(\S+)/i.exec(selection.params || "");
    if (ar) names.push(ar[1]);
    const text = names.join(" + ");
    return text.length > 32 ? `${text.slice(0, 31)}…` : text || `Preset ${state.presets.length + 1}`;
  }

  function openSave() {
    const selection = currentSelection();
    if (!selection.codes.length && !selection.params && !selection.packs.length) {
      showNote("Pick a moodboard or profile first, then save it as a preset.");
      return;
    }
    saveButton.hidden = true;
    saveInput.hidden = false;
    saveInput.value = suggestName(selection);
    saveInput.focus();
    saveInput.select();
  }

  function closeSave(commit) {
    if (saveInput.hidden) return;
    const name = saveInput.value.trim().slice(0, 40);
    saveInput.hidden = true;
    saveButton.hidden = false;
    if (commit && name) {
      const selection = currentSelection();
      const preset = {
        id: `ps${Date.now().toString(36)}`,
        name,
        codes: selection.codes.slice(0, 12),
        params: selection.params.slice(0, 240),
        packs: selection.packs.slice(0, 24),
      };
      const others = state.presets.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase());
      storePresets([...others, preset].slice(-PRESET_LIMIT));
      armSticky(preset);
      showNote(`Saved “${name}”`);
    }
    textarea?.focus();
  }

  function deletePreset(preset) {
    const before = state.presets;
    storePresets(before.filter((entry) => entry.id !== preset.id));
    hideSnapshot();
    showNote(`Removed “${preset.name}”`, { label: "Undo", run: () => storePresets(before) });
  }

  function presetSpec(preset) {
    const packNames = (preset.packs || []).map((id) => packPhrase(id)?.label).filter(Boolean);
    return [
      (preset.codes || []).length ? `-p ${preset.codes.join(" ")}` : "",
      preset.params || "",
      packNames.length ? `+ ${packNames.join(", ")}` : "",
    ].filter(Boolean).join("  ");
  }

  // The preset's board pictures (when it has a board), its name and contents.
  function showPresetCard(preset, chip) {
    const board = state.moodboards.find((entry) => (preset.codes || []).includes(entry.mjCode));
    if (board) {
      showSnapshot({ ...board, name: preset.name, flag: presetSpec(preset) }, chip);
      return;
    }
    if (!dock || !snapshot) return;
    snapshot.textContent = "";
    const card = el("div", "stg-mb-pcard");
    card.append(el("span", "stg-mb-snap-name", preset.name), el("span", "stg-mb-pcard-role", presetSpec(preset) || "Empty preset"));
    snapshot.append(card);
    snapshot.hidden = false;
    placeSnapshot(chip);
  }

  function renderPresets() {
    if (!presetBox) return;
    const signature = JSON.stringify([state.worldKey, state.presets]);
    if (presetBox.dataset.signature === signature) return;
    presetBox.dataset.signature = signature;
    presetBox.textContent = "";
    for (const preset of state.presets) {
      const chip = el("button", "stg-mb-preset");
      chip.type = "button";
      chip.dataset.id = preset.id;
      chip.title = `${preset.name}\n${presetSpec(preset)}`;
      const remove = el("span", "stg-mb-preset-x", "×");
      remove.title = "Delete preset";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        deletePreset(preset);
      });
      chip.append(el("span", "stg-mb-preset-name", preset.name), remove);
      chip.addEventListener("mousedown", (event) => event.preventDefault());
      chip.addEventListener("click", () => onPresetClick(preset));
      chip.addEventListener("mouseenter", () => showPresetCard(preset, chip));
      chip.addEventListener("mouseleave", hideSnapshot);
      presetBox.appendChild(chip);
    }
  }

  // A profile has no pictures: its hover card is the name, the world's role
  // for it and its code.
  function showProfileCard(profile, chip) {
    if (!dock || !snapshot) return;
    snapshot.textContent = "";
    const card = el("div", "stg-mb-pcard");
    card.append(
      el("span", "stg-mb-snap-name", profile.name),
      el("span", "stg-mb-pcard-role", profile.role || "Taste profile"),
    );
    const meta = el("div", "stg-mb-snap-meta");
    meta.append(el("span", "stg-mb-pcard-kind", "Profile"), el("span", "stg-mb-snap-code", profile.flag || `-p ${profile.code}`));
    snapshot.append(card, meta);
    snapshot.hidden = false;
    placeSnapshot(chip);
  }

  // "DEAR ANNETE — ART DECO" reads "DA — ART DECO" in the dock: a parent
  // name of two or more words shortens to its initials. The full name is the
  // tooltip.
  function worldLabel(name) {
    const text = String(name || "");
    const cut = text.indexOf(" — ");
    if (cut < 0) return text;
    const head = text.slice(0, cut).trim().split(/\s+/);
    if (head.length < 2) return text;
    return `${head.map((word) => word[0]).join("").toUpperCase()}${text.slice(cut)}`;
  }

  // Rebuilt only when the list changes, so a refresh never closes the menu
  // while it is open.
  function renderWorlds() {
    const signature = JSON.stringify([state.worlds.map((world) => [world.key, world.name]), state.worldKey]);
    if (worldSelect.dataset.signature === signature) return;
    worldSelect.dataset.signature = signature;
    worldSelect.textContent = "";
    const worlds = state.worlds.length ? state.worlds : state.worldKey ? [{ key: state.worldKey, name: state.worldKey }] : [];
    for (const world of worlds) {
      const option = el("option", "", worldLabel(world.name));
      option.title = world.name;
      option.value = world.key;
      worldSelect.appendChild(option);
    }
    worldSelect.value = state.worldKey;
    worldSelect.title = worlds.find((world) => world.key === state.worldKey)?.name || "Gallery world";
  }

  // The prompt packs are Dear Annete's lexicon: the Packs button shows only
  // in its worlds.
  const worldHasPacks = (key) => /^dear-annete/.test(String(key || ""));

  function render() {
    if (!dock) return;
    renderWorlds();
    let message = "";
    if (state.loading && !state.moodboards.length) message = "Loading moodboards…";
    else if (state.error) message = state.error;
    else if (!state.moodboards.length && !state.profiles.length) message = "No moodboard codes in this world.";
    statusLine.textContent = message;
    statusLine.hidden = !message;
    statusLine.classList.toggle("stg-mb-status--error", Boolean(state.error));
    packs?.setEnabled(worldHasPacks(state.worldKey));

    const existing = strip.dataset.signature;
    if (existing !== state.signature) {
      strip.dataset.signature = state.signature;
      strip.textContent = "";
      hideSnapshot();
      for (const board of state.moodboards) {
        const chip = el("button", "stg-mb-chip", chipLabel(board, state.moodboards));
        chip.type = "button";
        chip.dataset.code = board.mjCode;
        chip.title = [board.name, board.collection, board.flag]
          .filter(Boolean)
          .join("\n");
        chip.addEventListener("mousedown", (event) => event.preventDefault());
        chip.addEventListener("click", () => onChipClick(board));
        chip.addEventListener("mouseenter", () => showSnapshot(board, chip));
        chip.addEventListener("focus", () => showSnapshot(board, chip));
        chip.addEventListener("mouseleave", hideSnapshot);
        chip.addEventListener("blur", hideSnapshot);
        strip.appendChild(chip);
      }
      profileStrip.textContent = "";
      for (const profile of state.profiles) {
        const chip = el("button", "stg-mb-pchip", profile.name);
        chip.type = "button";
        chip.dataset.code = profile.code;
        chip.title = [profile.name, profile.role, profile.flag].filter(Boolean).join("\n");
        chip.addEventListener("mousedown", (event) => event.preventDefault());
        chip.addEventListener("click", () => onProfileClick(profile));
        chip.addEventListener("mouseenter", () => showProfileCard(profile, chip));
        chip.addEventListener("focus", () => showProfileCard(profile, chip));
        chip.addEventListener("mouseleave", hideSnapshot);
        chip.addEventListener("blur", hideSnapshot);
        profileStrip.appendChild(chip);
      }
      profileSep.hidden = state.profiles.length === 0 || state.moodboards.length === 0;
    }
    syncActive();
  }

  // The quick edit (mj-quick-edit.js) follows the dock's world, so one switch
  // sets both the moodboards and the system prompt the rewrite uses.
  function quickEditWorldFor(key) {
    if (/^dear-annete/.test(key)) return "dear-annete";
    if (/^andromeda/.test(key)) return "andromeda-anya";
    return null;
  }

  // Two lines: moodboards | profiles next to the prompt; under them world ·
  // presets · Save · flag · Packs. The packs panel opens past them on demand.
  function buildDock() {
    dock = el("div", "stg-mb-dock");
    dock.hidden = true;
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Gallery moodboards");
    const row = el("div", "stg-mb-row");
    const world = el("div", "stg-mb-worldbox");
    worldSelect = el("select", "stg-mb-world");
    worldSelect.setAttribute("aria-label", "Gallery world");
    worldSelect.addEventListener("change", () => {
      state.worldKey = worldSelect.value;
      try {
        const qe = quickEditWorldFor(state.worldKey);
        chrome.storage.local.set({
          [WORLD_STORAGE_KEY]: state.worldKey,
          ...(qe ? { quickEditWorld: qe } : {}),
        });
      } catch {
        // storage unavailable after an extension reload
      }
      state.loading = true;
      state.moodboards = [];
      state.profiles = [];
      state.signature = "";
      state.presets = [];
      render();
      renderPresets();
      loadPresets();
      refresh();
    });
    const refreshButton = el("button", "stg-mb-refresh", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Refresh moodboards";
    refreshButton.setAttribute("aria-label", "Refresh moodboards");
    refreshButton.addEventListener("mousedown", (event) => event.preventDefault());
    refreshButton.addEventListener("click", () => refresh({ manual: true }));
    world.append(worldSelect, refreshButton);

    statusLine = el("span", "stg-mb-status");
    strip = el("div", "stg-mb-strip");
    profileSep = el("span", "stg-mb-sep");
    profileSep.hidden = true;
    profileStrip = el("div", "stg-mb-pstrip");
    activeLabel = el("span", "stg-mb-active");
    const createSection = globalScope.SaveToGalleryPromptPacks?.createSection;
    packs =
      typeof createSection === "function"
        ? createSection({ getTextarea: () => textarea, onResize: queueLayout })
        : null;
    // First line, next to the prompt: moodboards and profiles, the main thing.
    row.append(statusLine, strip, profileSep, profileStrip);

    // Second line, smaller: world, presets, Save, the flag, Packs (closed).
    const meta = el("div", "stg-mb-row stg-mb-row--meta");
    presetBox = el("div", "stg-mb-presets");
    saveButton = el("button", "stg-mb-save", "+ Save preset");
    saveButton.type = "button";
    saveButton.title = "Save the moodboard, profiles, settings (--ar, --s …) and packs in this prompt as a preset";
    saveButton.addEventListener("mousedown", (event) => event.preventDefault());
    saveButton.addEventListener("click", openSave);
    saveInput = el("input", "stg-mb-save-input");
    saveInput.type = "text";
    saveInput.maxLength = 40;
    saveInput.placeholder = "Preset name";
    saveInput.spellcheck = false;
    saveInput.hidden = true;
    for (const type of ["keydown", "keyup", "keypress"]) {
      saveInput.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type !== "keydown") return;
        if (event.key === "Enter") {
          event.preventDefault();
          closeSave(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeSave(false);
        }
      });
    }
    saveInput.addEventListener("blur", () => closeSave(false));
    note = el("span", "stg-mb-note");
    note.hidden = true;
    meta.append(world, presetBox, saveButton, saveInput, note, activeLabel);
    if (packs) meta.appendChild(packs.toggle);

    snapshot = el("div", "stg-mb-snap");
    snapshot.hidden = true;
    snapshot.setAttribute("role", "tooltip");
    dock.append(row, meta);
    if (packs) dock.appendChild(packs.section);
    dock.appendChild(snapshot);
    dock.addEventListener("mouseenter", () => setHover("dock", true));
    dock.addEventListener("mouseleave", () => setHover("dock", false));
    document.body.appendChild(dock);
  }

  function setStyle(node, name, value) {
    if (node.style[name] !== value) node.style[name] = value;
  }

  function layout() {
    layoutQueued = false;
    const area = findTextarea();
    if (area !== textarea) {
      if (textarea) {
        textarea.removeEventListener("input", onPromptInput);
        textarea.removeEventListener("pointerdown", engage);
        textarea.removeEventListener("keydown", engage);
      }
      textarea = area;
      if (textarea) {
        textarea.addEventListener("input", onPromptInput);
        textarea.addEventListener("pointerdown", engage);
        textarea.addEventListener("keydown", engage);
      }
      freshPrompt = !textarea || !wordsOf(textarea.value);
      forgetPanel();
      syncActive();
    }
    // A submit empties the prompt without an input event: notice it here.
    if (textarea && !wordsOf(textarea.value) && !freshPrompt) {
      freshPrompt = true;
      syncActive();
    }
    const bar = findBar(textarea);
    if (!bar) {
      if (dock) dock.hidden = true;
      hideSnapshot();
      wasShown = false;
      return;
    }
    if (!dock || !dock.isConnected) {
      dropDock();
      buildDock();
      render();
      renderPresets();
    }
    if (!isComposing()) {
      dock.hidden = true;
      hideSnapshot();
      wasShown = false;
      return;
    }
    if (!wasShown) {
      wasShown = true;
      refreshIfStale();
    }
    const rect = bar.getBoundingClientRect();
    dock.hidden = false;
    // Keep the dock last in the document so the image grid cannot paint over
    // it. Only the queue panel sits after it: an open queue covers the dock.
    const queueRoot = document.querySelector("body > .stg-q-root");
    if (
      dock.parentElement === document.body &&
      (queueRoot ? dock.nextElementSibling !== queueRoot : dock !== document.body.lastElementChild)
    ) {
      document.body.insertBefore(dock, queueRoot);
    }
    setStyle(dock, "left", `${Math.round(rect.left)}px`);
    setStyle(dock, "width", `${Math.round(rect.width)}px`);
    // Midjourney's settings panel is open: sit past it, or step aside.
    const panel = promptPanel(textarea);
    const above = panel ? !panel.below : rect.top > window.innerHeight * 0.5;
    const edgeTop = panel ? panel.top : rect.top;
    const edgeBottom = panel ? panel.bottom : rect.bottom;
    dock.classList.toggle("stg-mb-dock--above", above);
    // Bottom prompt (narrow): sit above it. Top prompt (wide): sit under it.
    if (above) {
      setStyle(dock, "top", "auto");
      setStyle(dock, "bottom", `${Math.round(window.innerHeight - edgeTop + DOCK_GAP_PX)}px`);
    } else {
      setStyle(dock, "bottom", "auto");
      setStyle(dock, "top", `${Math.round(edgeBottom + DOCK_GAP_PX)}px`);
    }
    if (panel) {
      const placed = dock.getBoundingClientRect();
      dock.hidden = placed.top < 0 || placed.bottom > window.innerHeight;
    }
    dock.dataset.panel = panel ? "open" : "";
    // A flag cut down to a few letters says nothing: hide it until there is room.
    const clipped = activeLabel.scrollWidth > activeLabel.clientWidth + 1 && activeLabel.clientWidth < 90;
    activeLabel.classList.toggle("stg-mb-active--clipped", clipped);
  }

  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(layout);
  }

  function start() {
    dropDock();
    try {
      chrome.storage.local.get([WORLD_STORAGE_KEY, STICKY_STORAGE_KEY], (stored) => {
        state.worldKey = String(stored?.[WORLD_STORAGE_KEY] || "");
        const sticky = stored?.[STICKY_STORAGE_KEY];
        state.sticky = sticky && typeof sticky === "object" ? sticky : {};
        refresh().then(loadPresets);
      });
    } catch {
      refresh();
    }
    // Midjourney changes the page all the time (the grid loads, jobs
    // progress). While no prompt is being written and the prompt box is still
    // there, those changes need no work at all.
    new MutationObserver((records) => {
      if (dock && records.every((record) => dock.contains(record.target))) return;
      if (textarea && textarea.isConnected && dock && dock.hidden && !isComposing()) {
        if (!freshPrompt && !wordsOf(textarea.value)) freshPrompt = true;
        return;
      }
      queueLayout();
    }).observe(document.body, { childList: true, subtree: true });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" || !changes[presetKey()]) return;
        const list = changes[presetKey()].newValue;
        state.presets = Array.isArray(list) ? list : [];
        renderPresets();
        syncActive();
      });
    } catch {
      // extension reloaded
    }
    window.addEventListener("resize", () => {
      forgetPanel();
      queueLayout();
    });
    document.addEventListener("pointerup", forgetPanel, true);
    document.addEventListener("focusin", () => {
      forgetPanel();
      notifyCompose();
    });
    document.addEventListener("focusout", (event) => {
      // Leaving the prompt for the page (not for the dock) ends the writing.
      const next = event.relatedTarget;
      if (event.target === textarea && !(next && next.closest && next.closest(".stg-mb-dock"))) {
        compose.engaged = false;
      }
      compose.holdUntil = Date.now() + COMPOSE_HOLD_MS;
      notifyCompose();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshIfStale();
    });
    queueLayout();
  }

  start();
})(typeof globalThis !== "undefined" ? globalThis : self);
