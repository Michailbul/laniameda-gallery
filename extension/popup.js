const dropUpload = globalThis.SaveToGalleryDropUpload;

const apiUrlInput = document.getElementById("apiUrl");
const apiTokenInput = document.getElementById("apiToken");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const siteToggleBtn = document.getElementById("siteToggle");
const siteNameEl = document.getElementById("siteName");
const siteHintEl = document.getElementById("siteHint");
const defaultCollectionEl = document.getElementById("defaultCollection");
const modeBadgeEl = document.getElementById("modeBadge");
const addModeTabEl = document.getElementById("addModeTab");
const bookmarkModeTabEl = document.getElementById("bookmarkModeTab");
const addModePanelEl = document.getElementById("addModePanel");
const bookmarkModePanelEl = document.getElementById("bookmarkModePanel");

const bookmarkUrlEl = document.getElementById("bookmarkUrl");
const bookmarkTitleEl = document.getElementById("bookmarkTitle");
const bookmarkDescriptionEl = document.getElementById("bookmarkDescription");
const bookmarkSaveBtn = document.getElementById("bookmarkSave");
const bookmarkStatusEl = document.getElementById("bookmarkStatus");

const uploadCollectionEl = document.getElementById("uploadCollection");
const uploadTagsEl = document.getElementById("uploadTags");
const midjourneySelectionEl = document.getElementById("midjourneySelection");
const midjourneyPreviewEl = document.getElementById("midjourneyPreview");
const midjourneySelectionTitleEl = document.getElementById("midjourneySelectionTitle");
const midjourneySelectionEmptyEl = document.getElementById("midjourneySelectionEmpty");
const addSelectedAssetBtn = document.getElementById("addSelectedAsset");
const addSelectedStatusEl = document.getElementById("addSelectedStatus");
const newCollectionToggleBtn = document.getElementById("newCollectionToggle");
const newCollectionRowEl = document.getElementById("newCollectionRow");
const newCollectionNameEl = document.getElementById("newCollectionName");
const newCollectionSaveBtn = document.getElementById("newCollectionSave");
const dropZoneEl = document.getElementById("dropZone");
const chooseFilesBtn = document.getElementById("chooseFiles");
const chooseFolderBtn = document.getElementById("chooseFolder");
const fileInputEl = document.getElementById("fileInput");
const folderInputEl = document.getElementById("folderInput");
const queueShellEl = document.getElementById("queueShell");
const queueListEl = document.getElementById("queueList");
const queueCountEl = document.getElementById("queueCount");
const clearQueueBtn = document.getElementById("clearQueue");
const uploadQueueBtn = document.getElementById("uploadQueue");
const retryFailedBtn = document.getElementById("retryFailed");
const uploadStatusEl = document.getElementById("uploadStatus");

const SAVE_ROUTE_PATH = "/api/extension/save";
const CANONICAL_API_HOST = "gallery.laniameda.space";
const DEFAULT_API_URL = `https://${CANONICAL_API_HOST}${SAVE_ROUTE_PATH}`;
const DISABLED_HOSTS_KEY = "disabledHosts";
const DEFAULT_FOLDER_ID_KEY = "defaultFolderId";
const UPLOAD_FOLDER_ID_KEY = "uploadFolderId";
const UPLOAD_TAG_NAMES_KEY = "uploadTagNames";
const EXTENSION_MODE_KEY = "extensionMode";
// The remembered "last save" preset (written by content.js) normally outranks
// the default collection, so changing the default here has to clear it.
const LAST_FOLDER_IDS_KEY = "lastFolderIds";
const LAST_FOLDER_ID_KEY = "lastFolderId";
const LAST_COLLECTION_PILLAR_KEY = "lastCollectionPillar";
// Keep in sync with background.js — both rewrite stored URLs off older hosts.
const LEGACY_API_HOSTS = new Set([
  "laniameda.gallery",
  "laniameda-galery.vercel.app",
]);

let currentSiteHost = "";
let currentTabId = null;
let currentTabUrl = "";
let currentTabTitle = "";
let storedDefaultFolderId = "";
let loadedFolders = [];
let queueSequence = 0;
let uploadQueue = [];
let isUploading = false;
let extensionMode = "add";
let activeMidjourneySelection = null;

const normalizeApiUrl = (rawValue) => {
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
    url.pathname = SAVE_ROUTE_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return DEFAULT_API_URL;
  }
};

const setStatus = (message) => {
  statusEl.textContent = message;
};

