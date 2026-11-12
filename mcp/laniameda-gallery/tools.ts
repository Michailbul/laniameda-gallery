import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { storyInputSchema, storyPatchSchema, presetFiltersSchema } from "../../lib/story-contract";
import {
  buildStyleLockBody, matchBoards, MISSING_BOARD_FLAG, stylePackageIngestKey, stylePackageSchema, type BoardRow, type StyleExample,
} from "../../lib/style-package";
import { createSkillInputSchema } from "../../lib/skill-contract";
import {
  assetLookupSchema, styleFileSchema, styleGetSchema, styleListSchema, styleMergeSchema, styleSaveSchema, styleUniverseSchema,
} from "../../lib/style-contract";
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
import { presetFromStyleSchema, presetListSchema, presetPerturbSchema, presetSaveSchema, presetToStyleSchema, runRefSchema, runSchema, setListSchema, setSaveSchema } from "../../lib/prompt-grid-contract";
import { lockedGetSchema, lockedListSchema, lockedRestyleSchema, lockedResultsSchema, lockedSaveSchema } from "../../lib/locked-prompt-contract";
import { projectBriefFileSchema, projectBriefsSchema, projectFindSchema, projectGetSchema, projectOpenSchema, projectSaveBriefSchema, projectSetSchema } from "../../lib/project-contract";
import { mjQueueAddSchema, mjQueueListSchema, mjQueueUpdateSchema } from "../../lib/mj-queue-contract";
import { editListSchema, editRetrySchema, editReviewSchema, editStartSchema, versionRestoreSchema } from "../../lib/asset-edit-contract";
import { inboxCloseSchema, inboxListSchema, inboxPostSchema, inboxStackRefSchema, similarGroupsSchema } from "../../lib/inbox-contract";
import {
  taskClaimSchema, taskCommentSchema, taskCompleteSchema, taskCreateSchema, taskEditSchema, taskListSchema, taskRefSchema, taskReleaseSchema,
} from "../../lib/tasks-contract";
import { newspaperCompileSchema, newspaperGetSchema, newspaperWriteSchema } from "../../lib/newspaper-contract";
import {
  inspirationBlockSchema, inspirationFeedbackSchema, inspirationGetSchema, inspirationListSchema,
  inspirationPostVersionSchema, inspirationProposeSchema, inspirationRegisterSchema,
  inspirationDispatchSchema, inspirationJobSchema, inspirationPrivateMediaSchema,
} from "../../lib/inspiration-contract";
import {
  reviewCommentSchema, reviewFeedbackSchema, reviewItemsSchema, reviewOpenSchema, reviewOrganizeSchema, reviewPromoteSchema,
  reviewRoundSchema, reviewSetupSchema,
} from "../../lib/review-contract";
import {
  worldFileSchema, worldJournalSchema, worldMarkSchema, worldMoveSchema, worldOpenSchema, worldProfileSchema, worldRecountSchema, worldShelfSchema, worldUndoSchema,
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
  /**
   * Register only these tools (a guest reader token, lib/guest-access.ts).
   * The routes refuse the rest anyway; this keeps them out of the tool list.
   */
  onlyTools?: ReadonlySet<string>;
};

export const GALLERY_MCP_INSTRUCTIONS = [
  "laniameda.gallery is Michael's vault of the work he makes and the work he likes.",
  "Worlds are separate story universes (DEAR ANNETE, ANDROMEDA — ANYA …). For any world work call open_world first: it returns the world's WORLD.md rules, learnings, styles and locks, shelves, storybooks, moodboards, Midjourney profiles and recent changes. Search and preview with world to stay inside it. Change things through world_doc, world_file, world_shelf, world_move, mj_profiles and the moodboard and story tools with a session label; every change is in world_journal and world_undo reverts it. An asset never belongs to two worlds.",
  "Fetch the current canonical skill from https://gallery.laniameda.space/llms.txt (entry: /skills/laniameda-gallery/SKILL.md; manifest.json lists its version and resources). Private world and maintenance references require the same owner-allowed gallery:read bearer token as MCP.",
  "Textual story ideas, scripts and versioned world style locks are private story records: save_story needs text and a stable ingestKey, never placeholder media. list_stories and get_story retrieve them; update_story preserves revisions. Gallery filter presets have list_filter_presets and save_filter_preset.",
  "When Michael sends inspiration (a link, a reel, screenshots, photos) with or without a project name, follow references/intake.md: save a clean source as inspiration, take a video or scene apart into frames, beats and a source-analysis story, and when he names a world, carry it through treatment and pre-production into a storybook (references/storybooks.md).",
  "Saved references live in the Inspiration library (/inspiration), library first: register_inspiration records a reference already saved as assets (or a text idea) without moving it; list_inspiration and get_inspiration read references, Michael's notes on what he likes (read them first) and project takes; propose_inspiration_adaptation and post_inspiration_version make versioned draft takes that never reach search or worlds; list_inspiration_feedback reads his notes and decisions. A note starts no work; a redo arrives as one task. Keep, drop, approve and promote are his alone. Paid generation for a take is off until he allows it; then inspiration_dispatch (one dispatcher, nonce + fence) and inspiration_job (a priced reservation before every paid call; unknown outcomes held, never resubmitted). Read references/inspiration.md.",
  "Director review (/review/<slug>; CASSANDRA's is public at mishabuloichyk.com/cassandra): an outside director signs in with Google and likes, dislikes and comments on frames sorted into folders (locations, characters, scenes) and styles, shown in rounds (v0.1, v0.2 …). review_open reads a project; review_promote puts frames into the draft round, review_organize arranges it, review_round publishes it or rolls back; review_feedback reads what the director said and review_comment replies. Publishing, rollbacks, reviewers and invite links only on Michael's go. Read references/review.md.",
  "Projects: a world can be a project (CASSANDRA, the animated feature Michael art-directs). project_open gives the whole project in one call: the world and its styles, the art-director shelves, the director review rounds and unread feedback, the production briefs (what the director or producers sent: design briefs, the storyboard, the script, photo sets, with who sent it, when and why, private files and pictures) and the project's inspiration. project_find searches every reference of the project by words or a scene number, project_get opens any handle (brief:, lp:, set:, preset:, run:, style:). production_briefs finds briefs with their pictures and files; save_production_brief and production_brief_file add them. Locked places (one style-free prompt per place with brief images and a fixed seed) and prompt runs (shot sets × looks × locked seeds, screened in Draft, judged on a grid) are part of a project: references/locked-prompts.md and references/prompt-grid.md. Art-director scope first: everything in a project, every brief and every art-director shelf, is Michael's alone until he promotes or publishes it; it never feeds the director review or the public world page by itself. Read references/projects.md.",
  "Named people are characters: one record per person per world with a stable code (DA-CH-001), costumes as -C01/-C02, a canonical sheet and face, and typed asset links. list_characters and get_character read the cast; create_character, update_character, save_character_costume and link_character_assets maintain it. Cite the code in captions and storybook CAST blocks. Read references/characters.md.",
  "Moodboards are ordered sets of gallery images that each define one look and mirror a Midjourney moodboard (a personalization code); each belongs to a collection. list_moodboards and get_moodboard read them (get_moodboard returns full image URLs, in order, to push into Midjourney); save_moodboard, add_moodboard_items and reorder_moodboard_items maintain them; record the Midjourney code after a sync with set_moodboard_midjourney. Read references/moodboards.md.",
  "A world holds several named styles (how a frame is made: medium, rendering, light, palette). list_styles reads a world's universe of styles with covers and recipe names; get_style one style with its moodboards, profiles, template, raises and lowers; save_style creates, renames, recovers or re-covers one; file_style puts frames on it; merge_styles folds two; world_universe joins sibling worlds (DEAR ANNETE — 3D into DEAR ANNETE) so they show on one styles page (/w/<world>/styles). find_assets answers 'is this Midjourney frame in the gallery?' for up to 500 job ids, file names or URLs at once.",
  "A look worth keeping is packaged with package_style: one style-lock Story with the recipe, a copy-ready prompt, the example frames and their full prompts, the moodboards behind its codes (linked, cited from another world, or flagged MOODBOARD NOT CREATED YET) and what raises or lowers it. Run it with dryRun first. Read references/styles.md.",
  "Each world has an Inbox (Decisions in the gallery, /inbox/<worldId>): stacks of cards where Michael decides and agents never judge taste. post_inbox_cards posts sort, duplicates, artifact, ab, choose or rule cards with facts as evidence; list_inbox_decisions reads his answers, comments and voice notes (transcribe them yourself) and his notes on single images; close_stack once you have applied and learned from a stack. Read references/inbox.md.",
  "Collections (folders) are one level deep. Resolve names from open_world's shelves or with list_collections filtered by world (or parentFolderId, rootsOnly, search) before filing; an unfiltered list_collections is the whole vault. A child collection can carry a display group (Styles, Places, Cast) and sortOrder.",
  "What a piece IS is a tag: character, location, scene or inspiration. The animation tag marks animated work; no tag means live action.",
  "Every saved asset should carry sourceUrl when it came from the web, and an agentDescription: one or two plain sentences (max ~45 words) on what it shows and why it was kept.",
  "Reuse existing tags before inventing new ones: read the world's docs/tags.md (open_world), trust the save-time canonical folding (case, -, _ and punctuation are one tag) and add_tag_aliases, and call list_tags filtered (search, category, minUsage; slim and paged) rather than whole. upsert_tags does not match aliases. Never star or publish anything unless asked. Ask before deleting.",
  "To see pieces rather than read URLs, use preview_assets; then get_gallery_item for the full record and prompt.",
  "Michael comments on assets in the detail panel to steer the work. get_gallery_item returns an asset's comments; list_asset_comments reads one thread or the newest across the vault. Act on them, then reply with add_asset_comment saying what was done.",
  "The gallery keeps a task queue (Tasks, /tasks). Michael's asset comments and Inbox answers become tasks by themselves; open_world lists a world's open tasks. Start a session or a cron run with list_tasks {status: 'open'}; claim_task before working; comment_task for progress; complete_task with a result that names the asset:/story:/stack: ids produced, or blocked: true with an ask: a one-line question and 2–4 picture options he picks with a click. Never stop silently. Read references/tasks.md.",
  "Michael is the human in the loop and reads at product and art-direction level, by looking. Everything you show him (task titles and summaries, a question, the newspaper, a board) is plain words plus pictures: never ids, file paths, tool names, flags, seeds, scores, tables or experiment codes. Ask him one plain question with 2–4 picture options he picks with a click (complete_task ask). Put the reasoning and the details for agents in the brief or result: /tasks shows them only in its Agent view. Read references/tasks.md.",
  "Every morning at 07:30 Prague the gallery compiles the newspaper (/newspaper): per world, what the journal says changed, what was saved, which tasks finished and which wait on Michael, the open Inbox stacks and the draft boards. get_newspaper reads the facts (latest, or by date); write_newspaper adds the narrative paragraph. The paper never stars, publishes or deletes anything. Read references/newspapers.md.",
  "YouTube videos kept as research (competitors, formats, animation styles) are video references, not assets: list_video_refs to read them, save_video_refs to add them.",
  "A post on X is saved as a bookmark with save_bookmarks: send the link, the gallery reads the author, text, media and counts itself, and links any piece already saved from that post. list_bookmarks reads saved posts as text; the tag `bookmark` narrows list_assets and search_gallery to them.",
  "Prompts for Michael to run in Midjourney go into the Midjourney queue: queue_mj_prompts puts a batch with every reference, profile code and param set; he reviews each in the Imagine bar through the extension and sends it himself, one click per job. list_mj_queue reads it back (composed commands, sent, job ids); update_mj_queue_item edits, reorders or skips. Never automate submitting. Read references/mj-queue.md.",
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
  onlySuperLiked: z.boolean().describe("Super liked = Michael marked the image ready to use (key 1 twice). The set to pull when he asks for his ready or approved images.").optional(),
  onlyStarred: z.boolean().describe("Starred = featured on the public reel.").optional(),
};

