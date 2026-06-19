(function registerMidjourneyAdapter(globalScope) {
  "use strict";

  const MIN_RENDERED_EDGE = 96;
  const MIDJOURNEY_MEDIA_HOSTS = [
    "cdn.midjourney.com",
    "mj.run",
    "s.mj.run",
  ];

  function toFiniteNumber(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeUrlCandidate(value) {
    return String(value || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\(["'])/g, "$1");
  }

  function extractUrlsFromCssImage(value) {
    const source = String(value || "");
    const urls = [];
    const urlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/g;
    let match;

    while ((match = urlPattern.exec(source))) {
      const rawUrl = match[1] || match[2] || match[3] || "";
      const url = normalizeUrlCandidate(rawUrl);
      if (url) urls.push(url);
    }

    const trimmed = normalizeUrlCandidate(source);
    if (urls.length === 0 && /^https?:\/\//i.test(trimmed)) {
      urls.push(trimmed);
    }

    return urls;
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

  function getInlineBackgroundImage(el) {
    if (!el) return "";
    const fromStyleObject = el.style?.backgroundImage || "";
    if (fromStyleObject && fromStyleObject !== "none") return fromStyleObject;

    const styleAttr =
      typeof el.getAttribute === "function" ? el.getAttribute("style") || "" : "";
    const match = styleAttr.match(/background(?:-image)?\s*:\s*([^;]+)/i);
    return match?.[1] || "";
  }

  function getComputedBackgroundImage(el) {
    if (!el || typeof globalScope.getComputedStyle !== "function") return "";
    try {
      const value = globalScope.getComputedStyle(el).backgroundImage;
      return value && value !== "none" ? value : "";
    } catch {
      return "";
    }
  }

  function isMidjourneyMediaUrl(rawUrl) {
    const value = normalizeUrlCandidate(rawUrl);
    if (!value || value.startsWith("data:")) return false;

    try {
      const url = new URL(
        value,
        globalScope.location?.href || "https://www.midjourney.com/",
      );
      const host = url.hostname.toLowerCase();
      return MIDJOURNEY_MEDIA_HOSTS.some(
        (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`),
      );
    } catch {
      return /(?:cdn\.midjourney\.com|(?:^|\/)s?\.?mj\.run)/i.test(value);
    }
  }

  function getImageUrlFromImage(img) {
    if (!img) return "";
    const fromSrcset = getBestSrcFromSrcset(img.srcset || "");
    return normalizeUrlCandidate(fromSrcset || img.currentSrc || img.src || "");
  }

  function getImageUrlFromVideo(video) {
    if (!video) return "";
    return normalizeUrlCandidate(video.poster || video.currentSrc || video.src || "");
  }

  function getImageUrlFromBackground(el) {
    const inlineUrls = extractUrlsFromCssImage(getInlineBackgroundImage(el));
    if (inlineUrls.length > 0) return inlineUrls.at(-1) || "";

    const computedUrls = extractUrlsFromCssImage(getComputedBackgroundImage(el));
    return computedUrls.at(-1) || "";
  }

  function findNestedMedia(el) {
    if (!el || typeof el.querySelector !== "function") return null;
    return el.querySelector(
      [
        'img[src*="cdn.midjourney.com"]',
        'img[srcset*="cdn.midjourney.com"]',
        'img[src*="mj.run"]',
        'img[srcset*="mj.run"]',
        'video[poster*="cdn.midjourney.com"]',
        'video[src*="cdn.midjourney.com"]',
      ].join(","),
    );
  }

  function getMediaUrl(el) {
    if (!el) return "";
    const tagName = String(el.tagName || "").toLowerCase();

    if (tagName === "img") {
      return getImageUrlFromImage(el);
    }

    if (tagName === "video") {
      return getImageUrlFromVideo(el);
    }

    const backgroundUrl = getImageUrlFromBackground(el);
    if (backgroundUrl) return backgroundUrl;

    const nested = findNestedMedia(el);
    if (nested) return getMediaUrl(nested);

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
        toFiniteNumber(el?.width),
      ),
      height: Math.max(
        toFiniteNumber(rect?.height),
        toFiniteNumber(el?.clientHeight),
        toFiniteNumber(el?.offsetHeight),
        toFiniteNumber(el?.height),
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

    const mediaUrl = getMediaUrl(el);
    if (!isMidjourneyMediaUrl(mediaUrl)) return false;

    const size = getRenderedSize(el);
    return size.width >= MIN_RENDERED_EDGE && size.height >= MIN_RENDERED_EDGE;
  }

  function getReactCandidates(props) {
    if (!props || typeof props !== "object") return [];
    return [
      props.job,
      props.imageJob,
      props.selectedJob,
      props.task,
      props.item,
      props.image,
      props.data,
      props,
    ].filter(Boolean);
  }

  function looksLikeMidjourneyJob(value) {
    if (!value || typeof value !== "object") return false;
    if (value.prompt && typeof value.prompt === "object") return true;
    return [
      value.full_command,
      value.fullCommand,
      value.text_prompt,
      value.textPrompt,
      value.raw_prompt,
      value.rawPrompt,
    ].some((candidate) => typeof candidate === "string" && candidate.trim());
  }

  function findJobInValue(value, seen = new WeakSet(), depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (looksLikeMidjourneyJob(value)) return value;

    for (const candidate of getReactCandidates(value)) {
      if (candidate === value) continue;
      const nested = findJobInValue(candidate, seen, depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  function inspectReactNodeForJob(el) {
    if (!el) return null;
    const keys = Object.keys(el);

    for (const key of keys) {
      if (key.startsWith("__reactProps")) {
        const job = findJobInValue(el[key]);
        if (job) return job;
      }
    }

    const fiberKey = keys.find((key) => key.startsWith("__reactFiber"));
    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    for (let depth = 0; depth < 40 && fiber; depth++, fiber = fiber.return) {
      const job =
        findJobInValue(fiber.memoizedProps) ||
        findJobInValue(fiber.pendingProps) ||
        findJobInValue(fiber.memoizedState);
      if (job) return job;
    }

    return null;
  }

  function findJobObject(el) {
    let node = el;
    for (let depth = 0; depth < 10 && node; depth++, node = node.parentElement) {
      const job = inspectReactNodeForJob(node);
      if (job) return job;
    }
    return null;
  }

  function formatPromptPart(part) {
    if (!part) return "";
    if (typeof part === "string") return part.trim();
    if (typeof part.content !== "string") return "";

    const weight =
      typeof part.weight === "number" && part.weight !== 1
        ? `::${part.weight}`
        : "";
    return `${part.content}${weight}`.trim();
  }

  function readFirstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function reconstructPrompt(job) {
    if (!job || typeof job !== "object") return null;
    const prompt = job.prompt && typeof job.prompt === "object" ? job.prompt : {};

    let text = readFirstString(
      job.full_command,
      job.fullCommand,
      job.text_prompt,
      job.textPrompt,
      job.raw_prompt,
      job.rawPrompt,
      prompt.full_command,
      prompt.fullCommand,
      prompt.text,
      prompt.raw,
    );

    if (!text && Array.isArray(prompt.decodedPrompt)) {
      text = prompt.decodedPrompt.map(formatPromptPart).filter(Boolean).join(" ");
    }

    if (!text && typeof prompt.decodedPrompt === "string") {
      text = prompt.decodedPrompt.trim();
    }

    const flags = [];
    if (prompt.ar?.w && prompt.ar?.h) flags.push(`--ar ${prompt.ar.w}:${prompt.ar.h}`);
    if (prompt.chaos != null) flags.push(`--chaos ${prompt.chaos}`);
    if (prompt.weird != null) flags.push(`--weird ${prompt.weird}`);
    if (prompt.stylize != null) flags.push(`--stylize ${prompt.stylize}`);
    if (prompt.quality != null) flags.push(`--quality ${prompt.quality}`);
    if (prompt.seed != null) flags.push(`--seed ${prompt.seed}`);
    if (prompt.imageWeight != null) flags.push(`--iw ${prompt.imageWeight}`);
    if (prompt.tile) flags.push("--tile");
    if (prompt.draft) flags.push("--draft");
    if (prompt.hd) flags.push("--hd");
    if (prompt.styleRaw) flags.push("--style raw");
    if (Array.isArray(prompt.no) && prompt.no.length) flags.push(`--no ${prompt.no.join(", ")}`);
    if (prompt.version) flags.push(`--v ${prompt.version}`);

    const output = [text, flags.join(" ")].filter(Boolean).join(" ").trim();
    return output || null;
  }

  globalScope.SaveToGalleryMidjourney = {
    MIN_RENDERED_EDGE,
    extractUrlsFromCssImage,
    findJobObject,
    getBestSrcFromSrcset,
    getMediaUrl,
    getRenderedSize,
    isMidjourneyMediaUrl,
    isQualifiedMediaElement,
    reconstructPrompt,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
