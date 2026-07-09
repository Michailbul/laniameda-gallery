(function registerPinterestAdapter(globalScope) {
  "use strict";

  // Pinterest pins render as <img> elements served from i.pinimg.com, with a
  // srcset that scales up to the original upload. Qualification is host +
  // size based: pin media is large and comes from pinimg; avatars, board
  // covers, and UI chrome are filtered by URL pattern and render floors.
  // Grid pins are ~236px wide but wide (16:9) pins render short, so the
  // floors allow a shorter cross edge as long as the long edge is real.
  const MIN_RENDERED_EDGE = 100;
  const MIN_RENDERED_LONG_EDGE = 150;
  const MIN_SOURCE_EDGE = 200;

  // Alt/aria values that are UI labels, not pin descriptions.
  const NON_DESCRIPTION_LABELS = new Set([
    "pin",
    "pinterest",
    "pin image",
    "image",
    "thumbnail",
    "preview",
    "avatar",
    "profile picture",
    "board cover",
    "video pin",
    "story pin image",
  ]);

  // Square avatar/profile crops served from pinimg — never pin media.
  const AVATAR_PATH_PATTERN = /\/(?:30|60|75|140|280)x(?:30|60|75|140|280)(?:_RS)?\//i;

  function isPinterestPage(hostname) {
    const host = String(
      hostname || globalScope.location?.hostname || "",
    ).toLowerCase();
    // pinterest.com, *.pinterest.com, and country domains (pinterest.de,
    // pinterest.co.uk, pinterest.com.au, …) — but not pinterest.<anything>.com.
    return /(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
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
        // The original upload beats any sized variant regardless of
        // descriptor — Pinterest lists it as the last/densest candidate.
        if (/\/originals\//i.test(url)) score += 1000000;
        return { url, score };
      })
      .filter((candidate) => candidate.url);

    candidates.sort((a, b) => a.score - b.score);
    return candidates.at(-1)?.url || "";
  }

  function isPinimgUrl(url) {
    return /^https?:\/\/i\.pinimg\.com\//i.test(String(url || ""));
  }

  function isSaveableMediaUrl(rawUrl) {
    const url = normalizeUrlCandidate(rawUrl);
    if (!url) return false;
    if (!/^https?:/i.test(url)) return false;
    if (!isPinimgUrl(url)) return false;
    if (AVATAR_PATH_PATTERN.test(url)) return false;
    if (/\.svg(\?|#|$)/i.test(url)) return false;
    return true;
  }

  function getMediaUrl(el) {
    if (!el) return "";
    const tagName = String(el.tagName || "").toLowerCase();

    if (tagName === "img") {
      const fromSrcset = getBestSrcFromSrcset(el.srcset || "");
      return normalizeUrlCandidate(fromSrcset || el.currentSrc || el.src || "");
    }

    if (tagName === "video") {
      // Pinterest video pins stream HLS (blob:/m3u8) — the poster frame is
      // the only directly saveable asset.
      return normalizeUrlCandidate(el.poster || "");
    }

    return "";
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
    if (tagName !== "img" && tagName !== "video") return false;

    if (!isSaveableMediaUrl(getMediaUrl(el))) return false;

    const rendered = getRenderedSize(el);
    const longEdge = Math.max(rendered.width, rendered.height);
    const shortEdge = Math.min(rendered.width, rendered.height);
    if (shortEdge < MIN_RENDERED_EDGE || longEdge < MIN_RENDERED_LONG_EDGE) {
      return false;
    }

    // The displayed thumb may be a small variant of a large original, so the
    // source floor only rejects when the intrinsic size is known AND tiny.
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
    if (text.length < 6) return false;
    if (NON_DESCRIPTION_LABELS.has(text.toLowerCase())) return false;
    if (/^https?:\/\//i.test(text)) return false;
    if (/^[\w-]+\.(png|jpe?g|webp|avif|mp4|webm|gif)$/i.test(text)) return false;
    return text.split(/\s+/).length >= 2;
  }

  function readDescriptionFromAttributes(el) {
    if (!el || typeof el.getAttribute !== "function") return "";
    for (const attr of ["alt", "aria-label", "title"]) {
      const value = el.getAttribute(attr);
      if (looksLikeDescription(value)) return String(value).trim();
    }
    return "";
  }

  // Pin close-up view: title lives in the page <h1>, the longer description
  // in a data-test-id container. Selectors are best-effort — Pinterest
  // renames internals often, so everything degrades to "".
  function readCloseupDescription(doc) {
    const root = doc || globalScope.document;
    if (!root || typeof root.querySelector !== "function") return "";
    if (!/\/pin\//.test(globalScope.location?.pathname || "")) return "";

    const title = root.querySelector("h1")?.textContent?.trim() || "";
    const description =
      root
        .querySelector(
          '[data-test-id*="description" i], [data-test-id="pin-story-pin-title"]',
        )
        ?.textContent?.trim() || "";

    const combined = [title, description]
      .filter((part) => looksLikeDescription(part))
      .join(" — ");
    return combined;
  }

  function extractDescription(el, doc) {
    const fromSelf = readDescriptionFromAttributes(el);
    if (fromSelf) return fromSelf;

    let node = el;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const fromNode = readDescriptionFromAttributes(node);
      if (fromNode) return fromNode;
    }

    return readCloseupDescription(doc);
  }

  // Permalink of the pin that owns this media — far more useful than the
  // feed/board URL the save would otherwise record.
  function getPinUrl(el) {
    const href = el?.closest?.('a[href*="/pin/"]')?.getAttribute("href") || "";
    if (/\/pin\/[\w-]+/.test(href)) {
      try {
        return new URL(href, globalScope.location?.origin || undefined).toString();
      } catch {
        /* fall through */
      }
    }
    if (/\/pin\/[\w-]+/.test(globalScope.location?.pathname || "")) {
      return globalScope.location.href;
    }
    return "";
  }

  function getTagNames() {
    return ["pinterest"];
  }

  globalScope.SaveToGalleryPinterest = {
    MIN_RENDERED_EDGE,
    MIN_RENDERED_LONG_EDGE,
    MIN_SOURCE_EDGE,
    extractDescription,
    getBestSrcFromSrcset,
    getMediaUrl,
    getPinUrl,
    getRenderedSize,
    getTagNames,
    isPinimgUrl,
    isPinterestPage,
    isQualifiedMediaElement,
    isSaveableMediaUrl,
    looksLikeDescription,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
