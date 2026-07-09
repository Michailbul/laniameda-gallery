(function registerShotdeckAdapter(globalScope) {
  "use strict";

  // ShotDeck is login-walled and Cloudflare-protected, so this adapter is
  // deliberately defensive (same approach as the Krea adapter): qualification
  // is size-based — the extension only activates it on shotdeck.com pages —
  // rather than tied to exact CDN paths or DOM internals that can't be
  // verified from outside a member session. Film stills are wide (2.35:1 and
  // wider), so the floors allow a short cross edge as long as the long edge
  // reads like real media.
  const MIN_RENDERED_LONG_EDGE = 150;
  const MIN_RENDERED_SHORT_EDGE = 80;
  const MIN_SOURCE_EDGE = 200;

  // Alt/aria values that are UI labels, not shot descriptions.
  const NON_DESCRIPTION_LABELS = new Set([
    "image",
    "still",
    "shot",
    "thumbnail",
    "preview",
    "poster",
    "avatar",
    "logo",
    "icon",
    "shotdeck",
    "shotdeck logo",
  ]);

  function isShotdeckPage(hostname) {
    const host = String(
      hostname || globalScope.location?.hostname || "",
    ).toLowerCase();
    return host === "shotdeck.com" || host.endsWith(".shotdeck.com");
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
    return urls.at(-1) || "";
  }

  function getMediaUrl(el) {
    if (!el) return "";
    const tagName = String(el.tagName || "").toLowerCase();

    if (tagName === "img") {
      const fromSrcset = getBestSrcFromSrcset(el.srcset || "");
      const direct = normalizeUrlCandidate(
        fromSrcset || el.currentSrc || el.src || "",
      );
      if (isSaveableMediaUrl(direct)) return direct;
      // Lazy loaders park the real URL on data-src until scroll-in.
      const lazy = normalizeUrlCandidate(
        el.getAttribute?.("data-src") || el.getAttribute?.("data-lazy-src") || "",
      );
      return isSaveableMediaUrl(lazy) ? lazy : direct;
    }

    if (tagName === "video") {
      return normalizeUrlCandidate(el.poster || el.currentSrc || el.src || "");
    }

    return getInlineBackgroundUrl(el);
  }

  function isSaveableMediaUrl(rawUrl) {
    const url = normalizeUrlCandidate(rawUrl);
    if (!url) return false;
    if (url.startsWith("blob:")) return true;
    if (url.startsWith("data:")) {
      return /^data:image\/(png|jpe?g|webp|avif)/i.test(url);
    }
    if (!/^https?:/i.test(url)) return false;
    if (/\.svg(\?|#|$)/i.test(url)) return false;
    if (/(logo|icon|sprite|avatar|badge)/i.test(url)) return false;
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
      if (!getInlineBackgroundUrl(el)) return false;
      if (
        typeof el.querySelector === "function" &&
        el.querySelector("img, video")
      ) {
        return false;
      }
    }

    if (!isSaveableMediaUrl(getMediaUrl(el))) return false;

    const rendered = getRenderedSize(el);
    const longEdge = Math.max(rendered.width, rendered.height);
    const shortEdge = Math.min(rendered.width, rendered.height);
    if (
      shortEdge < MIN_RENDERED_SHORT_EDGE ||
      longEdge < MIN_RENDERED_LONG_EDGE
    ) {
      return false;
    }

    if (tagName === "img") {
      const sw = toFiniteNumber(el.naturalWidth);
      const sh = toFiniteNumber(el.naturalHeight);
      if (sw > 0 && sh > 0 && Math.max(sw, sh) < MIN_SOURCE_EDGE) {
        return false;
      }
    }

    return true;
  }

  function looksLikeDescription(value) {
    const text = String(value || "").trim();
    if (text.length < 4) return false;
    if (NON_DESCRIPTION_LABELS.has(text.toLowerCase())) return false;
    if (/^https?:\/\//i.test(text)) return false;
    if (/^[\w-]+\.(png|jpe?g|webp|avif|mp4|webm|gif)$/i.test(text)) return false;
    return true;
  }

  function readDescriptionFromAttributes(el) {
    if (!el || typeof el.getAttribute !== "function") return "";
    for (const attr of ["alt", "aria-label", "title", "data-title"]) {
      const value = el.getAttribute(attr);
      if (looksLikeDescription(value)) return String(value).trim();
    }
    return "";
  }

  // Detail/lightbox view: pull the movie title (and whatever credit line sits
  // next to it) from generic heading/title nodes. Selector list is
  // best-effort — everything degrades to "".
  function readDetailDescription(doc) {
    const root = doc || globalScope.document;
    if (!root || typeof root.querySelector !== "function") return "";

    const container =
      root.querySelector(
        '[class*="shot-info" i], [class*="shot_detail" i], [class*="shotdetail" i], [class*="still-detail" i], [role="dialog"], [class*="lightbox" i], [class*="modal" i]',
      ) || null;
    if (!container) return "";

    const title =
      container
        .querySelector('h1, h2, h3, [class*="title" i]')
        ?.textContent?.trim() || "";
    if (!looksLikeDescription(title)) return "";

    const credit =
      container
        .querySelector('[class*="director" i], [class*="credit" i]')
        ?.textContent?.trim() || "";

    return [title, credit]
      .filter((part) => looksLikeDescription(part))
      .join(" — ")
      .slice(0, 300);
  }

  function extractDescription(el, doc) {
    const fromSelf = readDescriptionFromAttributes(el);
    if (fromSelf) return fromSelf;

    let node = el;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const fromNode = readDescriptionFromAttributes(node);
      if (fromNode) return fromNode;
    }

    return readDetailDescription(doc);
  }

  function getTagNames() {
    return ["shotdeck"];
  }

  globalScope.SaveToGalleryShotdeck = {
    MIN_RENDERED_LONG_EDGE,
    MIN_RENDERED_SHORT_EDGE,
    MIN_SOURCE_EDGE,
    extractDescription,
    getBestSrcFromSrcset,
    getInlineBackgroundUrl,
    getMediaUrl,
    getRenderedSize,
    getTagNames,
    isQualifiedMediaElement,
    isSaveableMediaUrl,
    isShotdeckPage,
    looksLikeDescription,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
