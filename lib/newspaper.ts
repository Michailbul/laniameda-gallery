import { GALLERY_ORIGIN, galleryRoutePath } from "./gallery-routes";

// The morning newspaper: one edition per day (Europe/Prague date), compiled
// from the gallery's own tables at 07:30 Prague by a Convex cron, read by
// Michael on his phone at /newspaper. Shared by the Convex backend, the agent
// route, the MCP schemas and the /newspaper screens.

export const NEWSPAPER_TIMEZONE = "Europe/Prague";

export const NEWSPAPER_LIMITS = {
  // The agent's narrative paragraph(s), markdown.
  prose: 12_000,
  writtenBy: 80,
  // Journal summaries kept per world.
  summaries: 12,
  // New-asset thumbnails kept per world (and for the studio).
  thumbnails: 12,
  // Rows scanned per table per compile; the paper is a digest, not an audit.
  scan: 600,
  // Result excerpt on a done or blocked task.
  excerpt: 280,
  // Editions the date picker lists.
  list: 60,
  // The window one edition covers.
  windowMs: 24 * 60 * 60 * 1000,
} as const;

export const NEWSPAPER_STATUSES = ["compiled", "written"] as const;
export type NewspaperStatus = (typeof NEWSPAPER_STATUSES)[number];

export const NEWSPAPER_URL_PATH = "/newspaper";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` in Europe/Prague for a moment in time. The edition's key. */
export const pragueDateKey = (at: number = Date.now()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NEWSPAPER_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const isDateKey = (value: string): boolean => {
  if (!DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
};

/** The edition's page: `/newspaper/2026-10-30`. */
export const newspaperPath = (date: string) => `${NEWSPAPER_URL_PATH}/${date}`;
export const newspaperUrl = (date: string) => `${GALLERY_ORIGIN}${newspaperPath(date)}`;

/** Shift a date key by whole days (UTC arithmetic on the key itself). */
export const shiftDateKey = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  return next.toISOString().slice(0, 10);
};

/** "Thursday 30 October 2026" for the masthead. */
export const dateKeyLabel = (date: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
};

/** The first `max` characters of a markdown result, on one line. */
export const excerpt = (text: string | undefined, max: number = NEWSPAPER_LIMITS.excerpt) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
};

/* Where an item opens. Paths, not origins: the UI links them as they are and
   the agent route prefixes GALLERY_ORIGIN (see absoluteUrl). */
export const taskPath = (taskId: string) => `/tasks?task=${taskId}`;
export const stackPath = (worldFolderId: string, stackId: string) => `/inbox/${worldFolderId}/${stackId}`;
export const assetPath = (assetId: string) => galleryRoutePath({ kind: "home" }, assetId);
export const worldPath = (world: string, tab?: "tasks" | "journal" | "moodboards") => galleryRoutePath({ kind: "world", world, tab });
export const moodboardPath = (moodboardId: string) => galleryRoutePath({ kind: "moodboards", id: moodboardId });
export const storybookPath = (folderId: string) => galleryRoutePath({ kind: "storybooks", id: folderId });
export const absoluteUrl = (path: string) => `${GALLERY_ORIGIN}${path}`;
