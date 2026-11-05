(function registerPromptPacks(globalScope) {
  "use strict";

  const SETTINGS_KEY = "stgPromptPackSettings";
  const BAR_GAP_PX = 6;
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

  const settings = { mode: "cursor", collapsed: false };
  let bar = null;
  let strip = null;
  let modeButtons = [];
  let collapseButton = null;
  let textarea = null;
  let layoutQueued = false;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

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
    return area.closest("div.fixed") || area.parentElement?.parentElement || area.parentElement;
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

  function saveSettings() {
    try {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings } });
    } catch {
      // storage unavailable after an extension reload
    }
  }

  function onPackClick(pack) {
    if (!textarea || !textarea.isConnected) return;
    const focused = document.activeElement === textarea;
    const result = togglePack(textarea.value, pack.phrase, {
      mode: settings.mode,
      caret: focused ? textarea.selectionStart : null,
    });
    writeTextareaValue(textarea, result.text);
    textarea.focus();
    textarea.setSelectionRange(result.caret, result.caret);
    syncActive();
  }

  function syncActive() {
    if (!bar) return;
    const value = textarea ? textarea.value : "";
    for (const chip of strip.querySelectorAll(".stg-pp-chip")) {
      const on = hasPack(value, chip.dataset.phrase);
      chip.classList.toggle("stg-pp-chip--on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function syncSettings() {
    if (!bar) return;
    for (const button of modeButtons) {
      const on = button.dataset.mode === settings.mode;
      button.classList.toggle("stg-pp-mode--on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
    strip.hidden = settings.collapsed;
    collapseButton.textContent = settings.collapsed ? "+" : "–";
    collapseButton.title = settings.collapsed ? "Show prompt packs" : "Hide prompt packs";
  }

  function buildBar() {
    bar = el("div", "stg-pp-bar");
    bar.hidden = true;
    const top = el("div", "stg-pp-top");
    const title = el("span", "stg-pp-title", "Packs");
    const modes = el("div", "stg-pp-modes");
    modeButtons = MODES.map((mode) => {
      const button = el("button", "stg-pp-mode", MODE_LABELS[mode]);
      button.type = "button";
      button.dataset.mode = mode;
      button.title = MODE_TITLES[mode];
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        settings.mode = mode;
        saveSettings();
        syncSettings();
      });
      modes.appendChild(button);
      return button;
    });
    collapseButton = el("button", "stg-pp-collapse");
    collapseButton.type = "button";
    collapseButton.addEventListener("mousedown", (event) => event.preventDefault());
    collapseButton.addEventListener("click", () => {
      settings.collapsed = !settings.collapsed;
      saveSettings();
      syncSettings();
      queueLayout();
    });
    top.append(title, modes, collapseButton);

    // Every group is one row: its heading, then its chips wrapping onto as
    // many lines as they need. Nothing scrolls sideways.
    strip = el("div", "stg-pp-strip");
    for (const group of globalScope.SaveToGalleryPromptPackData || []) {
      const heading = el("span", "stg-pp-heading", group.heading);
      if (group.note) heading.title = group.note;
      const section = el("div", "stg-pp-group");
      strip.appendChild(heading);
      for (const pack of group.packs) {
        const chip = el("button", "stg-pp-chip", pack.label);
        chip.type = "button";
        chip.title = pack.phrase;
        chip.dataset.pack = pack.id;
        chip.dataset.phrase = pack.phrase;
        chip.addEventListener("mousedown", (event) => event.preventDefault());
        chip.addEventListener("click", () => onPackClick(pack));
        section.appendChild(chip);
      }
      strip.appendChild(section);
    }
    bar.append(top, strip);
    const hover = (on) => globalScope.SaveToGalleryMoodboardDock?.setHover?.("packs", on);
    bar.addEventListener("mouseenter", () => hover(true));
    bar.addEventListener("mouseleave", () => hover(false));
    document.body.appendChild(bar);
    syncSettings();
  }

  function layout() {
    layoutQueued = false;
    const area = findTextarea();
    if (area !== textarea) {
      if (textarea) textarea.removeEventListener("input", syncActive);
      textarea = area;
      if (textarea) textarea.addEventListener("input", syncActive);
      syncActive();
    }
    const promptBar = findBar(textarea);
    if (!promptBar) {
      if (bar) bar.hidden = true;
      return;
    }
    if (!bar || !bar.isConnected) {
      document.querySelectorAll(".stg-pp-bar").forEach((node) => node.remove());
      buildBar();
      syncActive();
    }
    // Only while a prompt is being written (the dock decides; see isComposing).
    const composing = globalScope.SaveToGalleryMoodboardDock?.isComposing;
    if (typeof composing === "function" && !composing()) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    // The moodboard dock stays last in the document, so sit right in front of it.
    const dock = document.querySelector(".stg-mb-dock");
    if (dock && dock.parentElement === document.body) {
      if (bar.nextElementSibling !== dock) document.body.insertBefore(bar, dock);
    } else if (bar.parentElement === document.body && bar !== document.body.lastElementChild) {
      document.body.appendChild(bar);
    }
    // Stack next to the moodboard dock when it is showing, else next to the
    // prompt, and never over Midjourney's settings panel.
    const findPanel = globalScope.SaveToGalleryMoodboardDock?.findPromptPanel;
    const panel = typeof findPanel === "function" ? findPanel(textarea) : null;
    const prompt = promptBar.getBoundingClientRect();
    const dockShown = dock && !dock.hidden;
    const anchor = dockShown ? dock.getBoundingClientRect() : panel || prompt;
    const above = panel ? !panel.below : prompt.top > window.innerHeight * 0.5;
    bar.style.left = `${Math.round(prompt.left)}px`;
    bar.style.width = `${Math.round(prompt.width)}px`;
    if (above) {
      bar.style.top = "auto";
      bar.style.bottom = `${Math.round(window.innerHeight - anchor.top + BAR_GAP_PX)}px`;
    } else {
      bar.style.bottom = "auto";
      bar.style.top = `${Math.round(anchor.bottom + BAR_GAP_PX)}px`;
    }
    const placed = bar.getBoundingClientRect();
    bar.hidden = Boolean(panel) && (placed.top < 0 || placed.bottom > window.innerHeight);
  }

  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(layout);
  }

  function start() {
    try {
      chrome.storage.local.get([SETTINGS_KEY], (stored) => {
        const saved = stored?.[SETTINGS_KEY];
        if (saved && MODES.includes(saved.mode)) settings.mode = saved.mode;
        if (saved) settings.collapsed = Boolean(saved.collapsed);
        syncSettings();
        queueLayout();
      });
    } catch {
      // storage unavailable after an extension reload
    }
    new MutationObserver((records) => {
      if (bar && records.every((record) => bar.contains(record.target))) return;
      queueLayout();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", queueLayout);
    document.addEventListener("stg-compose-change", queueLayout);
    queueLayout();
  }

  start();
})(typeof globalThis !== "undefined" ? globalThis : self);
