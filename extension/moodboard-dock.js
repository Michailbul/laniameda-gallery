(function registerMoodboardDock(globalScope) {
  "use strict";

  const WORLD_STORAGE_KEY = "stgMoodboardWorld";
  const STICKY_STORAGE_KEY = "stgMoodboardSticky";
  const PRESETS_STORAGE_PREFIX = "stgMjPresets:";
  const PINS_STORAGE_PREFIX = "stgMjProfilePins:";
  const OTHERS_STORAGE_KEY = "stgMbOthersOpen";
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

  // The flag a new prompt gets from the remembered selection: the board codes
  // first (one, or two after an extreme mix), then the profiles, each only
  // while it still exists in the world.
  function stickyCodes(sticky, moodboardCodes, profileCodes) {
    const boards = new Set(moodboardCodes || []);
    const profiles = new Set(profileCodes || []);
    const codes = [];
    const wanted = sticky && Array.isArray(sticky.boards) ? sticky.boards : sticky && sticky.board ? [sticky.board] : [];
    for (const code of wanted) {
      if (boards.has(code) && !codes.includes(code)) codes.push(code);
    }
    for (const code of (sticky && sticky.profiles) || []) {
      if (profiles.has(code) && !codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  // The remembered selection per world is the board(s) and profiles only.
  // Older versions also kept the last preset's settings and packs there and
  // added them to every new prompt (Michael, 17 Nov 2026: presets applied
  // themselves); those are dropped when the stored value is read.
  function cleanSticky(stored) {
    const out = {};
    if (!stored || typeof stored !== "object") return out;
    const codesOf = (list) => (Array.isArray(list) ? list.filter((code) => typeof code === "string" && code) : []);
    for (const [world, entry] of Object.entries(stored)) {
      if (!entry || typeof entry !== "object") continue;
      const boards = Array.isArray(entry.boards) ? codesOf(entry.boards) : entry.board ? codesOf([entry.board]) : [];
      out[world] = { board: boards[0] || null, boards, profiles: codesOf(entry.profiles) };
    }
    return out;
  }

  const wordsOf = (value) => String(value || "").replace(PROFILE_FLAG_PATTERN, "").trim();

  // How a change of the prompt came about. Only Michael's own keystrokes
  // into an empty prompt start a new prompt ("typed"). Pasted or dropped
  // text, autocorrect, and text the extension or Midjourney puts in the bar
  // (queue, Grow, quick edit, packs, Use prompt) are "injected": they get
  // nothing added. `before` is the prompt just before a trusted change (from
  // beforeinput), or null when no trusted change was announced.
  const TYPED_INPUT = /^insert(Text|CompositionText)$/;
  function promptChange(before, after, event) {
    if (!wordsOf(after)) return "empty";
    if (before == null) return "injected";
    if (wordsOf(before)) return "edit";
    const info = event || {};
    if (info.isTrusted === true && !info.isComposing && TYPED_INPUT.test(String(info.inputType || ""))) return "typed";
    return "injected";
  }

  // The pool the randomizer (⌥R, ⟳ Random) picks from: the world's live
  // profiles and its moodboards, with the names the dock shows.
  function mixPool(profiles, moodboards) {
    const names = {};
    const profileList = [];
    for (const profile of liveProfiles(profiles)) {
      profileList.push(profile.code);
      names[profile.code] = profile.name || profile.code;
    }
    const boards = [];
    const boardList = Array.isArray(moodboards) ? moodboards.filter((board) => board && board.mjCode) : [];
    for (const board of boardList) {
      boards.push(board.mjCode);
      names[board.mjCode] = chipLabel(board, boardList);
    }
    return { profiles: profileList, boards, names };
  }

  // "CINEMATIC + DA4 · moodboard Night"
  function mixLabel(mix, names) {
    const name = (code) => (names && names[code]) || code;
    const parts = [];
    if (mix && mix.profiles && mix.profiles.length) parts.push(mix.profiles.map(name).join(" + "));
    if (mix && mix.boards && mix.boards.length) {
      parts.push(`${mix.boards.length > 1 ? "moodboards" : "moodboard"} ${mix.boards.map(name).join(" + ")}`);
    }
    return parts.join(" · ") || "No profile";
  }

  // A new mix for the prompt: different from `currentCodes` when the pool
  // allows it. The prompt keeps its words and every other setting; only its
  // profile flag changes. An empty prompt gets no text (the mix is armed).
  function rerollPrompt(promptText, currentCodes, pool, mode, rng) {
    const api = globalScope.SaveToGalleryRandomize;
    if (!api) return null;
    const mix = api.pickMix(pool, mode, { avoid: api.signature(currentCodes || []), rng });
    if (!mix.codes.length) return null;
    if (!wordsOf(promptText)) return { mix, text: null };
    // A flag already in the prompt keeps its place; a new one goes before the
    // other settings.
    const text = flagCodes(promptText).length ? setProfileFlag(promptText, mix.codes) : api.withCodes(promptText, mix.codes);
    return { mix, text };
  }

  // Inputs, text areas and editable boxes, also inside another extension
  // panel's shadow root (the key event's real target).
  const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);
  function isTypingElement(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.isContentEditable) return true;
    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !NON_TEXT_INPUTS.has(String(node.type || "text").toLowerCase());
  }

  // Why a key press must not run a dock action; "" when it may. Only
  // Michael's own presses count, never while an input method is composing,
  // never AltGr typing a letter (Windows), never while he types into any box
  // other than the Imagine prompt (Midjourney's search, the queue, quick
  // edit, Grow).
  function hotkeyVeto(event, prompt, options = {}) {
    if (!event) return "none";
    if (event.isTrusted === false) return "synthetic";
    if (event.isComposing || event.keyCode === 229) return "composing";
    if (!options.mac && typeof event.getModifierState === "function" && event.getModifierState("AltGraph")) return "altgraph";
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path[0] || event.target;
    if (target && target !== prompt && isTypingElement(target)) return "typing";
    return "";
  }

  // What one Esc closes: every open piece of the dock (world list, preset
  // name box, hover sheet, other worlds) at once; the dock itself only when
  // none is open. A note always goes with it.
  const ESC_PIECES = ["menu", "save", "snapshot", "others"];
  function escapePlan(open) {
    const state = open || {};
    const pieces = ESC_PIECES.filter((piece) => state[piece]);
    if (!pieces.length && state.dock) pieces.push("dock");
    if (state.note) pieces.push("note");
    return pieces;
  }

  // Nodes left by an older copy of this script (an extension reload or
  // update injects a fresh copy into the open tab). Ours carry our instance.
  const STALE_SELECTOR = ".stg-mb-dock, .stg-mb-snap, .stg-mb-wmenu, .stg-pp-bar";
  function removeStaleNodes(root, instance) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let removed = 0;
    for (const node of [...root.querySelectorAll(STALE_SELECTOR)]) {
      if (instance && node.dataset && node.dataset.stgInstance === instance) continue;
      node.remove();
      removed += 1;
    }
    return removed;
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

  // The edges of the whole prompt block: the text box plus what Midjourney
  // shows next to it, such as the strip of attached images (image prompts,
  // style and omni references) and the row of queued jobs. The dock sits past
  // all of it, so attached images are never covered. Boxes with no size are
  // empty and do not count.
  function blockEdges(barRect, rects) {
    let top = barRect.top;
    let bottom = barRect.bottom;
    for (const rect of rects || []) {
      if (!rect || rect.height < 1 || rect.width < 1) continue;
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return { top, bottom };
  }

  // The boxes beside the text box inside the prompt block. Midjourney's
  // settings panel scrolls and is placed by findPromptPanel; the dock and its
  // sheets are ours.
  function promptBlockRects(bar) {
    const box = bar && bar.parentElement;
    if (!box || box === document.body || bar.matches("div.fixed")) return [];
    const rects = [];
    for (const node of box.children) {
      if (node === bar || node.closest(".stg-mb-dock, .stg-pp-bar, .stg-mb-snap")) continue;
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") continue;
      rects.push(node.getBoundingClientRect());
    }
    return rects;
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
      // Every job is V8.2 (Michael, 15 Nov 2026: "never use mj v8.1"; V7 and
      // older since 11 Nov): a preset that pins an older version sets --v 8.2.
      if (key === "v" && Number.parseFloat(value) < 8.2) out.push("--v 8.2");
      else out.push(`--${match[1].toLowerCase()} ${value}`);
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

  // A preset put into a prompt that has words, at Michael's click or key:
  // exactly its codes in the profile flag, its settings at the end, its packs
  // after the words. `packsApi` (prompt-packs.js) and `findPack` (id -> pack)
  // are passed in; without them the packs are left out.
  function presetOnto(text, preset, options = {}) {
    let next = setProfileFlag(text, (preset && preset.codes) || []);
    const params = (preset && preset.params) || "";
    if (params && !hasParams(next, params)) next = setParams(next, params);
    const api = options.packsApi;
    const find = options.findPack;
    if (!api || typeof find !== "function") return next;
    for (const id of (preset && preset.packs) || []) {
      const pack = find(id);
      if (pack && !api.hasPack(next, pack.phrase)) next = api.insertPack(next, pack.phrase, { mode: "after" }).text;
    }
    return next;
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

  // Profiles Midjourney no longer has ("CAS COAST (deleted in MJ)") never
  // show in the dock (Michael, 11 Nov 2026).
  const isDeletedProfile = (profile) => /\bdeleted\b/i.test(String((profile && profile.name) || ""));
  const liveProfiles = (list) => (Array.isArray(list) ? list : []).filter((profile) => profile && profile.code && !isDeletedProfile(profile));

  // The "Other worlds" panel: other worlds' profiles, one line per world in
  // the dock's world order; a profile no world uses goes last under "More".
  function groupOtherProfiles(profiles, worlds, currentKey) {
    const list = liveProfiles(profiles);
    const lines = [];
    for (const world of Array.isArray(worlds) ? worlds : []) {
      if (!world || world.key === currentKey) continue;
      const own = list.filter((profile) => (profile.worlds || []).includes(world.key));
      if (own.length) lines.push({ key: world.key, name: world.name || world.key, profiles: own });
    }
    const placed = new Set(lines.flatMap((line) => line.profiles));
    const loose = list.filter((profile) => !placed.has(profile) && !(profile.worlds || []).includes(currentKey));
    if (loose.length) lines.push({ key: "", name: "More", profiles: loose });
    return lines;
  }

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
    isDeletedProfile,
    liveProfiles,
    groupOtherProfiles,
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
    cleanSticky,
    withStickyFlag,
    wordsOf,
    promptChange,
    presetOnto,
    mixPool,
    mixLabel,
    rerollPrompt,
    isTypingElement,
    hotkeyVeto,
    escapePlan,
    removeStaleNodes,
    findPromptPanel,
    blockEdges,
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
    // Every other world's profiles, for the "Other worlds" panel.
    otherProfiles: [],
    othersOpen: false,
    // The board and profiles picked last, per world: every new typed prompt
    // gets them. Never a preset's settings or packs.
    sticky: {},
    // A preset picked on an empty prompt: { world, id }. It goes into the
    // next typed prompt only, then ends; a second press ends it too.
    armed: null,
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
  let othersBox = null;
  // The last answer per world: a world switch shows it at once, then refreshes.
  const worldCache = new Map();
  let statusLine = null;
  let packs = null;
  let presetBox = null;
  let saveButton = null;
  let randomButton = null;
  let saveInput = null;
  let note = null;
  let noteTimer = null;
  let textarea = null;
  let layoutQueued = false;
  let snapshot = null;
  let wasShown = false;
  // The prompt just before Michael's own change (beforeinput), and just
  // before an input method started composing.
  let beforeValue = null;
  let composeBefore = null;
  // Another part of the extension is putting text in the bar right now.
  let heldUntil = 0;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // engaged: a click or a key in the prompt since this page opened. Midjourney
  // focuses the prompt on every page by itself, so focus alone means nothing.
  // dismissed: Esc put the dock away until the next click or key in the prompt.
  const compose = { hover: new Set(), holdUntil: 0, engaged: false, dismissed: false, href: "" };
  const COMPOSE_HOLD_MS = 350;

  // The dock shows only while a prompt is being written: the prompt or the
  // dock has focus, or the pointer rests on the dock. The rest of the time it
  // folds away and the page (the grid, a single image) is clear.
  function isComposing() {
    checkRoute();
    if (compose.dismissed) return false;
    // A pointer that left while the dock was hidden or the tab was away
    // never sent mouseleave: trust the live hover state.
    if (compose.hover.has("dock") && dock && !dock.matches(":hover")) compose.hover.delete("dock");
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

  function engage(event) {
    if (event && event.key === "Escape") return;
    if (compose.engaged && !compose.dismissed) return;
    compose.engaged = true;
    compose.dismissed = false;
    notifyCompose();
  }

  // The queue, Grow, quick edit and describe put finished text in the bar.
  // Their events are not Michael's typing, so nothing is added to them
  // anyway; this also covers the moment the text lands.
  globalScope.SaveToGalleryMoodboardDock.holdSticky = () => {
    heldUntil = Date.now() + 600;
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
    clearTimeout(noteTimer);
    clearTimeout(hintTimer);
    dock?.remove();
    snapshot?.remove();
    worldMenu?.remove();
    dock = null;
    snapshot = null;
    worldMenu = null;
    worldButton = null;
    note = null;
    packs = null;
  }

  // An update injects a fresh copy into open Midjourney tabs. This copy
  // tells older ones to stop (a DOM event reaches every copy), removes what
  // they left on the page, and keeps a rule that hides any that come back.
  const RETIRE_EVENT = "stg-mb-dock:retire";
  function takeOverFromOlderCopies() {
    try {
      document.documentElement.dataset.stgMbInstance = INSTANCE;
      document.dispatchEvent(new Event(RETIRE_EVENT));
    } catch {
      // a page without a root element
    }
    removeStaleNodes(document, INSTANCE);
    hideOlderCopies();
  }

  function onRetireEvent() {
    if (document.documentElement.dataset.stgMbInstance !== INSTANCE) retire();
  }

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
  const listeners = [];
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  }

  function retire() {
    if (retired) return;
    retired = true;
    observer?.disconnect();
    for (const [target, type, handler, options] of listeners.splice(0)) {
      try {
        target.removeEventListener(type, handler, options);
      } catch {
        // target gone
      }
    }
    window.removeEventListener("keydown", onHotkeyDown, true);
    window.removeEventListener("keyup", onHotkeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("pointerdown", onPointerHideHints, true);
    window.removeEventListener("wheel", onPointerHideHints, true);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // the extension context is gone
    }
    unbindTextarea();
    clearTimeout(composeTimer);
    dropDock();
  }

  function aliveOrRetire() {
    if (retired) return false;
    if (extensionAlive()) return true;
    retire();
    return false;
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
    worldCache.set(state.worldKey, res);
    applyResponse(res);
  }

  function applyResponse(res) {
    const next = Array.isArray(res.moodboards) ? res.moodboards : [];
    const profiles = liveProfiles(res.profiles);
    const others = liveProfiles(res.otherProfiles);
    const galleryPresets = Array.isArray(res.galleryPresets) ? res.galleryPresets : [];
    if (JSON.stringify(galleryPresets) !== JSON.stringify(state.galleryPresets)) {
      state.galleryPresets = galleryPresets;
      renderPresets();
    }
    const signature = JSON.stringify([state.worldKey, next, profiles, others]);
    if (signature !== state.signature) {
      state.signature = signature;
      state.moodboards = next;
      state.profiles = profiles;
      state.otherProfiles = others;
    }
    render();
  }

  function refreshIfStale() {
    if (Date.now() - state.fetchedAt > REFRESH_INTERVAL_MS) refresh();
  }

  // The world's profiles and the other worlds' ones: a profile picked from
  // another world is remembered for the next prompt like the world's own.
  function profileCodes() {
    return [...state.profiles, ...state.otherProfiles].map((profile) => profile.code);
  }

  // What every next typed prompt starts with: the board(s) and profiles
  // picked last. A preset is never part of it.
  function stickyFor(key = state.worldKey) {
    return state.sticky[key] || { board: null, boards: [], profiles: [] };
  }

  function saveSticky() {
    try {
      chrome.storage.local.set({ [STICKY_STORAGE_KEY]: state.sticky });
    } catch {
      // storage unavailable after an extension reload
    }
  }

  // The flag given here becomes what every next typed prompt starts with.
  function rememberSelection(value) {
    const codes = flagCodes(value);
    const boards = new Set(boardCodes());
    const profiles = new Set(profileCodes());
    const picked = codes.filter((code) => boards.has(code));
    state.sticky[state.worldKey] = {
      board: picked[0] || null,
      boards: picked,
      profiles: codes.filter((code) => profiles.has(code)),
    };
    saveSticky();
  }

  // The preset armed for the next prompt in this world, if any.
  function armedPreset() {
    const armed = state.armed;
    if (!armed || armed.world !== state.worldKey) return null;
    return allPresets().find((entry) => entry.id === armed.id) || null;
  }

  function disarm(message) {
    if (!state.armed) return;
    const preset = armedPreset();
    state.armed = null;
    if (message && preset) showNote(message.replace("{name}", preset.name));
    syncActive();
  }

  // The codes the next typed prompt gets: the armed preset's, else the
  // remembered ones.
  function nextCodes() {
    const preset = armedPreset();
    if (preset) return (preset.codes || []).slice();
    return stickyCodes(stickyFor(), boardCodes(), profileCodes());
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
    // A chip on an empty prompt changes what comes next: the armed preset
    // would override it, so it ends.
    if (!live) state.armed = null;
    if (live) writeTextareaValue(textarea, next);
    textarea.focus();
    syncActive();
  }

  function onChipClick(board) {
    if (!textarea || !textarea.isConnected) return;
    const source = selectionSource();
    applySelection(applyMoodboardToPrompt(source.value, board.mjCode, boardCodes()), source.live);
  }

  // A trusted change is about to happen: keep the prompt as it was.
  function onBeforeInput(event) {
    beforeValue = event.isTrusted && textarea ? textarea.value : null;
  }

  function onCompositionStart(event) {
    composeBefore = event.isTrusted && textarea ? textarea.value : null;
  }

  // An input method (or a dead key) finished the first word of an empty
  // prompt: the same as typing it.
  function onCompositionEnd(event) {
    const before = composeBefore;
    composeBefore = null;
    if (!event.isTrusted || !textarea || before == null || wordsOf(before)) return;
    if (wordsOf(textarea.value)) startTypedPrompt();
  }

  // Midjourney empties the prompt after a submit. The first words Michael
  // types into it bring the remembered board and profiles back, or the armed
  // preset (once). Text that arrives any other way gets nothing.
  function onPromptInput(event) {
    if (!textarea || retired) return;
    // While an input method composes, compositionend decides.
    if (event && event.isComposing) {
      syncActive();
      return;
    }
    const before = beforeValue;
    beforeValue = null;
    const change = promptChange(before, textarea.value, event);
    if (change === "typed" && Date.now() >= heldUntil) startTypedPrompt();
    else if (change === "injected") noticeInjected();
    syncActive();
  }

  // Words reached the bar without Michael typing them (pasted, queued, Use
  // prompt): an armed preset is not added to them, and it ends.
  function noticeInjected() {
    if (state.armed) disarm("“{name}” was not added: the prompt came in whole. Press it again to add it.");
  }

  function startTypedPrompt() {
    const preset = armedPreset();
    state.armed = null;
    const codes = preset ? null : stickyCodes(stickyFor(), boardCodes(), profileCodes());
    if (!preset && !codes.length) return;
    if (preset) showNote(`Added “${preset.name}”`);
    // Runs after Midjourney has handled the keystroke. Uses the text as it
    // is by then, so fast typing never loses the flag.
    setTimeout(() => {
      if (retired || !textarea || !textarea.isConnected) return;
      const base = textarea.value;
      if (!wordsOf(base)) return;
      const next = preset ? presetIntoPrompt(base, preset) : withStickyFlag(base, codes);
      if (!next || next === base) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      writeTextareaValue(textarea, next);
      textarea.setSelectionRange(start, end);
      syncActive();
    }, 0);
  }

  // Called on every layout pass: words in the bar that came with no input
  // event at all (Midjourney's own Use prompt, a restored draft).
  function noticeBarValue() {
    if (state.armed && textarea && wordsOf(textarea.value)) noticeInjected();
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
    const sticky = nextCodes();
    const waiting = !wordsOf(value);
    const armedOne = waiting ? armedPreset() : null;
    for (const chip of strip.querySelectorAll(".stg-mb-chip")) {
      const on = active.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-chip--on", on);
      chip.classList.toggle("stg-mb-chip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const chip of [...profileStrip.querySelectorAll(".stg-mb-pchip"), ...othersBox.querySelectorAll(".stg-mb-pchip")]) {
      const on = codes.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-pchip--on", on);
      chip.classList.toggle("stg-mb-pchip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    let label = "";
    if (!waiting && codes.length) label = `-p ${codes.join(" ")}`;
    else if (waiting && armedOne) label = `next · ${armedOne.name}`;
    else if (waiting && sticky.length) label = `next · -p ${sticky.join(" ")}`;
    activeLabel.textContent = label;
    activeLabel.title = label;
    activeLabel.classList.toggle("stg-mb-active--next", waiting);
    for (const chip of presetBox.querySelectorAll(".stg-mb-preset")) {
      const preset = allPresets().find((entry) => entry.id === chip.dataset.id);
      const on = Boolean(preset) && !waiting && presetInPrompt(value, preset);
      const isArmed = Boolean(preset) && waiting && armedOne === preset;
      chip.classList.toggle("stg-mb-preset--on", on);
      chip.classList.toggle("stg-mb-preset--armed", isArmed);
      chip.setAttribute("aria-pressed", on || isArmed ? "true" : "false");
      if (isArmed) chip.dataset.next = "next";
      else delete chip.dataset.next;
    }
    if (randomButton) randomButton.hidden = !state.profiles.length && !state.moodboards.length;
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

  // The preset into a prompt that has words, packs included.
  function presetIntoPrompt(text, preset) {
    return presetOnto(text, preset, { packsApi: packsApi(), findPack: packPhrase });
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
    const preset = armedPreset();
    if (preset) return { codes: (preset.codes || []).slice(), params: preset.params || "", packs: (preset.packs || []).slice() };
    return { codes: stickyCodes(stickyFor(), boardCodes(), profileCodes()), params: "", packs: [] };
  }

  // A click or key on a preset. With words in the prompt it goes into that
  // prompt at once (a second press takes it out again) and nothing is
  // remembered. On an empty prompt it is armed for the next prompt only; a
  // second press ends that.
  function onPresetClick(preset) {
    if (!textarea || !textarea.isConnected) return;
    const value = textarea.value;
    if (wordsOf(value)) {
      state.armed = null;
      if (presetInPrompt(value, preset)) {
        let next = setProfileFlag(value, flagCodes(value).filter((code) => !(preset.codes || []).includes(code)));
        next = removeParams(next, preset.params || "");
        const api = packsApi();
        for (const id of preset.packs || []) {
          const pack = packPhrase(id);
          if (pack && api) next = api.removePack(next, pack.phrase).text;
        }
        writeTextareaValue(textarea, next);
      } else {
        writeTextareaValue(textarea, presetIntoPrompt(value, preset));
      }
    } else if (armedPreset() === preset) {
      disarm("“{name}” is off");
    } else {
      state.armed = { world: state.worldKey, id: preset.id };
      showNote(`“${preset.name}” goes into the next prompt you type`);
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
    noteTimer = setTimeout(hideNote, 6000);
  }

  function hideNote() {
    clearTimeout(noteTimer);
    if (note) note.hidden = true;
  }

  /* ── Random: a new mix of the world's profiles and moodboards ── */

  // ⌥R / ⟳ Random (random limits), ⌥⇧R / shift-click (extreme). With words
  // in the prompt only its profile flag changes; an empty prompt is armed
  // with the mix, the same as picking chips. Each press avoids the mix the
  // prompt has now.
  function rerollMix(mode) {
    if (!textarea || !textarea.isConnected) return;
    const pool = mixPool(state.profiles, state.moodboards);
    if (!pool.profiles.length && !pool.boards.length) {
      showNote("No profiles or moodboards in this world yet");
      return;
    }
    const value = textarea.value;
    const live = Boolean(wordsOf(value));
    const result = rerollPrompt(value, live ? flagCodes(value) : nextCodes(), pool, mode);
    if (!result) {
      showNote("Nothing to mix in this world yet");
      return;
    }
    const flag = `-p ${result.mix.codes.join(" ")}`;
    rememberSelection(flag);
    state.armed = null;
    if (live) writeTextareaValue(textarea, result.text);
    textarea.focus();
    syncActive();
    const label = mixLabel(result.mix, pool.names);
    showNote(`${mode === "extreme" ? "Extreme · " : ""}${live ? "" : "Next prompt · "}${label}`);
    for (const code of result.mix.codes) {
      const selector = `[data-code="${CSS.escape(code)}"]`;
      flashChip(strip.querySelector(`.stg-mb-chip${selector}`) || profileStrip.querySelector(`.stg-mb-pchip${selector}`));
    }
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
    if (!saveInput || saveInput.hidden) return;
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
    // A hovered chip that goes away never sends mouseleave: close its card.
    hideSnapshot();
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
    state.presets = [];
    state.pins = null;
    state.armed = null;
    hideSnapshot();
    const cached = worldCache.get(key);
    if (cached) {
      state.loading = false;
      applyResponse(cached);
    } else {
      state.loading = true;
      state.moodboards = [];
      state.profiles = [];
      state.otherProfiles = [];
      state.signature = "";
      render();
    }
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
    if (randomButton) setKeyBadge(randomButton, "mix:random");
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
    if (action === "mix:random") return rerollMix("random");
    if (action === "mix:extreme") return rerollMix("extreme");
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

  const HINT_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
  // The key badges show only while ⌥ is held on its own for a moment, never
  // during ⌘C, ⌘V, ⌘A and other everyday combos (Michael, 14 Nov 2026: the
  // badges kept popping up and ruined the dock).
  const HINT_DELAY_MS = 700;
  const IS_MAC = /Mac|iPhone|iPad/i.test(String(globalScope.navigator?.userAgentData?.platform || globalScope.navigator?.platform || ""));

  function showKeyHints(on) {
    clearTimeout(hintTimer);
    if (!dock) return;
    if (!on) {
      dock.classList.remove("stg-mb-dock--keys");
      return;
    }
    hintTimer = setTimeout(() => {
      if (!retired && dockOnScreen() && hotkeyMap.size) dock.classList.add("stg-mb-dock--keys");
    }, HINT_DELAY_MS);
  }

  // What is open of the dock right now (for Esc).
  function openPieces() {
    return {
      menu: worldMenuOpen(),
      save: Boolean(saveInput && !saveInput.hidden),
      snapshot: Boolean(snapshot && !snapshot.hidden),
      others: Boolean(state.othersOpen && othersBox && !othersBox.hidden),
      note: Boolean(note && !note.hidden),
      dock: dockOnScreen(),
    };
  }

  // Esc closes what is open, else puts the dock away until the next click or
  // key in the prompt. The key still reaches Midjourney.
  function onEscape() {
    for (const piece of escapePlan(openPieces())) {
      if (piece === "menu") closeWorldMenu();
      else if (piece === "save") closeSave(false);
      else if (piece === "snapshot") hideSnapshot();
      else if (piece === "others") closeOthers();
      else if (piece === "note") hideNote();
      else if (piece === "dock") dismissDock();
    }
  }

  function dismissDock() {
    compose.dismissed = true;
    compose.engaged = false;
    compose.hover.clear();
    compose.holdUntil = 0;
    closeTransient();
    queueLayout();
  }

  // Everything that floats over or next to the dock goes away.
  function closeTransient() {
    closeWorldMenu();
    closeSave(false);
    hideSnapshot();
    hideNote();
    showKeyHints(false);
  }

  function onHotkeyDown(event) {
    if (retired || !dock) return;
    if (worldMenuOpen() && dockOnScreen() && handleWorldMenuKey(event)) return;
    if (event.key === "Escape") {
      if (event.isTrusted) onEscape();
      return;
    }
    if (HINT_KEYS.has(event.key)) {
      // Only ⌥ (with or without Shift or Ctrl) arms the badges; ⌘ cancels them.
      if (event.repeat) return;
      showKeyHints(event.altKey && !event.metaKey);
      return;
    }
    showKeyHints(false);
    if (!hotkeyMap.size) return;
    const combo = hotkeysApi()?.comboFromEvent(event);
    const action = combo && hotkeyMap.get(combo);
    if (!action || !dockOnScreen() || !textarea || !textarea.isConnected) return;
    if (hotkeyVeto(event, textarea, { mac: IS_MAC })) return;
    if (!aliveOrRetire()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Holding a key down runs it once.
    if (!event.repeat) runHotkey(action);
  }

  function onWindowBlur() {
    showKeyHints(false);
    hideSnapshot();
    closeWorldMenu();
    // The pointer may come back elsewhere; mouseleave never came.
    compose.hover.clear();
    queueLayout();
  }

  function onPointerHideHints() {
    showKeyHints(false);
  }

  function onHotkeyUp(event) {
    if (HINT_KEYS.has(event.key) && !event.altKey) showKeyHints(false);
  }

  // A press anywhere outside the dock closes its open pieces. A press in the
  // Imagine prompt keeps "Other worlds" and the note (its Undo) open.
  function onOutsidePointer(event) {
    if (retired || !dock) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    if (path.includes(dock) || (worldMenu && path.includes(worldMenu))) return;
    closeWorldMenu();
    hideSnapshot();
    if (textarea && path.includes(textarea)) return;
    hideNote();
    closeOthers();
  }

  // Midjourney is one page: a route change closes everything and ends the
  // writing (the prompt has to be clicked or typed into again).
  function checkRoute() {
    if (typeof location === "undefined" || location.href === compose.href) return false;
    const first = !compose.href;
    compose.href = location.href;
    if (first) return false;
    compose.engaged = false;
    compose.dismissed = false;
    compose.hover.clear();
    compose.holdUntil = 0;
    closeTransient();
    closeOthers();
    return true;
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
    const signature = `${state.signature}|${pins.join(",")}|${state.othersOpen ? 1 : 0}|${state.worlds.map((world) => world.key).join(",")}`;
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
      renderOthers();
    }
    boardRow.hidden = !message;
    profileRow.hidden = !state.profiles.length && !state.otherProfiles.length;
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

  // "Other worlds": a toggle at the end of the profile row opens one line per
  // world with its profiles. A chip adds that profile to this prompt (the
  // dock stays on its world); the world's name opens that world in the dock.
  function renderOthers() {
    hideSnapshot();
    othersBox.textContent = "";
    const lines = groupOtherProfiles(state.otherProfiles, dockWorlds(), state.worldKey);
    if (!lines.length) {
      othersBox.hidden = true;
      return;
    }
    const toggle = el("button", `stg-mb-others-toggle${state.othersOpen ? " stg-mb-others-toggle--open" : ""}`, state.othersOpen ? "Other worlds ▴" : `Other worlds ▾`);
    toggle.type = "button";
    toggle.title = "Profiles of the other worlds";
    toggle.setAttribute("aria-expanded", state.othersOpen ? "true" : "false");
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      state.othersOpen = !state.othersOpen;
      try {
        chrome.storage.local.set({ [OTHERS_STORAGE_KEY]: state.othersOpen });
      } catch {
        // storage unavailable after an extension reload
      }
      render();
      queueLayout();
    });
    profileStrip.appendChild(toggle);
    othersBox.hidden = !state.othersOpen;
    if (!state.othersOpen) return;
    for (const line of lines) {
      const row = el("div", "stg-mb-row stg-mb-row--others");
      const label = el(line.key ? "button" : "span", line.key ? "stg-mb-label stg-mb-others-world" : "stg-mb-label", worldLabel(line.name));
      if (line.key) {
        label.type = "button";
        label.title = `Open ${line.name} in the dock`;
        label.addEventListener("mousedown", (event) => event.preventDefault());
        label.addEventListener("click", () => {
          setWorld(line.key);
          showNote(line.name);
        });
      }
      const chips = el("div", "stg-mb-chips");
      for (const profile of line.profiles) chips.appendChild(profileChip(profile, false, false, true));
      row.append(label, chips);
      othersBox.appendChild(row);
    }
  }

  function closeOthers() {
    if (!state.othersOpen) return;
    state.othersOpen = false;
    try {
      chrome.storage.local.set({ [OTHERS_STORAGE_KEY]: false });
    } catch {
      // storage unavailable after an extension reload
    }
    render();
    queueLayout();
  }

  function profileChip(profile, pinned, quiet, foreign) {
    const chip = el("button", quiet ? "stg-mb-pchip stg-mb-pchip--more" : "stg-mb-pchip", profile.name);
    chip.type = "button";
    chip.dataset.code = profile.code;
    const hint = foreign ? "" : pinned ? "Shift-click: move to more" : quiet ? "Shift-click: move to main" : "Shift-click: pin first";
    chip.title = [profile.name, profile.role, profile.flag, hint].filter(Boolean).join("\n");
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => (event.shiftKey && !foreign ? togglePin(profile) : onProfileClick(profile)));
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
    othersBox = el("div", "stg-mb-others");
    othersBox.hidden = true;

    // Second line, smaller: world, presets, Save, the flag, Packs (closed).
    const meta = el("div", "stg-mb-row stg-mb-row--meta");
    presetBox = el("div", "stg-mb-presets");
    saveButton = el("button", "stg-mb-save", "+ Save preset");
    saveButton.type = "button";
    saveButton.title = "Save the moodboard, profiles, settings (--ar, --s …) and packs in this prompt as a preset";
    saveButton.addEventListener("mousedown", (event) => event.preventDefault());
    saveButton.addEventListener("click", openSave);
    randomButton = el("button", "stg-mb-random", "⟳ Random");
    randomButton.type = "button";
    randomButton.hidden = true;
    randomButton.title = "New random profiles + moodboard for this prompt\nShift-click: extreme mix (more profiles, up to two moodboards)";
    randomButton.addEventListener("mousedown", (event) => event.preventDefault());
    randomButton.addEventListener("click", (event) => rerollMix(event.shiftKey ? "extreme" : "random"));
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
    meta.append(world, presetBox, saveButton, saveInput, randomButton, note, activeLabel);
    if (packs) meta.appendChild(packs.toggle);

    snapshot = el("div", "stg-mb-snap");
    snapshot.dataset.stgInstance = INSTANCE;
    snapshot.hidden = true;
    snapshot.setAttribute("role", "tooltip");
    dock.append(boardRow, strip, profileRow, othersBox, meta);
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

  const TEXTAREA_EVENTS = [
    ["beforeinput", onBeforeInput],
    ["input", onPromptInput],
    ["compositionstart", onCompositionStart],
    ["compositionend", onCompositionEnd],
    ["pointerdown", engage],
    ["keydown", engage],
  ];

  function bindTextarea() {
    if (!textarea) return;
    for (const [type, handler] of TEXTAREA_EVENTS) textarea.addEventListener(type, handler);
  }

  function unbindTextarea() {
    if (!textarea) return;
    for (const [type, handler] of TEXTAREA_EVENTS) textarea.removeEventListener(type, handler);
    beforeValue = null;
    composeBefore = null;
  }

  function layout() {
    layoutQueued = false;
    if (!aliveOrRetire()) return;
    const area = findTextarea();
    if (area !== textarea) {
      unbindTextarea();
      textarea = area;
      bindTextarea();
      forgetPanel();
      syncActive();
    }
    noticeBarValue();
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
    // Attached images and queued jobs show beside the text box: keep them clear.
    const block = blockEdges(rect, promptBlockRects(bar));
    const extended = block.top < rect.top - 1 || block.bottom > rect.bottom + 1;
    const edgeTop = panel ? Math.min(panel.top, block.top) : block.top;
    const edgeBottom = panel ? Math.max(panel.bottom, block.bottom) : block.bottom;
    dock.classList.toggle("stg-mb-dock--above", above);
    // Bottom prompt (narrow): sit above it. Top prompt (wide): sit under it.
    if (above) {
      setStyle(dock, "top", "auto");
      setStyle(dock, "bottom", `${Math.round(window.innerHeight - edgeTop + DOCK_GAP_PX)}px`);
    } else {
      setStyle(dock, "bottom", "auto");
      setStyle(dock, "top", `${Math.round(edgeBottom + DOCK_GAP_PX)}px`);
    }
    if (panel || extended) {
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

  function onMutations(records) {
    if (!aliveOrRetire()) return;
    if (dock && records.every((record) => dock.contains(record.target))) return;
    if (checkRoute()) queueLayout();
    if (textarea && textarea.isConnected && dock && dock.hidden && !isComposing()) {
      noticeBarValue();
      return;
    }
    queueLayout();
  }

  function onResize() {
    forgetPanel();
    queueLayout();
  }

  function onFocusIn() {
    if (!aliveOrRetire()) return;
    forgetPanel();
    notifyCompose();
  }

  function onFocusOut(event) {
    // Leaving the prompt for the page (not for the dock) ends the writing.
    const next = event.relatedTarget;
    if (event.target === textarea && !(next && next.closest && next.closest(".stg-mb-dock"))) {
      compose.engaged = false;
    }
    compose.holdUntil = Date.now() + COMPOSE_HOLD_MS;
    notifyCompose();
  }

  function onVisibility() {
    if (document.visibilityState === "visible") refreshIfStale();
    else onWindowBlur();
  }

  function onStorageChanged(changes, area) {
    if (retired || area !== "sync") return;
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
  }

  function start() {
    takeOverFromOlderCopies();
    compose.href = location.href;
    try {
      chrome.storage.local.get([WORLD_STORAGE_KEY, STICKY_STORAGE_KEY, OTHERS_STORAGE_KEY], (stored) => {
        state.worldKey = String(stored?.[WORLD_STORAGE_KEY] || "");
        state.othersOpen = stored?.[OTHERS_STORAGE_KEY] === true;
        state.sticky = cleanSticky(stored?.[STICKY_STORAGE_KEY]);
        refresh().then(loadPresets);
      });
    } catch {
      refresh();
    }
    // Midjourney changes the page all the time (the grid loads, jobs
    // progress). While no prompt is being written and the prompt box is still
    // there, those changes need no work at all.
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    loadHotkeys();
    listen(document, RETIRE_EVENT, onRetireEvent);
    window.addEventListener("keydown", onHotkeyDown, true);
    window.addEventListener("keyup", onHotkeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pointerdown", onPointerHideHints, true);
    window.addEventListener("wheel", onPointerHideHints, { capture: true, passive: true });
    listen(document, "pointerdown", onOutsidePointer, true);
    listen(window, "popstate", queueLayout);
    listen(window, "resize", onResize);
    listen(document, "pointerup", forgetPanel, true);
    listen(document, "focusin", onFocusIn);
    listen(document, "focusout", onFocusOut);
    listen(document, "visibilitychange", onVisibility);
    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
    } catch {
      // extension reloaded
    }
    queueLayout();
  }

  start();
})(typeof globalThis !== "undefined" ? globalThis : self);
