"use node";

import { Jimp, JimpMime } from "jimp";
import { action, type ActionCtx } from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { storeBlobToR2 } from "./r2_store";

import {
  buildDesignSourceFingerprint,
  normalizeSourceUrl,
  resolveDesignInspirationType,
  resolveDesignSaveIntent,
  trimOptionalText,
} from "./designSaveHelpers";
import { dedupeIds } from "./helpers";
import {
  designCaptureKindValidator,
  designInspirationTypeValidator,
  designPlatformValidator,
  designSaveIntentValidator,
  optionalPillarValidator,
  workflowTypeValidator,
} from "./validators";

const THUMB_WIDTH = 420;

const getDesignInspirationBySourceFingerprintQuery = makeFunctionReference<"query">(
  "designInspirations:getDesignInspirationIdForSourceFingerprint",
);
const getDesignInspirationQuery = makeFunctionReference<"query">(
  "designInspirations:getDesignInspiration",
);
const getDesignSaveTemplateByKeyQuery = makeFunctionReference<"query">(
  "designSaveTemplates:getDesignSaveTemplateByKey",
);
const getOrCreateTagsMutation = makeFunctionReference<"mutation">(
  "tags:getOrCreateTags",
);
const createAssetMutation = makeFunctionReference<"mutation">(
  "assets:createAsset",
);
const deleteAssetMutation = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);
const createDesignInspirationMutation = makeFunctionReference<"mutation">(
  "designInspirations:createDesignInspiration",
);
const updateDesignInspirationMutation = makeFunctionReference<"mutation">(
  "designInspirations:updateDesignInspiration",
);

const pageCaptureValidator = v.object({
  mode: v.literal("page"),
  sourceUrl: v.string(),
  sourceTitle: v.optional(v.string()),
  title: v.optional(v.string()),
  screenshotBase64: v.string(),
  screenshotContentType: v.optional(v.string()),
});

const imageCaptureValidator = v.object({
  mode: v.literal("image"),
  imageUrl: v.string(),
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  title: v.optional(v.string()),
  imageBase64: v.optional(v.string()),
  imageContentType: v.optional(v.string()),
});

const stripDataUrlPrefix = (value: string) => {
  const trimmed = value.trim();
  const marker = ";base64,";
  const markerIndex = trimmed.indexOf(marker);
  if (trimmed.startsWith("data:") && markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length);
  }
  return trimmed;
};

const blobFromBase64 = (base64: string, contentType: string) => {
  const binary = Buffer.from(stripDataUrlPrefix(base64), "base64");
  return new Blob([binary], { type: contentType || "application/octet-stream" });
};

const fetchRemoteImage = async (imageUrl: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new ConvexError("Failed to fetch remote image.");
  }

  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "image/png";
  return {
    blob,
    contentType,
  };
};

const resolvePreviewInput = async (args: Infer<typeof imageCaptureValidator>) => {
  const imageBase64 = trimOptionalText(args.imageBase64);
  const imageContentType = trimOptionalText(args.imageContentType);
  if (imageBase64) {
    return {
      blob: blobFromBase64(imageBase64, imageContentType || "image/png"),
      contentType: imageContentType || "image/png",
    };
  }

  return await fetchRemoteImage(args.imageUrl);
};

const buildFallbackTitle = (sourceUrl?: string) => {
  const normalized = trimOptionalText(sourceUrl);
  if (!normalized) {
    return "Saved design reference";
  }

  try {
    const parsed = new URL(normalized);
    const lastPathToken = parsed.pathname
      .split("/")
      .map((token) => token.trim())
      .filter(Boolean)
      .pop();
    if (lastPathToken) {
      return decodeURIComponent(lastPathToken).replace(/[-_]+/g, " ");
    }
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return normalized;
  }
};