const setBookmarkStatus = (message, tone) => {
  bookmarkStatusEl.textContent = message ?? "";
  if (tone) {
    bookmarkStatusEl.dataset.tone = tone;
  } else {
    delete bookmarkStatusEl.dataset.tone;
  }
};

const setUploadStatus = (message, tone) => {
  uploadStatusEl.textContent = message ?? "";
  if (tone) {
    uploadStatusEl.dataset.tone = tone;
  } else {
    delete uploadStatusEl.dataset.tone;
  }
};

const setAddSelectedStatus = (message, tone) => {
  addSelectedStatusEl.textContent = message ?? "";
  if (tone) {
    addSelectedStatusEl.dataset.tone = tone;
  } else {
    delete addSelectedStatusEl.dataset.tone;
  }
};

const setExtensionMode = (mode, { persist = false } = {}) => {
  extensionMode = mode === "bookmark" ? "bookmark" : "add";
  const isAddMode = extensionMode === "add";
  addModeTabEl.setAttribute("aria-selected", String(isAddMode));
  bookmarkModeTabEl.setAttribute("aria-selected", String(!isAddMode));
  addModePanelEl.hidden = !isAddMode;
  bookmarkModePanelEl.hidden = isAddMode;
  modeBadgeEl.textContent = `${isAddMode ? "add" : "bookmark"} mode · v0.10`;
  if (persist) {
    void chrome.storage.sync.set({ [EXTENSION_MODE_KEY]: extensionMode });
  }
};

const normalizeHost = (rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const normalizeFolders = (rawFolders) => {
  if (!Array.isArray(rawFolders)) return [];
  return rawFolders
    .map((folder) => ({
      id: String(folder?._id || folder?.id || "").trim(),
      name: String(folder?.name || "").trim(),
      parentFolderId: String(folder?.parentFolderId || "").trim(),
    }))
    .filter((folder) => folder.id && folder.name);
};

// Settings still save without a collection list, but the failure has to be
// visible: a 401 here is the same missing/stale token that breaks every save.
const loadFolders = async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getFolders" });
    if (response?.ok) {
      return { folders: normalizeFolders(response.folders), error: "" };
    }
    return { folders: [], error: response?.error || "Could not load collections." };
  } catch (err) {
    return { folders: [], error: err?.message || "Could not load collections." };
  }
};

const renderDefaultCollectionOptions = (folders, selectedId) => {
  if (!defaultCollectionEl) return;
  defaultCollectionEl.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No default collection";
  defaultCollectionEl.appendChild(none);

  for (const folder of folders.filter((entry) => !entry.parentFolderId)) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    defaultCollectionEl.appendChild(option);
  }

  defaultCollectionEl.value =
    selectedId &&
    folders.some((folder) => !folder.parentFolderId && folder.id === selectedId)
      ? selectedId
      : "";
  defaultCollectionEl.disabled = false;
};

const renderUploadCollectionOptions = (folders, selectedId) => {
  if (!uploadCollectionEl) return;
  uploadCollectionEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "No collection (uncategorized)";
  uploadCollectionEl.appendChild(placeholder);

  const roots = folders.filter((folder) => !folder.parentFolderId);
  const rootIds = new Set(roots.map((folder) => folder.id));
  for (const root of roots) {
    const rootOption = document.createElement("option");
    rootOption.value = root.id;
    rootOption.textContent = root.name;
    uploadCollectionEl.appendChild(rootOption);

    for (const child of folders.filter((folder) => folder.parentFolderId === root.id)) {
      const childOption = document.createElement("option");
      childOption.value = child.id;
      childOption.textContent = `↳ ${root.name} / ${child.name}`;
      uploadCollectionEl.appendChild(childOption);
    }
  }

  for (const folder of folders.filter(
    (entry) => entry.parentFolderId && !rootIds.has(entry.parentFolderId),
  )) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    uploadCollectionEl.appendChild(option);
  }

  uploadCollectionEl.value = folders.some((folder) => folder.id === selectedId)
    ? selectedId
    : "";
  uploadCollectionEl.disabled = false;
};

const readUploadTagNames = () => {
  const tagNames = [];
  const seen = new Set();
  const add = (value) => {
    const tagName = String(value || "").trim();
    const key = tagName.toLowerCase();
    if (!tagName || seen.has(key)) return;
    seen.add(key);
    tagNames.push(tagName);
  };

  for (const value of String(uploadTagsEl?.value || "").split(",")) add(value);
  return tagNames;
};

