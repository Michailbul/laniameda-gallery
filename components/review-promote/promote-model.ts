// Shapes and choices behind the PROMOTE TO DIRECTOR REVIEW key (R). The
// backend is convex/review.ts (promoteTargets, promote); its return values are
// untyped (v.any()), so the fields this UI reads are spelled out here.

export type PromoteFrame = { id: string; thumb?: string; name?: string };

export type PromoteFolder = {
  id: string;
  section: "locations" | "characters" | "scenes";
  area?: string;
  name: string;
  slug: string;
};

export type PromoteStyle = { id: string; label: string; name: string };

export type PromoteSuggestion = {
  assetId: string;
  folderId?: string;
  styleId?: string;
  inCurrent: boolean;
  inDraft: boolean;
  inWorld?: boolean;
  thumb?: string;
};

export type PromoteProject = {
  slug: string;
  title: string;
  worldFolderId?: string;
  hasDraft: boolean;
  currentLabel?: string;
  draftLabel?: string;
  folders: PromoteFolder[];
  styles: PromoteStyle[];
  suggestions: PromoteSuggestion[];
};

export type PromoteChoice = {
  project: PromoteProject;
  folder: PromoteFolder;
  style?: PromoteStyle;
  note?: string;
};

export type PromoteOutcome = {
  slug: string;
  count: number;
  added: number;
  updated: number;
  folderName: string;
  styleLabel?: string;
  draftLabel: string;
  thumbs: string[];
};

// ------------------------------------------------------------ memory

type Remembered = { folderId: string; styleId: string | null; at: number };
type Memory = { projects: Record<string, Remembered> };

const STORAGE_KEY = "lm.reviewPromote.v1";

export const readMemory = (): Memory => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Memory>) : null;
    return { projects: parsed?.projects && typeof parsed.projects === "object" ? parsed.projects : {} };
  } catch {
    return { projects: {} };
  }
};

/** The last destination per review project, for Shift+R and the palette. */
export const rememberDestination = (slug: string, folderId: string, styleId: string | null) => {
  try {
    const memory = readMemory();
    memory.projects[slug] = { folderId, styleId, at: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Private mode or a full quota: Shift+R just opens the palette next time.
  }
};

// ------------------------------------------------------------ choices

const inWorld = (project: PromoteProject) => project.suggestions.some((row) => row.inWorld);
const usedAt = (memory: Memory, slug: string) => memory.projects[slug]?.at ?? 0;

/**
 * The project the palette opens on: one whose world holds the frames, the most
 * recently used of those; without one, the most recently used of all.
 */
export const preselectProject = (projects: PromoteProject[], memory: Memory) => {
  const home = projects.filter(inWorld);
  const pool = home.length ? home : projects;
  return [...pool].sort((a, b) => usedAt(memory, b.slug) - usedAt(memory, a.slug))[0];
};

const mostCommon = (values: Array<string | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  for (const [value, count] of counts) if (!best || count > counts.get(best)!) best = value;
  return best;
};

/** Folder and style the palette preselects: the suggestion, else the last used. */
export const preselectPlace = (project: PromoteProject, memory: Memory) => {
  const last = memory.projects[project.slug];
  const folderIds = new Set(project.folders.map((row) => row.id));
  const styleIds = new Set(project.styles.map((row) => row.id));
  const suggestedFolder = mostCommon(project.suggestions.map((row) => row.folderId));
  const suggestedStyle = mostCommon(project.suggestions.map((row) => row.styleId));
  const folderId = [suggestedFolder, last?.folderId].find((id) => id && folderIds.has(id));
  const styleId = [suggestedStyle, last?.styleId ?? undefined].find((id) => id && styleIds.has(id));
  return { folderId, styleId, suggestedFolder, suggestedStyle, lastFolder: last?.folderId };
};

/**
 * Shift+R: the remembered destination of the frames' own review project (the
 * most recently used one whose world holds them). Null sends the owner to the
 * palette instead: no project for this world yet, nothing remembered, or the
 * remembered folder or style is gone.
 */
export const lastDestination = (projects: PromoteProject[], memory: Memory): PromoteChoice | null => {
  const project = projects
    .filter((row) => inWorld(row) && memory.projects[row.slug])
    .sort((a, b) => usedAt(memory, b.slug) - usedAt(memory, a.slug))[0];
  if (!project) return null;
  const last = memory.projects[project.slug]!;
  const folder = project.folders.find((row) => row.id === last.folderId);
  if (!folder) return null;
  const style = last.styleId ? project.styles.find((row) => row.id === last.styleId) : undefined;
  if (last.styleId && !style) return null;
  return { project, folder, style };
};

const fold = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Every typed word must appear in the folder's name, area, section or slug. */
export const filterFolders = (folders: PromoteFolder[], query: string) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return folders;
  return folders.filter((row) => {
    const hay = fold(`${row.name} ${row.area ?? ""} ${row.section} ${row.slug}`);
    return words.every((word) => hay.includes(word));
  });
};

export const reviewHref = (slug: string) => `/review/${encodeURIComponent(slug)}?draft=1`;

/** The director review a world is shown in (world key → review slug). */
const DIRECTOR_REVIEWS: Record<string, string> = { cassandra: "cassandra" };
export const MAIN_DIRECTOR_REVIEW = "/review/cassandra";
export const directorReviewPath = (worldKey?: string) => {
  const slug = worldKey ? DIRECTOR_REVIEWS[worldKey] : undefined;
  return slug ? `/review/${slug}` : undefined;
};

export const framesWord = (count: number) => `${count} ${count === 1 ? "frame" : "frames"}`;
