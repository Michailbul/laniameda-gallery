// The side panel's Prompt edit tab: which world's system prompt the quick
// edit uses, which model, and the system prompt itself (edited per world,
// saved as you type, Reset brings back the default).

(function registerQuickEditSettings(globalScope) {
  const root = document.getElementById("qeRoot");
  const defaults = globalScope.SaveToGalleryQuickEditDefaults;
  if (!root || !defaults) return;
  const KEYS = defaults.STORAGE;
  const state = { world: "dear-annete", model: "haiku", prompts: {} };

  root.innerHTML = `
    <div class="qe">
      <p class="qe-how">On midjourney.com select words in the Imagine bar, then click <b>✎ Edit</b> or press <kbd>⌥E</kbd>. Say what to change; the bar gets the new text, with Undo. Nothing selected edits the whole prompt.</p>
      <p class="qe-label">World</p>
      <div class="qe-seg" role="tablist" aria-label="World" data-group="world"></div>
      <p class="qe-label">Model</p>
      <div class="qe-seg" role="tablist" aria-label="Model" data-group="model"></div>
      <div class="qe-head">
        <p class="qe-label">System prompt · <span class="qe-world-name"></span></p>
        <span class="qe-saved" aria-live="polite"></span>
      </div>
      <textarea class="qe-text" spellcheck="false" rows="16"></textarea>
      <div class="qe-actions">
        <button class="qe-reset" type="button">Reset to default</button>
        <span class="qe-count"></span>
      </div>
      <p class="qe-note">Runs through the gallery: fal first, Pika when fal is out of credit. A rewrite costs well under a cent.</p>
    </div>`;

  const worldSeg = root.querySelector('[data-group="world"]');
  const modelSeg = root.querySelector('[data-group="model"]');
  const text = root.querySelector(".qe-text");
  const saved = root.querySelector(".qe-saved");
  const count = root.querySelector(".qe-count");
  const worldName = root.querySelector(".qe-world-name");
  const reset = root.querySelector(".qe-reset");

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

  const promptFor = (key) => (typeof state.prompts[key] === "string" ? state.prompts[key] : defaults.byKey(key).prompt);

  function render() {
    worldSeg.replaceChildren(...defaults.WORLDS.map((world) => button(world.name, world.key === state.world, () => {
      state.world = world.key;
      chrome.storage.local.set({ [KEYS.world]: state.world });
      render();
    })));
    modelSeg.replaceChildren(...defaults.MODELS.map((model) => button(model.name, model.key === state.model, () => {
      state.model = model.key;
      chrome.storage.local.set({ [KEYS.model]: state.model });
      render();
    })));
    worldName.textContent = defaults.byKey(state.world).name;
    if (document.activeElement !== text) text.value = promptFor(state.world);
    const custom = typeof state.prompts[state.world] === "string" && state.prompts[state.world] !== defaults.byKey(state.world).prompt;
    reset.disabled = !custom;
    count.textContent = `${text.value.length} chars${custom ? " · edited" : " · default"}`;
  }

  let timer = null;
  text.addEventListener("input", () => {
    clearTimeout(timer);
    saved.textContent = "";
    count.textContent = `${text.value.length} chars · edited`;
    timer = setTimeout(() => {
      state.prompts = { ...state.prompts, [state.world]: text.value.slice(0, 8000) };
      chrome.storage.local.set({ [KEYS.prompts]: state.prompts }, () => {
        saved.textContent = "Saved";
        setTimeout(() => { saved.textContent = ""; }, 1400);
        reset.disabled = false;
      });
    }, 400);
  });

  reset.addEventListener("click", () => {
    const next = { ...state.prompts };
    delete next[state.world];
    state.prompts = next;
    chrome.storage.local.set({ [KEYS.prompts]: next }, () => {
      text.value = promptFor(state.world);
      saved.textContent = "Default back";
      setTimeout(() => { saved.textContent = ""; }, 1400);
      render();
    });
  });

  chrome.storage.local.get([KEYS.world, KEYS.model, KEYS.prompts], (stored) => {
    state.world = stored?.[KEYS.world] || "dear-annete";
    state.model = stored?.[KEYS.model] === "deepseek" ? "deepseek" : "haiku";
    state.prompts = stored?.[KEYS.prompts] && typeof stored[KEYS.prompts] === "object" ? stored[KEYS.prompts] : {};
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEYS.world]) state.world = changes[KEYS.world].newValue || "dear-annete";
    if (changes[KEYS.model]) state.model = changes[KEYS.model].newValue === "deepseek" ? "deepseek" : "haiku";
    if (changes[KEYS.prompts] && document.activeElement !== text) state.prompts = changes[KEYS.prompts].newValue || {};
    render();
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
