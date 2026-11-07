// Midjourney prompt queue: how a queued item becomes the one command line
// Michael sends from the Imagine bar. The extension carries a line-for-line
// twin of composeMjCommand (extension/mj-queue-compose.js); the parity test
// (tests/mj-queue-compose.test.ts) keeps the two identical.

export const MJ_QUEUE_STATUSES = ["queued", "injected", "sent", "skipped"] as const;
export type MjQueueStatus = (typeof MJ_QUEUE_STATUSES)[number];

export const MJ_QUEUE_LIMITS = {
  itemsPerCall: 50,
  itemsPerBatch: 200,
  batch: 120,
  title: 120,
  prompt: 6000,
  params: 600,
  note: 1000,
  imagePrompts: 5,
  styleRefs: 10,
  profileCodes: 10,
  url: 2048,
  listItems: 500,
} as const;

export type MjQueueRef = { url?: string; code?: string; weight?: number };
export type MjQueueComposable = {
  prompt: string;
  imagePrompts?: MjQueueRef[];
  styleRefs?: MjQueueRef[];
  omniRef?: MjQueueRef | null;
  characterRef?: MjQueueRef | null;
  profileCodes?: string[];
  params?: string;
};

const space = (value: string | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();
const num = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";

// The model version the params pin, e.g. "7", "6.1", "niji 6"; "" = default (V8.2).
export function pinnedVersion(params: string | undefined) {
  const text = space(params);
  const version = /(?:^|\s)--(?:v|version)\s+(\d+(?:\.\d+)?)/i.exec(text);
  if (version) return version[1];
  const niji = /(?:^|\s)--niji(?:\s+(\d+(?:\.\d+)?))?/i.exec(text);
  return niji ? `niji ${niji[1] || ""}`.trim() : "";
}

const major = (version: string) => Math.floor(Number.parseFloat(version.replace(/^niji\s*/, "")) || 0);

export function batchKeyOf(batch: string) {
  return space(batch).toLowerCase();
}

// A thread is one batch. Its id is a stable short hash of the batch key
// (FNV-1a, 32 bit): "thr-" and eight hex digits. Michael copies it from the
// extension's Queue panel; agents may pass it wherever a batch label goes.
// The extension carries a twin (extension/mj-queue-compose.js).
export const MJ_THREAD_ID = /^thr-[0-9a-f]{8}$/;

export function threadIdOf(batchKey: string) {
  let hash = 0x811c9dc5;
  for (const char of batchKeyOf(batchKey)) {
    const code = char.codePointAt(0) ?? 0;
    for (const byte of code < 0x80 ? [code] : new TextEncoder().encode(char)) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `thr-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Image prompts first, then the prose, then the reference flags, the profile
 * codes and the params as written. V8.2 has no omni or character reference
 * (the Edit model replaced both): those flags are added only when the params
 * pin a version that reads them, otherwise the item carries a warning.
 */
export function composeMjCommand(item: MjQueueComposable) {
  const warnings: string[] = [];
  const params = space(item.params);
  const version = pinnedVersion(params);
  const parts: string[] = [];

  const images = (item.imagePrompts ?? []).map((ref) => space(ref.url)).filter(Boolean);
  parts.push(...images);
  const prose = space(item.prompt);
  if (prose) parts.push(prose);

  const srefs = (item.styleRefs ?? [])
    .map((ref) => {
      const base = space(ref.url) || space(ref.code);
      if (!base) return "";
      const weight = num(ref.weight);
      return weight ? `${base}::${weight}` : base;
    })
    .filter(Boolean);
  if (srefs.length) parts.push(`--sref ${srefs.join(" ")}`);

  const imageWeight = (item.imagePrompts ?? []).map((ref) => num(ref.weight)).find(Boolean);
  if (imageWeight && images.length) parts.push(`--iw ${imageWeight}`);

  const omni = space(item.omniRef?.url);
  if (omni) {
    if (major(version) === 7 && !version.startsWith("niji")) {
      parts.push(`--oref ${omni}`);
      const weight = num(item.omniRef?.weight);
      if (weight) parts.push(`--ow ${weight}`);
    } else {
      warnings.push("Omni reference left out: V8.2 has none. Use it in the Edit model, or pin --v 7.");
    }
  }

  const character = space(item.characterRef?.url);
  if (character) {
    if (major(version) === 6) {
      parts.push(`--cref ${character}`);
      const weight = num(item.characterRef?.weight);
      if (weight) parts.push(`--cw ${weight}`);
    } else {
      warnings.push("Character reference left out: only V6 reads it. Use the Edit model in V8.2.");
    }
  }

  const codes = [...new Set((item.profileCodes ?? []).map(space).filter(Boolean))];
  if (codes.length) parts.push(`--profile ${codes.join(" ")}`);
  if (params) parts.push(params);

  if (!prose && !images.length) warnings.push("No prompt words yet.");
  return { command: parts.join(" "), warnings };
}
