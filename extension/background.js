// Save to Gallery — Background service worker

const DEFAULT_API_URL = "https://laniameda.gallery/api/extension/save";
const LEGACY_API_HOSTS = new Set(["laniameda-galery.vercel.app"]);

function normalizeApiUrl(rawValue) {
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
    url.pathname = "/api/extension/save";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return DEFAULT_API_URL;
  }
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

  const response = await fetch(config.apiUrl, {
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

  const data = await response.json();

  if (!response.ok) {
    return { ok: false, error: data.error || `HTTP ${response.status}` };
  }

  return { ok: true, result: data.result };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "saveImage") {
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
      promptText: message.promptText,
      modelName: message.modelName,
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
});
