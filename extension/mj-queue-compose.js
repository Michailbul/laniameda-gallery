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
    const params = space(enforced.text);
    for (const from of [item && item.replacedVersion, ...enforced.replaced]) {
      const note = from ? mjVersionWarning(from) : "";
      if (note && !warnings.includes(note)) warnings.push(note);
    }
    const version = pinnedVersion(params);
    const parts = [];

    const imageRefs = (item && item.imagePrompts) || [];
    const images = imageRefs.map((ref) => space(ref && ref.url)).filter(Boolean);
    parts.push(...images);
    const prose = space(item && item.prompt);
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

    const character = space(item && item.characterRef && item.characterRef.url);
    if (character) {
      if (version.startsWith("niji") && major(version) === 6) {
        parts.push(`--cref ${character}`);
        const weight = num(item.characterRef.weight);
        if (weight) parts.push(`--cw ${weight}`);
      } else {
        warnings.push("Character reference left out: V8.2 has none. Attach the picture for the Edit model instead.");
      }
    }

    const codes = [...new Set(((item && item.profileCodes) || []).map(space).filter(Boolean))];
    if (codes.length) parts.push(`--profile ${codes.join(" ")}`);
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

  globalScope.SaveToGalleryMjQueueCompose = { composeMjCommand, enforceMjVersion, pinnedVersion, sameCommand, threadIdOf };
})(typeof globalThis !== "undefined" ? globalThis : self);
