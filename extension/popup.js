const apiUrlInput = document.getElementById("apiUrl");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const pillarInputs = Array.from(
  document.querySelectorAll('input[name="defaultPillar"]'),
);

const SAVE_ROUTE_PATH = "/api/extension/save";
const DEFAULT_API_URL = `https://laniameda-galery.vercel.app${SAVE_ROUTE_PATH}`;

const normalizeApiUrl = (rawValue) => {
  const value =
    typeof rawValue === "string" && rawValue.trim()
      ? rawValue.trim()
      : DEFAULT_API_URL;

  try {
    const url = new URL(value);
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

const getSelectedPillar = () =>
  pillarInputs.find((input) => input.checked)?.value || "dump";

const setSelectedPillar = (value) => {
  const nextValue = value || "dump";
  for (const input of pillarInputs) {
    input.checked = input.value === nextValue;
  }
};

chrome.storage.sync.get(["apiUrl", "defaultPillar"], (cfg) => {
  apiUrlInput.value = normalizeApiUrl(cfg.apiUrl);
  setSelectedPillar(cfg.defaultPillar);
});

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
