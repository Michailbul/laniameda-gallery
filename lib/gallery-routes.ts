/**
 * Every view of the gallery as a URL, and back.
 *
 * The dashboard keeps its view in client state; this module is the one place
 * that state is written to the address bar and read from it again, so a view
 * can be refreshed, linked, pasted by an agent and walked with back/forward.
 *
 *   /                                   Everything
 *   /collections                        the Collections landing
 *   /w/<worldKey|rootId>                a world or plain root collection
 *   /w/<world>/<shelfId>                one shelf, style branch or storybook of it
 *   /w/<world>/instructions             the world's docs (HUMAN / AGENT view)
 *   /w/<world>/journal | tasks | moodboards | folders
 *   /storybooks[/<id>]  /moodboards[/<id>]  /stories[/<id>]  /skills[/<id>]
 *   /bookmarks  /motion  /cinematography
 *   ?asset=<id>                         the detail panel, over any of the above
 *
 * Client-safe: no server imports. The agent routes use galleryPageUrl for the
 * `url` field they return.
 */

export const GALLERY_ORIGIN = "https://gallery.laniameda.space";

/** The query parameter that opens one piece in the detail panel. */
export const ASSET_PARAM = "asset";

export const WORLD_TABS = ["instructions", "journal", "tasks", "moodboards", "folders"] as const;
export type WorldTab = (typeof WORLD_TABS)[number];

export type GalleryRoute =
  | { kind: "home" }
  | { kind: "collections" }
  | { kind: "world"; world: string; shelf?: string; tab?: WorldTab }
  | { kind: "storybooks"; id?: string }
  | { kind: "moodboards"; id?: string }
  | { kind: "stories"; id?: string }
  | { kind: "skills"; id?: string }
  | { kind: "bookmarks" }
  | { kind: "motion" }
  | { kind: "cinematography" };

export type GalleryLocation = { route: GalleryRoute; asset?: string };

const SECTIONS = ["storybooks", "moodboards", "stories", "skills"] as const;
type Section = (typeof SECTIONS)[number];
const FLAT = ["bookmarks", "motion", "cinematography"] as const;
type Flat = (typeof FLAT)[number];

const isSection = (value: string): value is Section => (SECTIONS as readonly string[]).includes(value);
const isFlat = (value: string): value is Flat => (FLAT as readonly string[]).includes(value);
const isWorldTab = (value: string): value is WorldTab => (WORLD_TABS as readonly string[]).includes(value);

/** Agents write asset:<id>, moodboard:<id>, collection:<id>; the URL takes both. */
export const bareId = (value: string) => value.trim().replace(/^[a-z]+:/i, "");

const segment = (value: string) => encodeURIComponent(bareId(value));

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * The route for a path, or null when the path is not a gallery view (another
 * page such as /inbox or /youtube, or the public selected-work surface).
 */
export function parseGalleryRoute(pathname: string, search = ""): GalleryLocation | null {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const assetParam = params.get(ASSET_PARAM);
  const asset = assetParam ? bareId(assetParam) || undefined : undefined;
  const route = routeFromSegments(parts);
  return route ? { route, asset } : null;
}

function routeFromSegments(parts: string[]): GalleryRoute | null {
  if (parts.length === 0) return { kind: "home" };
  const [head, second, third] = parts;
  if (head === "collections" && parts.length === 1) return { kind: "collections" };
  if (head === "w" && second && parts.length <= 3) {
    const world = bareId(second);
    if (!world) return null;
    if (!third) return { kind: "world", world };
    const rest = third === "docs" ? "instructions" : third;
    if (isWorldTab(rest)) return { kind: "world", world, tab: rest };
    const shelf = bareId(third);
    return shelf ? { kind: "world", world, shelf } : null;
  }
  if (isSection(head) && parts.length <= 2) {
    const id = second ? bareId(second) : undefined;
    return id ? { kind: head, id } : { kind: head };
  }
  if (isFlat(head) && parts.length === 1) return { kind: head };
  return null;
}

