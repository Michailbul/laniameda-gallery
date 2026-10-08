import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { storyInputSchema, storyPatchSchema, presetFiltersSchema } from "../../lib/story-contract";
import { createSkillInputSchema } from "../../lib/skill-contract";
import { galleryAssetPageInputSchema } from "../../lib/gallery-pagination";

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
  "Fetch the current canonical skill from https://gallery.laniameda.space/llms.txt (entry: /skills/laniameda-gallery/SKILL.md; manifest.json lists its version and resources). Private world and maintenance references require the same owner-allowed gallery:read bearer token as MCP.",
  "Textual story ideas, scripts and versioned world style locks are private story records: save_story needs text and a stable ingestKey, never placeholder media. list_stories and get_story retrieve them; update_story preserves revisions. Gallery filter presets have list_filter_presets and save_filter_preset.",
  "Collections (folders) are one level deep; resolve names with list_collections before filing.",
  "What a piece IS is a tag: character, location, scene or inspiration. The animation tag marks animated work; no tag means live action.",
  "Every saved asset should carry sourceUrl when it came from the web, and an agentDescription: one or two plain sentences (max ~45 words) on what it shows and why it was kept.",
  "Reuse existing tags (list_tags) before inventing new ones. Never star or publish anything unless asked. Ask before deleting.",
  "To see pieces rather than read URLs, use preview_assets; then get_gallery_item for the full record and prompt.",
  "YouTube videos kept as research (competitors, formats, animation styles) are video references, not assets: list_video_refs to read them, save_video_refs to add them.",
  "A post on X is saved as a bookmark with save_bookmarks: send the link, the gallery reads the author, text, media and counts itself, and links any piece already saved from that post. list_bookmarks reads saved posts as text; the tag `bookmark` narrows list_assets and search_gallery to them.",
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
  server.registerTool("get_gallery_contract", {
    description: "Discover the deployed scoped agent contract, paging guarantees, resources and client script. Read this before a complete inventory or code-driven workflow.",
    inputSchema: {}, annotations: readAnnotations,
  }, async () => jsonText({
    contractVersion: "2026-10-08.2", serverVersion: "0.3.0", apiUrl, clientResource: "scripts/gallery-client.mjs",
    transport: "Local JavaScript composes authenticated MCP tools; HTTP accepts the same scoped bearer token. Backend functions define resource access; raw SQL and arbitrary server code execution are unavailable.",
    scopes: { read: "gallery:read", writes: "gallery:write", deletion: "gallery:delete", deletionApproval: "Delete scope grants technical access only. Obtain explicit user approval for the named collection/preset or listed batch before deletion. Existing approval for those targets in the current session persists.", identity: "Owner comes from the authenticated token; caller-supplied owners are rejected for cursor listings." },
    pagination: { tool: "list_assets_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc", includeWorkflowAssets: { default: true, false: "omits Skill-step assets unless explicitly requested by assetRole" }, hiddenCollections: "included", folderScope: "folderId alone selects direct members; includeDescendants:true adds its immediate owned children. No folderId covers all owned assets.", consistency: "Live records; no snapshot isolation. Restart after changing filters; client deduplicates IDs." },
    videoReferencePagination: { tool: "list_video_refs_page", pageSize: { min: 1, max: 200, default: 100 }, completion: "isDone=true, never an empty page", order: "owner-candidate-createdAt-desc", sorting: "Sort the completed inventory locally; convenience list_video_refs defaults to views." },
    limits: { saveAssets: 50, prepareUploads: 50, saveBookmarks: 12, saveVideoRefs: 12, listAssets: "bounded convenience results; use list_assets_page for complete traversal", listSkills: 200, listStories: 500, listBookmarks: 500, listVideoRefs: 2000, sdkCalls: "default 1000 configurable calls; exceeding any traversal budget throws incomplete" },
    resources: ["assets", "collections", "menuFilters", "skills", "stories", "presets", "bookmarks", "videoRefs"],
    policy: { source: "get_skill_instructions or authenticated canonical /skills/laniameda-gallery/ manifest resources", privateWorldRules: "references/worlds.md", sourceOfTruth: "Deployed schemas and scoped backend functions; instructions explain filing policy. Collections and menu filters are distinct from raw tags." },
  }));

  server.registerTool("list_assets_page", {
    description: "Cursor page of owned assets with complete traversal, including hidden collections and Skill-step assets by default. Keep the same filters and follow cursor until isDone, even through empty filtered pages. Search includes captions, agent descriptions, prompts, tags and bookmark text. Results are stable within owner spellings, newest-first; records are live, not a frozen snapshot.",
    annotations: readAnnotations,
    inputSchema: galleryAssetPageInputSchema.shape,
  }, async input => jsonText(await apiFetch("/api/agent/gallery", { action: "listAssetsPage", ...input })));

  server.registerTool("list_menu_filters", { description: "Read curated menu-filter IDs, labels, mappings, resolved tag IDs, counts and missing-folder flags. These IDs are used by filter presets; tag IDs are a different resource.", inputSchema: {}, annotations: readAnnotations }, async () => jsonText(await apiFetch("/api/agent/customize", { action: "listMenuFilters" })));
  server.registerTool("set_collection_option", {
    description: "Set one owned collection's cover, pin, hidden-grid flag, showcase or featured-world hero. Showcase/featured change public collection presentation and require the user's publication instruction; private members remain private. A cover must already be a member.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { folderId: z.string(), option: z.enum(["cover", "pinned", "hidden", "showcased", "featured"]), enabled: z.boolean().optional(), assetId: z.string().nullable().optional() },
  }, async input => jsonText(await apiFetch("/api/agent/customize", { action: "setCollectionOption", ...input })));
  server.registerTool("create_skill", { description: "Create or reuse a private reusable Gallery Skill using a stable ingestKey, editable markdown/instructions and optional ordered prompt/media steps. Separate from text Stories and from gallery agent instructions. Readback is returned; no publication flag is accepted.", inputSchema: createSkillInputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async input => jsonText(await apiFetch("/api/agent/skills", { action: "create", ...input })));
  server.registerTool("delete_skill", { description: "Delete an owned reusable Gallery Skill recipe and its collection links after the user authorizes deletion. Preserves source prompts/media; formerly hidden step media becomes visible in the gallery. Requires gallery:delete.", inputSchema: { id: z.string().min(1).describe("skill:<id>, workflow:<id> or raw workflow ID.") }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async input => jsonText(await apiFetch("/api/agent/skills", { action: "delete", ...input })));
  server.registerTool("set_video_poster", { description: "Replace only an owned video's card poster using posterUploadId from prepare_uploads. Main video bytes and metadata are retained. Upload a JPEG/PNG poster first.", inputSchema: { assetId: z.string(), posterUploadId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => jsonText(await apiFetch("/api/agent/poster", input)));

  server.registerTool("get_skill_instructions", {
    title: "Read Gallery Instructions",
    description: "Read the canonical gallery agent skill or one of its references using this connection's existing authentication. This is distinct from reusable gallery Skills. Start with SKILL.md; before touching a world, fetch references/worlds.md. Private world/maintenance resources are restricted to Michael's owner identity. No token copying or local file access is needed.",
    inputSchema: { resource: z.string().min(1).max(160).describe("Allowlisted skill-relative path: SKILL.md (default), manifest.json, references/worlds.md, references/video-refs.md, or another reference listed by the manifest.").optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => jsonText(await apiFetch("/api/agent/instructions", input)));

  server.registerTool("save_story", { description: "Save a private textual idea, script or world style lock. No image required. Stable ingestKey deduplicates retries. Resolve world/format and source asset IDs first. Returns the persisted record.", inputSchema: { ...storyInputSchema.shape, ingestKey: z.string().min(1), expectedRevision: z.number().int().nonnegative().optional() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "save", ...input })));
  server.registerTool("list_stories", { description: "Find private text ideas, scripts and style locks by keyword, world/format collection, kind or status. Up to 500 records; full text included.", inputSchema: { search: z.string().optional(), folderId: z.string().optional(), kind: z.enum(["idea", "script", "style-lock"]).optional(), status: z.enum(["idea", "draft", "ready", "archived"]).optional(), limit: z.number().int().min(1).max(500).optional() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "list", ...input })));
  server.registerTool("get_story", { description: "Read a full private text record, its world, style and asset links. Accepts story:<id> or bare ID.", inputSchema: { id: z.string() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "get", ...input })));
  server.registerTool("update_story", { description: "Revise a private story or style lock, preserving the previous text in history. Supply expectedRevision from get_story to prevent overwriting concurrent edits.", inputSchema: { ...storyPatchSchema.shape, id: z.string(), expectedRevision: z.number().int().positive() } }, async (input) => jsonText(await apiFetch("/api/agent/stories", { action: "update", ...input })));
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
        folderIds: z.array(z.string()).optional(),
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
        "List the authenticated user's collections. Collections are owner-scoped folders used to organize saved assets and prompts.",
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
      description: "Rename or update a collection (folder) for the authenticated user.",
      inputSchema: {
        folderId: z.string().describe("The collection id to update — the raw folderId from list_collections/create_collection."),
        name: z.string(),
        description: z.string().optional(),
        parentFolderId: z.string().nullable().describe("Owned root parent; null moves a child to root. Omission preserves parentage.").optional(),
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
        "Delete an owned collection shell only after explicit user approval for that named collection or listed batch. Approval already given for those targets in this session persists. Requires gallery:delete; the scope alone does not approve deletion. Clears its asset/prompt/Skill membership, keeps media and linked story text, and promotes child collections to root. Story links may require repair; the collection's route disappears.",
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
  // prompt steps with their media). Ids read skill:<id> or workflow:<id>.
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
        id: z.string().describe("skill:<id>, workflow:<id> or the bare id."),
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
