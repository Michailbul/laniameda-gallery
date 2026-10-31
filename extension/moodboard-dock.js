(function registerMoodboardDock(globalScope) {
  "use strict";

  const WORLD_STORAGE_KEY = "stgMoodboardWorld";
  const STICKY_STORAGE_KEY = "stgMoodboardSticky";
  const DEFAULT_WORLD_KEY = "dear-annete";
  const REFRESH_INTERVAL_MS = 45000;
  const DOCK_GAP_PX = 6;
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

  globalScope.SaveToGalleryMoodboardDock = {
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
    loading: true,
    error: "",
    requestId: 0,
  };
  let dock = null;
  let worldSelect = null;
  let activeLabel = null;
  let strip = null;
  let profileRow = null;
  let profileStrip = null;
  let statusLine = null;
  let textarea = null;
  let layoutQueued = false;
  let snapshot = null;
  // True while the prompt is empty: the next words typed get the remembered flag.
  let freshPrompt = true;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const compose = { hover: new Set(), holdUntil: 0 };
  const COMPOSE_HOLD_MS = 350;

  // The dock and the packs show only while a prompt is being written: the
  // prompt or one of our bars has focus, or the pointer rests on a bar. The
  // rest of the time they fold away and the page (the grid, a single image)
  // is clear.
  function isComposing() {
    const active = document.activeElement;
    if (textarea && active === textarea) return true;
    if (active && active.closest && active.closest(".stg-mb-dock, .stg-pp-bar")) return true;
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
    document.dispatchEvent(new CustomEvent("stg-compose-change"));
    clearTimeout(composeTimer);
    composeTimer = setTimeout(() => {
      queueLayout();
      document.dispatchEvent(new CustomEvent("stg-compose-change"));
    }, COMPOSE_HOLD_MS + 30);
  }

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

  function showSnapshot(board, chip) {
    if (!dock || !snapshot) return;
    snapshot.textContent = "";
    const row = el("div", "stg-mb-snap-row");
    const empty = el("div", "stg-mb-snap-empty", "No images yet");
    const urls = snapshotImages(board);
    let shown = urls.length;
    if (!urls.length) row.appendChild(empty);
    for (const url of urls) {
      const img = el("img", "stg-mb-snap-img");
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        shown -= 1;
        if (shown <= 0 && !empty.isConnected) row.appendChild(empty);
        placeSnapshot(chip);
      });
      img.addEventListener("load", () => placeSnapshot(chip));
      img.src = url;
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

  // Opens on the side of the dock away from the prompt bar, so the bar stays clear.
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
    document.querySelectorAll(".stg-mb-dock, .stg-mb-snap").forEach((node) => node.remove());
    dock = null;
    snapshot = null;
  }

  function send(world) {
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
            if (/invalidated|context/i.test(message)) dropDock();
            resolve({ ok: false, error: message });
            return;
          }
          resolve(res || { ok: false, error: "No response." });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
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

  async function refresh() {
    const requestId = ++state.requestId;
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
      if (!extensionAlive()) return;
      const detail = String(res.error || "").replace(/^HTTP \d+\s*/, "").slice(0, 80);
      state.error = isAuthFailure(res)
        ? "Gallery token missing. Open the extension settings."
        : detail
          ? `Could not refresh moodboards. ${detail}`
          : "Could not refresh moodboards.";
      render();
      return;
    }
    state.error = "";
    state.worlds = Array.isArray(res.worlds) ? res.worlds : state.worlds;
    state.worldKey = res.world?.key || key;
    const next = Array.isArray(res.moodboards) ? res.moodboards : [];
    const profiles = Array.isArray(res.profiles) ? res.profiles : [];
    const signature = JSON.stringify([state.worldKey, state.worlds, next, profiles]);
    if (signature !== state.signature) {
      state.signature = signature;
      state.moodboards = next;
      state.profiles = profiles;
    }
    render();
  }

  function profileCodes() {
    return state.profiles.map((profile) => profile.code);
  }

  function stickyFor(key = state.worldKey) {
    return state.sticky[key] || { board: null, profiles: [] };
  }

  const wordsOf = (value) => String(value || "").replace(PROFILE_FLAG_PATTERN, "").trim();

  // The flag given here becomes what every next prompt starts with.
  function rememberSelection(value) {
    const codes = flagCodes(value);
    const boards = new Set(boardCodes());
    const profiles = new Set(profileCodes());
    state.sticky[state.worldKey] = {
      board: codes.find((code) => boards.has(code)) || null,
      profiles: codes.filter((code) => profiles.has(code)),
    };
    try {
      chrome.storage.local.set({ [STICKY_STORAGE_KEY]: state.sticky });
    } catch {
      // storage unavailable after an extension reload
    }
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
      const next = withStickyFlag(value, stickyCodes(stickyFor(), boardCodes(), profileCodes()));
      if (next) {
        const caret = textarea.selectionStart;
        setTimeout(() => {
          if (!textarea || textarea.value !== value) return;
          writeTextareaValue(textarea, next);
          textarea.setSelectionRange(caret, caret);
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
    for (const chip of profileStrip.querySelectorAll(".stg-mb-pchip")) {
      const on = codes.includes(chip.dataset.code);
      chip.classList.toggle("stg-mb-pchip--on", on);
      chip.classList.toggle("stg-mb-pchip--armed", !on && sticky.includes(chip.dataset.code));
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (codes.length) activeLabel.textContent = `-p ${codes.join(" ")}`;
    else activeLabel.textContent = sticky.length && waiting ? `next prompt: -p ${sticky.join(" ")}` : "";
    activeLabel.classList.toggle("stg-mb-active--next", !codes.length && sticky.length > 0);
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

  function renderWorlds() {
    worldSelect.textContent = "";
    for (const world of state.worlds) {
      const option = el("option", "", world.name);
      option.value = world.key;
      worldSelect.appendChild(option);
    }
    worldSelect.value = state.worldKey;
  }

  function render() {
    if (!dock) return;
    renderWorlds();
    let message = "";
    if (state.loading && !state.moodboards.length) message = "Moodboards…";
    else if (state.error) message = state.error;
    else if (!state.moodboards.length) message = "No moodboard codes in this world.";
    statusLine.textContent = message;
    statusLine.hidden = !message;
    statusLine.classList.toggle("stg-mb-status--error", Boolean(state.error));

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
      profileRow.hidden = state.profiles.length === 0;
    }
    syncActive();
  }

  function buildDock() {
    dock = el("div", "stg-mb-dock");
    dock.hidden = true;
    const top = el("div", "stg-mb-top");
    worldSelect = el("select", "stg-mb-world");
    worldSelect.setAttribute("aria-label", "Gallery world");
    worldSelect.addEventListener("change", () => {
      state.worldKey = worldSelect.value;
      try {
        chrome.storage.local.set({ [WORLD_STORAGE_KEY]: state.worldKey });
      } catch {
        // storage unavailable after an extension reload
      }
      state.loading = true;
      state.moodboards = [];
      state.profiles = [];
      state.signature = "";
      render();
      refresh();
    });
    const refreshButton = el("button", "stg-mb-refresh", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Refresh moodboards";
    refreshButton.addEventListener("mousedown", (event) => event.preventDefault());
    refreshButton.addEventListener("click", () => refresh());
    activeLabel = el("span", "stg-mb-active");
    top.append(worldSelect, refreshButton, activeLabel);

    strip = el("div", "stg-mb-strip");
    profileRow = el("div", "stg-mb-prow");
    profileRow.hidden = true;
    profileStrip = el("div", "stg-mb-pstrip");
    profileRow.append(el("span", "stg-mb-plabel", "Profiles"), profileStrip);
    statusLine = el("div", "stg-mb-status");
    snapshot = el("div", "stg-mb-snap");
    snapshot.hidden = true;
    snapshot.setAttribute("role", "tooltip");
    dock.append(top, statusLine, strip, profileRow, snapshot);
    dock.addEventListener("mouseenter", () => setHover("dock", true));
    dock.addEventListener("mouseleave", () => setHover("dock", false));
    document.body.appendChild(dock);
  }

  function layout() {
    layoutQueued = false;
    const area = findTextarea();
    if (area !== textarea) {
      if (textarea) textarea.removeEventListener("input", onPromptInput);
      textarea = area;
      if (textarea) textarea.addEventListener("input", onPromptInput);
      freshPrompt = !textarea || !wordsOf(textarea.value);
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
      return;
    }
    if (!dock || !dock.isConnected) {
      dropDock();
      buildDock();
      render();
    }
    if (!isComposing()) {
      dock.hidden = true;
      hideSnapshot();
      return;
    }
    const rect = bar.getBoundingClientRect();
    dock.hidden = false;
    // Keep the dock last in the document so the image grid cannot paint over it.
    if (dock.parentElement === document.body && dock !== document.body.lastElementChild) {
      document.body.appendChild(dock);
    }
    dock.style.left = `${Math.round(rect.left)}px`;
    dock.style.width = `${Math.round(rect.width)}px`;
    // Midjourney's settings panel is open: sit past it, or step aside.
    const panel = findPromptPanel(textarea);
    const above = panel ? !panel.below : rect.top > window.innerHeight * 0.5;
    const edgeTop = panel ? panel.top : rect.top;
    const edgeBottom = panel ? panel.bottom : rect.bottom;
    // Bottom prompt (narrow): sit above it. Top prompt (wide): sit under it.
    if (above) {
      dock.style.top = "auto";
      dock.style.bottom = `${Math.round(window.innerHeight - edgeTop + DOCK_GAP_PX)}px`;
    } else {
      dock.style.bottom = "auto";
      dock.style.top = `${Math.round(edgeBottom + DOCK_GAP_PX)}px`;
    }
    const placed = dock.getBoundingClientRect();
    dock.hidden = Boolean(panel) && (placed.top < 0 || placed.bottom > window.innerHeight);
    dock.dataset.panel = panel ? "open" : "";
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
        refresh();
      });
    } catch {
      refresh();
    }
    new MutationObserver((records) => {
      if (dock && records.every((record) => dock.contains(record.target))) return;
      queueLayout();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", queueLayout);
    document.addEventListener("focusin", notifyCompose);
    document.addEventListener("focusout", () => {
      compose.holdUntil = Date.now() + COMPOSE_HOLD_MS;
      notifyCompose();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
    setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_INTERVAL_MS);
    queueLayout();
  }

  start();
})(typeof globalThis !== "undefined" ? globalThis : self);
