// The describer: a picture taken apart the way a cinematographer would see
// it, and one Midjourney V8.2 prompt built from that (the gallery's
// /api/extension/prompt-describe; the writer runs on this Mac or through the
// gallery's providers). Mounted in the side panel's Describe tab
// (describe-panel.js): drop or paste a picture, pick a recent Midjourney
// describe, or right-click an image → "Describe to a prompt".
//
// Michael, 17 Nov 2026: "The describer feature should describe the image:
// cinematography, lighting etc." The answer comes back as short labelled lines
// (subject, shot, lens, composition, light, palette, materials, setting, mood,
// medium), each with Copy, plus Copy all, and the prompt with Put in bar,
// Queue, Copy and Save to gallery. Nothing is ever sent to Midjourney: every
// job stays Michael's own click.

(function registerDescribeCore(globalScope) {
  if (globalScope.SaveToGalleryDescribe) return;

  const STORE = {
    world: "stgMoodboardWorld", // shared with the dock
    recent: "mjDescribes", // last Midjourney describes the extension caught
    qePrompts: "quickEditPrompts",
  };
  const RECENT_MAX = 24;

  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const ask = (op, payload = {}) => new Promise((resolve) => {
    if (!alive()) { resolve({ ok: false, error: "Extension reloaded. Refresh the page." }); return; }
    try {
      chrome.runtime.sendMessage({ action: "describe", op, ...payload }, (res) => {
        const error = chrome.runtime.lastError?.message;
        resolve(error ? { ok: false, error } : res || { ok: false, error: "No answer." });
      });
    } catch (err) { resolve({ ok: false, error: String(err?.message || err) }); }
  });
  const local = (keys) => new Promise((resolve) => { try { chrome.storage.local.get(keys, (v) => resolve(v || {})); } catch { resolve({}); } });
  const setLocal = (value) => { try { chrome.storage.local.set(value); } catch { /* reloaded */ } };

  // The quick edit's world prompts cover Dear Annete and Andromeda worlds:
  // they give the writer the world's words for places and light.
  const quickEditKeyFor = (worldKey) => (/^dear-annete/.test(worldKey || "") ? "dear-annete" : /^andromeda/.test(worldKey || "") ? "andromeda-anya" : "none");
  async function systemPromptFor(worldKey) {
    const stored = await local([STORE.qePrompts]);
    const key = quickEditKeyFor(worldKey);
    const own = stored[STORE.qePrompts]?.[key];
    const d = globalScope.SaveToGalleryQuickEditDefaults;
    return d?.resolve ? d.resolve(key, own) : typeof own === "string" ? own : d?.byKey(key)?.prompt || "";
  }

  // ── Midjourney describes the extension caught (mj-describe.js writes them) ──

  async function recentDescribes() {
    const stored = await local([STORE.recent]);
    return Array.isArray(stored[STORE.recent]) ? stored[STORE.recent] : [];
  }
  async function rememberDescribe(entry) {
    if (!entry?.imageUrl || !entry.descriptions?.length) return;
    const list = (await recentDescribes()).filter((row) => row.imageUrl !== entry.imageUrl);
    list.unshift({ imageUrl: entry.imageUrl, descriptions: entry.descriptions.slice(0, 4), aspect: entry.aspect || null, pageUrl: entry.pageUrl || "", at: Date.now() });
    setLocal({ [STORE.recent]: list.slice(0, RECENT_MAX) });
  }
  async function describesFor(imageUrl) {
    if (!imageUrl) return null;
    const bare = (url) => String(url).split("?")[0];
    return (await recentDescribes()).find((row) => bare(row.imageUrl) === bare(imageUrl)) || null;
  }

  // "Shot: A full shot from eye level." lines for Copy all (pure, tested).
  function allText(result) {
    if (!result) return "";
    const lines = [];
    if (result.title) lines.push(result.title);
    for (const field of result.fields || []) lines.push(`${field.label}: ${field.text}`);
    if (result.prompt) lines.push(`Prompt: ${result.prompt}`);
    return lines.join("\n");
  }

  // ── UI ──

  const CSS = `
    .ds{--bg:#0A0805;--panel:#191919;--ink:#FFF4EA;--ink2:rgba(255,244,234,.62);--ink3:rgba(255,244,234,.4);--line:rgba(255,244,234,.14);--line2:rgba(255,244,234,.3);--coral:#F26157;--chip:#191919;--on:#FFF4EA;--onInk:#0A0805;
      font:500 12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color:var(--ink);display:flex;flex-direction:column;gap:9px}
    .ds--light{--bg:#FFF4EA;--panel:#fff;--ink:#191919;--ink2:rgba(25,25,25,.66);--ink3:rgba(25,25,25,.42);--line:rgba(25,25,25,.12);--line2:rgba(25,25,25,.28);--chip:#fff;--on:#191919;--onInk:#FFF4EA}
    .ds *{box-sizing:border-box;font-family:inherit}
    .ds-src{display:flex;gap:10px;align-items:flex-start}
    .ds-thumb{flex:0 0 auto;width:72px;height:72px;border-radius:8px;object-fit:cover;background:var(--panel);border:1px solid var(--line)}
    .ds-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
    .ds-kicker{font:700 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
    .ds-title{font:800 12.5px/1.25 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}
    .ds-mj{border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    .ds-mj summary{cursor:pointer;list-style:none;padding:6px 9px;font:600 10.5px/1.2 "JetBrains Mono",ui-monospace,monospace;color:var(--ink2)}
    .ds-mj summary::-webkit-details-marker{display:none}
    .ds-mj ol{margin:0;padding:0 10px 8px 26px;display:flex;flex-direction:column;gap:5px;color:var(--ink2);font-size:11px;line-height:1.45}
    .ds-label{font:700 9.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-top:2px}
    .ds-row{display:flex;gap:6px;align-items:center}
    .ds-select{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--line);background:var(--chip);color:var(--ink);font:600 11.5px/1 Inter,system-ui,sans-serif}
    .ds-note{width:100%;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--line);background:var(--chip);color:var(--ink);font:500 12px/1 Inter,system-ui,sans-serif;outline:none}
    .ds-note:focus,.ds-select:focus{border-color:var(--coral);outline:none}
    .ds-note::placeholder{color:var(--ink3)}
    .ds-go{height:34px;border:0;border-radius:8px;background:var(--coral);color:#0A0805;font:800 11.5px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
    .ds-go:disabled{opacity:.5;cursor:default}
    .ds-line{min-height:14px;font:600 10px/1.35 "JetBrains Mono",ui-monospace,monospace;color:var(--ink3);display:flex;align-items:center;gap:7px}
    .ds-line .err{color:var(--coral)}
    .ds-spin{width:10px;height:10px;border:1.5px solid var(--line2);border-top-color:var(--coral);border-radius:50%;animation:ds-s .7s linear infinite;flex:0 0 auto}
    @keyframes ds-s{to{transform:rotate(360deg)}}
    .ds-results{display:grid;gap:8px}
    .ds-card{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:8px;display:flex;flex-direction:column;gap:6px}
    .ds-card-head{display:flex;align-items:center;gap:6px}
    .ds-card-head b{flex:1;font:800 10.5px/1.2 Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--ink)}
    .ds-small{height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--line2);background:transparent;color:var(--ink);font:700 9.5px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;flex:0 0 auto}
    .ds-small.done{border-color:var(--coral);color:var(--coral)}
    .ds-small.ds-offer{height:20px;border-color:var(--coral);color:var(--coral);font:700 8.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.09em}
    .ds-small.ds-offer:hover{background:var(--coral);color:#0A0805}
    .ds-fields{display:flex;flex-direction:column}
    .ds-field{display:grid;grid-template-columns:86px 1fr auto;gap:8px;align-items:start;padding:6px 2px;border-top:1px solid var(--line)}
    .ds-field:first-child{border-top:0}
    .ds-field span{font:700 9px/1.6 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
    .ds-field p{margin:0;font:500 11.5px/1.45 Inter,system-ui,sans-serif;color:var(--ink)}
    .ds-field button{height:20px;padding:0 6px;border-radius:5px;border:1px solid transparent;background:transparent;color:var(--ink3);font:700 8.5px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
    .ds-field:hover button{border-color:var(--line2);color:var(--ink)}
    .ds-field button.done{color:var(--coral)}
    .ds-text{width:100%;min-height:118px;resize:vertical;padding:8px 9px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:400 11.5px/1.5 "JetBrains Mono",ui-monospace,monospace;outline:none}
    .ds-text:focus{border-color:var(--coral)}
    .ds-acts{display:flex;flex-wrap:wrap;gap:5px}
    .ds-acts button{height:26px;padding:0 9px;border-radius:6px;border:1px solid var(--line2);background:transparent;color:var(--ink);font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
    .ds-acts button.primary{background:var(--on);color:var(--onInk);border-color:var(--on)}
    .ds-acts button:disabled{opacity:.45;cursor:default}
    .ds-acts button.done{border-color:var(--coral);color:var(--coral)}
  `;

  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const stopKeys = (node) => { for (const type of ["keydown", "keyup", "keypress"]) node.addEventListener(type, (event) => event.stopPropagation()); };
  async function copyText(text, button, label = "Copied ✓") {
    try {
      await navigator.clipboard.writeText(text);
      const was = button.textContent;
      button.classList.add("done");
      button.textContent = label;
      setTimeout(() => { button.classList.remove("done"); button.textContent = was; }, 1400);
      return true;
    } catch { return false; }
  }

  /**
   * Mount the describer in `root` (a shadow root or a panel element).
   * opts: { theme: "dark"|"light", putInBar?: (text) => Promise<{ok,error?}>, barLabel?: string }
   * Returns { load(source) } — source: { imageUrl?, dataUrl?, pageUrl?, descriptions?, aspect?, width?, height? }.
   */
  function mount(root, opts = {}) {
    if (!root.querySelector?.("style[data-ds]")) {
      const style = document.createElement("style");
      style.dataset.ds = "1";
      style.textContent = CSS;
      root.appendChild(style);
    }
    const wrap = el("div", `ds${opts.theme === "light" ? " ds--light" : ""}`);
    root.appendChild(wrap);

    const state = { source: null, prepared: null, worlds: [], worldKey: "", busy: false, result: null };

    const src = el("div", "ds-src");
    const thumb = el("img", "ds-thumb");
    thumb.alt = "";
    const meta = el("div", "ds-meta");
    const kicker = el("div", "ds-kicker", "Picture");
    const titleEl = el("div", "ds-title", "");
    meta.append(kicker, titleEl);
    src.append(thumb, meta);
    const mj = el("details", "ds-mj");
    const worldLabel = el("div", "ds-label", "World · its words, its queue thread, where Save files it");
    const worldRow = el("div", "ds-row");
    const worldSelect = el("select", "ds-select");
    worldRow.append(worldSelect);
    // The writer: This Mac, Cloud · fal or Cloud · Pika, and the model (writer-choice.js),
    // one pick for every tool. DeepSeek is left out: the describer sends a picture.
    const writerLabel = el("div", "ds-label", "Writer · where it runs and on which model");
    const writerRow = el("div", "ds-row");
    const writerSelect = el("select", "ds-select");
    writerSelect.setAttribute("aria-label", "Writer");
    writerRow.append(writerSelect);
    const note = el("input", "ds-note");
    note.type = "text";
    note.placeholder = "Anything to change in the prompt? (optional)";
    note.spellcheck = false;
    const go = el("button", "ds-go", "Describe");
    go.type = "button";
    const line = el("div", "ds-line");
    const results = el("div", "ds-results");
    wrap.append(src, mj, worldLabel, worldRow, writerLabel, writerRow, note, go, line, results);

    const setLine = (html, kind = "") => { line.innerHTML = kind === "err" ? `<span class="err">${html}</span>` : html; };

    function paintSource() {
      const source = state.source;
      src.hidden = !source;
      if (!source) return;
      thumb.src = source.dataUrl || source.imageUrl || "";
      kicker.textContent = source.descriptions?.length ? "Midjourney described this" : "Picture";
      titleEl.textContent = state.result?.title || (source.pageUrl ? hostOf(source.pageUrl) : "Ready to describe");
      mj.hidden = !source.descriptions?.length;
      if (source.descriptions?.length) {
        mj.innerHTML = `<summary>How Midjourney reads it · ${source.descriptions.length} ▾</summary><ol>${source.descriptions.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>`;
      }
    }

    function paint() {
      go.disabled = !state.source || state.busy;
      go.textContent = state.busy ? "Describing…" : state.result ? "Describe again" : "Describe";
    }

    function paintWorlds() {
      worldSelect.replaceChildren(...state.worlds.map((world) => {
        const option = el("option", "", world.name);
        option.value = world.key;
        option.selected = world.key === state.worldKey;
        return option;
      }));
    }

    const choice = () => globalScope.SaveToGalleryWriterChoice;
    const askWriter = (message = {}) => new Promise((resolve) => {
      if (!alive()) { resolve(null); return; }
      try { chrome.runtime.sendMessage({ action: "writer", ...message }, (res) => resolve(chrome.runtime.lastError ? null : res)); } catch { resolve(null); }
    });
    function paintWriter(status) {
      if (!choice() || !status) return;
      choice().fill(writerSelect, status, { vision: true });
      writerSelect.title = status.mode === "local" && status.up === false
        ? "The writer on this Mac is not running: pick Cloud · fal or Cloud · Pika, or start the bridge (extension-writer/install.sh)."
        : `${choice().label(status.mode, status.model)}. The pick is the default for Grow, Describe and the quick edit.`;
    }
    async function setWriter(pick) {
      const res = await askWriter({ do: "set", mode: pick.mode, model: pick.model, fresh: true });
      if (res?.ok) paintWriter(res);
      return res;
    }
    writerSelect.addEventListener("change", () => { void setWriter(choice().parse(writerSelect.value)); });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && (changes.writerMode || changes.writerModel)) void askWriter().then(paintWriter);
      });
    } catch { /* extension reloaded */ }
    void askWriter().then(paintWriter);

    worldSelect.addEventListener("change", () => {
      state.worldKey = worldSelect.value;
      setLocal({ [STORE.world]: state.worldKey });
    });
    stopKeys(note);
    note.addEventListener("keydown", (event) => { if (event.key === "Enter" && !go.disabled) void run(); });
    go.addEventListener("click", () => void run());

    async function init() {
      const stored = await local([STORE.world]);
      state.worldKey = stored[STORE.world] || "dear-annete";
      paint();
      const res = await ask("worlds");
      state.worlds = res?.ok ? res.worlds || [] : [];
      if (!state.worlds.some((w) => w.key === state.worldKey) && state.worlds[0]) state.worldKey = state.worlds[0].key;
      paintWorlds();
      if (!res?.ok) setLine(esc(res?.error || "Could not reach the gallery."), "err");
    }

    async function prepare() {
      const source = state.source;
      if (!source) return null;
      if (state.prepared) return state.prepared;
      const res = await ask("prepare", { imageUrl: source.imageUrl, dataUrl: source.dataUrl });
      if (!res?.ok) throw new Error(res?.error || "Could not read the picture.");
      state.prepared = res;
      return res;
    }

    async function run() {
      if (state.busy || !state.source) return;
      state.busy = true;
      state.result = null;
      results.replaceChildren();
      paint();
      setLine(`<span class="ds-spin"></span><span>Reading the picture…</span>`);
      try {
        const image = await prepare();
        setLine(`<span class="ds-spin"></span><span>Looking at the shot, the lens and the light…</span>`);
        const source = state.source;
        const res = await ask("run", {
          image: image.dataUrl,
          descriptions: source.descriptions || [],
          aspect: Array.isArray(source.aspect) ? source.aspect.join(":") : source.aspect || undefined,
          width: image.width, height: image.height,
          system: await systemPromptFor(state.worldKey),
          note: note.value.trim() || undefined,
        });
        if (!res?.ok) throw Object.assign(new Error(res?.error || "Could not describe."), { offer: res?.offer });
        if (!Array.isArray(res.fields)) throw new Error("The gallery answered in the old form. Reload the extension once the gallery is updated.");
        state.result = { title: res.title || "", fields: res.fields, prompt: res.prompt || "", words: res.words || "", params: res.params || "" };
        paintSource();
        renderResults();
        setLine(`<span>${esc(res.model)} · ${(res.ms / 1000).toFixed(1)}s${source.descriptions?.length ? " · with Midjourney's describe" : ""}${res.notes?.length ? ` · ${esc(res.notes[0])}` : ""}</span>`);
      } catch (err) {
        setLine(esc(err?.message || err), "err");
        // The chosen writer failed: offer the other place as one click. It never switches by itself.
        if (err?.offer) {
          const offer = el("button", "ds-small ds-offer", err.offer.label);
          offer.type = "button";
          offer.title = "Switch the writer there (the default for every tool) and describe again";
          offer.addEventListener("click", async () => {
            const res = await setWriter(err.offer);
            if (res?.ok) void run();
          });
          line.append(offer);
        }
      } finally {
        state.busy = false;
        paint();
      }
    }

    const worldOf = () => state.worlds.find((w) => w.key === state.worldKey);

    function renderResults() {
      const result = state.result;
      if (!result) { results.replaceChildren(); return; }
      // The description, one labelled line each.
      const lines = el("div", "ds-card");
      const head = el("div", "ds-card-head");
      head.append(el("b", "", "The shot"));
      const copyAll = el("button", "ds-small", "Copy all");
      copyAll.type = "button";
      copyAll.addEventListener("click", () => void copyText(allText({ ...result, prompt: promptText.value.trim() || result.prompt }), copyAll));
      head.append(copyAll);
      const fields = el("div", "ds-fields");
      for (const field of result.fields) {
        const row = el("div", "ds-field");
        const copy = el("button", "", "Copy");
        copy.type = "button";
        copy.title = `Copy the ${field.label.toLowerCase()} line`;
        copy.addEventListener("click", () => void copyText(field.text, copy, "✓"));
        row.append(el("span", "", field.label), el("p", "", field.text), copy);
        fields.appendChild(row);
      }
      lines.append(head, fields);

      // The prompt built from it.
      const card = el("div", "ds-card");
      const promptHead = el("div", "ds-card-head");
      promptHead.append(el("b", "", "Midjourney V8.2 prompt"));
      const promptText = el("textarea", "ds-text");
      promptText.value = result.prompt;
      promptText.spellcheck = false;
      stopKeys(promptText);
      const acts = el("div", "ds-acts");
      const act = (label, fn, primary) => {
        const button = el("button", primary ? "primary" : "", label);
        button.type = "button";
        button.addEventListener("click", async () => {
          button.disabled = true;
          const done = await fn(promptText.value.trim()).catch((err) => ({ ok: false, error: String(err?.message || err) }));
          button.disabled = false;
          if (done?.ok) { button.classList.add("done"); button.textContent = done.label || `${label} ✓`; }
          else setLine(esc(done?.error || "Did not work."), "err");
        });
        acts.appendChild(button);
      };
      if (opts.putInBar) act(opts.barLabel || "Put in bar", (value) => opts.putInBar(value), true);
      act("Queue", (value) => queue(value));
      act("Copy", async (value) => { await navigator.clipboard.writeText(value); return { ok: true, label: "Copied ✓" }; });
      act("Save to gallery", (value) => save(value));
      card.append(promptHead, promptText, acts);
      results.replaceChildren(lines, card);
    }

    // The queue item keeps words and params apart, as agents queue them.
    async function queue(value) {
      const source = state.source;
      const world = worldOf();
      const result = state.result;
      const edited = value !== result.prompt;
      const words = edited ? value.replace(/\s--[a-z][\s\S]*$/i, "").trim() : result.words;
      const tail = edited ? (value.match(/\s(--[a-z][\s\S]*)$/i)?.[1] || "") : result.params;
      const res = await ask("queue", {
        world: state.worldKey,
        batch: `${world?.name || "Gallery"} · Described`,
        item: {
          title: result.title || undefined,
          prompt: words,
          params: tail || undefined,
          note: `Described: ${result.fields.filter((field) => ["shot", "lens", "light"].includes(field.key)).map((field) => field.text).join(" ")}`.slice(0, 900),
          describe: {
            sourceUrl: /^https:/.test(source.imageUrl || "") ? source.imageUrl : undefined,
            pageUrl: source.pageUrl || undefined,
            descriptions: source.descriptions || [],
            mode: "keep",
          },
        },
      });
      return res?.ok ? { ok: true, label: "Queued ✓" } : res;
    }

    async function save(value) {
      const source = state.source;
      const world = worldOf();
      if (!world?.worldId) return { ok: false, error: "Pick a world first." };
      const lines = source.descriptions?.length ? `\nHow Midjourney reads it:\n${source.descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}` : "";
      const res = await ask("save", {
        imageUrl: source.imageUrl, dataUrl: source.dataUrl, pageUrl: source.pageUrl,
        folderId: world.worldId,
        promptText: value,
        agentDescription: `${allText({ ...state.result, prompt: "" })}\nInspiration described into a prompt.${lines}`.slice(0, 4000),
      });
      return res?.ok ? { ok: true, label: `In ${world.name.split(/\s[—·-]\s/)[0]} ✓` } : res;
    }

    void init();

    return {
      async load(source) {
        if (!source) return;
        const known = source.descriptions?.length ? null : await describesFor(source.imageUrl);
        state.source = { ...source, descriptions: source.descriptions?.length ? source.descriptions : known?.descriptions || [], aspect: source.aspect || known?.aspect || null };
        state.prepared = null;
        state.result = null;
        results.replaceChildren();
        setLine("");
        paintSource();
        paint();
      },
      describe: () => run(),
      hasSource: () => Boolean(state.source),
      focus() { note.focus(); },
    };
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

  globalScope.SaveToGalleryDescribe = { mount, rememberDescribe, recentDescribes, describesFor, allText, STORE };
})(typeof globalThis !== "undefined" ? globalThis : self);
