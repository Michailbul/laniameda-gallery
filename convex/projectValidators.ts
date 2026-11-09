import { v } from "convex/values";

// Projects (convex/projects.ts). A project is a world that carries project
// details (folders.project on the world root): the client film, who is on it
// and Michael's role. It gathers the world and its styles, the director
// review project(s) pointing at the world, the inspiration for it and the
// production briefs sent by the director or producers.
//
// Art-director scope first (Michael, 9 Nov 2026): everything added to a
// project is for Michael only until he promotes or publishes it. Briefs and
// recipes are read only by owner queries; shelves carry `scope:
// "art_director"` and never feed the public world page, the public showcase
// or the director review by themselves.

export const ART_DIRECTOR_SCOPE = "art_director" as const;
export const folderScopeValidator = v.literal(ART_DIRECTOR_SCOPE);

export const projectPersonValidator = v.object({
  name: v.string(),
  // "Director", "Producer", "Art director".
  role: v.optional(v.string()),
  // "Sula Entertainment", "Fantasy Studios".
  org: v.optional(v.string()),
});

export const projectDetailsValidator = v.object({
  // "Animated feature for Sula Entertainment".
  line: v.optional(v.string()),
  client: v.optional(v.string()),
  // Michael's role on it ("Art director").
  role: v.optional(v.string()),
  people: v.optional(v.array(projectPersonValidator)),
  // The review projects that belong to it (slugs); review projects whose
  // world is this world belong to it anyway.
  reviewSlugs: v.optional(v.array(v.string())),
  status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("done"))),
  updatedAt: v.optional(v.number()),
});

export const briefKindValidator = v.union(
  v.literal("brief"), // a design brief: what a place or person should be
  v.literal("storyboard"),
  v.literal("script"),
  v.literal("style_guide"),
  v.literal("references"), // photo sets, location scouting
  v.literal("other"),
);

// A file of a brief (the PDF, the script): private bytes in Convex storage,
// served only to the owner through /api/briefs/<briefId>/files/<key>.
export const briefFileValidator = v.object({
  key: v.string(), // "f1", "f2" … stable inside the brief
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  sha256: v.string(), // hex
  storageId: v.id("_storage"),
  pages: v.optional(v.number()),
  // First-page picture (PNG/JPEG), private like the file.
  coverStorageId: v.optional(v.id("_storage")),
  addedAt: v.number(),
});

export const briefGroupValidator = v.object({
  label: v.string(),
  assetIds: v.array(v.id("assets")),
});

export const productionBriefFields = {
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  // Stable key: "cassandra:brief:school-design". Saving again updates.
  ingestKey: v.string(),
  title: v.string(),
  kind: briefKindValidator,
  // Who sent it, in plain words: "Lukáš Skalník · Fantasy Studios".
  from: v.optional(v.string()),
  receivedAt: v.optional(v.number()),
  // Why it was sent, what it asks for.
  note: v.optional(v.string()),
  // Places, people and subjects it is about ("school", "classroom").
  topics: v.array(v.string()),
  // Director-review folders it informs (slugs), e.g. "school".
  reviewFolders: v.array(v.string()),
  // The pictures in or with it, as gallery assets, in order.
  assetIds: v.array(v.id("assets")),
  groups: v.optional(v.array(briefGroupValidator)),
  files: v.array(briefFileValidator),
  searchText: v.string(),
  revision: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const BRIEF_LIMITS = {
  title: 160,
  from: 160,
  note: 4000,
  topics: 24,
  topic: 60,
  assets: 400,
  groups: 24,
  files: 12,
  fileBytes: 200 * 1024 * 1024,
} as const;
