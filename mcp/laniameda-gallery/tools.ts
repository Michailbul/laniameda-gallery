import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { storyInputSchema, storyPatchSchema, presetFiltersSchema } from "../../lib/story-contract";
import { createSkillInputSchema } from "../../lib/skill-contract";
import { galleryAssetPageInputSchema } from "../../lib/gallery-pagination";
import {
  characterCostumeSchema, characterCreateSchema, characterLinkSchema, characterListSchema, characterRefSchema,
  characterRemoveCostumeSchema, characterUnlinkSchema, characterUpdateSchema,
} from "../../lib/character-contract";
import {
  moodboardAddSchema, moodboardGenerationsSchema, moodboardListSchema, moodboardMidjourneySchema, moodboardRefSchema,
  moodboardRemoveSchema, moodboardReorderSchema, moodboardSaveSchema,
} from "../../lib/moodboard-contract";
import { commentAddSchema, commentListSchema } from "../../lib/asset-comment-contract";
import { inboxCloseSchema, inboxListSchema, inboxPostSchema, inboxStackRefSchema, similarGroupsSchema } from "../../lib/inbox-contract";
import {
  worldFileSchema, worldJournalSchema, worldMarkSchema, worldOpenSchema, worldProfileSchema, worldShelfSchema, worldUndoSchema,
} from "../../lib/world-contract";

// The gallery's MCP tool surface, shared by the local stdio server (server.ts)
// and the hosted endpoint (app/api/mcp/route.ts). Every tool is a thin call into
// /api/agent/*; the bearer token behind `apiFetch` decides whose gallery it is.

export type JsonRecord = Record<string, unknown>;

export type FilePayload = { base64: string; fileName: string; contentType: string };

export type GalleryToolOptions = {
  /** POST a JSON body to an /api/agent/* path as the authenticated user. */
  apiFetch: (path: string, body: JsonRecord) => Promise<JsonRecord>;
  /** Shown by check_connection. */
  apiUrl: string;
  /**
   * Reads a local file for `filePath` uploads. Only the stdio server can see
   * the caller's disk; the hosted server leaves this out and drops `filePath`
   * from the schemas, so remote clients send `url` or `fileBase64` instead.
   */
  readLocalFile?: (filePath: string) => { base64: string; fileName: string };
};

export const GALLERY_MCP_INSTRUCTIONS = [
  "laniameda.gallery is Michael's vault of the work he makes and the work he likes.",
  "Worlds are separate story universes (DEAR ANNETE, ANDROMEDA — ANYA …). For any world work call open_world first: it returns the world's WORLD.md rules, learnings, styles and locks, shelves, storybooks, moodboards, Midjourney profiles and recent changes. Search and preview with world to stay inside it. Change things through world_doc, world_file, world_shelf, mj_profiles and the moodboard and story tools with a session label; every change is in world_journal and world_undo reverts it. An asset never belongs to two worlds.",
  "Fetch the current canonical skill from https://gallery.laniameda.space/llms.txt (entry: /skills/laniameda-gallery/SKILL.md; manifest.json lists its version and resources). Private world and maintenance references require the same owner-allowed gallery:read bearer token as MCP.",
  "Textual story ideas, scripts and versioned world style locks are private story records: save_story needs text and a stable ingestKey, never placeholder media. list_stories and get_story retrieve them; update_story preserves revisions. Gallery filter presets have list_filter_presets and save_filter_preset.",
  "When Michael sends inspiration (a link, a reel, screenshots, photos) with or without a project name, follow references/intake.md: save a clean source as inspiration, take a video or scene apart into frames, beats and a source-analysis story, and when he names a world, carry it through treatment and pre-production into a storybook (references/storybooks.md).",
  "Named people are characters: one record per person per world with a stable code (DA-CH-001), costumes as -C01/-C02, a canonical sheet and face, and typed asset links. list_characters and get_character read the cast; create_character, update_character, save_character_costume and link_character_assets maintain it. Cite the code in captions and storybook CAST blocks. Read references/characters.md.",
  "Moodboards are ordered sets of gallery images that each define one look and mirror a Midjourney moodboard (a personalization code); each belongs to a collection. list_moodboards and get_moodboard read them (get_moodboard returns full image URLs, in order, to push into Midjourney); save_moodboard, add_moodboard_items and reorder_moodboard_items maintain them; record the Midjourney code after a sync with set_moodboard_midjourney. Read references/moodboards.md.",
  "Each world has an Inbox (Decisions in the gallery, /inbox/<worldId>): stacks of cards where Michael decides and agents never judge taste. post_inbox_cards posts sort, duplicates, artifact, ab, choose or rule cards with facts as evidence; list_inbox_decisions reads his answers, comments and voice notes (transcribe them yourself) and his notes on single images; close_stack once you have applied and learned from a stack. Read references/inbox.md.",
  "Collections (folders) are one level deep; resolve names with list_collections before filing. A child collection can carry a display group (Styles, Places, Cast) and sortOrder.",
  "What a piece IS is a tag: character, location, scene or inspiration. The animation tag marks animated work; no tag means live action.",
  "Every saved asset should carry sourceUrl when it came from the web, and an agentDescription: one or two plain sentences (max ~45 words) on what it shows and why it was kept.",
  "Reuse existing tags (list_tags) before inventing new ones. Never star or publish anything unless asked. Ask before deleting.",
  "To see pieces rather than read URLs, use preview_assets; then get_gallery_item for the full record and prompt.",
  "Michael comments on assets in the detail panel to steer the work. get_gallery_item returns an asset's comments; list_asset_comments reads one thread or the newest across the vault. Act on them, then reply with add_asset_comment saying what was done.",
  "YouTube videos kept as research (competitors, formats, animation styles) are video references, not assets: list_video_refs to read them, save_video_refs to add them.",
  "A post on X is saved as a bookmark with save_bookmarks: send the link, the gallery reads the author, text, media and counts itself, and links any piece already saved from that post. list_bookmarks reads saved posts as text; the tag `bookmark` narrows list_assets and search_gallery to them.",
  "Liked Midjourney srefs live in the Midjourney Srefs collection. list_srefs reads exact recipes with version settings and examples; save_sref saves a private text recipe. Save all actual source attachments with their full ALT prompts, then link the bookmark. Read references/midjourney-srefs.md.",
  "To add local files (e.g. from ~/Downloads): prepare_uploads with up to 50 file names, run the curl commands it returns, then save_assets with up to 50 uploadIds. Public URLs go straight into save_assets. Inspect ok/partial and persisted IDs; do not automatically retry an unknown write outcome.",
].join(" ");

export const guessMime = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return mimeByExt[ext ?? ""] ?? "application/octet-stream";
};

const jsonText = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(value, null, 2),
    },
  ],
});

const commonIngestShape = {
  promptText: z.string().optional(),
  allowPromptOnly: z.boolean().optional(),
  tagNames: z.array(z.string()).optional(),
  folderId: z
    .string()
    .describe(
      "Collection id to file this under — the raw folderId returned by list_collections or create_collection (NOT a folders:<id> prefixed form).",
    )
    .optional(),
  folderIds: z
    .array(z.string())
    .describe(
      "Collection ids for a multi-collection asset save. Resolve them with list_collections first; the first id becomes primary.",
    )
    .optional(),
  ingestKey: z.string().optional(),
  promptIngestKey: z.string().optional(),
  url: z.string().describe("Public image/video URL to fetch and save.").optional(),
  uploadId: z
    .string()
    .describe(
      "From prepare_uploads, after the file was PUT to its uploadUrl. The way to save local files.",
    )
    .optional(),
  posterUploadId: z
    .string()
    .describe("Video only: uploadId of a JPEG/PNG poster frame for the card thumbnail.")
    .optional(),
  fileBase64: z
    .string()
    .describe("Fallback when there is no shell: the file inline as base64 (keep under ~3 MB).")
    .optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  description: z.string().optional(),
  agentDescription: z
    .string()
    .describe(
      "One or two plain sentences (max ~45 words) on what the piece shows and why it was kept, plus 'by @handle' for someone else's work. Written for retrieval: future agents search and read this first.",
    )
    .optional(),
  sourceUrl: z
    .string()
    .describe("Permalink of the post or page the piece came from.")
    .optional(),
  ingestSource: z.string().optional(),
  modelName: z.string().optional(),
  modelProvider: z.string().optional(),
  generationType: z.string().optional(),
  promptType: z.string().optional(),
  workflowType: z.string().optional(),
  assetRole: z.string().optional(),
  domain: z.string().optional(),
  promptSections: z.record(z.string(), z.unknown()).optional(),
  promptProfile: z.record(z.string(), z.unknown()).optional(),
  typedTags: z.array(z.record(z.string(), z.unknown())).optional(),
  upstreamInputs: z.array(z.record(z.string(), z.unknown())).optional(),
};

// A world scopes a listing or search to its root collection and every shelf.
const worldFilterShape = z
  .string()
  .describe("World key (dear-annete), name or root id: searches the world root and all its shelves. Use instead of folderId.")
  .optional();
