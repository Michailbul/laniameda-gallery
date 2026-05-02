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

  function createPopover(imageUrl, onSubmit, onClose) {
    const pop = document.createElement("div");
    pop.className = "stg-popover";
    pop.innerHTML = `
      <button class="stg-popover__close" title="Close">&times;</button>
      <div class="stg-popover__title">${CHECK_ICON} Saved to gallery</div>
      <label class="stg-popover__label">Prompt (optional)</label>
      <textarea class="stg-popover__textarea" placeholder="Paste the prompt here…" rows="2"></textarea>
      <div class="stg-popover__row">
        <select class="stg-popover__select">
          <option value="dump">dump</option>
          <option value="creators">creators</option>
          <option value="cars">cars</option>
          <option value="designs">designs</option>
        </select>
        <button class="stg-popover__btn">Add prompt</button>
      </div>
    `;

    const close = pop.querySelector(".stg-popover__close");
    const textarea = pop.querySelector(".stg-popover__textarea");
    const select = pop.querySelector(".stg-popover__select");
    const btn = pop.querySelector(".stg-popover__btn");

    // Load default pillar from storage
    chrome.storage.sync.get(["defaultPillar"], (cfg) => {
      if (cfg.defaultPillar) select.value = cfg.defaultPillar;
    });

    // Try to pre-fill from clipboard
    navigator.clipboard.readText().then((text) => {
      if (text && text.length > 10 && text.length < 5000) {
        textarea.value = text;
        textarea.select();
      }
    }).catch(() => {});

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      onClose();
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const prompt = textarea.value.trim();
      const pillar = select.value;
      if (prompt) {
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

  // ── Save logic ──

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

    // Visual feedback: saving
    badge.innerHTML = `<span>Saving…</span>`;
    badge.classList.add("stg-badge--saving");

    try {
      // On Midjourney, fetch image as base64 (CDN blocks server-side fetch)
      let fileData = undefined;
      if (isMidjourneyPage()) {
        const b64 = await imageToBase64(imageUrl);
        if (b64) fileData = b64;
        else console.warn("[Save to Gallery] Failed to fetch image as base64, falling back to URL");
      }

      // Send to background worker with Midjourney context if available
      const response = await chrome.runtime.sendMessage({
        action: "saveImage",
        imageUrl,
        sourceUrl: location.href,
        pageTitle: document.title,
        promptText: mjContext?.promptText || undefined,
        modelName: mjContext?.modelName || undefined,
        file: fileData || undefined,
      });

      if (response && response.ok) {
        // Success — show checkmark
        badge.innerHTML = `${CHECK_ICON}<span>Saved</span>`;
        badge.classList.remove("stg-badge--saving");
        badge.classList.add("stg-badge--saved");

        // Skip popover if Midjourney prompt was auto-extracted
        if (mjContext && mjContext.promptText) {
          badge.innerHTML = `${CHECK_ICON}<span>Saved + prompt</span>`;
        } else {
          // Show popover for optional prompt
          showPopover(img, badge, imageUrl, response.result);
        }
      } else {
        throw new Error(response?.error || "Save failed");
      }
    } catch (err) {
      badge.innerHTML = `<span>Error</span>`;
      badge.classList.remove("stg-badge--saving");
      badge.classList.add("stg-badge--error");
      console.error("[Save to Gallery]", err);
      setTimeout(() => resetBadge(badge), 3000);
    }
  }

  function showPopover(img, badge, imageUrl, _saveResult) {
    // Hide the badge
    badge.classList.remove("stg-badge--visible");

    const container = badge.parentElement;
    const popover = createPopover(
      imageUrl,
      // On prompt submit — update the saved asset
      async ({ promptText, pillar }) => {
        try {
          await chrome.runtime.sendMessage({
            action: "updatePrompt",
            imageUrl,
            promptText,
            pillar,
            sourceUrl: location.href,
          });
        } catch (err) {
          console.error("[Save to Gallery] Update failed:", err);
        }
      },
      // On close
      () => {
        popover.classList.remove("stg-popover--visible");
        setTimeout(() => {
          popover.remove();
          resetBadge(badge);
          badge.classList.add("stg-badge--saved");
        }, 150);
      }
    );

    container.appendChild(popover);
    requestAnimationFrame(() => popover.classList.add("stg-popover--visible"));
  }

  function resetBadge(badge) {
    badge.innerHTML = `${SAVE_ICON}<span>Save</span>`;
    badge.className = "stg-badge";
  }

  function clearInjectedUi() {
    hideBadge();

    for (const node of document.querySelectorAll(".stg-badge, .stg-popover")) {
      node.remove();
    }

    for (const img of document.querySelectorAll(`img[${BADGE_ATTR}]`)) {
      img.removeAttribute(BADGE_ATTR);
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
