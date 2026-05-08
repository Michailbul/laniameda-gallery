const apiUrlInput = document.getElementById("apiUrl");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const siteToggleBtn = document.getElementById("siteToggle");
const siteNameEl = document.getElementById("siteName");
const siteHintEl = document.getElementById("siteHint");
const pillarInputs = Array.from(
  document.querySelectorAll('input[name="defaultPillar"]'),
);

const bookmarkUrlEl = document.getElementById("bookmarkUrl");
const bookmarkTitleEl = document.getElementById("bookmarkTitle");
const bookmarkDescriptionEl = document.getElementById("bookmarkDescription");
const bookmarkSaveBtn = document.getElementById("bookmarkSave");
const bookmarkStatusEl = document.getElementById("bookmarkStatus");
const bookmarkPillarInputs = Array.from(
  document.querySelectorAll('input[name="bookmarkPillar"]'),
);

const SAVE_ROUTE_PATH = "/api/extension/save";
const CANONICAL_API_HOST = "laniameda-galery.vercel.app";
const DEFAULT_API_URL = `https://${CANONICAL_API_HOST}${SAVE_ROUTE_PATH}`;
const DISABLED_HOSTS_KEY = "disabledHosts";
const LEGACY_API_HOSTS = new Set(["laniameda.gallery"]);

let currentSiteHost = "";
let currentTabId = null;
let currentTabUrl = "";
let currentTabTitle = "";

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

const getSelectedPillar = () =>
  pillarInputs.find((input) => input.checked)?.value || "dump";

const setSelectedPillar = (value) => {
  const nextValue = value || "dump";
  for (const input of pillarInputs) {
    input.checked = input.value === nextValue;
  }
};

const getSelectedBookmarkPillar = () =>
  bookmarkPillarInputs.find((input) => input.checked)?.value || "dump";

const setSelectedBookmarkPillar = (value) => {
  const nextValue = value || "dump";
  for (const input of bookmarkPillarInputs) {
    input.checked = input.value === nextValue;
  }
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
    "defaultPillar",
    "bookmarkPillar",
    DISABLED_HOSTS_KEY,
  ]);

  apiUrlInput.value = normalizeApiUrl(cfg.apiUrl);
  setSelectedPillar(cfg.defaultPillar);
  setSelectedBookmarkPillar(cfg.bookmarkPillar || cfg.defaultPillar);

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
};

saveBtn.addEventListener("click", () => {
  const apiUrl = normalizeApiUrl(apiUrlInput.value);
  const defaultPillar = getSelectedPillar();

  chrome.storage.sync.set(
    {
      apiUrl,
      defaultPillar,
    },
    () => {
      apiUrlInput.value = apiUrl;
      setStatus(`Saved for ${defaultPillar}.`);
      saveBtn.textContent = "Saved";
      window.setTimeout(() => {
        saveBtn.textContent = "Save Settings";
      }, 1400);
    },
  );
});

for (const input of bookmarkPillarInputs) {
  input.addEventListener("change", () => {
    chrome.storage.sync.set({ bookmarkPillar: input.value });
  });
}

bookmarkSaveBtn.addEventListener("click", async () => {
  if (currentTabId === null || !isBookmarkableUrl(currentTabUrl)) {
    setBookmarkStatus("No bookmarkable page in this tab.", "error");
    return;
  }

  const pillar = getSelectedBookmarkPillar();
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
      pillar,
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
