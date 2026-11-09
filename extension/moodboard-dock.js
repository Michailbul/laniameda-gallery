(function registerMoodboardDock(globalScope) {
  "use strict";

  const WORLD_STORAGE_KEY = "stgMoodboardWorld";
  const STICKY_STORAGE_KEY = "stgMoodboardSticky";
  const PRESETS_STORAGE_PREFIX = "stgMjPresets:";
  const PINS_STORAGE_PREFIX = "stgMjProfilePins:";
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

  // A world with many boards shows them by family, one line each.
  const GROUP_FROM = 9;

  // Boards fall into families by the part of their name before "·":
  // "DA FILM · Couture" is in FILM, "DA HALLOWEEN · Candle" in HALLOWEEN.
  // A short world prefix (DA, AN) is dropped. A family of one board, and a
  // board without a family, go last under "More". A world with fewer than
  // GROUP_FROM boards, or with one family, is one line without a label.
  function groupBoards(boards) {
    const all = Array.isArray(boards) ? boards : [];
    if (all.length < GROUP_FROM) return all.length ? [{ label: "", boards: all.slice() }] : [];
    const groups = [];
    const byLabel = new Map();
    const loose = [];
    for (const board of all) {
      const name = String((board && board.name) || "");
      const cut = name.indexOf("·");
      let label = cut < 0 ? "" : name.slice(0, cut).trim();
      const words = label.split(/\s+/).filter(Boolean);
      if (words.length > 1 && words[0].length <= 3) words.shift();
      else if (words.length === 1 && words[0].length <= 3) words.length = 0;
      label = words.join(" ").toUpperCase();
      if (!label) {
        loose.push(board);
        continue;
      }
      if (!byLabel.has(label)) {
        const group = { label, boards: [] };
        byLabel.set(label, group);
        groups.push(group);
      }
      byLabel.get(label).boards.push(board);
    }
    const families = groups.filter((group) => group.boards.length > 1);
    for (const group of groups) if (group.boards.length === 1) loose.push(group.boards[0]);
    if (families.length < 2 && !(families.length === 1 && loose.length)) {
      return [{ label: "", boards: all.slice() }];
    }
    const order = new Map(all.map((board, index) => [board, index]));
    loose.sort((a, b) => order.get(a) - order.get(b));
    if (loose.length) families.push({ label: "MORE", boards: loose });
    return families;
  }

  // "DA v8.2" and "da-v8.2" are the same profile name for pinning.
  const profileKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // The profiles Michael reaches for first in a world, in his order. The rest
  // of the world's profiles follow, quieter. Shift-click changes the list.
  const DEFAULT_PROFILE_PINS = {
    "dear-annete": ["da4", "da5", "dav3", "dav82", "dearannette2", "cinematic", "locations"],
  };

  // Splits profiles into the pinned (in pin order) and the rest (in their
  // own order). With no pin matching, every profile is main.
  function orderProfiles(profiles, pins) {
    const list = Array.isArray(profiles) ? profiles : [];
    const keys = (pins || []).map(profileKey).filter(Boolean);
    const main = [];
    for (const key of keys) {
      const found = list.find((profile) => profileKey(profile.name) === key);
      if (found && !main.includes(found)) main.push(found);
    }
    if (!main.length) return { main: list.slice(), more: [] };
    return { main, more: list.filter((profile) => !main.includes(profile)) };
  }

  globalScope.SaveToGalleryMoodboardDock = {
    groupBoards,
    orderProfiles,
    profileKey,
    DEFAULT_PROFILE_PINS,
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
    // The world's gallery style presets a chip can set (codes + settings);
    // dock presets are copied to the gallery so prompt runs can use them.
    galleryPresets: [],
    // The world's main profiles as Michael set them (shift-click); null
    // means the built-in list for the world.
    pins: null,
    // The keys as set in the side panel (mj-hotkeys.js resolve()).
    hotkeys: null,
  };
  const INSTANCE = Math.random().toString(36).slice(2, 10);
  let observer = null;
  let dock = null;
  let worldButton = null;
  let worldMenu = null;
  let worldMenuIndex = -1;
  let hotkeyMap = new Map();
  let hintTimer = null;
  let activeLabel = null;
  let strip = null;
  let profileStrip = null;
  let boardRow = null;
  let profileRow = null;
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

  // This copy's own dock only. A copy left behind by an extension update in
  // an open tab keeps its dock, hidden by the rule below, so the two never
  // remove each other's dock in a loop.
  function dropDock() {
    dock?.remove();
    snapshot?.remove();
    dock = null;
    snapshot = null;
    packs = null;
  }

  // An update injects a fresh copy into open Midjourney tabs. Docks and quick
  // edit boxes of older copies hide; the old packs bar (before 0.24) too.
  function hideOlderCopies() {
    const rule = `.stg-mb-dock:not([data-stg-instance="${INSTANCE}"]),.stg-mb-snap:not([data-stg-instance="${INSTANCE}"]),.stg-pp-bar{display:none!important}`;
    let style = document.getElementById("stg-mb-retire");
    if (!style) {
      style = document.createElement("style");
      style.id = "stg-mb-retire";
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = rule;
    globalScope.SaveToGalleryMoodboardDock.instance = INSTANCE;
  }

  // The extension was reloaded or updated under this tab: this copy is dead.
  // Take its dock away and stop watching the page.
  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    observer?.disconnect();
    window.removeEventListener("keydown", onHotkeyDown, true);
    window.removeEventListener("keyup", onHotkeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
    if (textarea) {
      textarea.removeEventListener("input", onPromptInput);
      textarea.removeEventListener("pointerdown", engage);
      textarea.removeEventListener("keydown", engage);
    }
    dropDock();
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
    const galleryPresets = Array.isArray(res.galleryPresets) ? res.galleryPresets : [];
    if (JSON.stringify(galleryPresets) !== JSON.stringify(state.galleryPresets)) {
      state.galleryPresets = galleryPresets;
      renderPresets();
    }
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
  function onPromptInput(event) {
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
      // Pasted or dropped text is a finished prompt: it keeps its own
      // settings and gets no packs; only missing settings are filled in.
      const typed = !/paste|drop|replacement/i.test((event && event.inputType) || "");
      const options = { onlyMissing: true, packs: typed };
      const extras = Boolean(sticky.params) || (typed && (sticky.packs || []).length > 0);
      if (withStickyFlag(value, codes) || extras) {
        // Runs after Midjourney has handled the keystroke. Uses the text as it
        // is by then, so fast typing never loses the flag.
        setTimeout(() => {
          if (!textarea || !textarea.isConnected) return;
          const base = textarea.value;
          const next = withPresetExtras(withStickyFlag(base, codes) ?? base, sticky, options);
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
    for (const chip of strip.querySelectorAll(".stg-mb-chip")) {
      const on = active.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-chip--on", on);
      chip.classList.toggle("stg-mb-chip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const chip of profileStrip.querySelectorAll(".stg-mb-pchip")) {
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
      const preset = allPresets().find((entry) => entry.id === chip.dataset.id);
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
  const pinKey = (world = state.worldKey) => `${PINS_STORAGE_PREFIX}${world}`;
  const pinsFor = () => state.pins || DEFAULT_PROFILE_PINS[state.worldKey] || [];

  // Shift-click moves a profile into the main group or back out of it.
  function togglePin(profile) {
    const { main, more } = orderProfiles(state.profiles, pinsFor());
    const key = profileKey(profile.name);
    const pinned = more.length > 0 && main.includes(profile);
    const current = more.length ? main.map((entry) => profileKey(entry.name)) : [];
    state.pins = pinned ? current.filter((entry) => entry !== key) : [...current, key];
    try {
      chrome.storage.sync.set({ [pinKey()]: state.pins });
    } catch {
      // storage unavailable after an extension reload
    }
    render();
    showNote(pinned ? `${profile.name} moved to more` : `${profile.name} moved to main`);
  }
  const packsApi = () => globalScope.SaveToGalleryPromptPacks;
  function packPhrase(id) {
    for (const group of globalScope.SaveToGalleryPromptPackData || []) {
      const pack = group.packs.find((entry) => entry.id === id);
      if (pack) return pack;
    }
    return null;
  }

  // The settings and packs of a preset go into a prompt that has words: the
  // settings at the end, the packs after the words. A click on a preset sets
  // its values; carried into the next prompt (onlyMissing) it only fills in
  // settings the prompt does not have yet.
  function withPresetExtras(text, preset, options = {}) {
    let next = text;
    let params = preset.params || "";
    if (options.onlyMissing && params) {
      const have = new Set(parseParams(next).map((param) => param.key));
      params = parseParams(params).filter((param) => !have.has(param.key)).map((param) => param.text).join(" ");
    }
    if (params && !hasParams(next, params)) next = setParams(next, params);
    if (options.packs === false) return next;
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

  // Dock presets go to the gallery too (style presets of the world), so a
  // prompt run can use them. Sent only when the list changed.
  let syncedPresets = "";
  function syncPresetsToGallery(world, list) {
    const signature = JSON.stringify([world, list]);
    if (!world || signature === syncedPresets || !extensionAlive()) return;
    syncedPresets = signature;
    try {
      chrome.runtime.sendMessage({ action: "syncDockPresets", world, presets: list }, () => void chrome.runtime.lastError);
    } catch {
      // extension reloaded
    }
  }
  const allPresets = () => [...state.presets, ...state.galleryPresets.filter((entry) => !state.presets.some((own) => own.name === entry.name))];

  function storePresets(list) {
    state.presets = list;
    syncPresetsToGallery(state.worldKey, list);
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
      chrome.storage.sync.get([presetKey(world), pinKey(world)], (stored) => {
        if (world !== state.worldKey) return;
        const list = stored?.[presetKey(world)];
        state.presets = Array.isArray(list) ? list : [];
        syncPresetsToGallery(world, state.presets);
        const pins = stored?.[pinKey(world)];
        state.pins = Array.isArray(pins) ? pins : null;
        renderPresets();
        render();
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
    const signature = JSON.stringify([state.worldKey, state.presets, state.galleryPresets]);
    if (presetBox.dataset.signature === signature) return;
    presetBox.dataset.signature = signature;
    presetBox.textContent = "";
    for (const preset of allPresets()) {
      const chip = el("button", `stg-mb-preset${preset.gallery ? " stg-mb-preset--gallery" : ""}`);
      chip.type = "button";
      chip.dataset.id = preset.id;
      chip.title = `${preset.gallery ? "Gallery preset · " : ""}${preset.name}\n${presetSpec(preset)}`;
      chip.append(el("span", "stg-mb-preset-name", preset.name));
      if (!preset.gallery) {
        const remove = el("span", "stg-mb-preset-x", "×");
        remove.title = "Delete preset";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deletePreset(preset);
        });
        chip.append(remove);
      }
      chip.addEventListener("mousedown", (event) => event.preventDefault());
      chip.addEventListener("click", () => onPresetClick(preset));
      chip.addEventListener("mouseenter", () => showPresetCard(preset, chip));
      chip.addEventListener("mouseleave", hideSnapshot);
      presetBox.appendChild(chip);
    }
    syncKeyBadges();
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

  // The world picker is the dock's own list, not a native <select>: the
  // dock moves itself to stay above the page, and a move closed the native
  // list the moment it opened. Its buttons never take focus from the prompt.
  function dockWorlds() {
    return state.worlds.length ? state.worlds : state.worldKey ? [{ key: state.worldKey, name: state.worldKey }] : [];
  }

  function renderWorlds() {
    const signature = JSON.stringify([state.worlds.map((world) => [world.key, world.name]), state.worldKey]);
    if (worldButton.dataset.signature === signature) return;
    worldButton.dataset.signature = signature;
    const worlds = dockWorlds();
    const current = worlds.find((world) => world.key === state.worldKey);
    worldButton.textContent = worldLabel(current ? current.name : state.worldKey || "World");
    worldButton.title = `${current?.name || "Gallery world"}${hotkeyHint("world:pick")}`;
    worldMenu.textContent = "";
    for (const world of worlds) {
      const item = el("button", "stg-mb-witem", world.name);
      item.type = "button";
      item.dataset.key = world.key;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", world.key === state.worldKey ? "true" : "false");
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        closeWorldMenu();
        setWorld(world.key);
      });
      worldMenu.appendChild(item);
    }
  }

  function worldMenuOpen() {
    return Boolean(worldMenu && !worldMenu.hidden);
  }

  function openWorldMenu() {
    if (!worldMenu || !worldButton) return;
    hideSnapshot();
    worldMenu.hidden = false;
    worldButton.setAttribute("aria-expanded", "true");
    const items = [...worldMenu.children];
    worldMenuIndex = Math.max(0, items.findIndex((item) => item.dataset.key === state.worldKey));
    highlightWorldItem();
    placeWorldMenu();
  }

  function closeWorldMenu() {
    if (!worldMenu || worldMenu.hidden) return;
    worldMenu.hidden = true;
    worldButton?.setAttribute("aria-expanded", "false");
    worldMenuIndex = -1;
  }

  function highlightWorldItem() {
    const items = [...worldMenu.children];
    items.forEach((item, index) => item.classList.toggle("stg-mb-witem--hot", index === worldMenuIndex));
    items[worldMenuIndex]?.scrollIntoView({ block: "nearest" });
  }

  // Opens away from the prompt, and flips when that side has no room.
  function placeWorldMenu() {
    if (!worldMenuOpen() || !worldButton.isConnected) return;
    const rect = worldButton.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const wantUp = dock.classList.contains("stg-mb-dock--above");
    const up = wantUp ? spaceAbove >= 160 || spaceAbove > spaceBelow : spaceBelow < 160 && spaceAbove > spaceBelow;
    worldMenu.style.maxHeight = `${Math.max(120, Math.min(360, up ? spaceAbove : spaceBelow))}px`;
    const width = worldMenu.offsetWidth;
    worldMenu.style.left = `${Math.round(Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)))}px`;
    if (up) {
      worldMenu.style.top = "auto";
      worldMenu.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
    } else {
      worldMenu.style.bottom = "auto";
      worldMenu.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
  }

  function setWorld(key) {
    if (!key || key === state.worldKey) return;
    state.worldKey = key;
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
    state.pins = null;
    render();
    renderPresets();
    loadPresets();
    refresh();
  }

  function stepWorld(delta) {
    const worlds = dockWorlds();
    if (worlds.length < 2) return;
    const index = worlds.findIndex((world) => world.key === state.worldKey);
    const next = worlds[(index + delta + worlds.length) % worlds.length];
    setWorld(next.key);
    showNote(next.name);
  }

  // Keys (mj-hotkeys.js, set in the side panel's MJ settings tab): the Nth
  // moodboard, profile or preset as the dock shows them, worlds, Save.
  // They work while the dock is on screen; only the copy whose dock shows
  // answers, so two loaded copies never toggle a code twice.
  const hotkeysApi = () => globalScope.SaveToGalleryHotkeys;

  function applyHotkeys(raw) {
    const api = hotkeysApi();
    if (!api) return;
    state.hotkeys = api.resolve(raw);
    hotkeyMap = api.comboMap(state.hotkeys);
    if (worldButton) worldButton.dataset.signature = "";
    if (dock) render();
  }

  function loadHotkeys() {
    const api = hotkeysApi();
    if (!api) return;
    try {
      chrome.storage.sync.get(api.STORAGE_KEY, (stored) => applyHotkeys(stored?.[api.STORAGE_KEY]));
    } catch {
      applyHotkeys(null);
    }
  }

  function hotkeyLabel(id) {
    const api = hotkeysApi();
    const combo = api && state.hotkeys?.enabled ? state.hotkeys.bindings[id] : "";
    return combo ? api.formatCombo(combo) : "";
  }

  function hotkeyHint(id) {
    const label = hotkeyLabel(id);
    return label ? `\nKey: ${label}` : "";
  }

  function setKeyBadge(node, id) {
    const label = hotkeyLabel(id);
    if (label) {
      if (node.dataset.key !== label) node.dataset.key = label;
    } else if (node.dataset.key) {
      delete node.dataset.key;
    }
  }

  function syncKeyBadges() {
    if (!dock) return;
    strip.querySelectorAll(".stg-mb-chip").forEach((chip, index) => setKeyBadge(chip, `board:${index + 1}`));
    profileStrip.querySelectorAll(".stg-mb-pchip").forEach((chip, index) => setKeyBadge(chip, `profile:${index + 1}`));
    presetBox.querySelectorAll(".stg-mb-preset").forEach((chip, index) => setKeyBadge(chip, `preset:${index + 1}`));
    setKeyBadge(saveButton, "preset:save");
  }

  function dockOnScreen() {
    return Boolean(dock && !dock.hidden && dock.isConnected && dock.getClientRects().length);
  }

  function flashChip(chip) {
    if (!chip) return;
    chip.classList.remove("stg-mb-flash");
    void chip.offsetWidth;
    chip.classList.add("stg-mb-flash");
    setTimeout(() => chip.classList.remove("stg-mb-flash"), 500);
  }

  function runHotkey(action) {
    if (action === "world:prev") return stepWorld(-1);
    if (action === "world:next") return stepWorld(1);
    if (action === "world:pick") return worldMenuOpen() ? closeWorldMenu() : openWorldMenu();
    if (action === "preset:save") return openSave();
    const [kind, arg] = action.split(":");
    const slot = Number(arg);
    if (kind === "board") {
      const chip = strip.querySelectorAll(".stg-mb-chip")[slot - 1];
      const board = chip && state.moodboards.find((entry) => entry.mjCode === chip.dataset.code);
      if (!board) return showNote(`No moodboard ${slot} in this world`);
      onChipClick(board);
      flashChip(chip);
    } else if (kind === "profile") {
      const chip = profileStrip.querySelectorAll(".stg-mb-pchip")[slot - 1];
      const profile = chip && state.profiles.find((entry) => entry.code === chip.dataset.code);
      if (!profile) return showNote(`No profile ${slot} in this world`);
      onProfileClick(profile);
      flashChip(chip);
    } else if (kind === "preset") {
      const preset = allPresets()[slot - 1];
      if (!preset) return showNote(`No preset ${slot} yet`);
      onPresetClick(preset);
      flashChip(presetBox.querySelector(`.stg-mb-preset[data-id="${CSS.escape(preset.id)}"]`));
    }
  }

  function handleWorldMenuKey(event) {
    const items = [...worldMenu.children];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        worldMenuIndex = (worldMenuIndex + step + items.length) % items.length;
        highlightWorldItem();
      }
    } else if (event.key === "Enter") {
      const key = items[worldMenuIndex]?.dataset.key;
      closeWorldMenu();
      if (key) setWorld(key);
    } else if (event.key === "Escape" || event.key === "Tab") {
      closeWorldMenu();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  const TYPING_TARGET = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
  const HINT_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

  function showKeyHints(on) {
    clearTimeout(hintTimer);
    if (!dock) return;
    if (!on) {
      dock.classList.remove("stg-mb-dock--keys");
      return;
    }
    hintTimer = setTimeout(() => {
      if (dockOnScreen() && hotkeyMap.size) dock.classList.add("stg-mb-dock--keys");
    }, 220);
  }

  function onHotkeyDown(event) {
    if (retired || !dock) return;
    if (worldMenuOpen() && dockOnScreen() && handleWorldMenuKey(event)) return;
    if (HINT_KEYS.has(event.key)) {
      if (event.key !== "Shift" || event.altKey || event.ctrlKey || event.metaKey) showKeyHints(true);
      return;
    }
    showKeyHints(false);
    if (!hotkeyMap.size || event.isComposing) return;
    const combo = hotkeysApi()?.comboFromEvent(event);
    const action = combo && hotkeyMap.get(combo);
    if (!action || !dockOnScreen() || !textarea || !textarea.isConnected) return;
    const active = document.activeElement;
    if (active && active !== textarea && active.matches && active.matches(TYPING_TARGET)) return;
    if (!extensionAlive()) {
      retire();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) runHotkey(action);
  }

  function onWindowBlur() {
    showKeyHints(false);
  }

  function onHotkeyUp(event) {
    if (HINT_KEYS.has(event.key) && !(event.altKey || event.ctrlKey || event.metaKey)) showKeyHints(false);
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
    else if (!state.moodboards.length) message = "None with a Midjourney code in this world yet.";
    statusLine.textContent = message;
    statusLine.hidden = !message;
    statusLine.classList.toggle("stg-mb-status--error", Boolean(state.error));
    packs?.setEnabled(worldHasPacks(state.worldKey));

    const pins = pinsFor();
    const signature = `${state.signature}|${pins.join(",")}`;
    if (strip.dataset.signature !== signature) {
      strip.dataset.signature = signature;
      strip.textContent = "";
      hideSnapshot();
      // One line per family (FILM, HALLOWEEN …), its name as the line's label.
      for (const group of groupBoards(state.moodboards)) {
        const line = el("div", "stg-mb-row stg-mb-group");
        const chips = el("div", "stg-mb-chips");
        for (const board of group.boards) chips.appendChild(boardChip(board, group.boards));
        line.append(el("span", group.label ? "stg-mb-label stg-mb-label--family" : "stg-mb-label", group.label || "Moodboards"), chips);
        strip.appendChild(line);
      }
      profileStrip.textContent = "";
      const { main, more } = orderProfiles(state.profiles, pins);
      for (const profile of main) profileStrip.appendChild(profileChip(profile, more.length > 0));
      if (more.length) {
        const rest = el("div", "stg-mb-more");
        for (const profile of more) rest.appendChild(profileChip(profile, false, true));
        profileStrip.appendChild(rest);
      }
    }
    boardRow.hidden = !message;
    profileRow.hidden = !state.profiles.length;
    syncActive();
    syncKeyBadges();
  }

  function boardChip(board, siblings) {
    const chip = el("button", "stg-mb-chip");
    const thumb = board.thumbUrl || (board.previews && board.previews[0] && board.previews[0].thumbUrl);
    if (thumb) {
      const img = el("img", "stg-mb-thumb");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove(), { once: true });
      img.src = thumb;
      chip.appendChild(img);
    }
    chip.appendChild(el("span", "stg-mb-chip-name", chipLabel(board, siblings)));
    chip.type = "button";
    chip.dataset.code = board.mjCode;
    chip.title = [board.name, board.collection, board.flag].filter(Boolean).join("\n");
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", () => onChipClick(board));
    chip.addEventListener("mouseenter", () => showSnapshot(board, chip));
    chip.addEventListener("focus", () => showSnapshot(board, chip));
    chip.addEventListener("mouseleave", hideSnapshot);
    chip.addEventListener("blur", hideSnapshot);
    return chip;
  }

  function profileChip(profile, pinned, quiet) {
    const chip = el("button", quiet ? "stg-mb-pchip stg-mb-pchip--more" : "stg-mb-pchip", profile.name);
    chip.type = "button";
    chip.dataset.code = profile.code;
    const hint = pinned ? "Shift-click: move to more" : quiet ? "Shift-click: move to main" : "Shift-click: pin first";
    chip.title = [profile.name, profile.role, profile.flag, hint].filter(Boolean).join("\n");
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => (event.shiftKey ? togglePin(profile) : onProfileClick(profile)));
    chip.addEventListener("mouseenter", () => showProfileCard(profile, chip));
    chip.addEventListener("focus", () => showProfileCard(profile, chip));
    chip.addEventListener("mouseleave", hideSnapshot);
    chip.addEventListener("blur", hideSnapshot);
    return chip;
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
    dock.dataset.stgInstance = INSTANCE;
    dock.hidden = true;
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Gallery moodboards");
    const world = el("div", "stg-mb-worldbox");
    worldButton = el("button", "stg-mb-world", "World");
    worldButton.type = "button";
    worldButton.setAttribute("aria-label", "Gallery world");
    worldButton.setAttribute("aria-haspopup", "listbox");
    worldButton.setAttribute("aria-expanded", "false");
    worldButton.addEventListener("mousedown", (event) => event.preventDefault());
    worldButton.addEventListener("click", () => (worldMenuOpen() ? closeWorldMenu() : openWorldMenu()));
    worldMenu = el("div", "stg-mb-wmenu");
    worldMenu.dataset.stgInstance = INSTANCE;
    worldMenu.setAttribute("role", "listbox");
    worldMenu.setAttribute("aria-label", "Gallery worlds");
    worldMenu.hidden = true;
    const refreshButton = el("button", "stg-mb-refresh", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Refresh moodboards";
    refreshButton.setAttribute("aria-label", "Refresh moodboards");
    refreshButton.addEventListener("mousedown", (event) => event.preventDefault());
    refreshButton.addEventListener("click", () => refresh({ manual: true }));
    world.append(worldButton, refreshButton);

    statusLine = el("span", "stg-mb-status");
    strip = el("div", "stg-mb-strip");
    profileStrip = el("div", "stg-mb-pstrip");
    activeLabel = el("span", "stg-mb-active");
    const createSection = globalScope.SaveToGalleryPromptPacks?.createSection;
    packs =
      typeof createSection === "function"
        ? createSection({ getTextarea: () => textarea, onResize: queueLayout })
        : null;
    // Next to the prompt, the main thing: moodboards by family, with a small
    // cover each, then profiles (the world's main ones first).
    boardRow = el("div", "stg-mb-row stg-mb-row--boards");
    boardRow.append(el("span", "stg-mb-label", "Moodboards"), statusLine);
    profileRow = el("div", "stg-mb-row stg-mb-row--profiles");
    profileRow.hidden = true;
    profileRow.append(el("span", "stg-mb-label", "Profiles"), profileStrip);

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
    snapshot.dataset.stgInstance = INSTANCE;
    snapshot.hidden = true;
    snapshot.setAttribute("role", "tooltip");
    dock.append(boardRow, strip, profileRow, meta);
    if (packs) dock.appendChild(packs.section);
    dock.appendChild(snapshot);
    dock.appendChild(worldMenu);
    dock.addEventListener("mouseenter", () => setHover("dock", true));
    dock.addEventListener("mouseleave", () => setHover("dock", false));
    document.body.appendChild(dock);
  }

  function setStyle(node, name, value) {
    if (node.style[name] !== value) node.style[name] = value;
  }

  function layout() {
    layoutQueued = false;
    if (retired) return;
    if (!extensionAlive()) {
      retire();
      return;
    }
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
      closeWorldMenu();
      showKeyHints(false);
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
    placeWorldMenu();
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
    hideOlderCopies();
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
    observer = new MutationObserver((records) => {
      if (dock && records.every((record) => dock.contains(record.target))) return;
      if (textarea && textarea.isConnected && dock && dock.hidden && !isComposing()) {
        if (!freshPrompt && !wordsOf(textarea.value)) freshPrompt = true;
        return;
      }
      queueLayout();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    loadHotkeys();
    window.addEventListener("keydown", onHotkeyDown, true);
    window.addEventListener("keyup", onHotkeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!worldMenuOpen()) return;
        if (worldMenu.contains(event.target) || worldButton.contains(event.target)) return;
        closeWorldMenu();
      },
      true,
    );
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        const hotkeysKey = hotkeysApi()?.STORAGE_KEY;
        if (hotkeysKey && changes[hotkeysKey]) applyHotkeys(changes[hotkeysKey].newValue);
        if (changes[pinKey()]) {
          const pins = changes[pinKey()].newValue;
          state.pins = Array.isArray(pins) ? pins : null;
          render();
        }
        if (!changes[presetKey()]) return;
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
