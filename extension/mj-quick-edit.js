// Midjourney quick edit. Select words in the Imagine bar (or any prompt text
// on midjourney.com): a small ✎ pill appears; click it or press ⌥E, type what
// to change, Enter. A fast model (Haiku 5.5 or DeepSeek V4.1, through the
// gallery: fal first, Pika when fal is blocked) rewrites the selection, or
// the whole prompt when nothing is selected, and the bar gets the new text
// with Undo. The world's system prompt (Prompt edit tab in the side panel)
// tells the model what the project likes. Nothing is ever sent to Midjourney.

(function registerMjQuickEdit(globalScope) {
  if (typeof document === "undefined" || !/(^|\.)midjourney\.com$/i.test(location.hostname)) return;
  if (globalScope.__saveToGalleryQuickEdit) return;
  globalScope.__saveToGalleryQuickEdit = true;

  const defaults = () => globalScope.SaveToGalleryQuickEditDefaults;
  const KEYS = { world: "quickEditWorld", model: "quickEditModel", prompts: "quickEditPrompts" };
  const settings = { world: "dear-annete", model: "haiku", prompts: {} };

  function extensionAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function loadSettings() {
    if (!extensionAlive()) return;
    chrome.storage.local.get([KEYS.world, KEYS.model, KEYS.prompts], (stored) => {
      settings.world = stored?.[KEYS.world] || "dear-annete";
      settings.model = stored?.[KEYS.model] === "deepseek" ? "deepseek" : "haiku";
      settings.prompts = stored?.[KEYS.prompts] && typeof stored[KEYS.prompts] === "object" ? stored[KEYS.prompts] : {};
      paintChips();
    });
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes[KEYS.world] || changes[KEYS.model] || changes[KEYS.prompts])) loadSettings();
    });
  } catch { /* extension reloaded */ }

  const systemPrompt = () => {
    const own = settings.prompts?.[settings.world];
    return typeof own === "string" ? own : defaults()?.byKey(settings.world)?.prompt || "";
  };

  // ── The bar ──

  function findTextarea() {
    return [...document.querySelectorAll("textarea")].find((area) => /imagine/i.test(area.getAttribute("placeholder") || "")) || null;
  }

  function writeTextareaValue(element, next) {
    const previous = element.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    const tracker = element._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Where the selection ends inside a textarea, in viewport pixels (mirror div).
  function caretPoint(area, index) {
    const style = getComputedStyle(area);
    const mirror = document.createElement("div");
    for (const prop of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
      "borderLeftWidth", "textTransform", "wordSpacing", "tabSize"]) mirror.style[prop] = style[prop];
    Object.assign(mirror.style, { position: "fixed", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
    mirror.textContent = area.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const rect = area.getBoundingClientRect();
    const point = {
      x: rect.left + marker.offsetLeft - area.scrollLeft,
      y: rect.top + marker.offsetTop - area.scrollTop,
      h: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 18,
    };
    mirror.remove();
    return {
      x: Math.min(Math.max(point.x, rect.left), rect.right),
      y: Math.min(Math.max(point.y, rect.top), rect.bottom - point.h),
      h: point.h,
    };
  }

  // ── UI (shadow DOM, so Midjourney's styles never reach it) ──

  const host = document.createElement("div");
  host.id = "stg-quick-edit";
  Object.assign(host.style, { position: "fixed", inset: "0 auto auto 0", zIndex: "2147483646", width: "0", height: "0" });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
    .pill{position:fixed;display:none;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border-radius:999px;cursor:pointer;
      background:#0A0805;color:#FFF4EA;border:1px solid rgba(255,244,234,.18);box-shadow:0 6px 18px rgba(0,0,0,.35);
      font:700 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;user-select:none}
    .pill:hover{border-color:#F26157}
    .pill kbd{font:600 9.5px/1 "JetBrains Mono",ui-monospace,monospace;color:rgba(255,244,234,.55);letter-spacing:0}
    .pill i{width:6px;height:6px;border-radius:1px;background:#F26157;display:inline-block}
    .box{position:fixed;display:none;width:min(420px,calc(100vw - 16px));padding:6px;border-radius:12px;background:#0A0805;color:#FFF4EA;
      border:1px solid rgba(255,244,234,.16);box-shadow:0 14px 40px rgba(0,0,0,.45)}
    .row{display:flex;align-items:center;gap:5px}
    .chip{flex:0 0 auto;height:28px;min-width:30px;padding:0 8px;border-radius:7px;border:1px solid rgba(255,244,234,.16);background:#191919;
      color:#FFF4EA;cursor:pointer;font:700 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.04em}
    .chip:hover{border-color:rgba(255,244,234,.4)}
    .chip.world{color:#F26157}
    input{flex:1 1 auto;min-width:0;height:28px;padding:0 9px;border-radius:7px;border:1px solid rgba(255,244,234,.16);background:#191919;
      color:#FFF4EA;font:500 13px/1 Inter,system-ui,sans-serif;outline:none}
    input:focus{border-color:#F26157}
    input::placeholder{color:rgba(255,244,234,.38)}
    .go{flex:0 0 auto;height:28px;width:30px;border-radius:7px;border:0;background:#F26157;color:#0A0805;cursor:pointer;font:800 13px/1 system-ui}
    .go:disabled{opacity:.45;cursor:default}
    .line{display:none;align-items:center;gap:10px;padding:6px 4px 1px;font:600 9.5px/1.3 "JetBrains Mono",ui-monospace,monospace;color:rgba(255,244,234,.55);letter-spacing:.02em}
    .line.show{display:flex}
    .line .err{color:#F26157}
    .line button{background:none;border:0;padding:0;color:#FFF4EA;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
    .line .sp{flex:1}
    .spin{width:10px;height:10px;border:1.5px solid rgba(255,244,234,.25);border-top-color:#F26157;border-radius:50%;animation:s .7s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
  <div class="pill" part="pill" title="Quick edit with AI (⌥E)"><i></i>Edit<kbd>⌥E</kbd></div>
  <div class="box" role="dialog" aria-label="Quick edit">
    <div class="row">
      <button class="chip world" type="button" title="World (system prompt). Click to switch."></button>
      <button class="chip model" type="button" title="Model. Click to switch."></button>
      <input type="text" placeholder="What to change…" spellcheck="false" autocomplete="off">
      <button class="go" type="button" title="Rewrite (Enter)">↵</button>
    </div>
    <div class="line"></div>
  </div>`;
  const pill = shadow.querySelector(".pill");
  const box = shadow.querySelector(".box");
  const worldChip = shadow.querySelector(".chip.world");
  const modelChip = shadow.querySelector(".chip.model");
  const input = shadow.querySelector("input");
  const go = shadow.querySelector(".go");
  const line = shadow.querySelector(".line");
  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };

  function paintChips() {
    const world = defaults()?.byKey(settings.world);
    worldChip.textContent = world?.short || "DA";
    worldChip.title = `World: ${world?.name || "Dear Annete"} (its system prompt). Click to switch.`;
    const model = defaults()?.MODELS.find((entry) => entry.key === settings.model);
    modelChip.textContent = model?.short || "H";
    modelChip.title = `Model: ${model?.name || "Haiku 5.5"}. Click to switch.`;
  }

  function place(element, point) {
    const width = element.offsetWidth || 120;
    const height = element.offsetHeight || 30;
    const x = Math.min(Math.max(8, point.x - 12), innerWidth - width - 8);
    const above = point.y - height - 8;
    const y = above > 8 ? above : Math.min(point.y + (point.h || 18) + 8, innerHeight - height - 8);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  // ── What is being edited ──

  let target = null; // { kind: "bar", start, end } | { kind: "page", text, point }
  let busy = false;
  let undo = null;

  function barTarget(area) {
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    return { kind: "bar", start, end, value: area.value };
  }

  function pageSelection() {
    const selection = getSelection();
    const text = selection?.toString().trim() || "";
    if (text.length < 4 || !selection.rangeCount) return null;
    const node = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    if (node?.closest?.("textarea, input, [contenteditable='true']")) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { kind: "page", text, point: { x: rect.right, y: rect.top, h: rect.height } };
  }

  function showPill() {
    if (box.style.display === "flex" || box.style.display === "block") return;
    const area = findTextarea();
    let point = null;
    if (area && document.activeElement === area && area.selectionEnd > area.selectionStart) {
      point = caretPoint(area, area.selectionEnd);
    } else {
      point = pageSelection()?.point || null;
    }
    if (!point) { pill.style.display = "none"; return; }
    mount();
    pill.style.display = "flex";
    place(pill, point);
  }

  function open() {
    if (!extensionAlive()) return;
    const area = findTextarea();
    // The focused bar first, then a selection on the page, then the bar's own
    // selection or its whole prompt.
    if (area && document.activeElement === area) target = barTarget(area);
    else target = pageSelection() || (area && area.value.trim() ? barTarget(area) : null);
    if (!target) return;
    mount();
    pill.style.display = "none";
    box.style.display = "block";
    const point = target.kind === "page" ? target.point : area ? caretPoint(area, target.end || area.value.length) : { x: 40, y: 80, h: 18 };
    place(box, point);
    paintChips();
    setLine("");
    input.value = "";
    input.placeholder = target.kind === "bar" && target.end > target.start ? "What to change in the selection…"
      : target.kind === "bar" ? "What to change in the prompt…" : "What to change… (result is copied)";
    input.focus();
  }

  function close() {
    box.style.display = "none";
    pill.style.display = "none";
    target = null;
    const area = findTextarea();
    if (area && undo) area.focus();
  }

  function setLine(html, kind = "") {
    line.className = `line${html ? " show" : ""}`;
    line.innerHTML = kind === "err" ? `<span class="err">${html}</span>` : html;
  }

  const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function ask(message) {
    return new Promise((resolve) => {
      if (!extensionAlive()) { resolve({ ok: false, error: "Extension reloaded. Refresh the page." }); return; }
      try {
        chrome.runtime.sendMessage({ action: "mjQuickEdit", ...message }, (res) => {
          const error = chrome.runtime.lastError?.message;
          resolve(error ? { ok: false, error } : res || { ok: false, error: "No answer." });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  async function run(instruction) {
    if (!target || busy || !instruction.trim()) return;
    const area = findTextarea();
    let prompt;
    let selection;
    if (target.kind === "bar") {
      if (!area) { setLine("No Imagine bar on this page.", "err"); return; }
      prompt = area.value;
      // The bar may have changed since the selection was made: find it again.
      const chosen = target.value.slice(target.start, target.end);
      if (chosen && prompt.slice(target.start, target.end) !== chosen) {
        const at = prompt.indexOf(chosen);
        if (at < 0) { setLine("The selection changed. Select it again.", "err"); return; }
        target = { ...target, start: at, end: at + chosen.length };
      }
      selection = target.end > target.start ? prompt.slice(target.start, target.end) : undefined;
    } else {
      prompt = target.text;
    }
    if (!prompt.trim()) { setLine("Nothing to edit.", "err"); return; }

    busy = true;
    go.disabled = true;
    const label = defaults()?.MODELS.find((entry) => entry.key === settings.model)?.name || "AI";
    setLine(`<span class="spin"></span><span>${esc(label)}…</span>`);
    const res = await ask({ prompt, selection, instruction: instruction.trim(), model: settings.model, system: systemPrompt() });
    busy = false;
    go.disabled = false;
    if (!res?.ok) { setLine(esc(res?.error || "Could not edit."), "err"); return; }

    const text = String(res.text || "");
    const meta = `${esc(res.model)} · ${(res.ms / 1000).toFixed(1)}s${res.notes?.length ? ` · ${esc(res.notes[0])}` : ""}`;
    if (target.kind === "page") {
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard refused */ }
      target = { ...target, text };
      setLine(`<span>Copied · ${meta}</span><span class="sp"></span>${area ? '<button data-act="bar" type="button">Put in bar</button>' : ""}`);
      return;
    }
    const before = { value: prompt, start: target.start, end: target.end };
    const next = selection ? prompt.slice(0, target.start) + text + prompt.slice(target.end) : text;
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    writeTextareaValue(area, next);
    const start = selection ? target.start : 0;
    const end = selection ? target.start + text.length : 0;
    area.setSelectionRange(selection ? start : next.length, selection ? end : next.length);
    undo = before;
    target = { kind: "bar", start, end, value: next };
    input.value = "";
    input.placeholder = "Another change… (Esc to close)";
    setLine(`<span>${meta}</span><span class="sp"></span><button data-act="undo" type="button">Undo</button>`);
  }

  function doUndo() {
    const area = findTextarea();
    if (!area || !undo) return;
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    writeTextareaValue(area, undo.value);
    area.setSelectionRange(undo.start, undo.end || undo.value.length);
    target = { kind: "bar", start: undo.start, end: undo.end, value: undo.value };
    undo = null;
    setLine("Undone.");
    input.focus();
  }

  // ── Events ──

  worldChip.addEventListener("mousedown", (event) => event.preventDefault());
  worldChip.addEventListener("click", () => {
    const worlds = defaults()?.WORLDS || [];
    const at = worlds.findIndex((world) => world.key === settings.world);
    settings.world = worlds[(at + 1) % worlds.length]?.key || "dear-annete";
    paintChips();
    if (extensionAlive()) chrome.storage.local.set({ [KEYS.world]: settings.world });
    input.focus();
  });
  modelChip.addEventListener("mousedown", (event) => event.preventDefault());
  modelChip.addEventListener("click", () => {
    settings.model = settings.model === "haiku" ? "deepseek" : "haiku";
    paintChips();
    if (extensionAlive()) chrome.storage.local.set({ [KEYS.model]: settings.model });
    input.focus();
  });
  go.addEventListener("click", () => void run(input.value));
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void run(input.value); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !input.value && undo) { event.preventDefault(); doUndo(); }
  });
  input.addEventListener("keyup", (event) => event.stopPropagation());
  input.addEventListener("keypress", (event) => event.stopPropagation());
  line.addEventListener("click", (event) => {
    const act = event.target?.dataset?.act;
    if (act === "undo") doUndo();
    if (act === "bar" && target?.kind === "page") {
      const area = findTextarea();
      if (!area) return;
      undo = { value: area.value, start: 0, end: 0 };
      globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
      writeTextareaValue(area, target.text);
      target = { kind: "bar", start: 0, end: 0, value: target.text };
      setLine(`<span>In the bar.</span><span class="sp"></span><button data-act="undo" type="button">Undo</button>`);
    }
  });
  pill.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  pill.addEventListener("click", () => open());

  // The pill follows selections; clicks elsewhere close the box.
  let pillTimer = null;
  const schedulePill = () => { clearTimeout(pillTimer); pillTimer = setTimeout(showPill, 120); };
  document.addEventListener("mouseup", (event) => { if (!event.composedPath().includes(host)) schedulePill(); }, true);
  document.addEventListener("keyup", (event) => { if (event.shiftKey || event.key === "Shift") schedulePill(); }, true);
  document.addEventListener("selectionchange", () => {
    if (pill.style.display !== "flex") return;
    const area = findTextarea();
    const hasBar = area && document.activeElement === area && area.selectionEnd > area.selectionStart;
    if (!hasBar && !pageSelection()) pill.style.display = "none";
  });
  document.addEventListener("mousedown", (event) => {
    if (event.composedPath().includes(host)) return;
    if (box.style.display === "block" && !busy) close();
  }, true);
  addEventListener("scroll", () => { pill.style.display = "none"; }, true);

  // ⌥E opens it on the selection (or the whole prompt in the bar).
  document.addEventListener("keydown", (event) => {
    if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.code !== "KeyE") return;
    if (event.composedPath().includes(host)) return;
    event.preventDefault();
    event.stopPropagation();
    if (box.style.display === "block") close();
    else open();
  }, true);

  loadSettings();
  globalScope.SaveToGalleryQuickEdit = { open, close };
})(typeof globalThis !== "undefined" ? globalThis : self);
