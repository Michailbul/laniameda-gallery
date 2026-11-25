// Twin of composeMjCommand in lib/mj-queue.ts: how a queued prompt becomes
// the one command line in Midjourney's Imagine bar. Keep the two identical;
// tests/mj-queue-compose.test.ts runs both on the same fixtures.
(function registerMjQueueCompose(globalScope) {
  "use strict";

  const space = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const num = (value) =>
    typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";

  function pinnedVersion(params) {
    const text = space(params);
    const version = /(?:^|\s)--(?:v|version)\s+(\d+(?:\.\d+)?)/i.exec(text);
    if (version) return version[1];
    const niji = /(?:^|\s)--niji(?:\s+(\d+(?:\.\d+)?))?/i.exec(text);
    return niji ? `niji ${niji[1] || ""}`.trim() : "";
  }

  const major = (version) => Math.floor(Number.parseFloat(version.replace(/^niji\s*/, "")) || 0);

  // Twin of lib/mj-version.ts: every job is --v 8.2 (Michael, 15 Nov 2026:
  // "never use mj v8.1, do not let it happen"; V7 and older since 11 Nov).
  const MJ_VERSION = "8.2";
  const VERSION_FLAG = /(^|\s)(?:--|[–—])(?:v|version)(?:\s+|(?=\d))(\d+(?:\.\d+)?)(?=\s|$)/gi;
  const isRetiredMjVersion = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number < Number.parseFloat(MJ_VERSION);
  };
  const mjVersionWarning = (from) => `v${from} is not used: switched to v${MJ_VERSION}`;

  // Twin of lib/mj-queue.ts: AndromedaCartoon is never used, nor --niji older than 8.
  const MJ_NIJI_MIN = 8;
  const MJ_BANNED_PROFILE_CODES = ["n9iqix8"];
  const BANNED_TOKEN = /(^|\s)n9iqix8(?=\s|$)/gi;
  const BARE_PROFILE_FLAG = /(^|\s)(?:--profile|--p|-p)(?=\s+--|\s*$)/gi;
  const NIJI_FLAG = /(^|\s)(?:--|[–—])niji(?:\s+(\d+(?:\.\d+)?))?(?=\s|$)/gi;
  const HAS_VERSION = /(^|\s)--(?:v|version)\s+\d/i;
  const ANY_VERSION = /(^|\s)(?:--|[–—])(?:v|version)(?:\s+|(?=\d))\d+(?:\.\d+)?(?=\s|$)/gi;
  const MJ_BANNED_PROFILE_WARNING = "AndromedaCartoon profile left out: it is never used.";
  const nijiProfileWarning = (codes) =>
    `Personal profile ${codes.join(" ")} left out: Niji takes moodboards only (personal profiles are V8-only).`;

  function withoutCodes(text, codes) {
    const wanted = new Set(codes.map((code) => String(code).toLowerCase()));
    if (!wanted.size) return { text: space(text), removed: [] };
    const removed = [];
    const out = text.replace(/(^|\s)([A-Za-z0-9]{5,12})(?=\s|$)/g, (whole, lead, token) => {
      if (!wanted.has(token.toLowerCase())) return whole;
      if (!removed.includes(token)) removed.push(token);
      return lead;
    }).replace(BARE_PROFILE_FLAG, "$1");
    return { text: space(out), removed };
  }

  function withoutBannedCodes(text) {
    const out = text.replace(BANNED_TOKEN, "$1").replace(BARE_PROFILE_FLAG, "$1");
    return { text: space(out), removed: space(out) !== space(text) };
  }

  function withoutNiji(params) {
    let niji = "";
    let kept = "";
    const out = params.replace(NIJI_FLAG, (_whole, lead, value) => {
      const allowed = value !== undefined && Number.parseFloat(value) >= MJ_NIJI_MIN;
      if (allowed && !kept) {
        kept = value;
        return `${lead}--niji ${value}`;
      }
      if (!allowed) niji ||= value ? `niji ${value}` : "niji";
      return lead;
    });
    if (kept) return { text: space(out.replace(ANY_VERSION, "$1")), niji };
    if (!niji) return { text: params, niji };
    const text = space(out);
    return { text: HAS_VERSION.test(text) ? text : space(`${text} --v ${MJ_VERSION}`), niji };
  }

  function enforceMjVersion(text) {
    const input = String(text == null ? "" : text);
    const replaced = [];
    let seen = false;
    const output = input.replace(VERSION_FLAG, (whole, lead, value) => {
      const retired = isRetiredMjVersion(value);
      if (retired && !replaced.includes(value)) replaced.push(value);
      if (seen) return "";
      seen = true;
      return retired ? `${lead}--v ${MJ_VERSION}` : whole;
    });
    return { text: output, replaced };
  }

  function composeMjCommand(item) {
    const warnings = [];
    const enforced = enforceMjVersion(space(item && item.params));
    const nijiFree = withoutNiji(space(enforced.text));
    const isNiji = /^niji\b/.test(pinnedVersion(nijiFree.text));
    const v8Only = isNiji ? [...((item && item.v8OnlyCodes) || [])] : [];
    const nijiClean = withoutCodes(nijiFree.text, v8Only);
    const cleanParams = withoutBannedCodes(v8Only.length ? nijiClean.text : nijiFree.text);
    const params = cleanParams.text;
    const droppedForNiji = [...nijiClean.removed];
    for (const from of [item && item.replacedVersion, ...enforced.replaced]) {
      const note = from ? mjVersionWarning(from) : "";
      if (note && !warnings.includes(note)) warnings.push(note);
    }
    if (nijiFree.niji) warnings.push(`${nijiFree.niji} is not used: switched to v${MJ_VERSION}`);
    const version = pinnedVersion(params);
    const parts = [];

    const imageRefs = (item && item.imagePrompts) || [];
    const images = imageRefs.map((ref) => space(ref && ref.url)).filter(Boolean);
    parts.push(...images);
    const cleanProse = withoutBannedCodes(space(item && item.prompt));
    const prose = cleanProse.text;
    if (prose) parts.push(prose);

    const srefs = ((item && item.styleRefs) || [])
      .map((ref) => {
        const base = space(ref && ref.url) || space(ref && ref.code);
        if (!base) return "";
        const weight = num(ref.weight);
        return weight ? `${base}::${weight}` : base;
      })
      .filter(Boolean);
    if (srefs.length) parts.push(`--sref ${srefs.join(" ")}`);

    const imageWeight = imageRefs.map((ref) => num(ref && ref.weight)).find(Boolean);
    if (imageWeight && images.length) parts.push(`--iw ${imageWeight}`);

    if (space(item && item.omniRef && item.omniRef.url)) warnings.push("Omni reference left out: V8.2 has none. Attach the picture for the Edit model instead.");

    if (space(item && item.characterRef && item.characterRef.url)) warnings.push("Character reference left out: V8.2 has none. Attach the picture for the Edit model instead.");

    const allCodes = [...new Set(((item && item.profileCodes) || []).map(space).filter(Boolean))];
    const unbanned = allCodes.filter((code) => !MJ_BANNED_PROFILE_CODES.includes(code.toLowerCase()));
    const v8OnlySet = new Set(v8Only.map((code) => String(code).toLowerCase()));
    const codes = unbanned.filter((code) => {
      if (!v8OnlySet.has(code.toLowerCase())) return true;
      if (!droppedForNiji.includes(code)) droppedForNiji.push(code);
      return false;
    });
    if (codes.length) parts.push(`--profile ${codes.join(" ")}`);
    if (unbanned.length < allCodes.length || cleanParams.removed || cleanProse.removed) warnings.push(MJ_BANNED_PROFILE_WARNING);
    if (droppedForNiji.length) warnings.push(nijiProfileWarning(droppedForNiji));
    if (params) parts.push(params);

    const edits = ((item && item.editRefs) || []).map((ref) => space(ref && ref.url)).filter(Boolean).slice(0, 4);
    if (edits.length) {
      if (!version || major(version) >= 8) parts.push(`--edit ${edits.join(" ")}`);
      else warnings.push("Attached frame left out: the Edit model is V8.2. Drop --niji to keep the layout.");
    }

    if (!prose && !images.length) warnings.push("No prompt words yet.");
    return { command: parts.join(" "), warnings };
  }

  // Midjourney may tidy what it is given (spacing, a default it strips). The
  // bar still says what was queued when the words and every flag token match.
  function sameCommand(a, b) {
    return space(a) === space(b);
  }

  // Twin of threadIdOf in lib/mj-queue.ts: "thr-" + FNV-1a (32 bit) of the batch key.
  function threadIdOf(batchKey) {
    const key = space(batchKey).toLowerCase();
    let hash = 0x811c9dc5;
    for (const char of key) {
      const code = char.codePointAt(0) || 0;
      const bytes = code < 0x80 ? [code] : new TextEncoder().encode(char);
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
    return `thr-${hash.toString(16).padStart(8, "0")}`;
  }

  globalScope.SaveToGalleryMjQueueCompose = { composeMjCommand, enforceMjVersion, pinnedVersion, sameCommand, threadIdOf, withoutNiji, withoutBannedCodes, withoutCodes };
})(typeof globalThis !== "undefined" ? globalThis : self);
