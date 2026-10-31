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

  function getJobPageSelection(rawPageUrl) {
    try {
      const url = new URL(
        String(rawPageUrl || ""),
        globalScope.location?.href || "https://www.midjourney.com/",
      );
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{20,})(?:\/|$)/i);
      if (!match) return null;

      const parsedIndex = Number.parseInt(url.searchParams.get("index") || "0", 10);
      return {
        jobId: match[1],
        index: Number.isInteger(parsedIndex) && parsedIndex >= 0
          ? parsedIndex
          : 0,
      };
    } catch {
      return null;
    }
  }

  function getMediaSelection(rawMediaUrl) {
    try {
      const url = new URL(
        normalizeUrlCandidate(rawMediaUrl),
        globalScope.location?.href || "https://www.midjourney.com/",
      );
      const match = url.pathname.match(
        /^\/([0-9a-f-]{20,})\/(?:\d+_)?(\d+)(?:[_\-.]|$)/i,
      );
      if (!match) return null;
      const parsedIndex = Number.parseInt(match[2], 10);
      if (!Number.isInteger(parsedIndex) || parsedIndex < 0) return null;
      return { jobId: match[1], index: parsedIndex };
    } catch {
      return null;
    }
  }

  // Midjourney's rendered <img> commonly points at a resized WebP derivative.
  // The canonical job/index endpoint is the generated PNG, so saving that URL
  // preserves the original pixels instead of merely re-encoding a preview.
  function getOriginalImageUrl(rawMediaUrl, rawPageUrl) {
    const selection =
      getJobPageSelection(rawPageUrl) ||
      getMediaSelection(rawMediaUrl);
    if (!selection) return "";
    return `https://cdn.midjourney.com/${selection.jobId}/0_${selection.index}.png`;
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

  const LIKED_STATE_KEYS = new Set([
    "liked",
    "isliked",
    "hasliked",
    "userliked",
    "likedbycurrentuser",
    "islikedbycurrentuser",
    "favorited",
    "favorite",
    "isfavorite",
    "isfavorited",
  ]);

  function normalizeStateKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function readLikedStateFromValue(value, seen = new WeakSet(), depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return null;
    if (seen.has(value)) return null;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "boolean" && LIKED_STATE_KEYS.has(normalizeStateKey(key))) {
        return child;
      }
    }

    for (const child of Object.values(value)) {
      if (!child || typeof child !== "object") continue;
      const nested = readLikedStateFromValue(child, seen, depth + 1);
      if (nested !== null) return nested;
    }

    return null;
  }

  function getControlLabel(control) {
    return [
      control?.getAttribute?.("title"),
      control?.getAttribute?.("aria-label"),
      control?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
  }

  function readLikedStateFromDom(root) {
    if (!root || typeof root.querySelectorAll !== "function") return null;

    const controls = root.querySelectorAll(
      'button, [role="button"], [title], [aria-label]',
    );
    for (const control of controls) {
      const label = getControlLabel(control);
      if (!label) continue;
      if (/\bunlike(?:\s+image)?\b/.test(label)) return true;
      if (/\blike(?:\s+image)?\b/.test(label)) return false;
    }

    return null;
  }

  function isLikedGenerationElement(el) {
    const domState = readLikedStateFromDom(el);
    if (domState !== null) return domState;

    const job = findJobObject(el);
    const jobState = readLikedStateFromValue(job);
    return jobState === true;
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

  // ── Generation metadata for a save ──
  //
  // A content script runs in an isolated world: it shares the DOM with the page
  // but not its JS, so the React props `findJobObject` walks are invisible there.
  // Metadata therefore comes from three places, best first:
  //   1. /api/job-status: the canonical full_command, reachable from the
  //      content script because it shares the page's origin and cookies.
  //   2. The page world (see readJobFromPageWorld): typed personalization codes
  //      plus seed and speed, which job-status does not return.
  //   3. The job page's prompt panel: the moodboard and profile names as shown.
  // Any of them may fail. A save never waits on them for long and never fails
  // because of them.

  const METADATA_FETCH_TIMEOUT_MS = 2500;
  const NAMES_CACHE_TTL_MS = 5 * 60 * 1000;
  const SPEED_FLAGS = new Set(["fast", "relax", "turbo"]);
  const FLAG_PATTERN = /(?:^|\s)--([a-zA-Z][\w-]*)(?=\s|$)/g;

  function getSaveSelection(rawMediaUrl, rawPageUrl) {
    // The media URL names the exact tile. The page URL only stands in for
    // media that carries no job id (a data: placeholder, a blob: video).
    return getMediaSelection(rawMediaUrl) || getJobPageSelection(rawPageUrl);
  }

  function toFiniteFlagNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function parseCommand(command) {
    const source = String(command || "").trim();
    const flags = [];
    FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = FLAG_PATTERN.exec(source))) {
      flags.push({
        name: match[1].toLowerCase(),
        start: match.index,
        valueStart: FLAG_PATTERN.lastIndex,
      });
    }

    const settings = { codes: [], otherFlags: [] };
    flags.forEach((flag, index) => {
      const end = index + 1 < flags.length ? flags[index + 1].start : source.length;
      const value = source.slice(flag.valueStart, end).trim();
      const keepAsOther = () =>
        settings.otherFlags.push(value ? `--${flag.name} ${value}` : `--${flag.name}`);

      if (flag.name === "ar" || flag.name === "aspect") {
        if (value) settings.aspectRatio = value;
      } else if (flag.name === "s" || flag.name === "stylize") {
        settings.stylize = toFiniteFlagNumber(value);
      } else if (flag.name === "c" || flag.name === "chaos") {
        settings.chaos = toFiniteFlagNumber(value);
      } else if (flag.name === "v" || flag.name === "version") {
        if (value) settings.version = value;
      } else if (flag.name === "seed") {
        if (value) settings.seed = value;
      } else if (flag.name === "raw") {
        settings.raw = true;
      } else if (flag.name === "style" && value.toLowerCase() === "raw") {
        settings.raw = true;
      } else if (flag.name === "hd") {
        settings.hd = true;
      } else if (SPEED_FLAGS.has(flag.name)) {
        settings.speed = flag.name;
      } else if (flag.name === "no") {
        const terms = value.split(",").map((term) => term.trim()).filter(Boolean);
        if (terms.length) settings.no = terms;
      } else if ((flag.name === "profile" || flag.name === "p") && value) {
        settings.codes.push(...value.split(/\s+/).filter(Boolean));
      } else {
        keepAsOther();
      }
    });

    return settings;
  }

  // The prompt panel on a job page. One button per flag: a hidden span holds the
  // exact flag and a visible one the label, such as "moodboard DA DECO · World".
  function readLightboxContext(root) {
    if (!root || typeof root.querySelector !== "function") return null;
    const body = root.querySelector(".notranslate")?.textContent?.trim() || "";
    const flags = [];
    const personalization = [];

    for (const button of root.querySelectorAll("button[title]")) {
      const flag = button.querySelector("span.text-transparent")?.textContent?.trim() || "";
      if (!flag.startsWith("--")) continue;
      flags.push(flag);

      const code = flag.match(/^--(?:profile|p)\s+(\S+)$/)?.[1];
      if (!code) continue;
      const label = button.querySelector("span.select-none")?.textContent?.trim() || "";
      const typed = label.match(/^(moodboard|profile)\s*(.*)$/i);
      personalization.push({
        code,
        type: typed ? typed[1].toLowerCase() : undefined,
        name: (typed ? typed[2] : label).trim() || undefined,
      });
    }

    return {
      command: [body, flags.join(" ")].filter(Boolean).join(" ").trim(),
      personalization,
    };
  }

  // Runs in the page's own world through chrome.scripting.executeScript, which
  // serializes this function: it must not reference anything outside itself.
  function readJobFromPageWorld(jobId) {
    const selector = ["a[href", "img[src", "img[srcset", "video[poster", "video[src"]
      .map((attribute) => `${attribute}*="${jobId}"]`)
      .join(",");
    const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 8);

    for (const node of nodes) {
      const fiberKey = Object.keys(node).find((key) => key.startsWith("__reactFiber"));
      let fiber = fiberKey ? node[fiberKey] : null;
      for (let depth = 0; depth < 60 && fiber; depth++, fiber = fiber.return) {
        const job = fiber.memoizedProps?.job;
        if (job?.id === jobId) {
          return JSON.parse(JSON.stringify({
            id: job.id,
            prompt: job.prompt,
            personalization_codes: job.personalization_codes,
          }));
        }
      }
    }
    return null;
  }

  function mergePersonalization({ codes, pageCodes, lightbox, namesById }) {
    const byCode = new Map();
    const entryFor = (code) => {
      if (!byCode.has(code)) byCode.set(code, { code, type: "unknown" });
      return byCode.get(code);
    };

    for (const code of codes) entryFor(code);
    for (const shown of lightbox) {
      const entry = entryFor(shown.code);
      if (shown.type) entry.type = shown.type;
      if (shown.name) entry.name = shown.name;
    }
    for (const typed of pageCodes) {
      if (typeof typed?.code !== "string" || !typed.code) continue;
      const entry = entryFor(typed.code);
      if (typed.type === "moodboard" || typed.type === "profile") entry.type = typed.type;
      if (typed.id != null) {
        entry.id = String(typed.id);
        const name = namesById?.get(entry.id);
        if (name) entry.name = name;
      }
    }
    return Array.from(byCode.values());
  }

  function buildSaveMetadata({ selection, job, pageJob, lightbox, namesById }) {
    const prompt = pageJob?.prompt && typeof pageJob.prompt === "object" ? pageJob.prompt : {};
    const command =
      readFirstString(job?.full_command) ||
      (pageJob ? reconstructPrompt(pageJob) : null) ||
      lightbox?.command ||
      "";
    const parsed = parseCommand(command);
    const pageSpeed = typeof prompt.speed === "string" ? prompt.speed.toLowerCase() : undefined;
    const seed = parsed.seed ?? (prompt.seed != null ? String(prompt.seed) : undefined);

    const metadata = {
      jobId: selection.jobId,
      tileIndex: selection.index,
      personalization: mergePersonalization({
        codes: parsed.codes,
        pageCodes: Array.isArray(pageJob?.personalization_codes)
          ? pageJob.personalization_codes
          : [],
        lightbox: lightbox?.personalization || [],
        namesById,
      }),
      aspectRatio: parsed.aspectRatio,
      stylize: parsed.stylize,
      chaos: parsed.chaos,
      raw: parsed.raw,
      version: parsed.version,
      seed,
      hd: parsed.hd,
      speed: parsed.speed ?? (SPEED_FLAGS.has(pageSpeed) ? pageSpeed : undefined),
      no: parsed.no,
      otherFlags: parsed.otherFlags.length ? parsed.otherFlags : undefined,
    };

    return { promptText: command, metadata };
  }

  function withTimeout(promise, timeoutMs) {
    let timer;
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out.")), timeoutMs);
    });
    return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
  }

  async function fetchMidjourneyJson(path, init, fetchImpl) {
    const origin = globalScope.location?.origin || "https://www.midjourney.com";
    const response = await withTimeout(
      fetchImpl(`${origin}${path}`, {
        credentials: "include",
        ...init,
        headers: { "X-CSRF-Protection": "1", ...init?.headers },
      }),
      METADATA_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`Midjourney ${path}: HTTP ${response.status}`);
    return withTimeout(response.json(), METADATA_FETCH_TIMEOUT_MS);
  }

  async function fetchJobStatus(jobId, fetchImpl) {
    // Midjourney answers 400 without _frontend_source (checked 31 Oct 2026).
    const jobs = await fetchMidjourneyJson(
      "/api/job-status",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [jobId],
          _frontend_source: "useJobSubmitter_fetchJobStatus",
        }),
      },
      fetchImpl,
    );
    const job = Array.isArray(jobs) ? jobs.find((entry) => entry?.id === jobId) : null;
    return job || null;
  }

  let namesCache = null;

  async function fetchPersonalizationNames(fetchImpl) {
    if (namesCache && Date.now() - namesCache.at < NAMES_CACHE_TTL_MS) {
      return namesCache.names;
    }
    const [moodboards, profiles] = await Promise.all([
      fetchMidjourneyJson("/api/moodboards", {}, fetchImpl),
      fetchMidjourneyJson("/api/personalized-profiles", {}, fetchImpl),
    ]);
    const names = new Map();
    for (const board of Array.isArray(moodboards) ? moodboards : []) {
      if (board?.moodboard_id && board.title) names.set(String(board.moodboard_id), board.title);
    }
    for (const profile of Array.isArray(profiles?.profiles) ? profiles.profiles : []) {
      if (profile?.id && profile.title) names.set(String(profile.id), profile.title);
    }
    namesCache = { at: Date.now(), names };
    return names;
  }

  async function collectSaveMetadata({
    imageUrl,
    pageUrl,
    lightboxRoot,
    readPageJob,
    fetchImpl = globalScope.fetch?.bind(globalScope),
  }) {
    const selection = getSaveSelection(imageUrl, pageUrl);
    if (!selection) return null;

    // Read before the first await: the user may move on while the save runs,
    // and the panel only describes the job the page is showing right now.
    const lightbox =
      getJobPageSelection(pageUrl)?.jobId === selection.jobId
        ? readLightboxContext(lightboxRoot)
        : null;

    const [job, pageJob] = await Promise.all([
      fetchJobStatus(selection.jobId, fetchImpl).catch((err) => {
        console.warn("[Save to Gallery] Midjourney job-status unavailable:", err?.message);
        return null;
      }),
      withTimeout(Promise.resolve(readPageJob?.(selection.jobId)), METADATA_FETCH_TIMEOUT_MS)
        .catch(() => null),
    ]);

    const hasCodesToName = (pageJob?.personalization_codes || []).some((code) => code?.id);
    const namesById = hasCodesToName
      ? await fetchPersonalizationNames(fetchImpl).catch((err) => {
          console.warn("[Save to Gallery] Midjourney names unavailable:", err?.message);
          return null;
        })
      : null;

    return buildSaveMetadata({ selection, job, pageJob, lightbox, namesById });
  }

  globalScope.SaveToGalleryMidjourney = {
    MIN_RENDERED_EDGE,
    buildSaveMetadata,
    collectSaveMetadata,
    extractUrlsFromCssImage,
    findJobObject,
    getBestSrcFromSrcset,
    getJobPageSelection,
    getMediaUrl,
    getOriginalImageUrl,
    getRenderedSize,
    getSaveSelection,
    isMidjourneyMediaUrl,
    isLikedGenerationElement,
    isQualifiedMediaElement,
    parseCommand,
    readJobFromPageWorld,
    readLightboxContext,
    reconstructPrompt,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
