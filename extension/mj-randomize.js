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

(function registerRandomize(globalScope) {
  "use strict";

  const BANNED_CODES = new Set(["n9iqix8"]);
  const FLAG_PATTERN = /(^|\s)(--profile|--p|-p)((?:\s+[^\s-]\S*)+)/g;
  const BARE_P_PATTERN = /(^|\s)(--profile|--p|-p)(?=\s+--|\s*$)/g;

  const LIMITS = {
    random: { minProfiles: 1, maxProfiles: 2, minBoards: 0, maxBoards: 1 },
    extreme: { minProfiles: 1, maxProfiles: 3, minBoards: 0, maxBoards: 2 },
  };

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
    for (let attempt = 0; out.length < count && attempt < count * 8; attempt += 1) {
      const mix = pickMix(pool, mode, { rng });
      const sig = signature(mix.codes);
      if (seen.has(sig) && attempt < count * 6) continue;
      seen.add(sig);
      out.push({ label: mix.codes.map((code) => names[code] || code).join(" + ") || "No profile", codes: mix.codes, boards: mix.boards, profiles: mix.profiles });
    }
    return out;
  }

  globalScope.SaveToGalleryRandomize = { LIMITS, BANNED_CODES, pickMix, signature, codesIn, withCodes, testSet, randomSet };
})(typeof globalThis !== "undefined" ? globalThis : self);
