// The extension's Recent lists, the same in every browser. Grow's pictures
// (chrome.storage.local "growHistory") and the Midjourney describes it caught
// ("mjDescribes") are merged with the gallery's copy (/api/extension/history)
// by the background worker: when a list changes here, and when a card that
// shows it opens. Cards keep reading and writing their local list as before.
//
// Merge, per picture: unchanged here since the last sync → the gallery's
// version; changed only here → ours goes up; changed on both sides → Grow
// keeps every run from both (newest first), Describe keeps the newer.

(function registerHistorySync(scope) {
  "use strict";

  const KINDS = {
    grow: { storageKey: "growHistory", cap: 40, runs: 8, keyOf: (entry) => entry && entry.key },
    describe: { storageKey: "mjDescribes", cap: 24, keyOf: (entry) => entry && entry.imageUrl },
  };
  const SEEN_KEY = "historySyncSeen";

  // FNV-1a: a short fingerprint of an entry's JSON, so "changed since the last
  // sync" needs no second copy of the list.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36) + ":" + text.length;
  }

  const atOf = (entry) => (Number.isFinite(entry && entry.at) ? entry.at : 0);

  // Both sides changed one picture: one entry with everything.
  function combine(kind, mine, theirs) {
    if (kind === "describe") return atOf(theirs) > atOf(mine) ? theirs : mine;
    const base = atOf(theirs) > atOf(mine) ? theirs : mine;
    const other = base === mine ? theirs : mine;
    const ids = new Set((base.runs || []).map((run) => run && run.id));
    const runs = [...(base.runs || []), ...(other.runs || []).filter((run) => run && !ids.has(run.id))]
      .sort((a, b) => atOf(b) - atOf(a))
      .slice(0, KINDS.grow.runs);
    return { ...base, runs, at: Math.max(atOf(mine), atOf(theirs)) };
  }

  /**
   * local: the list in chrome.storage.local. rows: the gallery's [{key, at, rev, entry}].
   * seen: {key: {rev, h}} from the last sync. Returns the merged list, the
   * entries to send up ({key, at, entry, baseRev?}) and the new seen map.
   */
  function merge(kind, local, rows, seen = {}) {
    const spec = KINDS[kind];
    const mine = new Map();
    for (const entry of Array.isArray(local) ? local : []) {
      const key = spec.keyOf(entry);
      if (key && !mine.has(key)) mine.set(key, entry);
    }
    const theirs = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !row.key || theirs.has(row.key)) continue;
      try { theirs.set(row.key, { row, entry: JSON.parse(row.entry) }); } catch { /* unreadable row: skip */ }
    }
    const nextSeen = { ...seen };
    const merged = [];
    const dirty = new Map(); // key → baseRev (or null for new)
    for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
      const l = mine.get(key);
      const r = theirs.get(key);
      const s = seen[key];
      if (!r) {
        merged.push(l);
        // Gone from the gallery after this browser saw it there: it fell off
        // the gallery's list (the cap), so it is not sent up again.
        if (!s || hash(JSON.stringify(l)) !== s.h) dirty.set(key, null);
        continue;
      }
      if (!l) { merged.push(r.entry); nextSeen[key] = { rev: r.row.rev, h: hash(r.row.entry) }; continue; }
      const lh = hash(JSON.stringify(l));
      const rh = hash(r.row.entry);
      if (lh === rh) { merged.push(l); nextSeen[key] = { rev: r.row.rev, h: rh }; continue; }
      if (s && s.h === lh) { merged.push(r.entry); nextSeen[key] = { rev: r.row.rev, h: rh }; continue; }
      if (s && s.rev === r.row.rev) { merged.push(l); dirty.set(key, r.row.rev); continue; }
      const both = combine(kind, l, r.entry);
      merged.push(both);
      dirty.set(key, r.row.rev);
    }
    merged.sort((a, b) => atOf(b) - atOf(a));
    const list = merged.slice(0, spec.cap);
    const push = [];
    for (const entry of list) {
      const key = spec.keyOf(entry);
      if (!dirty.has(key)) continue;
      const baseRev = dirty.get(key);
      push.push({ key, at: atOf(entry), entry: JSON.stringify(entry), ...(baseRev != null ? { baseRev } : {}) });
    }
    for (const key of Object.keys(nextSeen)) if (!list.some((entry) => spec.keyOf(entry) === key)) delete nextSeen[key];
    return { list, push, seen: nextSeen };
  }

  const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

  // ── The worker side: one sync per kind at a time, at most every 15 s unless forced ──

  function createSyncer({ fetchJson, storage }) {
    const running = {};
    const written = {}; // kind → fingerprint of the list this syncer last wrote
    const lastAt = {};
    const readSeen = async () => ((await storage.get(SEEN_KEY))?.[SEEN_KEY]) || {};

    async function once(kind) {
      const spec = KINDS[kind];
      const remote = await fetchJson(`/api/extension/history?kind=${kind}`, { method: "GET" });
      if (!remote?.ok) return { ok: false, error: remote?.error || "Could not read the shared history." };
      const allSeen = await readSeen();
      const stored = await storage.get(spec.storageKey);
      const local = Array.isArray(stored?.[spec.storageKey]) ? stored[spec.storageKey] : [];
      let { list, push, seen } = merge(kind, local, remote.rows, allSeen[kind] || {});
      let stale = 0;
      // Batches of at most 20 pictures and about 900 KB, under the route's limits.
      const batches = [];
      for (const row of push) {
        const last = batches[batches.length - 1];
        if (!last || last.length >= 20 || last.bytes + row.entry.length > 900_000) batches.push(Object.assign([row], { bytes: row.entry.length }));
        else { last.push(row); last.bytes += row.entry.length; }
      }
      for (const batch of batches) {
        const sent = await fetchJson("/api/extension/history", { method: "POST", body: JSON.stringify({ kind, rows: batch }) });
        if (!sent?.ok) return { ok: false, error: sent?.error || "Could not save the shared history." };
        for (const row of sent.rows || []) {
          const pushed = batch.find((entry) => entry.key === row.key);
          if (!row.stale && pushed) seen[row.key] = { rev: row.rev, h: hash(pushed.entry) };
          if (row.stale) stale += 1;
        }
      }
      // Read again: the list may have changed while the gallery answered.
      const now = await storage.get(spec.storageKey);
      const current = Array.isArray(now?.[spec.storageKey]) ? now[spec.storageKey] : [];
      if (!sameList(current, local)) {
        ({ list } = merge(kind, current, remote.rows, seen));
      }
      if (!sameList(current, list)) {
        written[kind] = hash(JSON.stringify(list));
        await storage.set({ [spec.storageKey]: list });
      }
      const latest = await readSeen();
      await storage.set({ [SEEN_KEY]: { ...latest, [kind]: seen } });
      return { ok: true, pulled: remote.rows.length, pushed: push.length - stale, stale, changed: !sameList(current, list) };
    }

    async function sync(kind, { force = false } = {}) {
      if (!KINDS[kind]) return { ok: false, error: "Unknown history." };
      if (running[kind]) return running[kind];
      if (!force && lastAt[kind] && Date.now() - lastAt[kind] < 15000) return { ok: true, skipped: true };
      lastAt[kind] = Date.now();
      running[kind] = (async () => {
        try {
          let res = await once(kind);
          // Another browser wrote the same picture meanwhile: one more round merges it.
          if (res.ok && res.stale) res = await once(kind);
          return res;
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        } finally {
          running[kind] = null;
        }
      })();
      return running[kind];
    }
    // A change to a list: true when it is not the syncer's own write.
    const isOwnWrite = (kind, value) => written[kind] === hash(JSON.stringify(value || []));
    return { sync, isOwnWrite };
  }

  scope.SaveToGalleryHistorySync = { KINDS, SEEN_KEY, hash, combine, merge, createSyncer };
})(typeof globalThis !== "undefined" ? globalThis : self);
