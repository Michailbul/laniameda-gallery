#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

const API_URL =
  process.env.LANIAMEDA_GALLERY_API_URL?.replace(/\/+$/, "") ??
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
  "http://localhost:3317";

const AGENT_TOKEN = process.env.LANIAMEDA_GALLERY_AGENT_TOKEN?.trim();

try {
  const parsedApiUrl = new URL(API_URL);
  if (!["http:", "https:"].includes(parsedApiUrl.protocol)) {
    throw new Error("LANIAMEDA_GALLERY_API_URL must use http or https.");
  }
} catch (error) {
  throw new Error(
    error instanceof Error
      ? `Invalid LANIAMEDA_GALLERY_API_URL: ${error.message}`
      : "Invalid LANIAMEDA_GALLERY_API_URL.",
  );
}

if (!AGENT_TOKEN) {
  throw new Error(
    "LANIAMEDA_GALLERY_AGENT_TOKEN is required. Create one from /agents in the gallery app.",
  );
}

const guessMime = (fileName: string) => {
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

const readFilePayload = (input: {
  filePath?: string;
  fileBase64?: string;
  fileName?: string;
  contentType?: string;
}) => {
  if (input.filePath) {
    if (!existsSync(input.filePath)) {
      throw new Error(`File not found: ${input.filePath}`);
    }
    const fileName = input.fileName ?? basename(input.filePath);
    return {
      base64: readFileSync(input.filePath).toString("base64"),
      fileName,
      contentType: input.contentType ?? guessMime(fileName),
    };
  }

  if (input.fileBase64) {
    return {
      base64: input.fileBase64,
      fileName: input.fileName ?? "upload.bin",
      contentType: input.contentType ?? "application/octet-stream",
    };
  }

  return undefined;
};

const apiFetch = async (path: string, body: JsonRecord) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let responseBody: JsonRecord;
  try {
    responseBody = responseText
      ? (JSON.parse(responseText) as JsonRecord)
      : { error: response.statusText };
  } catch {
    responseBody = { error: responseText || response.statusText };
  }

  if (!response.ok) {
    throw new Error(
      typeof responseBody.error === "string"
        ? responseBody.error
        : `Request failed with HTTP ${response.status}`,
    );
  }

  return responseBody;
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
  url: z.string().optional(),
  filePath: z.string().optional(),
  fileBase64: z.string().optional(),
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

const buildIngestBody = (input: JsonRecord) => {
  const { filePath, fileBase64, fileName, contentType, ...rest } = input;
  const file = readFilePayload({
    filePath: typeof filePath === "string" ? filePath : undefined,
    fileBase64: typeof fileBase64 === "string" ? fileBase64 : undefined,
    fileName: typeof fileName === "string" ? fileName : undefined,
    contentType: typeof contentType === "string" ? contentType : undefined,
  });

  return {
    ...rest,
    ...(file ? { file } : {}),
  };
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

const server = new McpServer({
  name: "laniameda-gallery",
  version: "0.1.0",
});

server.registerTool(
  "check_connection",
  {
    title: "Check Connection",
    description: "Verify the local MCP server can authenticate with the gallery app API.",
    inputSchema: {},
  },
  async () => {
    const result = await apiFetch("/api/agent/customize", {
      action: "listFolders",
    });
    const collections = Array.isArray(result.folders) ? result.folders : [];
    return jsonText({
      ok: true,
      apiUrl: API_URL,
      authenticated: true,
      collectionCount: collections.length,
    });
  },
);

server.registerTool(
  "save_asset",
  {
    title: "Save Asset",
    description: "Save an image/video URL or local file to the authenticated user's gallery.",
    inputSchema: commonIngestShape,
  },
  async (input) => jsonText(await apiFetch("/api/agent/ingest", buildIngestBody(input))),
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
      filePath: z.string().optional(),
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

await server.connect(new StdioServerTransport());
