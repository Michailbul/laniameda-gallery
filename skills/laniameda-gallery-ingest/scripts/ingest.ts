#!/usr/bin/env bun

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

type Pillar = string;
type Operation = "create" | "update" | "delete" | "workflow";
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
type DesignCaptureKind = "website" | "image" | "component" | "tutorial";
type DesignSaveIntent = "utility" | "inspiration" | "component" | "tutorial";

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
  sourceTitle?: string;
  userNote?: string;
  inspirationType: DesignInspirationType;
  platform?: DesignPlatform;
  workflowType?: WorkflowType;
  captureKind?: DesignCaptureKind;
  saveIntent?: DesignSaveIntent;
  templateKey?: string;
  sourceFingerprint?: string;
  status?: DesignInspirationStatus;
  ingestKey?: string;
};

type PromptProfileInput = Record<string, unknown>;

type LineageRole =
  | "starting_image_prompt"
  | "starting_image_asset"
  | "style_reference"
  | "motion_reference"
  | "upscale_source"
  | "variation_source"
  | "edit_source"
  | "other";

type UpstreamInput = {
  type: "prompt" | "asset";
  id?: string;
  ingestKey?: string;
  role: LineageRole;
  stageOrder?: number;
  notes?: string;
};

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
  description?: string;
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
  upstreamInputs?: UpstreamInput[];
  // Video only: where to grab the poster frame. Defaults to 15% in, clamped to
  // 1–10s. Set it when the default frame lands on a fade or a murky shot.
  posterAtSeconds?: number;
  // Curation, applied after the asset exists. `featured` implies `isPublic` —
  // the backend force-ANDs them, so there is no private "featured" state.
  // BOTH make the asset visible on the public site. Never set either without
  // the user explicitly asking to publish.
  isPublic?: boolean;
  featured?: boolean;
};

type UpdateItem = {
  operation: "update";
  target: Target;
  id?: string;
  ingestKey?: string;
  filePath?: string;
  imagePath?: string;
  fileBase64?: string;
  imageBase64?: string;
  url?: string;
  imageUrl?: string;
  assetIngestKey?: string;
  promptText?: string;
  tagNames?: string[];
  typedTags?: TypedTagInput[];
  folderId?: string | null;
  pillar?: Pillar | null;
  promptType?: PromptType | null;
  domain?: string | null;
  modelName?: string | null;
  description?: string | null;
  modelProvider?: ModelProvider | null;
  workflowType?: WorkflowType | null;
  promptSections?: PromptSectionsInput | null;
  promptProfile?: PromptProfileInput | null;
  promptId?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  userNote?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  generationType?: GenerationType | null;
  assetRole?: AssetRole | null;
  ingestSource?: IngestSource | null;
  title?: string | null;
  summary?: string | null;
  inspirationType?: DesignInspirationType | null;
  platform?: DesignPlatform | null;
  captureKind?: DesignCaptureKind | null;
  saveIntent?: DesignSaveIntent | null;
  templateKey?: string | null;
  sourceFingerprint?: string | null;
  status?: DesignInspirationStatus | null;
  assetId?: string | null;
};

type DeleteItem = {
  operation: "delete";
  target: Target;
  id?: string;
  ingestKey?: string;
};

type WorkflowStepMedia = {
  filePath?: string;
  imagePath?: string;
  url?: string;
  imageUrl?: string;
  ingestKey?: string;
  fileName?: string;
  contentType?: string;
};

type WorkflowStepInput = {
  stepLabel?: string;
  promptText?: string;
  promptSections?: PromptSectionsInput;
  promptType?: PromptType;
  generationType?: GenerationType;
  workflowType?: WorkflowType;
  modelName?: string;
  modelProvider?: ModelProvider;
  tagNames?: string[];
  promptIngestKey?: string;
  allowPromptOnly?: boolean;
  media?: WorkflowStepMedia[];
};