// Journaled writes group by session so Michael can read and undo a piece of work as a unit.
const sessionShape = z
  .string()
  .max(80)
  .describe("Label for this piece of work (e.g. da-tram-stop-2026-10-23); the world journal groups and undoes by it.")
  .optional();

const namedFilterShape = {
  tagNames: z
    .array(z.string())
    .describe("Every tag must be present (canonical match: case, '-', '_' fold).")
    .optional(),
  anyTagNames: z.array(z.string()).describe("At least one of these tags.").optional(),
  excludeTagNames: z.array(z.string()).describe("None of these tags.").optional(),
  pieceType: z
    .enum(["character", "location", "scene", "inspiration"])
    .describe("What the piece IS (one of the four section tags).")
    .optional(),
  medium: z
    .enum(["animation", "live-action"])
    .describe("animation = tagged animation; live-action = everything else.")
    .optional(),
  onlyLiked: z.boolean().optional(),
  onlyStarred: z.boolean().describe("Starred = featured on the public reel.").optional(),
};

export function registerGalleryTools(server: McpServer, options: GalleryToolOptions) {
  const { apiFetch, apiUrl, readLocalFile } = options;

  const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("list_srefs", {
    title: "List Midjourney srefs", annotations: readAnnotations,
    description: "Read every reusable Midjourney sref recipe in an owned collection, grouped by exact codes, weights and versions. Includes saved example images, full prompts, notes and source links. Resolve the Midjourney Srefs collection with list_collections first.",
    inputSchema: { folderId: z.string(), search: z.string().optional() },
  }, async input => jsonText(await apiFetch("/api/agent/srefs", { action: "list", ...input })));
  server.registerTool("save_sref", {
    title: "Save Midjourney sref",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Save a private reusable Midjourney sref recipe in a collection. Accepts numeric codes, weighted mixtures or image URLs with optional --sw, --sv and --v. Exact retries retain the first note. Save actual examples separately with save_assets and their full source prompts; this text recipe needs no placeholder image. Never publishes or stars anything.",
    inputSchema: { folderId: z.string(), parameters: z.string().min(1).max(2000), title: z.string().max(200).optional(), note: z.string().max(2000).optional(), sourceUrl: z.url().optional() },
  }, async input => jsonText(await apiFetch("/api/agent/srefs", { action: "save", ...input })));
  server.registerTool("get_gallery_contract", {
    description: "Discover the deployed scoped agent contract, paging guarantees, resources and client script. Read this before a complete inventory or code-driven workflow.",
    inputSchema: {}, annotations: readAnnotations,
  }, async () => jsonText({
    contractVersion: "2026-10-23.1", serverVersion: "1.0.0", apiUrl, clientResource: "scripts/gallery-client.mjs",
    transport: "Local JavaScript composes authenticated MCP tools; HTTP accepts the same scoped bearer token. Backend functions define resource access; raw SQL and arbitrary server code execution are unavailable.",
    scopes: { read: "gallery:read", writes: "gallery:write", deletion: "gallery:delete", deletionApproval: "Delete scope grants technical access only. Obtain explicit user approval for the named collection/preset or listed batch before deletion. Existing approval for those targets in the current session persists.", identity: "Owner comes from the authenticated token; caller-supplied owners are rejected for cursor listings." },
    pagination: { tool: "list_assets_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc", includeSkillExamples: { default: false, true: "adds Skill-step assets, which otherwise stay inside their Skill unless requested by assetRole" }, hiddenCollections: "included", folderScope: "folderId alone selects direct members; includeDescendants:true adds its immediate owned children. No folderId covers all owned assets.", consistency: "Live records; no snapshot isolation. Restart after changing filters; client deduplicates IDs." },
    inventoryExport: { endpoint: "POST /api/agent/inventory", client: "bun gallery.mjs all_assets --out <dir>", contents: "the default list_assets_page inventory (no filters) plus folders, as a snapshot rebuilt at most daily, with assets saved since appended", freshness: "maxAgeMinutes (default 1440); refresh:true rebuilds when the snapshot is older than 15 minutes; edits and deletions after generatedAt are not reflected", prefer: "Use it for complete inventories instead of paging every asset; page list_assets_page for filtered or exact live reads." },
    videoReferencePagination: { tool: "list_video_refs_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc", sorting: "Sort the completed inventory locally; convenience list_video_refs defaults to views." },
    limits: { saveAssets: 50, prepareUploads: 50, saveBookmarks: 12, saveVideoRefs: 12, listAssets: "bounded convenience results; use list_assets_page for complete traversal", listSkills: 200, listStories: 500, listCharacters: 1000, linkCharacterAssets: 100, moodboardItems: 1000, addMoodboardItems: 100, listMoodboardGenerations: 60, postInboxCards: 100, inboxStackCards: 300, inboxTargets: "2–9", listBookmarks: 500, listVideoRefs: 2000, sdkCalls: "default 1000 configurable calls; exceeding any traversal budget throws incomplete" },
    resources: ["worlds", "worldDocs", "worldJournal", "mjProfiles", "assets", "collections", "menuFilters", "skills", "stories", "characters", "moodboards", "inbox", "presets", "bookmarks", "videoRefs"],
    policy: { source: "get_skill_instructions or authenticated canonical /skills/laniameda-gallery/ manifest resources", privateWorldRules: "references/worlds.md", sourceOfTruth: "Deployed schemas and scoped backend functions; instructions explain filing policy. Collections and menu filters are distinct from raw tags." },
  }));

  server.registerTool("list_assets_page", {
    description: "Cursor page of owned assets with complete traversal, including hidden collections. Skill-step assets are left out unless includeSkillExamples is true or assetRole selects them. Keep the same filters and follow cursor until isDone, even through empty filtered pages. Search includes captions, agent descriptions, prompts, tags and bookmark text. Results are stable within owner spellings, newest-first; records are live, not a frozen snapshot. For a complete unfiltered inventory from a shell, the cached export (gallery.mjs all_assets) reads the gallery once a day instead of on every traversal.",
    annotations: readAnnotations,
    inputSchema: { ...galleryAssetPageInputSchema.shape, world: worldFilterShape },
  }, async input => jsonText(await apiFetch("/api/agent/gallery", { action: "listAssetsPage", ...input })));

  server.registerTool("list_menu_filters", { description: "Read curated menu-filter IDs, labels, mappings, resolved tag IDs, counts and missing-folder flags. These IDs are used by filter presets; tag IDs are a different resource.", inputSchema: {}, annotations: readAnnotations }, async () => jsonText(await apiFetch("/api/agent/customize", { action: "listMenuFilters" })));
  server.registerTool("set_collection_option", {
    description: "Set one owned collection's cover, pin, hidden-grid flag, showcase or featured-world hero. Showcase/featured change public collection presentation and require the user's publication instruction; private members remain private. A cover must already be a member.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { folderId: z.string(), option: z.enum(["cover", "pinned", "hidden", "showcased", "featured"]), enabled: z.boolean().optional(), assetId: z.string().nullable().optional() },
  }, async input => jsonText(await apiFetch("/api/agent/customize", { action: "setCollectionOption", ...input })));
  server.registerTool("create_skill", { description: "Create or reuse a private reusable Gallery Skill using a stable ingestKey, editable markdown/instructions and optional ordered prompt/media steps. Separate from text Stories and from gallery agent instructions. Readback is returned; no publication flag is accepted.", inputSchema: createSkillInputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async input => jsonText(await apiFetch("/api/agent/skills", { action: "create", ...input })));
  server.registerTool("delete_skill", { description: "Delete an owned reusable Gallery Skill recipe and its collection links after the user authorizes deletion. Preserves source prompts/media; formerly hidden step media becomes visible in the gallery. Requires gallery:delete.", inputSchema: { id: z.string().min(1).describe("skill:<native-id>; old skill/workflow and retired pack identifiers resolve through owner aliases.") }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async input => jsonText(await apiFetch("/api/agent/skills", { action: "delete", ...input })));
  server.registerTool("set_video_poster", { description: "Replace only an owned video's card poster using posterUploadId from prepare_uploads. Main video bytes and metadata are retained. Upload a JPEG/PNG poster first.", inputSchema: { assetId: z.string(), posterUploadId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => jsonText(await apiFetch("/api/agent/poster", input)));

  server.registerTool("get_skill_instructions", {
    title: "Read Gallery Instructions",
    description: "Read the canonical gallery agent skill or one of its references using this connection's existing authentication. This is distinct from reusable gallery Skills. Start with SKILL.md; before touching a world, fetch references/worlds.md. Private world/maintenance resources are restricted to Michael's owner identity. No token copying or local file access is needed.",
    inputSchema: { resource: z.string().min(1).max(160).describe("Allowlisted skill-relative path: SKILL.md (default), manifest.json, references/worlds.md, references/video-refs.md, or another reference listed by the manifest.").optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => jsonText(await apiFetch("/api/agent/instructions", input)));

  // Worlds: open one, read and edit its files, file pieces, shape shelves and
  // storybooks, keep Midjourney profiles, and read or undo the journal.
  // Compact JSON: a big world's context must fit in one tool result.
  const worlds = (action: string) => async (input: JsonRecord) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await apiFetch("/api/agent/worlds", { action, ...input })) }],
  });
  const worldWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool("open_world", {
    title: "Open World",
    annotations: readAnnotations,
    description: "Start here for any world work. No arguments: the list of worlds (key, name, counts). With a world: everything an agent needs in one call: WORLD.md (the world's rules), LEARNINGS.md, its other docs, styles with their style locks, shelves and storybooks (with their stories), moodboards with codes and Midjourney sync state, Midjourney profiles with their role here, characters and the recent journal. Worlds are separate: nothing is filed, linked or boarded across them.",
    inputSchema: worldOpenSchema.shape,
  }, worlds("open"));
  server.registerTool("world_doc", {
    title: "World Doc",
    annotations: worldWrite,
    description: "Read and edit a world's files. op list | read | write | delete | history. Paths: WORLD.md (the world's CLAUDE.md; at most 8,000 characters), LEARNINGS.md (one dated line per learning with its source; at most 40 entries), docs/<kebab-name>.md (at most 8, 12,000 characters each). write replaces the whole text: read first and pass expectedRevision. Over a cap the write is refused: promote confirmed learnings into WORLD.md rules and delete superseded ones. Every write is journaled and can be undone.",
    inputSchema: { world: z.string(), op: z.enum(["list", "read", "write", "delete", "history"]), path: z.string().optional(), body: z.string().optional(), expectedRevision: z.number().int().min(0).optional(), note: z.string().optional(), limit: z.number().int().optional(), session: sessionShape },
  }, worlds("doc"));
  server.registerTool("world_file", {
    title: "File Into World",
    annotations: worldWrite,
    description: "Move, add or remove up to 100 assets between a world's shelves and add or remove tags, in one journaled change. addTo/removeFrom take shelf names or ids of this world (\"root\" is the world collection). An asset that lives in another world is refused unless move: true, which takes it out of the other world. Shared shelves outside worlds (ART, LOVE …) are kept. Undo with world_undo.",
    inputSchema: worldFileSchema.shape,
  }, worlds("file"));
  server.registerTool("world_shelf", {
    title: "World Shelf",
    annotations: worldWrite,
    description: "Create, rename, describe or regroup a shelf or storybook inside a world (groups: Styles, Places, Cast, World building, Moods, Footage, Storybooks). A storybook is a child of its world. Give shelf with a root collection's id to bring that collection into the world. Journaled; an empty shelf created by mistake is removed by world_undo.",
    inputSchema: worldShelfSchema.shape,
  }, worlds("shelf"));
  server.registerTool("mj_profiles", {
    title: "Midjourney Profiles",
    annotations: worldWrite,
    description: "Midjourney personalization profiles: Michael's taste, applied with --profile <code> after the moodboards. op list (with world: only its profiles and their role there) or save (world required: create with name + code + role, or change code, role, notes, status of an existing profile). A new code keeps the old one in codeHistory. Journaled in that world.",
    inputSchema: worldProfileSchema.shape,
  }, worlds("profiles"));
  server.registerTool("world_journal", {
    title: "World Journal",
    annotations: readAnnotations,
    description: "What changed in the worlds: every doc edit, filing, shelf, moodboard, profile and story change, newest first, with actor and session. Filter by world or session; page back with before. changeId returns one change in full with its before and after state.",
    inputSchema: worldJournalSchema.shape,
  }, worlds("journal"));
  server.registerTool("world_undo", {
    title: "Undo World Change",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Revert one journal change (changeId) or a whole session, newest first. Run with dryRun: true first: it lists what would be undone and what is blocked because something changed since. A session stops at the first blocked change. The undo is journaled too, so it can be undone.",
    inputSchema: worldUndoSchema.shape,
  }, worlds("undo"));
  server.registerTool("mark_world", {
    title: "Mark World",
    annotations: worldWrite,
    description: "Mark a root collection as a world (a separate story universe) or clear the mark. Only when Michael creates a new world. Journaled.",
    inputSchema: worldMarkSchema.shape,
  }, worlds("mark"));

  const characterWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const characters = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/characters", { action, ...input }));
  server.registerTool("list_characters", { title: "List Characters", annotations: readAnnotations, description: "Read the named cast: each person's code (DA-CH-001), name and alias, world, role, lane, status, costumes, canonical sheet/face asset IDs with thumbnails and link count. Filter by world (root collection), status or search text (codes, names, former names, costumes).", inputSchema: characterListSchema.shape }, characters("list"));
  server.registerTool("get_character", { title: "Get Character", annotations: readAnnotations, description: "Read one character by code (DA-CH-001) or character:<id>: full record, revision, costumes and every linked asset with its role (concept, sheet, face, costume, appears-in, reference), costume code and URLs.", inputSchema: characterRefSchema.shape }, characters("get"));
  server.registerTool("create_character", { title: "Create Character", annotations: characterWrite, description: "Register a named person in a world (a root collection) and mint the next code for that world, e.g. DA-CH-007. Name plus alias is unique per world: repeating it returns the existing record with created:false instead of a second code. Codes are never reused. Status defaults to concept; set approved or sheeted only when Michael approved it. Optional sheet/face asset IDs become linked.", inputSchema: characterCreateSchema.shape }, characters("create"));
  server.registerTool("update_character", { title: "Update Character", annotations: characterWrite, description: "Change a character's name, alias, other names, role, lane, status, canonical sheet/face, name tag or notes. Supply expectedRevision from get_character. Omitted fields are kept; null clears. The code and world never change.", inputSchema: characterUpdateSchema.shape }, characters("update"));
  server.registerTool("save_character_costume", { title: "Save Character Costume", annotations: characterWrite, description: "Add a costume (next code C01, C02… never reused) or edit one by code. A costume holds its own sheet and face asset IDs, which become linked. Re-sending an existing costume name returns that costume.", inputSchema: characterCostumeSchema.shape }, characters("costume"));
  server.registerTool("remove_character_costume", { title: "Remove Character Costume", annotations: { ...characterWrite, destructiveHint: true }, description: "Remove one costume from a character after the user asks. Its assets stay linked to the person without a costume code; the code is not reissued.", inputSchema: characterRemoveCostumeSchema.shape }, characters("removeCostume"));
  server.registerTool("link_character_assets", { title: "Link Character Assets", annotations: characterWrite, description: "Link up to 100 owned assets to a character with a role (concept, sheet, face, costume, appears-in, reference) and optional costume code. One link per asset per character; relinking changes its role. An asset may link to several characters (a two-person scene). Does not change the asset's tags, captions or collections.", inputSchema: characterLinkSchema.shape }, characters("link"));
  server.registerTool("unlink_character_assets", { title: "Unlink Character Assets", annotations: { ...characterWrite, destructiveHint: true }, description: "Remove up to 100 asset links from a character, e.g. a face filed under the wrong person. Clears a sheet/face pointer that named the asset. The assets themselves are kept.", inputSchema: characterUnlinkSchema.shape }, characters("unlink"));
  server.registerTool("delete_character", { title: "Delete Character", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, description: "Delete a character record and its asset links only after the user names it for deletion. Media is kept and the code is never reissued. Requires gallery:delete. Prefer status retired to keep history.", inputSchema: characterRefSchema.shape }, characters("delete"));

  const moodboardWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const moodboards = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/moodboards", { action, ...input }));
  server.registerTool("list_moodboards", { title: "List Moodboards", annotations: readAnnotations, description: "List moodboards: ordered sets of gallery images that each define one look and mirror a Midjourney moodboard (personalization code). Pass a collection folderId, with includeChildren for a world root, or nothing for every board. Each row has id (moodboard:<id>), name, owning collection, status (draft, in-midjourney, archived), mjCode with its --profile flag, item count, revision and up to 6 preview images. Archived boards are left out unless status or includeArchived asks for them.", inputSchema: { ...moodboardListSchema.shape, world: worldFilterShape } }, moodboards("list"));
  server.registerTool("get_moodboard", { title: "Get Moodboard", annotations: readAnnotations, description: "Read one moodboard in full: every item in position order with its asset:<id>, full-size image url, width, height, kind, prompt excerpt, tags and agent description; imageUrls lists the image URLs alone, in order, ready to push into a Midjourney moodboard. Also returns the recorded code, Midjourney id and URL, code history, revision and sync state (images added or removed since the last recorded sync).", inputSchema: moodboardRefSchema.shape }, moodboards("get"));
  server.registerTool("save_moodboard", { title: "Save Moodboard", annotations: moodboardWrite, description: "Create a moodboard in a plain collection (folderId + name), or patch one by moodboardId. Create is idempotent on the name inside its collection: repeating it returns the existing board with created:false and only fills fields that are still empty. A patch keeps omitted fields; null clears description, styleTag, notes, mjCode, mjMoodboardId or mjUrl; folderId moves the board; expectedRevision from get_moodboard guards concurrent edits. Changing mjCode here keeps the old code in history but records no sync: after an actual Midjourney sync use set_moodboard_midjourney.", inputSchema: { ...moodboardSaveSchema.shape, session: sessionShape } }, moodboards("save"));
  server.registerTool("add_moodboard_items", { title: "Add Moodboard Items", annotations: moodboardWrite, description: "Append up to 100 owned assets to a moodboard in the given order. Assets already on it are skipped and reported. The first image becomes the cover when none is set. A board holds at most 1000 items. The assets' tags, captions and collections do not change.", inputSchema: { ...moodboardAddSchema.shape, session: sessionShape } }, moodboards("add"));
  server.registerTool("remove_moodboard_items", { title: "Remove Moodboard Items", annotations: { ...moodboardWrite, destructiveHint: true }, description: "Take up to 100 assets off a moodboard. The assets themselves are kept; a removed cover falls back to the first remaining item.", inputSchema: { ...moodboardRemoveSchema.shape, session: sessionShape } }, moodboards("remove"));
  server.registerTool("reorder_moodboard_items", { title: "Reorder Moodboard Items", annotations: moodboardWrite, description: "Set a moodboard's full display order: send every current item's asset ID exactly once, in the new order (get_moodboard lists them). A set that differs from the board's items is refused.", inputSchema: { ...moodboardReorderSchema.shape, session: sessionShape } }, moodboards("reorder"));
  server.registerTool("set_moodboard_midjourney", { title: "Record Midjourney Sync", annotations: moodboardWrite, description: "Record a sync after creating or updating the Midjourney moodboard: the personalization code Midjourney shows (mjCode, e.g. 88ji6bg), the Midjourney moodboard id (prompts can use --profile m<id>), its URL and how many board images it now holds (syncedItemCount, default the board's item count). A changed code goes onto the board's code history. Sets status in-midjourney and the sync time. Read references/moodboards.md for the Midjourney steps.", inputSchema: { ...moodboardMidjourneySchema.shape, session: sessionShape } }, moodboards("set_midjourney"));
  server.registerTool("list_moodboard_generations", { title: "List Moodboard Generations", annotations: readAnnotations, description: "Made with this board: the owner's gallery assets whose linked prompt carries the board's code, an earlier code or its --profile m<id>, newest first (limit up to 60). Each result names the matched code and whether it is already on the board. Empty until the board has a code or Midjourney id.", inputSchema: moodboardGenerationsSchema.shape }, moodboards("generations"));
  server.registerTool("delete_moodboard", { title: "Delete Moodboard", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, description: "Delete a moodboard and its item list only after the user names it for deletion. The assets are kept and the Midjourney moodboard is not touched. Requires gallery:delete. Prefer status archived to keep a board out of the way.", inputSchema: { ...moodboardRefSchema.shape, session: sessionShape } }, moodboards("delete"));

  const comments = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/comments", { action, ...input }));
  server.registerTool("list_asset_comments", { title: "List Asset Comments", annotations: readAnnotations, description: "Read comments on gallery assets. Michael leaves them in an asset's detail panel or as notes in the Inbox to steer the work (fix this, more like this, file it there); agents reply. A voice note has audioUrl, audioDurationMs and audioContentType (body may be empty): download and transcribe it yourself. With assetId: that asset's whole thread, oldest first. Without: the newest comments across the vault, newest first, filtered by since (ms) and author (owner or agent). Each row has asset:<id>, author, body and times. get_gallery_item also returns an asset's thread.", inputSchema: commentListSchema.shape }, comments("list"));
  server.registerTool("add_asset_comment", { title: "Reply On Asset", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Add an agent reply to an asset's comment thread, e.g. what was done about Michael's comment and where the result is (asset:<id> of a new version). Plain text, one reply per call; it shows in the detail panel marked Agent.", inputSchema: commentAddSchema.shape }, comments("add"));
  const inbox = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/inbox", { action, ...input }));
  server.registerTool("post_inbox_cards", { title: "Post Inbox Cards", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Post up to 100 decision cards into a world's Inbox (a world is a root collection), as a new stack (stackTitle) or appended to one (stackId, or the same ingestKey). Card types: sort (1 image, 2–9 targets: moodboard, collection, option or out; keys 1–9), duplicates (2–8 near-identical images with evidence.matches: same job, same prompt, hash distance, similarity; he keeps, deletes, stacks under a cover or keeps all), artifact (1 image with evidence.defect.box in 0–1 coordinates, note and priceUsd; fix, keep or out), ab (2 images, optional labels; winner or neither), choose (2–12 options; pick one), rule (ruleText with evidence and 0–12 images; yes, no, not yet). Evidence states facts only: never rank, recommend or say which is better. Card keys make re-posting safe. Returns the stack id (stack:<id>), card ids and url.", inputSchema: inboxPostSchema.shape }, inbox("post"));
  server.registerTool("list_inbox_stacks", { title: "List Inbox Stacks", annotations: readAnnotations, description: "List Inbox stacks, newest first: open by default or status closed, for one world (worldFolderId) or all. Each row has id (stack:<id>), world, title, note, posting agent, card types, cards, decided and open counts, and url.", inputSchema: inboxListSchema.shape }, inbox("list"));
  server.registerTool("list_inbox_decisions", { title: "List Inbox Decisions", annotations: readAnnotations, description: "Read one stack with Michael's answers: every card with its images (asset:<id>, url, caption, missing when deleted), evidence, targets, the decision (choice, target, picked or cover image, images to delete, what it changed in the gallery), images deleted for good, the card comment (text, audioUrl with audioDurationMs; download and transcribe it yourself) and his notes on each image (text or voice). Also progress and allDecided. Apply what is his to apply, learn from the pattern, then close_stack.", inputSchema: inboxStackRefSchema.shape }, inbox("decisions"));
  server.registerTool("close_stack", { title: "Close Inbox Stack", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Close an Inbox stack once you have read and acted on its decisions: it leaves the world's Inbox and its answers can no longer change. What the decisions changed stays. reopen: true opens it again.", inputSchema: inboxCloseSchema.shape }, inbox("close"));
  server.registerTool("delete_inbox_stack", { title: "Delete Inbox Stack", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, description: "Delete an Inbox stack with its cards, decisions and card voice comments, only after the user names it for deletion. What the decisions changed in the gallery stays, and so do notes on images. Requires gallery:delete. Prefer close_stack.", inputSchema: inboxStackRefSchema.shape }, inbox("delete"));
  server.registerTool("find_similar_groups", { title: "Find Similar Groups", annotations: readAnnotations, description: "Find groups of near-identical images in a world or collection (with includeChildren, its style branches and shelves), largest first, from each image's perceptual hash: the takes of one job, a prompt rerun, a repaired copy beside its original, one picture saved twice. maxDistance sets how close (bits of 64: 4 ≈ the takes of one job, default 6; 10 ≈ the same shot reworked; 20 ≈ the same subject). Each group lists its images (asset:<id>, thumbUrl, prompt id), its widest distance, size, samePrompt, and assetIds (the first 8) ready for a duplicates card in post_inbox_cards. One call scans at most 1,300 pieces, newest first; when truncated is true, scan the shelves one by one. Images saved in the last minute may not be hashed yet. State the match as evidence; never say which to keep.", inputSchema: similarGroupsSchema.shape }, inbox("similar_groups"));

  server.registerTool("save_story", { description: "Save a private textual idea, script or world style lock. No image required. Stable ingestKey deduplicates retries. Resolve world/format and source asset IDs first. Returns the persisted record.", inputSchema: { ...storyInputSchema.shape, ingestKey: z.string().min(1), expectedRevision: z.number().int().nonnegative().optional(), session: sessionShape } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "save", ...input })));
  server.registerTool("list_stories", { description: "Find private text ideas, scripts and style locks by keyword, world/format collection, kind or status. Up to 500 records; full text included.", inputSchema: { search: z.string().optional(), world: worldFilterShape, folderId: z.string().optional(), kind: z.enum(["idea", "script", "style-lock"]).optional(), status: z.enum(["idea", "draft", "ready", "archived"]).optional(), limit: z.number().int().min(1).max(500).optional() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "list", ...input })));
  server.registerTool("get_story", { description: "Read a full private text record, its world, style and asset links. Accepts story:<id> or bare ID.", inputSchema: { id: z.string() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "get", ...input })));
  server.registerTool("update_story", { description: "Revise a private story or style lock, preserving the previous text in history. Supply expectedRevision from get_story to prevent overwriting concurrent edits.", inputSchema: { ...storyPatchSchema.shape, id: z.string(), expectedRevision: z.number().int().positive(), session: sessionShape } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "update", ...input })));
  server.registerTool("get_story_revisions", { description: "Read the preserved older versions of a textual story or world style lock.", inputSchema: { id: z.string() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "revisions", ...input })));
  server.registerTool("delete_story", { description: "Permanently delete a private textual record and its history, only when the user authorizes deletion.", inputSchema: { id: z.string() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "delete", ...input })));
  server.registerTool("list_filter_presets", { description: "List the owner's reusable gallery filters including No skills, Inspirations, animation and game-view presets.", inputSchema: {} }, async () => jsonText(await apiFetch("/api/agent/presets", { action: "list" })));
  server.registerTool("save_filter_preset", { description: "Save/update a reusable filter preset by name. Use menu filter IDs from the gallery, not raw tag IDs. Owner-scoped; no publication changes.", inputSchema: { name: z.string(), filters: presetFiltersSchema } }, async (input) => jsonText(await apiFetch("/api/agent/presets", { action: "save", ...input })));
  server.registerTool("delete_filter_preset", {
    description: "Delete a saved owner filter preset only after explicit user approval for that named preset or listed batch. Approval already given for those targets in this session persists. Requires gallery:delete; this scope alone does not approve deletion. Removes only the saved view, preserving assets, collections and tags.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (input) => jsonText(await apiFetch("/api/agent/presets", { action: "delete", ...input })));

  // `filePath` only exists where the server can read the caller's disk.
  // Typed as always present so both modes share one handler signature; the
  // hosted schema really omits it, and readFilePayload refuses it there.
  const localFileShape = (
    readLocalFile
      ? { filePath: z.string().describe("Absolute path to a local image or video.").optional() }
      : {}
  ) as { filePath: z.ZodOptional<z.ZodString> };

  const readFilePayload = (input: {
    filePath?: string;
    fileBase64?: string;
    fileName?: string;
    contentType?: string;
  }): FilePayload | undefined => {
    if (input.filePath) {
      if (!readLocalFile) {
        throw new Error("filePath is not available on the hosted server; pass url or fileBase64.");
      }
      const local = readLocalFile(input.filePath);
      const fileName = input.fileName ?? local.fileName;
      return {
        base64: local.base64,
        fileName,
        contentType: input.contentType ?? guessMime(fileName),
      };
    }

    if (input.fileBase64) {
      const fileName = input.fileName ?? "upload.bin";
      return {
        base64: input.fileBase64,
        fileName,
        contentType: input.contentType ?? guessMime(fileName),
      };
    }

    return undefined;
  };

  const buildIngestBody = (input: JsonRecord) => {
    const { filePath, fileBase64, fileName, contentType, ...rest } = input;
    const file = readFilePayload({
      filePath: typeof filePath === "string" ? filePath : undefined,
      fileBase64: typeof fileBase64 === "string" ? fileBase64 : undefined,
      fileName: typeof fileName === "string" ? fileName : undefined,
      contentType: typeof contentType === "string" ? contentType : undefined,
    });

    if (file) return { ...rest, file };
    // An uploadId save still wants the original name and type.
    return {
      ...rest,
      ...(typeof fileName === "string" ? { fileName } : {}),
      ...(typeof contentType === "string" ? { contentType } : {}),
    };
  };

  // Saves of a local file go straight to storage (prepare → PUT → uploadId),
  // the same path agents use from a shell, so size never hits a request cap.
  // Updates may send inline files or an already prepared uploadId.
  const uploadLocalFile = async (filePath: string, contentType: string) => {
    const local = readLocalFile!(filePath);
    const prepared = await apiFetch("/api/agent/uploads", { count: 1 });
    const [slot] = Array.isArray(prepared.uploads) ? (prepared.uploads as JsonRecord[]) : [];
    if (!slot || typeof slot.uploadUrl !== "string" || typeof slot.uploadId !== "string") {
      throw new Error("The gallery did not return an upload slot.");
    }
    const response = await fetch(slot.uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: Buffer.from(local.base64, "base64"),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Upload of ${local.fileName} failed with HTTP ${response.status}.`);
    }
    return { uploadId: slot.uploadId, fileName: local.fileName };
  };

  const buildCreateBody = async (input: JsonRecord) => {
    const { filePath, ...rest } = input;
    if (typeof filePath !== "string" || !filePath || !readLocalFile) {
      return buildIngestBody(input);
    }
    const fileName = typeof rest.fileName === "string" ? rest.fileName : undefined;
    const contentType =
      typeof rest.contentType === "string" ? rest.contentType : guessMime(fileName ?? filePath);
    const uploaded = await uploadLocalFile(filePath, contentType);
    return buildIngestBody({
      ...rest,
      uploadId: uploaded.uploadId,
      fileName: fileName ?? uploaded.fileName,
      contentType,
    });
  };

  server.registerTool(
    "check_connection",
    {
      title: "Check Connection",
      annotations: readAnnotations,
      description: "Verify the MCP server can authenticate with the gallery app API.",
      inputSchema: {},
    },
    async () => {
      const result = await apiFetch("/api/agent/customize", {
        action: "listFolders",
      });
      const collections = Array.isArray(result.folders) ? result.folders : [];
      return jsonText({
        ok: true,
        apiUrl,
        authenticated: true,
        collectionCount: collections.length,
      });
    },
  );

  server.registerTool(
    "save_asset",
    {
      title: "Save Asset",
      description:
        "Save one image or video to the gallery. Media comes from `uploadId` (local files: prepare_uploads first), `url` (anything public)" +
        (readLocalFile ? ", `filePath` (a local path)" : "") +
        " or `fileBase64` (small files, no shell). For several pieces use save_assets.",
      inputSchema: { ...commonIngestShape, ...localFileShape },
    },
    async (input) => jsonText(await apiFetch("/api/agent/ingest", await buildCreateBody(input))),
  );

  server.registerTool(
    "prepare_uploads",
    {
      title: "Prepare Uploads",
      description: [
        "Get signed upload URLs for local files (images or videos), so the bytes go straight from your shell to storage and never through the chat.",
        "1) Call with the file paths (or a count, max 50). 2) Run the returned curl command for each file; URLs expire after 15 minutes, so script the loop. 3) Save them all with save_assets (or save_asset), passing each file's uploadId plus its tags, collection and description.",
        "For a video, also upload a poster frame (e.g. ffmpeg -ss 1 -i in.mp4 -frames:v 1 poster.jpg) and pass it as posterUploadId; convert .mov to .mp4 first if you can.",
      ].join(" "),
      inputSchema: {
        fileNames: z
          .array(z.string()).min(1).max(50)
          .describe("The local paths you will upload; each gets a ready curl command.")
          .optional(),
        count: z.number().int().min(1).max(50).describe("How many slots, when you don't pass fileNames (1-50).").optional(),
      },
    },
    async (input) => {
      const count = input.fileNames?.length || input.count || 1;
      const response = await apiFetch("/api/agent/uploads", { count });
      const uploads = Array.isArray(response.uploads) ? (response.uploads as JsonRecord[]) : [];
      const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
      return jsonText({
        uploads: uploads.map((upload, index) => {
          const path = input.fileNames?.[index];
          if (!path) return upload;
          const contentType = guessMime(path);
          return {
            ...upload,
            file: path,
            contentType,
            curl: `curl -sS --fail -T ${shellQuote(path)} -H ${shellQuote(`Content-Type: ${contentType}`)} ${shellQuote(String(upload.uploadUrl))}`,
          };
        }),
        next: "PUT every file to its uploadUrl (run the curl commands), then call save_assets with one item per file carrying its uploadId.",
      });
    },
  );

  server.registerTool(
    "save_assets",
    {
      title: "Save Assets (batch)",
      description:
        "Save up to 50 images/videos in one call. Each item takes the same fields as save_asset (uploadId / url" +
        (readLocalFile ? " / filePath" : "") +
        ", tagNames, folderIds, agentDescription, sourceUrl, ...). Every item reports its own result; one failure does not stop the rest.",
      inputSchema: {
        items: z
          .array(z.object({ ...commonIngestShape, ...localFileShape }))
          .min(1).max(50)
          .describe("One entry per piece, max 50."),
      },
    },
    async (input) => {
      const prepared = await Promise.allSettled(input.items.map(item => buildCreateBody(item as JsonRecord)));
      const ready = prepared.flatMap((entry, index) => entry.status === "fulfilled" ? [{ index, body: entry.value }] : []);
      const response = ready.length ? await apiFetch("/api/agent/ingest/batch", { items: ready.map(entry => entry.body) }) : {};
      const savedResults = Array.isArray(response.results) ? response.results as JsonRecord[] : [];
      const results = prepared.map((entry, index) => entry.status === "rejected"
        ? { index, ok: false, failedStep: "prepare", error: entry.reason instanceof Error ? entry.reason.message : "Preparation failed." }
        : { ...(savedResults[ready.findIndex(item => item.index === index)] ?? { ok: false, error: "No save result returned." }), index });
      const saved = results.filter(entry => entry.ok === true).length;
      return jsonText({ ...response, ok: saved === input.items.length, saved, failed: input.items.length - saved, results });
    },
  );

  server.registerTool(
    "save_prompt",
    {
      title: "Save Prompt",
      description: "Save a prompt-only record for the authenticated user.",
      inputSchema: {
        promptText: z.string(),
        tagNames: z.array(z.string()).optional(),
        folderId: z.string().optional(),
        ingestKey: z.string().optional(),
        modelName: z.string().optional(),
        modelProvider: z.string().optional(),
        promptType: z.string().optional(),
        workflowType: z.string().optional(),
        promptSections: z.record(z.string(), z.unknown()).optional(),
        promptProfile: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/ingest", {
          ...input,
          allowPromptOnly: true,
        }),
      ),
  );

  server.registerTool(
    "update_gallery_item",
    {
      title: "Update Gallery Item",
      description: "Update prompt or asset metadata for the authenticated user.",
      inputSchema: {
        target: z.enum(["prompt", "asset"]),
        id: z.string().optional(),
        ingestKey: z.string().optional(),
        assetIngestKey: z.string().optional(),
        promptText: z.string().optional(),
        tagNames: z.array(z.string()).optional(),
        folderId: z.union([z.string(), z.null()]).optional(),
        folderIds: z.array(z.string()).optional().describe("REPLACES the asset's full collection set."),
        addFolderIds: z.array(z.string()).optional().describe("Adds the asset to these collections (a world shelf or a storybook) and keeps every membership it already has."),
        modelName: z.union([z.string(), z.null()]).optional(),
        description: z.union([z.string(), z.null()]).optional(),
        agentDescription: z
          .union([z.string(), z.null()])
          .describe("Replace the asset's agent description; null clears it.")
          .optional(),
        sourceUrl: z.union([z.string(), z.null()]).optional(),
        ...localFileShape,
        fileBase64: z.string().optional(),
        fileName: z.string().optional(),
        contentType: z.string().optional(),
        url: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (input) => {
      const { fields, ...rest } = input;
      return jsonText(
        await apiFetch("/api/agent/ingest/update", buildIngestBody({ ...rest, ...(fields ?? {}) })),
      );
    },
  );

  server.registerTool(
    "delete_gallery_item",
    {
      title: "Delete Gallery Item",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: "Delete a prompt or asset for the authenticated user.",
      inputSchema: {
        target: z.enum(["prompt", "asset"]),
        id: z.string().optional(),
        ingestKey: z.string().optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/ingest/delete", input)),
  );

  server.registerTool(
    "list_assets",
    {
      title: "List Assets",
      annotations: readAnnotations,
      description: "List the authenticated user's gallery assets.",
      inputSchema: {
        kind: z.enum(["image", "video"]).optional(),
        folderId: z.string().optional(),
        includeDescendants: z
          .boolean()
          .describe("With folderId: include the collection's folders too.")
          .optional(),
        modelName: z.string().optional(),
        assetRole: z.string().optional(),
        ...namedFilterShape,
        search: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/gallery", {
          action: "listAssets",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "search_gallery",
    {
      title: "Search Gallery",
      annotations: { ...readAnnotations, openWorldHint: true },
      description:
        "Semantic search over the user's gallery. Hybrid by default: matches what pieces look like (pixels) AND what they are about (agent description, caption, prompt, tags). Narrow with tag / piece-type / medium / liked / starred / collection filters. Results carry agentDescription, score, visualScore and textScore.",
      inputSchema: {
        query: z.string(),
        mode: z
          .enum(["hybrid", "visual", "text"])
          .describe("hybrid (default), visual = looks alike, text = described alike.")
          .optional(),
        kind: z.enum(["image", "video"]).optional(),
        folderId: z.string().optional(),
        world: worldFilterShape,
        modelName: z.string().optional(),
        assetRole: z.string().optional(),
        ...namedFilterShape,
        minRelativeScore: z
          .number()
          .describe("0–1 cutoff vs. the best match. Default 0.85 unfiltered, off when filtered.")
          .optional(),
        limit: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/gallery", {
          action: "searchAssets",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "find_similar",
    {
      title: "Find Similar",
      annotations: { ...readAnnotations, openWorldHint: true },
      description:
        "More like this: pieces that look like (visual, default) or are about the same thing as (text / hybrid) a given asset. Takes the same filters as search_gallery.",
      inputSchema: {
        id: z.string().describe("asset:<id> or a raw asset id."),
        mode: z.enum(["hybrid", "visual", "text"]).optional(),
        kind: z.enum(["image", "video"]).optional(),
        folderId: z.string().optional(),
        world: worldFilterShape,
        ...namedFilterShape,
        limit: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/gallery", {
          action: "findSimilar",
          ...input,
        }),
      ),
  );

  const PREVIEW_DEFAULT_LIMIT = 24;
  const PREVIEW_MAX_LIMIT = 48;

  type SheetCell = {
    number: number;
    assetId: string;
    kind: string;
    width?: number;
    height?: number;
    agentDescription?: string;
    tagNames?: string[];
    previewOk: boolean;
    previewError?: string;
  };

  type ContactSheet = {
    contentType: string;
    imageBase64: string;
    columns: number;
    rows: number;
    cells: SheetCell[];
    missingIds: string[];
  };

  const assetIdOf = (record: unknown) =>
    record && typeof record === "object" && typeof (record as JsonRecord)._id === "string"
      ? ((record as JsonRecord)._id as string)
      : undefined;

  const formatSheetLegend = (sheet: ContactSheet, scores: Map<string, number>) => {
    const lines = [
      `Contact sheet: ${sheet.cells.length} pieces in a ${sheet.columns}×${sheet.rows} grid, numbered left to right, top to bottom. A ▶ badge marks a video (its poster frame is shown).`,
      ...sheet.cells.map((cell) => {
        const parts = [`#${cell.number} asset:${cell.assetId}`, cell.kind];
        if (cell.width && cell.height) parts.push(`${cell.width}×${cell.height}`);
        const score = scores.get(cell.assetId);
        if (score !== undefined) parts.push(`score ${score.toFixed(2)}`);
        if (cell.tagNames && cell.tagNames.length > 0) parts.push(`tags: ${cell.tagNames.join(", ")}`);
        if (cell.agentDescription) parts.push(`"${cell.agentDescription}"`);
        if (!cell.previewOk) parts.push(`NO PREVIEW (${cell.previewError ?? "unknown"})`);
        return parts.join(" · ");
      }),
    ];
    if (sheet.missingIds.length > 0) {
      lines.push(`Not found or not yours: ${sheet.missingIds.join(", ")}`);
    }
    lines.push(
      "Next: get_gallery_item with an asset:<id> for its prompt and full record; preview_assets with 1–4 ids to look closer; find_similar to widen around a pick.",
    );
    return lines.join("\n");
  };

  server.registerTool(
    "preview_assets",
    {
      title: "Preview Assets",
      annotations: readAnnotations,
      description:
        "SEE gallery pieces instead of reading URLs. Returns ONE numbered contact-sheet image (up to 48 thumbs) plus a legend mapping each number to its asset:<id>, tags and description. Give `ids` to look at specific assets (1–4 ids render large for close inspection), or `query` to semantic-search and preview the hits, or only filters to preview a listing. Use it to browse, compare and pick references before pulling full records.",
      inputSchema: {
        ids: z
          .array(z.string())
          .describe("asset:<id> or raw asset ids, in the order to show them. Max 48.")
          .optional(),
        query: z
          .string()
          .describe("Semantic search query; its hits are previewed in rank order.")
          .optional(),
        mode: z.enum(["hybrid", "visual", "text"]).optional(),
        kind: z.enum(["image", "video"]).optional(),
        folderId: z.string().optional(),
        world: worldFilterShape,
        includeDescendants: z.boolean().optional(),
        modelName: z.string().optional(),
        assetRole: z.string().optional(),
        ...namedFilterShape,
        search: z.string().describe("Plain substring filter for a listing (no query).").optional(),
        limit: z
          .number()
          .describe(`How many pieces to preview (default ${PREVIEW_DEFAULT_LIMIT}, max ${PREVIEW_MAX_LIMIT}).`)
          .optional(),
        columns: z.number().describe("Grid columns; auto (about 4:3) by default.").optional(),
        maxEdge: z
          .number()
          .describe("Long edge of the sheet in px (default 1568, max 2400).")
          .optional(),
      },
    },
    async (input) => {
      const { ids, query, columns, maxEdge, limit, mode, search, includeDescendants, ...filters } =
        input;
      const cap = Math.max(1, Math.min(limit ?? PREVIEW_DEFAULT_LIMIT, PREVIEW_MAX_LIMIT));
      const scores = new Map<string, number>();

      let assetIds: string[];
      if (ids && ids.length > 0) {
        assetIds = ids.slice(0, PREVIEW_MAX_LIMIT);
      } else if (query?.trim()) {
        const found = await apiFetch("/api/agent/gallery", {
          action: "searchAssets",
          query,
          mode,
          ...filters,
          limit: cap,
        });
        const results = Array.isArray(found.results) ? found.results : [];
        assetIds = [];
        for (const result of results) {
          const id = assetIdOf(result);
          if (!id) continue;
          assetIds.push(id);
          const score = (result as JsonRecord).score;
          if (typeof score === "number") scores.set(id, score);
        }
      } else {
        const found = await apiFetch("/api/agent/gallery", {
          action: "listAssets",
          ...filters,
          search,
          includeDescendants,
          limit: cap,
        });
        const assets = Array.isArray(found.assets) ? found.assets : [];
        assetIds = assets.map(assetIdOf).filter((id): id is string => Boolean(id));
      }

      if (assetIds.length === 0) {
        return { content: [{ type: "text" as const, text: "Nothing matched; no sheet to show." }] };
      }

      const response = await apiFetch("/api/agent/gallery", {
        action: "contactSheet",
        ids: assetIds,
        columns,
        maxEdge,
      });
      const sheet = response.sheet as ContactSheet;
      return {
        content: [
          { type: "image" as const, data: sheet.imageBase64, mimeType: sheet.contentType },
          { type: "text" as const, text: formatSheetLegend(sheet, scores) },
        ],
      };
    },
  );

  server.registerTool(
    "check_sources",
    {
      title: "Check Sources",
      annotations: readAnnotations,
      description:
        "Which of these source URLs (post permalinks, page URLs) are already saved in the gallery. Use before an extraction run to skip what's already in.",
      inputSchema: {
        sourceUrls: z.array(z.string()),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/gallery", {
          action: "findBySourceUrls",
          sourceUrls: input.sourceUrls,
        }),
      ),
  );

  server.registerTool(
    "add_tag_aliases",
    {
      title: "Add Tag Aliases",
      description:
        "Point alternate spellings at one canonical tag (e.g. filmic -> cinematic) so future saves reuse it. Aliases that are already real tags are ignored and reported.",
      inputSchema: {
        name: z.string(),
        aliases: z.array(z.string()),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "addTagAliases",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "get_gallery_item",
    {
      title: "Get Gallery Item",
      annotations: readAnnotations,
      description: "Read a gallery asset, asset pack or skill by typed ID, such as asset:<id>, pack:<id> or skill:<id>.",
      inputSchema: {
        id: z.string(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/gallery", {
          action: "getById",
          id: input.id,
        }),
      ),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List Tags",
      annotations: readAnnotations,
      description: "List the authenticated user's customized and used tags.",
      inputSchema: {
        includeArchived: z.boolean().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "listTags",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "upsert_tag",
    {
      title: "Create Or Update Tag",
      description: "Create or update a user-customized tag for the authenticated user's page.",
      inputSchema: {
        name: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        source: z.enum(["user", "agent", "system"]).optional(),
        color: z.string().optional(),
        sortOrder: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "upsertTag",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "upsert_tags",
    {
      title: "Create Or Update Tags",
      description: "Create or update multiple user-customized tags with shared default metadata.",
      inputSchema: {
        tagNames: z.array(z.string()).optional(),
        tags: z
          .array(
            z.object({
              name: z.string(),
              label: z.string().optional(),
              description: z.string().optional(),
              category: z.string().optional(),
              source: z.enum(["user", "agent", "system"]).optional(),
              color: z.string().optional(),
              sortOrder: z.number().optional(),
            }),
          )
          .optional(),
        category: z.string().optional(),
        source: z.enum(["user", "agent", "system"]).optional(),
        color: z.string().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "upsertTags",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "archive_tag",
    {
      title: "Archive Tag",
      description: "Archive a user-customized tag for the authenticated user's page.",
      inputSchema: {
        tagId: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "archiveTag",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "list_collections",
    {
      title: "List Collections",
      annotations: readAnnotations,
      description:
        "List the authenticated user's collections. Collections are owner-scoped folders used to organize saved assets and prompts. A child collection may carry a display group (e.g. Styles) and sortOrder that order it inside its world.",
      inputSchema: {},
    },
    async () =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "listFolders",
        }),
      ),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create Collection",
      description:
        "Create or reuse a collection (folder) for the authenticated user. Returns its folderId for use when saving assets.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        parentFolderId: z.string().describe("Owned root collection for a plain child folder; storybooks remain roots.").optional(),
        kind: z.literal("storybook").optional(),
        group: z.string().max(40).nullable().describe("Display group of a child inside its world, e.g. Styles, Places, Cast, Design, Moods, Footage. Ignored on roots. Applied to an existing collection of the same name too; null clears.").optional(),
        sortOrder: z.number().nullable().describe("Order inside the group (and of the group by its smallest member); lower first. null clears.").optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "createFolder",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "update_collection",
    {
      title: "Update Collection",
      description: "Rename or update a collection (folder) for the authenticated user. Omitted fields, including name, keep their current value, so a group change needs only folderId and group.",
      inputSchema: {
        folderId: z.string().describe("The collection id to update — the raw folderId from list_collections/create_collection."),
        name: z.string().describe("New name. Omit to keep the current one.").optional(),
        description: z.string().optional(),
        parentFolderId: z.string().nullable().describe("Owned root parent; null moves a child to root. Omission preserves parentage.").optional(),
        group: z.string().max(40).nullable().describe("Display group of a child inside its world, e.g. Styles. Ignored on roots; null clears.").optional(),
        sortOrder: z.number().nullable().describe("Order inside the group; lower first. null clears.").optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "updateFolder",
          ...input,
        }),
      ),
  );

  server.registerTool(
    "delete_collection",
    {
      title: "Delete Collection",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description:
        "Delete an owned collection shell only after explicit user approval for that named collection or listed batch. Approval already given for those targets in this session persists. Requires gallery:delete; the scope alone does not approve deletion. Clears its asset/prompt/Skill membership, keeps media and linked story text, and promotes child collections to root. A child collection's moodboards move to its world; a root's moodboards are deleted (their assets stay). Story links may require repair; the collection's route disappears.",
      inputSchema: {
        folderId: z.string().describe("The collection id to delete — the raw folderId from list_collections/create_collection."),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "deleteFolder",
          ...input,
        }),
      ),
  );

  // Skills: multi-step recipes saved as one document (markdown body + ordered
  // prompt steps with their media). Canonical IDs read skill:<id>; legacy IDs resolve through owner-scoped aliases.
  server.registerTool(
    "search_skills",
    {
      title: "Search Skills",
      annotations: { ...readAnnotations, openWorldHint: true },
      description:
        "Find saved skills by meaning (semantic search over title, description, tags, models, step labels and the markdown body). Use when the user asks how they did something, or for a recipe/workflow/technique. Cinematography packs (camera moves) are left out unless tagNames includes \"cinematography\".",
      inputSchema: {
        query: z.string(),
        tagNames: z.array(z.string()).describe("Every tag must be on the skill.").optional(),
        folderId: z.string().describe("Only skills filed in this collection.").optional(),
        limit: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(await apiFetch("/api/agent/gallery", { action: "searchSkills", ...input })),
  );

  server.registerTool(
    "list_skills",
    {
      title: "List Skills",
      annotations: readAnnotations,
      description:
        "List saved skills, newest first, optionally narrowed by tags (all must match), collection or keywords. Cinematography packs (camera moves) are left out unless tagNames includes \"cinematography\".",
      inputSchema: {
        tagNames: z.array(z.string()).optional(),
        folderId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (input) =>
      jsonText(await apiFetch("/api/agent/gallery", { action: "listSkills", ...input })),
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get Skill",
      annotations: readAnnotations,
      description:
        "Read one skill in full: markdown body, how-to-run notes, tags, collections and every step with its prompt and media URLs.",
      inputSchema: {
        id: z.string().describe("skill:<native-id> or the bare native id. Previously copied skill/workflow IDs and retired pack IDs resolve to the native Skill."),
      },
    },
    async (input) =>
      jsonText(await apiFetch("/api/agent/gallery", { action: "getSkill", id: input.id })),
  );

  server.registerTool(
    "update_skill",
    {
      title: "Update Skill",
      description:
        "Edit a skill's title, description, markdown body (embed gallery images as ![caption](asset:<id>)) or how-to-run notes, and set, add or remove tags.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        body: z.string().optional(),
        agentInstructions: z.string().optional(),
        tagNames: z.array(z.string()).describe("Replaces the whole tag set.").optional(),
        addTagNames: z.array(z.string()).optional(),
        removeTagNames: z.array(z.string()).optional(),
      },
    },
    async (input) =>
      jsonText(await apiFetch("/api/agent/customize", { action: "updateSkill", ...input })),
  );

  server.registerTool(
    "file_skill",
    {
      title: "Add Or Remove Skill From Collection",
      description: "File a skill into a collection, or take it out. The skill itself is kept.",
      inputSchema: {
        id: z.string(),
        folderId: z.string(),
        remove: z.boolean().describe("true takes the skill out of the collection.").optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: input.remove ? "removeSkillFromCollection" : "addSkillToCollection",
          id: input.id,
          folderId: input.folderId,
        }),
      ),
  );

  // Video references: YouTube videos saved as research on what performs and
  // how it looks. Their own table and their own tab ("Videos"), apart from
  // assets. Ids read video:<id>.
  const videoRefShape = {
    url: z.string().describe("YouTube link or the 11-character video id."),
    title: z.string(),
    channelName: z.string().optional(),
    channelHandle: z.string().describe("@handle").optional(),
    channelUrl: z.string().optional(),
    subscribers: z.number().optional(),
    medianViews: z.number().describe("Median views of the channel's recent uploads.").optional(),
    views: z.number().optional(),
    publishedAt: z
      .union([z.number(), z.string()])
      .describe("Upload date: epoch milliseconds or an ISO date.")
      .optional(),
    durationSeconds: z.number().optional(),
    isChannelBest: z.boolean().describe("The channel's best performer in the window studied.").optional(),
    channelLastUploadAt: z
      .union([z.number(), z.string()])
      .describe("When the channel last uploaded, as seen when checked: epoch milliseconds or an ISO date.")
      .optional(),
    checkedAt: z
      .union([z.number(), z.string()])
      .describe("When these numbers were last verified on YouTube: epoch milliseconds or an ISO date.")
      .optional(),
    topic: z.string().describe("Subject area, e.g. cars, history, success-stories.").optional(),
    styleFamily: z.string().describe("Plain-words name of the look, e.g. 'map animation'.").optional(),
    productionStyle: z
      .string()
      .describe(
        "Legacy optional classification. Omit in new research; do not infer AI-versus-stock or model origin from frames. Michael judges the material visually.",
      )
      .optional(),
    language: z.string().describe("Spoken language, lowercase ISO 639-1 code: en, es, id.").optional(),
    styleDescription: z
      .string()
      .describe("Legacy source description. Omit material-origin diagnoses in new research; show actual frames for visual review.")
      .optional(),
    format: z.string().describe("How an episode is structured.").optional(),
    whyItWorks: z.string().optional(),
    hook: z.string().optional(),
    titlePattern: z.string().optional(),
    thumbnailPattern: z.string().optional(),
    audience: z.string().optional(),
    bendIdea: z.string().describe("How the format could carry another subject.").optional(),
    agentDescription: z
      .string()
      .describe("One or two plain sentences: what it shows and why it was kept.")
      .optional(),
    collections: z
      .array(z.string())
      .describe("Filter labels in the Videos tab, e.g. youtube-cars-competitors.")
      .optional(),
    tagNames: z.array(z.string()).optional(),
    thumbnailUrl: z.string().describe("Override; YouTube's own thumbnail is copied by default.").optional(),
    frameUrls: z
      .array(z.string())
      .max(6)
      .describe("Up to 6 supplied still-image URLs; otherwise copies YouTube numbered auto stills. Returned sourceKind/sourceUrl identify provenance. positionVerified:false means no timestamp or 25/50/75 percent position is claimed; chronological storyboard preview is separate.")
      .optional(),
  };

  server.registerTool(
    "list_video_refs",
    {
      title: "List Video References",
      annotations: readAnnotations,
      description:
        "List saved YouTube video references with their style notes, stats, thumbnail and still-image URLs/provenance. Numbered auto stills have unverified positions and are not chronological storyboards. Sorted by most views unless sort says otherwise. Filter by productionStyle, language or tags. Use for competitor, format and style research; use list_video_refs_page for a complete inventory.",
      inputSchema: {
        collection: z.string().describe("e.g. youtube-cars-competitors").optional(),
        topic: z.string().optional(),
        styleFamily: z.string().optional(),
        productionStyle: z
          .string()
          .describe("How the picture is made, e.g. '2D animation', 'Stock footage', 'AI pictures'. Exact match, any case.")
          .optional(),
        language: z.string().describe("ISO 639-1 code, e.g. en, es. Exact match, any case.").optional(),
        tagNames: z.array(z.string()).describe("Every tag listed must be on the record.").optional(),
        channelHandle: z.string().optional(),
        search: z.string().describe("Every word must appear in the title, channel, style or notes.").optional(),
        onlyLiked: z.boolean().optional(),
        onlyChannelBest: z.boolean().optional(),
        minViews: z.number().optional(),
        publishedAfter: z.union([z.number(), z.string()]).optional(),
        sort: z.enum(["views", "recent", "saved"]).optional(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "list", ...input })),
  );

  server.registerTool("list_video_refs_page", {
    title: "Page Video References",
    description: "Complete cursor traversal of owned YouTube research, including empty filtered pages. Follow cursor with unchanged filters until isDone. Pages use owner spelling then newest saved first; sort the final collected inventory locally for views or upload dates. This does not extract chronological storyboard frames.",
    annotations: readAnnotations,
    inputSchema: {
      cursor: z.string().nullable().optional(), pageSize: z.number().int().min(1).max(200).optional(),
      collection: z.string().optional(), topic: z.string().optional(), styleFamily: z.string().optional(),
      productionStyle: z.string().optional(), language: z.string().optional(), tagNames: z.array(z.string()).max(100).optional(),
      channelHandle: z.string().optional(), search: z.string().optional(), onlyLiked: z.boolean().optional(), onlyChannelBest: z.boolean().optional(),
      minViews: z.number().nonnegative().optional(), publishedAfter: z.union([z.number(), z.string()]).optional(),
    },
  }, async input => jsonText(await apiFetch("/api/agent/video-refs", { action: "list_page", ...input })));

  server.registerTool(
    "get_video_ref",
    {
      title: "Get Video Reference",
      annotations: readAnnotations,
      description: "Read one video reference in full.",
      inputSchema: { id: z.string().describe("video:<id> or the bare id.") },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "get", id: input.id })),
  );

  server.registerTool(
    "save_video_refs",
    {
      title: "Save Video References",
      description:
        "Save up to 12 YouTube videos as references. The gallery copies each thumbnail and numbered YouTube auto stills; their positions are unverified. The website separately loads up to 24 chronological storyboard frames when available. Supply factual title/stats and requested research notes; do not infer production methods from appearance. Saving the same video updates research and merges collections/tags, while preserving existing owner notes and likes.",
      inputSchema: {
        items: z.array(z.object(videoRefShape)).min(1).max(12),
        refreshMedia: z.boolean().describe("Re-copy the thumbnail and frames.").optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "save", ...input })),
  );

  server.registerTool(
    "update_video_ref",
    {
      title: "Update Video Reference",
      description: "Edit the owner's note/like or replace collections/tags of an owned video reference. Omitted tagNames preserves existing tags; [] clears them. Tags are normalized and deduplicated, and search is updated. Research, source, copied media and statistics stay intact. Saves merge tags; use this update to curate the complete replacement set.",
      inputSchema: {
        id: z.string(),
        userNote: z.string().optional(),
        isLiked: z.boolean().optional(),
        collections: z.array(z.string()).describe("Replaces the whole set.").optional(),
        tagNames: z.array(z.string()).describe("Replaces the complete tag set; omission preserves tags and [] clears them.").optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "update", ...input })),
  );

  server.registerTool(
    "delete_video_ref",
    {
      title: "Delete Video Reference",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: "Remove one video reference. Ask before deleting.",
      inputSchema: { id: z.string() },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "delete", id: input.id })),
  );

  // Saved posts (X bookmarks). The post itself (author, text, quote, counts)
  // lives on a bookmark row; its gallery pieces carry the tag `bookmark`.
  // Ids read bookmark:<id>.
  server.registerTool(
    "save_bookmarks",
    {
      title: "Save X Posts As Bookmarks",
      description:
        "Save up to 12 posts from x.com as bookmarks, from their links. The gallery reads each post itself (author, text, media, quoted post, counts) and makes the text searchable. A post whose image or video is already in the gallery is linked to those pieces; any other post gets a post card. Text-only posts are fine. Saving the same post again refreshes it. Pass text/media only when the post cannot be read publicly.",
      inputSchema: {
        items: z
          .array(
            z.object({
              url: z.string().describe("https://x.com/<handle>/status/<id>"),
              userNote: z.string().describe("The owner's own words about the post.").optional(),
              agentDescription: z
                .string()
                .describe("One or two plain sentences: what the post is about and why it was kept.")
                .optional(),
              folderIds: z.array(z.string()).describe("Collections to file it into.").optional(),
              tagNames: z.array(z.string()).optional(),
              assetIds: z
                .array(z.string())
                .describe("Gallery pieces of this post to link. Default: every asset whose sourceUrl is the post.")
                .optional(),
              text: z.string().describe("Only when the post cannot be read publicly.").optional(),
              authorName: z.string().optional(),
              authorHandle: z.string().optional(),
              postedAt: z.union([z.number(), z.string()]).optional(),
              media: z
                .array(
                  z.object({
                    kind: z.enum(["image", "video", "gif"]),
                    url: z.string().describe("Image URL, or a video's poster frame."),
                    alt: z.string().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .min(1)
          .max(12),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/bookmarks", { action: "save", ...input })),
  );

  server.registerTool(
    "list_bookmarks",
    {
      title: "List Bookmarked Posts",
      annotations: readAnnotations,
      description:
        "Read saved X posts as text, newest first: author, full text, quoted post, counts, the owner's note and the gallery pieces of each post. Use for 'what did I bookmark about …', 'posts by @handle'. For a search by meaning, use search_gallery with tagNames ['bookmark'].",
      inputSchema: {
        search: z.string().describe("Every word must appear in the text, author, quote or note.").optional(),
        authorHandle: z.string().optional(),
        folderId: z.string().describe("A collection; its folders count too.").optional(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/bookmarks", { action: "list", ...input })),
  );

  server.registerTool(
    "set_bookmark_note",
    {
      title: "Set Bookmark Note",
      description: "Set or clear the owner's note on a saved post.",
      inputSchema: {
        id: z.string().describe("bookmark:<id>"),
        userNote: z.string().describe("Empty clears the note.").optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/bookmarks", { action: "note", ...input })),
  );
}