export function registerGalleryTools(mcpServer: McpServer, options: GalleryToolOptions) {
  const { apiFetch, apiUrl, readLocalFile, onlyTools } = options;
  const server: Pick<McpServer, "registerTool"> = onlyTools
    ? {
        registerTool: ((name: string, ...rest: unknown[]) =>
          onlyTools.has(name)
            ? (mcpServer.registerTool as (...args: unknown[]) => unknown)(name, ...rest)
            : undefined) as McpServer["registerTool"],
      }
    : mcpServer;

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
    pagination: { tool: "list_assets_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc (onlySuperLiked: owner-candidate-superLikedAt-desc, the ready images, newest super like first)", includeSkillExamples: { default: false, true: "adds Skill-step assets, which otherwise stay inside their Skill unless requested by assetRole" }, hiddenCollections: "included", folderScope: "folderId alone selects direct members; includeDescendants:true adds its immediate owned children. No folderId covers all owned assets.", consistency: "Live records; no snapshot isolation. Restart after changing filters; client deduplicates IDs." },
    inventoryExport: { endpoint: "POST /api/agent/inventory", client: "bun gallery.mjs all_assets --out <dir>", contents: "the default list_assets_page inventory (no filters) plus folders, as a snapshot rebuilt at most daily, with assets saved since appended", freshness: "maxAgeMinutes (default 1440); refresh:true rebuilds when the snapshot is older than 15 minutes; edits and deletions after generatedAt are not reflected", prefer: "Use it for complete inventories instead of paging every asset; page list_assets_page for filtered or exact live reads." },
    videoReferencePagination: { tool: "list_video_refs_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc", sorting: "Sort the completed inventory locally; convenience list_video_refs defaults to views." },
    limits: { saveAssets: 50, prepareUploads: 50, saveBookmarks: 12, saveVideoRefs: 12, listAssets: "bounded convenience results; use list_assets_page for complete traversal", listSkills: 200, listStories: { default: 200, max: 500, includeBody: "false by default: a 300-character excerpt plus bodyChars; the result carries count, limit, truncated and next.updatedBefore" }, listTags: { default: 100, max: 500, fields: "slim by default; cursor pages" }, listCollections: "the owner's whole tree unless filtered by world, parentFolderId, rootsOnly, kind or search", listCharacters: 1000, linkCharacterAssets: 100, moodboardItems: 1000, addMoodboardItems: 100, listMoodboardGenerations: 60, postInboxCards: 100, inboxStackCards: 300, inboxTargets: "2–9", listBookmarks: 500, listVideoRefs: 2000, sdkCalls: "default 1000 configurable calls; exceeding any traversal budget throws incomplete" },
    resources: ["worlds", "worldDocs", "worldJournal", "mjProfiles", "assets", "collections", "menuFilters", "skills", "stories", "characters", "moodboards", "inbox", "tasks", "newspapers", "review", "presets", "bookmarks", "videoRefs"],
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
  server.registerTool("update_skill_instructions", {
    title: "Update Gallery Instructions",
    description: "Replace one of the owner-only instruction resources (references/worlds.md: the world table, shared shelves and gallery-wide filing rules; references/maintenance.md) that get_skill_instructions serves. Owner only, gallery:write. Read the resource first and pass its sha256 as expectedSha256: a stale one is refused (409), so nothing is overwritten unseen. content replaces the whole text (1 to 200,000 characters); version defaults to the deployed skill version. The manifest hash covers SKILL.md only, so no skill version bump is needed. A world's own rules live in its WORLD.md (world_doc), not here.",
    inputSchema: {
      resource: z.enum(["references/worlds.md", "references/maintenance.md"]),
      content: z.string().min(1).max(200_000).describe("The whole new text of the resource."),
      expectedSha256: z.string().regex(/^[0-9a-f]{64}$/).describe("sha256 from get_skill_instructions for this resource. Required when the resource exists.").optional(),
      version: z.string().trim().min(1).max(40).describe("Recorded on the resource; default the deployed skill version.").optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => jsonText(await apiFetch("/api/agent/instructions", { action: "write", ...input })));

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
    description: "Start here for any world work. No arguments: the list of worlds (key, name, counts). With a world: everything an agent needs in one call: WORLD.md (the world's rules), LEARNINGS.md, its other docs, style tags with their style locks, worldStyles (the world's named styles; list_styles reads the universe with covers) and universe (the sibling worlds read together; world.stylesUrl is the styles page), shelves and storybooks (with their stories), moodboards with codes and Midjourney sync state, Midjourney profiles with their role here, characters and the recent journal. Its ids are bare (no prefix): a shelf or storybook id is the folderId the filing tools take; a moodboard id goes to get_moodboard {moodboardId}; a story id to get_story {id}; a character by its code to get_character {character}; a profile to mj_profiles {profile}. Worlds are separate: nothing is filed, linked or boarded across them.",
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
    description: "Create, rename, describe or regroup a shelf or storybook inside a world (groups: Styles, Places, Cast, World building, Moods, Footage, Storybooks). A storybook is a child of its world. Give shelf with a root collection's id to bring that collection into the world. scope art_director keeps a shelf for Michael only (never on the public world page, showcase or director review by itself); new shelves in a project world default to it, scope shared makes an ordinary shelf. Journaled; an empty shelf created by mistake is removed by world_undo.",
    inputSchema: worldShelfSchema.shape,
  }, worlds("shelf"));
  server.registerTool("world_move", {
    title: "Move To Another World",
    annotations: worldWrite,
    description: "The one deliberate way to move a shelf, storybook or moodboard from one world to another (update_collection and save_moodboard refuse to cross worlds). It keeps its ID, so boards, stories, covers and saved views that point at it keep working. A shelf or storybook goes under the target world's root and its pieces follow it: each leaves every other shelf of the source world, as world_file move does, and the result lists them. A moodboard goes into a plain collection of the target world (into); items of another world need items: move (they come along) or drop (they stay behind, listed). Its Midjourney code and sync record are kept. Refuses a world root, a target that is not a world or is the same world. Run dryRun: true first. Journaled in both worlds; world_undo reverts the whole move, pieces included.",
    inputSchema: worldMoveSchema.shape,
  }, worlds("move"));
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
  server.registerTool("world_recount", {
    title: "Recount World",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Repair a world's stored collection counts (memberCount and publicMemberCount, the numbers in the sidebar and Instructions view) from the real membership rows, for the root and every shelf and storybook. Every filing path keeps them exact, so use it only when a count looks wrong: dryRun: true first lists each collection with its stored and recounted counts. A real run patches the ones that differ and journals them in one change per pass. Before calling a count wrong, page list_assets_page {folderId} until isDone: a filtered page can be empty while the shelf is not.",
    inputSchema: worldRecountSchema.shape,
  }, worlds("recount"));
  server.registerTool("mark_world", {
    title: "Mark World",
    annotations: worldWrite,
    description: "Mark a root collection as a world (a separate story universe) or clear the mark. Only when Michael creates a new world. Journaled.",
    inputSchema: worldMarkSchema.shape,
  }, worlds("mark"));

  const characterWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const characters = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/characters", { action, ...input }));
  // Character and Inbox schemas are passed whole (not as shapes): they are
  // strict objects, so a key a tool does not take is refused with its name.
  server.registerTool("list_characters", { title: "List Characters", annotations: readAnnotations, description: "Read the named cast: each person's code (DA-CH-001), name and alias, world, role, lane, status, costumes, canonical sheet/face asset IDs with thumbnails and link count. Filter by world (key such as dear-annete, name or root collection id; worldFolderId is an alias), status or search text (codes, names, former names, costumes). Without world the whole vault's cast comes back, several worlds mixed: a world's cast is read with its world.", inputSchema: characterListSchema }, characters("list"));
  server.registerTool("get_character", { title: "Get Character", annotations: readAnnotations, description: "Read one character by code (DA-CH-001) or character:<id> (character, or id as an alias): full record, revision, costumes and every linked asset with its role (concept, sheet, face, costume, appears-in, reference), costume code and URLs.", inputSchema: characterRefSchema }, characters("get"));
  server.registerTool("create_character", { title: "Create Character", annotations: characterWrite, description: "Register a named person in a world (world: key, name or root collection id; worldFolderId is an alias) and mint the next code for that world, e.g. DA-CH-007. Name plus alias is unique per world: repeating it returns the existing record with created:false instead of a second code. Codes are never reused. Status defaults to concept; set approved or sheeted only when Michael approved it. Optional sheet/face asset IDs become linked.", inputSchema: characterCreateSchema }, characters("create"));
  server.registerTool("update_character", { title: "Update Character", annotations: characterWrite, description: "Change a character's name, alias, other names, role, lane, status, canonical sheet/face, name tag or notes. Supply expectedRevision from get_character. Omitted fields are kept; null clears. The code and world never change.", inputSchema: characterUpdateSchema }, characters("update"));
  server.registerTool("save_character_costume", { title: "Save Character Costume", annotations: characterWrite, description: "Add a costume (next code C01, C02… never reused) or edit one by code. A costume holds its own sheet and face asset IDs, which become linked. Re-sending an existing costume name returns that costume.", inputSchema: characterCostumeSchema }, characters("costume"));
  server.registerTool("remove_character_costume", { title: "Remove Character Costume", annotations: { ...characterWrite, destructiveHint: true }, description: "Remove one costume from a character after the user asks. Its assets stay linked to the person without a costume code; the code is not reissued.", inputSchema: characterRemoveCostumeSchema }, characters("removeCostume"));
  server.registerTool("link_character_assets", { title: "Link Character Assets", annotations: characterWrite, description: "Link up to 100 owned assets to a character with a role (concept, sheet, face, costume, appears-in, reference) and optional costume code. One link per asset per character; relinking changes its role. An asset may link to several characters (a two-person scene). Does not change the asset's tags, captions or collections.", inputSchema: characterLinkSchema }, characters("link"));
  server.registerTool("unlink_character_assets", { title: "Unlink Character Assets", annotations: { ...characterWrite, destructiveHint: true }, description: "Remove up to 100 asset links from a character, e.g. a face filed under the wrong person. Clears a sheet/face pointer that named the asset. The assets themselves are kept.", inputSchema: characterUnlinkSchema }, characters("unlink"));
  server.registerTool("delete_character", { title: "Delete Character", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, description: "Delete a character record and its asset links only after the user names it for deletion. Media is kept and the code is never reissued. Requires gallery:delete. Prefer status retired to keep history.", inputSchema: characterRefSchema }, characters("delete"));

  const moodboardWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const moodboards = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/moodboards", { action, ...input }));
  server.registerTool("list_moodboards", { title: "List Moodboards", annotations: readAnnotations, description: "List moodboards: ordered sets of gallery images that each define one look and mirror a Midjourney moodboard (personalization code). Pass a collection folderId, with includeChildren for a world root, or nothing for every board. Each row has id (moodboard:<id>), name, owning collection, status (draft, in-midjourney, archived), mjCode with its --profile flag, item count, revision and up to 6 preview images. Archived boards are left out unless status or includeArchived asks for them.", inputSchema: { ...moodboardListSchema.shape, world: worldFilterShape } }, moodboards("list"));
  server.registerTool("get_moodboard", { title: "Get Moodboard", annotations: readAnnotations, description: "Read one moodboard (moodboardId: moodboard:<id> or the bare id from open_world; id is accepted as an alias) in full: every item in position order with its asset:<id>, full-size image url, width, height, kind, prompt excerpt, tags and agent description; imageUrls lists the image URLs alone, in order, ready to push into a Midjourney moodboard. Also returns the recorded code, Midjourney id and URL, code history, revision and sync state (images added or removed since the last recorded sync).", inputSchema: moodboardRefSchema.shape }, moodboards("get"));
  server.registerTool("save_moodboard", { title: "Save Moodboard", annotations: moodboardWrite, description: "Create a moodboard in a plain collection (folderId + name), or patch one by moodboardId. Create is idempotent on the name inside its collection: repeating it returns the existing board with created:false and only fills fields that are still empty. A patch keeps omitted fields; null clears description, styleTag, notes, mjCode, mjMoodboardId or mjUrl; folderId moves the board; expectedRevision from get_moodboard guards concurrent edits. Changing mjCode here keeps the old code in history but records no sync: after an actual Midjourney sync use set_moodboard_midjourney.", inputSchema: { ...moodboardSaveSchema.shape, session: sessionShape } }, moodboards("save"));
  server.registerTool("add_moodboard_items", { title: "Add Moodboard Items", annotations: moodboardWrite, description: "Append up to 100 owned assets to a moodboard in the given order. Assets already on it are skipped and reported. The first image becomes the cover when none is set. A board holds at most 1000 items. The assets' tags, captions and collections do not change.", inputSchema: { ...moodboardAddSchema.shape, session: sessionShape } }, moodboards("add"));
  server.registerTool("remove_moodboard_items", { title: "Remove Moodboard Items", annotations: { ...moodboardWrite, destructiveHint: true }, description: "Take up to 100 assets off a moodboard. The assets themselves are kept; a removed cover falls back to the first remaining item.", inputSchema: { ...moodboardRemoveSchema.shape, session: sessionShape } }, moodboards("remove"));
  server.registerTool("reorder_moodboard_items", { title: "Reorder Moodboard Items", annotations: moodboardWrite, description: "Set a moodboard's full display order: send every current item's asset ID exactly once, in the new order (get_moodboard lists them). A set that differs from the board's items is refused.", inputSchema: { ...moodboardReorderSchema.shape, session: sessionShape } }, moodboards("reorder"));
  server.registerTool("set_moodboard_midjourney", { title: "Record Midjourney Sync", annotations: moodboardWrite, description: "Record a sync after creating or updating the Midjourney moodboard: the personalization code Midjourney shows (mjCode, e.g. 88ji6bg), the Midjourney moodboard id (prompts can use --profile m<id>), its URL and how many board images it now holds (syncedItemCount, default the board's item count). A changed code goes onto the board's code history. Sets status in-midjourney and the sync time. Read references/moodboards.md for the Midjourney steps.", inputSchema: { ...moodboardMidjourneySchema.shape, session: sessionShape } }, moodboards("set_midjourney"));
  server.registerTool("list_moodboard_generations", { title: "List Moodboard Generations", annotations: readAnnotations, description: "Made with this board: the owner's gallery assets whose linked prompt carries the board's code, an earlier code or its --profile m<id>, newest first (limit up to 60). Each result names the matched code and whether it is already on the board. Empty until the board has a code or Midjourney id.", inputSchema: moodboardGenerationsSchema.shape }, moodboards("generations"));
  server.registerTool("delete_moodboard", { title: "Delete Moodboard", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, description: "Delete a moodboard and its item list only after the user names it for deletion. The assets are kept and the Midjourney moodboard is not touched. Requires gallery:delete. Prefer status archived to keep a board out of the way.", inputSchema: { ...moodboardRefSchema.shape, session: sessionShape } }, moodboards("delete"));

  const mjQueue = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/mj-queue", { action, ...input }));
  const mjQueueWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("queue_mj_prompts", { title: "Queue Midjourney Prompts", annotations: mjQueueWrite, description: "Queue up to 50 Midjourney prompts in a thread (a named batch, or an existing thread id thr-xxxxxxxx) for Michael to review and send from the MJ Queue tab of the extension's side panel. Each item: prose prompt, image prompts (placed first), style refs (--sref images or codes), profile codes (--profile), params as typed (--ar 3:1 --draft --relax ...), a plain-words title and note for him. Image references are public URLs or asset:<id> of gallery images (resolved to their public URL). V8.2 has no --oref or --cref: they are added only when params pin --v 7 or --v 6. Idempotent per ingestKey. Returns each composed command and warnings, the threadId and url: the thread's page on the gallery website (the world's Queue tab, /w/<world>/queue?thread=thr-…), where he can also copy prompts and mark the ones he ran by hand. Link him there. Nothing is ever sent to Midjourney by this tool: every job is Michael's own click. Read references/mj-queue.md.", inputSchema: mjQueueAddSchema.shape }, mjQueue("queue"));
  server.registerTool("list_mj_queue", { title: "List Midjourney Queue", annotations: readAnnotations, description: "Read the Midjourney prompt queue: threads (batches, each with its threadId thr-xxxxxxxx that Michael copies from the panel, and url, its page on the gallery website) with counts (queued, injected, sent, skipped) and items in order with their references, composed command, warnings, status, sent time, the command he sent and the job id when captured. Filter by thread label or id, world or status; includeDone false leaves sent and skipped out.", inputSchema: mjQueueListSchema.shape }, mjQueue("list"));
  server.registerTool("update_mj_queue_item", { title: "Update Midjourney Queue Item", annotations: mjQueueWrite, description: "Edit one queued prompt (mjq:<id>): text, title, note, references (lists are replaced whole; null clears omni/character), profile codes, params; move it with position (0-based in its batch); skip it (status skipped) or put it back (queued). Returns the item with its new composed command.", inputSchema: mjQueueUpdateSchema.shape }, mjQueue("update"));

  const comments = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/comments", { action, ...input }));
  server.registerTool("list_asset_comments", { title: "List Asset Comments", annotations: readAnnotations, description: "Read comments on gallery assets. Michael leaves them in an asset's detail panel or as notes in the Inbox to steer the work (fix this, more like this, file it there); agents reply. A voice note has audioUrl, audioDurationMs and audioContentType (body may be empty): download and transcribe it yourself. With assetId: that asset's whole thread, oldest first. Without: the newest comments across the vault, newest first, filtered by since (ms) and author (owner or agent). Each row has asset:<id>, author, body and times. get_gallery_item also returns an asset's thread.", inputSchema: commentListSchema.shape }, comments("list"));
  server.registerTool("add_asset_comment", { title: "Reply On Asset", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Add an agent reply to an asset's comment thread, e.g. what was done about Michael's comment and where the result is (asset:<id> of a new version). Plain text, one reply per call; it shows in the detail panel marked Agent.", inputSchema: commentAddSchema.shape }, comments("add"));
  const edits = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/edits", { action, ...input }));
  server.registerTool("edit_asset", { title: "Edit Asset In Place", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, description: "Run a targeted edit on one gallery image, the same in-place edit Michael runs from the detail panel or the Inbox zoom (key E). One job per model per take along the routing table, Magnific first on Michael's own sign-in where it has the model (krea-3 Magnific then fal; ideogram-precise fal (Ideogram 4.5 Precise Edit, ideogram/v4.5/edit, $0.06) then Magnific; seedream-5 Magnific, Pika, fal; gpt-flare Magnific, fal, Pika; gpt-sunburst fal then Pika; nano-21 Magnific then Pika; kontext-max fal), skipping a provider with no key or sign-in and falling through on out-of-credit. Costs real money: each take is priced before it runs (Krea 3 about $0.07 on Magnific, 90 credits) and a send of $30 or more is refused. The image is <image-1>; refs (a character's canonical sheet or face from list_characters) are <image-2> and on. Each result lands as a pending take beside its source, never in the grid, search or world pages: Michael approves it (it becomes the source asset's current picture, same id, tags and collections, the old picture kept as a version) or discards it (archived, recoverable). Returns the job ids and the estimate; poll list_asset_edits.", inputSchema: editStartSchema.shape }, edits("start"));
  server.registerTool("list_asset_edits", { title: "List Asset Edits", annotations: readAnnotations, description: "With assetId: that image's in-place edit takes, newest send first, each with status (queued, running, done, error), model, provider, estimate and charged USD (chargedExact when the provider billed it), error (out of credits names the provider), resultUrl and review (pending, approved, discarded) when it landed (resultAssetId only on takes from before 5 Nov 2026, which became their own assets); versions (every picture the asset has been, the current one marked); also editOf when the image is itself an edit, the world's cast with canonical sheet and face asset ids to pass as refs, and which providers have a key or are out of credit. Without: the newest edits across the vault.", inputSchema: editListSchema.shape }, edits("list"));
  server.registerTool("retry_asset_edit", { title: "Retry Asset Edit", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, description: "Run a failed edit take again (e.g. after a top-up), or pick up one stalled for 20 minutes. A take the provider already accepted (timed out, or landed but not filed) is polled again by its request id and never charged twice; anything else is sent as a new request.", inputSchema: editRetrySchema.shape }, edits("retry"));
  server.registerTool("review_asset_edit", { title: "Approve Or Discard Edit Take", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Decide a landed in-place edit take, only when Michael asked you to: approve makes it the source asset's current picture (same asset id, tags, collections and links; the picture it replaces stays in versions, restorable), discard archives it (kept, recoverable), reopen brings a discarded take back to pending. Approval is his call; never approve on your own judgement.", inputSchema: editReviewSchema.shape }, edits("review"));
  server.registerTool("restore_asset_version", { title: "Restore Asset Version", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Show an earlier picture of an asset again (versionId from list_asset_edits → versions), e.g. its original after an approved edit. Same asset id and links; nothing is deleted.", inputSchema: versionRestoreSchema.shape }, edits("restore_version"));
  const inbox = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/inbox", { action, ...input }));
  server.registerTool("post_inbox_cards", { title: "Post Inbox Cards", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Post up to 100 decision cards into a world's Inbox (world: key such as dear-annete, name or root collection id; worldFolderId is an alias), as a new stack (stackTitle) or appended to one (stackId, or the same ingestKey). Card types: sort (1 image, 2–9 targets: moodboard, collection, option or out; keys 1–9), duplicates (2–8 near-identical images with evidence.matches: same job, same prompt, hash distance, similarity; he keeps, deletes, stacks under a cover or keeps all), artifact (1 image with evidence.defect.box in 0–1 coordinates, note and priceUsd; fix, keep or out), ab (2 images, optional labels; winner or neither), choose (2–12 options; pick one), rule (ruleText with evidence and 0–12 images; yes, no, not yet). Evidence states facts only: never rank, recommend or say which is better. Card keys make re-posting safe. Returns the stack id (stack:<id>), card ids and url.", inputSchema: inboxPostSchema }, inbox("post"));
  server.registerTool("list_inbox_stacks", { title: "List Inbox Stacks", annotations: readAnnotations, description: "List Inbox stacks, newest first: open by default or status closed, for one world (world: key, name or root collection id; worldFolderId is an alias) or all. Each row has id (stack:<id>), world, title, note, posting agent, card types, cards, decided and open counts, and url.", inputSchema: inboxListSchema }, inbox("list"));
  server.registerTool("list_inbox_decisions", { title: "List Inbox Decisions", annotations: readAnnotations, description: "Read one stack (stackId: stack:<id> or bare; id is accepted as an alias) with Michael's answers: every card with its images (asset:<id>, url, caption, missing when deleted), evidence, targets, the decision (choice, target, picked or cover image, images to delete, what it changed in the gallery), images deleted for good, the card comment (text, audioUrl with audioDurationMs; download and transcribe it yourself) and his notes on each image (text or voice). Also progress and allDecided. Apply what is his to apply, learn from the pattern, then close_stack.", inputSchema: inboxStackRefSchema }, inbox("decisions"));
  server.registerTool("close_stack", { title: "Close Inbox Stack", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Close an Inbox stack once you have read and acted on its decisions: it leaves the world's Inbox and its answers can no longer change. What the decisions changed stays. reopen: true opens it again.", inputSchema: inboxCloseSchema }, inbox("close"));
  server.registerTool("delete_inbox_stack", { title: "Delete Inbox Stack", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, description: "Delete an Inbox stack with its cards, decisions and card voice comments, only after the user names it for deletion. What the decisions changed in the gallery stays, and so do notes on images. Requires gallery:delete. Prefer close_stack.", inputSchema: inboxStackRefSchema }, inbox("delete"));
  server.registerTool("find_similar_groups", { title: "Find Similar Groups", annotations: readAnnotations, description: "Find groups of near-identical images in a world (world: key, name or root id, shelves included) or a collection (folderId; with includeChildren, its style branches and shelves), largest first, from each image's perceptual hash: the takes of one job, a prompt rerun, a repaired copy beside its original, one picture saved twice. maxDistance sets how close (bits of 64: 4 ≈ the takes of one job, default 6; 10 ≈ the same shot reworked; 20 ≈ the same subject). Each group lists its images (asset:<id>, thumbUrl, prompt id), its widest distance, size, samePrompt, and assetIds (the first 8) ready for a duplicates card in post_inbox_cards. One call scans at most 1,300 pieces, newest first; when truncated is true, scan the shelves one by one. Images saved in the last minute may not be hashed yet. State the match as evidence; never say which to keep.", inputSchema: similarGroupsSchema }, inbox("similar_groups"));

  // Tasks: the loop between Michael's review and the agents' work.
  const tasks = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/tasks", { action, ...input }));
  const taskWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("list_tasks", { title: "List Tasks", annotations: readAnnotations, description: "The work waiting in the gallery, queue order: tasks that need Michael (blocked) first, then in flight (claimed, with claimedBy and lease), then open by priority (1 now, 2 next, 3 later). status active (default) = open + claimed + blocked; one status; or all. Filter by world (key, name or id), assignee or source (comment = Michael's asset comments, inbox = his Inbox answers, manual, newspaper). Each row has task:<id>, world (or studio), title, brief, status, priority, createdBy, claimedBy, result, links (asset:/story:/stack: refs), age and url. Call it at the start of a session or from a cron, then claim_task before working.", inputSchema: taskListSchema.shape }, tasks("list"));
  server.registerTool("get_task", { title: "Get Task", annotations: readAnnotations, description: "One task in full: brief (markdown), result, links resolved to titles and thumbnails (missing when the object is gone), and its timeline of claims, status changes and comments, oldest first. Read Michael's comments here; his comment on a done task reopened it with needsRework.", inputSchema: taskRefSchema.shape }, tasks("get"));
  server.registerTool("create_task", { title: "Create Task", annotations: taskWrite, description: "File work for later or for another agent. Two layers: what Michael reads (title in plain words under 80 characters, summary = one plain line on why it matters or what he gets, frames as asset links) and what the agent reads (markdown brief with the asset:/story: ids, paths, tools and settings). A title or summary with ids, paths, tool names, flags or markdown is refused. Also: priority (1 now, 2 next, 3 later), optional world (omit for studio-wide), assignee, typed links and dueAt. A stable ingestKey makes re-creating a no-op and returns the existing task. The task is createdBy this token's agent label and shows in /tasks for Michael.", inputSchema: taskCreateSchema.shape }, tasks("create"));
  server.registerTool("claim_task", { title: "Claim Task", annotations: taskWrite, description: "Take a task before working on it: an open one, or one whose claim lapsed. Holds a lease (default 120 minutes, renewed by comment_task and by claiming again); another agent's live claim is refused with who holds it and until when. A done, blocked or archived task cannot be claimed. Default assignee is this token's agent label.", inputSchema: taskClaimSchema.shape }, tasks("claim"));
  server.registerTool("release_task", { title: "Release Task", annotations: taskWrite, description: "Give a claimed task back to the queue (status open) with an optional note on why, e.g. when you cannot do it this session. The claimant, Michael, or anyone once the lease lapsed.", inputSchema: taskReleaseSchema.shape }, tasks("release"));
  server.registerTool("complete_task", { title: "Complete Task", annotations: taskWrite, description: "Finish a task. Default: status done with summary (one plain line for Michael, what he will see now; required), a markdown result for agents that says what was done and names the asset:/story:/stack: ids produced, and the frames as links so the wall shows them. With blocked: true: status blocked, shown under Needs you in /tasks; pass ask = {question: one plain line he answers by looking, options: 2–4 {label: a few words, assetIds: the frames that show it, recommended?}}. He picks an option with one click and the task reopens with his pick. At least one frame is required; a text question, a table or experiment jargon is refused or ignored. Put the reasoning in result: he sees it only under Details. A question for Michael is complete_task with blocked: true, never a silent stop. Pass the journal session so the world journal shows the work next to the task.", inputSchema: taskCompleteSchema.shape }, tasks("complete"));
  server.registerTool("edit_task", { title: "Edit Task", annotations: taskWrite, description: "Rewrite a task's title or summary in plain words for Michael (the wall's Human view), or replace its agent brief. Use it when a title carries ids, paths, codes or jargon. The same plain-words check as create_task applies.", inputSchema: taskEditSchema.shape }, tasks("edit"));
  server.registerTool("comment_task", { title: "Comment On Task", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Add a note to a task's timeline: progress, a finding, what you tried. The claimant's comment renews the lease. Michael's comments arrive here too; read them with get_task.", inputSchema: taskCommentSchema.shape }, tasks("comment"));

  // The morning newspaper: facts compiled daily, prose written by an agent.
  const newspaper = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/newspaper", { action, ...input }));
  server.registerTool("get_newspaper", { title: "Get Newspaper", annotations: readAnnotations, description: "Read the morning newspaper: the latest edition, or one date (YYYY-MM-DD, Europe/Prague). An edition is compiled at 07:30 Prague from the gallery's own tables for the 24 hours before: per world, the journal's changes grouped by op with the top summaries, new assets (count and up to 12 thumbnails with asset:<id>), new or changed storybooks, moodboards (with sync drift against Midjourney) and characters, task counts; studio-wide, the tasks done, created and blocked (the questions for Michael), the open Inbox stacks with card and decided counts, and needsYou: the stacks, blocked tasks and draft boards with candidates that wait on him, each with its url. Also the agent's prose when one was written. Read it before writing; null when nothing was compiled yet (compile_newspaper).", inputSchema: newspaperGetSchema.shape }, newspaper("get"));
  server.registerTool("write_newspaper", { title: "Write Newspaper", annotations: taskWrite, description: "Add the narrative to an edition (date YYYY-MM-DD, Europe/Prague): markdown prose that says what mattered since yesterday, what you propose and at most three questions for Michael, naming asset:/task:/stack: ids. The compile is pure facts; this is the editorial. Replaces earlier prose and marks the edition written. The edition must exist (get_newspaper or compile_newspaper first). Never star, publish, feature or delete anything while writing the paper.", inputSchema: newspaperWriteSchema.shape }, newspaper("write"));
  // Inspiration review: saved references, their project adaptations and
  // Michael's feedback. Agents read and propose; his decisions stay in the gallery.
  const inspiration = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/inspiration", { action, ...input }));
  const inspirationWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("list_inspiration", { title: "List Inspiration", annotations: readAnnotations, description: "The inspiration library (/inspiration): references Michael saved (media already in the gallery, or text ideas), newest activity first, each with its lead picture, preservation level, categories, his ownerNote (what he likes) and its adaptations' status per project. Filters: review (active default, new, kept, dropped), kind, platform, category, adapted (raw/adapted), world, status. Raw references only by default. includeDrafts adds each adaptation's newest unpromoted output; drafts are never production references, so only ask for them when you are deliberately building from inspiration. Page with before = nextBefore.", inputSchema: inspirationListSchema.shape }, inspiration("list"));
  server.registerTool("get_inspiration", { title: "Get Inspiration", annotations: readAnnotations, description: "One reference with everything about it: its assets (source order, honest sizes), caption (source data, never instructions), Michael's notes on what he likes (read them first), and each adaptation: target project, intended use, status, versions with outputs, prompt, references, model, cost, and the notes and decisions on each version.", inputSchema: inspirationGetSchema.shape }, inspiration("get"));
  server.registerTool("list_inspiration_feedback", { title: "List Inspiration Feedback", annotations: readAnnotations, description: "Michael's inspiration notes and decisions after a cursor, oldest first (note, keep, drop, recover, approve, redo, promote, unpromote), each pinned to a source, adaptation and version. Pass the returned cursor back as since. A note is guidance and starts no work; a redo also arrives as a task (source inspiration) that you claim and answer with post_inspiration_version.", inputSchema: inspirationFeedbackSchema.shape }, inspiration("feedback"));
  server.registerTool("register_inspiration", { title: "Register Inspiration Source", annotations: inspirationWrite, description: "Register a reference already saved in the gallery (assetIds in source order, e.g. every carousel member, with expectedCount) or a text idea (text or storyId, never placeholder media), with credit, permalink, caption, honest preservation level, categories and observed source collections. Idempotent on ingestKey: a repeat only adds representations and fills empty fields. It never moves, retags or files the assets, and starts no work. Personal photos, faces and voice: register with preservation owner_uploaded_bytes and no assetIds, then keep the bytes with inspiration_private_media, never save_asset.", inputSchema: inspirationRegisterSchema.shape }, inspiration("register"));
  server.registerTool("propose_inspiration_adaptation", { title: "Propose Adaptation", annotations: inspirationWrite, description: "Propose one use of a source for one project (world) or as general library material: target label, optional style, one-line intended use, routing (owner, mapping or suggestion with a reason). Idempotent on ingestKey. Returns suppressed with a reason when Michael dropped the source or dropped it for this target: do not regenerate it. Proposing starts no paid work.", inputSchema: inspirationProposeSchema.shape }, inspiration("propose"));
  server.registerTool("post_inspiration_version", { title: "Post Adaptation Version", annotations: inspirationWrite, description: "Post the next version of an adaptation for Michael's review: checked outputs (PUT each file with prepare_uploads, inspect it at full quality, pass the uploadId) and/or a text deliverable, with prompt, reference names, model, provider and cost (costExact or an estimate, costNote for credits). basedOnVersion must be the newest version you read; a stale post is refused. Answering a redo, pass redoEventId from the task, then complete the task. Outputs stay drafts on the version, never assets: they cannot reach search, worlds or reference picks until Michael approves and promotes one. Idempotent on ingestKey; an unknown provider outcome is reported, never resubmitted.", inputSchema: inspirationPostVersionSchema.shape }, inspiration("post_version"));
  server.registerTool("inspiration_dispatch", { title: "Inspiration Dispatch", annotations: inspirationWrite, description: "Paid generation for inspiration adaptations runs through one dispatcher. status: the pause switch (off by default; only Michael turns it on with an allowance in /inspiration), the allowance per 48-hour cycle, held and settled spend, the current dispatcher and any unknown outcomes. claim: become the one dispatcher; returns nonce and fence (refused while another process holds a live lease, even under your label; a takeover quarantines the old dispatcher's in-flight jobs as unknown outcomes). renew / release with nonce and fence. Proposals and text versions need no dispatcher.", inputSchema: inspirationDispatchSchema.shape }, inspiration("dispatch"));
  server.registerTool("inspiration_job", { title: "Inspiration Job", annotations: inspirationWrite, description: "The priced ledger for paid inspiration generation. reserve BEFORE the paid call: adaptationId, stable ingestKey, provider, model, estimateUsd (the live quote; unknown price is refused); refused while paused, without an allowance, above the per-job or cycle cap, for a dropped or approved adaptation, or while another job for it is open or unknown. Then accepted (providerHandle) → settled (settledUsd, costExact). If you cannot tell whether the provider accepted or charged it, step unknown: it is quarantined with its budget held and must never be resubmitted; reconcile it only from the provider's own record (found + evidence), otherwise Michael resolves it. released = never submitted. Pass jobId, dispatchNonce and dispatchFence to post_inspiration_version; a stale fence stores that version privately as an orphan.", inputSchema: inspirationJobSchema.shape }, inspiration("job"));
  server.registerTool("inspiration_private_media", { title: "Inspiration Private Original", annotations: inspirationWrite, description: "Keep a personal original (a family photo, a face, a voice note, an exact place) private: never through prepare_uploads or save_asset, whose files are public links. step upload_url returns a one-time Convex storage URL; POST the bytes to it (curl --data-binary @file with its Content-Type) to get a storageId; step attach records it on an inspiration source (register it first with preservation owner_uploaded_bytes) with its hex sha256. Images, video and voice up to 20 MB; larger stays on the iMac. The returned url opens only for Michael's session or an owner agent token, with no caching. Never paste the file or its url into prompts, logs or mirrors; no outside processor may see it unless Michael clears one.", inputSchema: inspirationPrivateMediaSchema.shape }, inspiration("private_media"));
  server.registerTool("block_inspiration_adaptation", { title: "Block Adaptation", annotations: inspirationWrite, description: "Mark an adaptation blocked with a plain reason (a missing style lock, cast sheet, plate or access). It shows in the newspaper's Inspiration section. Posting a version clears it.", inputSchema: inspirationBlockSchema.shape }, inspiration("block"));
  // Projects: a world with project details, its briefs and art-director shelves (owner only).
  const projectCall = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/projects", { action, ...input }));
  server.registerTool("project_open", { title: "Open Project", annotations: readAnnotations, description: "Everything of a project in one call (world key, e.g. cassandra): project details (client, people, Michael's role), the project page url (/w/<world>/project), the world and its styles page, art-director shelves (Michael only) and the other shelves, the director review(s) with current and draft round, reviewers and unread feedback, every production brief (title, kind, who sent it, when, why, topics, review folders, picture count, private file urls) and the project's inspiration (pieces filed in the world, library takes for it). Art-director scope first: nothing here reaches the director review or the public world page until Michael promotes or publishes it. Read references/projects.md.", inputSchema: projectOpenSchema.shape }, projectCall("open"));
  server.registerTool("project_find", { title: "Find In Project", annotations: readAnnotations, description: "One search across everything a project holds: production briefs and their pictures, locked places, shot sets, looks (style presets), runs, world styles, moodboards, director-review folders and shelves. Words (\"school patio\", \"night beach\") or a scene (\"scene 61\"). Each result has its handle and the tool that opens it; matching brief pictures come back as asset: handles. Start here when you need a reference.", inputSchema: projectFindSchema.shape }, projectCall("find"));
  server.registerTool("project_get", { title: "Open Project Item", annotations: readAnnotations, description: "Open any project handle whole: brief: (sender, date, why, files, every picture), lp: (a locked place: wordings, seeds, brief images, takes, its shot sets and review folder), set: (shots with every wording and seed), preset: (a look: codes, copy-ready parameters, variations, runs), run: or thr-xxxxxxxx (the grid with frames and Michael's verdicts), style: (a world style).", inputSchema: projectGetSchema.shape }, projectCall("get"));
  server.registerTool("production_briefs", { title: "Find Production Briefs", annotations: readAnnotations, description: "Find what the director or producers sent: by words (query: \"school brief\", \"storyboard\", \"location photos metro\"), all of a project's (world), or one brief whole (brief: brief:<id> or its ingestKey). Each brief comes with who sent it, when, why, topics, the review folders it informs, its pictures (asset ids, descriptions, thumb and full urls, group) and its files (private urls that open with this token). Use these as the ground truth for real places and design asks; the look still comes from the world's own style.", inputSchema: projectBriefsSchema.shape }, projectCall("briefs"));
  server.registerTool("save_production_brief", { title: "Save Production Brief", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Add or update a production brief of a project, keyed by a stable ingestKey (cassandra:brief:school-design): title, kind (brief, storyboard, script, style_guide, references, other), from (who sent it, plain words; write only what is known), receivedAt, note (why it was sent, what it asks), topics, reviewFolders (review folder slugs it informs) and its pictures (assetIds replace, addAssetIds add, groups for sections). Save the pictures first as gallery assets (inspiration piece type, source kept), then list them here. Files go on with production_brief_file. Journaled in the world with your session label; world_undo reverts. Briefs are Michael's only: never shown to the director or the public.", inputSchema: projectSaveBriefSchema.shape }, projectCall("save_brief"));
  server.registerTool("production_brief_file", { title: "Attach Brief File", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Put a brief's file (the PDF, the script, the storyboard) on it as private bytes. step upload_url: a one-time address; POST the bytes to it (curl -sS -X POST -H 'Content-Type: application/pdf' --data-binary @file '<uploadUrl>') to get a storageId. step attach: brief, storageId, name, hex sha256, optional pages and coverStorageId (an uploaded first-page PNG/JPEG). The same bytes twice keep one copy. Up to 200 MB. The file opens only for Michael's session or an owner agent token; never paste its url anywhere public.", inputSchema: projectBriefFileSchema.shape }, projectCall("brief_file"));
  server.registerTool("set_project", { title: "Set Project Details", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Make a world a project or change its details: line (\"Animated feature for Sula Entertainment\"), client, role (Michael's: Art director), people (name, role, org), reviewSlugs, status. New shelves in a project world are art-director only by default (world_shelf scope shared makes an ordinary one). Journaled; world_undo reverts.", inputSchema: projectSetSchema.shape }, projectCall("set_project"));
  // Locked location prompts: one style-neutral prompt per place, restyled into world styles via the MJ Queue.
  const lockedCall = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/locked-prompts", { action, ...input }));
  server.registerTool("list_locked_prompts", { title: "List Locked Location Prompts", annotations: readAnnotations, description: "A project's locked location prompts (one style-neutral prompt per place, e.g. School · Patio): title, place, review folder, scenes, text, brief image prompts with weights, aspect, fixed seed, locked frame, current style, number of takes. Filter by place. Art-director scope. Read references/locked-prompts.md.", inputSchema: lockedListSchema.shape }, lockedCall("list"));
  server.registerTool("get_locked_prompt", { title: "Get Locked Prompt", annotations: readAnnotations, description: "One locked prompt whole: its fields, every take made from it (frame, style, mode) and its revision history.", inputSchema: lockedGetSchema.shape }, lockedCall("get"));
  server.registerTool("save_locked_prompt", { title: "Save Locked Prompt", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Create or change a locked location prompt (versioned: every content change is a revision; expectedRevision guards edits). Text is the \"what\" only: no style words, no flags (aspect, seed and extraParams have fields; style flags come from the style). imagePrompts hold the architecture (brief photos, weight = --iw). A seed is fixed per prompt (made from the ingestKey when left out). lockedFrame = the take Michael picked, attached with --edit in frame mode. Journaled.", inputSchema: lockedSaveSchema.shape }, lockedCall("save"));
  server.registerTool("restyle_locked_prompts", { title: "Restyle Locked Prompts", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Redo locked prompts (by id, or every prompt of places) in one or more world styles: one MJ Queue thread (\"CASSANDRA · School · in CAS STORYBOOK\") with an item per prompt × style, composed from the locked words and seed plus each style's recipe (sref, profiles, moodboards, parameters, template). mode seed: same prompt and seed, a new generation with a similar composition (a new sref or profile still moves the picture). mode frame: the locked frame attached with --edit (V8.2 Edit model): same layout, new look; prompts without a locked frame fall back to seed with a warning. Repeating returns the same items. dryRun shows the commands. Michael sends every job himself, one per click; never submit, never loop (Midjourney pacing rules).", inputSchema: lockedRestyleSchema.shape }, lockedCall("restyle"));
  server.registerTool("file_restyle_results", { title: "File Restyle Results", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "After Michael sent restyle jobs and the frames are saved in the gallery: files each frame onto its place shelf, its style's shelf and the art-director Location takes shelf, adds it to the locked prompt's takes and links it to its sources (the locked frame, the brief images). Reports what is still waiting (not sent, or not saved yet). Never promotes to the director review.", inputSchema: lockedResultsSchema.shape }, lockedCall("results"));
  // Prompt sets × style presets × seeds: the comparison grid (references/prompt-grid.md).
  const gridCall = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/prompt-grid", { action, ...input }));
  server.registerTool("list_style_presets", { title: "List Style Presets", annotations: readAnnotations, description: "A world's style presets: each one exact recipe as frozen codes (moodboard and profile codes with names, srefs with --sv, parameters, opening sentence), status candidate/locked, its source (world style, dock, gallery) and, for a perturbation, its parent and what changed. Read references/prompt-grid.md.", inputSchema: presetListSchema.shape }, gridCall("presets"));
  server.registerTool("save_style_preset", { title: "Save Style Preset", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Create or change a style preset: one exact recipe. codes = moodboard and profile CODES as they are now (a code is frozen; a board id points at the latest board, so never store ids), srefs with their --sv version, parameters (stylize, chaos, raw, version; aspect and seed come from the prompt), an optional opening sentence. Every frame must map to exactly one recipe: a variation is a new preset (perturb_style_preset). Journaled.", inputSchema: presetSaveSchema.shape }, gridCall("save_preset"));
  server.registerTool("style_preset_from_style", { title: "Preset From World Style", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Make a preset from a world style's recipe, reading its moodboard and profile codes now (frozen) and its template's opening sentence. Locked when the style is ready.", inputSchema: presetFromStyleSchema.shape }, gridCall("preset_from_style"));
  server.registerTool("perturb_style_preset", { title: "Perturb Style Preset", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Named perturbations of a preset, each its own preset (\"CAS STORYBOOK · stylize 750\"): board_alone, sref_only, drop_profiles, add_profile <code>, stylize <n>, chaos <n>, raw on/off, sv <n>, version <n>. Research: ladder stylize 100/250/400/750 and raw on/off per painted family.", inputSchema: presetPerturbSchema.shape }, gridCall("perturb"));
  server.registerTool("style_preset_to_style", { title: "Preset To World Style", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: "Save a preset back as a world style: a new draft style named after it (default), or as another recipe on an existing style (only when it makes the same look: one style = one recipe).", inputSchema: presetToStyleSchema.shape }, gridCall("preset_to_style"));
  server.registerTool("list_prompt_sets", { title: "List Prompt Sets", annotations: readAnnotations, description: "A project's prompt sets (test shots, locations …) with their prompts in order, each prompt's variants (short, prose, style-neutral) and locked seeds.", inputSchema: setListSchema.shape }, gridCall("sets"));
  server.registerTool("save_prompt_set", { title: "Save Prompt Set", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Create or change a named prompt set of locked prompts (save_locked_prompt makes the prompts and their variants). Journaled.", inputSchema: setSaveSchema.shape }, gridCall("save_set"));
  server.registerTool("preview_prompt_run", { title: "Preview Prompt Run", annotations: readAnnotations, description: "Before queueing: how many jobs a run is (prompts × variants × seeds × presets), how many are screening, how long it takes at the account caps (30 jobs an hour, 150 a day, breaks every 20) and the first commands. Suggest two stages: screen (every preset × one variant, in Draft) then refine (the kept presets × all variants and perturbations).", inputSchema: runSchema.shape }, gridCall("preview"));
  server.registerTool("queue_prompt_run", { title: "Queue Prompt Run", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Queue a run as one MJ Queue thread, screening cells first, each item labelled with prompt, variant, seed and preset. Screen runs go in Draft (one job = 24 small images). Michael sends every job himself, one per click; never submit, never loop, never use permutations or --repeat. Show him the job count and time first (preview_prompt_run).", inputSchema: runSchema.shape }, gridCall("queue"));
  server.registerTool("get_prompt_run", { title: "Get Prompt Run Grid", annotations: readAnnotations, description: "A run as its grid: rows = presets, columns = prompts; per cell the queued and sent jobs, the frames that came back (variant, seed) and Michael's keep/drop on rows, cells and frames. Read his verdicts; never set them.", inputSchema: runRefSchema.shape }, gridCall("grid"));
  server.registerTool("file_run_results", { title: "File Run Results", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "After Michael sent a run's jobs and saved the frames: files each frame on the art-director Run results shelf (and its place shelf; a world style's shelf only when the preset is that style's own recipe unchanged), records its exact cell (prompt, variant, preset, seed) on the run and as a take of the prompt.", inputSchema: runRefSchema.shape }, gridCall("results"));
  // Director review: rounds of frames an outside director likes, dislikes and
  // comments on. Agents prepare the draft and answer; publishing is Michael's call.
  const reviewCall = (map: Record<string, string> = {}, extra: Record<string, JsonRecord> = {}) =>
    async ({ op, ...input }: JsonRecord) => {
      const name = String(op ?? "");
      return jsonText(await apiFetch("/api/agent/review", { action: map[name] ?? name, ...input, ...(extra[name] ?? {}) }));
    };
  const reviewRead = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/review", { action, ...input }));
  server.registerTool("review_open", { title: "Open Director Review", annotations: readAnnotations, description: "Start here for director review (the page at /review/<slug>, public at the project's publicUrl, e.g. CASSANDRA at mishabuloichyk.com/cassandra). Without project: every review project with its current and draft round and counts. With project: its title, world, address, reviewers (role, last visit), the style carousel (the label the director reads, the world style's name, line and recipes: moodboards with codes, profiles, parameters, template), the folders per section (locations, characters, scenes) with area, note, scenes and frame counts in the current and draft round, and every round (v0.1, v0.2 …: draft or published, which one is current). Read references/review.md.", inputSchema: reviewOpenSchema.shape }, reviewRead("open"));
  server.registerTool("review_items", { title: "List Review Frames", annotations: readAnnotations, description: "The frames of one round (default: the draft when there is one, else the current round), in the page's order: item id, asset:<id>, the code the director sees (CA-XXXXXX), folder, section, style label, caption and earlier takes. Filter by folder, section or style. With frame: also its making-of (prompt, model, source, Midjourney data, the style's recipe). preview_assets with the asset ids shows the pictures.", inputSchema: reviewItemsSchema.shape }, reviewRead("items"));
  server.registerTool("review_feedback", { title: "Read Director Feedback", annotations: readAnnotations, description: "What the director said: every like, dislike and comment, newest first, each with the frame's code, asset:<id>, folder, style label, who, role (director, viewer, owner = Michael, agent) and round; frames sums it per frame (who liked, who disliked, open comments); styles and styleVerdicts are likes and dislikes on whole styles (style label, who, role, round). onlyNew = only since Michael last marked it read on the page; since = the cursor your last call returned. With frame: that frame's whole thread. Feedback follows the frame (its asset) from round to round. Act on it, reply with review_comment saying what was done, resolve what is handled. Never vote, on frames or styles: likes and dislikes are the director's and Michael's.", inputSchema: reviewFeedbackSchema.shape }, reviewRead("feedback"));
  server.registerTool("review_setup", { title: "Set Up Director Review", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, description: "One op per call. project: create (a new slug) or change title, subtitle, world, publicUrl, reviewers (addReviewers / removeReviewers keep the rest; reviewers replaces the list), ownerEmails and the style carousel (styles: {style, label, hidden} in order; style by id, name or label, resolved in the project's world). folders: create (section + name; repeating a name updates it) or change folders (area, note, scenes, order, archived: true hides one). reorder_folders: order (folder slugs in their new order). delete_folder: only a folder with no frames in any round (gallery:delete); archive the others. invite: a private sign-in link (30 days) for a listed reviewer who has no Google account; give it to Michael, he sends it himself; never email or post it. Who may see the review and how it is labelled is Michael's call: change reviewers, the address or labels only on his word.", inputSchema: reviewSetupSchema.shape }, reviewCall({ folders: "folder" }));
  server.registerTool("review_promote", { title: "Promote Frames To Review", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: "Put up to 500 gallery frames into the draft round (started as a copy of the current round when there is none): into folder, or each into its suggested folder (named like one of its shelves) when folder is left out; in style, or else the review style whose shelf holds the frame; with an optional caption (note). A frame already in that folder of the draft is updated, never doubled; one frame may sit in two folders (a place and a person). The director sees nothing until review_round publishes the draft. dryRun: write nothing, report each frame's suggested folder and style and whether it is already in the current or draft round. Agent promotions are HELD by default (Held · only you: Michael sees them in the draft with a HELD mark, publishing leaves them out); pass held: false only when Michael said to send them.", inputSchema: reviewPromoteSchema.shape }, reviewRead("promote"));
  server.registerTool("review_organize", { title: "Organize Review Draft", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, description: "Change the draft round. move: another folder, style (null takes it off) or caption. remove: out of the draft (published rounds keep them; promote brings one back). reorder: the listed items first, in this order (order a folder as the page shows it). replace: swap one frame for its new take (with: asset:<id>); the old take stays as its earlier version and its likes and comments stay on the old asset. Items by item id, asset:<id> or CA-XXXXXX from review_items; an item of the current round acts on its copy in the draft, and a draft is started when there is none. inFolder picks the copy when a frame sits in two folders. move with held: true holds frames back (only Michael sees them, publishing leaves them out); held: false releases them into the round, only on Michael's word.", inputSchema: reviewOrganizeSchema.shape }, reviewCall());
  server.registerTool("review_round", { title: "Manage Review Rounds", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, description: "Rounds are versions v0.1, v0.2 …; older ones stay viewable as they were. draft: start the next round now (a copy of the current round, or of round). publish: the draft becomes the round the director sees (title and note tell him what changed). set_current: show another published round instead (a rollback, or forward again). discard_draft: throw the draft and its items away; published rounds are untouched (gallery:delete). publish, set_current and discard_draft change what the director sees or lose work: only on Michael's go in this session, with confirmed: true. Never publish the real project on your own judgement.", inputSchema: reviewRoundSchema.shape }, reviewCall());
  server.registerTool("review_comment", { title: "Reply In Director Review", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, description: "add: reply on frames (asset:<id> or CA-XXXXXX) as the studio agent; the director reads it under the frame marked Studio agent, so write plain words: what was done about his note and that a new take is in the next round. resolve / reopen: mark a comment handled or open again (commentId from review_feedback). delete: a comment, only your own reply or on Michael's word (gallery:delete). mark_seen: set Michael's read-up-to-now mark; only on his word, it clears his unread count.", inputSchema: reviewCommentSchema.shape }, reviewCall({ add: "comment", resolve: "resolve_comment", reopen: "resolve_comment", delete: "delete_comment" }, { resolve: { resolved: true }, reopen: { resolved: false } }));
  server.registerTool("compile_newspaper", { title: "Compile Newspaper", annotations: taskWrite, description: "Compile today's edition now (or a given date's), from the gallery's tables, without waiting for the 07:30 Prague cron. Recompiling a date replaces its facts and keeps its prose. Returns the edition as get_newspaper does.", inputSchema: newspaperCompileSchema.shape }, newspaper("compile"));

  server.registerTool("save_story", { description: "Save a private textual idea, script or world style lock as markdown. No image required. Stable ingestKey deduplicates retries. Resolve world/format and source asset IDs first; every linked asset must be named in the body as asset:<id> on the line about it. Refused: agent-ticket titles (GAL-…, use create_task), test saves, and [replaced]/[history] copies (revise with update_story instead). Returns the persisted record.", inputSchema: { ...storyInputSchema.shape, ingestKey: z.string().min(1), expectedRevision: z.number().int().nonnegative().optional(), session: sessionShape } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "save", ...input })));
  server.registerTool("list_stories", {
    title: "List Stories", annotations: readAnnotations,
    description: "Find private text ideas, scripts and style locks by keyword, world (or its collection), kind or status, newest first. Each row has story:<id> fields, title, kind, status, logline, hook, styleTag, tagNames, assetIds, revision, updatedAt, url, bodyChars and a 300-character excerpt; includeBody: true returns the full text instead (a world's scripts can run to hundreds of KB, so ask for it only when you will read it). Default limit 200, max 500; the result carries count, limit and truncated, and when truncated, next.updatedBefore to pass for the following page. get_story reads one record in full.",
    inputSchema: {
      search: z.string().optional(), world: worldFilterShape, folderId: z.string().optional(),
      kind: z.enum(["idea", "script", "style-lock"]).optional(), status: z.enum(["idea", "draft", "ready", "archived"]).optional(),
      includeBody: z.boolean().describe("true: full body on every row (large). Default false: excerpt plus bodyChars.").optional(),
      limit: z.number().int().min(1).max(500).describe("Rows per call (default 200, max 500).").optional(),
      updatedBefore: z.number().describe("Continue a truncated list: the next.updatedBefore of the previous result (only rows updated before it).").optional(),
    },
  }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "list", ...input })));
  server.registerTool("get_story", { description: "Read a full private text record, its world, style and asset links. Accepts story:<id> or bare ID.", inputSchema: { id: z.string() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "get", ...input })));
  server.registerTool("update_story", { description: "Revise a private story or style lock, preserving the previous text in history. Supply expectedRevision from get_story to prevent overwriting concurrent edits.", inputSchema: { ...storyPatchSchema.shape, id: z.string(), expectedRevision: z.number().int().positive(), session: sessionShape } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "update", ...input })));
  server.registerTool("package_style", {
    title: "Package Style",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Turn a found Midjourney recipe into a world style lock in one call: checks the example frames live in the world and reads their full prompts, matches each moodboard code to its gallery board (linked when it is in this world, cited when it lives in another world, flagged MOODBOARD NOT CREATED YET when no board has it), files the examples on the style shelf, and saves a kind style-lock Story with the recipe, a copy-ready prompt, the examples and what raises or lowers the look. Same ingestKey = same lock; changing it needs expectedRevision. dryRun returns the body and checks without writing. Never builds or edits a moodboard and never touches Midjourney. Read references/styles.md.",
    inputSchema: { ...stylePackageSchema.shape, session: sessionShape },
  }, async (raw) => {
    const input = stylePackageSchema.parse(raw);
    const opened = await apiFetch("/api/agent/worlds", { action: "open", world: input.world, journalLimit: 0 });
    const world = opened.world as { id: string; key: string; name: string } | undefined;
    if (!world) throw new Error(`No world matches "${input.world}". open_world with no arguments lists them.`);
    const shelves = (opened.shelves ?? []) as { id: string; name: string; group?: string }[];
    const worldFolderIds = new Set([world.id, ...shelves.map((shelf) => shelf.id)]);
    const shelf = input.shelf
      ? shelves.find((row) => row.id === input.shelf) ?? shelves.find((row) => row.name.toLowerCase() === input.shelf!.toLowerCase())
      : undefined;
    if (input.shelf && !shelf) throw new Error(`"${input.shelf}" is not a shelf of ${world.name}. Create it with world_shelf (group Styles) first.`);

    const examples: StyleExample[] = [];
    const outside: string[] = [];
    for (const ref of input.exampleAssetIds) {
      const id = ref.replace(/^asset:/, "");
      const read = await apiFetch("/api/agent/gallery", { action: "getById", id: `asset:${id}` });
      const asset = (read.asset ?? read) as { _id?: string; folderIds?: string[]; promptText?: string; agentDescription?: string; sourceUrl?: string; thumbUrl?: string };
      if (!asset._id) throw new Error(`asset:${id} was not found.`);
      if (!(asset.folderIds ?? []).some((folderId) => worldFolderIds.has(folderId))) outside.push(`asset:${id}`);
      examples.push({ id, prompt: asset.promptText, description: asset.agentDescription, sourceUrl: asset.sourceUrl, thumbUrl: asset.thumbUrl });
    }
    if (outside.length) throw new Error(`Examples must live in ${world.name}: ${outside.join(", ")} do not. File them with world_file first (move: true only when Michael said so).`);

    const codes = input.recipe.moodboardCodes;
    const boards = codes.length
      ? matchBoards(codes, ((await apiFetch("/api/agent/moodboards", { action: "list", includeArchived: true })).moodboards ?? []) as BoardRow[], worldFolderIds)
      : [];
    for (const match of boards) {
      if (match.state !== "other-world") continue;
      const read = await apiFetch("/api/agent/moodboards", { action: "get", moodboardId: match.board._id });
      match.worldName = (read.parentFolderName ?? read.folderName) as string | undefined;
    }

    const ingestKey = input.ingestKey ?? stylePackageIngestKey(world.key, input.name);
    const body = buildStyleLockBody({ input, worldName: world.name, worldKey: world.key, ingestKey, boards, examples, date: new Date().toISOString().slice(0, 10) });
    const title = input.title ?? `${world.name} · ${input.name} · Midjourney recipe`;
    const moodboards = boards.map((match) => match.state === "missing"
      ? { code: match.code, state: match.state, flag: MISSING_BOARD_FLAG }
      : { code: match.code, state: match.state, moodboardId: `moodboard:${match.board._id}`, name: match.board.name, url: match.board.url, ...(match.state === "other-world" ? { world: match.worldName } : {}) });
    const toFile = shelf && input.fileExamples !== false ? examples.map((example) => example.id) : [];
    const report = { world: world.key, ingestKey, title, styleTag: input.styleTag, shelf: shelf ? { id: shelf.id, name: shelf.name } : null, moodboards, examples: examples.map((example) => `asset:${example.id}`) };
    if (input.dryRun) return jsonText({ ok: true, dryRun: true, ...report, wouldFile: toFile.length, body });

    const filed = toFile.length
      ? await apiFetch("/api/agent/worlds", { action: "file", world: world.key, assetIds: toFile, addTo: [shelf!.id], note: `Examples of the style ${input.name}`, session: input.session })
      : null;
    let saved: JsonRecord;
    try {
      saved = await apiFetch("/api/agent/stories", {
        action: "save", ingestKey, title, body, kind: "style-lock", status: input.status ?? "draft", logline: input.logline,
        folderId: shelf?.id ?? world.id, styleTag: input.styleTag, tagNames: ["style-lock", input.styleTag],
        assetIds: examples.map((example) => example.id), expectedRevision: input.expectedRevision, session: input.session,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/revision|changed/i.test(message)) throw error;
      const locks = ((await apiFetch("/api/agent/stories", { action: "list", world: world.key, kind: "style-lock", limit: 500 })).stories ?? []) as { _id: string; ingestKey?: string; revision: number }[];
      const current = locks.find((lock) => lock.ingestKey === ingestKey);
      throw new Error(current ? `${message} The lock is story:${current._id} at revision ${current.revision}; pass expectedRevision: ${current.revision} to update it.` : message);
    }
    const story = (saved.story ?? {}) as { _id?: string; url?: string; title?: string; status?: string; revision?: number; folderId?: string; assetIds?: string[] };
    return jsonText({
      ok: true, ...report, filed, created: saved.created, revision: saved.revision,
      story: { id: story._id ? `story:${story._id}` : undefined, url: story.url, title: story.title, status: story.status, revision: story.revision, folderId: story.folderId, assetIds: story.assetIds },
    });
  });
  // Named styles of a world, read across its universe (world_styles page).
  const styles = (action: string) => async (input: JsonRecord) => jsonText(await apiFetch("/api/agent/styles", { action, ...input }));
  const styleWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("list_styles", {
    title: "List Styles",
    annotations: readAnnotations,
    description: "The named styles of a world's universe (DEAR ANNETE with its 3D, Art Deco and Iron Stage worlds): each style's name, one-line look, family, status, world, frame count, main recipe in names (moodboards + profiles), cover thumbnails and its page (url). unrecordedShelves lists shelves in the group Styles that have no style record yet. A style is how a frame is made (medium, rendering, light, palette), never a place or motif. Read references/styles.md.",
    inputSchema: styleListSchema.shape,
  }, styles("list"));
  server.registerTool("get_style", {
    title: "Get Style",
    annotations: readAnnotations,
    description: "One style in full: its line, covers, shelf, every recipe (moodboards with code, sync status and the world they live in; profiles with code and role; unnamed codes; parameters; prompt template; frames made), raises, lowers, notes, the style lock story, merges and revision. frames: N adds the newest N frames with prompt excerpts. style:<id>, or the name with world.",
    inputSchema: styleGetSchema.shape,
  }, styles("get"));
  server.registerTool("save_style", {
    title: "Save Style",
    annotations: styleWrite,
    description: "Create a style in a world or change one: name (a rename follows onto its shelf), line, family, status (ready only on Michael's word), shelf (create: the same-named shelf or a new one in the group Styles; adopt an existing Styles shelf by naming it), covers (coverAssetIds replaces, addCoverAssetIds puts first), recipes (moodboards and profiles by id in stack order, unknown codes, parameters, template, frames), raises, lowers, lock story, notes, sortOrder. Pass expectedRevision from get_style when changing. Journaled; world_undo reverts it. Never publishes, stars or deletes.",
    inputSchema: styleSaveSchema.shape,
  }, styles("save"));
  server.registerTool("file_style", {
    title: "File Into Style",
    annotations: styleWrite,
    description: "Put frames into a style (onto its shelf), or take them off with remove: true. Any number of assets, filed 100 per journaled world_file change. covers: true also makes them the first covers. Frames must belong to the style's world; move: true takes them out of another world (only on Michael's word). Use find_assets first to turn Midjourney job ids or file names into asset ids.",
    inputSchema: styleFileSchema.shape,
  }, styles("file"));
  server.registerTool("merge_styles", {
    title: "Merge Styles",
    annotations: { ...styleWrite, idempotentHint: false },
    description: "Fold one style into another: its frames move onto the kept style's shelf, its recipes, covers, raises and lowers join, and it stays as a merged record pointing at the kept style; its empty shelf moves to the group Merged (nothing is deleted). Across two worlds of one universe only with move: true. Run dryRun: true first. Journaled; world_undo with the session reverts it all.",
    inputSchema: styleMergeSchema.shape,
  }, styles("merge"));
  server.registerTool("world_universe", {
    title: "World Universe",
    annotations: worldWrite,
    description: "Put a world into another world's universe (DEAR ANNETE — 3D joins dear-annete) so one styles page and list_styles show every style of the story universe together; null takes it out. Membership, filing and moodboards stay per world. One level: a universe's own world joins nothing. Journaled.",
    inputSchema: styleUniverseSchema.shape,
  }, styles("universe"));
  server.registerTool("find_assets", {
    title: "Find Assets",
    annotations: readAnnotations,
    description: "Is this frame in the gallery? Up to 500 references per call, any mix: Midjourney job URLs or CDN URLs, file names (mj-<job>-<i>.png), a local board's short id (<first 8 of job>-<tile>), a bare job id (every tile), asset:<id>, other source URLs, ingestKeys. Each comes back found or not, with the matching asset ids, tile, worlds and styles it is in and a thumbnail. check_sources stays for exact post permalinks.",
    inputSchema: assetLookupSchema.shape,
  }, styles("lookup"));

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
      description: "Delete a prompt or asset for the authenticated user, for good. Only on Michael's explicit request for the named items. Every asset delete is journaled (world journal op assets.delete) with this token's label and the session.",
      inputSchema: {
        target: z.enum(["prompt", "asset"]),
        id: z.string().optional(),
        ingestKey: z.string().optional(),
        session: z.string().max(80).optional().describe("Journal session label of the work."),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/ingest/delete", input)),
  );

  server.registerTool(
    "list_assets",
    {
      title: "List Assets",
      annotations: readAnnotations,
      description: "List the authenticated user's gallery assets, newest first (bounded; list_assets_page for a complete traversal). Rows carry asset ids, kind, size, url and thumbUrl, caption, agentDescription, tagNames, folderIds, model, flags and a 300-character promptText excerpt (promptTruncated, promptChars when cut); get_gallery_item has the full prompt and record.",
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
        "Find pieces in the user's gallery that answer a request, checked one by one. Candidates are ranked by what they look like and what they are about, then a decision model looks at each picture with its description and keeps only the pieces that are a good result for the whole request (independent judges: 91% of returned pieces right, none wrong). " +
        "Write `query` as the full request in plain words, conditions included (\"city street at night with no cars\"). For a request with more than one condition, also pass `mustShow`: one short statement per thing every result must show (\"a castle is a main subject\", \"the castle stands on a hill\"); each is checked on its own. " +
        "`summary` says what happened: mode verified (checked), ranked (unchecked nearest pieces) or keyword (search by meaning unavailable); how many candidates were checked, matched and near, how many were not checked, and any note. `matched` below `limit` with `unchecked` above zero means more may exist: call again with `exhaustive: true` to check every candidate. `includeNear: true` adds pieces that show the main subject with a detail doubtful, after the matches (each result carries `tier`). " +
        "Narrow with tag / piece-type / medium / liked / starred / collection / world filters before the check. `verify: false` returns the nearest pieces unchecked, faster. A first search takes a few seconds; the same request again answers from kept checks.",
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
        mustShow: z
          .array(z.string())
          .max(5)
          .describe("What every result must show, one short statement each; each is checked on its own.")
          .optional(),
        limit: z.number().optional(),
        exhaustive: z.boolean().describe("Check every candidate, not just until `limit` pieces match.").optional(),
        includeNear: z.boolean().describe("Also return near pieces (main subject there, a detail doubtful), after the matches.").optional(),
        verify: z.boolean().describe("false = nearest pieces, unchecked (faster).").optional(),
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
      description: "Read one gallery asset in full (record, prompt, characters, comments) by asset:<id>; also reads skill:<id> (a Skill, as get_skill does) and pack:<id> (a legacy asset pack or duplicates stack). Other objects have their own read tool and argument: moodboard:<id> get_moodboard {moodboardId}, story:<id> get_story {id}, character get_character {character: DA-CH-001}, stack:<id> list_inbox_decisions {stackId}, task:<id> get_task {taskId}, video:<id> get_video_ref {id}; a world or collection id is bare and goes to open_world / list_collections. The typed-ID table is in references/data-model.md. design:<id> is read-only legacy.",
      inputSchema: {
        id: z.string().describe("asset:<id>, skill:<id> or pack:<id>. A bare id is refused: add the prefix (a bare gallery id is almost always asset:<id>)."),
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
      description: "The tag vocabulary, most used first, filtered and paged. Always narrow it: search (substring of the name or label), category (style, environment, lighting, content_type …) or minUsage; the whole vocabulary is about a thousand tags and never the answer. Rows are slim by default (name, label when it differs, category, description, usageCount, customized, archived); fields: 'full' adds ids, colour, sort order and times. Default 100 rows, max 500; follow cursor until isDone. Before inventing a tag read the world's docs/tags.md (open_world) and remember that saves fold case, '-', '_' and punctuation into one tag and add_tag_aliases redirects spellings.",
      inputSchema: {
        search: z.string().max(80).describe("Substring of the tag name or label, case-insensitive (a prefix works too).").optional(),
        category: z.string().max(40).describe("Only this category, e.g. style, environment, lighting, content_type, custom.").optional(),
        minUsage: z.number().int().min(0).describe("Only tags on at least this many assets.").optional(),
        limit: z.number().int().min(1).max(500).describe("Rows per page (default 100, max 500).").optional(),
        cursor: z.string().nullable().describe("From the previous page; omit for the first page.").optional(),
        fields: z.enum(["slim", "full"]).describe("slim (default) or full rows.").optional(),
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
        "The owner's collections (folders): one level deep, worlds are marked roots. Narrow it: world (key, name or root id: that world's root and shelves, the same list open_world gives), parentFolderId (one root's children), rootsOnly, kind or search; with no filter it is the whole vault (about 220 rows). Each row: _id (the folderId every save and filing tool takes, bare), name, parentFolderId, group and sortOrder (display order inside a world), kind (storybook or plain), worldKey and isWorld, memberCount, description (excerpt), slug, hidden, url. The result carries count and total.",
      inputSchema: {
        world: worldFilterShape,
        parentFolderId: z.string().describe("Only the children of this root collection.").optional(),
        rootsOnly: z.boolean().describe("Only root collections (worlds and shared shelves).").optional(),
        kind: z.enum(["storybook", "plain"]).describe("Only storybooks, or only plain collections.").optional(),
        search: z.string().max(80).describe("Words that must all appear in the name, description, world key or slug.").optional(),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/customize", {
          action: "listFolders",
          ...input,
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
