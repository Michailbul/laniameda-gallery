// Automatic agent descriptions.
//
// Agents that save through the skill write `agentDescription` themselves. Every
// other path (browser extension, Telegram, bulk upload, older rows) arrives
// without one, so this pass looks at the asset's picture and writes a short,
// search-oriented description, marked agentDescriptionSource: "auto". It never
// overwrites a description an agent wrote. Off unless the deployment sets
// AGENT_DESCRIPTIONS_ENABLED=true.

import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { normalizeAgentDescription, sourceDomainOf } from "./agentDescriptionText";
import { dedupeIds } from "./helpers";

const reindexAssetActionRef = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);
const getDescribeSourceRef = makeFunctionReference<"query">(
  "agentDescriptions:getDescribeSource",
);
const saveAutoDescriptionRef = makeFunctionReference<"mutation">(
  "agentDescriptions:saveAutoDescription",
);
const describeAssetRef = makeFunctionReference<"action">(
  "agentDescriptions:describeAsset",
);
const listAssetsMissingDescriptionRef = makeFunctionReference<"query">(
  "agentDescriptions:listAssetsMissingDescription",
);
const backfillAgentDescriptionsRef = makeFunctionReference<"action">(
  "agentDescriptions:backfillAgentDescriptions",
);

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
// Images above this are skipped for the vision call; thumbnails are ~50 KB.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const isEnabled = () =>
  process.env.AGENT_DESCRIPTIONS_ENABLED?.trim().toLowerCase() === "true";

const getModel = () =>
  process.env.AGENT_DESCRIPTION_MODEL?.trim() || DEFAULT_MODEL;

const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key.length < 10) {
    throw new Error("GEMINI_API_KEY is missing or invalid for agent descriptions.");
  }
  return key;
};

const describeSourceValidator = v.union(
  v.null(),
  v.object({
    assetId: v.id("assets"),
    kind: v.union(v.literal("image"), v.literal("video")),
    agentDescription: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageContentType: v.optional(v.string()),
    promptText: v.optional(v.string()),
    description: v.optional(v.string()),
    tagNames: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    modelName: v.optional(v.string()),
  }),
);

type DescribeSource = {
  assetId: Id<"assets">;
  kind: "image" | "video";
  agentDescription?: string;
  imageUrl?: string;
  imageContentType?: string;
  promptText?: string;
  description?: string;
  tagNames: string[];
  sourceUrl?: string;
  modelName?: string;
};

// A picture the vision model can read: the card thumbnail when there is one
// (small, and the only still a video has), otherwise the image itself.
const hasDescribablePicture = (asset: Doc<"assets">) =>
  Boolean(asset.thumbR2Key || asset.thumbStorageId) ||
  (asset.kind === "image" && Boolean(asset.r2Key || asset.storageId));

export const getDescribeSource = internalQuery({
  args: { assetId: v.id("assets") },
  returns: describeSourceValidator,
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }

    const thumbUrl =
      asset.thumbR2Key || asset.thumbStorageId
        ? await resolveAssetThumbUrl(ctx, asset)
        : undefined;
    const imageUrl =
      thumbUrl ??
      (asset.kind === "image" ? await resolveAssetUrl(ctx, asset) : undefined);
    const prompt = asset.promptId ? await ctx.db.get(asset.promptId) : null;
    const tags = await Promise.all(
      dedupeIds(asset.tagIds).map(async (tagId) => await ctx.db.get(tagId)),
    );

    return {
      assetId: asset._id,
      kind: asset.kind,
      agentDescription: asset.agentDescription,
      imageUrl: imageUrl ?? undefined,
      imageContentType: thumbUrl ? undefined : asset.contentType,
      promptText: prompt?.text,
      description: asset.description,
      tagNames: tags.flatMap((tag) => (tag ? [tag.name] : [])),
      sourceUrl: asset.sourceUrl,
      modelName: asset.modelName,
    };
  },
});

