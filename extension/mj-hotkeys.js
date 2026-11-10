// Keys for the Midjourney dock: add or remove the Nth moodboard, profile or
// preset, step through worlds, open the world list, save a preset. Shared by
// the dock (content script) and the settings tab of the side panel.
// A combo is "Ctrl+Alt+Shift+Meta+<KeyboardEvent.code>", modifiers in that
// order; event.code keeps Option+1 readable on a Mac (its key is "¡").

(function registerHotkeys(globalScope) {
  const STORAGE_KEY = "stgMjHotkeys";
  const SLOTS = 9;

  const ACTIONS = [];
  for (let n = 1; n <= SLOTS; n++) ACTIONS.push({ id: `board:${n}`, group: "Moodboards", label: `Moodboard ${n}`, slot: n });
  for (let n = 1; n <= SLOTS; n++) ACTIONS.push({ id: `profile:${n}`, group: "Profiles", label: `Profile ${n}`, slot: n });
  for (let n = 1; n <= SLOTS; n++) ACTIONS.push({ id: `preset:${n}`, group: "Presets", label: `Preset ${n}`, slot: n });
  ACTIONS.push(
    { id: "world:prev", group: "Dock", label: "Previous world" },
    { id: "world:next", group: "Dock", label: "Next world" },
    { id: "world:pick", group: "Dock", label: "Open world list" },
    { id: "preset:save", group: "Dock", label: "Save as preset" },
  );

  const DEFAULTS = {};
  for (let n = 1; n <= SLOTS; n++) {
    DEFAULTS[`board:${n}`] = `Alt+Digit${n}`;
    DEFAULTS[`profile:${n}`] = `Alt+Shift+Digit${n}`;
    DEFAULTS[`preset:${n}`] = `Ctrl+Alt+Digit${n}`;
  }
  Object.assign(DEFAULTS, {
    "world:prev": "Alt+BracketLeft",
    "world:next": "Alt+BracketRight",
    "world:pick": "Alt+KeyW",
    "preset:save": "Alt+KeyS",
  });

  // Taken by other parts of the extension on midjourney.com.
  const RESERVED = { "Alt+KeyE": "Quick edit", "Alt+KeyX": "Grow from a picture", "Alt+Shift+KeyN": "Queue: new prompt" };

  const MODIFIER_CODES = new Set([
    "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "CapsLock", "Fn",
  ]);

  function comboFromEvent(event) {
    if (!event || !event.code || MODIFIER_CODES.has(event.code)) return "";
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(event.code);
    return parts.join("+");
  }

  // A key alone would fire while typing the prompt: a combo needs Ctrl, Alt
  // or Meta, except the function keys.
  function isUsableCombo(combo) {
    const parts = String(combo || "").split("+");
    const code = parts[parts.length - 1];
    if (!code) return false;
    if (/^F([1-9]|1[0-9])$/.test(code)) return true;
    return parts.some((part) => part === "Ctrl" || part === "Alt" || part === "Meta");
  }

  const KEY_NAMES = {
    BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
    Slash: "/", Backslash: "\\", Backquote: "`", Space: "Space", Enter: "↩", Tab: "⇥", ArrowUp: "↑", ArrowDown: "↓",
    ArrowLeft: "←", ArrowRight: "→", Backspace: "⌫", Delete: "⌦", Escape: "Esc",
  };

  function keyName(code) {
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    return KEY_NAMES[code] || code;
  }

  function isMacPlatform() {
    const nav = globalScope.navigator || {};
    return /Mac|iPhone|iPad/i.test(String(nav.userAgentData?.platform || nav.platform || nav.userAgent || ""));
  }

  function formatCombo(combo, mac = isMacPlatform()) {
    if (!combo) return "";
    const parts = String(combo).split("+");
    const code = parts.pop();
    const symbols = mac
      ? { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
      : { Ctrl: "Ctrl+", Alt: "Alt+", Shift: "Shift+", Meta: "Win+" };
    return parts.map((part) => symbols[part] || "").join("") + keyName(code);
  }

  // Stored: { enabled, bindings: { actionId: combo | "" } }. A missing action
  // takes its default; "" means switched off by hand.
  function resolve(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const saved = source.bindings && typeof source.bindings === "object" ? source.bindings : {};
    const bindings = {};
    for (const action of ACTIONS) {
      const value = Object.prototype.hasOwnProperty.call(saved, action.id) ? saved[action.id] : DEFAULTS[action.id];
      bindings[action.id] = typeof value === "string" && (value === "" || isUsableCombo(value)) ? value : DEFAULTS[action.id] || "";
    }
    return { enabled: source.enabled !== false, bindings };
  }

  // combo -> action id; the first action wins when two share a combo.
  function comboMap(resolved) {
    const map = new Map();
    if (!resolved || !resolved.enabled) return map;
    for (const action of ACTIONS) {
      const combo = resolved.bindings[action.id];
      if (combo && !map.has(combo)) map.set(combo, action.id);
    }
    return map;
  }

  // Binding a combo already used by another action moves it: the other one
  // is left without a key. Returns the next bindings and the action it took
  // the combo from, if any.
  function assign(bindings, actionId, combo) {
    const next = { ...bindings };
    let movedFrom = "";
    if (combo) {
      for (const [id, value] of Object.entries(next)) {
        if (id !== actionId && value === combo) {
          next[id] = "";
          movedFrom = id;
        }
      }
    }
    next[actionId] = combo || "";
    return { bindings: next, movedFrom };
  }

  globalScope.SaveToGalleryHotkeys = {
    STORAGE_KEY,
    SLOTS,
    ACTIONS,
    DEFAULTS,
    RESERVED,
    comboFromEvent,
    isUsableCombo,
    formatCombo,
    resolve,
    comboMap,
    assign,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