const renderCollectionSelectors = ({ uploadFolderId } = {}) => {
  renderDefaultCollectionOptions(loadedFolders, storedDefaultFolderId);
  renderUploadCollectionOptions(
    loadedFolders,
    uploadFolderId ?? uploadCollectionEl?.value ?? "",
  );
  renderQueue();
};

const getCurrentTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
};

const setSiteUiState = ({ host, isDisabled, isSupported }) => {
  if (!siteNameEl || !siteHintEl || !siteToggleBtn) return;
  if (!isSupported || !host) {
    siteNameEl.textContent = "Unavailable on this page";
    siteHintEl.textContent = "Open a normal website tab to pause or resume the extension here.";
    siteToggleBtn.textContent = "No website detected";
    siteToggleBtn.disabled = true;
    return;
  }

  siteNameEl.textContent = host;
  siteHintEl.textContent = isDisabled
    ? "The save badge is paused on this site."
    : "The save badge is active on this site.";
  siteToggleBtn.textContent = isDisabled
    ? "Enable on this site"
    : "Pause on this site";
  siteToggleBtn.disabled = false;
  siteToggleBtn.dataset.state = isDisabled ? "paused" : "active";
};

const isBookmarkableUrl = (rawUrl) => {
  if (!rawUrl) return false;
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const setBookmarkFormState = ({ tab, resetFields = false }) => {
  const url = tab?.url ?? "";
  const title = tab?.title ?? "";
  currentTabUrl = url;
  currentTabTitle = title;

  if (!isBookmarkableUrl(url)) {
    bookmarkUrlEl.textContent = "Open a normal http(s) page to bookmark it.";
    bookmarkTitleEl.value = "";
    bookmarkTitleEl.disabled = true;
    bookmarkDescriptionEl.disabled = true;
    bookmarkSaveBtn.disabled = true;
    return;
  }

  bookmarkUrlEl.textContent = url;
  if (resetFields || !bookmarkTitleEl.value) bookmarkTitleEl.value = title;
  if (resetFields) bookmarkDescriptionEl.value = "";
  bookmarkTitleEl.disabled = false;
  bookmarkDescriptionEl.disabled = false;
  bookmarkSaveBtn.disabled = false;
};

const isMidjourneyJobUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return /(^|\.)midjourney\.com$/i.test(url.hostname) && /^\/jobs\//.test(url.pathname);
  } catch {
    return false;
  }
};

const clearMidjourneySelection = () => {
  activeMidjourneySelection = null;
  midjourneySelectionEl.hidden = true;
  midjourneySelectionEmptyEl.hidden = true;
  midjourneyPreviewEl.removeAttribute("src");
  addSelectedAssetBtn.disabled = true;
  setAddSelectedStatus("");
};

const refreshMidjourneySelection = async () => {
  clearMidjourneySelection();
  if (currentTabId === null || !isMidjourneyJobUrl(currentTabUrl)) return;

  midjourneySelectionEmptyEl.textContent = "Finding the selected Midjourney image…";
  midjourneySelectionEmptyEl.hidden = false;
  try {
    const selection = await chrome.tabs.sendMessage(currentTabId, {
      action: "getActiveMidjourneyAsset",
    });
    if (!selection?.available) {
      midjourneySelectionEmptyEl.textContent =
        selection?.error || "Open a generated image in the Midjourney job viewer.";
      return;
    }

    activeMidjourneySelection = selection;
    midjourneySelectionEmptyEl.hidden = true;
    midjourneySelectionEl.hidden = false;
    midjourneyPreviewEl.src = selection.previewUrl;
    midjourneySelectionTitleEl.textContent = selection.selectedIndex
      ? `Image ${selection.selectedIndex}`
      : "Current image";
    addSelectedAssetBtn.disabled = false;
  } catch {
    midjourneySelectionEmptyEl.textContent =
      "Reload this Midjourney tab once, then the selected image will appear here.";
  }
};

