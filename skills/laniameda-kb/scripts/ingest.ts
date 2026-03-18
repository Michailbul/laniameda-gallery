#!/usr/bin/env bun

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

type Pillar = "creators" | "cars" | "designs" | "dump";
type Operation = "create" | "update" | "delete";
type Target = "prompt" | "asset" | "designInspiration";
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
type DesignInspirationStatus = "active" | "archived";

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

type CreateItem = {
  operation?: "create";
  promptText?: string;
  allowPromptOnly?: boolean;
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

type UpdateItem = {
  operation: "update";
  target: Target;
  id?: string;
  ingestKey?: string;
  promptText?: string;
  tagNames?: string[];
  typedTags?: TypedTagInput[];
  folderId?: string | null;
  pillar?: Pillar | null;
  promptType?: PromptType | null;
  domain?: string | null;
  modelName?: string | null;
  modelProvider?: ModelProvider | null;
  workflowType?: WorkflowType | null;
  promptSections?: PromptSectionsInput | null;
  promptProfile?: PromptProfileInput | null;
  promptId?: string | null;
  sourceUrl?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  generationType?: GenerationType | null;
  assetRole?: AssetRole | null;
  ingestSource?: IngestSource | null;
  title?: string | null;
  summary?: string | null;
  inspirationType?: DesignInspirationType | null;
  platform?: DesignPlatform | null;
  status?: DesignInspirationStatus | null;
  assetId?: string | null;
};

type DeleteItem = {
  operation: "delete";
  target: Target;
  id?: string;
  ingestKey?: string;
};

type SkillItem = CreateItem | UpdateItem | DeleteItem;

type SkillActionResult = {
  target?: Target;
  deleted?: boolean;
  promptId?: string;
  assetId?: string;
  designInspirationId?: string;
};

type SkillResult = SkillActionResult & {
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

function stableIngestKey(item: CreateItem): string {
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

function getOperation(item: SkillItem): Operation {
  return item.operation ?? "create";
}

function isCreateItem(item: SkillItem): item is CreateItem {
  return getOperation(item) === "create";
}

function isUpdateItem(item: SkillItem): item is UpdateItem {
  return getOperation(item) === "update";
}

function isDeleteItem(item: SkillItem): item is DeleteItem {
  return getOperation(item) === "delete";
}

function assertSelector(item: UpdateItem | DeleteItem) {
  if (!item.id && !item.ingestKey) {
    throw new Error("Update/delete requires either `id` or `ingestKey`.");
  }
}

function assertNoMediaReplacement(item: UpdateItem) {
  const unsupportedFields = [
    "filePath",
    "imagePath",
    "fileBase64",
    "imageBase64",
    "url",
    "imageUrl",
    "designInspiration",
  ];
  for (const field of unsupportedFields) {
    if (field in item) {
      throw new Error(
        `Update does not replace media payloads. Use delete + create instead of \`${field}\`.`,
      );
    }
  }
}

function assignIfDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function buildCreateArgs(item: CreateItem, ownerUserId: string): Record<string, unknown> {
  const args: Record<string, unknown> = {
    ownerUserId,
    ingestSource: item.ingestSource ?? "agent",
  };

  const filePath = item.filePath ?? item.imagePath;
  const fileBase64 = item.fileBase64 ?? item.imageBase64;
  const url = item.url ?? item.imageUrl;
  const pillar = item.pillar ?? (item.designInspiration ? "designs" : undefined);
  const hasPromptText = Boolean(item.promptText?.trim());
  const hasMediaInput = Boolean(filePath || fileBase64 || url);
  const isPromptOnlyCreate = hasPromptText && !hasMediaInput && !item.designInspiration;

  if (item.promptText) args.promptText = item.promptText.trim();
  if (item.allowPromptOnly) args.allowPromptOnly = true;
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

  if (isPromptOnlyCreate && item.allowPromptOnly !== true) {
    throw new Error(
      "Prompt-only create requests must set allowPromptOnly=true.",
    );
  }

  return args;
}

function buildUpdateArgs(item: UpdateItem, ownerUserId: string): Record<string, unknown> {
  assertSelector(item);
  assertNoMediaReplacement(item);

  const args: Record<string, unknown> = {
    ownerUserId,
    target: item.target,
  };

  assignIfDefined(args, "id", item.id);
  assignIfDefined(args, "ingestKey", item.ingestKey);

  if (item.target === "prompt") {
    assignIfDefined(args, "promptText", item.promptText);
    assignIfDefined(args, "tagNames", item.tagNames);
    assignIfDefined(args, "typedTags", item.typedTags);
    assignIfDefined(args, "folderId", item.folderId);
    assignIfDefined(args, "pillar", item.pillar);
    assignIfDefined(args, "promptType", item.promptType);
    assignIfDefined(args, "domain", item.domain);
    assignIfDefined(args, "modelName", item.modelName);
    assignIfDefined(args, "modelProvider", item.modelProvider);
    assignIfDefined(args, "workflowType", item.workflowType);
    assignIfDefined(args, "promptSections", item.promptSections);
    assignIfDefined(args, "promptProfile", item.promptProfile);
    return args;
  }

  if (item.target === "asset") {
    assignIfDefined(args, "tagNames", item.tagNames);
    assignIfDefined(args, "typedTags", item.typedTags);
    assignIfDefined(args, "folderId", item.folderId);
    assignIfDefined(args, "promptId", item.promptId);
    assignIfDefined(args, "sourceUrl", item.sourceUrl);
    assignIfDefined(args, "fileName", item.fileName);
    assignIfDefined(args, "contentType", item.contentType);
    assignIfDefined(args, "modelName", item.modelName);
    assignIfDefined(args, "pillar", item.pillar);
    assignIfDefined(args, "generationType", item.generationType);
    assignIfDefined(args, "assetRole", item.assetRole);
    assignIfDefined(args, "ingestSource", item.ingestSource);
    return args;
  }

  assignIfDefined(args, "title", item.title);
  assignIfDefined(args, "summary", item.summary);
  assignIfDefined(args, "sourceUrl", item.sourceUrl);
  assignIfDefined(args, "inspirationType", item.inspirationType);
  assignIfDefined(args, "platform", item.platform);
  assignIfDefined(args, "workflowType", item.workflowType);
  assignIfDefined(args, "status", item.status);
  assignIfDefined(args, "tagNames", item.tagNames);
  assignIfDefined(args, "typedTags", item.typedTags);
  assignIfDefined(args, "folderId", item.folderId);
  assignIfDefined(args, "assetId", item.assetId);
  assignIfDefined(args, "promptId", item.promptId);
  return args;
}

function buildDeleteArgs(item: DeleteItem, ownerUserId: string): Record<string, unknown> {
  assertSelector(item);

  const args: Record<string, unknown> = {
    ownerUserId,
    target: item.target,
  };
  assignIfDefined(args, "id", item.id);
  assignIfDefined(args, "ingestKey", item.ingestKey);
  return args;
}

function buildActionRequest(
  item: SkillItem,
  ownerUserId: string,
): { path: string; args: Record<string, unknown> } {
  if (isCreateItem(item)) {
    return {
      path: "ingest:ingestFromApi",
      args: buildCreateArgs(item, ownerUserId),
    };
  }

  if (isUpdateItem(item)) {
    return {
      path: "ingest:updateFromApi",
      args: buildUpdateArgs(item, ownerUserId),
    };
  }

  return {
    path: "ingest:deleteFromApi",
    args: buildDeleteArgs(item, ownerUserId),
  };
}

function summarizeInput(item: SkillItem): string {
  if (isDeleteItem(item)) {
    return `${item.target}:${item.ingestKey ?? item.id ?? "unknown"}`;
  }
  if (isUpdateItem(item)) {
    return `${item.target}:${item.ingestKey ?? item.id ?? item.promptText ?? "unknown"}`;
  }
  if (!isCreateItem(item)) {
    return "unknown";
  }
  return (
    item.promptText?.slice(0, 80) ??
    item.designInspiration?.title ??
    item.filePath ??
    item.imagePath ??
    item.url ??
    item.imageUrl ??
    "unknown"
  );
}

async function mutateOne(
  item: SkillItem,
  ownerUserId: string,
  convexUrl: string,
): Promise<SkillResult> {
  try {
    const request = buildActionRequest(item, ownerUserId);
    const response = await fetch(`${convexUrl}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    const result = (await response.json()) as {
      status?: string;
      value?: SkillActionResult;
      errorMessage?: string;
    };

    if (!response.ok || result.status !== "success") {
      return {
        error: result.errorMessage ?? `HTTP ${response.status}`,
        input: summarizeInput(item),
      };
    }

    return result.value ?? {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      input: summarizeInput(item),
    };
  }
}

const rawArg = process.argv[2];
if (!rawArg) {
  console.error("Usage: bun run ingest.ts '<json>'");
  process.exit(1);
}

let input: SkillItem | SkillItem[];
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
  console.error("No items to process.");
  process.exit(1);
}

const results: SkillResult[] = [];
for (const item of items) {
  results.push(await mutateOne(item, ownerUserId, convexUrl));
}

if (items.length === 1) {
  console.log(JSON.stringify(results[0]));
} else {
  console.log(JSON.stringify(results, null, 2));
}

if (results.some((result) => result.error)) {
  process.exit(1);
}
