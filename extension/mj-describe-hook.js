// Runs in midjourney.com's own page (manifest "world": "MAIN", at
// document_start) so it can see Midjourney's Describe answers. Read-only: it
// watches the page's own POST /api/describe (Michael dropped an image to
// describe it, or chose Describe on a picture) and Midjourney's local cache of
// earlier describes (IndexedDB mjDatabase2.descriptions), and hands the image
// link with its four descriptions to the extension (mj-describe.js) through
// window.postMessage. It never makes a request of its own.

(function hookMidjourneyDescribe() {
  if (window.__stgDescribeHook) return;
  window.__stgDescribeHook = true;
  const SOURCE = "stg-mj-describe";
  const started = Date.now();

  const post = (imageUrl, data, via) => {
    const descriptions = Array.isArray(data?.originals) ? data.originals : Array.isArray(data?.descriptions) ? data.descriptions : null;
    if (!descriptions || !descriptions.length) return;
    try {
      window.postMessage({
        source: SOURCE,
        via,
        imageUrl: typeof imageUrl === "string" ? imageUrl : "",
        descriptions: descriptions.map(String).slice(0, 4),
        aspect: Array.isArray(data.aspect_ratio) ? data.aspect_ratio.slice(0, 2) : null,
        // Cache reads in the first seconds are the page restoring old describes.
        quiet: via === "cache" && Date.now() - started < 6000,
      }, location.origin);
    } catch { /* never break the page */ }
  };

  const originalFetch = window.fetch;
  window.fetch = function stgFetch(input, init) {
    const result = originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      if (method === "POST" && /\/api\/describe(?:[?#]|$)/.test(url)) {
        let imageUrl = "";
        try { imageUrl = JSON.parse(typeof init?.body === "string" ? init.body : "{}").image_url || ""; } catch { /* body not JSON */ }
        result.then((response) => (response.ok ? response.clone().json() : null))
          .then((json) => { if (json && json.data) post(imageUrl, json.data, "describe"); })
          .catch(() => {});
      }
    } catch { /* never break the page */ }
    return result;
  };

  // Describes Midjourney already has answer from its cache without a request.
  try {
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function stgGet() {
      const request = originalGet.apply(this, arguments);
      try {
        if (this.name === "descriptions") {
          request.addEventListener("success", () => {
            const row = request.result;
            if (row && row.data) post(row.id, row.data, "cache");
          });
        }
      } catch { /* never break the page */ }
      return request;
    };
  } catch { /* IndexedDB unavailable */ }
})();
