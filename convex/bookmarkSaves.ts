"use node";

import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { ownerAction } from "./actor";
import { storeBlobToR2 } from "./r2_store";
import { storeCardThumbnail } from "./thumbnails";
import { dedupeIds } from "./helpers";
import {
  buildXPostTitle,
  clampText,
  normalizeXHandle,
  parseXPostUrl,
  sanitizeHttpUrl,
  toOriginalXImageUrl,
} from "./bookmarkHelpers";
import {
  bookmarkMediaValidator,
  bookmarkMetricsValidator,
  bookmarkQuotedPostValidator,
} from "./validators";

const getBookmarkForSaveQuery = makeFunctionReference<"query">(
  "bookmarks:getBookmarkForSave",
);
const upsertBookmarkRecordMutation = makeFunctionReference<"mutation">(
  "bookmarks:upsertBookmarkRecord",
);
const getOrCreateTagsMutation = makeFunctionReference<"mutation">(
  "tags:getOrCreateTags",
);
const createAssetMutation = makeFunctionReference<"mutation">(
  "assets:createAsset",
);
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);
const deleteAssetMutation = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);

// Every saved post carries these so the island bar's tag pills can find them.
export const X_POST_SYSTEM_TAGS = ["x", "bookmark"];
const BOOKMARK_PILLAR = "bookmarks";
const MAX_TEXT_LENGTH = 4000;
const MAX_NOTE_LENGTH = 2000;
const MAX_MEDIA = 8;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;

// The post as the extension read it off the page. Loose on purpose: the
// action normalizes and drops whatever doesn't validate.
const capturedXPostValidator = v.object({
  url: v.string(),
  externalId: v.optional(v.string()),
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  authorAvatarUrl: v.optional(v.string()),
  authorVerified: v.optional(v.boolean()),
  text: v.optional(v.string()),
  lang: v.optional(v.string()),
  postedAt: v.optional(v.number()),
  media: v.optional(v.array(bookmarkMediaValidator)),
  quotedPost: v.optional(bookmarkQuotedPostValidator),
  metrics: v.optional(bookmarkMetricsValidator),
});

const previewValidator = v.object({
  base64: v.string(),
  contentType: v.optional(v.string()),
});

type CapturedXPost = Infer<typeof capturedXPostValidator>;

const toFiniteCount = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;

