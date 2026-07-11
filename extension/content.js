// Save to Gallery — Universal content script
// Attaches a hover badge on images that are large enough both intrinsically and on screen.
// Includes Midjourney-specific prompt extraction when on midjourney.com and a
// Krea adapter (persistent quick-save widgets + prompt extraction) on krea.ai.

(() => {
  "use strict";

  const BADGE_ATTR = "data-stg-badge";
  const DISABLED_HOSTS_KEY = "disabledHosts";
  const DEFAULT_FOLDER_ID_KEY = "defaultFolderId";
  const LAST_FOLDER_ID_KEY = "lastFolderId";
  // Remembered animation / live-action classification, auto-applied as a tag
  // to every save until changed.
  const STYLE_TAG_KEY = "lastStyleTag";
  const STYLE_TAG_OPTIONS = [
    { value: "", label: "None" },
    { value: "animation", label: "Animation" },
    { value: "live-action", label: "Live action" },
  ];
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
  const kreaAdapter = globalThis.SaveToGalleryKrea;
  const pinterestAdapter = globalThis.SaveToGalleryPinterest;
  const shotdeckAdapter = globalThis.SaveToGalleryShotdeck;
  const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");

  function getExtensionRuntime() {
    const runtime = globalThis.chrome?.runtime;
    return runtime && typeof runtime.sendMessage === "function" ? runtime : null;
  }

  function getExtensionStorageSync() {
    const storage = globalThis.chrome?.storage?.sync;
    return storage && typeof storage.get === "function" ? storage : null;
  }

  function getExtensionStorageLocal() {
    const storage = globalThis.chrome?.storage?.local;
    return storage && typeof storage.get === "function" ? storage : null;
  }

  function createExtensionRuntimeUnavailableError(action) {
    const err = new Error(
      "Extension runtime is unavailable. Reload this page after updating or reloading Save to Gallery, then try again.",
    );
    err.action = action;
    err.extensionRuntimeUnavailable = true;
    return err;
  }

  async function sendRuntimeMessage(message) {
    const runtime = getExtensionRuntime();
    if (!runtime) {
      throw createExtensionRuntimeUnavailableError(message?.action || "sendMessage");
    }
    return runtime.sendMessage(message);
  }

  async function getStorageSync(keys) {
    const storage = getExtensionStorageSync();
    if (!storage) return {};
    return storage.get(keys);
  }

  function setStorageSync(values) {
    const storage = getExtensionStorageSync();
    if (!storage || typeof storage.set !== "function") return;
    try {
      const result = storage.set(values);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.warn("[Save to Gallery] Could not persist extension storage:", err);
        });
      }
    } catch (err) {
      console.warn("[Save to Gallery] Could not persist extension storage:", err);
    }
  }

  async function getStorageLocal(keys) {
    const storage = getExtensionStorageLocal();
    if (!storage) return {};
    return storage.get(keys);
  }

  function setStorageLocal(values) {
    const storage = getExtensionStorageLocal();
    if (!storage || typeof storage.set !== "function") return;
    try {
      const result = storage.set(values);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.warn("[Save to Gallery] Could not persist extension storage:", err);
        });
      }
    } catch (err) {
      console.warn("[Save to Gallery] Could not persist extension storage:", err);
    }
  }

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
  const MJ_LIKED_FILTER_HIDDEN_ATTR = "data-stg-mj-liked-filter-hidden";
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
  const EXTENSION_UI_SELECTOR = [
    ".stg-badge",
    ".stg-popover",
    ".stg-context-toast",
    ".stg-mj-liked-nav",
    ".stg-mj-quick-save",
    ".stg-mj-notes",
    ".stg-mj-notes-layer",
  ].join(",");
  const PAGE_CONTROL_SELECTOR = [
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='menuitem']",
    "[role='option']",
    "[aria-haspopup]",
    "[data-testid*='button' i]",
    "[class*='button' i]",
  ].join(",");
  const SAVE_CONTROL_GAP = 8;
  const PAGE_CONTROL_CLEARANCE = 6;

  function isMidjourneyPage() {
    return location.hostname.includes("midjourney.com");
  }

  function isKreaPage() {
    if (kreaAdapter?.isKreaPage) return kreaAdapter.isKreaPage(location.hostname);
    const host = location.hostname.toLowerCase();
    return host === "krea.ai" || host.endsWith(".krea.ai");
  }

  function isPinterestPage() {
    if (pinterestAdapter?.isPinterestPage) {
      return pinterestAdapter.isPinterestPage(location.hostname);
    }
    return /(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(
      location.hostname.toLowerCase(),
    );
  }

  function isShotdeckPage() {
    if (shotdeckAdapter?.isShotdeckPage) {
      return shotdeckAdapter.isShotdeckPage(location.hostname);
    }
    const host = location.hostname.toLowerCase();
    return host === "shotdeck.com" || host.endsWith(".shotdeck.com");
  }

  // Sites that get persistent quick-save widgets (Save + collection menu on
  // every qualified generation) instead of the generic hover badge.
  function isPersistentSaveSite() {
    return (
      isMidjourneyPage() || isKreaPage() || isPinterestPage() || isShotdeckPage()
    );
  }

  // Krea qualification is size-based (see krea-adapter.js), so the scan
  // considers every rendered <img>/<video> (plus background-image containers)
  // and filters at inject time.
  const KREA_MEDIA_SELECTOR = 'img, video, [style*="background-image"]';

  function getSiteMediaSelector() {
    return isMidjourneyPage() ? MJ_MEDIA_SELECTOR : KREA_MEDIA_SELECTOR;
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
      const response = await sendRuntimeMessage({
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

  function isVisibleElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.01;
  }

  function rectsOverlap(a, b, clearance = 0) {
    return a.left < b.right + clearance &&
      a.right > b.left - clearance &&
      a.top < b.bottom + clearance &&
      a.bottom > b.top - clearance;
  }

  function rectFitsInside(a, b, clearance = 0) {
    return a.left >= b.left + clearance &&
      a.top >= b.top + clearance &&
      a.right <= b.right - clearance &&
      a.bottom <= b.bottom - clearance;
  }

  function toViewportRect(host, left, top, width, height) {
    const hostRect = host.getBoundingClientRect();
    const scrollLeft = host === document.body || host === document.documentElement
      ? 0
      : host.scrollLeft;
    const scrollTop = host === document.body || host === document.documentElement
      ? 0
      : host.scrollTop;
    return {
      left: hostRect.left + left - scrollLeft,
      top: hostRect.top + top - scrollTop,
      right: hostRect.left + left - scrollLeft + width,
      bottom: hostRect.top + top - scrollTop + height,
      width,
      height,
    };
  }

  function isPageControlToAvoid(control, target) {
    if (!control || control.closest?.(EXTENSION_UI_SELECTOR)) return false;
    if (control === target || control.contains?.(target)) return false;
    return isVisibleElement(control);
  }

  function getNearbyPageControlRects(target) {
    const targetRect = target.getBoundingClientRect();
    const searchRect = {
      left: targetRect.left - 96,
      top: targetRect.top - 96,
      right: targetRect.right + 96,
      bottom: targetRect.bottom + 96,
    };
    const controls = Array.from(document.querySelectorAll(PAGE_CONTROL_SELECTOR));
    return controls
      .filter((control) => isPageControlToAvoid(control, target))
      .map((control) => control.getBoundingClientRect())
      .filter((rect) => rectsOverlap(rect, searchRect, 0));
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  function buildSaveControlCandidates(targetRect, hostRect, width, height, options = {}) {
    const scrollLeft = options.host?.scrollLeft || 0;
    const scrollTop = options.host?.scrollTop || 0;
    const targetLeft = targetRect.left - hostRect.left + scrollLeft;
    const targetTop = targetRect.top - hostRect.top + scrollTop;
    const targetRight = targetRect.right - hostRect.left + scrollLeft;
    const targetBottom = targetRect.bottom - hostRect.top + scrollTop;
    const gap = SAVE_CONTROL_GAP;
    const maxLeft = Math.max(gap, hostRect.width + scrollLeft - width - gap);
    const centeredLeft = targetLeft + (targetRect.width - width) / 2;
    const placements = options.centered
      ? ["inside-top-center", "inside-bottom-center", "inside-top-right", "inside-top-left", "outside-above-center", "outside-below-center"]
      : ["inside-top-right", "inside-top-left", "inside-bottom-right", "inside-bottom-left", "outside-above-right", "outside-below-right"];

    const byPlacement = {
      "inside-top-center": {
        left: clamp(centeredLeft, targetLeft + gap, targetRight - width - gap),
        top: targetTop + gap,
      },
      "inside-bottom-center": {
        left: clamp(centeredLeft, targetLeft + gap, targetRight - width - gap),
        top: targetBottom - height - gap,
      },
      "inside-top-right": {
        left: targetRight - width - gap,
        top: targetTop + gap,
      },
      "inside-top-left": {
        left: targetLeft + gap,
        top: targetTop + gap,
      },
      "inside-bottom-right": {
        left: targetRight - width - gap,
        top: targetBottom - height - gap,
      },
      "inside-bottom-left": {
        left: targetLeft + gap,
        top: targetBottom - height - gap,
      },
      "outside-above-center": {
        left: clamp(centeredLeft, gap, maxLeft),
        top: targetTop - height - gap,
      },
      "outside-below-center": {
        left: clamp(centeredLeft, gap, maxLeft),
        top: targetBottom + gap,
      },
      "outside-above-right": {
        left: clamp(targetRight - width, gap, maxLeft),
        top: targetTop - height - gap,
      },
      "outside-below-right": {
        left: clamp(targetRight - width, gap, maxLeft),
        top: targetBottom + gap,
      },
    };

    return placements.map((placement) => ({
      placement,
      ...byPlacement[placement],
    }));
  }

  function positionSaveControlAvoidingPageUi(control, target, host, options = {}) {
    if (!control || !target || !host) return false;
    const targetRect = target.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0 || hostRect.width <= 0 || hostRect.height <= 0) {
      return false;
    }

    // Style writes are guarded (same-value assignments still queue mutation
    // records, which would feed the media-scan observer) and cheap to skip.
    if (control.style.right !== "auto") control.style.right = "auto";
    if (control.style.bottom !== "auto") control.style.bottom = "auto";
    const display = options.display || control.style.display || "flex";
    if (control.style.display !== display) control.style.display = display;

    const width = control.offsetWidth || options.fallbackWidth || 82;
    const height = control.offsetHeight || options.fallbackHeight || 34;
    const candidates = buildSaveControlCandidates(targetRect, hostRect, width, height, {
      centered: options.centered,
      host,
    });
    const pageControlRects = getNearbyPageControlRects(target);
    const viewportBounds = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };

    const safeCandidate = candidates.find((candidate) => {
      const viewportRect = toViewportRect(host, candidate.left, candidate.top, width, height);
      if (!rectFitsInside(viewportRect, viewportBounds, 1)) return false;
      return pageControlRects.every(
        (controlRect) => !rectsOverlap(viewportRect, controlRect, PAGE_CONTROL_CLEARANCE),
      );
    });

    if (!safeCandidate) return false;

    const nextLeft = `${Math.round(safeCandidate.left)}px`;
    const nextTop = `${Math.round(safeCandidate.top)}px`;
    if (control.style.left !== nextLeft) control.style.left = nextLeft;
    if (control.style.top !== nextTop) control.style.top = nextTop;
    if (control.dataset.stgPlacement !== safeCandidate.placement) {
      control.dataset.stgPlacement = safeCandidate.placement;
    }
    return true;
  }

  // Pin a popover to the viewport (position: fixed) anchored to the badge.
  // Used so the save/collection popover is never clipped by a small thumbnail's
  // container bounds. Prefers opening above the badge with right edges aligned,
  // flips below when there isn't room, and clamps to the viewport on all sides.
  function positionFloatingPopover(popover, anchor) {
    if (!popover || !anchor) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 278;
    const height = popover.offsetHeight || 0;

    // Right-align the popover with the badge (matches the old bottom-right anchor).
    let left = rect.right - width;
    // Prefer above the badge; flip below if it would overflow the top.
    let top = rect.top - height - margin;
    if (top < margin) {
      const below = rect.bottom + margin;
      // Use whichever side leaves the popover most on-screen.
      top = below + height + margin <= vh ? below : margin;
    }

    left = Math.max(margin, Math.min(left, vw - width - margin));
    top = Math.max(margin, Math.min(top, vh - height - margin));

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  // Mount a popover as a viewport-fixed layer on <body> (escaping the image
  // container) and keep it anchored to the badge while it's open. Returns a
  // teardown that removes the scroll/resize listeners.
  function mountFloatingPopover(popover, anchor) {
    popover.classList.add("stg-popover--floating");
    document.body.appendChild(popover);

    const reposition = () => positionFloatingPopover(popover, anchor);
    reposition();
    requestAnimationFrame(() => {
      reposition();
      popover.classList.add("stg-popover--visible");
    });

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    popover.__stgCleanupFloating = () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }

  async function readSavedFolderIds() {
    try {
      const cfg = await getStorageSync([
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

  // ── Animation / live-action style tag ──

  function normalizeStyleTag(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "animation" || normalized === "live-action"
      ? normalized
      : "";
  }

  async function readStyleTag() {
    try {
      const cfg = await getStorageSync([STYLE_TAG_KEY]);
      return normalizeStyleTag(cfg[STYLE_TAG_KEY]);
    } catch {
      return "";
    }
  }

  function rememberStyleTag(value) {
    setStorageSync({ [STYLE_TAG_KEY]: normalizeStyleTag(value) });
  }

  function withStyleTag(tagNames, styleTag) {
    const tags = Array.isArray(tagNames) ? [...tagNames] : [];
    const tag = normalizeStyleTag(styleTag);
    if (tag && !tags.includes(tag)) tags.push(tag);
    return tags;
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

  function normalizeFolderIdList(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const ids = [];
    for (const value of values) {
      const id = String(value || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  async function loadFolders() {
    try {
      const response = await sendRuntimeMessage({ action: "getFolders" });
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
      const response = await sendRuntimeMessage({
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
      <span class="stg-popover__label">Type</span>
      <div class="stg-type-row" role="radiogroup" aria-label="Animation or live action">
        ${STYLE_TAG_OPTIONS.map(
          (option) =>
            `<button class="stg-type-pill" type="button" data-style-tag="${option.value}" aria-pressed="false">${option.label}</button>`,
        ).join("")}
      </div>
      <div class="stg-popover__collection-head">
        <span class="stg-popover__label">Collections</span>
        <button class="stg-popover__icon-btn stg-popover__new-collection-toggle" type="button" title="New collection">+</button>
      </div>
      <div class="stg-collection-grid" role="listbox" aria-label="Collections" aria-multiselectable="true"></div>
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

    // ── Animation / live-action pills ──
    const typeRow = pop.querySelector(".stg-type-row");
    let selectedStyleTag = "";

    const setSelectedStyleTag = (value) => {
      selectedStyleTag = normalizeStyleTag(value);
      for (const pill of typeRow.querySelectorAll(".stg-type-pill")) {
        const active = (pill.dataset.styleTag || "") === selectedStyleTag;
        pill.classList.toggle("stg-type-pill--active", active);
        pill.setAttribute("aria-pressed", active ? "true" : "false");
      }
    };

    setSelectedStyleTag("");
    void readStyleTag().then(setSelectedStyleTag);

    typeRow.addEventListener("click", (event) => {
      const pill = event.target?.closest?.(".stg-type-pill");
      if (!pill) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedStyleTag(pill.dataset.styleTag || "");
      // Remember immediately — the choice auto-applies to quick saves too.
      rememberStyleTag(selectedStyleTag);
    });

    // ── Collection (folder) cards ──
    let loadedFolders = [];
    let foldersReady = false;
    let rememberedFolderId = "";
    let selectedFolderIds = [];

    const updateSubmitLabel = () => {
      if (selectedFolderIds.length > 1) {
        btn.textContent = `${buttonLabel} to ${selectedFolderIds.length}`;
        return;
      }
      btn.textContent = buttonLabel;
    };

    const setSelectedFolderIds = (nextIds) => {
      selectedFolderIds = normalizeFolderIdList(nextIds);
      const selectedSet = new Set(selectedFolderIds);
      for (const card of collectionGrid.querySelectorAll(".stg-collection-card")) {
        const folderId = card.dataset.folderId || "";
        const isClearCard = card.dataset.clearSelection === "1";
        const selected = isClearCard
          ? selectedFolderIds.length === 0
          : selectedSet.has(folderId);
        card.classList.toggle("stg-collection-card--selected", selected);
        card.setAttribute("aria-selected", selected ? "true" : "false");
      }
      updateSubmitLabel();
    };

    const submitWithFolders = (remember = true) => {
      const prompt = textarea.value.trim();
      if (!allowEmptyPrompt && !prompt) {
        textarea.focus();
        return;
      }
      const normalizedFolderIds = normalizeFolderIdList(selectedFolderIds);
      const normalizedFolderId = normalizedFolderIds[0] || "";
      if (remember) {
        setStorageSync({ [LAST_FOLDER_ID_KEY]: normalizedFolderId });
      }
      onSubmit({
        promptText: prompt,
        folderId: normalizedFolderId || undefined,
        folderIds: normalizedFolderIds,
        styleTag: selectedStyleTag,
      });
      onClose();
    };

    const appendCollectionCard = ({ folderId = "", eyebrow, label, variant = "", clear = false }) => {
      const card = document.createElement("button");
      card.className = `stg-collection-card ${variant}`.trim();
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.dataset.folderId = folderId;
      if (clear) card.dataset.clearSelection = "1";

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
        if (card.dataset.clearSelection === "1") {
          setSelectedFolderIds([]);
          return;
        }
        const folderId = card.dataset.folderId || "";
        const selected = new Set(selectedFolderIds);
        if (selected.has(folderId)) {
          selected.delete(folderId);
        } else {
          selected.add(folderId);
        }
        setSelectedFolderIds([...selected]);
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
      const activeSelectedId = folders.some((folder) => folder.id === selectedId)
        ? selectedId
        : "";
      appendCollectionCard({
        folderId: "",
        eyebrow: "Loose",
        label: "No collection",
        clear: true,
      });
      for (const folder of folders) {
        appendCollectionCard({
          folderId: folder.id,
          eyebrow: folder.id === activeSelectedId ? "Default" : "Collection",
          label: folder.name,
          variant: folder.id === activeSelectedId ? "stg-collection-card--default" : "",
        });
      }
      setSelectedFolderIds(activeSelectedId ? [activeSelectedId] : []);
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
      const previousSelectedFolderIds = selectedFolderIds;
      renderCollectionCards(loadedFolders, newId);
      setSelectedFolderIds([...previousSelectedFolderIds, newId]);
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
      submitWithFolders();
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
    if (!badge.isConnected) return;

    badge.classList.remove("stg-badge--visible");

    const popover = createErrorPopover(message, () => {
      popover.classList.remove("stg-popover--visible");
      popover.__stgCleanupFloating?.();
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

    mountFloatingPopover(popover, badge);
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
    folderIds,
    modelName,
    tagNames,
    fileData,
    imageWidth,
    imageHeight,
    sourceUrl,
    topRight = false,
  }) {
    badge.innerHTML = `<span>Saving…</span>`;
    badge.classList.add("stg-badge--saving");
    if (topRight) badge.classList.add("stg-badge--top-right");

    try {
      let response;
      try {
        response = await sendRuntimeMessage({
          action: "saveImage",
          imageUrl,
          // Item-specific permalink (e.g. the pin URL) beats the feed URL.
          sourceUrl: sourceUrl || location.href,
          pageTitle: document.title,
          promptText: promptText || undefined,
          modelName: modelName || undefined,
          folderId: folderId || undefined,
          folderIds: normalizeFolderIdList(folderIds),
          tagNames: Array.isArray(tagNames) ? tagNames : undefined,
          file: fileData || undefined,
          imageWidth: imageWidth || undefined,
          imageHeight: imageHeight || undefined,
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
    if (!badge.isConnected) return;

    badge.classList.remove("stg-badge--visible");

    const popover = createPopover(
      async ({ promptText, folderId, folderIds, styleTag }) => {
        let fileData = saveContext.fileData;
        if (!fileData && typeof saveContext.resolveFileData === "function") {
          fileData = await saveContext.resolveFileData();
        }
        await submitImageSave({
          badge,
          imageUrl: saveContext.imageUrl,
          promptText,
          folderId,
          folderIds,
          modelName: saveContext.modelName,
          tagNames: withStyleTag(saveContext.tagNames, styleTag),
          fileData,
          imageWidth: saveContext.imageWidth,
          imageHeight: saveContext.imageHeight,
          sourceUrl: saveContext.sourceUrl,
          topRight,
        });
      },
      () => {
        popover.classList.remove("stg-popover--visible");
        popover.__stgCleanupFloating?.();
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

    mountFloatingPopover(popover, badge);
  }

  // Intrinsic dimensions of a displayed <img>. The browser knows these for
  // every format (incl. webp/avif the server decoder may choke on), and the
  // aspect ratio is identical across resolutions, so this fixes 1:1-cropped
  // masonry slots for extension saves.
  function getNaturalDimensions(el) {
    const w = Number(el?.naturalWidth) || 0;
    const h = Number(el?.naturalHeight) || 0;
    if (w > 0 && h > 0) return { imageWidth: w, imageHeight: h };
    return {};
  }

  async function handleSave(img, badge) {
    let imageUrl = resolveAbsoluteUrl(getImageUrl(img));
    if (!imageUrl) return;
    const { imageWidth, imageHeight } = getNaturalDimensions(img);

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
      imageWidth,
      imageHeight,
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
    const styleTag = await readStyleTag();

    let response;
    try {
      response = await sendRuntimeMessage({
        action: "saveImage",
        imageUrl,
        sourceUrl,
        pageTitle: document.title,
        folderId: folderId || undefined,
        tagNames: styleTag ? [styleTag] : undefined,
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

    for (const node of document.querySelectorAll(
      ".stg-badge, .stg-popover, .stg-mj-liked-nav, .stg-mj-quick-save, .stg-mj-notes, .stg-mj-notes-layer",
    )) {
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

    for (const host of document.querySelectorAll("[data-stg-mj-host-prepared]")) {
      if (host.dataset.stgMjHostPositioned === "1") {
        host.style.position = "";
      }
      delete host.dataset.stgMjHostPrepared;
      delete host.dataset.stgMjHostPositioned;
    }

    clearMidjourneyLikedNavigation();
    clearMidjourneyNotes();
  }

  function setExtensionEnabled(nextEnabled) {
    extensionEnabled = Boolean(nextEnabled);
    if (!extensionEnabled) {
      clearInjectedUi();
    } else if (isPersistentSaveSite()) {
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
    void getStorageSync([DISABLED_HOSTS_KEY]).then((cfg) => {
      const disabledHosts = normalizeDisabledHosts(cfg[DISABLED_HOSTS_KEY]);
      const enabled = !isHostDisabled(disabledHosts, currentHost);
      setExtensionEnabled(enabled);
      configLoaded = true;
      onComplete?.(enabled);
    }).catch((err) => {
      console.warn("[Save to Gallery] Could not read site state:", err);
      setExtensionEnabled(false);
      configLoaded = true;
      onComplete?.(false);
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
    if (!positionSaveControlAvoidingPageUi(badge, img, parent, {
      fallbackWidth: 82,
      fallbackHeight: 32,
    })) {
      badge.remove();
      img.removeAttribute(BADGE_ATTR);
      return;
    }

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
    if (!positionSaveControlAvoidingPageUi(badge, thumb, card, {
      fallbackWidth: 82,
      fallbackHeight: 32,
    })) {
      badge.remove();
      card.removeAttribute(MJ_GRID_BADGE_ATTR);
      return;
    }

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
    const { imageWidth, imageHeight } = getNaturalDimensions(thumb);

    showSavePopover(badge, {
      imageUrl,
      promptText: promptText || "",
      modelName: "Midjourney",
      imageWidth,
      imageHeight,
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
  let midjourneyLikedNavControl = null;
  let midjourneyLikedOnlyEnabled = false;

  function isMidjourneyTeachPage() {
    return location.pathname.includes("/personalize/") &&
      location.pathname.includes("/teach");
  }

  function isMidjourneyImaginePage() {
    return location.pathname.includes("/imagine") || location.pathname.includes("/create");
  }

  function isMidjourneyJobPage() {
    return /^\/jobs\//.test(location.pathname);
  }

  function isMidjourneyCreateExperiencePage() {
    return isMidjourneyImaginePage() || isMidjourneyJobPage();
  }

  function isMidjourneyLikedNavEligiblePage() {
    return isMidjourneyPage() && isMidjourneyImaginePage();
  }

  function isLikelyCloseControl(element) {
    if (!element || element.closest?.(EXTENSION_UI_SELECTOR)) return false;
    const label = [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    return label === "×" ||
      label === "x" ||
      label.includes("close") ||
      label.includes("dismiss");
  }

  function hasVisibleMidjourneyViewerCloseControl() {
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .some((control) => isLikelyCloseControl(control) && isVisibleElement(control));
  }

  function hasLargeVisibleMidjourneyMedia() {
    return Array.from(document.querySelectorAll(MJ_MEDIA_SELECTOR))
      .some((target) => {
        if (!isVisibleElement(target)) return false;
        const rect = target.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.34 &&
          rect.height >= window.innerHeight * 0.24 &&
          rect.bottom > 80 &&
          rect.top < window.innerHeight - 80;
      });
  }

  function hasVisibleMidjourneyCreateDetailPanel() {
    const bodyText = document.body?.innerText || "";
    if (!bodyText.includes("Creation Actions")) return false;

    return bodyText.includes("Help us improve") ||
      (bodyText.includes("Vary") && bodyText.includes("Remix") && bodyText.includes("Use"));
  }

  function isMidjourneyFullSizeViewerOpen() {
    if (!isMidjourneyPage() || !isMidjourneyCreateExperiencePage()) return false;
    if (isMidjourneyJobPage()) return true;
    if (document.querySelector('[aria-modal="true"], [role="dialog"]')) return true;
    if (hasVisibleMidjourneyCreateDetailPanel()) return true;
    if (!hasVisibleMidjourneyViewerCloseControl()) return false;
    return hasLargeVisibleMidjourneyMedia();
  }

  function suppressMidjourneySaveUiForViewer() {
    if (!isMidjourneyFullSizeViewerOpen()) return false;
    clearInjectedUi();
    return true;
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

  // ── Krea adapter glue ──

  function isQualifiedKreaMediaTarget(target) {
    if (!target || target.closest?.(EXTENSION_UI_SELECTOR)) return false;
    if (!kreaAdapter?.isQualifiedMediaElement) return false;
    return kreaAdapter.isQualifiedMediaElement(target, {
      badgeAttr: MJ_MEDIA_BADGE_ATTR,
    });
  }

  function getKreaSaveContext(target) {
    const rawImageUrl = kreaAdapter?.getMediaUrl ? kreaAdapter.getMediaUrl(target) : "";
    if (!rawImageUrl) return null;

    return {
      imageUrl: resolveAbsoluteUrl(rawImageUrl),
      promptText: kreaAdapter?.extractPrompt
        ? kreaAdapter.extractPrompt(target, document)
        : "",
      modelName: "Krea",
      tagNames: kreaAdapter?.getTagNames
        ? kreaAdapter.getTagNames(location.pathname)
        : ["krea"],
      ...getNaturalDimensions(target),
    };
  }

  // ── Pinterest adapter glue ──

  function isQualifiedPinterestMediaTarget(target) {
    if (!target || target.closest?.(EXTENSION_UI_SELECTOR)) return false;
    if (!pinterestAdapter?.isQualifiedMediaElement) return false;
    return pinterestAdapter.isQualifiedMediaElement(target, {
      badgeAttr: MJ_MEDIA_BADGE_ATTR,
    });
  }

  function getPinterestSaveContext(target) {
    const rawImageUrl = pinterestAdapter?.getMediaUrl
      ? pinterestAdapter.getMediaUrl(target)
      : "";
    if (!rawImageUrl) return null;

    return {
      imageUrl: resolveAbsoluteUrl(rawImageUrl),
      promptText: pinterestAdapter?.extractDescription
        ? pinterestAdapter.extractDescription(target, document)
        : "",
      // Pins are references, not generations — no model name.
      modelName: undefined,
      tagNames: pinterestAdapter?.getTagNames
        ? pinterestAdapter.getTagNames()
        : ["pinterest"],
      sourceUrl: pinterestAdapter?.getPinUrl
        ? pinterestAdapter.getPinUrl(target) || undefined
        : undefined,
      ...getNaturalDimensions(target),
    };
  }

  // ── ShotDeck adapter glue ──

  function isQualifiedShotdeckMediaTarget(target) {
    if (!target || target.closest?.(EXTENSION_UI_SELECTOR)) return false;
    if (!shotdeckAdapter?.isQualifiedMediaElement) return false;
    return shotdeckAdapter.isQualifiedMediaElement(target, {
      badgeAttr: MJ_MEDIA_BADGE_ATTR,
    });
  }

  function getShotdeckSaveContext(target) {
    const rawImageUrl = shotdeckAdapter?.getMediaUrl
      ? shotdeckAdapter.getMediaUrl(target)
      : "";
    if (!rawImageUrl) return null;

    return {
      imageUrl: resolveAbsoluteUrl(rawImageUrl),
      promptText: shotdeckAdapter?.extractDescription
        ? shotdeckAdapter.extractDescription(target, document)
        : "",
      // Film stills are references, not generations — no model name.
      modelName: undefined,
      tagNames: shotdeckAdapter?.getTagNames
        ? shotdeckAdapter.getTagNames()
        : ["shotdeck"],
      ...getNaturalDimensions(target),
    };
  }

  function isQualifiedSiteMediaTarget(target) {
    if (isMidjourneyPage()) return isQualifiedMidjourneyMediaTarget(target);
    if (isPinterestPage()) return isQualifiedPinterestMediaTarget(target);
    if (isShotdeckPage()) return isQualifiedShotdeckMediaTarget(target);
    return isQualifiedKreaMediaTarget(target);
  }

  function getSiteSaveContext(target) {
    if (isMidjourneyPage()) return getMidjourneySaveContext(target);
    if (isPinterestPage()) return getPinterestSaveContext(target);
    if (isShotdeckPage()) return getShotdeckSaveContext(target);
    return getKreaSaveContext(target);
  }

  function getMidjourneyWidgetHost(target) {
    if (!target) return null;

    const tagName = target.tagName?.toLowerCase();
    if (tagName === "a" && target.parentElement) {
      return target.parentElement;
    }

    const linkParent = target.closest?.('a[href*="/jobs/"]');
    if (linkParent?.parentElement) {
      return linkParent.parentElement;
    }

    if ((tagName === "img" || tagName === "video") && target.parentElement) {
      return target.parentElement;
    }

    return target;
  }

  function getMidjourneyGenerationCard(target) {
    if (!target || target.closest?.(EXTENSION_UI_SELECTOR)) return null;

    const link = target.matches?.(MJ_GRID_THUMB_SELECTOR)
      ? target
      : target.closest?.(MJ_GRID_THUMB_SELECTOR);
    if (link?.parentElement) return link.parentElement;

    const host = getMidjourneyWidgetHost(target);
    if (!host || host.closest?.(EXTENSION_UI_SELECTOR)) return null;
    return host;
  }

  function getMidjourneyGenerationRowRoot(target, card) {
    if (!target || !card) return card;

    let virtualRow = card.parentElement;
    for (let depth = 0; depth < 8 && virtualRow && virtualRow !== document.body; depth++, virtualRow = virtualRow.parentElement) {
      const styleTop = virtualRow.style?.top || "";
      const styleHeight = virtualRow.style?.height || "";
      const className = String(virtualRow.className || "");
      if (
        className.includes("absolute") &&
        className.includes("grid") &&
        /\d+px/.test(styleTop) &&
        /\d+px/.test(styleHeight)
      ) {
        return virtualRow;
      }
    }

    const cardRect = typeof card.getBoundingClientRect === "function"
      ? card.getBoundingClientRect()
      : null;
    const minRowWidth = Math.max(320, (cardRect?.width || 0) * 1.25);
    const maxReasonableHeight = Math.max(360, (cardRect?.height || 0) * 2.8);

    let node = card.parentElement;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++, node = node.parentElement) {
      if (node.closest?.(EXTENSION_UI_SELECTOR)) break;
      if (!node.contains(card)) continue;

      const text = (node.innerText || node.textContent || "").trim();
      if (!text) continue;

      const hasMidjourneyHistoryText =
        /\b(variation|upscale|rerun|remix|vary|chaos|stylize|profile|preview|draft)\b/i.test(text) ||
        /\bar\s*\d+\s*:\s*\d+/i.test(text);
      if (!hasMidjourneyHistoryText) continue;

      const rect = typeof node.getBoundingClientRect === "function"
        ? node.getBoundingClientRect()
        : null;
      if (!rect || rect.width < minRowWidth) continue;
      if (rect.height > maxReasonableHeight && rect.height > window.innerHeight * 0.65) continue;

      return node;
    }

    return card;
  }

  function getMidjourneyGenerationItems() {
    const seenCards = new Set();
    const items = [];
    for (const target of document.querySelectorAll(MJ_MEDIA_SELECTOR)) {
      const card = getMidjourneyGenerationCard(target);
      if (!card || card.closest?.(EXTENSION_UI_SELECTOR) || seenCards.has(card)) continue;
      seenCards.add(card);
      items.push({
        card,
        row: getMidjourneyGenerationRowRoot(target, card),
      });
    }
    return items;
  }

  function isMidjourneyGenerationLiked(card) {
    if (midjourneyAdapter?.isLikedGenerationElement) {
      return midjourneyAdapter.isLikedGenerationElement(card);
    }

    return Array.from(card.querySelectorAll('button, [role="button"], [title], [aria-label]'))
      .some((control) => {
        const label = [
          control.getAttribute?.("title"),
          control.getAttribute?.("aria-label"),
          control.textContent,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return /\bunlike(?:\s+image)?\b/.test(label);
      });
  }

  function clearMidjourneyLikedNavigation() {
    clearMidjourneyLikedHiddenCards();
    if (midjourneyLikedNavControl) {
      midjourneyLikedNavControl.remove();
      midjourneyLikedNavControl = null;
    }
  }

  function updateMidjourneyLikedNavControl(totalCount, likedCount, statusText) {
    if (!midjourneyLikedNavControl) return;
    const status = midjourneyLikedNavControl.querySelector(".stg-mj-liked-nav__count");
    if (status) status.textContent = statusText || `${likedCount}/${totalCount} visible`;
    midjourneyLikedNavControl.classList.toggle("stg-mj-liked-nav--active", midjourneyLikedOnlyEnabled);
    midjourneyLikedNavControl.setAttribute("aria-pressed", midjourneyLikedOnlyEnabled ? "true" : "false");
    midjourneyLikedNavControl.title = midjourneyLikedOnlyEnabled
      ? "Show all visible Midjourney generations"
      : "Hide unliked visible Midjourney generations";
  }

  function clearMidjourneyLikedHiddenCards() {
    for (const node of document.querySelectorAll(`[${MJ_LIKED_FILTER_HIDDEN_ATTR}]`)) {
      node.removeAttribute(MJ_LIKED_FILTER_HIDDEN_ATTR);
    }
  }

  function applyMidjourneyLikedOnlyFilter(items) {
    if (!midjourneyLikedOnlyEnabled) {
      clearMidjourneyLikedHiddenCards();
      return;
    }

    const visibleItems = items || getMidjourneyGenerationItems();
    for (const { card } of visibleItems) {
      if (isMidjourneyGenerationLiked(card)) {
        card.removeAttribute(MJ_LIKED_FILTER_HIDDEN_ATTR);
      } else {
        card.setAttribute(MJ_LIKED_FILTER_HIDDEN_ATTR, "1");
      }
    }
  }

  function ensureMidjourneyLikedNavControl() {
    if (!isMidjourneyLikedNavEligiblePage() || !extensionEnabled) {
      clearMidjourneyLikedNavigation();
      return null;
    }
    if (midjourneyLikedNavControl && document.contains(midjourneyLikedNavControl)) {
      return midjourneyLikedNavControl;
    }

    const control = document.createElement("button");
    control.className = "stg-mj-liked-nav";
    control.type = "button";
    control.setAttribute("aria-label", "Show only liked Midjourney generations");
    control.setAttribute("aria-pressed", "false");
    control.innerHTML = `
      <span class="stg-mj-liked-nav__icon">&hearts;</span>
      <span class="stg-mj-liked-nav__label">Liked only</span>
      <span class="stg-mj-liked-nav__count">0 visible</span>
    `;
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      midjourneyLikedOnlyEnabled = !midjourneyLikedOnlyEnabled;
      updateMidjourneyLikedNavigation();
    }, true);
    bindExtensionUiEventShield(control);
    document.body.appendChild(control);
    midjourneyLikedNavControl = control;
    return control;
  }

  function updateMidjourneyLikedNavigation(statusText) {
    if (!isMidjourneyLikedNavEligiblePage() || !extensionEnabled) {
      clearMidjourneyLikedNavigation();
      return;
    }

    ensureMidjourneyLikedNavControl();
    const items = getMidjourneyGenerationItems();
    const likedCount = items.filter(({ card }) => isMidjourneyGenerationLiked(card)).length;
    applyMidjourneyLikedOnlyFilter(items);
    updateMidjourneyLikedNavControl(items.length, likedCount, statusText);
  }

  // ── Midjourney notes / scroll bookmarks ──
  //
  // Drop a labeled note anywhere in the create feed. Each note renders as a
  // flag on the right edge that tracks its position as you scroll (so you see
  // it while scrolling past), and lists in a floating panel that jumps you back
  // to that spot. Notes persist per-host in chrome.storage.local.

  const MJ_NOTES_STORAGE_PREFIX = "mjNotes:";
  let midjourneyNotes = [];
  let midjourneyNotesLoaded = false;
  let midjourneyNotesLoading = false;
  let midjourneyNotesPanel = null;
  let midjourneyNotesLayer = null;
  let midjourneyNotesOpen = false; // revealed by hover
  let midjourneyNotesPinned = false; // kept open by click
  let midjourneyNotesHoverTimer = null;
  let midjourneyNotesScrollBound = false;
  let midjourneyNotesRafPending = false;

  function isMidjourneyNotesEligiblePage() {
    return (
      isMidjourneyPage() &&
      isMidjourneyImaginePage() &&
      !isMidjourneyFullSizeViewerOpen()
    );
  }

  function getMidjourneyNotesStorageKey() {
    return `${MJ_NOTES_STORAGE_PREFIX}${location.hostname}`;
  }

  function makeMidjourneyNoteId() {
    return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeStoredNotes(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const text = String(raw.text || "").trim();
        if (!text) return null;
        return {
          id: String(raw.id || makeMidjourneyNoteId()),
          text: text.slice(0, 400),
          scrollTop: Number.isFinite(raw.scrollTop) ? raw.scrollTop : 0,
          anchorHref: typeof raw.anchorHref === "string" ? raw.anchorHref : "",
          createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
        };
      })
      .filter(Boolean);
  }

  function loadMidjourneyNotes() {
    if (midjourneyNotesLoaded || midjourneyNotesLoading) return;
    midjourneyNotesLoading = true;
    const key = getMidjourneyNotesStorageKey();
    void getStorageLocal([key])
      .then((cfg) => {
        midjourneyNotes = normalizeStoredNotes(cfg[key]);
        midjourneyNotesLoaded = true;
        midjourneyNotesLoading = false;
        if (isMidjourneyNotesEligiblePage() && extensionEnabled) {
          updateMidjourneyNotes();
        }
      })
      .catch((err) => {
        console.warn("[Save to Gallery] Could not load Midjourney notes:", err);
        midjourneyNotesLoaded = true;
        midjourneyNotesLoading = false;
      });
  }

  function persistMidjourneyNotes() {
    setStorageLocal({ [getMidjourneyNotesStorageKey()]: midjourneyNotes });
  }

  let midjourneyScrollContainerCache = null;

  // Prefer the nearest scrollable ancestor of the feed's media; fall back to
  // the document scroller. MJ's create feed scrolls an inner container, but
  // some layouts scroll the window — handle both uniformly. Cached because the
  // rAF scroll handler calls this every frame.
  function getMidjourneyScrollContainer() {
    if (
      midjourneyScrollContainerCache &&
      (isWindowScroller(midjourneyScrollContainerCache) ||
        document.contains(midjourneyScrollContainerCache))
    ) {
      return midjourneyScrollContainerCache;
    }

    const sample =
      document.querySelector(MJ_GRID_THUMB_SELECTOR) ||
      document.querySelector('img[src*="cdn.midjourney.com"]');
    let node = sample;
    for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      const canScroll = node.scrollHeight - node.clientHeight > 40;
      if (!canScroll) continue;
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        midjourneyScrollContainerCache = node;
        return node;
      }
    }
    midjourneyScrollContainerCache = document.scrollingElement || document.documentElement;
    return midjourneyScrollContainerCache;
  }

  function isWindowScroller(container) {
    return (
      !container ||
      container === document.scrollingElement ||
      container === document.documentElement ||
      container === document.body
    );
  }

  function getMidjourneyScrollMetrics(container) {
    if (isWindowScroller(container)) {
      return {
        scrollTop: window.scrollY || document.documentElement.scrollTop || 0,
        top: 0,
        bottom: window.innerHeight,
        right: window.innerWidth,
      };
    }
    const rect = container.getBoundingClientRect();
    return {
      scrollTop: container.scrollTop || 0,
      top: rect.top,
      bottom: rect.bottom,
      right: rect.right,
    };
  }

  function findMidjourneyAnchorHrefNearCenter() {
    const centerY = window.innerHeight / 2;
    let best = "";
    let bestDist = Infinity;
    for (const link of document.querySelectorAll(MJ_GRID_THUMB_SELECTOR)) {
      const rect = link.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const mid = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(mid - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/jobs\/[A-Za-z0-9_-]+/);
        best = match ? match[0] : "";
      }
    }
    return best;
  }

  // Resolve a note's live content offset. If its anchored generation is
  // currently in the DOM, use that element's real position (survives feed
  // drift as new generations prepend); otherwise fall back to the raw offset.
  function resolveMidjourneyNoteOffset(note, metrics) {
    if (note.anchorHref) {
      const el = document.querySelector(
        `${MJ_GRID_THUMB_SELECTOR}[href*="${note.anchorHref}"]`,
      );
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0) {
          return metrics.scrollTop + (rect.top - metrics.top);
        }
      }
    }
    return note.scrollTop;
  }

  function scrollMidjourneyContainerTo(container, top) {
    const target = Math.max(0, top);
    if (isWindowScroller(container)) {
      window.scrollTo({ top: target, behavior: "smooth" });
    } else if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: target, behavior: "smooth" });
    } else {
      container.scrollTop = target;
    }
  }

  function jumpToMidjourneyNote(note) {
    try {
      // Primary path: scroll the note's anchored generation into view. The
      // browser resolves whatever ancestor actually scrolls, so this is robust
      // to MJ's changing scroll-container structure and to feed drift (new
      // generations prepending). Manual scrollTop math was the failure mode —
      // it targeted a detected container that isn't always the real scroller.
      if (note.anchorHref) {
        const el = document.querySelector(
          `${MJ_GRID_THUMB_SELECTOR}[href*="${note.anchorHref}"]`,
        );
        if (el && el.getBoundingClientRect().height > 0) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
      // Fallback: the anchored generation is no longer in the DOM (virtualized
      // away). Best-effort scroll of the detected container to the raw offset.
      const container = getMidjourneyScrollContainer();
      const metrics = getMidjourneyScrollMetrics(container);
      const offset = resolveMidjourneyNoteOffset(note, metrics);
      scrollMidjourneyContainerTo(container, offset - 16);
    } catch (err) {
      console.warn("[Save to Gallery] Jump to note failed:", err);
    }
  }

  function addMidjourneyNote(text) {
    const clean = String(text || "").trim().slice(0, 400);
    if (!clean) return;
    const container = getMidjourneyScrollContainer();
    const metrics = getMidjourneyScrollMetrics(container);
    midjourneyNotes.push({
      id: makeMidjourneyNoteId(),
      text: clean,
      scrollTop: metrics.scrollTop,
      anchorHref: findMidjourneyAnchorHrefNearCenter(),
      createdAt: Date.now(),
    });
    persistMidjourneyNotes();
    updateMidjourneyNotes();
  }

  function removeMidjourneyNote(id) {
    const before = midjourneyNotes.length;
    midjourneyNotes = midjourneyNotes.filter((note) => note.id !== id);
    if (midjourneyNotes.length !== before) {
      persistMidjourneyNotes();
      updateMidjourneyNotes();
    }
  }

  function clearMidjourneyNotesUi() {
    if (midjourneyNotesPanel) {
      midjourneyNotesPanel.remove();
      midjourneyNotesPanel = null;
    }
    if (midjourneyNotesLayer) {
      midjourneyNotesLayer.remove();
      midjourneyNotesLayer = null;
    }
  }

  function cancelMidjourneyNotesHoverClose() {
    if (midjourneyNotesHoverTimer !== null) {
      clearTimeout(midjourneyNotesHoverTimer);
      midjourneyNotesHoverTimer = null;
    }
  }

  function openMidjourneyNotesHover() {
    cancelMidjourneyNotesHoverClose();
    if (midjourneyNotesOpen) return;
    midjourneyNotesOpen = true;
    applyMidjourneyNotesOpenState();
  }

  function scheduleMidjourneyNotesHoverClose() {
    cancelMidjourneyNotesHoverClose();
    midjourneyNotesHoverTimer = setTimeout(() => {
      midjourneyNotesHoverTimer = null;
      // Never hover-close while pinned or while the composer is focused.
      if (midjourneyNotesPinned) return;
      const active = midjourneyNotesPanel?.contains(document.activeElement);
      if (active) return;
      midjourneyNotesOpen = false;
      applyMidjourneyNotesOpenState();
    }, 320);
  }

  function buildMidjourneyNotesPanel() {
    const root = document.createElement("div");
    root.className = "stg-mj-notes";
    root.innerHTML = `
      <div class="stg-mj-notes__hotzone" aria-hidden="true"></div>
      <button type="button" class="stg-mj-notes__handle" aria-expanded="false"
        aria-label="Feed notes" title="Feed notes — hover to open, click to pin">
        <span class="stg-mj-notes__handle-icon">✎</span>
        <span class="stg-mj-notes__count">0</span>
      </button>
      <div class="stg-mj-notes__panel" role="dialog" aria-label="Feed notes">
        <div class="stg-mj-notes__head">
          <span class="stg-mj-notes__head-title">Notes</span>
          <span class="stg-mj-notes__count">0</span>
        </div>
        <div class="stg-mj-notes__list"></div>
        <div class="stg-mj-notes__compose">
          <textarea class="stg-mj-notes__input" rows="2" maxlength="400"
            placeholder="Note this spot…"></textarea>
          <div class="stg-mj-notes__compose-actions">
            <button type="button" class="stg-mj-notes__save">Add note here</button>
          </div>
        </div>
      </div>
    `;

    const hotzone = root.querySelector(".stg-mj-notes__hotzone");
    const handle = root.querySelector(".stg-mj-notes__handle");
    const panel = root.querySelector(".stg-mj-notes__panel");
    const input = root.querySelector(".stg-mj-notes__input");
    const saveBtn = root.querySelector(".stg-mj-notes__save");
    const list = root.querySelector(".stg-mj-notes__list");

    // Reveal on right-edge hover; keep open while the pointer is over the
    // handle or panel; a grace timer bridges the gap between them.
    hotzone.addEventListener("pointerenter", openMidjourneyNotesHover);
    handle.addEventListener("pointerenter", openMidjourneyNotesHover);
    panel.addEventListener("pointerenter", cancelMidjourneyNotesHoverClose);
    for (const el of [hotzone, handle, panel]) {
      el.addEventListener("pointerleave", scheduleMidjourneyNotesHoverClose);
    }

    // Click the handle to PIN the panel open (so you can add/manage notes
    // without holding the hover); click again to unpin.
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      midjourneyNotesPinned = !midjourneyNotesPinned;
      midjourneyNotesOpen = midjourneyNotesPinned || midjourneyNotesOpen;
      applyMidjourneyNotesOpenState();
      if (midjourneyNotesPinned) setTimeout(() => input?.focus(), 0);
    }, true);

    const commit = () => {
      const value = input.value;
      addMidjourneyNote(value);
      input.value = "";
      setTimeout(() => input?.focus(), 0);
    };

    saveBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }, true);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (event.key === "Escape") {
        input.value = "";
        input.blur();
      }
    });

    list.addEventListener("click", (event) => {
      const row = event.target.closest?.("[data-note-id]");
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const id = row.dataset.noteId;
      if (event.target.closest(".stg-mj-notes__delete")) {
        removeMidjourneyNote(id);
        return;
      }
      const note = midjourneyNotes.find((n) => n.id === id);
      if (note) jumpToMidjourneyNote(note);
    }, true);

    bindExtensionUiEventShield(root);
    return root;
  }

  function applyMidjourneyNotesOpenState() {
    if (!midjourneyNotesPanel) return;
    const handle = midjourneyNotesPanel.querySelector(".stg-mj-notes__handle");
    const open = midjourneyNotesOpen || midjourneyNotesPinned;
    if (handle) handle.setAttribute("aria-expanded", open ? "true" : "false");
    midjourneyNotesPanel.classList.toggle("stg-mj-notes--open", open);
    midjourneyNotesPanel.classList.toggle("stg-mj-notes--pinned", midjourneyNotesPinned);
    // Hide the scroll-position markers while the panel is open (the list
    // covers the same right edge).
    if (midjourneyNotesLayer) {
      midjourneyNotesLayer.classList.toggle("stg-mj-notes-layer--dimmed", open);
    }
  }

  function ensureMidjourneyNotesUi() {
    if (!midjourneyNotesLayer || !document.contains(midjourneyNotesLayer)) {
      const layer = document.createElement("div");
      layer.className = "stg-mj-notes-layer";
      document.body.appendChild(layer);
      midjourneyNotesLayer = layer;
    }
    if (!midjourneyNotesPanel || !document.contains(midjourneyNotesPanel)) {
      midjourneyNotesPanel = buildMidjourneyNotesPanel();
      document.body.appendChild(midjourneyNotesPanel);
      applyMidjourneyNotesOpenState();
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMidjourneyNotesList() {
    if (!midjourneyNotesPanel) return;
    for (const count of midjourneyNotesPanel.querySelectorAll(".stg-mj-notes__count")) {
      count.textContent = String(midjourneyNotes.length);
      count.classList.toggle("stg-mj-notes__count--empty", midjourneyNotes.length === 0);
    }
    const list = midjourneyNotesPanel.querySelector(".stg-mj-notes__list");
    if (!list) return;

    if (midjourneyNotes.length === 0) {
      list.innerHTML = `<div class="stg-mj-notes__empty">No notes yet. Scroll to a spot and add one.</div>`;
      return;
    }

    list.innerHTML = midjourneyNotes
      .map(
        (note) => `
        <div class="stg-mj-notes__row" data-note-id="${escapeHtml(note.id)}" role="button" tabindex="0" title="Jump to this note">
          <span class="stg-mj-notes__row-text">${escapeHtml(note.text)}</span>
          <button type="button" class="stg-mj-notes__delete" aria-label="Delete note">×</button>
        </div>
      `,
      )
      .join("");
  }

  function renderMidjourneyNoteMarkers() {
    if (!midjourneyNotesLayer) return;
    midjourneyNotesLayer.innerHTML = midjourneyNotes
      .map(
        (note) => `
        <button type="button" class="stg-mj-note-marker" data-note-id="${escapeHtml(note.id)}" title="${escapeHtml(note.text)}">
          <span class="stg-mj-note-marker__dot"></span>
          <span class="stg-mj-note-marker__text">${escapeHtml(note.text)}</span>
        </button>
      `,
      )
      .join("");

    for (const marker of midjourneyNotesLayer.querySelectorAll(".stg-mj-note-marker")) {
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const note = midjourneyNotes.find((n) => n.id === marker.dataset.noteId);
        if (note) jumpToMidjourneyNote(note);
      }, true);
      bindExtensionUiEventShield(marker);
    }

    positionMidjourneyNoteMarkers();
  }

  function positionMidjourneyNoteMarkers() {
    if (!midjourneyNotesLayer) return;
    const container = getMidjourneyScrollContainer();
    const metrics = getMidjourneyScrollMetrics(container);
    const topBound = metrics.top + 8;
    const bottomBound = metrics.bottom - 8;

    for (const marker of midjourneyNotesLayer.querySelectorAll(".stg-mj-note-marker")) {
      const note = midjourneyNotes.find((n) => n.id === marker.dataset.noteId);
      if (!note) {
        marker.style.display = "none";
        continue;
      }
      const offset = resolveMidjourneyNoteOffset(note, metrics);
      const y = metrics.top + (offset - metrics.scrollTop);
      if (y < topBound || y > bottomBound) {
        marker.style.display = "none";
        continue;
      }
      marker.style.display = "flex";
      marker.style.top = `${Math.round(y)}px`;
    }
  }

  function scheduleMidjourneyNoteMarkerReposition() {
    if (midjourneyNotesRafPending) return;
    midjourneyNotesRafPending = true;
    requestAnimationFrame(() => {
      midjourneyNotesRafPending = false;
      if (midjourneyNotesLayer) positionMidjourneyNoteMarkers();
    });
  }

  function bindMidjourneyNotesScrollListeners() {
    if (midjourneyNotesScrollBound) return;
    midjourneyNotesScrollBound = true;
    // Capture=true catches scroll from any inner container, not just window.
    window.addEventListener("scroll", scheduleMidjourneyNoteMarkerReposition, true);
    window.addEventListener("resize", scheduleMidjourneyNoteMarkerReposition, { passive: true });
  }

  // Full render — rebuilds the notes list + marker DOM. Only call on an actual
  // notes DATA change (add / remove / initial load), never from the media scan.
  function updateMidjourneyNotes() {
    if (!isMidjourneyNotesEligiblePage() || !extensionEnabled) {
      clearMidjourneyNotesUi();
      return;
    }
    if (!midjourneyNotesLoaded) {
      loadMidjourneyNotes();
      return;
    }
    ensureMidjourneyNotesUi();
    bindMidjourneyNotesScrollListeners();
    renderMidjourneyNotesList();
    renderMidjourneyNoteMarkers();
  }

  // Cheap, idempotent path for the high-frequency media scan. The scan fires on
  // every MJ feed mutation (~12x/s), so it must NOT rebuild the notes DOM —
  // doing so recreated the markers and list on every tick and made them
  // flicker. Instead: make sure the UI is mounted, and only (re)render note DOM
  // when it was actually just (re)created; otherwise just reposition the markers
  // (style-only, no DOM churn).
  function syncMidjourneyNotesPresence() {
    if (!isMidjourneyNotesEligiblePage() || !extensionEnabled) {
      clearMidjourneyNotesUi();
      return;
    }
    if (!midjourneyNotesLoaded) {
      loadMidjourneyNotes();
      return;
    }
    const panelExisted =
      Boolean(midjourneyNotesPanel) && document.contains(midjourneyNotesPanel);
    const layerExisted =
      Boolean(midjourneyNotesLayer) && document.contains(midjourneyNotesLayer);
    ensureMidjourneyNotesUi();
    bindMidjourneyNotesScrollListeners();
    if (!panelExisted) renderMidjourneyNotesList();
    if (!layerExisted) {
      renderMidjourneyNoteMarkers();
    } else {
      scheduleMidjourneyNoteMarkerReposition();
    }
  }

  function clearMidjourneyNotes() {
    clearMidjourneyNotesUi();
  }

  function prepareMidjourneyWidgetHost(host) {
    if (!host || host.nodeType !== Node.ELEMENT_NODE) return;
    if (host.dataset.stgMjHostPrepared === "1") return;

    const position = getComputedStyle(host).position;
    if (position === "static") {
      host.style.position = "relative";
      host.dataset.stgMjHostPositioned = "1";
    }
    host.dataset.stgMjHostPrepared = "1";
  }

  function positionMidjourneyWidget(widget, target) {
    if (!target || !document.contains(target)) {
      widget.remove();
      return;
    }

    // Freeze the widget while the user is on it (or its host, or its open
    // menu). MJ mutates the feed constantly, so the scan keeps firing during
    // hover — repositioning/reparenting mid-approach resets the CSS hover
    // reveal and yanks the widget away from the cursor.
    const interacting =
      widget.classList.contains("stg-mj-quick-save--menu-open") ||
      (widget.isConnected && widget.matches(":hover")) ||
      Boolean(widget.parentElement?.matches?.(":hover"));
    if (interacting) return;

    const host = getMidjourneyWidgetHost(target);
    if (!host || !document.contains(host)) {
      widget.remove();
      return;
    }

    prepareMidjourneyWidgetHost(host);
    if (widget.parentElement !== host) {
      host.appendChild(widget);
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 ||
        rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
      if (widget.style.display !== "none") widget.style.display = "none";
      return;
    }

    if (widget.style.display !== "flex") widget.style.display = "flex";
    const isCentered = isMidjourneyImaginePage();
    // Hover-reveal keeps dense grids and workspaces uncluttered — the widget
    // only shows while its host media is hovered.
    const hoverReveal =
      isCentered || isKreaPage() || isPinterestPage() || isShotdeckPage();
    widget.classList.toggle("stg-mj-quick-save--centered", isCentered);
    widget.classList.toggle("stg-mj-quick-save--hover-reveal", hoverReveal);
    const placed = positionSaveControlAvoidingPageUi(widget, target, host, {
      centered: isCentered,
      display: "flex",
      fallbackWidth: 98,
      fallbackHeight: 36,
    });
    if (!placed) {
      // No safe spot THIS tick. If the widget was placed before, keep that
      // placement — MJ's own controls appear/disappear during feed re-renders,
      // and hiding for one tick then re-showing reads as flicker.
      if (!widget.dataset.stgPlacement) {
        if (widget.style.display !== "none") widget.style.display = "none";
      }
    }
  }

  function updateMidjourneyWidgetPositions() {
    if (suppressMidjourneySaveUiForViewer()) return;
    for (const widget of document.querySelectorAll(".stg-mj-quick-save")) {
      const target = widget.__stgTarget;
      if (!target || !document.contains(target)) {
        // MJ often swaps a media node out and back within a tick — never
        // yank the widget out from under the cursor mid-click.
        if (widget.matches(":hover")) continue;
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

  async function handleSaveMidjourneyMedia(target, button, folderIds) {
    if (button.classList.contains("stg-badge--saving")) return;

    const saveContext = getSiteSaveContext(target);
    if (!saveContext) {
      console.debug("[Save to Gallery] Image URL unavailable for media target.");
      return;
    }

    let effectiveFolderIds = normalizeFolderIdList(folderIds);
    if (arguments.length < 3) {
      const defaultFolderId = await getDefaultSaveFolderId();
      effectiveFolderIds = defaultFolderId ? [defaultFolderId] : [];
    }

    const fileData = await captureImageBytesForSave(saveContext.imageUrl);
    if (!fileData) {
      console.warn("[Save to Gallery] Midjourney media: failed to capture image bytes, falling back to URL");
    }

    const styleTag = await readStyleTag();
    await submitImageSave({
      badge: button,
      imageUrl: saveContext.imageUrl,
      promptText: saveContext.promptText,
      folderId: effectiveFolderIds[0] || undefined,
      folderIds: effectiveFolderIds,
      modelName: saveContext.modelName,
      tagNames: withStyleTag(saveContext.tagNames, styleTag),
      fileData,
      imageWidth: saveContext.imageWidth,
      imageHeight: saveContext.imageHeight,
      sourceUrl: saveContext.sourceUrl,
      topRight: true,
    });
  }

  function updateMidjourneyMenuSelection(menu, folderIds) {
    const selectedFolderIds = normalizeFolderIdList(folderIds);
    const selectedSet = new Set(selectedFolderIds);
    menu.dataset.selectedFolderIds = JSON.stringify(selectedFolderIds);

    for (const item of menu.querySelectorAll(".stg-mj-menu__item")) {
      const folderId = item.dataset.folderId || "";
      const isClearCard = item.dataset.clearSelection === "1";
      const selected = isClearCard
        ? selectedFolderIds.length === 0
        : selectedSet.has(folderId);
      item.classList.toggle("stg-mj-menu__item--selected", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    }

    const saveButton = menu.querySelector(".stg-mj-menu__save");
    if (saveButton) {
      saveButton.textContent = selectedFolderIds.length > 1
        ? `Save to ${selectedFolderIds.length}`
        : "Save";
    }
  }

  function getMidjourneyMenuSelection(menu) {
    try {
      return normalizeFolderIdList(JSON.parse(menu.dataset.selectedFolderIds || "[]"));
    } catch {
      return [];
    }
  }

  function findFolderIdByName(folders, name) {
    const normalizedName = String(name || "").trim().toLowerCase();
    if (!normalizedName) return "";
    const match = folders.find(
      (folder) => folder.name.toLowerCase() === normalizedName,
    );
    return match ? match.id : "";
  }

  function setMidjourneyNewCollectionError(menu, message) {
    const input = menu.querySelector(".stg-mj-menu__new-input");
    if (!input) return;
    input.value = "";
    input.placeholder = (message || "Failed").slice(0, 40);
  }

  async function createMidjourneyCollectionFromMenu(menu) {
    const input = menu.querySelector(".stg-mj-menu__new-input");
    const createButton = menu.querySelector(".stg-mj-menu__new-create");
    if (!input || !createButton) return;

    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }

    createButton.disabled = true;
    createButton.textContent = "…";
    const previousSelectedFolderIds = getMidjourneyMenuSelection(menu);
    const res = await createFolderRemote(name);
    createButton.disabled = false;
    createButton.textContent = "Add";

    if (!res.ok) {
      setMidjourneyNewCollectionError(menu, res.error);
      return;
    }

    const newId = res.id || findFolderIdByName(res.folders, name);
    renderMidjourneyCollectionMenu(menu, res.folders, newId);
    updateMidjourneyMenuSelection(menu, [...previousSelectedFolderIds, newId]);
    const nextInput = menu.querySelector(".stg-mj-menu__new-input");
    if (nextInput) nextInput.value = "";
  }

  function toggleMidjourneyNewCollectionRow(menu) {
    const row = menu.querySelector(".stg-mj-menu__new");
    const input = menu.querySelector(".stg-mj-menu__new-input");
    if (!row || !input) return;
    if (row.hasAttribute("hidden")) {
      row.removeAttribute("hidden");
      input.focus();
      return;
    }
    row.setAttribute("hidden", "");
  }

  function updateMidjourneyMenuStyleTag(menu, styleTag) {
    const normalized = normalizeStyleTag(styleTag);
    menu.dataset.styleTag = normalized;
    for (const pill of menu.querySelectorAll(".stg-mj-menu__type")) {
      const active = (pill.dataset.styleTag || "") === normalized;
      pill.classList.toggle("stg-mj-menu__type--active", active);
      pill.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function renderMidjourneyCollectionMenu(menu, folders, defaultFolderId) {
    const activeDefaultFolderId = folders.some((folder) => folder.id === defaultFolderId)
      ? defaultFolderId
      : "";
    const rows = [
      {
        id: "__none",
        folderId: "",
        eyebrow: "Loose",
        label: "No collection",
        clear: true,
      },
      ...folders.map((folder) => ({
        id: folder.id,
        folderId: folder.id,
        eyebrow: folder.id === activeDefaultFolderId ? "Default" : "Collection",
        label: folder.name,
      })),
    ];

    menu.innerHTML = "";

    // Animation / live-action pills — the choice persists and auto-applies
    // to every save (quick save included) until changed.
    const typeSection = document.createElement("div");
    typeSection.className = "stg-mj-menu__types";
    typeSection.setAttribute("role", "radiogroup");
    typeSection.setAttribute("aria-label", "Animation or live action");
    for (const option of STYLE_TAG_OPTIONS) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "stg-mj-menu__type";
      pill.dataset.styleTag = option.value;
      pill.setAttribute("aria-pressed", "false");
      pill.textContent = option.label;
      typeSection.appendChild(pill);
    }
    menu.appendChild(typeSection);

    for (const row of rows) {
      const item = document.createElement("button");
      item.className = "stg-mj-menu__item";
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.dataset.folderId = row.folderId;
      item.dataset.menuId = row.id;
      if (row.clear) item.dataset.clearSelection = "1";

      const eyebrow = document.createElement("span");
      eyebrow.className = "stg-mj-menu__eyebrow";
      eyebrow.textContent = row.eyebrow;

      const label = document.createElement("span");
      label.className = "stg-mj-menu__label";
      label.textContent = row.label;

      item.append(eyebrow, label);
      menu.appendChild(item);
    }

    const createItem = document.createElement("button");
    createItem.className = "stg-mj-menu__item stg-mj-menu__item--create";
    createItem.type = "button";
    createItem.dataset.createCollection = "1";

    const createEyebrow = document.createElement("span");
    createEyebrow.className = "stg-mj-menu__eyebrow";
    createEyebrow.textContent = "Create";

    const createLabel = document.createElement("span");
    createLabel.className = "stg-mj-menu__label";
    createLabel.textContent = "New collection";

    createItem.append(createEyebrow, createLabel);
    menu.appendChild(createItem);

    const newRow = document.createElement("div");
    newRow.className = "stg-mj-menu__new";
    newRow.hidden = true;

    const input = document.createElement("input");
    input.className = "stg-mj-menu__new-input";
    input.type = "text";
    input.placeholder = "Collection name";

    const add = document.createElement("button");
    add.className = "stg-mj-menu__new-create";
    add.type = "button";
    add.textContent = "Add";

    newRow.append(input, add);
    menu.appendChild(newRow);

    const footer = document.createElement("div");
    footer.className = "stg-mj-menu__footer";

    const save = document.createElement("button");
    save.className = "stg-mj-menu__save";
    save.type = "button";
    save.textContent = "Save";
    footer.appendChild(save);
    menu.appendChild(footer);

    updateMidjourneyMenuSelection(menu, activeDefaultFolderId ? [activeDefaultFolderId] : []);
  }

  async function openMidjourneyCollectionMenu(widget) {
    const menu = widget.querySelector(".stg-mj-menu");
    if (!menu) return;
    if (menu.dataset.ready === "1") {
      menu.hidden = false;
      widget.classList.add("stg-mj-quick-save--menu-open");
      // Re-sync the type pills — another widget or the popover may have
      // changed the remembered tag since this menu was built.
      void readStyleTag().then((tag) => updateMidjourneyMenuStyleTag(menu, tag));
      return;
    }

    menu.hidden = false;
    widget.classList.add("stg-mj-quick-save--menu-open");
    menu.innerHTML = `<div class="stg-mj-menu__loading">Loading collections…</div>`;
    const [{ defaultFolderId }, folders, styleTag] = await Promise.all([
      readSavedFolderIds(),
      loadFoldersCached(),
      readStyleTag(),
    ]);
    renderMidjourneyCollectionMenu(menu, folders, defaultFolderId);
    updateMidjourneyMenuStyleTag(menu, styleTag);
    menu.dataset.ready = "1";
  }

  function closeMidjourneyCollectionMenu(widget) {
    const menu = widget.querySelector(".stg-mj-menu");
    if (menu) menu.hidden = true;
    widget.classList.remove("stg-mj-quick-save--menu-open");
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
      <div class="stg-mj-menu" role="listbox" aria-label="Collections" aria-multiselectable="true" hidden></div>
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
      const typePill = event.target?.closest?.(".stg-mj-menu__type");
      const item = event.target?.closest?.(".stg-mj-menu__item");
      const createItem = event.target?.closest?.(".stg-mj-menu__item--create");
      const createButton = event.target?.closest?.(".stg-mj-menu__new-create");
      const saveItem = event.target?.closest?.(".stg-mj-menu__save");
      if (!item && !saveItem && !createButton && !typePill) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (typePill) {
        const nextStyleTag = typePill.dataset.styleTag || "";
        updateMidjourneyMenuStyleTag(menu, nextStyleTag);
        rememberStyleTag(nextStyleTag);
        return;
      }

      if (createButton) {
        void createMidjourneyCollectionFromMenu(menu);
        return;
      }

      if (createItem) {
        toggleMidjourneyNewCollectionRow(menu);
        return;
      }

      if (item) {
        if (item.dataset.clearSelection === "1") {
          updateMidjourneyMenuSelection(menu, []);
          return;
        }
        const folderId = item.dataset.folderId || "";
        const selected = new Set(getMidjourneyMenuSelection(menu));
        if (selected.has(folderId)) {
          selected.delete(folderId);
        } else {
          selected.add(folderId);
        }
        updateMidjourneyMenuSelection(menu, [...selected]);
        return;
      }

      const selectedFolderIds = getMidjourneyMenuSelection(menu);
      setStorageSync({ [LAST_FOLDER_ID_KEY]: selectedFolderIds[0] || "" });
      closeMidjourneyCollectionMenu(widget);
      void handleSaveMidjourneyMedia(target, mainButton, selectedFolderIds)
        .finally(() => {
          if (!mainButton.classList.contains("stg-badge--error")) {
            setTimeout(() => resetMidjourneySaveButton(mainButton), 1800);
          }
        });
    }, true);

    menu.addEventListener("keydown", (event) => {
      const input = event.target?.closest?.(".stg-mj-menu__new-input");
      if (!input || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      void createMidjourneyCollectionFromMenu(menu);
    }, true);

    return widget;
  }

  function injectMidjourneyMediaBadge(target) {
    if (suppressMidjourneySaveUiForViewer()) return;
    if (!isQualifiedSiteMediaTarget(target)) return;

    const widget = createMidjourneyMediaWidget(target);
    document.body.appendChild(widget);
    target.setAttribute(MJ_MEDIA_BADGE_ATTR, "1");
    positionMidjourneyWidget(widget, target);
  }

  function scanMidjourneyMediaTargets() {
    if (!configLoaded || !extensionEnabled || !isPersistentSaveSite()) return;
    if (suppressMidjourneySaveUiForViewer()) return;

    const candidates = document.querySelectorAll(getSiteMediaSelector());
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
    updateMidjourneyLikedNavigation();
    syncMidjourneyNotesPresence();
  }

  function scheduleMidjourneyMediaScan(delay = 80) {
    if (!isPersistentSaveSite()) return;
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

  // All extension UI carries an "stg-" class prefix. Mutations inside our own
  // UI (widget repositioning, badge text, marker styles) must NOT re-trigger
  // the media scan — otherwise the observer feeds itself and the scan loops
  // forever (~12x/s) even on an idle page, repositioning widgets into a
  // visible flicker.
  function isExtensionUiNode(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;
    if (typeof el.className === "string" && el.className.includes("stg-")) {
      return true;
    }
    return Boolean(el.closest?.('[class*="stg-"]'));
  }

  function isExtensionOnlyMutation(record) {
    if (isExtensionUiNode(record.target)) return true;
    if (record.type === "childList") {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.length > 0 && nodes.every(isExtensionUiNode);
    }
    return false;
  }

  function startMidjourneyMediaObserver() {
    if (!isPersistentSaveSite() || midjourneyObserver) return;

    midjourneyObserver = new MutationObserver((records) => {
      if (records.every(isExtensionOnlyMutation)) return;
      scheduleMidjourneyMediaScan();
    });
    midjourneyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-pressed", "class", "poster", "src", "srcset", "style", "title"],
    });
    window.addEventListener("resize", updateMidjourneyWidgetPositions, {
      passive: true,
    });
    scheduleMidjourneyMediaScan(0);
  }

  // ── Event listeners ──

  document.addEventListener("mouseover", (e) => {
    // Persistent-widget sites (Midjourney, Krea) get their own save controls.
    if (isPersistentSaveSite()) return;

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
    if (suppressMidjourneySaveUiForViewer()) return;
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

  const runtimeMessageApi = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessageApi && typeof runtimeMessageApi.addListener === "function") {
    runtimeMessageApi.addListener((message, _sender, sendResponse) => {
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
  }

  const storageChangeApi = globalThis.chrome?.storage?.onChanged;
  if (storageChangeApi && typeof storageChangeApi.addListener === "function") {
    storageChangeApi.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[DISABLED_HOSTS_KEY]) {
        return;
      }

      const disabledHosts = normalizeDisabledHosts(
        changes[DISABLED_HOSTS_KEY].newValue,
      );
      setExtensionEnabled(!isHostDisabled(disabledHosts, currentHost));
      configLoaded = true;
    });
  }

  syncSiteStateFromStorage();
  startMidjourneyMediaObserver();

})();
