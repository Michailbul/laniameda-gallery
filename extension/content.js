// Save to Gallery — Universal content script
// Attaches a hover badge on images that are large enough both intrinsically and on screen.
// Includes Midjourney-specific prompt extraction when on midjourney.com.

(() => {
  "use strict";

  const BADGE_ATTR = "data-stg-badge";
  const DISABLED_HOSTS_KEY = "disabledHosts";
  const DEFAULT_FOLDER_ID_KEY = "defaultFolderId";
  const LAST_FOLDER_ID_KEY = "lastFolderId";
  // Hosts where the extension should NEVER run (our own app — packs/assets
  // aren't saveable via the extension overlay).
  const BUILTIN_DISABLED_HOSTS = [
    "laniameda.gallery",
    "laniameda-galery.vercel.app",
    "localhost",
    "127.0.0.1",
  ];
  const SAVE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const CHEVRON_ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 7.5 5 5 5-5"/></svg>`;
  const imageQualification = globalThis.SaveToGalleryImageQualification;
  const midjourneyAdapter = globalThis.SaveToGalleryMidjourney;
  const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");

  let extensionEnabled = false;
  let configLoaded = false;
  let foldersCache = null;
  let foldersPromise = null;
  let contextToast = null;
  let contextToastTimer = null;

  // ── Midjourney adapter ──

  // The card root has `@container/jobCard group/jobCard` — match the @container token
  // to avoid picking up descendant divs whose class names reference `jobCard` modifiers.
  const MJ_GRID_CARD_SELECTOR = 'div[class*="@container/jobCard"]';
  const MJ_GRID_THUMB_SELECTOR = 'a[href*="/jobs/"]';
  const MJ_GRID_BADGE_ATTR = "data-stg-mj-badge";
  const MJ_MEDIA_BADGE_ATTR = "data-stg-mj-media-badge";
  const MJ_MEDIA_SELECTOR = [
    'img[src*="cdn.midjourney.com"]',
    'img[srcset*="cdn.midjourney.com"]',
    'img[src*="mj.run"]',
    'img[srcset*="mj.run"]',
    'video[poster*="cdn.midjourney.com"]',
    'video[src*="cdn.midjourney.com"]',
    'a[href*="/jobs/"]',
    '[style*="cdn.midjourney.com"]',
    '[style*="mj.run"]',
  ].join(",");

  function isMidjourneyPage() {
    return location.hostname.includes("midjourney.com");
  }

  function extractMidjourneyContext() {
    // Only works when lightbox/detail view is open
    const promptContainer = document.querySelector("#lightboxPrompt");
    if (!promptContainer) return null;

    // Extract prompt text from the .notranslate container
    const notranslate = promptContainer.querySelector(".notranslate");
    const promptText = notranslate ? notranslate.textContent.trim() : "";

    // Extract parameters (--ar, --s, --v, etc.) from parameter buttons
    const paramButtons = promptContainer.querySelectorAll("button[title]");
    const params = [];
    for (const btn of paramButtons) {
      // Hidden spans contain the full param string like "--ar 2:3"
      const hiddenSpan = btn.querySelector("span.text-transparent");
      if (hiddenSpan) {
        const paramText = hiddenSpan.textContent.trim();
        if (paramText.startsWith("--")) params.push(paramText);
      }
    }

    // Combine prompt + params into full prompt string
    const fullPrompt = params.length > 0
      ? `${promptText} ${params.join(" ")}`.trim()
      : promptText;

    // Extract image URL from lightbox video poster or img
    const lightboxVideo = document.querySelector("video[id^='lightbox-video-']");
    let imageUrl = "";
    if (lightboxVideo) {
      imageUrl = lightboxVideo.poster || lightboxVideo.src || "";
    }

    return {
      promptText: fullPrompt || null,
      imageUrl: imageUrl || null,
      modelName: "Midjourney",
    };
  }

  // ── Midjourney /explore grid adapter ──
  // The explore feed renders no <img> elements — each thumbnail is an
  // <a href="/jobs/{id}?index={N}"> with `style="background-image: image-set(...)"`.
  // The prompt lives on the React fiber of the card root as `memoizedProps.job`.

  function isMidjourneyGridThumb(el) {
    if (!el || !isMidjourneyPage()) return false;
    if (!el.matches || !el.matches(MJ_GRID_THUMB_SELECTOR)) return false;
    const bg = el.style && el.style.backgroundImage;
    return Boolean(bg && bg.indexOf("cdn.midjourney.com") !== -1);
  }

  function getMidjourneyCardRoot(thumb) {
    return thumb.closest(MJ_GRID_CARD_SELECTOR) || thumb.parentElement;
  }

  function readMidjourneyJobFromFiber(el) {
    if (midjourneyAdapter?.findJobObject) {
      const job = midjourneyAdapter.findJobObject(el);
      if (job) return job;
    }

    if (!el) return null;
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    if (!fiberKey) return null;
    let fiber = el[fiberKey];
    for (let depth = 0; depth < 30 && fiber; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && props.job && props.job.prompt) return props.job;
    }
    return null;
  }

  function reconstructMidjourneyPrompt(job) {
    if (midjourneyAdapter?.reconstructPrompt) {
      const prompt = midjourneyAdapter.reconstructPrompt(job);
      if (prompt) return prompt;
    }

    if (!job || !job.prompt) return null;
    const p = job.prompt;

    let text = "";
    if (Array.isArray(p.decodedPrompt)) {
      text = p.decodedPrompt
        .map((part) => {
          if (!part || typeof part.content !== "string") return "";
          const w = typeof part.weight === "number" && part.weight !== 1
            ? `::${part.weight}`
            : "";
          return part.content + w;
        })
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    const flags = [];
    if (p.ar && p.ar.w && p.ar.h) flags.push(`--ar ${p.ar.w}:${p.ar.h}`);
    if (p.chaos != null) flags.push(`--chaos ${p.chaos}`);
    if (p.weird != null) flags.push(`--weird ${p.weird}`);
    if (p.stylize != null) flags.push(`--stylize ${p.stylize}`);
    if (p.quality != null) flags.push(`--quality ${p.quality}`);
    if (p.seed != null) flags.push(`--seed ${p.seed}`);
    if (p.imageWeight != null) flags.push(`--iw ${p.imageWeight}`);
    if (p.tile) flags.push(`--tile`);
    if (p.draft) flags.push(`--draft`);
    if (p.hd) flags.push(`--hd`);
    if (p.styleRaw) flags.push(`--style raw`);
    if (Array.isArray(p.no) && p.no.length) flags.push(`--no ${p.no.join(", ")}`);
    if (p.version) flags.push(`--v ${p.version}`);

    const out = [text, flags.join(" ")].filter(Boolean).join(" ").trim();
    return out || null;
  }

  function getMidjourneyThumbImageUrl(thumb) {
    if (midjourneyAdapter?.getMediaUrl) {
      const mediaUrl = midjourneyAdapter.getMediaUrl(thumb);
      if (mediaUrl) return mediaUrl;
    }

    const bg = (thumb.style && thumb.style.backgroundImage) || "";
    const urls = Array.from(bg.matchAll(/url\("?([^")]+)"?\)/g)).map((m) => m[1]);
    if (urls.length === 0) return "";
    // image-set lists 1dppx then 2dppx — the last URL is the highest resolution.
    return urls[urls.length - 1];
  }

  // ── Image-to-base64 (for CDNs behind Cloudflare like Midjourney) ──

  async function imageToBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // Strip the data:...;base64, prefix
          const dataUrl = reader.result;
          const base64 = dataUrl.split(",")[1];
          const contentType = blob.type || "image/webp";
          resolve({ base64, contentType });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // Capture bytes via the background service worker, which bypasses page CORS
  // through `<all_urls>` host permissions. Used for non-Midjourney sites (Krea,
  // Recraft, etc.) whose CDN images a server-side refetch can't read.
  async function requestImageBytes(url) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "fetchImageBytes",
        imageUrl: url,
      });
      if (response?.ok && response.base64) {
        return { base64: response.base64, contentType: response.contentType };
      }
    } catch (err) {
      console.warn("[Save to Gallery] background image fetch failed:", err);
    }
    return null;
  }

  async function captureImageBytesForSave(url) {
    const captured = await requestImageBytes(url);
    if (captured) return captured;

    const pageFetched = await imageToBase64(url);
    if (pageFetched) return pageFetched;

    return undefined;
  }

  // ── Helpers ──

  function isQualifiedImage(img) {
    if (!imageQualification) return false;

    return imageQualification.isQualifiedImageElement(img, {
      badgeAttr: BADGE_ATTR,
      getImageUrl,
    });
  }

  function getImageUrl(img) {
    // Try srcset first (highest resolution)
    if (img.srcset) {
      const parts = img.srcset.split(",").map(s => s.trim().split(/\s+/));
      let best = null;
      let bestW = 0;
      for (const [url, descriptor] of parts) {
        const w = parseInt(descriptor) || 0;
        if (w > bestW) { bestW = w; best = url; }
      }
      if (best) return best;
    }
    return img.src || img.currentSrc || "";
  }

  function resolveAbsoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  }

  function normalizeDisabledHosts(rawHosts) {
    if (!Array.isArray(rawHosts)) return [];
    return rawHosts
      .map((host) => String(host).trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean);
  }

  function isHostDisabled(disabledHosts, host) {
    return disabledHosts.some((disabledHost) =>
      host === disabledHost || host.endsWith(`.${disabledHost}`),
    );
  }

  function bindExtensionUiEventShield(root) {
    const stop = (event) => {
      event.stopPropagation();
    };
    for (const eventName of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
      "touchstart",
      "touchend",
      "keydown",
      "keyup",
    ]) {
      root.addEventListener(eventName, stop);
    }
  }

  async function readSavedFolderIds() {
    try {
      const cfg = await chrome.storage.sync.get([
        DEFAULT_FOLDER_ID_KEY,
        LAST_FOLDER_ID_KEY,
      ]);
      return {
        defaultFolderId: String(cfg[DEFAULT_FOLDER_ID_KEY] || "").trim(),
        lastFolderId: String(cfg[LAST_FOLDER_ID_KEY] || "").trim(),
      };
    } catch {
      return { defaultFolderId: "", lastFolderId: "" };
    }
  }

  async function getDefaultSaveFolderId() {
    const { defaultFolderId, lastFolderId } = await readSavedFolderIds();
    return defaultFolderId || lastFolderId || undefined;
  }

  async function ensureSiteStateLoaded() {
    if (configLoaded) return extensionEnabled;

    return new Promise((resolve) => {
      syncSiteStateFromStorage((isEnabled) => {
        resolve(Boolean(isEnabled));
      });
    });
  }

  // ── Badge creation ──

  function createBadge(img) {
    const badge = document.createElement("div");
    badge.className = "stg-badge";
    badge.innerHTML = `${SAVE_ICON}<span>Save</span>`;

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleSave(img, badge);
    }, true);
    bindExtensionUiEventShield(badge);

    return badge;
  }

  // ── Popover creation ──

  // Collections are owner-scoped `folders` records. Return [{ id, name }].
  function normalizeFolders(rawFolders) {
    if (!Array.isArray(rawFolders)) return [];
    return rawFolders
      .map((folder) => ({
        id: String(folder?._id || folder?.id || "").trim(),
        name: String(folder?.name || "").trim(),
      }))
      .filter((folder) => folder.id && folder.name);
  }

  async function loadFolders() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getFolders" });
      if (response?.ok) {
        return normalizeFolders(response.folders);
      }
    } catch (err) {
      console.warn("[Save to Gallery] Could not load collections:", err);
    }
    return [];
  }

  async function loadFoldersCached() {
    if (foldersCache) return foldersCache;
    if (!foldersPromise) {
      foldersPromise = loadFolders()
        .then((folders) => {
          foldersCache = folders;
          return folders;
        })
        .finally(() => {
          foldersPromise = null;
        });
    }
    return foldersPromise;
  }

  async function createFolderRemote(name) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "createFolder",
        name,
      });
      if (response?.ok) {
        const folders = normalizeFolders(response.folders);
        foldersCache = folders;
        const id = String(response.result?.folderId || "").trim();
        return { ok: true, folders, id };
      }
      return { ok: false, error: response?.error || "Failed to create collection." };
    } catch (err) {
      return { ok: false, error: err?.message || "Failed to create collection." };
    }
  }

  function createPopover(onSubmit, onClose, options = {}) {
    const {
      title = `${CHECK_ICON} Saved to gallery`,
      buttonLabel = "Add prompt",
      initialPrompt = "",
      allowEmptyPrompt = false,
    } = options;
    const pop = document.createElement("div");
    pop.className = "stg-popover";
    pop.innerHTML = `
      <button class="stg-popover__close" title="Close">&times;</button>
      <div class="stg-popover__title">${title}</div>
      <label class="stg-popover__label">Prompt (optional)</label>
      <textarea class="stg-popover__textarea" placeholder="Paste the prompt here…" rows="2"></textarea>
      <div class="stg-popover__collection-head">
        <span class="stg-popover__label">Collection</span>
        <button class="stg-popover__icon-btn stg-popover__new-collection-toggle" type="button" title="New collection">+</button>
      </div>
      <div class="stg-collection-grid" role="listbox" aria-label="Collection"></div>
      <div class="stg-popover__row stg-popover__new-collection-row" hidden>
        <input class="stg-popover__input stg-popover__new-collection-input" type="text" placeholder="New collection name" />
        <button class="stg-popover__btn stg-popover__new-collection-create" type="button">Add</button>
      </div>
      <div class="stg-popover__row stg-popover__actions">
        <button class="stg-popover__btn stg-popover__submit">${buttonLabel}</button>
      </div>
    `;

    const close = pop.querySelector(".stg-popover__close");
    const textarea = pop.querySelector(".stg-popover__textarea");
    const collectionGrid = pop.querySelector(".stg-collection-grid");
    const newCollToggle = pop.querySelector(".stg-popover__new-collection-toggle");
    const newCollRow = pop.querySelector(".stg-popover__new-collection-row");
    const newCollInput = pop.querySelector(".stg-popover__new-collection-input");
    const newCollCreate = pop.querySelector(".stg-popover__new-collection-create");
    const btn = pop.querySelector(".stg-popover__submit");

    textarea.value = initialPrompt;
    if (initialPrompt) {
      textarea.select();
    }

    // ── Collection (folder) cards ──
    let loadedFolders = [];
    let foldersReady = false;
    let rememberedFolderId = "";

    const submitWithFolder = (folderId, remember = true) => {
      const prompt = textarea.value.trim();
      if (!allowEmptyPrompt && !prompt) {
        textarea.focus();
        return;
      }
      const normalizedFolderId = folderId || "";
      if (remember) {
        chrome.storage.sync.set({ [LAST_FOLDER_ID_KEY]: normalizedFolderId });
      }
      onSubmit({
        promptText: prompt,
        folderId: normalizedFolderId || undefined,
      });
      onClose();
    };

    const appendCollectionCard = ({ folderId = "", eyebrow, label, variant = "" }) => {
      const card = document.createElement("button");
      card.className = `stg-collection-card ${variant}`.trim();
      card.type = "button";
      card.dataset.folderId = folderId;

      const eyebrowEl = document.createElement("span");
      eyebrowEl.className = "stg-collection-card__eyebrow";
      eyebrowEl.textContent = eyebrow;

      const labelEl = document.createElement("span");
      labelEl.className = "stg-collection-card__label";
      labelEl.textContent = label;

      card.append(eyebrowEl, labelEl);
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        submitWithFolder(card.dataset.folderId || "");
      });
      collectionGrid.appendChild(card);
    };

    const renderCollectionLoading = () => {
      collectionGrid.innerHTML = "";
      const card = document.createElement("button");
      card.className = "stg-collection-card stg-collection-card--loading";
      card.type = "button";
      card.disabled = true;
      card.textContent = "Loading collections";
      collectionGrid.appendChild(card);
    };

    const renderCollectionCards = (folders, selectedId) => {
      collectionGrid.innerHTML = "";
      const selectedFolder = folders.find((folder) => folder.id === selectedId);
      if (selectedFolder) {
        appendCollectionCard({
          folderId: selectedFolder.id,
          eyebrow: "Default",
          label: selectedFolder.name,
          variant: "stg-collection-card--default",
        });
      }
      appendCollectionCard({
        folderId: "",
        eyebrow: "Loose",
        label: "No collection",
        variant: selectedFolder ? "" : "stg-collection-card--default",
      });
      for (const folder of folders) {
        appendCollectionCard({
          folderId: folder.id,
          eyebrow: "Collection",
          label: folder.name,
        });
      }
    };

    renderCollectionLoading();

    readSavedFolderIds().then(({ defaultFolderId, lastFolderId }) => {
      rememberedFolderId = defaultFolderId || lastFolderId || "";
      if (foldersReady) renderCollectionCards(loadedFolders, rememberedFolderId);
    });

    loadFolders().then((folders) => {
      loadedFolders = folders;
      foldersReady = true;
      renderCollectionCards(folders, rememberedFolderId);
    });

    const handleCreateCollection = async () => {
      const name = newCollInput.value.trim();
      if (!name) return;
      newCollCreate.disabled = true;
      newCollCreate.textContent = "…";
      const res = await createFolderRemote(name);
      newCollCreate.disabled = false;
      newCollCreate.textContent = "Add";
      if (!res.ok) {
        newCollInput.value = "";
        newCollInput.placeholder = (res.error || "Failed").slice(0, 40);
        return;
      }
      loadedFolders = res.folders;
      let newId = res.id;
      if (!newId) {
        const match = res.folders.find(
          (folder) => folder.name.toLowerCase() === name.toLowerCase(),
        );
        newId = match ? match.id : "";
      }
      newCollInput.value = "";
      newCollRow.setAttribute("hidden", "");
      renderCollectionCards(loadedFolders, newId);
      submitWithFolder(newId);
    };

    newCollToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (newCollRow.hasAttribute("hidden")) {
        newCollRow.removeAttribute("hidden");
        newCollInput.focus();
      } else {
        newCollRow.setAttribute("hidden", "");
      }
    });

    newCollCreate.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleCreateCollection();
    });

    newCollInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleCreateCollection();
      }
    });

    if (!initialPrompt) {
      // Try to pre-fill from clipboard
      navigator.clipboard.readText().then((text) => {
        if (text && text.length > 10 && text.length < 5000) {
          textarea.value = text;
          textarea.select();
        }
      }).catch(() => {});
    }

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      onClose();
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      submitWithFolder(rememberedFolderId);
    });

    // Close on Escape
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    // Prevent clicks inside popover from bubbling
    pop.addEventListener("click", (e) => e.stopPropagation());
    bindExtensionUiEventShield(pop);

    return pop;
  }

  // ── Error popover ──

  function formatSaveError(err, response, ctx) {
    const lines = [];
    const message = err && err.message ? err.message : String(err || "Unknown error");
    lines.push(message);
    if (response && response.apiUrl) lines.push(`API: ${response.apiUrl}`);
    if (ctx?.imageUrl) lines.push(`Image: ${ctx.imageUrl}`);
    if (ctx?.sourceUrl) lines.push(`Source: ${ctx.sourceUrl}`);
    if (ctx?.modelName) lines.push(`Model: ${ctx.modelName}`);
    if (typeof ctx?.promptLen === "number") lines.push(`Prompt length: ${ctx.promptLen}`);
    if (err && err.stack) lines.push("", err.stack);
    return lines.join("\n");
  }

  function createErrorPopover(message, onClose) {
    const pop = document.createElement("div");
    pop.className = "stg-popover stg-popover--error";
    pop.innerHTML = `
      <button class="stg-popover__close" title="Close">&times;</button>
      <div class="stg-popover__title stg-popover__title--error">⚠ Save failed</div>
      <textarea class="stg-popover__error-msg" readonly rows="6"></textarea>
      <div class="stg-popover__row">
        <button class="stg-popover__copy">Copy error</button>
      </div>
    `;

    const textarea = pop.querySelector(".stg-popover__error-msg");
    textarea.value = message;

    const close = pop.querySelector(".stg-popover__close");
    const copyBtn = pop.querySelector(".stg-popover__copy");

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      onClose();
    });

    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const flash = (label) => {
        copyBtn.textContent = label;
        setTimeout(() => { copyBtn.textContent = "Copy error"; }, 1500);
      };
      try {
        await navigator.clipboard.writeText(message);
        flash("Copied ✓");
      } catch {
        textarea.select();
        try { document.execCommand("copy"); flash("Copied ✓"); }
        catch { flash("Press ⌘C"); }
      }
    });

    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    pop.addEventListener("click", (e) => e.stopPropagation());
    bindExtensionUiEventShield(pop);
    return pop;
  }

  function showErrorPopover(badge, message, opts = {}) {
    const { topRight = false } = opts;
    const container = badge.parentElement;
    if (!container) return;

    badge.classList.remove("stg-badge--visible");

    const popover = createErrorPopover(message, () => {
      popover.classList.remove("stg-popover--visible");
      setTimeout(() => {
        popover.remove();
        if (badge.classList.contains("stg-mj-save-main")) {
          resetMidjourneySaveButton(badge);
        } else {
          resetBadge(badge);
          if (topRight) badge.classList.add("stg-badge--top-right");
        }
      }, 150);
    });
    if (topRight) popover.classList.add("stg-popover--top-right");

    container.appendChild(popover);
    requestAnimationFrame(() => popover.classList.add("stg-popover--visible"));
  }

  function showContextToast(kind, message) {
    if (contextToastTimer) {
      clearTimeout(contextToastTimer);
      contextToastTimer = null;
    }
    if (!contextToast) {
      contextToast = document.createElement("div");
      contextToast.className = "stg-context-toast";
      bindExtensionUiEventShield(contextToast);
      document.body.appendChild(contextToast);
    }

    contextToast.className = `stg-context-toast stg-context-toast--${kind}`;
    contextToast.textContent = message;
    requestAnimationFrame(() => {
      contextToast?.classList.add("stg-context-toast--visible");
    });

    if (kind !== "saving") {
      contextToastTimer = setTimeout(() => {
        contextToast?.classList.remove("stg-context-toast--visible");
        setTimeout(() => {
          contextToast?.remove();
          contextToast = null;
        }, 180);
      }, 2200);
    }
  }

  // ── Save logic ──

  async function submitImageSave({
    badge,
    imageUrl,
    promptText,
    folderId,
    modelName,
    tagNames,
    fileData,
    topRight = false,
  }) {
    badge.innerHTML = `<span>Saving…</span>`;
    badge.classList.add("stg-badge--saving");
    if (topRight) badge.classList.add("stg-badge--top-right");

    try {
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: "saveImage",
          imageUrl,
          sourceUrl: location.href,
          pageTitle: document.title,
          promptText: promptText || undefined,
          modelName: modelName || undefined,
          folderId: folderId || undefined,
          tagNames: Array.isArray(tagNames) ? tagNames : undefined,
          file: fileData || undefined,
        });
      } catch (msgErr) {
        msgErr.message = `chrome.runtime.sendMessage failed: ${msgErr.message}`;
        throw msgErr;
      }

      if (!response || !response.ok) {
        const err = new Error(response?.error || "Save failed (no response from background worker)");
        err.responseFromBackground = response;
        throw err;
      }

      badge.innerHTML = promptText
        ? `${CHECK_ICON}<span>Saved + prompt</span>`
        : `${CHECK_ICON}<span>Saved</span>`;
      badge.classList.remove("stg-badge--saving");
      badge.classList.add("stg-badge--saved");
    } catch (err) {
      badge.innerHTML = `<span>Error</span>`;
      badge.classList.remove("stg-badge--saving");
      badge.classList.add("stg-badge--error");
      console.error("[Save to Gallery]", err, { imageUrl, modelName });
      const errorText = formatSaveError(err, err.responseFromBackground, {
        imageUrl,
        sourceUrl: location.href,
        modelName,
        promptLen: promptText?.length,
      });
      showErrorPopover(badge, errorText, { topRight });
    }
  }

  function showSavePopover(badge, saveContext, opts = {}) {
    const { topRight = false } = opts;
    const container = badge.parentElement;
    if (!container) return;

    badge.classList.remove("stg-badge--visible");

    const popover = createPopover(
      async ({ promptText, folderId }) => {
        let fileData = saveContext.fileData;
        if (!fileData && typeof saveContext.resolveFileData === "function") {
          fileData = await saveContext.resolveFileData();
        }
        await submitImageSave({
          badge,
          imageUrl: saveContext.imageUrl,
          promptText,
          folderId,
          modelName: saveContext.modelName,
          tagNames: saveContext.tagNames,
          fileData,
          topRight,
        });
      },
      () => {
        popover.classList.remove("stg-popover--visible");
        setTimeout(() => {
          popover.remove();
          if (!badge.classList.contains("stg-badge--saved") &&
              !badge.classList.contains("stg-badge--saving") &&
              !badge.classList.contains("stg-badge--error")) {
            resetBadge(badge);
            if (topRight) badge.classList.add("stg-badge--top-right");
          }
        }, 150);
      },
      {
        title: `${SAVE_ICON} Save to gallery`,
        buttonLabel: "Save",
        initialPrompt: saveContext.promptText || "",
        allowEmptyPrompt: true,
      },
    );

    if (topRight) popover.classList.add("stg-popover--top-right");
    container.appendChild(popover);
    requestAnimationFrame(() => popover.classList.add("stg-popover--visible"));
  }

  async function handleSave(img, badge) {
    let imageUrl = resolveAbsoluteUrl(getImageUrl(img));
    if (!imageUrl) return;

    // On Midjourney, try to extract prompt + better image URL from lightbox
    let mjContext = null;
    if (isMidjourneyPage()) {
      mjContext = extractMidjourneyContext();
      if (mjContext && mjContext.imageUrl) {
        imageUrl = resolveAbsoluteUrl(mjContext.imageUrl);
      }
      console.log("[Save to Gallery] Midjourney context:", mjContext);
    }

    showSavePopover(badge, {
      imageUrl,
      promptText: mjContext?.promptText || "",
      modelName: mjContext?.modelName,
      resolveFileData: async () => {
        if (isMidjourneyPage()) {
          const b64 = await captureImageBytesForSave(imageUrl);
          if (!b64) {
            console.warn("[Save to Gallery] Failed to capture image bytes, falling back to URL");
          }
          return b64 || undefined;
        }
        // Universal path: capture bytes through the background worker so
        // CORS-locked / signed CDN images still save. Falls back to a
        // server-side URL refetch when capture fails.
        const captured = await requestImageBytes(imageUrl);
        if (!captured) {
          console.warn("[Save to Gallery] Background capture failed, falling back to URL");
        }
        return captured || undefined;
      },
    });
  }

  async function handleContextMenuImageSave(message) {
    if (isMidjourneyPage()) {
      return {
        handled: true,
        ok: false,
        skipped: true,
        error: "Use the Midjourney save controls on this page.",
      };
    }

    const isEnabled = await ensureSiteStateLoaded();
    if (!isEnabled) {
      showContextToast("error", "Save disabled on this site");
      return {
        handled: true,
        ok: false,
        error: "Save to laniameda is disabled on this site.",
      };
    }

    const imageUrl = resolveAbsoluteUrl(message?.imageUrl || "");
    if (!imageUrl) {
      showContextToast("error", "Image URL unavailable");
      return { handled: true, ok: false, error: "Image URL unavailable." };
    }

    const folderId =
      typeof message?.folderId === "string" && message.folderId.trim()
        ? message.folderId.trim()
        : await getDefaultSaveFolderId();
    const sourceUrl =
      typeof message?.sourceUrl === "string" && message.sourceUrl
        ? message.sourceUrl
        : location.href;

    showContextToast("saving", "Saving to laniameda...");
    const fileData = await captureImageBytesForSave(imageUrl);

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        action: "saveImage",
        imageUrl,
        sourceUrl,
        pageTitle: document.title,
        folderId: folderId || undefined,
        file: fileData || undefined,
      });
    } catch (err) {
      response = { ok: false, error: err?.message || "Save failed." };
    }

    if (!response?.ok) {
      const error = response?.error || "Save failed.";
      console.warn("[Save to Gallery] context menu save failed:", {
        error,
        imageUrl,
        sourceUrl,
      });
      showContextToast("error", error.slice(0, 90));
      return { handled: true, ok: false, error };
    }

    showContextToast("saved", "Saved to laniameda");
    return { handled: true, ok: true, result: response.result };
  }

  function resetBadge(badge) {
    badge.innerHTML = `${SAVE_ICON}<span>Save</span>`;
    badge.className = "stg-badge";
  }

  function clearInjectedUi() {
    hideBadge();
    hideMjGridBadge();

    for (const node of document.querySelectorAll(".stg-badge, .stg-popover, .stg-mj-quick-save")) {
      node.remove();
    }

    for (const img of document.querySelectorAll(`img[${BADGE_ATTR}]`)) {
      img.removeAttribute(BADGE_ATTR);
    }

    for (const card of document.querySelectorAll(`[${MJ_GRID_BADGE_ATTR}]`)) {
      card.removeAttribute(MJ_GRID_BADGE_ATTR);
    }

    for (const target of document.querySelectorAll(`[${MJ_MEDIA_BADGE_ATTR}]`)) {
      target.removeAttribute(MJ_MEDIA_BADGE_ATTR);
    }
  }

  function setExtensionEnabled(nextEnabled) {
    extensionEnabled = Boolean(nextEnabled);
    if (!extensionEnabled) {
      clearInjectedUi();
    } else if (isMidjourneyPage()) {
      scheduleMidjourneyMediaScan();
    }
  }

  function syncSiteStateFromStorage(onComplete) {
    // Built-in exclusions win — the extension never runs on our own app.
    if (isHostDisabled(BUILTIN_DISABLED_HOSTS, currentHost)) {
      setExtensionEnabled(false);
      configLoaded = true;
      onComplete?.(false);
      return;
    }
    chrome.storage.sync.get([DISABLED_HOSTS_KEY], (cfg) => {
      const disabledHosts = normalizeDisabledHosts(cfg[DISABLED_HOSTS_KEY]);
      const enabled = !isHostDisabled(disabledHosts, currentHost);
      setExtensionEnabled(enabled);
      configLoaded = true;
      onComplete?.(enabled);
    });
  }

  // ── Hover-based lazy badge injection ──

  let currentBadge = null;
  let currentImg = null;

  function showBadgeOn(img) {
    if (currentImg === img) return;
    hideBadge();

    const parent = img.parentElement;
    if (!parent) return;

    // Ensure parent can position absolutely
    const pos = getComputedStyle(parent).position;
    if (pos === "static") parent.style.position = "relative";

    const badge = createBadge(img);
    parent.appendChild(badge);
    img.setAttribute(BADGE_ATTR, "1");

    // Fade in
    requestAnimationFrame(() => badge.classList.add("stg-badge--visible"));

    currentBadge = badge;
    currentImg = img;
  }

  function hideBadge() {
    if (currentBadge && !currentBadge.classList.contains("stg-badge--saved") &&
        !currentBadge.closest(".stg-popover")) {
      currentBadge.remove();
      if (currentImg) currentImg.removeAttribute(BADGE_ATTR);
    }
    currentBadge = null;
    currentImg = null;
  }

  // ── Midjourney grid badge (parallel state, top-right corner) ──

  let currentMjBadge = null;
  let currentMjThumb = null;

  function createMjGridBadge(thumb) {
    const badge = document.createElement("div");
    badge.className = "stg-badge stg-badge--top-right";
    badge.innerHTML = `${SAVE_ICON}<span>Save</span>`;

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleSaveMidjourneyGrid(thumb, badge);
    }, true);
    bindExtensionUiEventShield(badge);

    return badge;
  }

  function showMjGridBadgeOn(thumb) {
    if (currentMjThumb === thumb) return;
    hideMjGridBadge();

    const card = getMidjourneyCardRoot(thumb);
    if (!card) return;
    if (card.hasAttribute(MJ_GRID_BADGE_ATTR)) return;

    const pos = getComputedStyle(card).position;
    if (pos === "static") card.style.position = "relative";

    const badge = createMjGridBadge(thumb);
    card.appendChild(badge);
    card.setAttribute(MJ_GRID_BADGE_ATTR, "1");

    requestAnimationFrame(() => badge.classList.add("stg-badge--visible"));

    currentMjBadge = badge;
    currentMjThumb = thumb;
  }

  function hideMjGridBadge() {
    if (currentMjBadge && !currentMjBadge.classList.contains("stg-badge--saved") &&
        !currentMjBadge.closest(".stg-popover")) {
      currentMjBadge.remove();
      const card = currentMjThumb ? getMidjourneyCardRoot(currentMjThumb) : null;
      if (card) card.removeAttribute(MJ_GRID_BADGE_ATTR);
    }
    currentMjBadge = null;
    currentMjThumb = null;
  }

  async function handleSaveMidjourneyGrid(thumb, badge) {
    // Inline the extraction so we can log the intermediate state at click time.
    const card = getMidjourneyCardRoot(thumb);
    const job = readMidjourneyJobFromFiber(card);
    const promptText = reconstructMidjourneyPrompt(job);
    const rawImageUrl = getMidjourneyThumbImageUrl(thumb);

    console.log("[Save to Gallery] MJ grid click — extracted at click time:", {
      imageUrl: rawImageUrl,
      jobId: job?.id || null,
      hasJob: !!job,
      hasPromptObj: !!job?.prompt,
      promptKeys: job?.prompt ? Object.keys(job.prompt) : null,
      decodedPromptLength: Array.isArray(job?.prompt?.decodedPrompt) ? job.prompt.decodedPrompt.length : null,
      decodedFirstSample: job?.prompt?.decodedPrompt?.[0] || null,
      reconstructedPromptLen: promptText?.length || 0,
      reconstructedPromptStart: promptText?.slice(0, 200) || null,
      otherPromptFields: {
        full_command: typeof job?.full_command === "string" ? job.full_command.slice(0, 200) : null,
        text_prompt: typeof job?.text_prompt === "string" ? job.text_prompt.slice(0, 200) : null,
        raw_prompt: typeof job?.raw_prompt === "string" ? job.raw_prompt.slice(0, 200) : null,
      },
    });

    if (!rawImageUrl) return;
    const imageUrl = resolveAbsoluteUrl(rawImageUrl);

    showSavePopover(badge, {
      imageUrl,
      promptText: promptText || "",
      modelName: "Midjourney",
      resolveFileData: async () => {
        const fileData = await captureImageBytesForSave(imageUrl);
        if (!fileData) {
          console.warn("[Save to Gallery] MJ grid: failed to capture image bytes, falling back to URL");
        }
        return fileData || undefined;
      },
    }, { topRight: true });
  }

  // ── Midjourney persistent media buttons ──

  let midjourneyObserver = null;
  let midjourneyScanTimer = null;

  function isMidjourneyTeachPage() {
    return location.pathname.includes("/personalize/") &&
      location.pathname.includes("/teach");
  }

  function isMidjourneyImaginePage() {
    return location.pathname.includes("/imagine");
  }

  function getMidjourneyTagNames() {
    const tags = ["midjourney"];
    if (location.pathname.includes("/explore")) tags.push("midjourney-explore");
    if (isMidjourneyTeachPage()) {
      tags.push("midjourney-teach", "personalize");
    }
    return tags;
  }

  function getMidjourneyMediaUrl(target) {
    if (midjourneyAdapter?.getMediaUrl) {
      return midjourneyAdapter.getMediaUrl(target);
    }

    if (target?.tagName?.toLowerCase() === "img") {
      return getImageUrl(target);
    }

    if (target?.tagName?.toLowerCase() === "video") {
      return target.poster || target.src || "";
    }

    return getMidjourneyThumbImageUrl(target);
  }

  function targetHasMidjourneyBackgroundImage(target) {
    const inlineBackground = target?.style?.backgroundImage || "";
    const styleAttr = target?.getAttribute?.("style") || "";
    return /(?:cdn\.midjourney\.com|mj\.run)/i.test(
      `${inlineBackground} ${styleAttr}`,
    );
  }

  function isQualifiedMidjourneyMediaTarget(target) {
    if (!target || target.closest?.(".stg-badge, .stg-popover")) return false;
    if (target.hasAttribute?.(MJ_MEDIA_BADGE_ATTR)) return false;

    const tagName = target.tagName?.toLowerCase();
    if (tagName !== "img" && tagName !== "video" && !targetHasMidjourneyBackgroundImage(target)) {
      return false;
    }

    if (midjourneyAdapter?.isQualifiedMediaElement) {
      return midjourneyAdapter.isQualifiedMediaElement(target, {
        badgeAttr: MJ_MEDIA_BADGE_ATTR,
      });
    }

    const imageUrl = getMidjourneyMediaUrl(target);
    return Boolean(imageUrl && imageUrl.includes("midjourney"));
  }

  function findMidjourneyPromptNear(target) {
    const lightboxContext = extractMidjourneyContext();
    if (lightboxContext?.promptText) return lightboxContext.promptText;

    const card = getMidjourneyCardRoot(target);
    const job =
      readMidjourneyJobFromFiber(target) ||
      readMidjourneyJobFromFiber(card) ||
      readMidjourneyJobFromFiber(target?.parentElement);
    const promptText = reconstructMidjourneyPrompt(job);
    if (promptText) return promptText;

    if (!isMidjourneyTeachPage()) {
      console.debug("[Save to Gallery] Midjourney prompt unavailable for media target.");
    }
    return "";
  }

  function getMidjourneySaveContext(target) {
    const rawImageUrl = getMidjourneyMediaUrl(target);
    if (!rawImageUrl) return null;

    return {
      imageUrl: resolveAbsoluteUrl(rawImageUrl),
      promptText: findMidjourneyPromptNear(target),
      modelName: "Midjourney",
      tagNames: getMidjourneyTagNames(),
    };
  }

  function positionMidjourneyWidget(widget, target) {
    if (!target || !document.contains(target)) {
      widget.remove();
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 ||
        rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
      widget.style.display = "none";
      return;
    }

    widget.style.display = "flex";
    widget.classList.toggle("stg-mj-quick-save--centered", isMidjourneyImaginePage());
    const width = widget.offsetWidth || 82;
    const top = Math.max(8, rect.top + 8);
    const rawLeft = isMidjourneyImaginePage()
      ? rect.left + (rect.width - width) / 2
      : rect.right - width - 8;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rawLeft));
    widget.style.top = `${Math.round(top)}px`;
    widget.style.left = `${Math.round(left)}px`;
  }

  function updateMidjourneyWidgetPositions() {
    for (const widget of document.querySelectorAll(".stg-mj-quick-save")) {
      const target = widget.__stgTarget;
      if (!target || !document.contains(target)) {
        if (target?.removeAttribute) target.removeAttribute(MJ_MEDIA_BADGE_ATTR);
        widget.remove();
        continue;
      }
      positionMidjourneyWidget(widget, target);
    }
  }

  function resetMidjourneySaveButton(button) {
    button.innerHTML = `${SAVE_ICON}<span>Save</span>`;
    button.classList.remove("stg-badge--saving", "stg-badge--saved", "stg-badge--error");
  }

  async function handleSaveMidjourneyMedia(target, button, folderId) {
    if (button.classList.contains("stg-badge--saving")) return;

    const saveContext = getMidjourneySaveContext(target);
    if (!saveContext) {
      console.debug("[Save to Gallery] Midjourney image URL unavailable for media target.");
      return;
    }

    let effectiveFolderId = folderId;
    if (arguments.length < 3) {
      effectiveFolderId = await getDefaultSaveFolderId();
    }

    const fileData = await captureImageBytesForSave(saveContext.imageUrl);
    if (!fileData) {
      console.warn("[Save to Gallery] Midjourney media: failed to capture image bytes, falling back to URL");
    }

    await submitImageSave({
      badge: button,
      imageUrl: saveContext.imageUrl,
      promptText: saveContext.promptText,
      folderId: effectiveFolderId || undefined,
      modelName: saveContext.modelName,
      tagNames: saveContext.tagNames,
      fileData,
      topRight: true,
    });
  }

  function renderMidjourneyCollectionMenu(menu, folders, defaultFolderId) {
    const defaultFolder = folders.find((folder) => folder.id === defaultFolderId);
    const rows = [
      {
        id: "__default",
        folderId: defaultFolderId || "",
        eyebrow: "Default",
        label: defaultFolder ? defaultFolder.name : "No collection",
      },
      {
        id: "__none",
        folderId: "",
        eyebrow: "Save without filing",
        label: "No collection",
      },
      ...folders.map((folder) => ({
        id: folder.id,
        folderId: folder.id,
        eyebrow: "Collection",
        label: folder.name,
      })),
    ];

    menu.innerHTML = "";
    for (const row of rows) {
      const item = document.createElement("button");
      item.className = "stg-mj-menu__item";
      item.type = "button";
      item.dataset.folderId = row.folderId;
      item.dataset.menuId = row.id;

      const eyebrow = document.createElement("span");
      eyebrow.className = "stg-mj-menu__eyebrow";
      eyebrow.textContent = row.eyebrow;

      const label = document.createElement("span");
      label.className = "stg-mj-menu__label";
      label.textContent = row.label;

      item.append(eyebrow, label);
      menu.appendChild(item);
    }
  }

  async function openMidjourneyCollectionMenu(widget) {
    const menu = widget.querySelector(".stg-mj-menu");
    if (!menu || menu.dataset.ready === "1") {
      if (menu) menu.hidden = false;
      return;
    }

    menu.hidden = false;
    menu.innerHTML = `<div class="stg-mj-menu__loading">Loading collections…</div>`;
    const [{ defaultFolderId }, folders] = await Promise.all([
      readSavedFolderIds(),
      loadFoldersCached(),
    ]);
    renderMidjourneyCollectionMenu(menu, folders, defaultFolderId);
    menu.dataset.ready = "1";
  }

  function closeMidjourneyCollectionMenu(widget) {
    const menu = widget.querySelector(".stg-mj-menu");
    if (menu) menu.hidden = true;
  }

  function createMidjourneyMediaWidget(target) {
    const widget = document.createElement("div");
    widget.className = "stg-mj-quick-save";
    widget.__stgTarget = target;
    widget.innerHTML = `
      <button class="stg-mj-save-main" type="button" title="Save to default collection">
        ${SAVE_ICON}<span>Save</span>
      </button>
      <button class="stg-mj-save-arrow" type="button" title="Choose collection">${CHEVRON_ICON}</button>
      <div class="stg-mj-menu" hidden></div>
    `;
    bindExtensionUiEventShield(widget);

    const mainButton = widget.querySelector(".stg-mj-save-main");
    const arrowButton = widget.querySelector(".stg-mj-save-arrow");
    const menu = widget.querySelector(".stg-mj-menu");
    let closeTimer = null;

    const cancelClose = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    };
    const scheduleClose = () => {
      cancelClose();
      closeTimer = setTimeout(() => closeMidjourneyCollectionMenu(widget), 180);
    };

    mainButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void handleSaveMidjourneyMedia(target, mainButton).finally(() => {
        if (!mainButton.classList.contains("stg-badge--error")) {
          setTimeout(() => resetMidjourneySaveButton(mainButton), 1800);
        }
      });
    }, true);

    arrowButton.addEventListener("pointerenter", () => {
      cancelClose();
      void openMidjourneyCollectionMenu(widget);
    });
    arrowButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (menu.hidden) void openMidjourneyCollectionMenu(widget);
      else closeMidjourneyCollectionMenu(widget);
    }, true);

    widget.addEventListener("pointerenter", cancelClose);
    widget.addEventListener("pointerleave", scheduleClose);
    menu.addEventListener("pointerenter", cancelClose);
    menu.addEventListener("pointerleave", scheduleClose);
    menu.addEventListener("click", (event) => {
      const item = event.target?.closest?.(".stg-mj-menu__item");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const selectedFolderId = item.dataset.folderId || "";
      chrome.storage.sync.set({ [LAST_FOLDER_ID_KEY]: selectedFolderId });
      closeMidjourneyCollectionMenu(widget);
      void handleSaveMidjourneyMedia(target, mainButton, selectedFolderId || undefined)
        .finally(() => {
          if (!mainButton.classList.contains("stg-badge--error")) {
            setTimeout(() => resetMidjourneySaveButton(mainButton), 1800);
          }
        });
    }, true);

    return widget;
  }

  function injectMidjourneyMediaBadge(target) {
    if (!isQualifiedMidjourneyMediaTarget(target)) return;

    const widget = createMidjourneyMediaWidget(target);
    document.body.appendChild(widget);
    target.setAttribute(MJ_MEDIA_BADGE_ATTR, "1");
    positionMidjourneyWidget(widget, target);
  }

  function scanMidjourneyMediaTargets() {
    if (!configLoaded || !extensionEnabled || !isMidjourneyPage()) return;

    const candidates = document.querySelectorAll(MJ_MEDIA_SELECTOR);
    for (const candidate of candidates) {
      if (candidate.tagName?.toLowerCase() === "img" && !candidate.complete) {
        candidate.addEventListener("load", () => {
          if (extensionEnabled) injectMidjourneyMediaBadge(candidate);
        }, { once: true });
        continue;
      }
      injectMidjourneyMediaBadge(candidate);
    }
    updateMidjourneyWidgetPositions();
  }

  function scheduleMidjourneyMediaScan(delay = 80) {
    if (!isMidjourneyPage()) return;
    clearTimeout(midjourneyScanTimer);
    midjourneyScanTimer = setTimeout(() => {
      if (!configLoaded) {
        syncSiteStateFromStorage((isEnabled) => {
          if (isEnabled) scanMidjourneyMediaTargets();
        });
        return;
      }
      scanMidjourneyMediaTargets();
    }, delay);
  }

  function startMidjourneyMediaObserver() {
    if (!isMidjourneyPage() || midjourneyObserver) return;

    midjourneyObserver = new MutationObserver(() => {
      scheduleMidjourneyMediaScan();
    });
    midjourneyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "src", "srcset", "style", "poster"],
    });
    window.addEventListener("scroll", updateMidjourneyWidgetPositions, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", updateMidjourneyWidgetPositions, {
      passive: true,
    });
    scheduleMidjourneyMediaScan(0);
  }

  // ── Event listeners ──

  document.addEventListener("mouseover", (e) => {
    if (isMidjourneyPage()) return;

    const img = e.target.closest("img");
    if (!img) return;

    syncSiteStateFromStorage((isEnabled) => {
      if (!configLoaded || !isEnabled) return;

      // Check if already has a saved badge or popover open
      if (img.hasAttribute(BADGE_ATTR)) return;

      // Wait for natural dimensions on lazy-loaded images
      if (img.complete) {
        if (isQualifiedImage(img)) showBadgeOn(img);
      } else {
        img.addEventListener("load", () => {
          if (extensionEnabled && isQualifiedImage(img)) showBadgeOn(img);
        }, { once: true });
      }
    });
  }, { passive: true });

  // Midjourney /explore grid — anchors with bg-image (no <img>)
  document.addEventListener("mouseover", (e) => {
    if (!isMidjourneyPage()) return;
    const thumb = e.target.closest(MJ_GRID_THUMB_SELECTOR);
    if (!thumb || !isMidjourneyGridThumb(thumb)) return;
    if (thumb.hasAttribute(MJ_MEDIA_BADGE_ATTR)) return;

    syncSiteStateFromStorage((isEnabled) => {
      if (!configLoaded || !isEnabled) return;
      const card = getMidjourneyCardRoot(thumb);
      if (!card || card.hasAttribute(MJ_GRID_BADGE_ATTR)) return;
      showMjGridBadgeOn(thumb);
    });
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
    if (!configLoaded || !extensionEnabled || !isMidjourneyPage()) return;

    const thumb = e.target.closest(MJ_GRID_THUMB_SELECTOR);
    if (!thumb || thumb !== currentMjThumb) return;

    const related = e.relatedTarget;
    if (related && (related.closest(".stg-badge") || related.closest(".stg-popover"))) return;

    setTimeout(() => {
      if (currentMjThumb !== thumb) return;
      const hovered = document.querySelectorAll(":hover");
      for (const el of hovered) {
        if (el === thumb || el.closest(".stg-badge") || el.closest(".stg-popover")) return;
        if (currentMjThumb && el === getMidjourneyCardRoot(currentMjThumb)) return;
      }
      hideMjGridBadge();
    }, 200);
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
    if (!configLoaded || !extensionEnabled || !isMidjourneyPage()) return;
    if (!e.target.closest(".stg-badge")) return;

    const related = e.relatedTarget;
    if (related && (
      related === currentMjThumb ||
      related.closest(".stg-badge") ||
      related.closest(".stg-popover") ||
      (currentMjThumb && related === getMidjourneyCardRoot(currentMjThumb))
    )) return;

    setTimeout(() => {
      const hovered = document.querySelectorAll(":hover");
      for (const el of hovered) {
        if (el === currentMjThumb || el.closest(".stg-badge") || el.closest(".stg-popover")) return;
        if (currentMjThumb && el === getMidjourneyCardRoot(currentMjThumb)) return;
      }
      hideMjGridBadge();
    }, 200);
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
    if (!configLoaded || !extensionEnabled) return;

    const img = e.target.closest("img");
    if (!img || img !== currentImg) return;

    // Don't hide if mouse moved to the badge itself
    const related = e.relatedTarget;
    if (related && (related.closest(".stg-badge") || related.closest(".stg-popover"))) return;

    // Delay hide to allow moving to badge
    setTimeout(() => {
      if (currentImg !== img) return;
      const hovered = document.querySelectorAll(":hover");
      for (const el of hovered) {
        if (el === img || el.closest(".stg-badge") || el.closest(".stg-popover")) return;
      }
      hideBadge();
    }, 200);
  }, { passive: true });

  // Also hide badge when mouse leaves the badge itself
  document.addEventListener("mouseout", (e) => {
    if (!configLoaded || !extensionEnabled) return;

    if (!e.target.closest(".stg-badge")) return;
    const related = e.relatedTarget;
    if (related && (related === currentImg || related.closest(".stg-badge") || related.closest(".stg-popover"))) return;
    setTimeout(() => {
      const hovered = document.querySelectorAll(":hover");
      for (const el of hovered) {
        if (el === currentImg || el.closest(".stg-badge") || el.closest(".stg-popover")) return;
      }
      hideBadge();
    }, 200);
  }, { passive: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === "setSiteEnabled") {
      setExtensionEnabled(Boolean(message.enabled));
      configLoaded = true;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.action === "saveImageFromContextMenu") {
      handleContextMenuImageSave(message)
        .then(sendResponse)
        .catch((err) => {
          sendResponse({
            handled: true,
            ok: false,
            error: err?.message || "Save failed.",
          });
        });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[DISABLED_HOSTS_KEY]) {
      return;
    }

    const disabledHosts = normalizeDisabledHosts(
      changes[DISABLED_HOSTS_KEY].newValue,
    );
    setExtensionEnabled(!isHostDisabled(disabledHosts, currentHost));
    configLoaded = true;
  });

  syncSiteStateFromStorage();
  startMidjourneyMediaObserver();

})();
