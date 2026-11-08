(function registerPromptPacks(globalScope) {
  "use strict";

  const SETTINGS_KEY = "stgPromptPackSettings";
  const MODES = ["cursor", "before", "after"];
  const MODE_LABELS = { cursor: "Cursor", before: "Before", after: "After" };
  const MODE_TITLES = {
    cursor: "Insert at the cursor. Appends when the prompt box is not focused.",
    before: "Insert in front of your own words, after packs already there.",
    after: "Insert after your own words, before any flags.",
  };
  // First flag token: "--word" or the "-p" shorthand. Everything from here on
  // (--profile, --ar, --stylize, ...) is never touched.
  const FLAG_PATTERN = /(^|\s)(--[A-Za-z]|-p(?=\s|$))/;
  const LEADING_URL_PATTERN = /^\s*https?:\/\/\S+/;

  function flagStart(text) {
    const match = FLAG_PATTERN.exec(text);
    return match ? match.index + match[1].length : text.length;
  }

  function bodyEnd(text) {
    return text.slice(0, flagStart(text)).trimEnd().length;
  }

  function hasPack(text, phrase) {
    return text.slice(0, flagStart(text)).includes(phrase);
  }

  function allPhrases() {
    const groups = globalScope.SaveToGalleryPromptPackData || [];
    return groups
      .flatMap((group) => group.packs.map((pack) => pack.phrase))
      .sort((a, b) => b.length - a.length);
  }

  // Where a "before" click lands: after leading image URLs and after the packs
  // already sitting in front of the user's words, so click order stays phrase order.
  function beforePosition(text, phrases) {
    const end = bodyEnd(text);
    let pos = 0;
    let url;
    while ((url = LEADING_URL_PATTERN.exec(text.slice(pos, end)))) {
      pos += url[0].length;
    }
    for (;;) {
      while (pos < end && /\s/.test(text[pos])) pos += 1;
      const hit = phrases.find((phrase) => text.startsWith(phrase, pos));
      if (!hit) return pos;
      pos += hit.length;
    }
  }

  // Cursor inside the prompt words, moved to the end of the word it sits in.
  function cursorPosition(text, caret) {
    const end = bodyEnd(text);
    let pos = Math.min(Math.max(caret, 0), end);
    while (pos < end && !/\s/.test(text[pos - 1] || " ") && !/\s/.test(text[pos])) {
      pos += 1;
    }
    return pos;
  }

  function insertPack(text, phrase, options) {
    const { mode = "cursor", caret = null } = options || {};
    let pos;
    if (mode === "before") pos = beforePosition(text, allPhrases());
    else if (mode === "cursor" && caret != null) pos = cursorPosition(text, caret);
    else pos = bodyEnd(text);
    const prev = text[pos - 1];
    const next = text[pos];
    const lead = prev && !/\s/.test(prev) ? " " : "";
    const trail = next && !/\s/.test(next) ? " " : "";
    return {
      text: text.slice(0, pos) + lead + phrase + trail + text.slice(pos),
      caret: pos + lead.length + phrase.length,
    };
  }

  function removePack(text, phrase) {
    const start = text.slice(0, flagStart(text)).indexOf(phrase);
    if (start < 0) return { text, caret: text.length };
    let before = text.slice(0, start);
    let after = text.slice(start + phrase.length);
    if (/\s$/.test(before) && (after === "" || /^\s/.test(after))) {
      before = before.slice(0, -1);
    } else if (before === "" && /^\s/.test(after)) {
      after = after.slice(1);
    }
    return { text: before + after, caret: before.length };
  }

  // The one function a pack click goes through: the phrase is removed if it is
  // already in the prompt words, otherwise inserted on the chosen side.
  function togglePack(text, phrase, options) {
    const source = String(text || "");
    if (hasPack(source, phrase)) return removePack(source, phrase);
    return insertPack(source, phrase, options);
  }

  globalScope.SaveToGalleryPromptPacks = {
    flagStart,
    hasPack,
    insertPack,
    removePack,
    togglePack,
  };

  const onMidjourney =
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.hostname || "").includes("midjourney.com");
  if (!onMidjourney || typeof chrome === "undefined" || !chrome.runtime) return;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

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

  // The packs live inside the Midjourney dock (moodboard-dock.js): a Packs
  // button in the dock's row, and the panel it opens under the row. Closed by
  // default, so the dock stays one line. The dock calls sync() when the
  // prompt changes and setEnabled() when the world has no packs.
  function createSection({ getTextarea, onResize }) {
    const settings = { mode: "cursor", collapsed: true };
    let enabled = true;

    const toggle = el("button", "stg-pp-toggle");
    toggle.type = "button";
    const toggleLabel = el("span", "", "Packs");
    const toggleCount = el("span", "stg-pp-count");
    toggle.append(toggleLabel, toggleCount);
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      settings.collapsed = !settings.collapsed;
      save();
      syncSettings();
      onResize?.();
    });

    const section = el("div", "stg-pp-section");
    section.hidden = true;
    const grid = el("div", "stg-pp-strip");
    const modes = el("div", "stg-pp-modes");
    const modeButtons = MODES.map((mode) => {
      const button = el("button", "stg-pp-mode", MODE_LABELS[mode]);
      button.type = "button";
      button.dataset.mode = mode;
      button.title = MODE_TITLES[mode];
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        settings.mode = mode;
        save();
        syncSettings();
      });
      modes.appendChild(button);
      return button;
    });
    grid.append(el("span", "stg-pp-heading", "Insert"), modes);

    // Every group is one row: its heading, then its chips wrapping onto as
    // many lines as they need. Nothing scrolls sideways.
    const chips = [];
    for (const group of globalScope.SaveToGalleryPromptPackData || []) {
      const heading = el("span", "stg-pp-heading", group.heading);
      if (group.note) heading.title = group.note;
      const row = el("div", "stg-pp-group");
      for (const pack of group.packs) {
        const chip = el("button", "stg-pp-chip", pack.label);
        chip.type = "button";
        chip.title = pack.phrase;
        chip.dataset.pack = pack.id;
        chip.dataset.phrase = pack.phrase;
        chip.addEventListener("mousedown", (event) => event.preventDefault());
        chip.addEventListener("click", () => onPackClick(pack));
        row.appendChild(chip);
        chips.push(chip);
      }
      grid.append(heading, row);
    }
    section.appendChild(grid);

    function onPackClick(pack) {
      const textarea = getTextarea();
      if (!textarea || !textarea.isConnected) return;
      const focused = document.activeElement === textarea;
      const result = togglePack(textarea.value, pack.phrase, {
        mode: settings.mode,
        caret: focused ? textarea.selectionStart : null,
      });
      writeTextareaValue(textarea, result.text);
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
      sync();
    }

    function sync() {
      const textarea = getTextarea();
      const value = textarea ? textarea.value : "";
      let on = 0;
      for (const chip of chips) {
        const active = hasPack(value, chip.dataset.phrase);
        if (active) on += 1;
        chip.classList.toggle("stg-pp-chip--on", active);
        chip.setAttribute("aria-pressed", active ? "true" : "false");
      }
      toggleCount.textContent = on ? String(on) : "";
      toggleCount.hidden = !on;
    }

    function syncSettings() {
      for (const button of modeButtons) {
        const on = button.dataset.mode === settings.mode;
        button.classList.toggle("stg-pp-mode--on", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
      }
      toggle.hidden = !enabled;
      section.hidden = !enabled || settings.collapsed;
      toggle.classList.toggle("stg-pp-toggle--open", !settings.collapsed);
      toggle.setAttribute("aria-expanded", settings.collapsed ? "false" : "true");
      toggle.title = settings.collapsed ? "Show prompt packs" : "Hide prompt packs";
    }

    function save() {
      try {
        chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings } });
      } catch {
        // storage unavailable after an extension reload
      }
    }

    try {
      chrome.storage.local.get([SETTINGS_KEY], (stored) => {
        const saved = stored?.[SETTINGS_KEY];
        if (saved && MODES.includes(saved.mode)) settings.mode = saved.mode;
        if (saved && typeof saved.collapsed === "boolean") settings.collapsed = saved.collapsed;
        syncSettings();
        onResize?.();
      });
    } catch {
      // storage unavailable after an extension reload
    }
    syncSettings();
    sync();

    return {
      toggle,
      section,
      sync,
      setEnabled(on) {
        if (enabled === Boolean(on)) return;
        enabled = Boolean(on);
        syncSettings();
      },
    };
  }

  globalScope.SaveToGalleryPromptPacks.createSection = createSection;
})(typeof globalThis !== "undefined" ? globalThis : self);
