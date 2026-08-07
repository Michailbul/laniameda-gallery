const apiUrlInput = document.getElementById("apiUrl");
const apiTokenInput = document.getElementById("apiToken");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const siteToggleBtn = document.getElementById("siteToggle");
const siteNameEl = document.getElementById("siteName");
const siteHintEl = document.getElementById("siteHint");
const defaultCollectionEl = document.getElementById("defaultCollection");

const bookmarkUrlEl = document.getElementById("bookmarkUrl");
const bookmarkTitleEl = document.getElementById("bookmarkTitle");
const bookmarkDescriptionEl = document.getElementById("bookmarkDescription");
const bookmarkSaveBtn = document.getElementById("bookmarkSave");
const bookmarkStatusEl = document.getElementById("bookmarkStatus");

const SAVE_ROUTE_PATH = "/api/extension/save";
const CANONICAL_API_HOST = "gallery.laniameda.space";
const DEFAULT_API_URL = `https://${CANONICAL_API_HOST}${SAVE_ROUTE_PATH}`;
const DISABLED_HOSTS_KEY = "disabledHosts";
const DEFAULT_FOLDER_ID_KEY = "defaultFolderId";
// The remembered "last save" preset (written by content.js) normally outranks the
// default collection, so changing the default here has to clear it.
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

const normalizeHost = (rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return "";
  }

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

const getCurrentTab = async () => {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tabs[0] || null;
};

const setSiteUiState = ({ host, isDisabled, isSupported }) => {
  if (!siteNameEl || !siteHintEl || !siteToggleBtn) {
    return;
  }

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
    const proto = new URL(rawUrl).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
};

const setBookmarkFormState = ({ tab }) => {
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
  if (!bookmarkTitleEl.value) {
    bookmarkTitleEl.value = title;
  }
  bookmarkTitleEl.disabled = false;
  bookmarkDescriptionEl.disabled = false;
  bookmarkSaveBtn.disabled = false;
};

const loadPopupState = async () => {
  const cfg = await chrome.storage.sync.get([
    "apiUrl",
    "apiToken",
    DISABLED_HOSTS_KEY,
    DEFAULT_FOLDER_ID_KEY,
  ]);

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

  setBookmarkFormState({ tab: currentTab });

  if (defaultCollectionEl) {
    defaultCollectionEl.disabled = true;
    storedDefaultFolderId = String(cfg[DEFAULT_FOLDER_ID_KEY] || "").trim();
    const { folders, error } = await loadFolders();
    renderDefaultCollectionOptions(folders, storedDefaultFolderId);
    if (error) {
      setStatus(
        /\b401\b|unauthorized/i.test(error)
          ? "Collections unavailable — the API token is missing or wrong."
          : `Collections unavailable — ${error}`.slice(0, 160),
      );
    }
  }
};

saveBtn.addEventListener("click", () => {
  const apiUrl = normalizeApiUrl(apiUrlInput.value);
  const apiToken = apiTokenInput ? apiTokenInput.value.trim() : "";
  const defaultFolderId = defaultCollectionEl?.value || "";

  // Picking a different default is a deliberate reset — without dropping the
  // remembered preset the new default would never be applied, since every save
  // surface prefers the last save's collections.
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
    window.setTimeout(() => {
      saveBtn.textContent = "Save settings";
    }, 1400);

    // Re-fetch with the token that was just saved so a fixed token immediately
    // fills the default-collection picker instead of waiting for a reopen.
    void loadFolders().then(({ folders, error }) => {
      renderDefaultCollectionOptions(folders, defaultFolderId);
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

    if (response && response.ok) {
      setBookmarkStatus("Bookmarked to gallery.", "success");
      bookmarkSaveBtn.textContent = "Saved";
      bookmarkDescriptionEl.value = "";
      window.setTimeout(() => {
        bookmarkSaveBtn.textContent = "Bookmark page";
        bookmarkSaveBtn.disabled = false;
      }, 1400);
    } else {
      const detail = response?.error || "Save failed.";
      setBookmarkStatus(detail.slice(0, 240), "error");
      bookmarkSaveBtn.textContent = "Bookmark page";
      bookmarkSaveBtn.disabled = false;
    }
  } catch (err) {
    setBookmarkStatus(err?.message ? err.message.slice(0, 240) : "Save failed.", "error");
    bookmarkSaveBtn.textContent = "Bookmark page";
    bookmarkSaveBtn.disabled = false;
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

  setSiteUiState({
    host: currentSiteHost,
    isDisabled: nextDisabled,
    isSupported: true,
  });
  setStatus(
    nextDisabled
      ? `Paused on ${currentSiteHost}.`
      : `Enabled on ${currentSiteHost}.`,
  );
});

loadPopupState().catch(() => {
  setStatus("Failed to load extension settings.");
});
