// Profile and moodboard mixes for one prompt: the randomizer (⌥R on the bar,
// Random in the queue), the extreme randomizer and Test (the same words once
// per profile, plus once with no profile at all). Pure functions, shared by
// the dock (content script), the queue and the tests.
//
// Limits (Michael, 17 Nov 2026):
//   random   1–2 profiles + at most 1 moodboard
//   extreme  1–3 profiles + at most 2 moodboards
// Profiles mix more freely than moodboards. AndromedaCartoon (n9iqix8) is
// never picked.
//
// Levels and locks (Michael, 22 Nov 2026: "we should have multiple levels of
// the random and easy way to one click control it. so we also can see how
// random moodboards can affect the locked in profile(s)"). One setting for
// the dock's ⌥R, the Rerun bar and the queue's Random, kept in
// chrome.storage.local "stgRandom" = { level, locks: { [world]: [codes] } }:
//   MB    only the moodboard changes (one random); profiles stay
//   P     only the profiles change (1–2 random); moodboards stay
//   MB+P  1–2 random profiles + one random moodboard
//   WILD  1–3 random profiles + 0–2 random moodboards
// "Stay" means the locked codes of that kind, else the prompt's own. Locked
// codes ride in every mix at every level; the random part fills around them.

(function registerRandomize(globalScope) {
  "use strict";

  const BANNED_CODES = new Set(["n9iqix8"]);
  const FLAG_PATTERN = /(^|\s)(--profile|--p|-p)((?:\s+[^\s-]\S*)+)/g;
  const BARE_P_PATTERN = /(^|\s)(--profile|--p|-p)(?=\s+--|\s*$)/g;

  const LIMITS = {
    random: { minProfiles: 1, maxProfiles: 2, minBoards: 0, maxBoards: 1 },
    extreme: { minProfiles: 1, maxProfiles: 3, minBoards: 0, maxBoards: 2 },
  };

  const LEVELS = [
    { key: "mb", label: "MB", name: "Moodboards", hint: "Only the moodboard changes: one random moodboard. Profiles stay: the locked ones, else the prompt's own." },
    { key: "p", label: "P", name: "Profiles", hint: "Only the profiles change: 1–2 random profiles. Moodboards stay: the locked ones, else the prompt's own." },
    { key: "mix", label: "MB+P", name: "Moodboard + profiles", hint: "1–2 random profiles and one random moodboard." },
    { key: "wild", label: "WILD", name: "Wild", hint: "1–3 random profiles and 0–2 random moodboards." },
  ];
  const LEVEL_KEYS = LEVELS.map((entry) => entry.key);
  const RANDOM_STORE = "stgRandom";
  // How many of each kind a level wants in total (locked ones count); null = that kind stays.
  const LEVEL_COUNTS = {
    mb: { profiles: null, boards: [1, 1] },
    p: { profiles: [1, 2], boards: null },
    mix: { profiles: [1, 2], boards: [1, 1] },
    wild: { profiles: [1, 3], boards: [0, 2] },
  };
  const levelOf = (key) => (LEVEL_KEYS.includes(key) ? key : "mix");
  const nextLevel = (key) => LEVEL_KEYS[(LEVEL_KEYS.indexOf(levelOf(key)) + 1) % LEVEL_KEYS.length];

  /** The stored setting, cleaned: { level, locks: { world: [codes] } }. */
  function randomSettings(stored) {
    const value = stored && typeof stored === "object" ? stored : {};
    const locks = {};
    for (const [world, codes] of Object.entries(value.locks && typeof value.locks === "object" ? value.locks : {})) {
      const list = clean(Array.isArray(codes) ? codes : []);
      if (list.length) locks[world] = list;
    }
    return { level: levelOf(value.level), locks };
  }
  const locksOf = (settings, world) => (settings && settings.locks && settings.locks[world]) || [];
  /** Lock these codes for the world, or unlock all when `codes` is empty. */
  function withLocks(settings, world, codes) {
    const next = randomSettings(settings);
    const list = clean(codes);
    if (list.length) next.locks[world] = list;
    else delete next.locks[world];
    return next;
  }

  const clean = (codes) => [...new Set((codes || []).map((code) => String(code || "").trim()).filter((code) => code && !BANNED_CODES.has(code)))];

  function shuffle(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const between = (min, max, rng) => (max <= min ? min : min + Math.floor(rng() * (max - min + 1)));

  // One mix: { profiles: [...], boards: [...], codes: [...boards, ...profiles] }.
  // `avoid` is the signature of the current mix so a reroll always changes
  // something when the pool allows it.
  function pickMix(pool, mode = "random", options = {}) {
    const rng = options.rng || Math.random;
    const limits = LIMITS[mode] || LIMITS.random;
    const profiles = clean(pool && pool.profiles);
    const boards = clean(pool && pool.boards).filter((code) => !profiles.includes(code));
    const avoid = options.avoid || "";
    let best = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const profileCount = Math.min(profiles.length, between(limits.minProfiles, limits.maxProfiles, rng));
      const boardCount = Math.min(boards.length, between(limits.minBoards, limits.maxBoards, rng));
      const pickedProfiles = shuffle(profiles, rng).slice(0, profileCount);
      const pickedBoards = shuffle(boards, rng).slice(0, boardCount);
      const mix = { profiles: pickedProfiles, boards: pickedBoards, codes: [...pickedBoards, ...pickedProfiles] };
      best = mix;
      if (!avoid || signature(mix.codes) !== avoid) break;
    }
    return best || { profiles: [], boards: [], codes: [] };
  }

  const signature = (codes) => clean(codes).slice().sort().join(" ");

  // Every code in the prompt's profile flags.
  function codesIn(promptText) {
    const found = [];
    FLAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = FLAG_PATTERN.exec(String(promptText || "")))) found.push(...match[3].trim().split(/\s+/));
    return found;
  }

  // The prompt with its profile flags replaced by one `--profile a b c`
  // (or none, for an empty list). Everything else is left as it was.
  function withCodes(promptText, codes) {
    const list = clean(codes);
    let body = String(promptText || "");
    FLAG_PATTERN.lastIndex = 0;
    body = body.replace(FLAG_PATTERN, (all, lead) => lead);
    BARE_P_PATTERN.lastIndex = 0;
    body = body.replace(BARE_P_PATTERN, (all, lead) => lead);
    body = body.replace(/[ \t]{2,}/g, " ").trim();
    if (!list.length) return body;
    // The flag goes before the other params when there are any, so the words stay first.
    const paramAt = body.search(/(^|\s)--[a-z]/i);
    if (paramAt < 0) return `${body} --profile ${list.join(" ")}`;
    const head = body.slice(0, paramAt).trimEnd();
    const tail = body.slice(paramAt).trimStart();
    return `${head} --profile ${list.join(" ")} ${tail}`;
  }

  // Test: the same words once per profile (each alone), once per moodboard
  // when asked, and once with no profile at all. Each entry: { label, codes }.
  function testSet(pool, options = {}) {
    const profiles = clean(pool && pool.profiles);
    const boards = options.includeBoards ? clean(pool && pool.boards).filter((code) => !profiles.includes(code)) : [];
    const names = (pool && pool.names) || {};
    const out = [];
    if (options.includeNone !== false) out.push({ label: "No profile", codes: [] });
    for (const code of profiles) out.push({ label: names[code] || code, codes: [code] });
    for (const code of boards) out.push({ label: names[code] || code, codes: [code] });
    return out;
  }

  // N random mixes, no two the same when the pool allows it.
  function randomSet(pool, count, mode = "random", options = {}) {
    const rng = options.rng || Math.random;
    const names = (pool && pool.names) || {};
    const seen = new Set();
    const out = [];
    const locks = clean(options.locks);
    for (let attempt = 0; out.length < count && attempt < count * 8; attempt += 1) {
      // Locked codes ride in every variant (Random = MB+P, Extreme = WILD, around them).
      const mix = locks.length ? mixAt(pool, { level: mode === "extreme" ? "wild" : "mix", locks, rng }) : pickMix(pool, mode, { rng });
      const sig = signature(mix.codes);
      if (seen.has(sig) && attempt < count * 6) continue;
      seen.add(sig);
      out.push({ label: mix.codes.map((code) => names[code] || code).join(" + ") || "No profile", codes: mix.codes, boards: mix.boards, profiles: mix.profiles });
    }
    return out;
  }

  /**
   * One mix at a level, around the locked codes. `current` is the prompt's own
   * codes (what "stays" when nothing of that kind is locked). Returns
   * { profiles, boards, codes, locked }: boards first in `codes`.
   */
  function mixAt(pool, options = {}) {
    const rng = options.rng || Math.random;
    const counts = LEVEL_COUNTS[levelOf(options.level)];
    const profiles = clean(pool && pool.profiles);
    const boards = clean(pool && pool.boards).filter((code) => !profiles.includes(code));
    const isBoard = (code) => boards.includes(code);
    const locked = clean(options.locks);
    const lockedBoards = locked.filter(isBoard);
    const lockedProfiles = locked.filter((code) => !isBoard(code));
    const current = clean(options.current);
    const currentBoards = current.filter(isBoard);
    const currentProfiles = current.filter((code) => !isBoard(code));
    const avoid = options.avoid || "";
    const fill = (range, kept, from) => {
      if (!range) return kept;
      const left = from.filter((code) => !kept.includes(code));
      const want = Math.max(0, between(range[0], range[1], rng) - kept.length);
      return [...kept, ...shuffle(left, rng).slice(0, Math.min(left.length, want))];
    };
    let best = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const pickedBoards = counts.boards ? fill(counts.boards, lockedBoards, boards) : (lockedBoards.length ? lockedBoards : currentBoards);
      const pickedProfiles = counts.profiles ? fill(counts.profiles, lockedProfiles, profiles) : (lockedProfiles.length ? lockedProfiles : currentProfiles);
      best = { profiles: pickedProfiles, boards: pickedBoards, codes: [...pickedBoards, ...pickedProfiles], locked };
      if (!avoid || signature(best.codes) !== avoid) break;
    }
    return best || { profiles: [], boards: [], codes: [], locked };
  }

  // Rerun of a job from the Midjourney feed (mj-rerun.js): a random mix of
  // 1–2 profiles, plus exactly one moodboard when `moodboard` is on (none
  // when off), never the mix the job already had when the pool allows it.
  function rerunMix(pool, options = {}) {
    const rng = options.rng || Math.random;
    const profiles = clean(pool && pool.profiles);
    const boards = clean(pool && pool.boards).filter((code) => !profiles.includes(code));
    const avoid = options.avoid || "";
    let best = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const picked = shuffle(profiles, rng).slice(0, Math.min(profiles.length, between(1, 2, rng)));
      const board = options.moodboard && boards.length ? [boards[Math.floor(rng() * boards.length)]] : [];
      best = { profiles: picked, boards: board, codes: [...board, ...picked] };
      if (!avoid || signature(best.codes) !== avoid) break;
    }
    return best || { profiles: [], boards: [], codes: [] };
  }

  // Style references: `mode` "keep" leaves the prompt's own --sref, "none"
  // takes it out, a code (or several, space separated) replaces it. --sw and
  // --sv stay as they were.
  const SREF_PATTERN = /(^|\s)--sref((?:\s+(?!--)\S+)+)/gi;
  function srefsIn(promptText) {
    const out = [];
    SREF_PATTERN.lastIndex = 0;
    let match;
    while ((match = SREF_PATTERN.exec(String(promptText || "")))) out.push(...match[2].trim().split(/\s+/));
    return out;
  }
  function withSref(promptText, mode) {
    const body = String(promptText || "");
    if (!mode || mode === "keep") return body;
    SREF_PATTERN.lastIndex = 0;
    const stripped = body.replace(SREF_PATTERN, (all, lead) => lead).replace(/[ \t]{2,}/g, " ").trim();
    if (mode === "none") return stripped;
    const code = String(mode).trim();
    return code ? `${stripped} --sref ${code}` : stripped;
  }

  globalScope.SaveToGalleryRandomize = {
    LIMITS, BANNED_CODES, pickMix, signature, codesIn, withCodes, testSet, randomSet, rerunMix, srefsIn, withSref,
    LEVELS, LEVEL_KEYS, RANDOM_STORE, levelOf, nextLevel, randomSettings, locksOf, withLocks, mixAt,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
