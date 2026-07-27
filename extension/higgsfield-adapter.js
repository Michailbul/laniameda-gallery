(function registerHiggsfieldAdapter(globalScope) {
  "use strict";

  const MIN_RENDERED_WIDTH = 180;
  const MIN_RENDERED_HEIGHT = 100;
  const PROMPT_KEYS = new Set([
    "prompt",
    "promptvideo",
    "prompt_video",
    "textprompt",
    "text_prompt",
    "positiveprompt",
    "positive_prompt",
  ]);
  const INPUT_KEYS = new Set([
    "inputimages",
    "input_images",
    "imagereference",
    "image_reference",
    "referenceimages",
    "reference_images",
    "startimagemedia",
    "start_image_media",
    "endimagemedia",
    "end_image_media",
  ]);
  const INPUT_ROLES = new Set([
    "input_image",
    "start_image",
    "end_image",
    "reference",
    "reference_image",
    "style_reference",
    "motion_reference",
  ]);

  function isHiggsfieldPage(hostname) {
    const host = String(
      hostname || globalScope.location?.hostname || "",
    ).toLowerCase();
    return host === "higgsfield.ai" || host.endsWith(".higgsfield.ai");
  }

  function normalizeUrl(value) {
    return String(value || "").trim().replace(/^["']|["']$/g, "");
  }

  function isSaveableUrl(value) {
    const url = normalizeUrl(value);
    return (
      url.startsWith("blob:") ||
      /^data:image\/(png|jpe?g|webp|avif)/i.test(url) ||
      /^https?:/i.test(url)
    );
  }

  function getMediaUrl(el) {
    if (!el) return "";
    const tagName = String(el.tagName || "").toLowerCase();
    if (tagName === "video") {
      const source = el.querySelector?.("source[src]");
      const directUrl = normalizeUrl(
        el.currentSrc || el.src || source?.src || source?.getAttribute?.("src"),
      );
      if (/^https?:/i.test(directUrl)) return directUrl;
      for (const root of getFrameworkRoots(el)) {
        const frameworkUrl = findVideoUrlInValue(root);
        if (frameworkUrl) return frameworkUrl;
      }
      return directUrl;
    }
    if (tagName === "img") {
      return normalizeUrl(el.currentSrc || el.src || "");
    }
    return "";
  }

  function isQualifiedMediaElement(el, options = {}) {
    if (!el || String(el.tagName || "").toLowerCase() !== "video") return false;
    if (options.badgeAttr && el.hasAttribute?.(options.badgeAttr)) return false;
    if (!isSaveableUrl(getMediaUrl(el))) return false;

    const rect = el.getBoundingClientRect?.();
    const width = Math.max(
      Number(rect?.width) || 0,
      Number(el.clientWidth) || 0,
      Number(el.offsetWidth) || 0,
    );
    const height = Math.max(
      Number(rect?.height) || 0,
      Number(el.clientHeight) || 0,
      Number(el.offsetHeight) || 0,
    );
    return width >= MIN_RENDERED_WIDTH && height >= MIN_RENDERED_HEIGHT;
  }

  function looksLikePromptText(value) {
    const text = String(value || "").trim();
    if (text.length < 12 || /^https?:\/\//i.test(text)) return false;
    if (/^[\w-]+\.(png|jpe?g|webp|avif|mp4|webm|mov)$/i.test(text)) return false;
    return text.split(/\s+/).length >= 3;
  }

  function walkObject(value, visit, seen = new WeakSet(), depth = 0) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) {
      return;
    }
    seen.add(value);
    visit(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        walkObject(child, visit, seen, depth + 1);
      }
    }
  }

  function getFrameworkRoots(el) {
    const roots = [];
    let node = el;
    for (let depth = 0; depth < 10 && node; depth++, node = node.parentElement) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactProps")) roots.push(node[key]);
        if (!key.startsWith("__reactFiber")) continue;
        let fiber = node[key];
        for (let hops = 0; hops < 24 && fiber; hops++, fiber = fiber.return) {
          if (fiber.memoizedProps) roots.push(fiber.memoizedProps);
          if (fiber.pendingProps) roots.push(fiber.pendingProps);
        }
      }
    }
    return roots;
  }

  function findPromptInValue(root) {
    let result = "";
    walkObject(root, (value) => {
      if (result) return;
      for (const [key, child] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase().replace(/[^a-z_]/g, "");
        if (
          PROMPT_KEYS.has(normalizedKey) &&
          typeof child === "string" &&
          looksLikePromptText(child)
        ) {
          result = child.trim();
          return;
        }
      }
    });
    return result;
  }

  function findVideoUrlInValue(root) {
    let result = "";
    walkObject(root, (value) => {
      if (result) return;
      const role = String(value.role || "").toLowerCase();
      if (INPUT_ROLES.has(role)) return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child !== "string" || !isSaveableUrl(child)) continue;
        const normalizedKey = String(key).toLowerCase().replace(/[^a-z_]/g, "");
        if (
          normalizedKey === "videourl" ||
          normalizedKey === "video_url" ||
          normalizedKey === "outputurl" ||
          normalizedKey === "output_url" ||
          normalizedKey === "resulturl" ||
          normalizedKey === "result_url" ||
          /\.(mp4|webm|mov)(?:[?#]|$)/i.test(child)
        ) {
          result = normalizeUrl(child);
          return;
        }
      }
    });
    return result;
  }

  function extractPrompt(el, doc) {
    for (const name of ["data-prompt", "aria-label", "title"]) {
      const value = el?.getAttribute?.(name);
      if (looksLikePromptText(value)) return String(value).trim();
    }
    for (const root of getFrameworkRoots(el)) {
      const prompt = findPromptInValue(root);
      if (prompt) return prompt;
    }

    let node = el;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const promptNode = node.querySelector?.(
        '[data-testid*="prompt" i], [data-tour-anchor*="prompt" i], textarea#prompt, textarea[name*="prompt" i]',
      );
      const prompt = promptNode?.value || promptNode?.textContent;
      if (looksLikePromptText(prompt)) return String(prompt).trim();
    }

    const root = doc || globalScope.document;
    for (const input of root?.querySelectorAll?.(
      'textarea#prompt, textarea[name*="prompt" i], textarea[placeholder*="prompt" i], [contenteditable="true"][data-testid*="prompt" i]',
    ) || []) {
      const prompt = input.value || input.textContent;
      if (looksLikePromptText(prompt)) return String(prompt).trim();
    }
    return "";
  }

  function readUrlFromMedia(value) {
    if (typeof value === "string") return isSaveableUrl(value) ? normalizeUrl(value) : "";
    if (!value || typeof value !== "object") return "";
    for (const key of ["url", "src", "imageUrl", "image_url", "thumbnail"]) {
      if (isSaveableUrl(value[key])) return normalizeUrl(value[key]);
    }
    if (value.data) return readUrlFromMedia(value.data);
    return "";
  }

  function extractInputImagesFromValue(root) {
    const results = [];
    const seenUrls = new Set();
    const add = (value, role) => {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const url = readUrlFromMedia(item);
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        results.push({ url, role: role || "reference" });
      }
    };

    walkObject(root, (value) => {
      const role = String(value.role || value.type || "").toLowerCase();
      if (INPUT_ROLES.has(role)) add(value.data || value, role);
      for (const [key, child] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase().replace(/[^a-z_]/g, "");
        if (INPUT_KEYS.has(normalizedKey)) add(child, normalizedKey);
      }
    });
    const priority = (role) => {
      if (String(role).includes("start")) return 0;
      if (String(role).includes("end")) return 1;
      return 2;
    };
    return results.sort((a, b) => priority(a.role) - priority(b.role));
  }

  function extractInputImages(el) {
    const results = [];
    const seen = new Set();
    for (const root of getFrameworkRoots(el)) {
      for (const item of extractInputImagesFromValue(root)) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        results.push(item);
      }
    }
    return results.slice(0, 6);
  }

  function getTagNames() {
    return ["higgsfield", "higgsfield-video"];
  }

  function getSaveContext(el, doc) {
    const imageUrl = getMediaUrl(el);
    if (!imageUrl) return null;
    return {
      imageUrl,
      promptText: extractPrompt(el, doc),
      inputImages: extractInputImages(el),
      modelName: "Higgsfield",
      tagNames: getTagNames(),
      mediaType: "video",
      imageWidth: Number(el?.videoWidth) || undefined,
      imageHeight: Number(el?.videoHeight) || undefined,
    };
  }

  globalScope.SaveToGalleryHiggsfield = {
    MIN_RENDERED_HEIGHT,
    MIN_RENDERED_WIDTH,
    extractInputImages,
    extractInputImagesFromValue,
    extractPrompt,
    findVideoUrlInValue,
    findPromptInValue,
    getMediaUrl,
    getSaveContext,
    getTagNames,
    isHiggsfieldPage,
    isQualifiedMediaElement,
    looksLikePromptText,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
