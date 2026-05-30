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
  pillar: z.string().optional(),
  promptText: z.string().optional(),
  allowPromptOnly: z.boolean().optional(),
  tagNames: z.array(z.string()).optional(),
  folderId: z.string().optional(),
  ingestKey: z.string().optional(),
  promptIngestKey: z.string().optional(),
  url: z.string().optional(),
  filePath: z.string().optional(),
  fileBase64: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  description: z.string().optional(),
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
      action: "listPillars",
    });
    const pillars = Array.isArray(result.pillars) ? result.pillars : [];
    return jsonText({
      ok: true,
      apiUrl: API_URL,
      authenticated: true,
      pillarCount: pillars.length,
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
      pillar: z.string().optional(),
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
      pillar: z.union([z.string(), z.null()]).optional(),
      modelName: z.union([z.string(), z.null()]).optional(),
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
      pillar: z.string().optional(),
      kind: z.enum(["image", "video"]).optional(),
      folderId: z.string().optional(),
      modelName: z.string().optional(),
      assetRole: z.string().optional(),
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
    description: "Semantic search over the authenticated user's gallery assets.",
    inputSchema: {
      query: z.string(),
      pillar: z.string().optional(),
      kind: z.enum(["image", "video"]).optional(),
      folderId: z.string().optional(),
      modelName: z.string().optional(),
      assetRole: z.string().optional(),
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
  "get_gallery_item",
  {
    title: "Get Gallery Item",
    description: "Read a gallery asset or asset pack by typed ID, such as asset:<id> or pack:<id>.",
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
  "list_pillars",
  {
    title: "List Pillars",
    description: "List available pillars/boards for the authenticated user.",
    inputSchema: {
      includeArchived: z.boolean().optional(),
    },
  },
  async (input) =>
    jsonText(
      await apiFetch("/api/agent/customize", {
        action: "listPillars",
        ...input,
      }),
    ),
);

server.registerTool(
  "upsert_pillar",
  {
    title: "Create Or Update Pillar",
    description: "Create or update a custom pillar/board for the authenticated user's page.",
    inputSchema: {
      label: z.string(),
      key: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      sortOrder: z.number().optional(),
    },
  },
  async (input) =>
    jsonText(
      await apiFetch("/api/agent/customize", {
        action: "upsertPillar",
        ...input,
      }),
    ),
);

server.registerTool(
  "archive_pillar",
  {
    title: "Archive Pillar",
    description: "Archive a custom pillar/board for the authenticated user. Default pillars cannot be archived.",
    inputSchema: {
      key: z.string(),
    },
  },
  async (input) =>
    jsonText(
      await apiFetch("/api/agent/customize", {
        action: "archivePillar",
        ...input,
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
      pillar: z.string().optional(),
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
            pillar: z.string().optional(),
            source: z.enum(["user", "agent", "system"]).optional(),
            color: z.string().optional(),
            sortOrder: z.number().optional(),
          }),
        )
        .optional(),
      category: z.string().optional(),
      pillar: z.string().optional(),
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
  "list_folders",
  {
    title: "List Folders",
    description: "List folders for the authenticated user.",
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
  "create_folder",
  {
    title: "Create Folder",
    description: "Create or reuse an owner-scoped folder for the authenticated user.",
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
  "update_folder",
  {
    title: "Update Folder",
    description: "Rename or update an owner-scoped folder for the authenticated user.",
    inputSchema: {
      folderId: z.string(),
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
  "delete_folder",
  {
    title: "Delete Folder",
    description: "Delete an owner-scoped folder and clear it from linked gallery records.",
    inputSchema: {
      folderId: z.string(),
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

await server.connect(new StdioServerTransport());