const loadPopupState = async () => {
  const [cfg, localCfg] = await Promise.all([
    chrome.storage.sync.get([
      "apiUrl",
      "apiToken",
      DISABLED_HOSTS_KEY,
      DEFAULT_FOLDER_ID_KEY,
      UPLOAD_FOLDER_ID_KEY,
      EXTENSION_MODE_KEY,
    ]),
    chrome.storage.local.get([UPLOAD_TAG_NAMES_KEY]),
  ]);

  setExtensionMode(cfg[EXTENSION_MODE_KEY]);
  uploadTagsEl.value = Array.isArray(localCfg[UPLOAD_TAG_NAMES_KEY])
    ? localCfg[UPLOAD_TAG_NAMES_KEY].join(", ")
    : "";

  apiUrlInput.value = normalizeApiUrl(cfg.apiUrl);
  if (apiTokenInput) {
    apiTokenInput.value = typeof cfg.apiToken === "string" ? cfg.apiToken : "";
  }

  const disabledHosts = Array.isArray(cfg[DISABLED_HOSTS_KEY])
    ? cfg[DISABLED_HOSTS_KEY].map((host) => String(host).toLowerCase())
    : [];
  const currentTab = await getCurrentTab();
  const currentHost = normalizeHost(currentTab?.url);
  currentSiteHost = currentHost;
  currentTabId = typeof currentTab?.id === "number" ? currentTab.id : null;

  setSiteUiState({
    host: currentHost,
    isDisabled: currentHost ? disabledHosts.includes(currentHost) : false,
    isSupported: Boolean(currentHost && currentTabId !== null),
  });
  setBookmarkFormState({ tab: currentTab, resetFields: true });
  await refreshMidjourneySelection();

  storedDefaultFolderId = String(cfg[DEFAULT_FOLDER_ID_KEY] || "").trim();
  const hasStoredUploadFolderId = Object.prototype.hasOwnProperty.call(
    cfg,
    UPLOAD_FOLDER_ID_KEY,
  );
  const storedUploadFolderId = String(cfg[UPLOAD_FOLDER_ID_KEY] || "").trim();
  defaultCollectionEl.disabled = true;
  uploadCollectionEl.disabled = true;
  const { folders, error } = await loadFolders();
  loadedFolders = folders;
  renderCollectionSelectors({
    uploadFolderId: hasStoredUploadFolderId
      ? storedUploadFolderId
      : storedDefaultFolderId,
  });
  if (error) {
    setStatus(
      /\b401\b|unauthorized/i.test(error)
        ? "Collections unavailable — the API token is missing or wrong."
        : `Collections unavailable — ${error}`.slice(0, 160),
    );
  }
};

const refreshCurrentTabContext = async () => {
  const [currentTab, cfg] = await Promise.all([
    getCurrentTab(),
    chrome.storage.sync.get([DISABLED_HOSTS_KEY]),
  ]);
  const currentHost = normalizeHost(currentTab?.url);
  const disabledHosts = Array.isArray(cfg[DISABLED_HOSTS_KEY])
    ? cfg[DISABLED_HOSTS_KEY].map((host) => String(host).toLowerCase())
    : [];
  currentSiteHost = currentHost;
  currentTabId = typeof currentTab?.id === "number" ? currentTab.id : null;
  setSiteUiState({
    host: currentHost,
    isDisabled: currentHost ? disabledHosts.includes(currentHost) : false,
    isSupported: Boolean(currentHost && currentTabId !== null),
  });
  setBookmarkFormState({ tab: currentTab, resetFields: true });
  await refreshMidjourneySelection();
};

const queueStatusText = (item) => {
  const size = dropUpload.formatBytes(item.file.size);
  if (item.status === "preparing") return `${size} · preparing preview`;
  if (item.status === "uploading") return `${size} · ${item.progress || 0}% uploaded`;
  if (item.status === "saving") return `${size} · updating vault`;
  if (item.status === "saved") {
    return item.wasDuplicate ? `${size} · existing asset updated` : `${size} · saved`;
  }
  if (item.status === "error") return item.error || "Upload failed";
  return `${size} · ready`;
};