type WorkflowItem = {
  operation: "workflow";
  ingestKey?: string;
  title: string;
  description?: string;
  agentInstructions?: string;
  pillar?: Pillar;
  tagNames?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  steps: WorkflowStepInput[];
};

type SkillItem = CreateItem | UpdateItem | DeleteItem | WorkflowItem;

type SkillActionResult = {
  target?: Target;
  deleted?: boolean;
  promptId?: string;
  assetId?: string;
  designInspirationId?: string;
  workflowId?: string;
  stepCount?: number;
  isPublic?: boolean;
  isFeatured?: boolean;
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

// ── Media preparation ───────────────────────────────────────────────────────
//
// Images ride the Convex function argument as base64 (the server decodes them
// and builds a thumbnail). Video cannot: base64 inflates bytes ~1.33x and blows
// the argument cap, and `posterFile` is only honoured on the r2Key branch of
// ingestFromApi — so a base64 video can never get a thumbnail. Video therefore
// always uploads direct to R2, which also means nothing decodes it server-side
// and the dimensions we send are the ONLY ones the asset will ever have.

const BASE64_MAX_BYTES = 10 * 1024 * 1024;

// `fetch` has no default timeout, so a saturated deployment used to hang the
// script indefinitely: a batch of 12 role updates once sat for 7 minutes and
// committed NOTHING, because the very first call never returned and there was
// no per-item output to show where it stopped. The trigger was a backlog of
// video reindex actions (each one pulls the clip from R2 and embeds it)
// queued by a preceding bulk ingest — the deployment was busy, not broken.
//
// So: bound every call, retry the transient ones, and report progress as the
// batch runs.
const CALL_TIMEOUT_MS = Number(process.env.LANIAMEDA_INGEST_TIMEOUT_MS ?? 120_000);
// R2 receives whole videos, so it gets its own budget scaled by payload size.
const R2_TIMEOUT_FLOOR_MS = 120_000;
const R2_TIMEOUT_MS_PER_MB = 4_000;
const RETRY_DELAYS_MS = [2_000, 8_000, 20_000] as const;

class TransientCallError extends Error {}

const isTransientStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

// A timeout or a dropped socket says nothing about whether the server ran the
// mutation, so retrying is only safe when the call is idempotent. Convex dedupes
// on ingestKey, which is what makes a repeat harmless.
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; retry: boolean; label: string },
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const maxAttempts = options.retry ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1]!;
      process.stderr.write(
        `  retry ${attempt}/${maxAttempts - 1} for ${options.label} in ${delay / 1000}s — ${lastError?.message}\n`,
      );
      await sleep(delay);
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 4xx other than the throttling codes is a deterministic rejection —
      // a bad payload retried three times is still a bad payload.
      if (!response.ok && isTransientStatus(response.status)) {
        throw new TransientCallError(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const transient =
        err instanceof TransientCallError ||
        err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        // Bun/Node surface connection resets as a bare TypeError from fetch.
        err instanceof TypeError;
      if (!transient) throw err;
      lastError = err;
      if (err.name === "TimeoutError") {
        lastError = new Error(`timed out after ${timeoutMs / 1000}s`);
      }
    }
  }

  throw new Error(
    `${options.label} failed after ${maxAttempts} attempt(s): ${lastError?.message}` +
      (options.retry
        ? ""
        : " — the call is not idempotent (no ingestKey), so it was not retried; " +
          "add an ingestKey to make retries safe"),
  );
}

// Browsers cannot decode PCM audio inside an MP4/MOV container. Such a file
// ingests clean, looks correct in the grid, and plays SILENT — an invisible
// failure, so it gets remuxed rather than merely flagged. DaVinci and QuickTime
// exports hit this routinely.
const BROWSER_SAFE_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "alac",
]);

// Containers browsers handle inconsistently even with an h264/aac payload.
const REMUX_CONTAINER_EXTENSIONS = new Set(["mov", "qt", "avi", "mkv"]);

export type PosterFileInput = {
  base64: string;
  contentType: string;
  width?: number;
  height?: number;
  size?: number;
};

