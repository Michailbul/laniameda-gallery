// World styles: the pure parts shared by Convex, the agent routes and the
// styles page. Client-safe: no server imports.
//
// A style is how a frame is made (medium, rendering, light, palette), whatever
// it shows. A world holds several; a universe (DEAR ANNETE and its sibling
// worlds) shows them all on one page.

export const STYLE_LIMITS = {
  name: 80,
  line: 280,
  family: 40,
  notes: 4000,
  covers: 12,
  recipes: 8,
  recipeText: 2000,
  parameters: 300,
  listItems: 12,
  listItem: 300,
  codes: 12,
  /** Lookup items per call (the route splits them into Convex-sized chunks). */
  lookup: 500,
  lookupChunk: 40,
} as const;

/** The group a merged style's shelf moves to; the shelf is kept, never deleted. */
export const MERGED_SHELF_GROUP = "Merged";
export const STYLE_SHELF_GROUP = "Styles";

export const styleSlug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * The short label of a world inside its universe: "DEAR ANNETE — 3D" in the
 * DEAR ANNETE universe reads "3D". The universe's own world keeps its name.
 */
export const worldShortName = (worldName: string, universeName: string) => {
  const name = worldName.trim();
  const head = universeName.trim();
  if (!head || name.toLowerCase() === head.toLowerCase()) return name;
  if (name.toLowerCase().startsWith(head.toLowerCase())) {
    const rest = name.slice(head.length).replace(/^[\s—–\-:·|]+/, "").trim();
    if (rest) return rest;
  }
  return name;
};

/** Names joined in stack order: "DA DECO · World + ART DECO 1". */
export const recipeLabel = (parts: ReadonlyArray<string>) => parts.filter(Boolean).join(" + ");

/* ── "Is this in the gallery?" ───────────────────────────────────────────── */

// A local board names a Midjourney frame many ways: the job permalink
// (midjourney.com/jobs/<job>?index=2), the CDN file (cdn.midjourney.com/<job>/0_2.png),
// the saved file name (mj-<job>-2.png) or its own short id (<first 8 of job>-2).
// Each becomes a job prefix and an optional tile index; the gallery matches it
// by prefix ranges over sourceUrl and fileName.

export type LookupQuery =
  | { kind: "asset"; raw: string; assetId: string }
  | { kind: "mj"; raw: string; job: string; index?: number }
  | { kind: "url"; raw: string; url: string }
  | { kind: "name"; raw: string; value: string };

const JOB = "[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?";
const FULL_JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tileIndex = (value: string | null | undefined) => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 16 ? n : undefined;
};

export function parseLookupQuery(input: string): LookupQuery | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const asset = /^asset:([a-z0-9]{20,40})$/i.exec(raw);
  if (asset) return { kind: "asset", raw, assetId: asset[1]! };
  const jobUrl = new RegExp(`midjourney\\.com/jobs/(${JOB})(?:[/?#].*)?$`).exec(lower);
  if (jobUrl) {
    const index = /[?&]index=(\d+)/.exec(lower)?.[1];
    return { kind: "mj", raw, job: jobUrl[1]!, index: tileIndex(index) };
  }
  const cdn = new RegExp(`cdn\\.midjourney\\.com/(?:video/)?(${JOB})/(?:\\d+_)?(\\d+)?`).exec(lower);
  if (cdn) return { kind: "mj", raw, job: cdn[1]!, index: tileIndex(cdn[2]) };
  const file = new RegExp(`^mj-(${JOB})(?:-(\\d+))?(?:\\.[a-z0-9]+)?$`).exec(lower);
  if (file) return { kind: "mj", raw, job: file[1]!, index: tileIndex(file[2]) };
  // A board's own id: <8 hex of the job>-<tile>, or a whole job id with a tile.
  const short = new RegExp(`^(${JOB})-(\\d{1,2})$`).exec(lower);
  if (short) return { kind: "mj", raw, job: short[1]!, index: tileIndex(short[2]) };
  if (FULL_JOB.test(lower) || /^[0-9a-f]{8}$/.test(lower)) return { kind: "mj", raw, job: lower };
  if (/^https?:\/\//i.test(raw)) return { kind: "url", raw, url: raw };
  return { kind: "name", raw, value: raw };
}

/** Prefix ranges the lookup reads for a Midjourney job (full id or 8-hex prefix). */
export const mjSourcePrefixes = (job: string) => [
  `https://www.midjourney.com/jobs/${job}`,
  `https://midjourney.com/jobs/${job}`,
  `https://cdn.midjourney.com/${job}`,
];
export const mjFilePrefix = (job: string) => `mj-${job}`;

/** The job and tile a saved asset carries, read from its sourceUrl or file name. */
export function mjIdentityOf(asset: { sourceUrl?: string | null; fileName?: string | null; midjourneyMetadata?: { jobId?: string; tileIndex?: number } | null }) {
  if (asset.midjourneyMetadata?.jobId) {
    const fromSource = asset.sourceUrl ? parseLookupQuery(asset.sourceUrl) : null;
    const index = asset.midjourneyMetadata.tileIndex ?? (fromSource?.kind === "mj" ? fromSource.index : undefined);
    return { job: asset.midjourneyMetadata.jobId.toLowerCase(), index };
  }
  for (const value of [asset.sourceUrl, asset.fileName]) {
    const parsed = value ? parseLookupQuery(value) : null;
    if (parsed?.kind === "mj") return { job: parsed.job, index: parsed.index };
  }
  return null;
}

/** True when a saved frame is the one a query names (job prefix + tile when given). */
export const mjMatches = (query: { job: string; index?: number }, identity: { job: string; index?: number } | null) =>
  Boolean(identity && identity.job.startsWith(query.job) && (query.index === undefined || identity.index === query.index));

/* ── What a frame was made with ──────────────────────────────────────────── */

/**
 * The personalization codes a Midjourney prompt runs with, in order:
 * every word after `--profile` / `--p` up to the next flag. Moodboards appear
 * as their short code or as `m<id>`; profiles as their code.
 */
export function profileCodesIn(prompt: string | null | undefined): string[] {
  if (!prompt) return [];
  const codes: string[] = [];
  for (const match of prompt.matchAll(/(?:^|\s)--(?:profile|p)\s+((?:(?!--)\S+\s*)+)/gi)) {
    for (const word of match[1]!.trim().split(/\s+/)) {
      const code = word.replace(/[,;.]+$/, "");
      if (/^[a-z0-9]{3,40}$/i.test(code) && !codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}
