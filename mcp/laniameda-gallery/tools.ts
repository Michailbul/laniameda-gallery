import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
  "Collections (folders) are one level deep; resolve names with list_collections before filing.",
  "What a piece IS is a tag: character, location, scene or inspiration. The animation tag marks animated work; no tag means live action.",
  "Every saved asset should carry sourceUrl when it came from the web, and an agentDescription: one or two plain sentences (max ~45 words) on what it shows and why it was kept.",
  "Reuse existing tags (list_tags) before inventing new ones. Never star or publish anything unless asked. Ask before deleting.",
  "To see pieces rather than read URLs, use preview_assets; then get_gallery_item for the full record and prompt.",
  "YouTube videos kept as research (competitors, formats, animation styles) are video references, not assets: list_video_refs to read them, save_video_refs to add them.",
  "To add local files (e.g. from ~/Downloads): prepare_uploads with the paths, run the curl commands it returns, then save_assets with the uploadIds. Two tool calls for any batch size; public URLs go straight into save_assets.",
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
  // Updates still send base64: the update action only takes inline files.
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
          .array(z.string())
          .describe("The local paths you will upload; each gets a ready curl command.")
          .optional(),
        count: z.number().describe("How many slots, when you don't pass fileNames (1-50).").optional(),
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
          .describe("One entry per piece, max 50."),
      },
    },
    async (input) =>
      jsonText(
        await apiFetch("/api/agent/ingest/batch", {
          items: await Promise.all(input.items.map((item) => buildCreateBody(item as JsonRecord))),
        }),
      ),
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
      description:
        "Delete a collection (folder) and clear it from linked gallery records. The assets themselves are kept.",
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
      description:
        "Find saved skills by meaning (semantic search over title, description, tags, models, step labels and the markdown body). Use when the user asks how they did something, or for a recipe/workflow/technique.",
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
      description:
        "List saved skills, newest first, optionally narrowed by tags (all must match), collection or keywords.",
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
    topic: z.string().describe("Subject area, e.g. cars, history, success-stories.").optional(),
    styleFamily: z.string().describe("Plain-words name of the look, e.g. 'map animation'.").optional(),
    styleDescription: z
      .string()
      .describe("What the picture is made of: materials, colour, type, how things move.")
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
      .describe("Override, up to 6 https image URLs; YouTube's three auto-captured frames are copied by default.")
      .optional(),
  };

  server.registerTool(
    "list_video_refs",
    {
      title: "List Video References",
      description:
        "List saved YouTube video references with their style notes, stats, thumbnail and in-video frame URLs. Sorted by most views unless sort says otherwise. Use for 'what competitors do', 'find a video in this style', 'what performs in cars'.",
      inputSchema: {
        collection: z.string().describe("e.g. youtube-cars-competitors").optional(),
        topic: z.string().optional(),
        styleFamily: z.string().optional(),
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

  server.registerTool(
    "get_video_ref",
    {
      title: "Get Video Reference",
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
        "Save up to 12 YouTube videos as references. The gallery copies each video's thumbnail and three in-video frames by itself; send the link, the title, the stats and the style notes. Saving the same video again updates it and merges collections.",
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
      description: "Set the owner's note, the like, or the collections of a video reference.",
      inputSchema: {
        id: z.string(),
        userNote: z.string().optional(),
        isLiked: z.boolean().optional(),
        collections: z.array(z.string()).describe("Replaces the whole set.").optional(),
      },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "update", ...input })),
  );

  server.registerTool(
    "delete_video_ref",
    {
      title: "Delete Video Reference",
      description: "Remove one video reference. Ask before deleting.",
      inputSchema: { id: z.string() },
    },
    async (input) => jsonText(await apiFetch("/api/agent/video-refs", { action: "delete", id: input.id })),
  );
}
