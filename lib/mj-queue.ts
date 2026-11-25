// Midjourney prompt queue: how a queued item becomes the one command line
// Michael sends from the Imagine bar. The extension carries a line-for-line
// twin of composeMjCommand (extension/mj-queue-compose.js); the parity test
// (tests/mj-queue-compose.test.ts) keeps the two identical.

import { MJ_VERSION, enforceMjVersion, mjVersionWarning } from "./mj-version";

// Never used in any queued command (Michael, 11 Nov 2026: AndromedaCartoon).
export const MJ_BANNED_PROFILE_CODES = ["n9iqix8"] as const;
const BANNED_TOKEN = /(^|\s)n9iqix8(?=\s|$)/gi;
const BARE_PROFILE_FLAG = /(^|\s)(?:--profile|--p|-p)(?=\s+--|\s*$)/gi;
// "--niji", "--niji 6", "—niji 7": older Niji is not used; those jobs go out as V8.2.
// Niji 8 and later stay as written (Michael, 25 Nov 2026: "make sure it allows niji8 as well").
export const MJ_NIJI_MIN = 8;
const NIJI_FLAG = /(^|\s)(?:--|[–—])niji(?:\s+(\d+(?:\.\d+)?))?(?=\s|$)/gi;
const HAS_VERSION = /(^|\s)--(?:v|version)\s+\d/i;
const ANY_VERSION = /(^|\s)(?:--|[–—])(?:v|version)(?:\s+|(?=\d))\d+(?:\.\d+)?(?=\s|$)/gi;
export const MJ_BANNED_PROFILE_WARNING = "AndromedaCartoon profile left out: it is never used.";

/** Text without the banned profile code (and a profile flag it leaves empty). */
export function withoutBannedCodes(text: string) {
  const out = text.replace(BANNED_TOKEN, "$1").replace(BARE_PROFILE_FLAG, "$1");
  return { text: space(out), removed: space(out) !== space(text) };
}

/**
 * Params with an older --niji (6, 7, bare) replaced by --v 8.2 and the niji it replaced ("niji 6").
 * --niji 8 and later stay (written as "--niji 8"); a --v next to it is dropped, since a job runs one model.
 */
export function withoutNiji(params: string) {
  let niji = "";
  let kept = "";
  const out = params.replace(NIJI_FLAG, (_whole: string, lead: string, value: string | undefined) => {
    const allowed = value !== undefined && Number.parseFloat(value) >= MJ_NIJI_MIN;
    if (allowed && !kept) {
      kept = value!;
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

export const MJ_QUEUE_STATUSES = ["queued", "injected", "sent", "skipped"] as const;
export type MjQueueStatus = (typeof MJ_QUEUE_STATUSES)[number];

export const MJ_QUEUE_LIMITS = {
  itemsPerCall: 50,
  // A thread with its reruns (39 prompts × a few runs) fits.
  itemsPerBatch: 400,
  batch: 120,
  title: 120,
  prompt: 6000,
  params: 600,
  note: 1000,
  imagePrompts: 5,
  styleRefs: 10,
  profileCodes: 10,
  editRefs: 4,
  url: 2048,
  listItems: 500,
  listOpenItems: 1500,
  // Owner rows read per list: the thread counts come from these.
  listRows: 2500,
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
  // Images attached to the prompt for Midjourney's Edit model (V8.2, up to
  // four): "--edit url1 url2". An attached frame holds its layout (restyle).
  editRefs?: MjQueueRef[];
  // The retired version an agent pinned (8.1, 7 …) that was stored as --v 8.2.
  replacedVersion?: string;
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
 * codes and the params as written, except the version: every job is --v 8.2
 * (lib/mj-version.ts), so --v 8.1, --v 7 and older become --v 8.2 with a
 * warning; --niji 6/7 are not used either and become --v 8.2 the same way, while --niji 8 and later stay. V8.2
 * has no omni or character reference (the Edit model replaced both): --oref
 * and --cref are never added. The AndromedaCartoon profile (n9iqix8) is left
 * out of every command.
 */
export function composeMjCommand(item: MjQueueComposable) {
  const warnings: string[] = [];
  const enforced = enforceMjVersion(space(item.params));
  const nijiFree = withoutNiji(space(enforced.text));
  const cleanParams = withoutBannedCodes(nijiFree.text);
  const params = cleanParams.text;
  for (const from of [item.replacedVersion, ...enforced.replaced]) {
    const note = from ? mjVersionWarning(from) : "";
    if (note && !warnings.includes(note)) warnings.push(note);
  }
  if (nijiFree.niji) warnings.push(`${nijiFree.niji} is not used: switched to v${MJ_VERSION}`);
  const version = pinnedVersion(params);
  const parts: string[] = [];

  const images = (item.imagePrompts ?? []).map((ref) => space(ref.url)).filter(Boolean);
  parts.push(...images);
  const cleanProse = withoutBannedCodes(space(item.prompt));
  const prose = cleanProse.text;
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

  if (space(item.omniRef?.url)) warnings.push("Omni reference left out: V8.2 has none. Attach the picture for the Edit model instead.");

  if (space(item.characterRef?.url)) warnings.push("Character reference left out: V8.2 has none. Attach the picture for the Edit model instead.");

  const allCodes = [...new Set((item.profileCodes ?? []).map(space).filter(Boolean))];
  const codes = allCodes.filter((code) => !(MJ_BANNED_PROFILE_CODES as readonly string[]).includes(code.toLowerCase()));
  if (codes.length) parts.push(`--profile ${codes.join(" ")}`);
  if (codes.length < allCodes.length || cleanParams.removed || cleanProse.removed) warnings.push(MJ_BANNED_PROFILE_WARNING);
  if (params) parts.push(params);

  const edits = (item.editRefs ?? []).map((ref) => space(ref.url)).filter(Boolean).slice(0, 4);
  if (edits.length) {
    if (!version || major(version) >= 8) parts.push(`--edit ${edits.join(" ")}`);
    else warnings.push("Attached frame left out: the Edit model is V8.2. Drop --niji to keep the layout.");
  }

  if (!prose && !images.length) warnings.push("No prompt words yet.");
  return { command: parts.join(" "), warnings };
}

const projectNorm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Projects inside a world's queue: a thread labelled "HEEL · the kitchen" belongs to project HEEL when the
 * first part is not the world's own name and at least two threads of that world share it (Michael, 25 Nov 2026:
 * "create it a separate project in the queue called Heel"). Returns batchKey → project name as written.
 * The extension's rail (extension/mj-queue.js projectOf) uses the same rule.
 */
export function queueProjects(
  threads: ReadonlyArray<{ batch: string; batchKey: string; worldKey?: string | null }>,
  worldName: (worldKey: string | undefined) => string,
) {
  const heads = new Map<string, number>();
  const headOf = (thread: { batch: string; worldKey?: string | null }) => {
    const parts = thread.batch.split(/\s+·\s+/);
    if (parts.length < 2) return "";
    const head = projectNorm(parts[0]!);
    const world = projectNorm(worldName(thread.worldKey ?? undefined));
    return head && !world.startsWith(head) ? head : "";
  };
  for (const thread of threads) {
    const head = headOf(thread);
    if (head) heads.set(`${thread.worldKey ?? ""}::${head}`, (heads.get(`${thread.worldKey ?? ""}::${head}`) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const thread of threads) {
    const head = headOf(thread);
    if (head && (heads.get(`${thread.worldKey ?? ""}::${head}`) ?? 0) >= 2) out.set(thread.batchKey, thread.batch.split(/\s+·\s+/)[0]!);
  }
  return out;
}
