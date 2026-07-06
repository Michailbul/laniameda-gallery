(function registerKreaAdapter(globalScope) {
  "use strict";

  // Krea generations render as large <img>/<video> elements inside the
  // workspace. Krea's media CDN hosts have changed over time, so qualification
  // is size-based (the extension only activates this adapter on krea.ai
  // pages) instead of hostname-based: anything rendered large enough to be a
  // generation qualifies; icons, avatars, and style-preset thumbs stay below
  // the floors.
  const MIN_RENDERED_EDGE = 150;
  const MIN_SOURCE_EDGE = 256;

  // Attribute/alt values that are UI labels, not prompts.
  const NON_PROMPT_LABELS = new Set([
    "image",
    "generated image",
    "generation",
    "thumbnail",
    "preview",
    "avatar",
    "logo",
    "icon",
    "krea",
    "krea logo",
    "style",
    "reference",
  ]);

  const PROMPT_PROP_KEYS = new Set([
    "prompt",
    "positiveprompt",
    "positive_prompt",
    "textprompt",
    "text_prompt",
    "fullprompt",
    "full_prompt",
  ]);

  function isKreaPage(hostname) {
    const host = String(
      hostname || globalScope.location?.hostname || "",
    ).toLowerCase();
    return host === "krea.ai" || host.endsWith(".krea.ai");
  }

  function toFiniteNumber(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeUrlCandidate(value) {
    return String(value || "")
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  function getBestSrcFromSrcset(srcset) {
    const candidates = String(srcset || "")
      .split(",")
      .map((part, index) => {
        const pieces = part.trim().split(/\s+/);
        const url = normalizeUrlCandidate(pieces[0]);
        const descriptor = pieces[1] || "";
        let score = index + 1;
        if (descriptor.endsWith("w")) {
          score = Number.parseFloat(descriptor) || score;
        } else if (descriptor.endsWith("x")) {
          score = (Number.parseFloat(descriptor) || 1) * 10000;
        }
        return { url, score };
      })
      .filter((candidate) => candidate.url);

    candidates.sort((a, b) => a.score - b.score);
    return candidates.at(-1)?.url || "";
  }

  function getInlineBackgroundUrl(el) {
    if (!el) return "";
    const inline = el.style?.backgroundImage || "";
    const attr =
      typeof el.getAttribute === "function" ? el.getAttribute("style") || "" : "";
    const source = inline && inline !== "none" ? inline : attr;
    const urls = [];
    const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/g;
    let match;
    while ((match = pattern.exec(source))) {
      const url = normalizeUrlCandidate(match[1] || match[2] || match[3] || "");
      if (url) urls.push(url);
    }
    // image-set lists low-dpi first — the last URL is the highest resolution.
    return urls.at(-1) || "";
  }

  function getMediaUrl(el) {
    if (!el) return "";
    const tagName = String(el.tagName || "").toLowerCase();

    if (tagName === "img") {
      const fromSrcset = getBestSrcFromSrcset(el.srcset || "");
      return normalizeUrlCandidate(fromSrcset || el.currentSrc || el.src || "");
    }

    if (tagName === "video") {
      return normalizeUrlCandidate(el.currentSrc || el.src || el.poster || "");
    }

    return getInlineBackgroundUrl(el);
  }

  function isSaveableMediaUrl(rawUrl) {
    const url = normalizeUrlCandidate(rawUrl);
    if (!url) return false;
    // blob: URLs are fine — bytes are captured in-page before saving.
    if (url.startsWith("blob:")) return true;
    if (url.startsWith("data:")) {
      // Allow real inline raster payloads, reject svg/gif spacers.
      return /^data:image\/(png|jpe?g|webp|avif)/i.test(url);
    }
    if (!/^https?:/i.test(url)) return false;
    if (/\.svg(\?|#|$)/i.test(url)) return false;
    if (url.includes("spacer") || url.includes("pixel.")) return false;
    return true;
  }

  function getRenderedSize(el) {
    const rect =
      typeof el?.getBoundingClientRect === "function"
        ? el.getBoundingClientRect()
        : null;
    return {
      width: Math.max(
        toFiniteNumber(rect?.width),
        toFiniteNumber(el?.clientWidth),
        toFiniteNumber(el?.offsetWidth),
      ),
      height: Math.max(
        toFiniteNumber(rect?.height),
        toFiniteNumber(el?.clientHeight),
        toFiniteNumber(el?.offsetHeight),
      ),
    };
  }

  function getSourceSize(el) {
    const tagName = String(el?.tagName || "").toLowerCase();
    if (tagName === "video") {
      return {
        width: toFiniteNumber(el.videoWidth),
        height: toFiniteNumber(el.videoHeight),
      };
    }
    return {
      width: toFiniteNumber(el?.naturalWidth),
      height: toFiniteNumber(el?.naturalHeight),
    };
  }

  function isQualifiedMediaElement(el, options = {}) {
    if (!el) return false;
    if (
      options.badgeAttr &&
      typeof el.hasAttribute === "function" &&
      el.hasAttribute(options.badgeAttr)
    ) {
      return false;
    }

    const tagName = String(el.tagName || "").toLowerCase();
    const isDirectMedia = tagName === "img" || tagName === "video";
    if (!isDirectMedia) {
      // Background-image containers qualify only when they don't wrap real
      // media elements — the inner <img>/<video> gets the widget instead.
      if (!getInlineBackgroundUrl(el)) return false;
      if (typeof el.querySelector === "function" && el.querySelector("img, video")) {
        return false;
      }
    }

    if (!isSaveableMediaUrl(getMediaUrl(el))) return false;

    const rendered = getRenderedSize(el);
    if (rendered.width < MIN_RENDERED_EDGE || rendered.height < MIN_RENDERED_EDGE) {
      return false;
    }

    // Videos and background containers may not expose intrinsic size — the
    // rendered floor already filters UI chrome, so only enforce the source
    // floor when the intrinsic size is known.
    const source = getSourceSize(el);
    if (
      source.width > 0 &&
      source.height > 0 &&
      (source.width < MIN_SOURCE_EDGE || source.height < MIN_SOURCE_EDGE)
    ) {
      return false;
    }

    return true;
  }

  function looksLikePromptText(value) {
    const text = String(value || "").trim();
    if (text.length < 12) return false;
    if (NON_PROMPT_LABELS.has(text.toLowerCase())) return false;
    // URLs and file names are not prompts.
    if (/^https?:\/\//i.test(text)) return false;
    if (/^[\w-]+\.(png|jpe?g|webp|avif|mp4|webm)$/i.test(text)) return false;
    // Prompts are multi-word.
    return text.split(/\s+/).length >= 3;
  }

  function readPromptFromAttributes(el) {
    if (!el || typeof el.getAttribute !== "function") return "";
    for (const attr of ["alt", "title", "aria-label", "data-prompt", "data-caption"]) {
      const value = el.getAttribute(attr);
      if (looksLikePromptText(value)) return String(value).trim();
    }
    return "";
  }

  function findPromptInProps(value, seen = new WeakSet(), depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return "";
    if (seen.has(value)) return "";
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = String(key).toLowerCase().replace(/[^a-z_]/g, "");
      if (
        typeof child === "string" &&
        PROMPT_PROP_KEYS.has(normalizedKey) &&
        looksLikePromptText(child)
      ) {
        return child.trim();
      }
      if (
        child &&
        typeof child === "object" &&
        PROMPT_PROP_KEYS.has(normalizedKey) &&
        typeof child.text === "string" &&
        looksLikePromptText(child.text)
      ) {
        return child.text.trim();
      }
    }

    for (const child of Object.values(value)) {
      if (!child || typeof child !== "object") continue;
      const nested = findPromptInProps(child, seen, depth + 1);
      if (nested) return nested;
    }

    return "";
  }

  // Best-effort framework-state scan. Works when Krea exposes React-style
  // fiber/props keys on DOM nodes; harmlessly returns "" otherwise.
  function readPromptFromFrameworkState(el) {
    let node = el;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const keys = Object.keys(node);
      for (const key of keys) {
        if (key.startsWith("__reactProps")) {
          const prompt = findPromptInProps(node[key]);
          if (prompt) return prompt;
        }
      }
      const fiberKey = keys.find((key) => key.startsWith("__reactFiber"));
      if (!fiberKey) continue;
      let fiber = node[fiberKey];
      for (let hops = 0; hops < 20 && fiber; hops++, fiber = fiber.return) {
        const prompt =
          findPromptInProps(fiber.memoizedProps) ||
          findPromptInProps(fiber.pendingProps);
        if (prompt) return prompt;
      }
    }
    return "";
  }

  function readPromptFromNearbyDom(el) {
    let node = el;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const fromAttributes = readPromptFromAttributes(node);
      if (fromAttributes) return fromAttributes;

      if (typeof node.querySelector === "function") {
        const promptNode = node.querySelector(
          '[data-prompt], [data-testid*="prompt" i], [class*="prompt" i] p, [class*="prompt" i] span',
        );
        const text = promptNode?.textContent;
        if (looksLikePromptText(text)) return String(text).trim();
      }
    }
    return "";
  }

  // Last resort: the workspace prompt input. Generations visible in the
  // workspace usually come from the current prompt; still best-effort.
  function readPromptFromWorkspaceInput(doc) {
    const root = doc || globalScope.document;
    if (!root || typeof root.querySelectorAll !== "function") return "";

    for (const input of root.querySelectorAll("textarea, [contenteditable=\"true\"]")) {
      const hint = [
        input.getAttribute?.("placeholder"),
        input.getAttribute?.("aria-label"),
        input.getAttribute?.("data-testid"),
        input.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const value =
        typeof input.value === "string" && input.value
          ? input.value
          : input.textContent || "";
      if (!looksLikePromptText(value)) continue;
      if (hint.includes("prompt") || hint.includes("describe") || hint.includes("imagine")) {
        return value.trim();
      }
    }
    return "";
  }

  function extractPrompt(el, doc) {
    return (
      readPromptFromAttributes(el) ||
      readPromptFromFrameworkState(el) ||
      readPromptFromNearbyDom(el) ||
      readPromptFromWorkspaceInput(doc)
    );
  }

  function getTagNames(pathname) {
    const path = String(pathname || globalScope.location?.pathname || "").toLowerCase();
    const tags = ["krea"];
    if (path.startsWith("/image")) tags.push("krea-image");
    if (path.startsWith("/video")) tags.push("krea-video");
    if (path.startsWith("/edit")) tags.push("krea-edit");
    if (path.startsWith("/realtime")) tags.push("krea-realtime");
    if (path.startsWith("/enhance")) tags.push("krea-enhance");
    return tags;
  }

  globalScope.SaveToGalleryKrea = {
    MIN_RENDERED_EDGE,
    MIN_SOURCE_EDGE,
    extractPrompt,
    getInlineBackgroundUrl,
    getMediaUrl,
    getRenderedSize,
    getTagNames,
    isKreaPage,
    isQualifiedMediaElement,
    isSaveableMediaUrl,
    looksLikePromptText,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