function renderQueue() {
  const readyCount = uploadQueue.filter((item) => item.status === "ready").length;
  const failedCount = uploadQueue.filter((item) => item.status === "error").length;
  const savedCount = uploadQueue.filter((item) => item.status === "saved").length;
  queueCountEl.textContent = uploadQueue.length
    ? `${uploadQueue.length} asset${uploadQueue.length === 1 ? "" : "s"}`
    : "empty";
  queueShellEl.hidden = uploadQueue.length === 0;
  queueListEl.innerHTML = "";

  for (const item of uploadQueue) {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.dataset.status = item.status;

    const thumb = document.createElement("div");
    thumb.className = "queue-thumb";
    if (item.previewUrl && item.mediaType === "image") {
      const image = document.createElement("img");
      image.src = item.previewUrl;
      image.alt = "";
      thumb.appendChild(image);
    } else {
      thumb.textContent = item.mediaType === "video" ? "MOV" : "IMG";
    }

    const copy = document.createElement("div");
    const name = document.createElement("p");
    name.className = "queue-name";
    name.textContent = item.file.name;
    name.title = item.relativePath;
    const meta = document.createElement("p");
    meta.className = "queue-meta";
    meta.textContent = queueStatusText(item);
    meta.title = item.status === "error" ? item.error : item.relativePath;
    copy.append(name, meta);
    if (["preparing", "uploading", "saving"].includes(item.status)) {
      const progress = document.createElement("progress");
      progress.className = "queue-progress";
      progress.max = 100;
      progress.value = item.status === "preparing"
        ? 8
        : item.status === "saving"
          ? 96
          : item.progress || 12;
      copy.appendChild(progress);
    }

    const remove = document.createElement("button");
    remove.className = "queue-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove from queue";
    remove.disabled = isUploading;
    remove.addEventListener("click", () => removeQueueItem(item.id));
    row.append(thumb, copy, remove);
    queueListEl.appendChild(row);
  }

  uploadQueueBtn.disabled = isUploading || readyCount === 0;
  uploadQueueBtn.textContent = isUploading
    ? "Uploading…"
    : readyCount > 0
      ? `Upload ${readyCount} asset${readyCount === 1 ? "" : "s"}`
      : savedCount > 0
        ? "Uploaded"
        : "Upload assets";
  retryFailedBtn.hidden = failedCount === 0;
  retryFailedBtn.disabled = isUploading;
  retryFailedBtn.textContent = `Retry ${failedCount}`;
  clearQueueBtn.disabled = isUploading;
  uploadTagsEl.disabled = isUploading;
}

const addQueueItems = ({ accepted, rejectedCount, truncatedCount }) => {
  const existing = new Set(uploadQueue.map((item) => dropUpload.queueIdentity(item)));
  let addedCount = 0;
  for (const acceptedItem of accepted) {
    if (uploadQueue.length >= dropUpload.MAX_QUEUE_FILES) break;
    if (existing.has(dropUpload.queueIdentity(acceptedItem))) continue;
    existing.add(dropUpload.queueIdentity(acceptedItem));
    const contentType = dropUpload.inferContentType(acceptedItem.file);
    uploadQueue.push({
      id: `local-${Date.now()}-${queueSequence += 1}`,
      file: acceptedItem.file,
      relativePath: acceptedItem.relativePath,
      mediaType: contentType.startsWith("video/") ? "video" : "image",
      previewUrl: contentType.startsWith("image/")
        ? URL.createObjectURL(acceptedItem.file)
        : "",
      status: "ready",
      progress: 0,
      error: "",
    });
    addedCount += 1;
  }

  renderQueue();
  const notes = [];
  if (addedCount > 0) notes.push(`${addedCount} added`);
  if (rejectedCount > 0) notes.push(`${rejectedCount} unsupported skipped`);
  if (truncatedCount > 0 || uploadQueue.length >= dropUpload.MAX_QUEUE_FILES) {
    notes.push(`queue capped at ${dropUpload.MAX_QUEUE_FILES}`);
  }
  setUploadStatus(notes.join(" · ") || "Those assets are already queued.");
};

const removeQueueItem = (id) => {
  const item = uploadQueue.find((entry) => entry.id === id);
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  uploadQueue = uploadQueue.filter((entry) => entry.id !== id);
  renderQueue();
};

const clearQueue = () => {
  for (const item of uploadQueue) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
  uploadQueue = [];
  renderQueue();
  setUploadStatus("");
};

const updateQueueItem = (id, patch) => {
  const item = uploadQueue.find((entry) => entry.id === id);
  if (!item) return;
  Object.assign(item, patch);
  renderQueue();
};

