// Save to Gallery — Background service worker
// Handles API calls to the gallery backend.

const DEFAULT_API_URL = "https://laniameda-galery.vercel.app/api/extension/save";

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["apiKey", "apiUrl", "defaultPillar"],
      (cfg) => resolve({
        apiKey: cfg.apiKey || "",
        apiUrl: cfg.apiUrl || DEFAULT_API_URL,
        defaultPillar: cfg.defaultPillar || "dump",
      })
    );
  });
}

async function saveToGallery(payload) {
  const config = await getConfig();

  if (!config.apiKey) {
    return { ok: false, error: "API key not set. Open extension popup to configure." };
  }

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gallery-API-Key": config.apiKey,
    },
    body: JSON.stringify({
      imageUrl: payload.imageUrl,
      sourceUrl: payload.sourceUrl,
      pillar: payload.pillar || config.defaultPillar,
      promptText: payload.promptText || undefined,
      modelName: payload.modelName || undefined,
      tagNames: payload.tagNames || [],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { ok: false, error: data.error || `HTTP ${response.status}` };
  }

  return { ok: true, result: data.result };
}

// Message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "saveImage") {
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }

  if (message.action === "updatePrompt") {
    // Re-save with prompt + pillar (dedup key = same image URL, so it updates)
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
      promptText: message.promptText,
      pillar: message.pillar,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "testConnection") {
    getConfig().then(async (config) => {
      if (!config.apiKey) {
        sendResponse({ ok: false, error: "API key not set" });
        return;
      }
      try {
        const response = await fetch(config.apiUrl, {
          method: "OPTIONS",
          headers: { "X-Gallery-API-Key": config.apiKey },
        });
        sendResponse({ ok: response.status === 204 || response.ok });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    });
    return true;
  }
});
