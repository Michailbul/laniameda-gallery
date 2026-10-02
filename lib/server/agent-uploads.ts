import { createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import sharp, { type Metadata } from "sharp";
import { getServerConvexClient } from "@/lib/server/convex";
import { signScopedJwt, verifyScopedJwt } from "@/lib/server/mcp-oauth";

// Direct-to-R2 uploads for agents. An agent asks for N upload slots, PUTs each
// file straight to its signed URL from its own shell (the bytes never pass
// through the model or this server's request body), then saves by uploadId.
// On save the server reads the object back once to hash it (duplicate check),
// measure it and cut the card thumbnail, the same work the browser does for
// the extension's R2 path.
//
// An uploadId is a signed ticket for one R2 key and one owner, so an agent can
// only attach objects it was handed, never an arbitrary key in the bucket.

export const MAX_UPLOADS_PER_REQUEST = 50;
const UPLOAD_AUDIENCE = "agent-upload";
const UPLOAD_TICKET_TTL_SECONDS = 24 * 60 * 60;
// The presigned PUT itself expires sooner (the R2 component's 15 min default).
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const POSTER_LONG_EDGE = 1600;

const generateUploadUrlMutation = makeFunctionReference<"mutation">("r2:generateUploadUrl");
const syncMetadataMutation = makeFunctionReference<"mutation">("r2:syncMetadata");
const getMetadataQuery = makeFunctionReference<"query">("r2:getMetadata");

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export type PreparedUpload = {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
};

export const prepareUploads = async (
  ownerUserId: string,
  count: number,
): Promise<PreparedUpload[]> => {
  const total = Math.max(1, Math.min(Math.floor(count) || 1, MAX_UPLOADS_PER_REQUEST));
  const client = getServerConvexClient(ownerUserId);
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();

  return Promise.all(
    Array.from({ length: total }, async () => {
      const slot = (await client.mutation(generateUploadUrlMutation, {})) as {
        key?: unknown;
        url?: unknown;
      };
      if (typeof slot.key !== "string" || typeof slot.url !== "string") {
        throw new UploadError("R2 did not return an upload slot.");
      }
      return {
        uploadId: await signScopedJwt(
          { sub: ownerUserId, key: slot.key },
          UPLOAD_AUDIENCE,
          UPLOAD_TICKET_TTL_SECONDS,
        ),
        uploadUrl: slot.url,
        expiresAt,
      };
    }),
  );
};

const keyFromUploadId = async (uploadId: string, ownerUserId: string) => {
  const payload = await verifyScopedJwt(uploadId, UPLOAD_AUDIENCE);
  if (!payload || payload.sub !== ownerUserId || typeof payload.key !== "string") {
    throw new UploadError("Unknown or expired uploadId. Call prepare_uploads again.");
  }
  return payload.key;
};

type R2Metadata = { url: string; contentType?: string; size?: number; bucket?: string };

// Overridable so tests need not sit through the full wait.
const metadataWaitMs = () => Number(process.env.AGENT_UPLOAD_METADATA_WAIT_MS) || 15_000;

const readUploadedObject = async (ownerUserId: string, key: string) => {
  const client = getServerConvexClient(ownerUserId);
  const lookup = async () =>
    (await client.query(getMetadataQuery, { key })) as R2Metadata | null;

  let metadata = await lookup();
  if (!metadata) {
    // syncMetadata only schedules the R2 HEAD, so wait for it to land.
    await client.mutation(syncMetadataMutation, { key });
    const deadline = Date.now() + metadataWaitMs();
    let delay = 250;
    while (!metadata && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.6, 2000);
      metadata = await lookup();
    }
  }
  if (!metadata?.url) {
    throw new UploadError(
      "Nothing was uploaded for this uploadId yet. PUT the file to its uploadUrl first.",
    );
  }
  return metadata;
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const IMAGE_FORMATS: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heif: "image/heif",
  tiff: "image/tiff",
};