const uploadToSignedUrl = (url, file, contentType, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed (${xhr.status || "unknown"}).`));
    };
    xhr.onerror = () => reject(new Error("R2 upload failed — check the network connection."));
    xhr.send(file);
  });

const uploadOneQueueItem = async (item, folderId, tagNames) => {
  try {
    if (!item.prepared) {
      updateQueueItem(item.id, { status: "preparing", error: "", progress: 0 });
      item.prepared = await dropUpload.prepareMedia(item.file);
    }

    if (!item.r2Key) {
      const session = await chrome.runtime.sendMessage({ action: "prepareAssetUpload" });
      if (!session?.ok || !session.key || !session.url) {
        throw new Error(session?.error || "Could not prepare the R2 upload.");
      }
      updateQueueItem(item.id, { status: "uploading", progress: 1 });
      await uploadToSignedUrl(
        session.url,
        item.file,
        item.prepared.contentType,
        (progress) => updateQueueItem(item.id, { status: "uploading", progress }),
      );
      item.r2Key = session.key;
    }

    if (!item.metadataSynced) {
      const completed = await chrome.runtime.sendMessage({
        action: "completeAssetUpload",
        key: item.r2Key,
      });
      if (!completed?.ok) {
        throw new Error(completed?.error || "Could not finalize the R2 upload.");
      }
      item.metadataSynced = true;
    }

    updateQueueItem(item.id, { status: "saving", progress: 100 });
    const ingestKey = item.prepared.contentHash
      ? `extension-upload:${item.prepared.contentHash}`
      : `extension-upload:${item.relativePath}:${item.file.size}:${item.file.lastModified}`.slice(0, 500);
    const saveMessage = {
      action: "saveDroppedAsset",
      tagNames,
      ingestKey,
      r2Key: item.r2Key,
      mediaContentHash: item.prepared.contentHash,
      mediaContentType: item.prepared.contentType,
      mediaSize: item.file.size,
      mediaFileName: item.file.name,
      imageWidth: item.prepared.width,
      imageHeight: item.prepared.height,
      mediaType: item.prepared.mediaType,
      posterFile: item.prepared.posterFile,
    };
    if (folderId) {
      saveMessage.folderId = folderId;
      saveMessage.folderIds = [folderId];
    }
    const saved = await chrome.runtime.sendMessage(saveMessage);
    if (!saved?.ok) throw new Error(saved?.error || "Gallery save failed.");

    updateQueueItem(item.id, {
      status: "saved",
      progress: 100,
      error: "",
      wasDuplicate: Boolean(saved.result?.duplicateMedia),
    });
  } catch (error) {
    updateQueueItem(item.id, {
      status: "error",
      error: error?.message ? String(error.message).slice(0, 240) : "Upload failed.",
    });
  }
};

const runUploadQueue = async (statuses) => {
  if (isUploading) return;
  const folderId = uploadCollectionEl.value;
  const tagNames = readUploadTagNames();
  const candidates = uploadQueue.filter((item) => statuses.includes(item.status));
  if (candidates.length === 0) return;

  isUploading = true;
  setUploadStatus(`Uploading ${candidates.length} asset${candidates.length === 1 ? "" : "s"}…`);
  renderQueue();
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const item = candidates[cursor];
      cursor += 1;
      await uploadOneQueueItem(item, folderId, tagNames);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, worker));
  isUploading = false;
  renderQueue();

  const failed = candidates.filter((item) => item.status === "error").length;
  const saved = candidates.length - failed;
  const duplicates = candidates.filter(
    (item) => item.status === "saved" && item.wasDuplicate,
  ).length;
  const created = saved - duplicates;
  const notes = [];
  if (created > 0) notes.push(`${created} saved`);
  if (duplicates > 0) notes.push(`${duplicates} existing updated`);
  if (folderId) notes.push("filed in 1 collection");
  if (tagNames.length > 0) {
    notes.push(`${tagNames.length} tag${tagNames.length === 1 ? "" : "s"} applied`);
  }
  if (failed > 0) {
    notes.push(`${failed} failed`);
    setUploadStatus(
      `${notes.join(" · ")}. Failed rows keep their uploaded bytes for a quick retry.`,
      "error",
    );
  } else {
    setUploadStatus(notes.join(" · ") || "Upload complete.", "success");
  }
};

saveBtn.addEventListener("click", () => {
  const apiUrl = normalizeApiUrl(apiUrlInput.value);
  const apiToken = apiTokenInput ? apiTokenInput.value.trim() : "";
  const defaultFolderId = defaultCollectionEl?.value || "";

  if (defaultFolderId !== storedDefaultFolderId) {
    chrome.storage.sync.remove([
      LAST_FOLDER_IDS_KEY,
      LAST_FOLDER_ID_KEY,
      LAST_COLLECTION_PILLAR_KEY,
    ]);
  }
  storedDefaultFolderId = defaultFolderId;

  chrome.storage.sync.set({ apiUrl, apiToken, [DEFAULT_FOLDER_ID_KEY]: defaultFolderId }, () => {
    apiUrlInput.value = apiUrl;
    setStatus("Settings saved.");
    saveBtn.textContent = "Saved";
    window.setTimeout(() => { saveBtn.textContent = "Save settings"; }, 1400);

    void loadFolders().then(({ folders, error }) => {
      loadedFolders = folders;
      renderCollectionSelectors();
      if (error) {
        setStatus(
          /\b401\b|unauthorized/i.test(error)
            ? "Saved, but the API token was rejected (401)."
            : `Saved, but collections failed: ${error}`.slice(0, 160),
        );
      }
    });
  });
});

bookmarkSaveBtn.addEventListener("click", async () => {
  if (currentTabId === null || !isBookmarkableUrl(currentTabUrl)) {
    setBookmarkStatus("No bookmarkable page in this tab.", "error");
    return;
  }
  const title = bookmarkTitleEl.value.trim() || currentTabTitle.trim();
  const description = bookmarkDescriptionEl.value.trim();
  bookmarkSaveBtn.disabled = true;
  bookmarkSaveBtn.textContent = "Saving…";
  setBookmarkStatus("Capturing page…");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "bookmarkPage",
      tabId: currentTabId,
      sourceUrl: currentTabUrl,
      sourceTitle: currentTabTitle,
      title,
      description,
    });
    if (response?.ok) {
      setBookmarkStatus("Bookmarked to gallery.", "success");
      bookmarkSaveBtn.textContent = "Saved";
      bookmarkDescriptionEl.value = "";
      window.setTimeout(() => {
        bookmarkSaveBtn.textContent = "Bookmark page";
        bookmarkSaveBtn.disabled = false;
      }, 1400);
    } else {
      setBookmarkStatus((response?.error || "Save failed.").slice(0, 240), "error");
      bookmarkSaveBtn.textContent = "Bookmark page";
      bookmarkSaveBtn.disabled = false;
    }
  } catch (err) {
    setBookmarkStatus(err?.message ? err.message.slice(0, 240) : "Save failed.", "error");
    bookmarkSaveBtn.textContent = "Bookmark page";
    bookmarkSaveBtn.disabled = false;
  }
});

addModeTabEl.addEventListener("click", () => {
  setExtensionMode("add", { persist: true });
  void refreshMidjourneySelection();
});

bookmarkModeTabEl.addEventListener("click", () => {
  setExtensionMode("bookmark", { persist: true });
});

addSelectedAssetBtn.addEventListener("click", async () => {
  if (currentTabId === null || !activeMidjourneySelection) {
    setAddSelectedStatus("No selected image is ready.", "error");
    return;
  }

  const folderId = uploadCollectionEl.value;
  addSelectedAssetBtn.disabled = true;
  addSelectedAssetBtn.textContent = "Adding…";
  setAddSelectedStatus("Fetching original PNG…");
  try {
    const response = await chrome.tabs.sendMessage(currentTabId, {
      action: "saveActiveMidjourneyAsset",
      folderId: folderId || undefined,
      folderIds: folderId ? [folderId] : [],
      tagNames: readUploadTagNames(),
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Gallery save failed.");
    }

    const wasDuplicate = Boolean(response.result?.duplicateMedia);
    addSelectedAssetBtn.textContent = "Added";
    setAddSelectedStatus(
      wasDuplicate ? "Existing original updated." : "Original PNG added.",
      "success",
    );
    window.setTimeout(() => {
      addSelectedAssetBtn.textContent = "Add";
      addSelectedAssetBtn.disabled = false;
    }, 1600);
  } catch (error) {
    setAddSelectedStatus(error?.message || "Could not add this image.", "error");
    addSelectedAssetBtn.textContent = "Try again";
    addSelectedAssetBtn.disabled = false;
  }
});

siteToggleBtn?.addEventListener("click", async () => {
  if (!currentSiteHost) {
    setStatus("Open a website tab first.");
    return;
  }
  const cfg = await chrome.storage.sync.get([DISABLED_HOSTS_KEY]);
  const disabledHosts = Array.isArray(cfg[DISABLED_HOSTS_KEY])
    ? cfg[DISABLED_HOSTS_KEY].map((host) => String(host).toLowerCase())
    : [];
  const nextDisabled = !disabledHosts.includes(currentSiteHost);
  const nextHosts = nextDisabled
    ? [...disabledHosts, currentSiteHost]
    : disabledHosts.filter((host) => host !== currentSiteHost);
  await chrome.storage.sync.set({ [DISABLED_HOSTS_KEY]: nextHosts });

  if (currentTabId !== null) {
    try {
      await chrome.tabs.sendMessage(currentTabId, {
        action: "setSiteEnabled",
        enabled: !nextDisabled,
      });
    } catch {
      // Ignore missing content script; storage state is still persisted.
    }
  }
  setSiteUiState({ host: currentSiteHost, isDisabled: nextDisabled, isSupported: true });
  setStatus(nextDisabled ? `Paused on ${currentSiteHost}.` : `Enabled on ${currentSiteHost}.`);
});

uploadCollectionEl.addEventListener("change", async () => {
  await chrome.storage.sync.set({ [UPLOAD_FOLDER_ID_KEY]: uploadCollectionEl.value });
  renderQueue();
  setUploadStatus("");
});

uploadTagsEl.addEventListener("input", () => {
  void chrome.storage.local.set({
    [UPLOAD_TAG_NAMES_KEY]: readUploadTagNames(),
  });
});

newCollectionToggleBtn.addEventListener("click", () => {
  newCollectionRowEl.hidden = !newCollectionRowEl.hidden;
  if (!newCollectionRowEl.hidden) newCollectionNameEl.focus();
});

const createCollection = async () => {
  const name = newCollectionNameEl.value.trim();
  if (!name) {
    setUploadStatus("Enter a collection name.", "error");
    return;
  }
  newCollectionSaveBtn.disabled = true;
  newCollectionSaveBtn.textContent = "Creating…";
  try {
    const response = await chrome.runtime.sendMessage({ action: "createFolder", name });
    if (!response?.ok) throw new Error(response?.error || "Could not create collection.");
    loadedFolders = normalizeFolders(response.folders);
    const folderId = String(response.result?.folderId || "");
    renderCollectionSelectors({ uploadFolderId: folderId });
    await chrome.storage.sync.set({ [UPLOAD_FOLDER_ID_KEY]: folderId });
    newCollectionNameEl.value = "";
    newCollectionRowEl.hidden = true;
    setUploadStatus("Collection created and selected.", "success");
  } catch (error) {
    setUploadStatus(error?.message || "Could not create collection.", "error");
  } finally {
    newCollectionSaveBtn.disabled = false;
    newCollectionSaveBtn.textContent = "Create";
  }
};

newCollectionSaveBtn.addEventListener("click", createCollection);
newCollectionNameEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void createCollection();
});

chooseFilesBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  fileInputEl.click();
});
chooseFolderBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  folderInputEl.click();
});
dropZoneEl.addEventListener("click", (event) => {
  if (!event.target.closest("button")) fileInputEl.click();
});
dropZoneEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInputEl.click();
  }
});

for (const input of [fileInputEl, folderInputEl]) {
  input.addEventListener("change", () => {
    const available = Math.max(0, dropUpload.MAX_QUEUE_FILES - uploadQueue.length);
    addQueueItems(dropUpload.normalizePickedFiles(input.files, available));
    input.value = "";
  });
}

let dragDepth = 0;
dropZoneEl.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropZoneEl.dataset.dragging = "true";
});
dropZoneEl.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
dropZoneEl.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) delete dropZoneEl.dataset.dragging;
});
dropZoneEl.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  delete dropZoneEl.dataset.dragging;
  setUploadStatus("Reading dropped assets…");
  try {
    const available = Math.max(0, dropUpload.MAX_QUEUE_FILES - uploadQueue.length);
    addQueueItems(await dropUpload.collectDroppedFiles(event.dataTransfer, available));
  } catch (error) {
    setUploadStatus(error?.message || "Could not read that folder.", "error");
  }
});

// Never let a file dropped just outside the target navigate the side panel.
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

clearQueueBtn.addEventListener("click", clearQueue);
uploadQueueBtn.addEventListener("click", () => void runUploadQueue(["ready"]));
retryFailedBtn.addEventListener("click", () => void runUploadQueue(["error"]));
window.addEventListener("unload", () => {
  for (const item of uploadQueue) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
});
chrome.tabs.onActivated?.addListener(() => {
  void refreshCurrentTabContext();
});
chrome.tabs.onUpdated?.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title)) {
    void refreshCurrentTabContext();
  }
});

renderQueue();
loadPopupState().catch(() => {
  setStatus("Failed to load extension settings.");
});
