"use node";

import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { ownerAction } from "./actor";
import { storeBlobToR2 } from "./r2_store";
import { storeCardThumbnail } from "./thumbnails";
import { dedupeIds } from "./helpers";
import {
  buildXPostTitle,
  clampText,
  fxTwitterPostUrl,
  mergeXPostCapture,
  normalizeXHandle,
  parseXPostUrl,
  sanitizeHttpUrl,
  toOriginalXImageUrl,
  xPostFromFxTwitter,
  xPostFromSyndication,
  xSyndicationPostUrl,
  type FetchedXPost,
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
const findAssetsForXPostQuery = makeFunctionReference<"query">(
  "bookmarks:findAssetsForXPost",
);
const linkAssetsToBookmarkMutation = makeFunctionReference<"mutation">(
  "bookmarks:linkAssetsToBookmark",
);

// Every saved post carries these so the island bar's tag pills can find them.
export const X_POST_SYSTEM_TAGS = ["x", "bookmark"];
// What a piece already in the gallery gains when it is linked to its post.
export const BOOKMARK_TAG = "bookmark";
const FETCH_TIMEOUT_MS = 12_000;
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
  // Agent saves of a text post have no screenshot; the author's avatar
  // stands in as the stored image (the card itself shows the text).
  fallbackUrl?: string,
) => {
  if (preview?.base64.trim()) {
    const buffer = Buffer.from(stripDataUrlPrefix(preview.base64), "base64");
    return { buffer, contentType: preview.contentType?.trim() || "image/png" };
  }
  // No capture from the page: fall back to the post's first image or video
  // poster, fetched server-side. pbs.twimg.com serves these publicly.
  const firstUrl = media[0]?.url ?? fallbackUrl;
  if (!firstUrl) {
    throw new ConvexError(
      "A preview is required: send a screenshot of the post or a post with media.",
    );
  }
  const response = await fetch(firstUrl);
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

type NormalizedXPost = ReturnType<typeof normalizeCapturedXPost>;

type SaveXPostInput = {
  ownerUserId: string;
  post: NormalizedXPost;
  preview?: Infer<typeof previewValidator>;
  folderIds: Id<"folders">[];
  tagNames: string[];
  userNote?: string;
  ingestSource: "manual" | "agent";
  agentDescription?: string;
  // Assets already in the gallery that came from this post.
  existingAssetIds?: Id<"assets">[];
  previewFallbackUrl?: string;
};

type SaveXPostResult = {
  bookmarkId: Id<"bookmarks">;
  assetId: Id<"assets">;
  created: boolean;
  linkedAssetIds: Id<"assets">[];
};

// One save path for the extension and for agents. Idempotent per post: a
// re-save refreshes the captured fields and files the post into any newly
// picked collections. A post with no piece in the gallery yet gets a preview
// asset (assetRole "bookmark"); a post whose media is already saved is linked
// to those pieces instead, so nothing is stored twice.
const saveXPost = async (ctx: ActionCtx, input: SaveXPostInput): Promise<SaveXPostResult> => {
  const { ownerUserId, post, folderIds } = input;
  const systemTagIds = (await ctx.runMutation(getOrCreateTagsMutation, {
    names: dedupeIds(
      [...X_POST_SYSTEM_TAGS, ...input.tagNames].map((tag) => tag.trim()).filter(Boolean),
    ),
  })) as Id<"tags">[];

  const existing = (await ctx.runQuery(getBookmarkForSaveQuery, {
    ownerUserId,
    platform: post.platform,
    externalId: post.externalId,
  })) as { bookmarkId: Id<"bookmarks">; assetId?: Id<"assets"> } | null;
  const existingAssetIds = dedupeIds(input.existingAssetIds ?? []);
  const anchorAssetId = existing?.assetId ?? existingAssetIds[0];

  if (anchorAssetId) {
    const result = (await ctx.runMutation(upsertBookmarkRecordMutation, {
      ownerUserId,
      ...post,
      userNote: input.userNote,
      assetId: anchorAssetId,
    })) as { bookmarkId: Id<"bookmarks">; created: boolean };
    let linkedAssetIds: Id<"assets">[] = [];
    if (existingAssetIds.length > 0) {
      const [bookmarkTagId] = (await ctx.runMutation(getOrCreateTagsMutation, {
        names: [BOOKMARK_TAG],
      })) as Id<"tags">[];
      const linked = (await ctx.runMutation(linkAssetsToBookmarkMutation, {
        ownerUserId,
        bookmarkId: result.bookmarkId,
        assetIds: existingAssetIds,
        tagIds: bookmarkTagId ? [bookmarkTagId] : [],
      })) as { linked: Id<"assets">[] };
      linkedAssetIds = linked.linked;
    }
    if (folderIds.length > 0) {
      await ctx.runMutation(addAssetFoldersMutation, {
        ownerUserId,
        assetId: anchorAssetId,
        folderIds,
      });
    }
    return {
      bookmarkId: result.bookmarkId,
      assetId: anchorAssetId,
      created: result.created,
      linkedAssetIds,
    };
  }

  const { buffer, contentType } = await resolvePreviewBytes(
    input.preview,
    post.media,
    input.previewFallbackUrl,
  );
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
    tagIds: systemTagIds,
    folderId: primaryFolderId,
    // Deliberately no contentHash: a post's preview must never collapse
    // into an unrelated asset that happens to share the same bytes.
    ingestKey: `x-post:${post.externalId}`,
    pillar: BOOKMARK_PILLAR,
    generationType: "other",
    assetRole: "bookmark",
    ingestSource: input.ingestSource,
    ...(input.agentDescription
      ? { agentDescription: input.agentDescription, agentDescriptionSource: "agent" as const }
      : {}),
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
      userNote: input.userNote,
      assetId,
    })) as { bookmarkId: Id<"bookmarks">; created: boolean };
    return { bookmarkId: result.bookmarkId, assetId, created: result.created, linkedAssetIds: [] };
  } catch (error) {
    if (created.created) {
      await ctx.runMutation(deleteAssetMutation, { id: assetId });
    }
    throw error;
  }
};