export type PreparedMedia = {
  file?: { base64: string; fileName: string; contentType: string };
  r2Key?: string;
  mediaContentType?: string;
  mediaSize?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaFileName?: string;
  posterFile?: PosterFileInput;
};

export type VideoProbe = {
  width: number;
  height: number;
  durationSeconds: number;
  audioCodec?: string;
  hasAudio: boolean;
};

function runBinary(bin: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function hasBinary(bin: string): boolean {
  return runBinary(bin, ["-version"]).ok;
}

// Rotated captures store the coded size, so a 90°-rotated phone clip would get a
// landscape masonry cell without this.
function readRotation(videoStream: Record<string, unknown>): number {
  const tags = videoStream.tags as Record<string, unknown> | undefined;
  const fromTag = Number(tags?.rotate);
  if (Number.isFinite(fromTag) && fromTag !== 0) return fromTag;

  const sideData = Array.isArray(videoStream.side_data_list)
    ? (videoStream.side_data_list as Record<string, unknown>[])
    : [];
  for (const entry of sideData) {
    const rotation = Number(entry?.rotation);
    if (Number.isFinite(rotation) && rotation !== 0) return rotation;
  }
  return 0;
}

export function probeVideo(filePath: string): VideoProbe | undefined {
  const probe = runBinary("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  if (!probe.ok) return undefined;

  let parsed: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  try {
    parsed = JSON.parse(probe.stdout);
  } catch {
    return undefined;
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) return undefined;
  const audio = streams.find((stream) => stream.codec_type === "audio");

  let width = Number(video.width) || 0;
  let height = Number(video.height) || 0;
  const rotation = Math.abs(readRotation(video)) % 360;
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  return {
    width,
    height,
    durationSeconds: Number(video.duration ?? parsed.format?.duration) || 0,
    audioCodec: audio?.codec_name ? String(audio.codec_name) : undefined,
    hasAudio: Boolean(audio),
  };
}

function fileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

export function describeRemuxReason(
  filePath: string,
  probe: VideoProbe,
): string | undefined {
  if (probe.hasAudio && !BROWSER_SAFE_AUDIO_CODECS.has(probe.audioCodec ?? "")) {
    return `audio is ${probe.audioCodec}, which browsers cannot decode — the asset would play silent`;
  }
  if (REMUX_CONTAINER_EXTENSIONS.has(fileExtension(filePath))) {
    return `.${fileExtension(filePath)} container plays inconsistently across browsers`;
  }
  return undefined;
}

function remuxForBrowser(filePath: string, probe: VideoProbe, workDir: string): string {
  const audioIsSafe =
    !probe.hasAudio || BROWSER_SAFE_AUDIO_CODECS.has(probe.audioCodec ?? "");
  const outPath = join(workDir, `${basename(filePath).replace(/\.[^.]+$/, "")}.mp4`);

  const args = ["-y", "-v", "error", "-i", filePath, "-map", "0:v:0"];
  if (probe.hasAudio) args.push("-map", "0:a:0");
  // The video stream is always copied, so this is lossless. Only undecodable
  // audio is re-encoded.
  args.push("-c:v", "copy");
  if (probe.hasAudio) {
    args.push(...(audioIsSafe ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "320k"]));
  }
  args.push("-movflags", "+faststart", outPath);

  const result = runBinary("ffmpeg", args);
  if (!result.ok || !existsSync(outPath)) {
    throw new Error(
      `ffmpeg could not remux ${basename(filePath)}: ${result.stderr.trim().slice(0, 400)}`,
    );
  }
  return outPath;
}

export function posterTimestamp(probe: VideoProbe, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  if (!probe.durationSeconds) return 1;
  return Math.min(10, Math.max(1, probe.durationSeconds * 0.15));
}

function probeImageDimensions(filePath: string): { width: number; height: number } | undefined {
  const result = runBinary("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    filePath,
  ]);
  if (!result.ok) return undefined;
  const [width, height] = result.stdout.trim().split("x").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined;
}