const buildPreviewFileName = (args: {
  title?: string;
  contentType: string;
}) => {
  const extension = args.contentType.includes("png") ? "png" : "jpg";
  const base = (args.title ?? "saved-design-reference")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "saved-design-reference"}.${extension}`;
};

const createThumbMetadata = async (
  ctx: ActionCtx,
  fileBuffer: Buffer,
  contentType: string,
) => {
  const originalImage = await Jimp.read(fileBuffer);
  const originalWidth = originalImage.bitmap.width;
  const originalHeight = originalImage.bitmap.height;
  const generatedThumbHeight =
    originalWidth && originalHeight
      ? Math.max(1, Math.round((THUMB_WIDTH * originalHeight) / originalWidth))
      : THUMB_WIDTH;
  const thumb = originalImage.clone().resize({ w: THUMB_WIDTH, h: generatedThumbHeight });
  const thumbMime =
    contentType.includes("png") && contentType !== "image/jpeg"
      ? JimpMime.png
      : JimpMime.jpeg;
  const thumbBuffer = await thumb.getBuffer(thumbMime);
  const thumbBlob = new Blob(
    [
      thumbBuffer.buffer.slice(
        thumbBuffer.byteOffset,
        thumbBuffer.byteOffset + thumbBuffer.byteLength,
      ) as ArrayBuffer,
    ],
    { type: thumbMime },
  );

  return {
    width: originalWidth ?? undefined,
    height: originalHeight ?? undefined,
    thumbR2Key: await storeBlobToR2(ctx, thumbBlob, { type: thumbMime }),
    thumbWidth: thumb.bitmap.width ?? undefined,
    thumbHeight: thumb.bitmap.height ?? undefined,
    thumbSize: thumbBuffer.byteLength,
  };
};

const createPreviewAsset = async (ctx: ActionCtx, args: {
  ownerUserId: string;
  pillar: Infer<typeof optionalPillarValidator>;
  assetSourceUrl?: string;
  previewBlob: Blob;
  previewContentType: string;
  previewTitle?: string;
  tagIds: Id<"tags">[];
  sourceFingerprint: string;
}) => {
  const arrayBuffer = await args.previewBlob.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const contentType = args.previewContentType || args.previewBlob.type || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new ConvexError("Design save preview must be an image.");
  }

  const pillar = args.pillar ?? "designs";
  const thumb = await createThumbMetadata(ctx, fileBuffer, contentType);
  const storageBlob = new Blob([fileBuffer], { type: contentType });
  const result = (await ctx.runMutation(createAssetMutation, {
    ownerUserId: args.ownerUserId,
    kind: "image",
    r2Key: await storeBlobToR2(ctx, storageBlob, { type: contentType }),
    thumbR2Key: thumb.thumbR2Key,
    sourceUrl: args.assetSourceUrl,
    fileName: buildPreviewFileName({
      title: args.previewTitle,
      contentType,
    }),
    contentType,
    size: storageBlob.size,
    width: thumb.width,
    height: thumb.height,
    thumbSize: thumb.thumbSize,
    thumbWidth: thumb.thumbWidth,
    thumbHeight: thumb.thumbHeight,
    tagIds: args.tagIds,
    ingestKey: `design-preview:${args.sourceFingerprint}`.slice(0, 500),
    pillar,
    generationType: pillar === "designs" ? "ui_design" : "other",
    assetRole: pillar === "designs" ? "reference" : "inspiration_capture",
    ingestSource: "manual",
  })) as { assetId: Id<"assets">; created: boolean };

  return result.assetId;
};

export const saveFromExtension = action({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    description: v.optional(v.string()),
    capture: v.union(pageCaptureValidator, imageCaptureValidator),
    captureKind: v.optional(designCaptureKindValidator),
    saveIntent: v.optional(designSaveIntentValidator),
    inspirationType: v.optional(designInspirationTypeValidator),
    platform: designPlatformValidator,
    workflowType: workflowTypeValidator,
    tagNames: v.optional(v.array(v.string())),
    userNote: v.optional(v.string()),
    templateKey: v.optional(v.string()),
  },
  returns: v.object({
    designInspirationId: v.id("designInspirations"),
    assetId: v.id("assets"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const requestedTemplateKey = trimOptionalText(args.templateKey);
    const template = requestedTemplateKey
      ? ((await ctx.runQuery(getDesignSaveTemplateByKeyQuery, {
          ownerUserId,
          key: requestedTemplateKey,
        })) as {
          key: string;
          defaults: {
            captureKind?: Infer<typeof designCaptureKindValidator>;
            saveIntent?: Infer<typeof designSaveIntentValidator>;
            inspirationType?: Infer<typeof designInspirationTypeValidator>;
            platform?: Infer<typeof designPlatformValidator>;
            workflowType?: Infer<typeof workflowTypeValidator>;
            tagNames?: string[];
          };
        } | null)
      : null;
    if (requestedTemplateKey && !template) {
      throw new ConvexError("Design save template not found.");
    }

    const captureKind =
      args.captureKind ??
      template?.defaults.captureKind ??
      (args.capture.mode === "image" ? "image" : "website");
    const saveIntent = resolveDesignSaveIntent(
      captureKind,
      args.saveIntent ?? template?.defaults.saveIntent,
    );
    const sourceUrl =
      args.capture.mode === "page"
        ? normalizeSourceUrl(args.capture.sourceUrl)
        : normalizeSourceUrl(args.capture.sourceUrl ?? args.capture.imageUrl);
    const previewSourceUrl =
      args.capture.mode === "image"
        ? normalizeSourceUrl(args.capture.imageUrl)
        : sourceUrl;
    const sourceFingerprint = buildDesignSourceFingerprint({
      captureKind,
      sourceUrl,
      imageUrl: args.capture.mode === "image" ? args.capture.imageUrl : undefined,
    });

    if (!sourceFingerprint) {
      throw new ConvexError("A stable source fingerprint could not be created.");
    }

    const title =
      trimOptionalText(args.capture.title) ??
      trimOptionalText(args.capture.sourceTitle) ??
      buildFallbackTitle(sourceUrl);
    const tagNames = dedupeIds(
      [...(template?.defaults.tagNames ?? []), ...(args.tagNames ?? [])]
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
    const tagIds = tagNames.length
      ? ((await ctx.runMutation(getOrCreateTagsMutation, { names: tagNames })) as Id<"tags">[])
      : [];

    const existingId = (await ctx.runQuery(getDesignInspirationBySourceFingerprintQuery, {
      ownerUserId,
      sourceFingerprint,
    })) as Id<"designInspirations"> | null;

    if (existingId) {
      const existing = (await ctx.runQuery(getDesignInspirationQuery, {
        id: existingId,
        ownerUserId,
      })) as {
        _id: Id<"designInspirations">;
        pillar?: Infer<typeof optionalPillarValidator>;
        title?: string;
        summary?: string;
        description?: string;
        sourceTitle?: string;
        userNote?: string;
        sourceUrl?: string;
        sourceFingerprint?: string;
        inspirationType: Infer<typeof designInspirationTypeValidator>;
        platform?: Infer<typeof designPlatformValidator>;
        workflowType?: Infer<typeof workflowTypeValidator>;
        status?: "active" | "archived";
        captureKind?: Infer<typeof designCaptureKindValidator>;
        saveIntent?: Infer<typeof designSaveIntentValidator>;
        templateKey?: string;
        tagIds: Id<"tags">[];
        folderId?: Id<"folders">;
        assetId?: Id<"assets">;
        promptId?: Id<"prompts">;
      } | null;
      if (!existing) {
        throw new ConvexError("Existing design inspiration could not be loaded.");
      }

      let assetId = existing.assetId;
      let createdAssetId: Id<"assets"> | undefined;
      if (!assetId) {
        const preview =
          args.capture.mode === "page"
            ? {
                blob: blobFromBase64(
                  args.capture.screenshotBase64,
                  args.capture.screenshotContentType || "image/png",
                ),
                contentType: args.capture.screenshotContentType || "image/png",
              }
            : await resolvePreviewInput(args.capture);
        assetId = await createPreviewAsset(ctx, {
          ownerUserId,
          pillar: args.pillar ?? existing.pillar ?? "designs",
          assetSourceUrl: previewSourceUrl,
          previewBlob: preview.blob,
          previewContentType: preview.contentType,
          previewTitle: title,
          tagIds: dedupeIds([...existing.tagIds, ...tagIds]),
          sourceFingerprint,
        });
        createdAssetId = assetId;
      }

      try {
        await ctx.runMutation(updateDesignInspirationMutation, {
          ownerUserId,
          id: existing._id,
          pillar: args.pillar ?? existing.pillar,
          title: title ?? existing.title,
          summary: existing.summary,
          description: trimOptionalText(args.description) ?? existing.description,
          sourceTitle: trimOptionalText(args.capture.sourceTitle) ?? existing.sourceTitle,
          userNote: trimOptionalText(args.userNote) ?? existing.userNote,
          sourceUrl: sourceUrl ?? existing.sourceUrl,
          inspirationType: resolveDesignInspirationType(
            captureKind,
            args.inspirationType ?? template?.defaults.inspirationType ?? existing.inspirationType,
          ),
          platform: args.platform ?? template?.defaults.platform ?? existing.platform,
          workflowType:
            args.workflowType ?? template?.defaults.workflowType ?? existing.workflowType,
          status: existing.status ?? "active",
          captureKind: captureKind ?? existing.captureKind,
          saveIntent: saveIntent ?? existing.saveIntent,
          templateKey: requestedTemplateKey ?? existing.templateKey,
          sourceFingerprint,
          tagIds: dedupeIds([...existing.tagIds, ...tagIds]),
          folderId: existing.folderId,
          assetId,
          promptId: existing.promptId,
        });
      } catch (error) {
        if (createdAssetId) {
          await ctx.runMutation(deleteAssetMutation, {
            id: createdAssetId,
          });
        }
        throw error;
      }

      return {
        designInspirationId: existing._id,
        assetId,
        created: false,
      };
    }

    const preview =
      args.capture.mode === "page"
        ? {
            blob: blobFromBase64(
              args.capture.screenshotBase64,
              args.capture.screenshotContentType || "image/png",
            ),
            contentType: args.capture.screenshotContentType || "image/png",
          }
        : await resolvePreviewInput(args.capture);
    const assetId = await createPreviewAsset(ctx, {
      ownerUserId,
      pillar: args.pillar ?? "designs",
      assetSourceUrl: previewSourceUrl,
      previewBlob: preview.blob,
      previewContentType: preview.contentType,
      previewTitle: title,
      tagIds,
      sourceFingerprint,
    });

    let result: { designInspirationId: Id<"designInspirations">; created: boolean };
    try {
      result = (await ctx.runMutation(createDesignInspirationMutation, {
        ownerUserId,
        pillar: args.pillar ?? "designs",
        title,
        description: trimOptionalText(args.description),
        sourceTitle: trimOptionalText(args.capture.sourceTitle),
        userNote: trimOptionalText(args.userNote),
        sourceUrl,
        inspirationType: resolveDesignInspirationType(
          captureKind,
          args.inspirationType ?? template?.defaults.inspirationType,
        ),
        platform: args.platform ?? template?.defaults.platform,
        workflowType: args.workflowType ?? template?.defaults.workflowType,
        captureKind,
        saveIntent,
        templateKey: requestedTemplateKey,
        sourceFingerprint,
        tagIds,
        ingestKey: `design:${sourceFingerprint}`.slice(0, 500),
        assetId,
      })) as { designInspirationId: Id<"designInspirations">; created: boolean };
    } catch (error) {
      await ctx.runMutation(deleteAssetMutation, {
        id: assetId,
      });
      throw error;
    }

    return {
      designInspirationId: result.designInspirationId,
      assetId,
      created: result.created,
    };
  },
});
