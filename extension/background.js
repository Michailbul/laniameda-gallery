// Save to Gallery — Background service worker

const CANONICAL_API_HOST = "laniameda-galery.vercel.app";
const SAVE_ROUTE_PATH = "/api/extension/save";
const BOOKMARK_ROUTE_PATH = "/api/extension/design/save";
const FOLDERS_ROUTE_PATH = "/api/extension/folders";
const DEFAULT_API_URL = `https://${CANONICAL_API_HOST}${SAVE_ROUTE_PATH}`;
const LEGACY_API_HOSTS = new Set(["laniameda.gallery"]);
const DEFAULT_FOLDER_ID_KEY = "defaultFolderId";
const LAST_FOLDER_ID_KEY = "lastFolderId";
const SAVE_IMAGE_CONTEXT_MENU_ID = "save-image-to-laniameda";
const DISABLED_HOSTS_KEY = "disabledHosts";
const BUILTIN_DISABLED_HOSTS = [
  "laniameda.gallery",
  "laniameda-galery.vercel.app",
  "localhost",
  "127.0.0.1",
];

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
      ["apiUrl", DEFAULT_FOLDER_ID_KEY, LAST_FOLDER_ID_KEY],
      (cfg) => resolve({
        apiUrl: normalizeApiUrl(cfg.apiUrl),
        defaultFolderId: String(cfg[DEFAULT_FOLDER_ID_KEY] || "").trim(),
        lastFolderId: String(cfg[LAST_FOLDER_ID_KEY] || "").trim(),
      })
    );
  });
}

function isMidjourneyDocumentUrl(rawUrl) {
  return getUrlHost(rawUrl)?.includes("midjourney.com") ?? false;
}

function isTabMessageUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function getUrlHost(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return "";
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeDisabledHosts(rawHosts) {
  if (!Array.isArray(rawHosts)) return [];
  return rawHosts
    .map((host) => String(host).trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

function normalizeFolderIds(rawFolderIds) {
  if (!Array.isArray(rawFolderIds)) return [];
  const seen = new Set();
  const folderIds = [];
  for (const rawFolderId of rawFolderIds) {
    const folderId = String(rawFolderId || "").trim();
    if (!folderId || seen.has(folderId)) continue;
    seen.add(folderId);
    folderIds.push(folderId);
  }
  return folderIds;
}

function isHostDisabled(disabledHosts, host) {
  if (!host) return false;
  return disabledHosts.some((disabledHost) =>
    host === disabledHost || host.endsWith(`.${disabledHost}`),
  );
}

async function isContextMenuSaveAllowed(sourceUrl) {
  const host = getUrlHost(sourceUrl);
  if (isMidjourneyDocumentUrl(sourceUrl)) return false;
  if (isHostDisabled(BUILTIN_DISABLED_HOSTS, host)) return false;

  const cfg = await chrome.storage.sync.get([DISABLED_HOSTS_KEY]);
  const disabledHosts = normalizeDisabledHosts(cfg[DISABLED_HOSTS_KEY]);
  return !isHostDisabled(disabledHosts, host);
}

async function getDefaultSaveFolderId() {
  const config = await getConfig();
  return config.defaultFolderId || config.lastFolderId || undefined;
}

async function saveToGallery(payload) {
  const config = await getConfig();
  const folderIds = normalizeFolderIds(payload.folderIds);
  const folderId = payload.folderId || folderIds[0] || undefined;

  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: payload.mode || "save",
        imageUrl: payload.imageUrl,
        sourceUrl: payload.sourceUrl,
        folderId,
        folderIds,
        promptText: payload.promptText || undefined,
        modelName: payload.modelName || undefined,
        tagNames: payload.tagNames || [],
        file: payload.file || undefined,
        imageWidth: payload.imageWidth || undefined,
        imageHeight: payload.imageHeight || undefined,
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Fetch image bytes from the service worker. With `<all_urls>` host permissions
// the worker bypasses page CORS, so signed/CORS-locked CDN images (Krea,
// Recraft, etc.) can be captured client-side instead of relying on a
// server-side refetch that those CDNs would reject.
async function fetchImageBytes(payload) {
  const imageUrl = typeof payload.imageUrl === "string" ? payload.imageUrl : "";
  if (!imageUrl) {
    return { ok: false, error: "imageUrl is required." };
  }

  let response;
  try {
    response = await fetch(imageUrl);
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
  }

  try {
    const blob = await response.blob();
    const contentType = blob.type || response.headers.get("content-type") || "image/jpeg";
    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    if (!base64) {
      return { ok: false, error: "Empty image payload." };
    }
    return { ok: true, base64, contentType };
  } catch (err) {
    return { ok: false, error: `Decode error: ${err.message}` };
  }
}

async function saveContextMenuImageInBackground({ imageUrl, sourceUrl, folderId }) {
  const captured = await fetchImageBytes({ imageUrl });
  const response = await saveToGallery({
    imageUrl,
    sourceUrl,
    folderId,
    file: captured?.ok
      ? {
          base64: captured.base64,
          contentType: captured.contentType,
        }
      : undefined,
  });
  return {
    ...response,
    captureError: captured?.ok ? undefined : captured?.error,
  };
}

async function handleImageContextMenuClick(info, tab) {
  if (info.menuItemId !== SAVE_IMAGE_CONTEXT_MENU_ID) return;

  const imageUrl = typeof info.srcUrl === "string" ? info.srcUrl : "";
  if (!imageUrl) return;

  const sourceUrl =
    (typeof info.pageUrl === "string" && info.pageUrl) ||
    (typeof info.frameUrl === "string" && info.frameUrl) ||
    tab?.url ||
    "";

  if (!(await isContextMenuSaveAllowed(sourceUrl))) {
    return;
  }

  const folderId = await getDefaultSaveFolderId();

  if (typeof tab?.id === "number" && isTabMessageUrl(sourceUrl)) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "saveImageFromContextMenu",
        imageUrl,
        sourceUrl,
        folderId,
      });
      if (response?.handled) return;
    } catch {
      // The content script is not reachable on every page. Fall back to a
      // service-worker save so the context menu still works for normal image URLs.
    }
  }

  const response = await saveContextMenuImageInBackground({
    imageUrl,
    sourceUrl,
    folderId,
  });
  if (!response.ok) {
    console.warn("[Save to Gallery] context menu save failed:", response);
  }
}

function installContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: SAVE_IMAGE_CONTEXT_MENU_ID,
        title: "Save to laniameda",
        contexts: ["image"],
      },
      () => {
        // Ignore duplicate/create timing errors across service-worker restarts.
        void chrome.runtime.lastError;
      },
    );
  });
}

function updateContextMenuVisibility(info, tab) {
  const sourceUrl =
    (typeof info?.pageUrl === "string" && info.pageUrl) ||
    (typeof info?.frameUrl === "string" && info.frameUrl) ||
    tab?.url ||
    "";

  isContextMenuSaveAllowed(sourceUrl).then((isAllowed) => {
    chrome.contextMenus.update(
      SAVE_IMAGE_CONTEXT_MENU_ID,
      { visible: Boolean(isAllowed) },
      () => {
        void chrome.runtime.lastError;
        chrome.contextMenus.refresh?.();
      },
    );
  }).catch(() => {});
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


// ── Collections (stored as `folders` rows) ──

async function getFolders() {
  const config = await getConfig();
  const foldersUrl = normalizeRouteUrl(config.apiUrl, FOLDERS_ROUTE_PATH);

  let response;
  try {
    response = await fetch(foldersUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}`, apiUrl: foldersUrl };
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
      apiUrl: foldersUrl,
      status: response.status,
    };
  }

  return { ok: true, folders: Array.isArray(data?.folders) ? data.folders : [] };
}

async function createFolder(payload) {
  const config = await getConfig();
  const foldersUrl = normalizeRouteUrl(config.apiUrl, FOLDERS_ROUTE_PATH);

  let response;
  try {
    response = await fetch(foldersUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        description: payload.description || undefined,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}`, apiUrl: foldersUrl };
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
      apiUrl: foldersUrl,
      status: response.status,
    };
  }

  return {
    ok: true,
    result: data?.result,
    folders: Array.isArray(data?.folders) ? data.folders : [],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "saveImage") {
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
      promptText: message.promptText,
      modelName: message.modelName,
      folderId: message.folderId,
      folderIds: message.folderIds,
      tagNames: message.tagNames,
      file: message.file,
      imageWidth: message.imageWidth,
      imageHeight: message.imageHeight,
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
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "fetchImageBytes") {
    fetchImageBytes({ imageUrl: message.imageUrl })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "getFolders") {
    getFolders()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "createFolder") {
    createFolder({
      name: message.name,
      description: message.description,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

installContextMenus();
chrome.runtime.onInstalled.addListener(installContextMenus);
chrome.runtime.onStartup.addListener(installContextMenus);
chrome.contextMenus.onShown?.addListener(updateContextMenuVisibility);
chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleImageContextMenuClick(info, tab).catch((err) => {
    console.warn("[Save to Gallery] context menu handler failed:", err);
  });
});