// Video assets get no server-generated thumbnail, so the poster IS the card.
function extractPoster(
  videoPath: string,
  atSeconds: number,
  workDir: string,
): PosterFileInput | undefined {
  const outPath = join(workDir, "poster.jpg");
  const result = runBinary("ffmpeg", [
    "-y", "-v", "error",
    "-ss", String(atSeconds),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", "scale='min(1280,iw)':-2",
    "-q:v", "3",
    outPath,
  ]);
  if (!result.ok || !existsSync(outPath)) return undefined;

  const bytes = readFileSync(outPath);
  const dimensions = probeImageDimensions(outPath);
  return {
    base64: bytes.toString("base64"),
    contentType: "image/jpeg",
    width: dimensions?.width,
    height: dimensions?.height,
    size: bytes.byteLength,
  };
}

async function callConvex(
  convexUrl: string,
  kind: "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // These are the plumbing calls (upload-url reservation, metadata sync). They
  // carry no user payload to duplicate, so retrying them is always safe.
  const response = await fetchWithRetry(
    `${convexUrl}/api/${kind}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args }),
    },
    { retry: true, label: path },
  );
  const body = (await response.json()) as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (!response.ok || body.status !== "success") {
    throw new Error(body.errorMessage ?? `HTTP ${response.status} calling ${path}`);
  }
  return body.value;
}

async function uploadBytesToR2(
  convexUrl: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const reserved = (await callConvex(convexUrl, "mutation", "r2:generateUploadUrl", {})) as {
    key?: string;
    url?: string;
  };
  if (!reserved?.key || !reserved?.url) {
    throw new Error("r2:generateUploadUrl returned no key/url.");
  }

  // A reserved R2 key is single-use and the PUT is a plain overwrite of it, so
  // a retry re-sends the same bytes to the same key — idempotent by definition.
  const put = await fetchWithRetry(
    reserved.url,
    {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "Content-Type": contentType },
    },
    {
      retry: true,
      label: `R2 upload (${(bytes.byteLength / 1e6).toFixed(1)} MB)`,
      timeoutMs:
        R2_TIMEOUT_FLOOR_MS +
        (bytes.byteLength / 1e6) * R2_TIMEOUT_MS_PER_MB,
    },
  );
  if (!put.ok) {
    throw new Error(`R2 upload failed: ${put.status} ${(await put.text()).slice(0, 300)}`);
  }

  await callConvex(convexUrl, "mutation", "r2:syncMetadata", { key: reserved.key });
  return reserved.key;
}

// Only the create path has an R2 branch. updateFromApi and workflow step media
// take base64 and nothing else, so oversized files there need a real explanation
// rather than a cryptic argument-size failure from Convex.
export function assertBase64Ingestible(
  filePath: string,
  fileName: string,
  remedy = "compress it to JPEG first",
) {
  const size = statSync(filePath).size;
  if (size <= BASE64_MAX_BYTES) return;
  throw new Error(
    `${fileName} is ${(size / 1e6).toFixed(1)} MB and has to ride the Convex function ` +
      `argument as base64, which caps out near ${(BASE64_MAX_BYTES / 1e6).toFixed(0)} MB — ${remedy}.`,
  );
}

// Returns undefined when the sync base64 path in buildCreateArgs should handle
// the file (images, inline base64, remote URLs).
export async function prepareMediaForCreate(
  item: CreateItem,
  convexUrl: string,
  warn: (message: string) => void = (message) => console.error(message),
): Promise<PreparedMedia | undefined> {
  const filePath = item.filePath ?? item.imagePath;
  if (!filePath) return undefined;
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileName = item.fileName ?? basename(filePath);
  const contentType = item.contentType ?? guessMime(fileName);

  if (!contentType.startsWith("video/")) {
    assertBase64Ingestible(filePath, fileName);
    return undefined;
  }

  if (!hasBinary("ffprobe") || !hasBinary("ffmpeg")) {
    throw new Error(
      "ffmpeg and ffprobe are required to ingest video — they supply the real " +
        "dimensions, browser-safe audio, and the poster frame. Install with `brew install ffmpeg`.",
    );
  }

  const probe = probeVideo(filePath);
  if (!probe?.width || !probe?.height) {
    throw new Error(`Could not read video dimensions from ${filePath}.`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "laniameda-ingest-"));
  try {
    let uploadPath = filePath;
    const remuxReason = describeRemuxReason(filePath, probe);
    if (remuxReason) {
      warn(`[ingest] remuxing ${fileName}: ${remuxReason}. The video stream is copied, so no quality is lost.`);
      uploadPath = remuxForBrowser(filePath, probe, workDir);
    }

    const poster = extractPoster(
      uploadPath,
      posterTimestamp(probe, item.posterAtSeconds),
      workDir,
    );
    if (!poster) {
      warn(`[ingest] could not extract a poster from ${fileName}; its gallery card will have no thumbnail.`);
    }

    const remuxed = uploadPath !== filePath;
    const bytes = readFileSync(uploadPath);
    const uploadContentType = remuxed ? "video/mp4" : contentType;

    return {
      r2Key: await uploadBytesToR2(convexUrl, bytes, uploadContentType),
      mediaContentType: uploadContentType,
      mediaSize: bytes.byteLength,
      mediaWidth: probe.width,
      mediaHeight: probe.height,
      mediaFileName: remuxed ? fileName.replace(/\.[^.]+$/, ".mp4") : fileName,
      posterFile: poster,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Curation ────────────────────────────────────────────────────────────────
//
// isFeatured is force-ANDed with isPublic in convex/assets.ts, so there is no
// private "featured" state — asking for either PUBLISHES the asset, and a
// featured asset leads the public home reel. Gated on CURATION_ADMIN_SECRET
// matching the deployment, with the owner in CURATION_ADMIN_USER_IDS.
export async function curateAsset(
  convexUrl: string,
  assetId: string,
  ownerUserId: string,
  featured: boolean,
  note: (message: string) => void = (message) => console.error(message),
): Promise<void> {
  const adminSecret = (process.env.CURATION_ADMIN_SECRET ?? "").trim();
  if (!adminSecret) {
    throw new Error(
      "CURATION_ADMIN_SECRET is required to publish or feature an asset. The " +
        "asset itself was created and is private — set the secret and re-run with " +
        "the same ingestKey, or curate it from the gallery UI.",
    );
  }

  await callConvex(convexUrl, "mutation", "assets:setAssetCuration", {
    assetId,
    actorUserId: ownerUserId,
    isPublic: true,
    isFeatured: featured,
    adminSecret,
  });

  note(
    featured
      ? `[ingest] ${assetId} is now PUBLIC and FEATURED — it leads the reel on the public home page.`
      : `[ingest] ${assetId} is now PUBLIC — visible to anyone on the public site.`,
  );
}

export function resolveConvexUrl(explicitValue?: string): string {
  const value = (explicitValue ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "").trim();
  if (!value) {
    throw new Error("CONVEX_URL is required.");
  }
  return value.replace(/\/+$/, "");
}

export function resolveOwnerUserId(explicitValue?: string): string {
  const value = (explicitValue ?? process.env.KB_OWNER_USER_ID ?? "").trim();
  if (!value) {
    throw new Error("KB_OWNER_USER_ID is required.");
  }
  return value;
}

export function stableIngestKey(item: CreateItem): string {
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

function isWorkflowItem(item: SkillItem): item is WorkflowItem {
  return getOperation(item) === "workflow";
}

function assertSelector(item: UpdateItem | DeleteItem) {
  if (!item.id && !item.ingestKey) {
    throw new Error("Update/delete requires either `id` or `ingestKey`.");
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

export function buildCreateArgs(
  item: CreateItem,
  ownerUserId: string,
  prepared?: PreparedMedia,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    ownerUserId,
    ingestSource: item.ingestSource ?? "agent",
  };

  const filePath = item.filePath ?? item.imagePath;
  const fileBase64 = item.fileBase64 ?? item.imageBase64;
  const url = item.url ?? item.imageUrl;
  const pillar = item.pillar ?? undefined;
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
  if (item.description) args.description = item.description;
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
  if (item.upstreamInputs?.length) args.upstreamInputs = item.upstreamInputs;

  args.ingestKey = item.ingestKey ?? stableIngestKey(item);

  if (prepared?.r2Key) {
    // Video: bytes are already in R2. Nothing decodes them server-side, so the
    // probed dimensions and poster travelling here are all the asset will get.
    args.r2Key = prepared.r2Key;
    assignIfDefined(args, "mediaContentType", prepared.mediaContentType);
    assignIfDefined(args, "mediaSize", prepared.mediaSize);
    assignIfDefined(args, "mediaWidth", prepared.mediaWidth);
    assignIfDefined(args, "mediaHeight", prepared.mediaHeight);
    assignIfDefined(args, "mediaFileName", prepared.mediaFileName);
    assignIfDefined(args, "posterFile", prepared.posterFile);
  } else if (prepared?.file) {
    args.file = prepared.file;
  } else if (filePath) {
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

export function buildUpdateArgs(item: UpdateItem, ownerUserId: string): Record<string, unknown> {
  assertSelector(item);

  const args: Record<string, unknown> = {
    ownerUserId,
    target: item.target,
  };

  assignIfDefined(args, "id", item.id);
  assignIfDefined(args, "ingestKey", item.ingestKey);
  assignIfDefined(args, "assetIngestKey", item.assetIngestKey);

  const filePath = item.filePath ?? item.imagePath;
  const fileBase64 = item.fileBase64 ?? item.imageBase64;
  const mediaUrl = item.url ?? item.imageUrl;

  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const resolvedFileName = basename(filePath);
    assertBase64Ingestible(
      filePath,
      resolvedFileName,
      "updateFromApi has no R2 branch, so ingest this as a new asset instead of replacing media this large",
    );
    const fileBuffer = readFileSync(filePath);
    args.file = {
      base64: fileBuffer.toString("base64"),
      fileName: resolvedFileName,
      contentType: guessMime(resolvedFileName),
    };
  } else if (fileBase64) {
    args.file = {
      base64: fileBase64,
      fileName: item.fileName ?? "upload.bin",
      contentType: item.contentType ?? "application/octet-stream",
    };
  } else if (mediaUrl) {
    args.url = mediaUrl;
  }

  if (item.target === "prompt") {
    assignIfDefined(args, "promptText", item.promptText);
    assignIfDefined(args, "tagNames", item.tagNames);
    assignIfDefined(args, "typedTags", item.typedTags);
    assignIfDefined(args, "folderId", item.folderId);
    assignIfDefined(args, "pillar", item.pillar);
    assignIfDefined(args, "promptType", item.promptType);
    assignIfDefined(args, "domain", item.domain);
    assignIfDefined(args, "modelName", item.modelName);
    assignIfDefined(args, "description", item.description);
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
    assignIfDefined(args, "description", item.description);
    assignIfDefined(args, "pillar", item.pillar);
    assignIfDefined(args, "generationType", item.generationType);
    assignIfDefined(args, "assetRole", item.assetRole);
    assignIfDefined(args, "ingestSource", item.ingestSource);
    return args;
  }

  assignIfDefined(args, "title", item.title);
  assignIfDefined(args, "summary", item.summary);
  assignIfDefined(args, "sourceUrl", item.sourceUrl);
  assignIfDefined(args, "sourceTitle", item.sourceTitle);
  assignIfDefined(args, "userNote", item.userNote);
  assignIfDefined(args, "inspirationType", item.inspirationType);
  assignIfDefined(args, "platform", item.platform);
  assignIfDefined(args, "workflowType", item.workflowType);
  assignIfDefined(args, "captureKind", item.captureKind);
  assignIfDefined(args, "saveIntent", item.saveIntent);
  assignIfDefined(args, "templateKey", item.templateKey);
  assignIfDefined(args, "sourceFingerprint", item.sourceFingerprint);
  assignIfDefined(args, "status", item.status);
  assignIfDefined(args, "tagNames", item.tagNames);
  assignIfDefined(args, "typedTags", item.typedTags);
  assignIfDefined(args, "folderId", item.folderId);
  assignIfDefined(args, "assetId", item.assetId);
  assignIfDefined(args, "promptId", item.promptId);
  return args;
}

export function buildDeleteArgs(item: DeleteItem, ownerUserId: string): Record<string, unknown> {
  assertSelector(item);

  const args: Record<string, unknown> = {
    ownerUserId,
    target: item.target,
  };
  assignIfDefined(args, "id", item.id);
  assignIfDefined(args, "ingestKey", item.ingestKey);
  return args;
}

// Workflows bundle multiple prompt + media steps under one organizing record.
// Each step is ingested through the canonical ingest path on the backend, so
// step prompts/assets stay normal, independently-searchable gallery entries.
export function buildWorkflowArgs(
  item: WorkflowItem,
  ownerUserId: string,
): Record<string, unknown> {
  const title = item.title?.trim();
  if (!title) {
    throw new Error("Workflow requires a `title`.");
  }
  // Pillars are retired: forward one only if explicitly provided (dormant column).
  const pillar = item.pillar?.trim() || undefined;
  if (!item.steps?.length) {
    throw new Error("Workflow requires at least one step.");
  }

  const steps = item.steps.map((step, index) => {
    const media = (step.media ?? []).map((entry) => {
      const filePath = entry.filePath ?? entry.imagePath;
      const url = entry.url ?? entry.imageUrl;
      const out: Record<string, unknown> = {};
      assignIfDefined(out, "ingestKey", entry.ingestKey);
      if (filePath) {
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        const resolvedFileName = entry.fileName ?? basename(filePath);
        assertBase64Ingestible(
          filePath,
          resolvedFileName,
          "workflow step media has no R2 branch — ingest the video with its own create call and link it through upstreamInputs",
        );
        const fileBuffer = readFileSync(filePath);
        out.file = {
          base64: fileBuffer.toString("base64"),
          fileName: resolvedFileName,
          contentType: entry.contentType ?? guessMime(resolvedFileName),
        };
      } else if (url) {
        out.url = url;
      } else {
        throw new Error(
          `Workflow step ${index + 1} media entry needs a filePath or url.`,
        );
      }
      return out;
    });

    const stepArgs: Record<string, unknown> = {};
    assignIfDefined(stepArgs, "stepLabel", step.stepLabel);
    assignIfDefined(stepArgs, "promptText", step.promptText?.trim());
    assignIfDefined(stepArgs, "promptSections", step.promptSections);
    assignIfDefined(stepArgs, "promptType", step.promptType);
    assignIfDefined(stepArgs, "generationType", step.generationType);
    assignIfDefined(stepArgs, "workflowType", step.workflowType);
    assignIfDefined(stepArgs, "modelName", step.modelName);
    assignIfDefined(stepArgs, "modelProvider", step.modelProvider);
    if (step.tagNames?.length) stepArgs.tagNames = step.tagNames;
    assignIfDefined(stepArgs, "promptIngestKey", step.promptIngestKey);
    if (step.allowPromptOnly) stepArgs.allowPromptOnly = true;
    if (media.length) stepArgs.media = media;
    return stepArgs;
  });

  const args: Record<string, unknown> = {
    ownerUserId,
    title,
    ...(pillar ? { pillar } : {}),
    steps,
    ingestKey:
      item.ingestKey ??
      createHash("sha256")
        .update(
          [
            "workflow",
            title,
            ...item.steps.map((step) => step.promptText ?? ""),
          ].join("|"),
        )
        .digest("hex")
        .slice(0, 24),
  };
  assignIfDefined(args, "description", item.description);
  assignIfDefined(args, "agentInstructions", item.agentInstructions);
  if (item.tagNames?.length) args.tagNames = item.tagNames;
  if (item.isPublic) args.isPublic = true;
  if (item.isFeatured) args.isFeatured = true;
  return args;
}

export function buildActionRequest(
  item: SkillItem,
  ownerUserId: string,
  prepared?: PreparedMedia,
): { path: string; args: Record<string, unknown> } {
  if (isWorkflowItem(item)) {
    return {
      path: "workflows:ingestWorkflowFromApi",
      args: buildWorkflowArgs(item, ownerUserId),
    };
  }

  if (isCreateItem(item)) {
    return {
      path: "ingest:ingestFromApi",
      args: buildCreateArgs(item, ownerUserId, prepared),
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
  if (isWorkflowItem(item)) {
    return `workflow:${item.title ?? item.ingestKey ?? "unknown"}`;
  }
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

// Retrying a call whose outcome is unknown is only safe when a repeat cannot
// create a second record. Update and delete address an existing row, and Convex
// dedupes creates on ingestKey — a create without one would duplicate, so it is
// reported rather than retried.
function isIdempotent(item: SkillItem): boolean {
  if (!isCreateItem(item)) return true;
  return Boolean(item.ingestKey);
}

export async function mutateOne(
  item: SkillItem,
  ownerUserId: string,
  convexUrl: string,
): Promise<SkillResult> {
  try {
    // Video is remuxed, probed, postered and pushed to R2 before the ingest call
    // — all of which is I/O, so it cannot live inside the pure arg builders.
    const prepared = isCreateItem(item)
      ? await prepareMediaForCreate(item, convexUrl)
      : undefined;
    const request = buildActionRequest(item, ownerUserId, prepared);
    const response = await fetchWithRetry(
      `${convexUrl}/api/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      { retry: isIdempotent(item), label: summarizeInput(item) },
    );

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

    const value = result.value ?? {};

    // Curation is a second call, and a failure here must not read as a failed
    // ingest — the asset exists either way, just private.
    if (isCreateItem(item) && (item.featured || item.isPublic) && value.assetId) {
      try {
        await curateAsset(
          convexUrl,
          value.assetId,
          ownerUserId,
          Boolean(item.featured),
        );
        return { ...value, isPublic: true, isFeatured: Boolean(item.featured) };
      } catch (error) {
        return {
          ...value,
          error: `Asset created but curation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          input: summarizeInput(item),
        };
      }
    }

    return value;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      input: summarizeInput(item),
    };
  }
}

export async function runIngestSkill(
  input: SkillItem | SkillItem[],
  runtime?: { convexUrl?: string; ownerUserId?: string },
): Promise<SkillResult[]> {
  const convexUrl = resolveConvexUrl(runtime?.convexUrl);
  const ownerUserId = resolveOwnerUserId(runtime?.ownerUserId);
  const items = Array.isArray(input) ? input : [input];

  if (items.length === 0) {
    throw new Error("No items to process.");
  }

  const results: SkillResult[] = [];
  // Batches print nothing until the whole run resolves, which made a stalled
  // call look identical to a slow one. Progress goes to stderr so stdout stays
  // pure JSON for callers that parse it.
  const trace = items.length > 1;
  for (const [index, item] of items.entries()) {
    if (trace) {
      process.stderr.write(
        `[${index + 1}/${items.length}] ${summarizeInput(item)}\n`,
      );
    }
    const result = await mutateOne(item, ownerUserId, convexUrl);
    if (trace && result.error) {
      process.stderr.write(`  failed: ${result.error}\n`);
    }
    results.push(result);
  }

  return results;
}

async function main() {
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

  try {
    const results = await runIngestSkill(input);
    if (results.length === 1) {
      console.log(JSON.stringify(results[0]));
    } else {
      console.log(JSON.stringify(results, null, 2));
    }

    if (results.some((result) => result.error)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
