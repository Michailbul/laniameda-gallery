// Save to Gallery — Background service worker

const DEFAULT_API_URL = "https://laniameda-galery.vercel.app/api/extension/save";

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["apiUrl", "defaultPillar"],
      (cfg) => resolve({
        apiUrl: cfg.apiUrl || DEFAULT_API_URL,
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "saveImage") {
    saveToGallery({
      imageUrl: message.imageUrl,
      sourceUrl: message.sourceUrl,
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "updatePrompt") {
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
});
