// The side panel's MJ settings tab, top block: the dock's keys. Click a key,
// press the new one (Backspace clears it, Esc keeps the old one). Saved in
// chrome.storage.sync; open Midjourney tabs pick a change up at once.

(function registerHotkeySettings(globalScope) {
  const root = document.getElementById("qeRoot");
  const api = globalScope.SaveToGalleryHotkeys;
  if (!root || !api) return;

  const box = document.createElement("div");
  box.className = "hk";
  root.prepend(box);

  let current = api.resolve(null);
  let recording = "";
  let message = "";
  let messageTimer = null;
  const labelOf = (id) => api.ACTIONS.find((action) => action.id === id)?.label || id;

  function save() {
    chrome.storage.sync.set({ [api.STORAGE_KEY]: { enabled: current.enabled, bindings: current.bindings } });
  }

  function say(text) {
    message = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = "";
      render();
    }, 3200);
  }

  function keyButton(action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hk-key";
    const combo = current.bindings[action.id];
    if (recording === action.id) {
      button.classList.add("hk-key--rec");
      button.textContent = "Press keys…";
    } else {
      button.textContent = combo ? api.formatCombo(combo) : "—";
      if (!combo) button.classList.add("hk-key--off");
    }
    button.title = `${action.label}: click, then press the new keys. Backspace clears.`;
    button.addEventListener("click", () => {
      recording = recording === action.id ? "" : action.id;
      render();
    });
    return button;
  }

  function render() {
    box.textContent = "";
    const head = document.createElement("div");
    head.className = "hk-head";
    const title = document.createElement("p");
    title.className = "qe-label hk-title";
    title.textContent = "Dock keys";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "hk-toggle";
    toggle.setAttribute("aria-pressed", String(current.enabled));
    toggle.textContent = current.enabled ? "On" : "Off";
    toggle.addEventListener("click", () => {
      current = { ...current, enabled: !current.enabled };
      recording = "";
      save();
      render();
    });
    head.append(title, toggle);

    const how = document.createElement("p");
    how.className = "qe-how";
    how.innerHTML =
      "While you write a prompt on midjourney.com, a key adds or removes the moodboard, profile or preset in that place in the dock. Hold <kbd>⌥</kbd> there to see each one's key.";
    box.append(head, how);

    const groups = [];
    for (const action of api.ACTIONS) {
      let group = groups.find((entry) => entry.name === action.group);
      if (!group) groups.push((group = { name: action.group, actions: [] }));
      group.actions.push(action);
    }
    for (const group of groups) {
      const label = document.createElement("p");
      label.className = "qe-label";
      label.textContent = group.name;
      const grid = document.createElement("div");
      grid.className = group.actions[0].slot ? "hk-grid" : "hk-list";
      for (const action of group.actions) {
        const cell = document.createElement("div");
        cell.className = "hk-cell";
        const name = document.createElement("span");
        name.className = action.slot ? "hk-slot" : "hk-name";
        name.textContent = action.slot ? String(action.slot) : action.label;
        cell.append(name, keyButton(action));
        grid.appendChild(cell);
      }
      box.append(label, grid);
    }

    const foot = document.createElement("div");
    foot.className = "qe-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "qe-reset";
    reset.textContent = "Reset keys";
    reset.addEventListener("click", () => {
      current = { enabled: true, bindings: { ...api.DEFAULTS } };
      recording = "";
      save();
      say("Keys reset");
      render();
    });
    const status = document.createElement("span");
    status.className = "qe-saved";
    status.setAttribute("aria-live", "polite");
    status.textContent = message;
    foot.append(reset, status);
    const rule = document.createElement("div");
    rule.className = "hk-rule";
    box.append(foot, rule);
    box.classList.toggle("hk--off", !current.enabled);
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!recording) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        recording = "";
        render();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        current = { ...current, bindings: { ...current.bindings, [recording]: "" } };
        say(`${labelOf(recording)}: no key`);
        recording = "";
        save();
        render();
        return;
      }
      const combo = api.comboFromEvent(event);
      if (!combo) return; // a modifier on its own: wait for the key
      if (!api.isUsableCombo(combo)) {
        say("Add ⌥, ⌃ or ⌘ so typing stays typing");
        render();
        return;
      }
      if (api.RESERVED[combo]) {
        say(`${api.formatCombo(combo)} is ${api.RESERVED[combo]}`);
        render();
        return;
      }
      const { bindings, movedFrom } = api.assign(current.bindings, recording, combo);
      current = { ...current, bindings };
      say(movedFrom ? `${api.formatCombo(combo)} moved from ${labelOf(movedFrom)}` : "Saved");
      recording = "";
      save();
      render();
    },
    true,
  );

  chrome.storage.sync.get(api.STORAGE_KEY, (stored) => {
    current = api.resolve(stored?.[api.STORAGE_KEY]);
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[api.STORAGE_KEY] || recording) return;
    current = api.resolve(changes[api.STORAGE_KEY].newValue);
    render();
  });
  render();
})(typeof globalThis !== "undefined" ? globalThis : self);
