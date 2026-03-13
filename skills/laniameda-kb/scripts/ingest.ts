#!/usr/bin/env bun

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

type Pillar = "creators" | "cars" | "designs" | "dump";
type GenerationType = "image_gen" | "video_gen" | "ui_design" | "workflow" | "other";
type PromptType =
  | "image_gen"
  | "video_gen"
  | "ui_design"
  | "cinematic"
  | "ugc_ad"
  | "workflow"
  | "component_prompt"
  | "page_prompt"
  | "other";
type WorkflowType =
  | "component_prompt"
  | "page_prompt"
  | "system_prompt"
  | "asset_recipe"
  | "other";
type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "meta"
  | "flux"
  | "midjourney"
  | "runway"
  | "other";
type AssetRole =
  | "generated_output"
  | "reference"
  | "inspiration_capture"
  | "workflow_asset"
  | "other";
type IngestSource = "api" | "agent" | "telegram" | "manual" | "import";
type DesignInspirationType =
  | "website"
  | "landing_page"
  | "dashboard"
  | "component"
  | "mobile_app"
  | "motion"
  | "branding"
  | "asset_pack"
  | "other";
type DesignPlatform = "web" | "ios" | "android" | "cross_platform" | "other";

type TypedTagInput = {
  name: string;
  category?: string;
  pillar?: Pillar;
  source?: "user" | "agent" | "system";
};

type PromptSectionsInput = {
  finalPrompt: string;
  negativePrompt?: string;
  generationNotes?: string;
};

type DesignInspirationInput = {
  title?: string;
  summary?: string;
  sourceUrl?: string;
  inspirationType: DesignInspirationType;
  platform?: DesignPlatform;
  workflowType?: WorkflowType;
  ingestKey?: string;
};

type PromptProfileInput = Record<string, unknown>;

type IngestItem = {
  promptText?: string;
  tagNames?: string[];
  typedTags?: TypedTagInput[];
  folderId?: string;
  ingestKey?: string;
  promptIngestKey?: string;
  filePath?: string;
  imagePath?: string;
  fileBase64?: string;
  imageBase64?: string;
  url?: string;
  imageUrl?: string;
  fileName?: string;
  contentType?: string;
  pillar?: Pillar;
  modelName?: string;
  modelProvider?: ModelProvider;
  generationType?: GenerationType;
  promptType?: PromptType;
  workflowType?: WorkflowType;
  promptSections?: PromptSectionsInput;
  promptProfile?: PromptProfileInput;
  assetRole?: AssetRole;
  ingestSource?: IngestSource;
  designInspiration?: DesignInspirationInput;
  domain?: string;
};

type IngestActionResult = {
  assetId?: string;
  promptId?: string;
  designInspirationId?: string;
};

type IngestResult = IngestActionResult & {
  error?: string;
  input?: string;
};

function guessMime(fileName: string): string {
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
}

function resolveConvexUrl(): string {
  const value = (process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "").trim();
  if (!value) {
    throw new Error("CONVEX_URL is required.");
  }
  return value.replace(/\/+$/, "");
}

function resolveOwnerUserId(): string {
  const value = (process.env.KB_OWNER_USER_ID ?? "").trim();
  if (!value) {
    throw new Error("KB_OWNER_USER_ID is required.");
  }
  return value;
}

function stableIngestKey(item: IngestItem): string {
  const source = [
    item.promptText ?? "",
    item.promptSections?.finalPrompt ?? "",
    item.url ?? item.imageUrl ?? "",
    item.filePath ?? item.imagePath ?? "",
    item.designInspiration?.title ?? "",
    item.designInspiration?.sourceUrl ?? "",
  ].join("|");

  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}

function buildArgs(item: IngestItem, ownerUserId: string): Record<string, unknown> {
  const args: Record<string, unknown> = {
    ownerUserId,
    ingestSource: item.ingestSource ?? "agent",
  };

  const filePath = item.filePath ?? item.imagePath;
  const fileBase64 = item.fileBase64 ?? item.imageBase64;
  const url = item.url ?? item.imageUrl;
  const pillar = item.pillar ?? (item.designInspiration ? "designs" : undefined);

  if (item.promptText) args.promptText = item.promptText.trim();
  if (item.tagNames?.length) args.tagNames = item.tagNames;
  if (item.typedTags?.length) args.typedTags = item.typedTags;
  if (item.folderId) args.folderId = item.folderId;
  if (item.promptIngestKey) args.promptIngestKey = item.promptIngestKey;
  if (item.modelName) args.modelName = item.modelName;
  if (item.modelProvider) args.modelProvider = item.modelProvider;
  if (pillar) args.pillar = pillar;
  if (item.generationType) args.generationType = item.generationType;
  if (item.promptType) args.promptType = item.promptType;
  if (item.workflowType) args.workflowType = item.workflowType;
  if (item.promptSections) args.promptSections = item.promptSections;
  if (item.promptProfile) args.promptProfile = item.promptProfile;
  if (item.assetRole) args.assetRole = item.assetRole;
  if (item.domain) args.domain = item.domain;
  if (item.designInspiration) args.designInspiration = item.designInspiration;

  args.ingestKey = item.ingestKey ?? stableIngestKey(item);

  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const fileBuffer = readFileSync(filePath);
    const resolvedFileName = item.fileName ?? basename(filePath);
    args.file = {
      base64: fileBuffer.toString("base64"),
      fileName: resolvedFileName,
      contentType: item.contentType ?? guessMime(resolvedFileName),
    };
  } else if (fileBase64) {
    args.file = {
      base64: fileBase64,
      fileName: item.fileName ?? "upload.bin",
      contentType: item.contentType ?? "application/octet-stream",
    };
  } else if (url) {
    args.url = url;
  }

  return args;
}

async function ingestOne(
  item: IngestItem,
  ownerUserId: string,
  convexUrl: string,
): Promise<IngestResult> {
  try {
    const args = buildArgs(item, ownerUserId);
    const response = await fetch(`${convexUrl}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "ingest:ingestFromApi",
        args,
      }),
    });

    const result = (await response.json()) as {
      status?: string;
      value?: IngestActionResult;
      errorMessage?: string;
    };

    if (!response.ok || result.status !== "success") {
      return {
        error: result.errorMessage ?? `HTTP ${response.status}`,
        input:
          item.promptText?.slice(0, 80) ??
          item.designInspiration?.title ??
          item.filePath ??
          item.imagePath ??
          item.url ??
          item.imageUrl ??
          "unknown",
      };
    }

    return result.value ?? {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      input:
        item.promptText?.slice(0, 80) ??
        item.designInspiration?.title ??
        item.filePath ??
        item.imagePath ??
        item.url ??
        item.imageUrl ??
        "unknown",
    };
  }
}

const rawArg = process.argv[2];
if (!rawArg) {
  console.error("Usage: bun run ingest.ts '<json>'");
  process.exit(1);
}

let input: IngestItem | IngestItem[];
try {
  input = JSON.parse(rawArg);
} catch (error) {
  console.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let convexUrl: string;
let ownerUserId: string;
try {
  convexUrl = resolveConvexUrl();
  ownerUserId = resolveOwnerUserId();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const items = Array.isArray(input) ? input : [input];
if (items.length === 0) {
  console.error("No items to ingest.");
  process.exit(1);
}

const results: IngestResult[] = [];
for (const item of items) {
  results.push(await ingestOne(item, ownerUserId, convexUrl));
}

if (items.length === 1) {
  console.log(JSON.stringify(results[0]));
} else {
  console.log(JSON.stringify(results, null, 2));
}

if (results.some((result) => result.error)) {
  process.exit(1);
}
