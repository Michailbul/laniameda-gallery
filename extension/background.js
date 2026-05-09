// Save to Gallery — Background service worker

const CANONICAL_API_HOST = "laniameda-galery.vercel.app";
const SAVE_ROUTE_PATH = "/api/extension/save";
const BOOKMARK_ROUTE_PATH = "/api/extension/design/save";
const PILLARS_ROUTE_PATH = "/api/extension/pillars";
const DEFAULT_API_URL = `https://${CANONICAL_API_HOST}${SAVE_ROUTE_PATH}`;
const LEGACY_API_HOSTS = new Set(["laniameda.gallery"]);

function normalizeRouteUrl(rawValue, routePath) {
  const value =
    typeof rawValue === "string" && rawValue.trim()
      ? rawValue.trim()
      : DEFAULT_API_URL;

  try {
    const url = new URL(value);
    if (LEGACY_API_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      url.hostname = CANONICAL_API_HOST;
    }
    url.pathname = routePath;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    const fallback = new URL(DEFAULT_API_URL);
    fallback.pathname = routePath;
    return fallback.toString();
  }
}

function normalizeApiUrl(rawValue) {
  return normalizeRouteUrl(rawValue, SAVE_ROUTE_PATH);
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["apiUrl", "defaultPillar"],
      (cfg) => resolve({
        apiUrl: normalizeApiUrl(cfg.apiUrl),
        defaultPillar: cfg.defaultPillar || "dump",
      })
    );
  });
}

async function saveToGallery(payload) {
  const config = await getConfig();

  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: payload.mode || "save",
        imageUrl: payload.imageUrl,
        sourceUrl: payload.sourceUrl,
        pillar: payload.pillar || config.defaultPillar,
        promptText: payload.promptText || undefined,
        modelName: payload.modelName || undefined,
        tagNames: payload.tagNames || [],
        file: payload.file || undefined,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err.message}`,
      apiUrl: config.apiUrl,
    };
  }

  let rawText = "";
  let data = null;
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // body wasn't JSON — keep the raw text for the error message
  }

  if (!response.ok) {
    const detail = data?.error || rawText.slice(0, 500) || "(empty body)";
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}: ${detail}`,
      apiUrl: config.apiUrl,
      status: response.status,
    };
  }

  return { ok: true, result: data?.result };
}

async function captureTabScreenshot(tabId) {
  // Resolve the windowId from the tab so captureVisibleTab targets the right window.
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab?.windowId;
  if (typeof windowId !== "number") {
    throw new Error("Could not resolve window for tab.");
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Screenshot capture returned an empty result.");
  }
  // Strip the data:image/...;base64, prefix so Convex stores raw base64.
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
  if (!base64) {
    throw new Error("Screenshot is missing base64 payload.");
  }
  return base64;
}

async function bookmarkPage(payload) {
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
  if (!sourceUrl) {
    return { ok: false, error: "Source URL is required." };
  }
  const tabId = typeof payload.tabId === "number" ? payload.tabId : null;
  if (tabId === null) {
    return { ok: false, error: "Active tab id is required." };
  }

  let screenshotBase64;
  try {
    screenshotBase64 = await captureTabScreenshot(tabId);
  } catch (err) {
    return {
      ok: false,
      error: `Screenshot failed: ${err.message || String(err)}`,
    };
  }

  const config = await getConfig();
  const bookmarkUrl = normalizeRouteUrl(config.apiUrl, BOOKMARK_ROUTE_PATH);

  const body = {
    pillar: payload.pillar || config.defaultPillar,
    description: payload.description || undefined,
    captureKind: "website",
    saveIntent: "utility",
    inspirationType: "website",
    capture: {
      mode: "page",
      sourceUrl,
      sourceTitle: payload.sourceTitle || undefined,
      title: payload.title || undefined,
      screenshotBase64,
      screenshotContentType: "image/png",
    },
  };

  let response;
  try {
    response = await fetch(bookmarkUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err.message}`,
      apiUrl: bookmarkUrl,
    };
  }

  let rawText = "";
  let data = null;
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // body wasn't JSON
  }

  if (!response.ok) {
    const detail = data?.error || rawText.slice(0, 500) || "(empty body)";
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}: ${detail}`,
      apiUrl: bookmarkUrl,
      status: response.status,
    };
  }

  return { ok: true, result: data?.result };
}

async function getPillars() {
  const config = await getConfig();
  const pillarsUrl = normalizeRouteUrl(config.apiUrl, PILLARS_ROUTE_PATH);

  let response;
  try {
    response = await fetch(pillarsUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err.message}`,
      apiUrl: pillarsUrl,
    };
  }

  let rawText = "";
  let data = null;
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // body wasn't JSON
  }

  if (!response.ok) {
    const detail = data?.error || rawText.slice(0, 500) || "(empty body)";
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}: ${detail}`,
      apiUrl: pillarsUrl,
      status: response.status,
    };
  }

  return { ok: true, pillars: Array.isArray(data?.pillars) ? data.pillars : [] };
}

async function createPillar(payload) {
  const config = await getConfig();
  const pillarsUrl = normalizeRouteUrl(config.apiUrl, PILLARS_ROUTE_PATH);

  let response;
  try {
    response = await fetch(pillarsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: payload.label,
        key: payload.key || undefined,
        description: payload.description || undefined,
        color: payload.color || undefined,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err.message}`,
      apiUrl: pillarsUrl,
    };
  }

  let rawText = "";
  let data = null;
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // body wasn't JSON
  }

  if (!response.ok) {
    const detail = data?.error || rawText.slice(0, 500) || "(empty body)";
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}: ${detail}`,
      apiUrl: pillarsUrl,
      status: response.status,
    };
  }

  return {
    ok: true,
    result: data?.result,
    pillars: Array.isArray(data?.pillars) ? data.pillars : [],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "saveImage") {
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
      promptText: message.promptText,
      modelName: message.modelName,
      pillar: message.pillar,
      file: message.file,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "updatePrompt") {
    saveToGallery({
      mode: "updatePrompt",
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
      promptText: message.promptText,
      pillar: message.pillar,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "bookmarkPage") {
    bookmarkPage({
      tabId: message.tabId,
      sourceUrl: message.sourceUrl,
      sourceTitle: message.sourceTitle,
      title: message.title,
      description: message.description,
      pillar: message.pillar,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "getPillars") {
    getPillars()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "createPillar") {
    createPillar({
      label: message.label,
      key: message.key,
      description: message.description,
      color: message.color,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