const videoTypeFor = (declared: string | undefined, fileName: string | undefined) => {
  if (declared?.startsWith("video/")) return declared;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  return ext ? VIDEO_EXTENSIONS[ext] : undefined;
};

const hashStream = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new UploadError(`Could not read the uploaded file back (HTTP ${response.status}).`);
  }
  const hash = createHash("sha256");
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    size += value.byteLength;
  }
  return { contentHash: hash.digest("hex"), size };
};

const posterFromImage = async (buffer: Buffer) => {
  const poster = await sharp(buffer, { animated: false })
    .rotate()
    .resize({ width: POSTER_LONG_EDGE, height: POSTER_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return {
    base64: poster.data.toString("base64"),
    contentType: "image/jpeg",
    width: poster.info.width,
    height: poster.info.height,
    size: poster.info.size,
  };
};

export type UploadedMediaFields = {
  r2Key: string;
  r2Bucket?: string;
  mediaContentType: string;
  mediaContentHash: string;
  mediaSize: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaFileName?: string;
  posterFile?: Awaited<ReturnType<typeof posterFromImage>>;
};

/**
 * Turns an uploadId into the r2Key fields ingest:ingestFromApi takes. Images are
 * measured and get a card thumbnail. Videos are hashed; their thumbnail comes
 * from an optional poster image uploaded alongside (posterUploadId).
 */
export const resolveUploadedMedia = async (input: {
  ownerUserId: string;
  uploadId: string;
  posterUploadId?: string;
  fileName?: string;
  contentType?: string;
}): Promise<UploadedMediaFields> => {
  const key = await keyFromUploadId(input.uploadId, input.ownerUserId);
  const metadata = await readUploadedObject(input.ownerUserId, key);
  const declaredType = input.contentType ?? metadata.contentType;
  const videoType = videoTypeFor(declaredType, input.fileName);

  if (!videoType) {
    const response = await fetch(metadata.url);
    if (!response.ok) {
      throw new UploadError(`Could not read the uploaded file back (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    let info: Metadata;
    try {
      info = await sharp(buffer).metadata();
    } catch {
      throw new UploadError(
        "The uploaded file is not an image this server can read. For a video, pass contentType (e.g. video/mp4) or a fileName ending in .mp4/.mov/.webm.",
      );
    }
    const rotated = (info.orientation ?? 1) >= 5;
    return {
      r2Key: key,
      r2Bucket: metadata.bucket,
      mediaContentType: IMAGE_FORMATS[info.format ?? ""] ?? declaredType ?? "image/jpeg",
      mediaContentHash: createHash("sha256").update(buffer).digest("hex"),
      mediaSize: buffer.byteLength,
      mediaWidth: rotated ? info.height : info.width,
      mediaHeight: rotated ? info.width : info.height,
      mediaFileName: input.fileName,
      posterFile: await posterFromImage(buffer),
    };
  }

  const { contentHash, size } = await hashStream(metadata.url);
  let posterFile: UploadedMediaFields["posterFile"];
  if (input.posterUploadId) {
    const posterKey = await keyFromUploadId(input.posterUploadId, input.ownerUserId);
    const posterMeta = await readUploadedObject(input.ownerUserId, posterKey);
    const posterResponse = await fetch(posterMeta.url);
    if (posterResponse.ok) {
      posterFile = await posterFromImage(Buffer.from(await posterResponse.arrayBuffer())).catch(
        () => undefined,
      );
    }
  }

  return {
    r2Key: key,
    r2Bucket: metadata.bucket,
    mediaContentType: videoType,
    mediaContentHash: contentHash,
    mediaSize: size,
    // A poster frame has the video's own aspect ratio, which is what the
    // masonry needs; ffprobe isn't available on the server.
    mediaWidth: posterFile?.width,
    mediaHeight: posterFile?.height,
    mediaFileName: input.fileName,
    posterFile,
  };
};
