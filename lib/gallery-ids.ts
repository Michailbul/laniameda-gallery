// Typed gallery ids: `asset:<id>`, `skill:<id>`, `moodboard:<id>` … Each kind
// of object has one read tool and one argument name; this is the table that
// get_gallery_item's errors and references/data-model.md are written from.
// get_gallery_item itself reads assets, Skills and legacy asset packs; every
// other prefix is routed to its own tool by name.

export type GalleryItemKind = "asset" | "pack" | "design" | "skill";

export type TypedIdRoute = {
  /** The canonical prefix. */
  prefix: string;
  /** Other spellings that are accepted. */
  aliases: string[];
  /** The tool that reads this object … */
  tool: string;
  /** … and the argument the id goes in. */
  argument: string;
  /** Whether that tool also accepts the bare id. */
  bareAccepted: boolean;
  note?: string;
};

export const TYPED_ID_ROUTES: readonly TypedIdRoute[] = [
  { prefix: "asset", aliases: ["assets"], tool: "get_gallery_item", argument: "id", bareAccepted: false, note: "a piece of media; preview_assets, find_similar and the filing tools take asset:<id> or the bare id" },
  { prefix: "skill", aliases: ["skills", "workflow", "workflows"], tool: "get_skill", argument: "id", bareAccepted: true, note: "a reusable Skill; get_gallery_item reads it too; old workflow:<id> and migrated pack ids resolve through owner aliases" },
  { prefix: "pack", aliases: ["packs", "assetPack", "assetPacks"], tool: "get_gallery_item", argument: "id", bareAccepted: false, note: "a legacy asset pack (a duplicates stack is one); a pack that was migrated into a Skill resolves to that Skill" },
  { prefix: "design", aliases: ["designs", "designInspiration", "designInspirations"], tool: "get_gallery_item", argument: "id", bareAccepted: false, note: "read-only legacy: an old browser-extension design capture; new saves are assets" },
  { prefix: "moodboard", aliases: ["moodboards"], tool: "get_moodboard", argument: "moodboardId", bareAccepted: true, note: "id is accepted as an alias" },
  { prefix: "story", aliases: ["stories"], tool: "get_story", argument: "id", bareAccepted: true },
  { prefix: "character", aliases: ["characters"], tool: "get_character", argument: "character", bareAccepted: false, note: "the code (DA-CH-001) is the usual handle; id is accepted as an alias" },
  { prefix: "stack", aliases: ["stacks", "inboxStack", "inboxStacks"], tool: "list_inbox_decisions", argument: "stackId", bareAccepted: true, note: "id is accepted as an alias" },
  { prefix: "card", aliases: ["cards", "inboxCard", "inboxCards"], tool: "list_inbox_decisions", argument: "stackId", bareAccepted: false, note: "a card is read through its stack" },
  { prefix: "task", aliases: ["tasks"], tool: "get_task", argument: "taskId", bareAccepted: true },
  { prefix: "video", aliases: ["videos", "videoRef", "videoRefs"], tool: "get_video_ref", argument: "id", bareAccepted: true },
  { prefix: "bookmark", aliases: ["bookmarks"], tool: "list_bookmarks", argument: "search", bareAccepted: false, note: "bookmarks are listed, not fetched by id; the post's gallery pieces carry the tag bookmark" },
  { prefix: "world", aliases: ["worlds"], tool: "open_world", argument: "world", bareAccepted: true, note: "a world's root collection id, key or name" },
  { prefix: "collection", aliases: ["collections", "folder", "folders"], tool: "list_collections", argument: "parentFolderId / folderId", bareAccepted: true, note: "collections are addressed by their bare folderId everywhere; open_world lists a world's shelves" },
  { prefix: "profile", aliases: ["profiles", "mjProfile"], tool: "mj_profiles", argument: "profile", bareAccepted: true },
];

const routeByPrefix = new Map<string, TypedIdRoute>();
for (const route of TYPED_ID_ROUTES) {
  routeByPrefix.set(route.prefix, route);
  for (const alias of route.aliases) routeByPrefix.set(alias, route);
}

/** The read tool for a prefix (canonical or alias), or undefined. */
export const typedIdRoute = (prefix: string) => routeByPrefix.get(prefix);

const ITEM_KINDS: Record<string, GalleryItemKind> = {
  asset: "asset", assets: "asset",
  pack: "pack", packs: "pack", assetPack: "pack", assetPacks: "pack",
  design: "design", designs: "design", designInspiration: "design", designInspirations: "design",
  // Older copied workflow IDs remain readable through the native Skill resolver.
  skill: "skill", skills: "skill", workflow: "skill", workflows: "skill",
};

/** The get_gallery_item kind a prefix maps to, or null for other objects. */
export const normalizeGalleryIdKind = (kind: string): GalleryItemKind | null => ITEM_KINDS[kind] ?? null;

export const GALLERY_ITEM_PREFIXES = "asset:<id>, skill:<id> or pack:<id>";

/** The message for an id get_gallery_item cannot read: it names the tool that can. */
export const galleryIdHelp = (value: string): string => {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex > 0) {
    const prefix = value.slice(0, separatorIndex);
    const id = value.slice(separatorIndex + 1).trim();
    const route = typedIdRoute(prefix);
    if (route && !normalizeGalleryIdKind(prefix)) {
      return `${route.prefix}:${id || "<id>"} is read with ${route.tool} { ${route.argument}: "${route.bareAccepted ? id || "<id>" : `${route.prefix}:${id || "<id>"}`}" }, not get_gallery_item (${GALLERY_ITEM_PREFIXES}). The typed-ID table is in references/data-model.md.`;
    }
    if (!route) {
      return `Unknown id prefix "${prefix}:". get_gallery_item reads ${GALLERY_ITEM_PREFIXES}; moodboard:, story:, character:, stack:, task: and video: have their own read tools (typed-ID table in references/data-model.md).`;
    }
  }
  return `Typed gallery ID is required: ${GALLERY_ITEM_PREFIXES}. A bare id from the gallery is an asset in most cases (asset:${value}); ids from open_world are bare too: shelves are collection ids, moodboards go to get_moodboard, stories to get_story, characters to get_character by code. Table: references/data-model.md.`;
};

export type ParsedGalleryId = { kind: GalleryItemKind; id: string };

/**
 * Parse a typed gallery id for get_gallery_item and its kin. With
 * `expectedKind` a bare id is accepted as that kind; without it the id must
 * carry a prefix, and the error names the right tool for other prefixes.
 */
export const parseGalleryId = (rawValue: unknown, expectedKind?: GalleryItemKind): ParsedGalleryId => {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) throw new Error("id is required.");
  const separatorIndex = value.indexOf(":");
  if (separatorIndex > 0) {
    const kind = normalizeGalleryIdKind(value.slice(0, separatorIndex));
    const id = value.slice(separatorIndex + 1).trim();
    if (kind && id) {
      if (expectedKind && kind !== expectedKind) {
        const route = TYPED_ID_ROUTES.find((entry) => entry.prefix === kind);
        throw new Error(`Expected ${expectedKind}:<id>, got ${kind}:${id}${route && route.tool !== "get_gallery_item" ? ` (read with ${route.tool})` : ""}.`);
      }
      return { kind, id };
    }
    if (typedIdRoute(value.slice(0, separatorIndex))) throw new Error(galleryIdHelp(value));
  }
  if (expectedKind) return { kind: expectedKind, id: value };
  throw new Error(galleryIdHelp(value));
};
