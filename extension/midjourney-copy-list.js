// The Midjourney copy list: job links Michael picks so he can hand them to an
// agent, which then goes and takes those images. It has nothing to do with the
// gallery. Adding to it saves nothing, and saving adds nothing to it.
//
// Loaded in the content script (formatting, reading) and in the service worker
// (the store). Every write goes through the worker's single queue, because two
// Midjourney tabs writing to storage directly would overwrite each other.
(function registerMidjourneyCopyList(globalScope) {
  "use strict";

  const STORAGE_KEY = "stgMidjourneyCopyList";
  const ORIGIN = "https://www.midjourney.com";
  const JOB_ID = /^[0-9a-f-]{20,64}$/i;

  function entryKey(jobId, index) {
    return `${jobId}:${index}`;
  }

  function jobUrl(jobId, index) {
    return `${ORIGIN}/jobs/${jobId}?index=${index}`;
  }

  function normalizeSelection(selection) {
    const jobId = String(selection?.jobId || "").trim();
    const index = selection?.index;
    if (!JOB_ID.test(jobId) || !Number.isInteger(index) || index < 0) return null;
    return { jobId, index };
  }

  function buildEntry(selection, { previewUrl, addedAt } = {}) {
    const normalized = normalizeSelection(selection);
    if (!normalized) return null;
    return {
      key: entryKey(normalized.jobId, normalized.index),
      jobId: normalized.jobId,
      index: normalized.index,
      url: jobUrl(normalized.jobId, normalized.index),
      previewUrl: previewUrl || undefined,
      addedAt: addedAt || Date.now(),
    };
  }

  // The prompt and codes from a collected Midjourney metadata read, kept beside
  // the link. Only the fields the copied text uses.
  function detailsFromMetadata(collected) {
    const personalization = (collected?.metadata?.personalization || [])
      .filter((entry) => entry?.code)
      .map(({ code, type, name }) => ({
        code,
        type: type === "moodboard" || type === "profile" ? type : "unknown",
        ...(name ? { name } : {}),
      }));
    const prompt = String(collected?.promptText || "").trim();
    return {
      ...(prompt ? { prompt } : {}),
      ...(personalization.length ? { personalization } : {}),
    };
  }

  function readList(stored) {
    const list = stored?.[STORAGE_KEY];
    return Array.isArray(list) ? list : [];
  }

  const CODE_LABEL = {
    moodboard: "Moodboard",
    profile: "Profile",
    unknown: "Code",
  };

  function formatCode({ code, type, name }) {
    const label = CODE_LABEL[type] || CODE_LABEL.unknown;
    return `${label}: ${code}${name ? ` (${name})` : ""}`;
  }

  // One block per image, numbered so an agent can answer "number 3". A prompt
  // stays on one line so every entry keeps the same shape.
  function formatEntry(entry, position) {
    const lines = [`${position}. ${entry.url}`];
    const prompt = String(entry.prompt || "").replace(/\s+/g, " ").trim();
    if (prompt) lines.push(`   Prompt: ${prompt}`);
    for (const code of entry.personalization || []) {
      lines.push(`   ${formatCode(code)}`);
    }
    return lines.join("\n");
  }

  function formatList(list) {
    const entries = Array.isArray(list) ? list : [];
    if (entries.length === 0) return "";
    const count = entries.length === 1 ? "1 image" : `${entries.length} images`;
    const blocks = entries.map((entry, index) => formatEntry(entry, index + 1));
    return [`Midjourney copy list: ${count}`, ...blocks].join("\n\n");
  }

  // `storage` is chrome.storage.local, or anything with the same get and set.
  function createStore(storage) {
    let queue = Promise.resolve();

    const mutate = (change) => {
      const run = queue.then(async () => {
        const current = readList(await storage.get(STORAGE_KEY));
        const next = change(current);
        if (next !== current) await storage.set({ [STORAGE_KEY]: next });
        return next;
      });
      // One failed write must not block the writes behind it.
      queue = run.catch(() => {});
      return run;
    };

    return {
      read: async () => readList(await storage.get(STORAGE_KEY)),
      // Adding what is already there keeps its place and its details.
      add: (entry) =>
        mutate((list) =>
          list.some((item) => item.key === entry.key) ? list : [...list, entry],
        ),
      // Details often land after the entry was removed. Removed stays removed.
      addDetails: (key, details) =>
        mutate((list) =>
          list.some((item) => item.key === key)
            ? list.map((item) => (item.key === key ? { ...item, ...details } : item))
            : list,
        ),
      remove: (key) =>
        mutate((list) =>
          list.some((item) => item.key === key)
            ? list.filter((item) => item.key !== key)
            : list,
        ),
      clear: () => mutate((list) => (list.length ? [] : list)),
    };
  }

  globalScope.SaveToGalleryMidjourneyCopyList = {
    STORAGE_KEY,
    buildEntry,
    createStore,
    detailsFromMetadata,
    entryKey,
    formatList,
    readList,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