// Exported for tests: the normalized bookmark row fields for a capture.
export const normalizeCapturedXPost = (post: CapturedXPost) => {
  const parsed = parseXPostUrl(post.url);
  if (!parsed) {
    throw new ConvexError("Not an X post URL. Expected https://x.com/<handle>/status/<id>.");
  }
  const authorHandle = normalizeXHandle(post.authorHandle) ?? parsed.authorHandle;
  const url = authorHandle
    ? `https://x.com/${authorHandle}/status/${parsed.externalId}`
    : parsed.url;

  const media = (post.media ?? [])
    .map((item) => {
      const mediaUrl = sanitizeHttpUrl(item.url);
      if (!mediaUrl) return null;
      return {
        kind: item.kind,
        url: item.kind === "image" ? toOriginalXImageUrl(mediaUrl) : mediaUrl,
        width: toFiniteCount(item.width),
        height: toFiniteCount(item.height),
        alt: clampText(item.alt, 1000),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_MEDIA);

  const quoted = post.quotedPost
    ? {
        url: parseXPostUrl(post.quotedPost.url)?.url,
        authorName: clampText(post.quotedPost.authorName, 200),
        authorHandle: normalizeXHandle(post.quotedPost.authorHandle),
        text: clampText(post.quotedPost.text, MAX_TEXT_LENGTH),
      }
    : undefined;
  const hasQuoted = Boolean(quoted && (quoted.url || quoted.text));

  const metrics = post.metrics
    ? {
        replies: toFiniteCount(post.metrics.replies),
        reposts: toFiniteCount(post.metrics.reposts),
        likes: toFiniteCount(post.metrics.likes),
        bookmarks: toFiniteCount(post.metrics.bookmarks),
        views: toFiniteCount(post.metrics.views),
      }
    : undefined;
  const hasMetrics = Boolean(
    metrics && Object.values(metrics).some((value) => value !== undefined),
  );

  return {
    platform: "x" as const,
    externalId: parsed.externalId,
    url,
    authorName: clampText(post.authorName, 200),
    authorHandle,
    authorAvatarUrl: sanitizeHttpUrl(post.authorAvatarUrl),
    authorVerified: post.authorVerified,
    text: clampText(post.text, MAX_TEXT_LENGTH),
    lang: clampText(post.lang, 16),
    postedAt:
      typeof post.postedAt === "number" && Number.isFinite(post.postedAt) && post.postedAt > 0
        ? post.postedAt
        : undefined,
    media,
    quotedPost: hasQuoted ? quoted : undefined,
    metrics: hasMetrics ? metrics : undefined,
  };
};

const stripDataUrlPrefix = (value: string) => {
  const trimmed = value.trim();
  const marker = ";base64,";
  const markerIndex = trimmed.indexOf(marker);
  return trimmed.startsWith("data:") && markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length)
    : trimmed;
};

const resolvePreviewBytes = async (
  preview: Infer<typeof previewValidator> | undefined,
  media: { kind: string; url: string }[],
) => {
  if (preview?.base64.trim()) {
    const buffer = Buffer.from(stripDataUrlPrefix(preview.base64), "base64");
    return { buffer, contentType: preview.contentType?.trim() || "image/png" };
  }
  // No capture from the page: fall back to the post's first image or video
  // poster, fetched server-side. pbs.twimg.com serves these publicly.
  const first = media[0];
  if (!first) {
    throw new ConvexError(
      "A preview is required: send a screenshot of the post or a post with media.",
    );
  }
  const response = await fetch(first.url);
  if (!response.ok) {
    throw new ConvexError("Failed to fetch the post's media for a preview.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "image/jpeg",
  };
};

const previewFileName = (title: string, contentType: string) => {
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "x-post"}.${extension}`;
};

// Save an X post from the extension. Idempotent per post: a re-save refreshes
// the captured fields and files the post into any newly picked collections.
// The post's preview (a crop of the post as rendered, or its first image) is
// stored as an asset with assetRole "bookmark", so it lives in collections,
// search and the gallery grid like any other piece.
export const saveXPostFromExtension = ownerAction({
  args: {
    ownerUserId: v.string(),
    post: capturedXPostValidator,
    preview: v.optional(previewValidator),
    folderIds: v.optional(v.array(v.id("folders"))),
    tagNames: v.optional(v.array(v.string())),
    userNote: v.optional(v.string()),
  },
  returns: v.object({
    bookmarkId: v.id("bookmarks"),
    assetId: v.id("assets"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const post = normalizeCapturedXPost(args.post);
    const userNote = clampText(args.userNote, MAX_NOTE_LENGTH);
    const folderIds = dedupeIds(args.folderIds ?? []);
    const tagNames = dedupeIds(
      [...X_POST_SYSTEM_TAGS, ...(args.tagNames ?? [])]
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
    const tagIds = (await ctx.runMutation(getOrCreateTagsMutation, {
      names: tagNames,
    })) as Id<"tags">[];

    const existing = (await ctx.runQuery(getBookmarkForSaveQuery, {
      ownerUserId,
      platform: post.platform,
      externalId: post.externalId,
    })) as { bookmarkId: Id<"bookmarks">; assetId?: Id<"assets"> } | null;

    if (existing?.assetId) {
      const result = (await ctx.runMutation(upsertBookmarkRecordMutation, {
        ownerUserId,
        ...post,
        userNote,
        assetId: existing.assetId,
      })) as { bookmarkId: Id<"bookmarks"> };
      if (folderIds.length > 0) {
        await ctx.runMutation(addAssetFoldersMutation, {
          ownerUserId,
          assetId: existing.assetId,
          folderIds,
        });
      }
      return { bookmarkId: result.bookmarkId, assetId: existing.assetId, created: false };
    }

    const { buffer, contentType } = await resolvePreviewBytes(args.preview, post.media);
    if (!contentType.startsWith("image/")) {
      throw new ConvexError("The post preview must be an image.");
    }
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PREVIEW_BYTES) {
      throw new ConvexError("The post preview is empty or too large.");
    }
    const thumb = await storeCardThumbnail(ctx, buffer);
    if (!thumb) {
      throw new ConvexError("The post preview could not be decoded.");
    }
    const title = buildXPostTitle(post);
    const storageBlob = new Blob([buffer], { type: contentType });
    const [primaryFolderId, ...extraFolderIds] = folderIds;
    const created = (await ctx.runMutation(createAssetMutation, {
      ownerUserId,
      kind: "image",
      r2Key: await storeBlobToR2(ctx, storageBlob, { type: contentType }),
      thumbR2Key: thumb.r2Key,
      sourceUrl: post.url,
      fileName: previewFileName(title, contentType),
      contentType,
      size: storageBlob.size,
      width: thumb.sourceWidth,
      height: thumb.sourceHeight,
      thumbSize: thumb.size,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      tagIds,
      folderId: primaryFolderId,
      // Deliberately no contentHash: a post's preview must never collapse
      // into an unrelated asset that happens to share the same bytes.
      ingestKey: `x-post:${post.externalId}`,
      pillar: BOOKMARK_PILLAR,
      generationType: "other",
      assetRole: "bookmark",
      ingestSource: "manual",
    })) as { assetId: Id<"assets">; created: boolean };
    const assetId = created.assetId;

    try {
      if (extraFolderIds.length > 0) {
        await ctx.runMutation(addAssetFoldersMutation, {
          ownerUserId,
          assetId,
          folderIds: extraFolderIds,
        });
      }
      const result = (await ctx.runMutation(upsertBookmarkRecordMutation, {
        ownerUserId,
        ...post,
        userNote,
        assetId,
      })) as { bookmarkId: Id<"bookmarks">; created: boolean };
      return { bookmarkId: result.bookmarkId, assetId, created: result.created };
    } catch (error) {
      if (created.created) {
        await ctx.runMutation(deleteAssetMutation, { id: assetId });
      }
      throw error;
    }
  },
});