// Save an X post from the extension: the post as read off the page, plus a
// crop of it as the preview when it has no media.
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
    const result = await saveXPost(ctx, {
      ownerUserId,
      post: normalizeCapturedXPost(args.post),
      preview: args.preview,
      folderIds: dedupeIds(args.folderIds ?? []),
      tagNames: args.tagNames ?? [],
      userNote: clampText(args.userNote, MAX_NOTE_LENGTH),
      ingestSource: "manual",
    });
    return { bookmarkId: result.bookmarkId, assetId: result.assetId, created: result.created };
  },
});

const fetchJson = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "laniameda-gallery/1.0", Accept: "application/json" },
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Reads a public post by id: the richer mirror first (counts, quote, alt
// text), X's own embed payload second. null when neither answers, which is
// what a deleted, private or age-gated post looks like.
export const fetchXPost = async (
  externalId: string,
  handle?: string,
): Promise<FetchedXPost | null> =>
  xPostFromFxTwitter(await fetchJson(fxTwitterPostUrl(externalId, handle))) ??
  xPostFromSyndication(await fetchJson(xSyndicationPostUrl(externalId)));

// Save an X post from its link, for agents. The gallery reads the post itself
// (author, text, media, quoted post, counts); `post` fills or corrects fields
// when the caller already has them, and is the only source when the post
// cannot be read publicly. Pieces already saved from this post are linked to
// it rather than copied.
export const saveXPostFromAgent = ownerAction({
  args: {
    ownerUserId: v.string(),
    url: v.string(),
    post: v.optional(
      v.object({
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
      }),
    ),
    preview: v.optional(previewValidator),
    folderIds: v.optional(v.array(v.id("folders"))),
    tagNames: v.optional(v.array(v.string())),
    userNote: v.optional(v.string()),
    agentDescription: v.optional(v.string()),
    // Explicit pieces to link; by default every asset whose sourceUrl is
    // this post's permalink.
    assetIds: v.optional(v.array(v.id("assets"))),
  },
  returns: v.object({
    bookmarkId: v.id("bookmarks"),
    assetId: v.id("assets"),
    created: v.boolean(),
    linkedAssetIds: v.array(v.id("assets")),
    url: v.string(),
    authorHandle: v.optional(v.string()),
    text: v.optional(v.string()),
    fetched: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const parsed = parseXPostUrl(args.url);
    if (!parsed) {
      throw new ConvexError("Not an X post URL. Expected https://x.com/<handle>/status/<id>.");
    }
    const fetched = await fetchXPost(parsed.externalId, parsed.authorHandle);
    if (!fetched && !args.post?.text && !(args.post?.media?.length ?? 0)) {
      throw new ConvexError(
        "The post could not be read (deleted, private or rate limited). Send its text and media in `post`.",
      );
    }
    const post = normalizeCapturedXPost(mergeXPostCapture(fetched, args.post, parsed.url));

    const existingAssetIds =
      args.assetIds ??
      ((await ctx.runQuery(findAssetsForXPostQuery, {
        ownerUserId,
        sourceUrls: [args.url.trim(), parsed.url, post.url],
      })) as Id<"assets">[]);

    const result = await saveXPost(ctx, {
      ownerUserId,
      post,
      preview: args.preview,
      folderIds: dedupeIds(args.folderIds ?? []),
      tagNames: args.tagNames ?? [],
      userNote: clampText(args.userNote, MAX_NOTE_LENGTH),
      ingestSource: "agent",
      agentDescription: clampText(args.agentDescription, 400),
      existingAssetIds,
      previewFallbackUrl: post.authorAvatarUrl,
    });
    return {
      ...result,
      url: post.url,
      authorHandle: post.authorHandle,
      text: post.text,
      fetched: Boolean(fetched),
    };
  },
});
