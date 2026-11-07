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

  function composeMjCommand(item) {
    const warnings = [];
    const params = space(item && item.params);
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

    const omni = space(item && item.omniRef && item.omniRef.url);
    if (omni) {
      if (major(version) === 7 && !version.startsWith("niji")) {
        parts.push(`--oref ${omni}`);
        const weight = num(item.omniRef.weight);
        if (weight) parts.push(`--ow ${weight}`);
      } else {
        warnings.push("Omni reference left out: V8.2 has none. Use it in the Edit model, or pin --v 7.");
      }
    }

    const character = space(item && item.characterRef && item.characterRef.url);
    if (character) {
      if (major(version) === 6) {
        parts.push(`--cref ${character}`);
        const weight = num(item.characterRef.weight);
        if (weight) parts.push(`--cw ${weight}`);
      } else {
        warnings.push("Character reference left out: only V6 reads it. Use the Edit model in V8.2.");
      }
    }

    const codes = [...new Set(((item && item.profileCodes) || []).map(space).filter(Boolean))];
    if (codes.length) parts.push(`--profile ${codes.join(" ")}`);
    if (params) parts.push(params);

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

  globalScope.SaveToGalleryMjQueueCompose = { composeMjCommand, pinnedVersion, sameCommand, threadIdOf };
})(typeof globalThis !== "undefined" ? globalThis : self);
