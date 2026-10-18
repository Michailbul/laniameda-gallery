// "Already in the gallery?" lookups for the service worker.
//
// Each lookup reads asset index rows in Convex, so the worker keeps the
// answers and spends as few requests as it can:
//   - lookups that arrive within BATCH_DELAY_MS share one request of up to
//     MAX_URLS urls (the route's limit);
//   - answers are cached: saved for SAVED_TTL_MS, not saved for UNSAVED_TTL_MS
//     (it may be saved from another tab), and a save marks its url saved;
//   - after a failed request no request is made for FAILURE_BACKOFF_MS, so an
//     outage or a bad token is not retried on every page scan.
(function attachAssetStatus(globalScope) {
  const MAX_URLS = 8;
  const BATCH_DELAY_MS = 150;
  const SAVED_TTL_MS = 30 * 60 * 1000;
  const UNSAVED_TTL_MS = 5 * 60 * 1000;
  const FAILURE_BACKOFF_MS = 60 * 1000;
  const MAX_CACHE_ENTRIES = 2000;

  function createAssetStatusClient({ fetchStatuses, now = () => Date.now(), batchDelayMs = BATCH_DELAY_MS } = {}) {
    if (typeof fetchStatuses !== "function") throw new Error("fetchStatuses is required");
    const cache = new Map();
    let queue = [];
    let timer = null;
    let backoffUntil = 0;

    const remember = (url, saved) => {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(url, { saved, expiresAt: now() + (saved ? SAVED_TTL_MS : UNSAVED_TTL_MS) });
    };

    const cached = (url) => {
      const entry = cache.get(url);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        cache.delete(url);
        return undefined;
      }
      return entry.saved;
    };

    const flush = async () => {
      timer = null;
      const batch = queue;
      queue = [];
      const urls = [...new Set(batch.map((item) => item.url))];
      for (let start = 0; start < urls.length; start += MAX_URLS) {
        const chunk = urls.slice(start, start + MAX_URLS);
        const waiting = batch.filter((item) => chunk.includes(item.url));
        if (now() < backoffUntil) {
          for (const item of waiting) item.resolve({ ok: false, error: "Saved-status lookups are paused after a failure." });
          continue;
        }
        let result;
        try {
          result = await fetchStatuses(chunk);
        } catch (error) {
          result = { ok: false, error: error?.message || String(error) };
        }
        if (!result?.ok) {
          backoffUntil = now() + FAILURE_BACKOFF_MS;
          for (const item of waiting) item.resolve(result ?? { ok: false, error: "No response." });
          continue;
        }
        const statuses = Array.isArray(result.statuses) ? result.statuses : [];
        for (const url of chunk) {
          remember(url, Boolean(statuses.find((status) => status?.url === url)?.saved));
        }
        for (const item of waiting) item.resolve({ ok: true, statuses: [{ url: item.url, saved: cached(item.url) === true }] });
      }
    };

    // Resolves like the route: { ok, statuses: [{ url, saved }] } or { ok: false, error }.
    const check = (imageUrls) => {
      const urls = [...new Set((imageUrls || [])
        .filter((url) => typeof url === "string" && url.trim())
        .map((url) => url.trim()))].slice(0, MAX_URLS);
      if (urls.length === 0) return Promise.resolve({ ok: false, error: "imageUrls is required." });
      return Promise.all(urls.map((url) => {
        const known = cached(url);
        if (known !== undefined) return Promise.resolve({ ok: true, statuses: [{ url, saved: known }] });
        return new Promise((resolve) => {
          queue.push({ url, resolve });
          if (!timer) timer = setTimeout(() => void flush(), batchDelayMs);
        });
      })).then((answers) => {
        const failed = answers.find((answer) => !answer.ok);
        if (failed) return failed;
        return { ok: true, statuses: answers.flatMap((answer) => answer.statuses) };
      });
    };

    const markSaved = (imageUrl) => {
      const url = typeof imageUrl === "string" ? imageUrl.trim() : "";
      if (url) remember(url, true);
    };

    return { check, markSaved };
  }

  globalScope.SaveToGalleryAssetStatus = {
    MAX_URLS,
    BATCH_DELAY_MS,
    SAVED_TTL_MS,
    UNSAVED_TTL_MS,
    FAILURE_BACKOFF_MS,
    createAssetStatusClient,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
