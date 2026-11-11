// The describer: a picture into one of our Midjourney prompts, by the quick
// edit's agent (the gallery's /api/extension/prompt-describe: same providers,
// the world's system prompt from the MJ settings tab, plus the picture).
// One UI, mounted twice: the "Make it ours" card on midjourney.com after a
// Describe (mj-describe.js, dark) and the side panel's Describe tab
// (describe-panel.js, light).
//
// Style lock: the person decides where the prompt's style words come from.
//   Keep its look  the image's own style, described, so it recreates it
//   Our style      the image's style words dropped, a gallery world style on
//   Both           side by side
// Results go in the Imagine bar, to the MJ Queue or the clipboard; each keeps
// the source picture and Midjourney's descriptions. Saving the pair to the
// gallery as inspiration happens only on a click. Nothing is ever sent to
// Midjourney: every job stays Michael's own click.

(function registerDescribeCore(globalScope) {
  if (globalScope.SaveToGalleryDescribe) return;

  const STORE = {
    world: "stgMoodboardWorld", // shared with the dock
    mode: "describeMode",
    style: "describeStyles", // { [worldKey]: styleId }
    recent: "mjDescribes", // last Midjourney describes the extension caught
    qeWorld: "quickEditWorld",
    qePrompts: "quickEditPrompts",
  };
  const RECENT_MAX = 24;
  const MODES = [
    { key: "keep", label: "Keep its look", hint: "The image's own style, described: the prompt recreates it." },
    { key: "ours", label: "Our style", hint: "The image's style words out, a world style from the gallery in." },
    { key: "both", label: "Both", hint: "The two prompts side by side." },
  ];

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

  // The quick edit's world prompts cover Dear Annete and Andromeda worlds.
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
    .ds-seg{display:flex;gap:3px;padding:3px;border:1px solid var(--line);border-radius:9px;background:var(--panel)}
    .ds-seg button{flex:1;height:26px;border:0;border-radius:6px;background:transparent;color:var(--ink3);font:700 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
    .ds-seg button[aria-pressed="true"]{background:var(--on);color:var(--onInk)}
    .ds-row{display:flex;gap:6px;align-items:center}
    .ds-select{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--line);background:var(--chip);color:var(--ink);font:600 11.5px/1 Inter,system-ui,sans-serif}
    .ds-styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;max-height:228px;overflow:auto;padding:1px}
    .ds--light .ds-styles{max-height:none;overflow:visible}
    .ds-style{position:relative;display:flex;flex-direction:column;gap:0;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden;cursor:pointer;text-align:left;color:var(--ink)}
    .ds-style img,.ds-style i{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--line)}
    .ds-style span{display:block;padding:5px 6px 6px;font:700 10px/1.2 Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ds-style em{position:absolute;top:4px;left:4px;padding:2px 5px;border-radius:4px;background:rgba(10,8,5,.78);color:#FFF4EA;font:600 8.5px/1 "JetBrains Mono",ui-monospace,monospace;font-style:normal;letter-spacing:.04em}
    .ds-style[aria-pressed="true"]{border-color:var(--coral);box-shadow:0 0 0 2px rgba(242,97,87,.35)}
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
    .ds-results.two{grid-template-columns:1fr}
    .ds-card{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:8px;display:flex;flex-direction:column;gap:6px}
    .ds-card-head{display:flex;align-items:center;gap:6px}
    .ds-tag{padding:3px 6px;border-radius:5px;background:var(--on);color:var(--onInk);font:700 9px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .ds-tag.ours{background:var(--coral);color:#0A0805}
    .ds-card-head b{font:700 10.5px/1.2 Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.03em;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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

    const state = {
      source: null, prepared: null, worlds: [], worldKey: "", styles: [], styleId: "", stylesFor: "",
      mode: "both", note: "", busy: false, results: [], title: "",
    };

    const src = el("div", "ds-src");
    const thumb = el("img", "ds-thumb");
    thumb.alt = "";
    const meta = el("div", "ds-meta");
    const kicker = el("div", "ds-kicker", "Picture");
    const titleEl = el("div", "ds-title", "");
    meta.append(kicker, titleEl);
    src.append(thumb, meta);
    const mj = el("details", "ds-mj");
    const modeLabel = el("div", "ds-label", "Style words come from");
    const seg = el("div", "ds-seg");
    seg.setAttribute("role", "group");
    const worldLabel = el("div", "ds-label", "World");
    const worldRow = el("div", "ds-row");
    const worldSelect = el("select", "ds-select");
    worldRow.append(worldSelect);
    const styleLabel = el("div", "ds-label", "Our style");
    const styleGrid = el("div", "ds-styles");
    const note = el("input", "ds-note");
    note.type = "text";
    note.placeholder = "Anything to change? (optional)";
    note.spellcheck = false;
    const go = el("button", "ds-go", "Make it ours");
    go.type = "button";
    const line = el("div", "ds-line");
    const results = el("div", "ds-results");
    wrap.append(src, mj, modeLabel, seg, worldLabel, worldRow, styleLabel, styleGrid, note, go, line, results);

    for (const mode of MODES) {
      const button = el("button", "", mode.label);
      button.type = "button";
      button.title = mode.hint;
      button.dataset.mode = mode.key;
      button.addEventListener("click", () => { state.mode = mode.key; setLocal({ [STORE.mode]: mode.key }); paint(); });
      seg.appendChild(button);
    }

    const setLine = (html, kind = "") => { line.innerHTML = kind === "err" ? `<span class="err">${html}</span>` : html; };

    function paintSource() {
      const source = state.source;
      src.hidden = !source;
      if (!source) return;
      thumb.src = source.dataUrl || source.imageUrl || "";
      kicker.textContent = source.descriptions?.length ? "Midjourney described this" : "Picture";
      titleEl.textContent = state.title || (source.pageUrl ? hostOf(source.pageUrl) : "Ready to describe");
      mj.hidden = !source.descriptions?.length;
      if (source.descriptions?.length) {
        mj.innerHTML = `<summary>How Midjourney reads it · ${source.descriptions.length} ▾</summary><ol>${source.descriptions.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>`;
      }
    }

    function paint() {
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
      const wantStyle = state.mode !== "keep";
      styleLabel.hidden = !wantStyle;
      styleGrid.hidden = !wantStyle;
      const ready = Boolean(state.source) && !state.busy && (!wantStyle || state.styleId);
      go.disabled = !ready;
      go.textContent = state.busy ? "Writing…" : state.mode === "keep" ? "Write the prompt" : "Make it ours";
    }

    function paintWorlds() {
      worldSelect.replaceChildren(...state.worlds.map((world) => {
        const option = el("option", "", world.name);
        option.value = world.key;
        option.selected = world.key === state.worldKey;
        return option;
      }));
    }

    function paintStyles() {
      if (!state.styles.length) {
        styleGrid.innerHTML = `<div class="ds-line">${state.stylesFor === state.worldKey ? "This world has no styles in the gallery yet." : '<span class="ds-spin"></span>Loading styles…'}</div>`;
        return;
      }
      styleGrid.replaceChildren(...state.styles.map((style) => {
        const button = el("button", "ds-style");
        button.type = "button";
        button.title = [style.name, style.line, style.recipe ? `Recipe: ${style.recipe}` : "", style.hasLock ? "Has a style lock" : ""].filter(Boolean).join("\n");
        button.setAttribute("aria-pressed", String(style.id === state.styleId));
        if (style.thumbUrl) { const img = el("img"); img.src = style.thumbUrl; img.alt = ""; img.loading = "lazy"; button.appendChild(img); } else button.appendChild(el("i"));
        // Styles from a sister world of the universe (3D, ART DECO …) say which.
        if (style.worldShort && style.world !== state.worldKey) button.appendChild(el("em", "", style.worldShort));
        button.appendChild(el("span", "", style.name));
        button.addEventListener("click", () => {
          state.styleId = style.id;
          void local([STORE.style]).then((stored) => setLocal({ [STORE.style]: { ...(stored[STORE.style] || {}), [state.worldKey]: style.id } }));
          paintStyles();
          paint();
        });
        return button;
      }));
    }

    async function loadStyles() {
      const worldKey = state.worldKey;
      state.styles = [];
      state.stylesFor = "";
      paintStyles();
      const [res, stored] = await Promise.all([ask("styles", { world: worldKey }), local([STORE.style])]);
      if (worldKey !== state.worldKey) return;
      state.stylesFor = worldKey;
      state.styles = res?.ok ? res.styles || [] : [];
      if (!res?.ok) styleGrid.innerHTML = `<div class="ds-line"><span class="err">${esc(res?.error || "Could not load styles.")}</span></div>`;
      const remembered = stored[STORE.style]?.[worldKey];
      state.styleId = state.styles.some((s) => s.id === remembered) ? remembered : state.styles[0]?.id || "";
      if (res?.ok) paintStyles();
      paint();
    }

    worldSelect.addEventListener("change", () => {
      state.worldKey = worldSelect.value;
      setLocal({ [STORE.world]: state.worldKey });
      void loadStyles();
    });
    note.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !go.disabled) void run();
    });
    note.addEventListener("keyup", (event) => event.stopPropagation());
    note.addEventListener("keypress", (event) => event.stopPropagation());
    go.addEventListener("click", () => void run());

    async function init() {
      const stored = await local([STORE.world, STORE.mode]);
      state.mode = MODES.some((m) => m.key === stored[STORE.mode]) ? stored[STORE.mode] : "both";
      state.worldKey = stored[STORE.world] || "dear-annete";
      paint();
      const res = await ask("worlds");
      state.worlds = res?.ok ? res.worlds || [] : [];
      if (!state.worlds.some((w) => w.key === state.worldKey) && state.worlds[0]) state.worldKey = state.worlds[0].key;
      paintWorlds();
      if (!res?.ok) setLine(esc(res?.error || "Could not reach the gallery."), "err");
      await loadStyles();
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
      state.results = [];
      results.replaceChildren();
      paint();
      setLine(`<span class="ds-spin"></span><span>Reading the picture…</span>`);
      try {
        const image = await prepare();
        setLine(`<span class="ds-spin"></span><span>Haiku is writing${state.mode === "both" ? " both prompts" : " the prompt"}…</span>`);
        const source = state.source;
        const res = await ask("run", {
          image: image.dataUrl,
          descriptions: source.descriptions || [],
          aspect: Array.isArray(source.aspect) ? source.aspect.join(":") : source.aspect || undefined,
          width: image.width, height: image.height,
          mode: state.mode,
          style: state.mode === "keep" ? undefined : state.styleId,
          system: await systemPromptFor(state.worldKey),
          note: note.value.trim() || undefined,
        });
        if (!res?.ok) throw new Error(res?.error || "Could not describe.");
        state.title = res.title || "";
        paintSource();
        const styleName = state.styles.find((s) => s.id === state.styleId)?.name;
        const made = [];
        if (res.keep) made.push({ kind: "keep", label: "Keeps its look", ...res.keep });
        if (res.ours) made.push({ kind: "ours", label: `In ${res.ours.style || styleName || "our style"}`, ...res.ours });
        state.results = made;
        renderResults();
        setLine(`<span>${esc(res.model)} · ${(res.ms / 1000).toFixed(1)}s${source.descriptions?.length ? " · with Midjourney's describe" : ""}${res.world ? ` · ${esc(String(res.world).toUpperCase())}${res.read?.length ? `: ${esc(res.read.join(", "))}` : ""}` : ""}${res.notes?.length ? ` · ${esc(res.notes[0])}` : ""}</span>`);
      } catch (err) {
        setLine(esc(err?.message || err), "err");
      } finally {
        state.busy = false;
        paint();
      }
    }

    const worldOf = () => state.worlds.find((w) => w.key === state.worldKey);

    function renderResults() {
      results.replaceChildren(...state.results.map((result) => {
        const card = el("div", "ds-card");
        const head = el("div", "ds-card-head");
        head.append(el("span", `ds-tag${result.kind === "ours" ? " ours" : ""}`, result.kind === "ours" ? "Our style" : "Its look"), el("b", "", result.label));
        const text = el("textarea", "ds-text");
        text.value = result.prompt;
        text.spellcheck = false;
        text.addEventListener("keydown", (event) => event.stopPropagation());
        text.addEventListener("keyup", (event) => event.stopPropagation());
        text.addEventListener("keypress", (event) => event.stopPropagation());
        const acts = el("div", "ds-acts");
        const act = (label, fn, primary) => {
          const button = el("button", primary ? "primary" : "", label);
          button.type = "button";
          button.addEventListener("click", async () => {
            button.disabled = true;
            const done = await fn(text.value.trim(), result).catch((err) => ({ ok: false, error: String(err?.message || err) }));
            button.disabled = false;
            if (done?.ok) { button.classList.add("done"); button.textContent = done.label || `${label} ✓`; }
            else setLine(esc(done?.error || "Did not work."), "err");
          });
          acts.appendChild(button);
          return button;
        };
        if (opts.putInBar) act(opts.barLabel || "Put in bar", (value) => opts.putInBar(value), true);
        act("Queue", (value, made) => queue(value, made));
        act("Copy", async (value) => { await navigator.clipboard.writeText(value); return { ok: true, label: "Copied ✓" }; });
        act("Save to gallery", (value, made) => save(value, made));
        card.append(head, text, acts);
        return card;
      }));
    }

    // The queue item keeps words, codes and params apart, as agents queue them.
    async function queue(value, made) {
      const source = state.source;
      const world = worldOf();
      const edited = value !== made.prompt;
      const words = edited ? value.replace(/\s--[a-z][\s\S]*$/i, "").trim() : made.words;
      const tail = edited ? (value.match(/\s(--[a-z][\s\S]*)$/i)?.[1] || "") : "";
      const res = await ask("queue", {
        world: state.worldKey,
        batch: `${world?.name || "Gallery"} · Described`,
        item: {
          title: state.title || undefined,
          prompt: words,
          ...(edited
            ? { params: tail }
            : { params: made.rest || undefined, profileCodes: made.profiles, styleRefs: made.srefs.map((code) => ({ code })) }),
          note: made.kind === "ours" ? `Described, in ${made.style}.` : "Described, keeps the picture's look.",
          describe: {
            sourceUrl: /^https:/.test(source.imageUrl || "") ? source.imageUrl : undefined,
            pageUrl: source.pageUrl || undefined,
            descriptions: source.descriptions || [],
            mode: made.kind,
          },
        },
      });
      return res?.ok ? { ok: true, label: "Queued ✓" } : res;
    }

    async function save(value, made) {
      const source = state.source;
      const world = worldOf();
      if (!world?.worldId) return { ok: false, error: "Pick a world first." };
      const lines = source.descriptions?.length ? `\nHow Midjourney reads it:\n${source.descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}` : "";
      const res = await ask("save", {
        imageUrl: source.imageUrl, dataUrl: source.dataUrl, pageUrl: source.pageUrl,
        folderId: world.worldId,
        promptText: value,
        agentDescription: `${state.title ? `${state.title}. ` : ""}Inspiration described into a prompt (${made.kind === "ours" ? `in ${made.style}` : "keeps its own look"}).${lines}`.slice(0, 4000),
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
        state.title = "";
        state.results = [];
        results.replaceChildren();
        setLine("");
        paintSource();
        paint();
      },
      focus() { note.focus(); },
    };
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

  globalScope.SaveToGalleryDescribe = { mount, rememberDescribe, recentDescribes, describesFor, STORE };
})(typeof globalThis !== "undefined" ? globalThis : self);
