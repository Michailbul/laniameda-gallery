// Cached agent inventory.
//
// A complete inventory used to mean paging every asset through
// list_assets_page: each traversal read every asset row with its prompt, tags
// and collection links (~3 KB an asset, ~15 MB for the whole gallery), and
// agents repeated it per session. This builds that same default listing
// (Skill step media excluded, hidden collections included) once, stores it in
// R2 as JSON parts of at most ~3 MB, and serves the snapshot until it is older
// than the caller's maxAgeMinutes (default 24 h). Assets saved after the
// snapshot are appended from an indexed read of the newest assets. A rebuild
// costs one traversal; reading the snapshot costs one small row.
//
// The parts sit under random keys and are only ever fetched server-side by
// /api/agent/inventory; agents never receive an R2 key or URL.

import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ownerAction } from "./actor";
import { resolveUserIdCandidates } from "./authz";
import { galleryAssetResultValidator, hydrateGalleryAssetResults } from "./galleryAssetResults";
import { isHiddenSkillExample } from "./assets";
import { r2 } from "./r2";
import { storeBlobToR2 } from "./r2_store";

export const INVENTORY_EXPORT_VERSION = 1;
const DEFAULT_MAX_AGE_MINUTES = 24 * 60;
// A forced refresh within this window returns the snapshot just built.
const MIN_REBUILD_INTERVAL_MINUTES = 15;
const MAX_AGE_LIMIT_MINUTES = 7 * 24 * 60;
// A build that has not finished in this long is treated as abandoned.
const BUILD_LEASE_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;
// Vercel caps a function response at 4.5 MB; the route streams one part.
const PART_BYTES = 3 * 1024 * 1024;
const NEWER_ASSET_LIMIT = 200;

const getExportRowRef = makeFunctionReference<"query">("inventoryExport:getExportRow");
const claimBuildRef = makeFunctionReference<"mutation">("inventoryExport:claimExportBuild");
const finishBuildRef = makeFunctionReference<"mutation">("inventoryExport:finishExportBuild");
const releaseBuildRef = makeFunctionReference<"mutation">("inventoryExport:releaseExportBuild");
const listPageRef = makeFunctionReference<"query">("inventoryExport:listExportPage");
const listFoldersRef = makeFunctionReference<"query">("inventoryExport:listExportFolders");
const listNewerRef = makeFunctionReference<"query">("inventoryExport:listAssetsCreatedAfter");

const partValidator = v.object({ key: v.string(), count: v.number(), bytes: v.number() });
const exportRowValidator = v.object({
  _id: v.id("inventoryExports"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  generatedAt: v.optional(v.number()),
  assetCount: v.number(),
  folderCount: v.number(),
  byteSize: v.number(),
  parts: v.array(partValidator),
  newestCreatedAt: v.optional(v.number()),
  buildingSince: v.optional(v.number()),
  updatedAt: v.number(),
});
const exportFolderValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  parentFolderId: v.optional(v.id("folders")),
  kind: v.optional(v.literal("storybook")),
  slug: v.optional(v.string()),
  showcased: v.optional(v.boolean()),
  hiddenFromGallery: v.optional(v.boolean()),
  memberCount: v.optional(v.number()),
});

type ExportRow = Doc<"inventoryExports">;
type ExportPart = { key: string; count: number; bytes: number };
type ExportFolder = {
  _id: Id<"folders">; name: string; parentFolderId?: Id<"folders">; kind?: "storybook";
  slug?: string; showcased?: boolean; hiddenFromGallery?: boolean; memberCount?: number;
};

const findRow = async (ctx: QueryCtx, ownerUserId: string): Promise<ExportRow | null> =>
  await ctx.db.query("inventoryExports")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .first();

export const getExportRow = internalQuery({
  args: { ownerUserId: v.string() },
  returns: v.union(v.null(), exportRowValidator),
  handler: async (ctx, args) => await findRow(ctx, args.ownerUserId),
});

export const claimExportBuild = internalMutation({
  args: { ownerUserId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await findRow(ctx, args.ownerUserId);
    if (row?.buildingSince && args.now - row.buildingSince < BUILD_LEASE_MS) return false;
    if (row) {
      await ctx.db.patch(row._id, { buildingSince: args.now, updatedAt: args.now });
    } else {
      await ctx.db.insert("inventoryExports", {
        ownerUserId: args.ownerUserId, assetCount: 0, folderCount: 0, byteSize: 0, parts: [],
        buildingSince: args.now, updatedAt: args.now,
      });
    }
    return true;
  },
});

