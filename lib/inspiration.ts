import { GALLERY_ORIGIN } from "./gallery-routes";

// Inspiration review: saved references, their proposed project adaptations,
// versions and Michael's feedback. Shared by convex/inspiration.ts, the agent
// route, the MCP schemas and the /inspiration screens.

export const INSPIRATION_URL_PATH = "/inspiration";

export const INSPIRATION_LIMITS = {
  title: 200,
  url: 2000,
  creator: 200,
  caption: 8000,
  text: 20_000,
  note: 4000,
  intendedUse: 400,
  label: 120,
  reason: 600,
  ingestKey: 300,
  eventKey: 200,
  assets: 50,
  categories: 8,
  category: 40,
  sourceCollections: 10,
  outputs: 12,
  references: 24,
  prompt: 12_000,
  versionText: 40_000,
  versionNotes: 4000,
  // Sources read per list call; the page asks for more with a cursor.
  page: 60,
  scan: 300,
  // Adaptations read per source; versions read per adaptation.
  adaptationsPerSource: 20,
  versionsPerAdaptation: 30,
  events: 200,
} as const;

export const INSPIRATION_PLATFORMS = ["instagram", "telegram", "x", "pinterest", "youtube", "web", "photo", "other"] as const;
export type InspirationPlatform = (typeof INSPIRATION_PLATFORMS)[number];

export const INSPIRATION_PRESERVATION = [
  "source_served_file", "owner_uploaded_bytes", "screenshot_only", "keyframes_only", "link_only", "text", "unavailable",
] as const;
export type InspirationPreservation = (typeof INSPIRATION_PRESERVATION)[number];

export const INSPIRATION_SOURCE_REVIEWS = ["new", "kept", "dropped"] as const;
export type InspirationSourceReview = (typeof INSPIRATION_SOURCE_REVIEWS)[number];

export const INSPIRATION_ADAPTATION_STATUSES = ["proposed", "changes_requested", "ready", "approved", "dropped", "blocked"] as const;
export type InspirationAdaptationStatus = (typeof INSPIRATION_ADAPTATION_STATUSES)[number];

export const INSPIRATION_ROUTINGS = ["owner", "mapping", "suggestion"] as const;

/** Plain words Michael reads for each state. */
export const ADAPTATION_STATUS_LABEL: Record<InspirationAdaptationStatus, string> = {
  proposed: "Proposed",
  changes_requested: "Change requested",
  ready: "Ready to review",
  approved: "Approved",
  dropped: "Dropped",
  blocked: "Blocked",
};

export const PRESERVATION_LABEL: Record<InspirationPreservation, string> = {
  source_served_file: "Platform file",
  owner_uploaded_bytes: "Your upload",
  screenshot_only: "Screenshot only",
  keyframes_only: "Key frames only",
  link_only: "Link only",
  text: "Text",
  unavailable: "Unavailable",
};

export const PLATFORM_LABEL: Record<InspirationPlatform, string> = {
  instagram: "Instagram", telegram: "Telegram", x: "X", pinterest: "Pinterest",
  youtube: "YouTube", web: "Web", photo: "Photo", other: "Other",
};

export const inspirationPath = (sourceId?: string) =>
  sourceId ? `${INSPIRATION_URL_PATH}/${encodeURIComponent(sourceId)}` : INSPIRATION_URL_PATH;

export const inspirationUrl = (sourceId?: string) => `${GALLERY_ORIGIN}${inspirationPath(sourceId)}`;

/** Collapse whitespace and cut to a limit; empty becomes undefined. */
export const cleanLine = (value: string | undefined, limit: number) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, limit) : undefined;
};

/** Dispatch safety (convex/inspirationDispatch.ts). */
export const INSPIRATION_DISPATCH = {
  // Cycles are fixed 48-hour windows of real time from an anchor.
  cycleHours: 48,
  leaseMinutes: 30,
  maxLeaseMinutes: 120,
  // A standing allowance is offered up to this much per cycle; larger batches
  // are approved one by one (CLAUDE.md: ask at $30 or more).
  maxCycleCapUsd: 30,
  defaultAllowanceDays: 14,
  maxAllowanceDays: 60,
  scan: 500,
  listed: 50,
  ingestKey: 300,
  label: 120,
  handle: 300,
  note: 600,
} as const;

/** Start of the fixed-length cycle that contains `now` (anchor + k × cycle). */
export const cycleStartAt = (anchor: number, cycleHours: number, now: number) => {
  const length = cycleHours * 3_600_000;
  if (now <= anchor) return anchor;
  return anchor + Math.floor((now - anchor) / length) * length;
};