/** The path (and `?asset=` query) for a route. */
export function galleryRoutePath(route: GalleryRoute, asset?: string | null): string {
  const path = pathFor(route);
  return asset ? `${path}?${ASSET_PARAM}=${segment(asset)}` : path;
}

function pathFor(route: GalleryRoute): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "collections":
      return "/collections";
    case "world": {
      const base = `/w/${segment(route.world)}`;
      if (route.shelf) return `${base}/${segment(route.shelf)}`;
      if (route.tab) return `${base}/${route.tab}`;
      return base;
    }
    case "storybooks":
    case "moodboards":
    case "stories":
    case "skills":
      return route.id ? `/${route.kind}/${segment(route.id)}` : `/${route.kind}`;
    case "bookmarks":
    case "motion":
    case "cinematography":
      return `/${route.kind}`;
  }
}

/** Absolute link to a view, for agents. */
export const galleryPageUrl = (route: GalleryRoute, asset?: string | null) =>
  `${GALLERY_ORIGIN}${galleryRoutePath(route, asset)}`;

/** True for every path the dashboard renders. */
export const isGalleryPath = (pathname: string) => parseGalleryRoute(pathname) !== null;

export type WorldLike = { _id: string; worldKey?: string; slug?: string; parentFolderId?: string };

/**
 * The segment a root collection is addressed by: its world key when it is a
 * marked world, otherwise its id. Children are always addressed by id.
 */
export const worldSegment = (root: { _id: string; worldKey?: string }) => root.worldKey?.trim() || String(root._id);

/**
 * Finds the root a /w/<segment> names: by world key, by public slug or by id.
 * Children match by id only; the result tells which.
 */
export function resolveWorldSegment<T extends WorldLike>(
  folders: readonly T[],
  value: string,
): T | undefined {
  const key = bareId(value);
  if (!key) return undefined;
  const lower = key.toLowerCase();
  return (
    folders.find((folder) => !folder.parentFolderId && folder.worldKey?.toLowerCase() === lower) ??
    folders.find((folder) => !folder.parentFolderId && folder.slug?.toLowerCase() === lower) ??
    folders.find((folder) => String(folder._id) === key)
  );
}

/** The route of one collection: a root, or a child inside its root. */
export function collectionRoute<T extends WorldLike>(folders: readonly T[], folder: T): GalleryRoute {
  if (!folder.parentFolderId) return { kind: "world", world: worldSegment(folder) };
  const parent = folders.find((entry) => String(entry._id) === String(folder.parentFolderId));
  return {
    kind: "world",
    world: parent ? worldSegment(parent) : String(folder.parentFolderId),
    shelf: String(folder._id),
  };
}

/** Absolute link to a collection, for list_collections and open_world. */
export const collectionPageUrl = <T extends WorldLike>(folders: readonly T[], folder: T) =>
  galleryPageUrl(collectionRoute(folders, folder));

const TITLE_SUFFIX = "Laniameda";

/** The browser tab title for a view, given the names the client knows. */
export function galleryRouteTitle(route: GalleryRoute, names: { world?: string; shelf?: string; item?: string } = {}): string {
  const join = (...parts: Array<string | undefined>) => [...parts.filter(Boolean), TITLE_SUFFIX].join(" · ");
  switch (route.kind) {
    case "home":
      return "Main Gallery · Laniameda";
    case "collections":
      return join("Collections");
    case "world": {
      const tab = route.tab ? route.tab[0].toUpperCase() + route.tab.slice(1) : undefined;
      return join(names.shelf ?? tab, names.world ?? route.world);
    }
    case "storybooks":
      return join(names.item, "Storybooks");
    case "moodboards":
      return join(names.item, "Moodboards");
    case "stories":
      return join(names.item, "Stories");
    case "skills":
      return join(names.item, "Skills");
    case "bookmarks":
      return join("Bookmarks");
    case "motion":
      return join("Motion");
    case "cinematography":
      return join("Cinematography");
  }
}
