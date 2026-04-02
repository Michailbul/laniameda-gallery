// Save to Gallery — Universal content script
// Attaches a hover badge on any image ≥ 150×150px. Click → save to gallery.

(() => {
  "use strict";

  const MIN_SIZE = 150;
  const BADGE_ATTR = "data-stg-badge";
  const SAVE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // ── Helpers ──

  function isQualifiedImage(img) {
    if (img.hasAttribute(BADGE_ATTR)) return false;
    const w = img.naturalWidth || img.width || img.offsetWidth;
    const h = img.naturalHeight || img.height || img.offsetHeight;
    if (w < MIN_SIZE || h < MIN_SIZE) return false;
    const src = getImageUrl(img);
    if (!src || src.startsWith("data:image/gif") || src.includes("spacer") || src.includes("pixel.")) return false;
    return true;
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
    const imageUrl = resolveAbsoluteUrl(getImageUrl(img));
    if (!imageUrl) return;

    // Visual feedback: saving
    badge.innerHTML = `<span>Saving…</span>`;
    badge.classList.add("stg-badge--saving");

    try {
      // Send to background worker
      const response = await chrome.runtime.sendMessage({
        action: "saveImage",
        imageUrl,
        sourceUrl: location.href,
        pageTitle: document.title,
      });

      if (response && response.ok) {
        // Success — show checkmark
        badge.innerHTML = `${CHECK_ICON}<span>Saved</span>`;
        badge.classList.remove("stg-badge--saving");
        badge.classList.add("stg-badge--saved");

        // Show popover for optional prompt
        showPopover(img, badge, imageUrl, response.result);
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

  function showPopover(img, badge, imageUrl) {
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

    // Check if already has a saved badge or popover open
    if (img.hasAttribute(BADGE_ATTR)) return;

    // Wait for natural dimensions on lazy-loaded images
    if (img.complete) {
      if (isQualifiedImage(img)) showBadgeOn(img);
    } else {
      img.addEventListener("load", () => {
        if (isQualifiedImage(img)) showBadgeOn(img);
      }, { once: true });
    }
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
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

})();
