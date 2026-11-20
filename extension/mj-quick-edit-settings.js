// The side panel's MJ settings → Writer: the default model every writer tool
// runs on (Grow, Describe, the quick edit), where it runs (this Mac or the
// gallery's providers), and the system prompts, in the open:
//   - each tool's own system prompt, loaded from the gallery as it builds it
//     today, editable here (saved as you type, sent with every call as
//     `rules`; Reset brings the gallery's default back),
//   - the world notes added after it (edited per world, as before),
//   - "Last sent": the whole system prompt the tool's last answer was written
//     with, world files included, read-only with Copy.
// Storage: chrome.storage.sync writerModel / writerMode, chrome.storage.local
// writerRules {grow, describe, edit}, writerLastSystem, quickEditPrompts.

(function registerQuickEditSettings(globalScope) {
  const root = document.getElementById("qeRoot");
  const defaults = globalScope.SaveToGalleryQuickEditDefaults;
  if (!root || !defaults) return;
  const KEYS = defaults.STORAGE;
  const W = { model: "writerModel", mode: "writerMode", rules: "writerRules", last: "writerLastSystem" };
  const MODES = [
    { key: "auto", name: "Auto", hint: "This Mac when the local writer is running, else the gallery's providers." },
    { key: "local", name: "This Mac", hint: "Only the local writer on this Mac (claude -p). DeepSeek has no local run." },
    { key: "cloud", name: "Cloud", hint: "The gallery's providers: fal first, Pika when fal is out of credit." },
  ];
  const TOOLS = [
    { key: "grow", name: "Grow" },
    { key: "describe", name: "Describe" },
    { key: "edit", name: "Quick edit" },
    { key: "world", name: "World notes" },
  ];
  const state = {
    world: "dear-annete", model: "haiku", mode: "auto", tool: "grow", prompts: {}, rules: {}, last: {},
    gallery: null, galleryError: "", bridge: null, showLast: false,
  };

  root.innerHTML = `
    <div class="qe">
      <p class="qe-title">Writer</p>
      <p class="qe-how">The model and system prompts behind <b>Grow</b> (⌥X on a frame), <b>Describe</b> and the quick <b>✎ Edit</b> (⌥E in the Imagine bar).</p>
      <p class="qe-label">Default model · every tool</p>
      <div class="qe-seg qe-seg--wrap" role="tablist" aria-label="Writer model" data-group="model"></div>
      <p class="qe-hint" data-hint="model"></p>
      <p class="qe-label">Runs on</p>
      <div class="qe-seg" role="tablist" aria-label="Where the writer runs" data-group="mode"></div>
      <p class="qe-hint" data-hint="mode"></p>
      <p class="qe-label">Cloud key · fal</p>
      <p class="qe-hint qe-key-state" aria-live="polite">Checking the key…</p>
      <div class="qe-key-row">
        <input class="qe-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste a fal API key" aria-label="fal API key">
        <button class="qe-reset qe-key-save" type="button">Save</button>
      </div>
      <p class="qe-hint qe-key-msg" aria-live="polite"></p>

      <div class="qe-head qe-head--sys">
        <p class="qe-label">System prompt</p>
        <span class="qe-saved" aria-live="polite"></span>
      </div>
      <div class="qe-seg" role="tablist" aria-label="Which system prompt" data-group="tool"></div>
      <div class="qe-world" hidden>
        <p class="qe-hint">Added after the tool's own prompt for this world (the edit and Describe always; Grow on Dear Annete and Andromeda worlds).</p>
        <div class="qe-seg" role="tablist" aria-label="World" data-group="world"></div>
      </div>
      <textarea class="qe-text" spellcheck="false" rows="16"></textarea>
      <div class="qe-actions">
        <button class="qe-reset" type="button">Reset to default</button>
        <span class="qe-count"></span>
      </div>
      <p class="qe-adds"></p>
      <div class="qe-last-bar">
        <button class="qe-reset qe-last-toggle" type="button">Show last sent</button>
        <button class="qe-reset qe-copy" type="button" hidden>Copy</button>
        <span class="qe-count qe-last-meta"></span>
      </div>
      <textarea class="qe-text qe-last" spellcheck="false" rows="14" readonly hidden></textarea>
      <p class="qe-note">A rewrite on Haiku costs well under a cent; Opus and Fable cost more and take longer.</p>
    </div>`;

  const $ = (selector) => root.querySelector(selector);
  const seg = (group) => root.querySelector(`[data-group="${group}"]`);
  const hint = (name) => root.querySelector(`[data-hint="${name}"]`);
  const text = $(".qe-text:not(.qe-last)");
  const saved = $(".qe-saved");
  const count = $(".qe-actions .qe-count");
  const reset = $(".qe-actions .qe-reset");
  const adds = $(".qe-adds");
  const worldBox = $(".qe-world");
  const lastToggle = $(".qe-last-toggle");
  const lastCopy = $(".qe-copy");
  const lastMeta = $(".qe-last-meta");
  const lastText = $(".qe-last");
  const keyState = $(".qe-key-state");
  const keyInput = $(".qe-key");
  const keySave = $(".qe-key-save");
  const keyMsg = $(".qe-key-msg");

  const button = (label, selected, onClick, title) => {
    const el = document.createElement("button");
    el.type = "button";
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(selected));
    el.textContent = label;
    if (title) el.title = title;
    el.addEventListener("click", onClick);
    return el;
  };
  const flash = (message) => {
    saved.textContent = message;
    setTimeout(() => { if (saved.textContent === message) saved.textContent = ""; }, 1400);
  };
  const ask = (message) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ action: "writer", ...message }, (res) => resolve(chrome.runtime.lastError ? null : res)); } catch { resolve(null); }
  });

  const models = () => defaults.MODELS;
  const modelOf = (key) => models().find((entry) => entry.key === key) || models()[0];
  const galleryTool = (key) => state.gallery?.tools?.find((tool) => tool.key === key) || null;
  const worldPrompt = (key) => defaults.resolve(key, state.prompts[key]);
  const isWorld = () => state.tool === "world";
  // The text the box shows: the custom copy, else the gallery's default.
  const toolText = (key) => (typeof state.rules[key] === "string" && state.rules[key].trim() ? state.rules[key] : galleryTool(key)?.rules || "");
  const toolCustom = (key) => typeof state.rules[key] === "string" && state.rules[key].trim() !== "" && state.rules[key] !== galleryTool(key)?.rules;

  function bridgeLine() {
    const b = state.bridge;
    const model = modelOf(state.model);
    if (!b) return "";
    if (!b.up) return state.mode === "local" ? "The local writer is not running on this Mac: nothing can be written." : "Local writer: not running on this Mac, so the cloud writes.";
    const runs = (b.bridgeModels || []).includes(model.key);
    if (!model.local) return `${model.name} has no local run: the cloud writes${state.mode === "local" ? " nothing while Runs on is This Mac" : ""}.`;
    if (!runs) return `The local writer here is older and cannot run ${model.name}: run extension-writer/install.sh again.${state.mode === "local" ? "" : " Until then the cloud writes."}`;
    return state.mode === "cloud" ? "Local writer is running, but Cloud is picked." : `Writes on this Mac with ${model.name}.`;
  }

  function render() {
    const model = modelOf(state.model);
    seg("model").replaceChildren(...models().map((entry) => button(entry.name, entry.key === state.model, () => {
      state.model = entry.key;
      chrome.storage.sync.set({ [W.model]: entry.key });
      render();
    }, entry.hint)));
    hint("model").textContent = model.hint || "";
    seg("mode").replaceChildren(...MODES.map((entry) => button(entry.name, entry.key === state.mode, () => {
      state.mode = entry.key;
      chrome.storage.sync.set({ [W.mode]: entry.key });
      render();
    }, entry.hint)));
    hint("mode").textContent = [MODES.find((entry) => entry.key === state.mode)?.hint, bridgeLine()].filter(Boolean).join(" ");

    seg("tool").replaceChildren(...TOOLS.map((entry) => button(entry.name, entry.key === state.tool, () => {
      state.tool = entry.key;
      state.showLast = false;
      render();
    })));
    worldBox.hidden = !isWorld();
    seg("world").replaceChildren(...defaults.WORLDS.map((world) => button(world.name, world.key === state.world, () => {
      state.world = world.key;
      chrome.storage.local.set({ [KEYS.world]: state.world });
      render();
    })));

    if (isWorld()) {
      if (document.activeElement !== text) text.value = worldPrompt(state.world);
      const custom = worldPrompt(state.world) !== defaults.byKey(state.world).prompt;
      text.disabled = false;
      reset.disabled = !custom;
      count.textContent = `${text.value.length} chars${custom ? " · edited" : " · default"}`;
      adds.textContent = "";
    } else {
      const tool = galleryTool(state.tool);
      const custom = toolCustom(state.tool);
      if (document.activeElement !== text) {
        text.value = tool || custom ? toolText(state.tool) : state.galleryError ? `Could not load this prompt from the gallery: ${state.galleryError}` : "Loading from the gallery…";
      }
      text.disabled = !tool && !custom;
      reset.disabled = !custom;
      count.textContent = tool || custom ? `${text.value.length} chars${custom ? " · edited" : " · gallery default"}` : "";
      adds.textContent = tool?.adds?.length ? `Then added on every call: ${tool.adds.join(" · ")}.` : "";
    }

    const last = isWorld() ? null : state.last?.[state.tool];
    lastToggle.parentElement.hidden = isWorld();
    lastToggle.disabled = !last;
    lastToggle.textContent = state.showLast ? "Hide last sent" : "Show last sent";
    lastText.hidden = !(state.showLast && last);
    lastCopy.hidden = lastText.hidden;
    lastMeta.textContent = last
      ? `${new Date(last.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${last.model || "?"}${last.world ? ` · ${String(last.world).toUpperCase()}` : ""} · ${last.text.length} chars`
      : "nothing sent yet";
    if (last && state.showLast) lastText.value = last.text;
  }

  let timer = null;
  text.addEventListener("input", () => {
    clearTimeout(timer);
    saved.textContent = "";
    count.textContent = `${text.value.length} chars · edited`;
    const tool = state.tool;
    const world = state.world;
    timer = setTimeout(() => {
      if (tool === "world") {
        state.prompts = { ...state.prompts, [world]: text.value.slice(0, 8000) };
        chrome.storage.local.set({ [KEYS.prompts]: state.prompts }, () => { flash("Saved"); reset.disabled = false; });
        return;
      }
      const limit = state.gallery?.limit || 60000;
      const next = { ...state.rules };
      // Text equal to the gallery's default is no edit: keep following the gallery.
      if (!text.value.trim() || text.value === galleryTool(tool)?.rules) delete next[tool];
      else next[tool] = text.value.slice(0, limit);
      state.rules = next;
      chrome.storage.local.set({ [W.rules]: next }, () => { flash("Saved"); render(); });
    }, 400);
  });

  reset.addEventListener("click", () => {
    if (isWorld()) {
      const next = { ...state.prompts };
      delete next[state.world];
      state.prompts = next;
      chrome.storage.local.set({ [KEYS.prompts]: next }, () => {
        text.value = worldPrompt(state.world);
        flash("Default back");
        render();
      });
      return;
    }
    const next = { ...state.rules };
    delete next[state.tool];
    state.rules = next;
    chrome.storage.local.set({ [W.rules]: next }, () => {
      text.value = toolText(state.tool);
      flash("Default back");
      render();
    });
  });

  lastToggle.addEventListener("click", () => { state.showLast = !state.showLast; render(); });
  lastCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lastText.value); flash("Copied"); } catch { lastText.select(); }
  });

  async function loadGallery() {
    const res = await ask({ do: "prompts" });
    if (res?.ok && Array.isArray(res.tools)) {
      state.gallery = res;
      state.galleryError = "";
    } else {
      state.galleryError = res?.error || "the gallery did not answer";
    }
    render();
  }
  // Cloud key · fal: which key the cloud writer uses (yours, saved here; the
  // gallery's own; none), checked with its balance. A new key is saved in the
  // gallery (sealed, only its last four shown) once fal accepts it and it has
  // credit; it then serves every cloud write, from any copy of the extension.
  function keyLine(row) {
    if (!row) return "Could not read the key from the gallery.";
    const who = row.source === "app" ? `Your key ····${row.hint || ""}` : row.source === "server" ? "The gallery's own key" : "No fal key: the cloud writer skips fal";
    const check = row.check?.message ? ` · ${row.check.message}` : "";
    return `${who}${check}`;
  }
  async function loadKeys() {
    const res = await ask({ do: "keys" });
    const row = res?.ok ? (res.keys || []).find((entry) => entry.provider === "fal") : null;
    keyState.textContent = res?.ok ? keyLine(row) : `Could not read the key: ${res?.error || "the gallery did not answer"}.`;
    keyState.classList.toggle("qe-key-state--bad", Boolean(row && (row.source === "none" || row.check?.ok === false)));
  }
  async function saveKey() {
    const key = keyInput.value.trim();
    if (!key) { keyMsg.textContent = "Paste a fal key first."; return; }
    keySave.disabled = true;
    keyMsg.textContent = "Checking the key with fal…";
    const res = await ask({ do: "saveKey", provider: "fal", key });
    keySave.disabled = false;
    if (res?.ok && res.saved) {
      keyInput.value = "";
      keyMsg.textContent = res.message || "Saved.";
      void loadKeys();
    } else {
      keyMsg.textContent = res?.message || res?.error || "The gallery did not answer.";
    }
  }
  keySave.addEventListener("click", () => { void saveKey(); });
  keyInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void saveKey(); } });

  async function loadBridge(fresh = false) {
    const res = await ask({ fresh });
    if (res?.ok) state.bridge = res;
    render();
  }

  chrome.storage.local.get([KEYS.world, KEYS.prompts, W.rules, W.last], (stored) => {
    state.world = stored?.[KEYS.world] || "dear-annete";
    state.prompts = stored?.[KEYS.prompts] && typeof stored[KEYS.prompts] === "object" ? stored[KEYS.prompts] : {};
    state.rules = stored?.[W.rules] && typeof stored[W.rules] === "object" ? stored[W.rules] : {};
    state.last = stored?.[W.last] && typeof stored[W.last] === "object" ? stored[W.last] : {};
    render();
  });
  chrome.storage.sync.get([W.model, W.mode], (stored) => {
    state.model = models().some((entry) => entry.key === stored?.[W.model]) ? stored[W.model] : "haiku";
    state.mode = MODES.some((entry) => entry.key === stored?.[W.mode]) ? stored[W.mode] : "auto";
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      if (changes[W.model]) state.model = changes[W.model].newValue || "haiku";
      if (changes[W.mode]) state.mode = changes[W.mode].newValue || "auto";
      if (changes[W.model] || changes[W.mode]) void loadBridge();
      return;
    }
    if (area !== "local") return;
    if (changes[KEYS.world]) state.world = changes[KEYS.world].newValue || "dear-annete";
    if (changes[KEYS.prompts] && document.activeElement !== text) state.prompts = changes[KEYS.prompts].newValue || {};
    if (changes[W.rules] && document.activeElement !== text) state.rules = changes[W.rules].newValue || {};
    if (changes[W.last]) state.last = changes[W.last].newValue || {};
    render();
  });

  // The defaults come from the gallery each time the tab opens, so the panel
  // always shows what the gallery builds today.
  const tab = document.getElementById("editModeTab");
  tab?.addEventListener("click", () => { void loadGallery(); void loadBridge(true); void loadKeys(); });
  void loadGallery();
  void loadBridge();
  void loadKeys();
})(typeof globalThis !== "undefined" ? globalThis : self);
