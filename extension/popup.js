const DEFAULT_URL = "https://laniameda-galery.vercel.app/api/extension/save";

const apiKeyInput = document.getElementById("apiKey");
const apiUrlInput = document.getElementById("apiUrl");
const pillarSelect = document.getElementById("defaultPillar");
const saveBtn = document.getElementById("save");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");

// Load saved settings
chrome.storage.sync.get(["apiKey", "apiUrl", "defaultPillar"], (cfg) => {
  apiKeyInput.value = cfg.apiKey || "";
  apiUrlInput.value = cfg.apiUrl || DEFAULT_URL;
  pillarSelect.value = cfg.defaultPillar || "dump";

  if (cfg.apiKey) {
    testConnection();
  }
});

// Save settings
saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_URL;
  const defaultPillar = pillarSelect.value;

  chrome.storage.sync.set({ apiKey, apiUrl, defaultPillar }, () => {
    saveBtn.textContent = "Saved!";
    setTimeout(() => { saveBtn.textContent = "Save settings"; }, 1500);

    if (apiKey) {
      testConnection();
    }
  });
});

function testConnection() {
  dot.className = "dot dot--pending";
  statusText.textContent = "Testing…";

  chrome.runtime.sendMessage({ action: "testConnection" }, (response) => {
    if (response && response.ok) {
      dot.className = "dot dot--ok";
      statusText.textContent = "Connected";
    } else {
      dot.className = "dot dot--err";
      statusText.textContent = response?.error || "Connection failed";
    }
  });
}
