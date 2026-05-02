const apiUrlInput = document.getElementById("apiUrl");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const siteToggleBtn = document.getElementById("siteToggle");
const siteNameEl = document.getElementById("siteName");
const siteHintEl = document.getElementById("siteHint");
const pillarInputs = Array.from(
  document.querySelectorAll('input[name="defaultPillar"]'),
);

const SAVE_ROUTE_PATH = "/api/extension/save";
const DEFAULT_API_URL = `https://laniameda.gallery${SAVE_ROUTE_PATH}`;
const DISABLED_HOSTS_KEY = "disabledHosts";
const LEGACY_API_HOSTS = new Set(["laniameda-galery.vercel.app"]);

let currentSiteHost = "";
let currentTabId = null;

const normalizeApiUrl = (rawValue) => {
  const value =
    typeof rawValue === "string" && rawValue.trim()
      ? rawValue.trim()
      : DEFAULT_API_URL;

  try {
    const url = new URL(value);
    if (LEGACY_API_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      url.hostname = "laniameda.gallery";
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

const loadPopupState = async () => {
  const cfg = await chrome.storage.sync.get([
    "apiUrl",
    "defaultPillar",
    DISABLED_HOSTS_KEY,
  ]);

  apiUrlInput.value = normalizeApiUrl(cfg.apiUrl);
  setSelectedPillar(cfg.defaultPillar);

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