// Publishes a finished build and returns the previous parts' keys for
// deletion. A build that lost its lease to a newer one is discarded instead.
export const finishExportBuild = internalMutation({
  args: {
    ownerUserId: v.string(),
    buildStartedAt: v.number(),
    generatedAt: v.number(),
    assetCount: v.number(),
    folderCount: v.number(),
    byteSize: v.number(),
    parts: v.array(partValidator),
    newestCreatedAt: v.optional(v.number()),
  },
  returns: v.object({ published: v.boolean(), staleKeys: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const row = await findRow(ctx, args.ownerUserId);
    const { ownerUserId: _owner, buildStartedAt, ...fields } = args;
    if (!row || row.buildingSince !== buildStartedAt) {
      return { published: false, staleKeys: args.parts.map((part) => part.key) };
    }
    await ctx.db.patch(row._id, { ...fields, buildingSince: undefined, updatedAt: Date.now() });
    return { published: true, staleKeys: row.parts.map((part) => part.key) };
  },
});

export const releaseExportBuild = internalMutation({
  args: { ownerUserId: v.string(), buildStartedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await findRow(ctx, args.ownerUserId);
    if (row?.buildingSince === args.buildStartedAt) {
      await ctx.db.patch(row._id, { buildingSince: undefined, updatedAt: Date.now() });
    }
    return null;
  },
});

// One page of the default inventory: every owner spelling in turn, newest
// first, Skill step media left out, hydrated like list_assets_page.
export const listExportPage = internalQuery({
  args: {
    ownerUserId: v.string(),
    ownerIndex: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    assets: v.array(galleryAssetResultValidator),
    ownerIndex: v.number(),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const owners = resolveUserIdCandidates(args.ownerUserId);
    const owner = owners[args.ownerIndex];
    if (!owner) throw new ConvexError("Invalid inventory owner position.");
    const page = await ctx.db.query("assets")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner))
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    const assets = await hydrateGalleryAssetResults(ctx, page.page.filter((asset) => !isHiddenSkillExample(asset)));
    const lastOwner = args.ownerIndex === owners.length - 1;
    return {
      assets,
      ownerIndex: page.isDone && !lastOwner ? args.ownerIndex + 1 : args.ownerIndex,
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone && lastOwner,
    };
  },
});

export const listExportFolders = internalQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(exportFolderValidator),
  handler: async (ctx, args) => {
    const folders: ExportFolder[] = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const rows = await ctx.db.query("folders")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner))
        .collect();
      for (const folder of rows) {
        folders.push({
          _id: folder._id, name: folder.name, parentFolderId: folder.parentFolderId, kind: folder.kind,
          slug: folder.slug, showcased: folder.showcased, hiddenFromGallery: folder.hiddenFromGallery,
          memberCount: folder.memberCount,
        });
      }
    }
    return folders;
  },
});

// Assets created after the snapshot's newest one, newest first, through the
// owner/createdAt index: only the new rows are read.
export const listAssetsCreatedAfter = internalQuery({
  args: { ownerUserId: v.string(), after: v.number(), limit: v.number() },
  returns: v.object({ assets: v.array(galleryAssetResultValidator), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const rows: Doc<"assets">[] = [];
    let hasMore = false;
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const found = await ctx.db.query("assets")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner).gt("createdAt", args.after))
        .order("desc")
        .take(args.limit + 1);
      if (found.length > args.limit) hasMore = true;
      rows.push(...found.slice(0, args.limit));
    }
    const visible = rows
      .filter((asset) => !isHiddenSkillExample(asset))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, args.limit);
    if (rows.length > args.limit) hasMore = true;
    return { assets: await hydrateGalleryAssetResults(ctx, visible), hasMore };
  },
});

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

const buildExport = async (ctx: ActionCtx, ownerUserId: string, generatedAt: number) => {
  const folders = (await ctx.runQuery(listFoldersRef, { ownerUserId })) as ExportFolder[];
  const parts: ExportPart[] = [];
  let pending: string[] = [];
  let pendingBytes = 0;
  let assetCount = 0;
  let newestCreatedAt: number | undefined;
  const flush = async () => {
    // Part 0 also carries the collections every asset's folderIds point to.
    const header = JSON.stringify({
      version: INVENTORY_EXPORT_VERSION, generatedAt, part: parts.length,
      ...(parts.length === 0 ? { folders } : {}),
    });
    const body = `${header.slice(0, -1)},"assets":[${pending.join(",")}]}`;
    const key = await storeBlobToR2(ctx, new Blob([body], { type: "application/json" }), {
      key: `inventory/${crypto.randomUUID()}.json`,
      type: "application/json",
      cacheControl: "private, no-store",
    });
    parts.push({ key, count: pending.length, bytes: utf8Bytes(body) });
    pending = [];
    pendingBytes = 0;
  };

  let ownerIndex = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = (await ctx.runQuery(listPageRef, { ownerUserId, ownerIndex, cursor })) as {
      assets: Array<{ createdAt: number }>; ownerIndex: number; cursor: string | null; isDone: boolean;
    };
    for (const asset of page.assets) {
      const json = JSON.stringify(asset);
      const bytes = utf8Bytes(json) + 1;
      if (pending.length > 0 && pendingBytes + bytes > PART_BYTES) await flush();
      pending.push(json);
      pendingBytes += bytes;
      assetCount += 1;
      newestCreatedAt = Math.max(newestCreatedAt ?? asset.createdAt, asset.createdAt);
    }
    if (page.isDone) break;
    ownerIndex = page.ownerIndex;
    cursor = page.cursor;
  }
  await flush();
  return {
    generatedAt, assetCount, folderCount: folders.length, parts, newestCreatedAt,
    byteSize: parts.reduce((sum, part) => sum + part.bytes, 0),
  };
};