export const saveAutoDescription = internalMutation({
  args: {
    assetId: v.id("assets"),
    agentDescription: v.string(),
    // Replace an earlier automatic description (never an agent-written one).
    replaceAuto: v.optional(v.boolean()),
    // Backfill: refresh only the text lane, never the multimodal model.
    textOnlyReindex: v.optional(v.boolean()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    const agentDescription = normalizeAgentDescription(args.agentDescription);
    if (!asset || !agentDescription) {
      return false;
    }
    // An agent may have written one while the vision call ran.
    if (asset.agentDescription) {
      const canReplace =
        args.replaceAuto === true && asset.agentDescriptionSource === "auto";
      if (!canReplace) return false;
    }

    await ctx.db.patch(asset._id, {
      agentDescription,
      agentDescriptionSource: "auto",
      agentDescribedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, reindexAssetActionRef, {
      assetId: asset._id,
      ...(args.textOnlyReindex ? { textOnly: true } : {}),
    });
    return true;
  },
});

const clip = (value: string | undefined, max: number) => {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
};

export const buildDescribePrompt = (source: DescribeSource) => {
  const context = [
    source.tagNames.length > 0 ? `Tags: ${source.tagNames.join(", ")}` : undefined,
    clip(source.description, 300) ? `Caption: ${clip(source.description, 300)}` : undefined,
    clip(source.promptText, 600)
      ? `Generation prompt: ${clip(source.promptText, 600)}`
      : undefined,
    source.modelName ? `Model: ${source.modelName}` : undefined,
    sourceDomainOf(source.sourceUrl) ? `Source: ${sourceDomainOf(source.sourceUrl)}` : undefined,
    source.kind === "video" ? "This picture is the poster frame of a video." : undefined,
  ].filter(Boolean);

  return [
    "You write the description for one item in a creative reference archive.",
    "Agents search these descriptions later to find references, so be concrete.",
    "Write one or two plain sentences, 45 words at most:",
    "first what it shows (subject, setting, action; name concrete things),",
    "then how it looks (medium such as photo, 3D render, illustration, animation still or UI screenshot; style; lighting; framing).",
    'Do not begin with "This image" or "The image". No opinions, hashtags, quotes or lists.',
    context.length > 0
      ? `Archive context, use it only where it agrees with the picture:\n${context.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

class DescribeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const describeImageWithGemini = async (
  imageUrl: string,
  prompt: string,
  imageContentType?: string,
) => {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new DescribeError(`Image fetch failed (${imageResponse.status}).`);
  }
  const bytes = await imageResponse.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new DescribeError("Image too large to describe.");
  }
  const mimeType =
    imageResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
    imageContentType ||
    "image/jpeg";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${getModel()}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getApiKey(),
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: arrayBufferToBase64(bytes) } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new DescribeError(
      `Gemini describe request failed (${response.status}): ${bodyText.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join(" ")
    .replace(/^["'\s]+|["'\s]+$/g, "");
  return normalizeAgentDescription(text);
};

export const describeAsset = internalAction({
  args: {
    assetId: v.id("assets"),
    attempt: v.optional(v.number()),
    // Re-describe an asset whose description came from this pass.
    replaceAuto: v.optional(v.boolean()),
    // createAsset deferred the asset's first index to this action: index it
    // whatever the outcome.
    reindexAfter: v.optional(v.boolean()),
    // Called from the backfill: reindex the text lane only.
    backfill: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("described"),
      v.literal("disabled"),
      v.literal("missing"),
      v.literal("exists"),
      v.literal("no_image"),
      v.literal("empty"),
      v.literal("error"),
    ),
    retryScheduled: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    // Every exit that doesn't save a description still owes the asset its
    // index when createAsset deferred it here.
    const indexAnyway = async () => {
      if (args.reindexAfter) {
        await ctx.scheduler.runAfter(0, reindexAssetActionRef, { assetId: args.assetId });
      }
    };

    if (!isEnabled()) {
      await indexAnyway();
      return { status: "disabled" as const };
    }

    const source = (await ctx.runQuery(getDescribeSourceRef, {
      assetId: args.assetId,
    })) as DescribeSource | null;
    if (!source) {
      return { status: "missing" as const };
    }
    if (source.agentDescription && args.replaceAuto !== true) {
      await indexAnyway();
      return { status: "exists" as const };
    }
    if (!source.imageUrl) {
      await indexAnyway();
      return { status: "no_image" as const };
    }

    try {
      const agentDescription = await describeImageWithGemini(
        source.imageUrl,
        buildDescribePrompt(source),
        source.imageContentType,
      );
      if (!agentDescription) {
        await indexAnyway();
        return { status: "empty" as const };
      }
      const saved = (await ctx.runMutation(saveAutoDescriptionRef, {
        assetId: args.assetId,
        agentDescription,
        replaceAuto: args.replaceAuto,
        ...(args.backfill ? { textOnlyReindex: true } : {}),
      })) as boolean;
      if (!saved) await indexAnyway();
      return { status: "described" as const };
    } catch (error) {
      const status = error instanceof DescribeError ? error.status : undefined;
      const attempt = args.attempt ?? 0;
      const retryable =
        (status === undefined || RETRYABLE_STATUSES.has(status)) &&
        attempt < RETRY_DELAYS_MS.length;
      if (retryable) {
        await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt]!, describeAssetRef, {
          assetId: args.assetId,
          attempt: attempt + 1,
          replaceAuto: args.replaceAuto,
          reindexAfter: args.reindexAfter,
          backfill: args.backfill,
        });
      } else {
        await indexAnyway();
      }
      console.warn(
        `[agentDescriptions] ${args.assetId}: ${error instanceof Error ? error.message : error}`,
      );
      return { status: "error" as const, retryScheduled: retryable };
    }
  },
});

// One page of assets that still need a description and have a picture.
export const listAssetsMissingDescription = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    replaceAuto: v.optional(v.boolean()),
  },
  returns: v.object({
    assetIds: v.array(v.id("assets")),
    scanned: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("assets")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", 0))
      .order("asc")
      .paginate(args.paginationOpts);

    const assetIds = page.page
      .filter((asset) => hasDescribablePicture(asset))
      .filter((asset) =>
        args.replaceAuto
          ? !asset.agentDescription || asset.agentDescriptionSource === "auto"
          : !asset.agentDescription,
      )
      .map((asset) => asset._id);

    return {
      assetIds,
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

// Walk the vault and describe every asset that lacks a description. Calls
// are staggered by `spacingMs` to stay under Gemini's per-minute quota, and
// the action reschedules itself page by page until done. `dryRun` only
// counts. Run: bunx convex run agentDescriptions:backfillAgentDescriptions '{"dryRun":true}'
export const backfillAgentDescriptions = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    spacingMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    replaceAuto: v.optional(v.boolean()),
  },
  returns: v.object({
    scheduled: v.number(),
    scanned: v.number(),
    done: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(args.pageSize ?? 100, 1), 500);
    const spacingMs = Math.max(args.spacingMs ?? 1_500, 200);

    if (args.dryRun) {
      let cursor: string | null = args.cursor ?? null;
      let scanned = 0;
      let missing = 0;
      for (;;) {
        const page = (await ctx.runQuery(listAssetsMissingDescriptionRef, {
          paginationOpts: { cursor, numItems: 500 },
          replaceAuto: args.replaceAuto,
        })) as { assetIds: Id<"assets">[]; scanned: number; continueCursor: string; isDone: boolean };
        scanned += page.scanned;
        missing += page.assetIds.length;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return { scheduled: missing, scanned, done: true };
    }

    if (!isEnabled()) {
      throw new Error("Set AGENT_DESCRIPTIONS_ENABLED=true on the deployment first.");
    }

    const page = (await ctx.runQuery(listAssetsMissingDescriptionRef, {
      paginationOpts: { cursor: args.cursor ?? null, numItems: pageSize },
      replaceAuto: args.replaceAuto,
    })) as { assetIds: Id<"assets">[]; scanned: number; continueCursor: string; isDone: boolean };

    await Promise.all(
      page.assetIds.map(async (assetId, index) =>
        await ctx.scheduler.runAfter(index * spacingMs, describeAssetRef, {
          assetId,
          replaceAuto: args.replaceAuto,
          backfill: true,
        }),
      ),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        Math.max(page.assetIds.length, 1) * spacingMs,
        backfillAgentDescriptionsRef,
        {
          cursor: page.continueCursor,
          pageSize,
          spacingMs,
          replaceAuto: args.replaceAuto,
        },
      );
    }

    return {
      scheduled: page.assetIds.length,
      scanned: page.scanned,
      done: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});
