// Save to Gallery — Universal content script
// Attaches a hover badge on images that are large enough both intrinsically and on screen.
// Includes Midjourney-specific prompt extraction when on midjourney.com.

(() => {
  "use strict";

  const BADGE_ATTR = "data-stg-badge";
  const DISABLED_HOSTS_KEY = "disabledHosts";
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
  const imageQualification = globalThis.SaveToGalleryImageQualification;
  const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");

  let extensionEnabled = false;
  let configLoaded = false;

  // ── Midjourney adapter ──

  // The card root has `@container/jobCard group/jobCard` — match the @container token
  // to avoid picking up descendant divs whose class names reference `jobCard` modifiers.
  const MJ_GRID_CARD_SELECTOR = 'div[class*="@container/jobCard"]';
  const MJ_GRID_THUMB_SELECTOR = 'a[href*="/jobs/"]';
  const MJ_GRID_BADGE_ATTR = "data-stg-mj-badge";

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

    return badge;
  }

  // ── Popover creation ──

  const DEFAULT_PILLARS = [
    { key: "creators", label: "Creators" },
    { key: "designs", label: "Designs" },
    { key: "dump", label: "Dump" },
  ];

  async function loadPillars() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getPillars" });
      if (response?.ok && Array.isArray(response.pillars) && response.pillars.length > 0) {
        return response.pillars
          .map((pillar) => ({
            key: String(pillar.key || "").trim(),
            label: String(pillar.label || pillar.key || "").trim(),
          }))
          .filter((pillar) => pillar.key && pillar.label);
      }
    } catch (err) {
      console.warn("[Save to Gallery] Could not load custom pillars:", err);
    }
    return DEFAULT_PILLARS;
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
      <div class="stg-popover__row">
        <select class="stg-popover__select">
          <option value="dump">dump</option>
        </select>
        <button class="stg-popover__btn">${buttonLabel}</button>
      </div>
    `;

    const close = pop.querySelector(".stg-popover__close");
    const textarea = pop.querySelector(".stg-popover__textarea");
    const select = pop.querySelector(".stg-popover__select");
    const btn = pop.querySelector(".stg-popover__btn");

    textarea.value = initialPrompt;
    if (initialPrompt) {
      textarea.select();
    }

    Promise.all([
      loadPillars(),
      chrome.storage.sync.get(["defaultPillar"]),
    ]).then(([pillars, cfg]) => {
      select.innerHTML = "";
      for (const pillar of pillars) {
        const option = document.createElement("option");
        option.value = pillar.key;
        option.textContent = pillar.label;
        select.appendChild(option);
      }
      const defaultPillar = cfg.defaultPillar || "dump";
      if (pillars.some((pillar) => pillar.key === defaultPillar)) {
        select.value = defaultPillar;
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
      const prompt = textarea.value.trim();
      const pillar = select.value;
      if (allowEmptyPrompt || prompt) {
        onSubmit({ promptText: prompt, pillar });
      }
      onClose();
    });

    // Close on Escape
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    // Prevent clicks inside popover from bubbling
    pop.addEventListener("click", (e) => e.stopPropagation());

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
        resetBadge(badge);
        if (topRight) badge.classList.add("stg-badge--top-right");
      }, 150);
    });
    if (topRight) popover.classList.add("stg-popover--top-right");

    container.appendChild(popover);
    requestAnimationFrame(() => popover.classList.add("stg-popover--visible"));
  }

  // ── Save logic ──

  async function submitImageSave({
    badge,
    imageUrl,
    promptText,
    pillar,
    modelName,
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
          pillar,
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
      async ({ promptText, pillar }) => {
        let fileData = saveContext.fileData;
        if (!fileData && typeof saveContext.resolveFileData === "function") {
          fileData = await saveContext.resolveFileData();
        }
        await submitImageSave({
          badge,
          imageUrl: saveContext.imageUrl,
          promptText,
          pillar,
          modelName: saveContext.modelName,
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
        if (!isMidjourneyPage()) return undefined;
        const b64 = await imageToBase64(imageUrl);
        if (!b64) {
          console.warn("[Save to Gallery] Failed to fetch image as base64, falling back to URL");
        }
        return b64 || undefined;
      },
    });
  }

  function resetBadge(badge) {
    badge.innerHTML = `${SAVE_ICON}<span>Save</span>`;
    badge.className = "stg-badge";
  }

  function clearInjectedUi() {
    hideBadge();
    hideMjGridBadge();

    for (const node of document.querySelectorAll(".stg-badge, .stg-popover")) {
      node.remove();
    }

    for (const img of document.querySelectorAll(`img[${BADGE_ATTR}]`)) {
      img.removeAttribute(BADGE_ATTR);
    }

    for (const card of document.querySelectorAll(`[${MJ_GRID_BADGE_ATTR}]`)) {
      card.removeAttribute(MJ_GRID_BADGE_ATTR);
    }
  }

  function setExtensionEnabled(nextEnabled) {
    extensionEnabled = Boolean(nextEnabled);
    if (!extensionEnabled) {
      clearInjectedUi();
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
        const fileData = await imageToBase64(imageUrl);
        if (!fileData) {
          console.warn("[Save to Gallery] MJ grid: failed to fetch image as base64, falling back to URL");
        }
        return fileData || undefined;
      },
    }, { topRight: true });
  }

  // ── Event listeners ──

  document.addEventListener("mouseover", (e) => {
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

})();