const rebuild = async (ctx: ActionCtx, ownerUserId: string) => {
  const buildStartedAt = Date.now();
  if (!(await ctx.runMutation(claimBuildRef, { ownerUserId, now: buildStartedAt }))) return false;
  let built;
  try {
    built = await buildExport(ctx, ownerUserId, buildStartedAt);
  } catch (error) {
    await ctx.runMutation(releaseBuildRef, { ownerUserId, buildStartedAt });
    throw error;
  }
  const { staleKeys } = (await ctx.runMutation(finishBuildRef, { ownerUserId, buildStartedAt, ...built })) as {
    published: boolean; staleKeys: string[];
  };
  for (const key of staleKeys) {
    await r2.deleteObject(ctx, key).catch((error: unknown) => {
      console.warn(`[inventoryExport] could not delete ${key}: ${error instanceof Error ? error.message : error}`);
    });
  }
  return true;
};

const clampMinutes = (value: number | undefined) =>
  Math.min(Math.max(value ?? DEFAULT_MAX_AGE_MINUTES, MIN_REBUILD_INTERVAL_MINUTES), MAX_AGE_LIMIT_MINUTES);

// Status of the owner's snapshot, rebuilding it first when there is none,
// it is older than maxAgeMinutes, more than 200 assets were saved since, or
// refresh is set and it is older than 15 minutes. Returns metadata only;
// /api/agent/inventory serves the parts.
export const getInventoryExport = ownerAction({
  args: {
    ownerUserId: v.string(),
    refresh: v.optional(v.boolean()),
    maxAgeMinutes: v.optional(v.number()),
  },
  returns: v.object({
    version: v.number(),
    generatedAt: v.number(),
    ageMinutes: v.number(),
    rebuilt: v.boolean(),
    assetCount: v.number(),
    folderCount: v.number(),
    byteSize: v.number(),
    parts: v.array(v.object({ index: v.number(), count: v.number(), bytes: v.number() })),
    newerAssets: v.array(galleryAssetResultValidator),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const maxAgeMs = clampMinutes(args.maxAgeMinutes) * 60_000;
    let row = (await ctx.runQuery(getExportRowRef, { ownerUserId })) as ExportRow | null;
    const age = (current: ExportRow | null) => (current?.generatedAt ? Date.now() - current.generatedAt : Infinity);
    let rebuilt = false;
    const tryRebuild = async () => {
      rebuilt = (await rebuild(ctx, ownerUserId)) || rebuilt;
      row = (await ctx.runQuery(getExportRowRef, { ownerUserId })) as ExportRow | null;
    };
    if (age(row) > maxAgeMs || (args.refresh === true && age(row) > MIN_REBUILD_INTERVAL_MINUTES * 60_000)) {
      await tryRebuild();
    }
    if (!row?.generatedAt) {
      throw new ConvexError("The inventory export is being built. Try again in a minute.");
    }
    let newer = (await ctx.runQuery(listNewerRef, {
      ownerUserId, after: row.newestCreatedAt ?? row.generatedAt, limit: NEWER_ASSET_LIMIT,
    })) as { assets: unknown[]; hasMore: boolean };
    if (newer.hasMore && !rebuilt && age(row) > MIN_REBUILD_INTERVAL_MINUTES * 60_000) {
      await tryRebuild();
      newer = (await ctx.runQuery(listNewerRef, {
        ownerUserId, after: row!.newestCreatedAt ?? row!.generatedAt!, limit: NEWER_ASSET_LIMIT,
      })) as { assets: unknown[]; hasMore: boolean };
    }
    const current = row!;
    return {
      version: INVENTORY_EXPORT_VERSION,
      generatedAt: current.generatedAt!,
      ageMinutes: Math.round(age(current) / 60_000),
      rebuilt,
      assetCount: current.assetCount,
      folderCount: current.folderCount,
      byteSize: current.byteSize,
      parts: current.parts.map((part, index) => ({ index, count: part.count, bytes: part.bytes })),
      newerAssets: newer.assets as never,
    };
  },
});

// A short-lived signed URL for one part of the current snapshot, for the
// /api/agent/inventory route to fetch server-side. A snapshot replaced since
// the caller read its status is refused, so parts never mix two builds.
export const getInventoryExportPartUrl = ownerAction({
  args: { ownerUserId: v.string(), generatedAt: v.number(), index: v.number() },
  returns: v.object({ url: v.string(), bytes: v.number() }),
  handler: async (ctx, args) => {
    const row = (await ctx.runQuery(getExportRowRef, { ownerUserId: args.ownerUserId.trim() })) as ExportRow | null;
    if (!row?.generatedAt || row.generatedAt !== args.generatedAt) {
      throw new ConvexError("The inventory export was rebuilt. Read its status again.");
    }
    const part = row.parts[args.index];
    if (!part) throw new ConvexError("No such inventory export part.");
    return { url: await r2.getUrl(part.key, { expiresIn: 300 }), bytes: part.bytes };
  },
});
