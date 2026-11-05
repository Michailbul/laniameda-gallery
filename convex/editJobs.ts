import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { assetFolderIds, worldsOfAsset } from "./worldCore";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { upsertLineageInternal } from "./generationLineage";
import { MAX_EDIT_REFS, editModelById, estimateEditUsd, liveRoute, planEditSend, type EditProvider } from "../lib/edit-models";
import { credentialPresence } from "./providerCredentials";
import { thumbVariantValidator } from "./validators";
import { r2 } from "./r2";

const KREA = "krea-3";
const KREA_FALLBACK = "gpt-flare";

// In-place edits on an asset: Michael (detail panel, Inbox zoom) or an agent
// sends a prompt to one or more models, one job per model per take. Each job
// runs in convex/editRunner.ts along its model's route (fal / Pika, see
// lib/edit-models.ts), and its result lands as a pending take on the job,
// shown only next to its source. Approve makes it the source's current
// version (the old picture stays in assetVersions, restorable); Discard
// archives the take, recoverable. A pending take is never an asset, so the
// grid, search, world pages and public views cannot show it.
// A job that has a provider request id is only ever polled, never resubmitted;
// Retry is the one way to send again, under a fresh idempotency key.

const runEdit = makeFunctionReference<"action", { jobId: Id<"editJobs"> }>("editRunner:run");
const pollEdit = makeFunctionReference<"action", { jobId: Id<"editJobs"> }>("editRunner:poll");
const reindexAsset = makeFunctionReference<"action", { assetId: Id<"assets"> }>("semanticIndex:reindexAsset");
const hashAsset = makeFunctionReference<"action", { assetId: Id<"assets">; force?: boolean }>("perceptualHash:hashAsset");

const LIST_LIMIT = 80;
/** A running job untouched this long can be retried (its poll chain died). */
export const EDIT_STALE_MS = 20 * 60 * 1000;

const statusValidator = v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("error"));
const errorKindValidator = v.union(
  v.literal("out_of_credit"), v.literal("provider"), v.literal("timeout"), v.literal("ingest"),
);

const reviewValidator = v.union(v.literal("pending"), v.literal("approved"), v.literal("discarded"));

const publicJobValidator = v.object({
  _id: v.id("editJobs"),
  sourceAssetId: v.id("assets"),
  status: statusValidator,
  model: v.string(),
  modelName: v.string(),
  provider: v.string(),
  endpoint: v.string(),
  prompt: v.string(),
  estimateUsd: v.number(),
  chargedUsd: v.optional(v.number()),
  chargedExact: v.optional(v.boolean()),
  error: v.optional(v.string()),
  errorKind: v.optional(errorKindValidator),
  batch: v.string(),
  take: v.number(),
  of: v.number(),
  refNames: v.array(v.string()),
  refsDropped: v.number(),
  /** One line per route tried: "fal: out of credits (403)", "pika". */
  tried: v.array(v.string()),
  retries: v.number(),
  resultAssetId: v.optional(v.id("assets")),
  resultUrl: v.optional(v.string()),
  resultThumbUrl: v.optional(v.string()),
  /** pending: waits for Approve or Discard, seen only here. Absent on takes from before 5 Nov 2026 (they are assets). */
  review: v.optional(reviewValidator),
  reviewedAt: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  createdBy: v.union(v.literal("owner"), v.literal("agent")),
  createdAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

const providerStateValidator = v.object({ key: v.boolean(), blocked: v.optional(v.string()) });

/** A landed take's media, stored on its job until it is approved. */
export const takeMediaValidator = v.object({
  r2Key: v.optional(v.string()),
  thumbR2Key: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  thumbStorageId: v.optional(v.id("_storage")),
  contentType: v.string(),
  contentHash: v.optional(v.string()),
  size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbSize: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
  thumbVariants: v.optional(v.array(thumbVariantValidator)),
  notes: v.optional(v.string()),
});
type TakeMedia = Infer<typeof takeMediaValidator>;

const versionValidator = v.object({
  _id: v.id("assetVersions"),
  number: v.number(),
  origin: v.union(v.literal("original"), v.literal("edit")),
  editJobId: v.optional(v.id("editJobs")),
  modelName: v.optional(v.string()),
  prompt: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  current: v.boolean(),
  createdAt: v.number(),
});

const ownedAsset = async (ctx: QueryCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) throw new ConvexError("Asset not found.");
  return asset;
};

const ownedJob = async (ctx: QueryCtx, owner: string, jobId: Id<"editJobs">) => {
  const job = await ctx.db.get(jobId);
  if (!job || !canActorAccessOwnerUserId(owner, job.ownerUserId)) throw new ConvexError("Edit not found.");
  return job;
};

const toPublicJob = async (ctx: QueryCtx, job: Doc<"editJobs">) => {
  const result = job.resultAssetId ? await ctx.db.get(job.resultAssetId) : null;
  const media = result ?? job.takeMedia;
  return {
    _id: job._id,
    sourceAssetId: job.sourceAssetId,
    status: job.status,
    model: job.model,
    modelName: job.modelName,
    provider: job.provider,
    endpoint: job.endpoint,
    prompt: job.prompt,
    estimateUsd: job.estimateUsd,
    chargedUsd: job.chargedUsd,
    chargedExact: job.chargedExact,
    error: job.error,
    errorKind: job.errorKind,
    batch: job.batch,
    take: job.take,
    of: job.of,
    refNames: job.refNames,
    refsDropped: job.refsDropped,
    tried: job.attempts.map((attempt) => attempt.error ?? `${attempt.provider}: accepted ${attempt.requestId ?? ""}`.trim()),
    retries: job.retries,
    resultAssetId: result ? result._id : undefined,
    resultUrl: media ? await resolveAssetUrl(ctx, media) : undefined,
    resultThumbUrl: media ? await resolveAssetThumbUrl(ctx, media) : undefined,
    review: job.review,
    reviewedAt: job.reviewedAt,
    width: media?.width ?? job.width,
    height: media?.height ?? job.height,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
};

/**
 * Keys set in the deployment, and per provider the last refusal on one of the
 * owner's recent jobs when it was a billing block. A later accepted request on
 * the provider clears it.
 */
const providerState = async (ctx: QueryCtx, owner: string) => {
  const recent: Doc<"editJobs">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    recent.push(...await ctx.db.query("editJobs")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", candidate))
      .order("desc").take(40));
  }
  const last = new Map<string, Doc<"editJobs">["attempts"][number]>();
  for (const attempt of recent.flatMap((job) => job.attempts)) {
    const seen = last.get(attempt.provider);
    if (!seen || attempt.at > seen.at) last.set(attempt.provider, attempt);
  }
  const presence = await credentialPresence(ctx, owner);
  const state = (provider: EditProvider) => {
    const attempt = last.get(provider);
    // A key saved after the refusal clears it: the new key gets its chance.
    const stale = attempt && presence[provider].since !== undefined && attempt.at < presence[provider].since!;
    return { key: presence[provider].key, ...(attempt?.outOfCredit && attempt.error && !stale ? { blocked: attempt.error } : {}) };
  };
  return { magnific: state("magnific"), fal: state("fal"), pika: state("pika") };
};

/**
 * Everything the "Edit in place" section needs for one asset: its takes
 * (newest send first, takes in order), what it is an edit of, the world's
 * cast to attach as references, and which providers can take a job.
 */
export const listAssetEdits = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.object({
    jobs: v.array(publicJobValidator),
    editOf: v.union(v.null(), v.object({
      job: publicJobValidator,
      sourceUrl: v.optional(v.string()),
      sourceThumbUrl: v.optional(v.string()),
    })),
    world: v.union(v.null(), v.object({ id: v.id("folders"), name: v.string() })),
    characters: v.array(v.object({
      id: v.id("characters"),
      code: v.string(),
      name: v.string(),
      refs: v.array(v.object({ kind: v.union(v.literal("sheet"), v.literal("face")), assetId: v.id("assets"), thumbUrl: v.optional(v.string()) })),
    })),
    providers: v.object({ magnific: providerStateValidator, fal: providerStateValidator, pika: providerStateValidator }),
    /** Every picture this asset has been, oldest first; empty until an edit is approved. */
    versions: v.array(versionValidator),
  }),
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, args.ownerUserId, args.assetId);
    const rows = await ctx.db.query("editJobs")
      .withIndex("by_source_createdAt", (q) => q.eq("sourceAssetId", asset._id))
      .order("desc").take(LIST_LIMIT);
    // Newest send first; inside a send, the order the takes were queued.
    rows.sort((a, b) => (a.batch === b.batch ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
    const jobs = [];
    for (const row of rows) {
      if (canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId)) jobs.push(await toPublicJob(ctx, row));
    }

    const origin = await ctx.db.query("editJobs").withIndex("by_result", (q) => q.eq("resultAssetId", asset._id)).first();
    const source = origin ? await ctx.db.get(origin.sourceAssetId) : null;
    const editOf = origin && canActorAccessOwnerUserId(args.ownerUserId, origin.ownerUserId)
      ? {
          job: await toPublicJob(ctx, origin),
          sourceUrl: source ? await resolveAssetUrl(ctx, source) : undefined,
          sourceThumbUrl: source ? await resolveAssetThumbUrl(ctx, source) : undefined,
        }
      : null;

    const worldId = [...await worldsOfAsset(ctx, asset)][0];
    const worldFolder = worldId ? await ctx.db.get(worldId) : null;
    const characters = [];
    if (worldFolder) {
      const cast: Doc<"characters">[] = [];
      for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
        cast.push(...await ctx.db.query("characters")
          .withIndex("by_owner_world_number", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldFolder._id))
          .collect());
      }
      for (const character of cast) {
        if (character.status === "retired") continue;
        const refs = [];
        for (const [kind, id] of [["sheet", character.sheetAssetId], ["face", character.faceAssetId]] as const) {
          const ref = id ? await ctx.db.get(id) : null;
          if (ref && ref.kind === "image" && ref._id !== asset._id) {
            refs.push({ kind, assetId: ref._id, thumbUrl: await resolveAssetThumbUrl(ctx, ref) });
          }
        }
        if (refs.length) characters.push({ id: character._id, code: character.code, name: character.name, refs });
      }
    }

    return {
      jobs,
      editOf,
      world: worldFolder ? { id: worldFolder._id, name: worldFolder.name } : null,
      characters,
      providers: await providerState(ctx, args.ownerUserId),
      versions: await publicVersions(ctx, asset),
    };
  },
});

/** The owner's newest edits across the vault, newest first (agents' read). */
export const listRecentEdits = ownerQuery({
  args: { ownerUserId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(publicJobValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(LIST_LIMIT, Math.max(1, Math.floor(args.limit ?? 30)));
    const rows: Doc<"editJobs">[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("editJobs")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", candidate))
        .order("desc").take(limit));
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(rows.slice(0, limit).map((row) => toPublicJob(ctx, row)));
  },
});

/**
 * Send an edit: one job per model per take, refused at $30 or more. The frame
 * is <image-1>; references follow as <image-2>, <image-3>… in the order given,
 * each model taking up to its own reference limit.
 */
export const startEdit = ownerMutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    prompt: v.string(),
    models: v.array(v.string()),
    takes: v.optional(v.number()),
    refs: v.optional(v.array(v.object({ assetId: v.id("assets"), name: v.optional(v.string()) }))),
    createdBy: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
  },
  returns: v.object({
    batch: v.string(),
    totalUsd: v.number(),
    jobs: v.array(v.object({
      jobId: v.id("editJobs"), model: v.string(), take: v.number(), of: v.number(),
      estimateUsd: v.number(), refsDropped: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, args.ownerUserId, args.assetId);
    if (asset.kind !== "image") throw new ConvexError("In-place edits take images only.");

    const refs: { asset: Doc<"assets">; name: string }[] = [];
    for (const ref of args.refs ?? []) {
      if (ref.assetId === asset._id || refs.some((entry) => entry.asset._id === ref.assetId)) continue;
      const refAsset = await ownedAsset(ctx, args.ownerUserId, ref.assetId);
      if (refAsset.kind !== "image") throw new ConvexError(`A reference must be an image: asset:${ref.assetId}.`);
      refs.push({ asset: refAsset, name: ref.name?.trim().slice(0, 60) || `asset:${ref.assetId}` });
    }
    if (refs.length > MAX_EDIT_REFS) throw new ConvexError(`Up to ${MAX_EDIT_REFS} references.`);

    const providers = await providerState(ctx, args.ownerUserId);
    const plan = planEditSend({
      prompt: args.prompt, modelIds: args.models, takes: args.takes ?? 1,
      refs: refs.length, width: asset.width, height: asset.height, providers,
    });
    if (!plan.ok) throw new ConvexError(plan.error);

    const folderIds = await assetFolderIds(ctx, asset);
    const worldFolderId = [...await worldsOfAsset(ctx, asset)][0];
    const now = Date.now();
    const batch = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const jobs = [];
    for (const [index, take] of plan.takes.entries()) {
      const used = refs.slice(0, take.refs);
      const first = liveRoute(take.model, providers).route;
      const jobId = await ctx.db.insert("editJobs", {
        ownerUserId: asset.ownerUserId ?? args.ownerUserId,
        sourceAssetId: asset._id,
        folderIds,
        worldFolderId,
        prompt: args.prompt.trim(),
        model: take.model.id,
        modelName: take.model.name,
        provider: first.provider,
        endpoint: first.endpoint,
        attempts: [],
        retries: 0,
        status: "queued",
        estimateUsd: take.estimateUsd,
        batch,
        take: take.take,
        of: take.of,
        refAssetIds: used.map((entry) => entry.asset._id),
        refNames: used.map((entry) => entry.name),
        refsDropped: take.refsDropped,
        width: asset.width,
        height: asset.height,
        createdBy: args.createdBy ?? "owner",
        pollCount: 0,
        // A millisecond apart so a send keeps its take order.
        createdAt: now + index,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, runEdit, { jobId });
      jobs.push({ jobId, model: take.model.id, take: take.take, of: take.of, estimateUsd: take.estimateUsd, refsDropped: take.refsDropped });
    }
    return { batch, totalUsd: plan.totalUsd, jobs };
  },
});

/**
 * Run a failed job again (after a top-up), or pick up a running one whose
 * poll stopped. A job the provider already accepted is polled again by its
 * request id; anything else is sent as a new request with a fresh key.
 */
export const retryEdit = ownerMutation({
  args: { ownerUserId: v.string(), jobId: v.id("editJobs") },
  returns: v.object({ jobId: v.id("editJobs"), status: statusValidator, resumed: v.boolean() }),
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.ownerUserId, args.jobId);
    const now = Date.now();
    const stale = (job.status === "running" || job.status === "queued") && now - job.updatedAt > EDIT_STALE_MS;
    if (job.status !== "error" && !stale) throw new ConvexError("Only a failed or stalled edit can be retried.");

    // Accepted by the provider and not refused since: never send it twice.
    // Timed out, or landed but failed to file: poll the same request again.
    const resume = Boolean(job.requestId) && (stale || job.errorKind === "timeout" || job.errorKind === "ingest");
    if (resume) {
      await ctx.db.patch(job._id, { status: "running", error: undefined, errorKind: undefined, finishedAt: undefined, pollCount: 0, submittedAt: now, updatedAt: now });
      await ctx.scheduler.runAfter(0, pollEdit, { jobId: job._id });
      return { jobId: job._id, status: "running" as const, resumed: true };
    }
    // A stalled job that never got a request id keeps its key, so Pika
    // answers a request it already took instead of running it twice.
    await ctx.db.patch(job._id, {
      status: "queued",
      retries: stale && !job.requestId ? job.retries : job.retries + 1,
      requestId: undefined, statusUrl: undefined, responseUrl: undefined,
      error: undefined, errorKind: undefined, finishedAt: undefined, submittedAt: undefined,
      pollCount: 0, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, runEdit, { jobId: job._id });
    return { jobId: job._id, status: "queued" as const, resumed: false };
  },
});

// ---------------------------------------------------------------- runner side

/** A job with what the runner sends: the frame's and references' URLs and the source's filing. */
export const jobForRun = internalQuery({
  args: { jobId: v.id("editJobs") },
  returns: v.union(v.null(), v.object({
    job: v.any(),
    sourceUrl: v.optional(v.string()),
    refUrls: v.array(v.string()),
    sourceTagIds: v.array(v.id("tags")),
    sourceFolderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
    worldName: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const source = await ctx.db.get(job.sourceAssetId);
    const refUrls: string[] = [];
    for (const id of job.refAssetIds) {
      const ref = await ctx.db.get(id);
      const url = ref ? await resolveAssetUrl(ctx, ref) : undefined;
      if (url) refUrls.push(url);
    }
    // Filed where the source lives now; the send-time list if it has moved out of everything.
    const current = source ? await assetFolderIds(ctx, source) : [];
    const world = job.worldFolderId ? await ctx.db.get(job.worldFolderId) : null;
    return {
      job,
      ...(world?.name ? { worldName: world.name } : {}),
      sourceUrl: source ? await resolveAssetUrl(ctx, source) : undefined,
      refUrls,
      sourceTagIds: source?.tagIds ?? [],
      sourceFolderId: source?.folderId ?? (current[0] ?? job.folderIds[0]),
      folderIds: current.length ? current : job.folderIds,
    };
  },
});

/** Take a queued job for submission; false when another run has it or it has a request id. */
export const claimJob = internalMutation({
  args: { jobId: v.id("editJobs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued" || job.requestId) return false;
    await ctx.db.patch(job._id, { status: "running", updatedAt: Date.now() });
    return true;
  },
});

const withAttempt = (job: Doc<"editJobs">, attempt: Doc<"editJobs">["attempts"][number]) =>
  [...job.attempts, attempt].slice(-40);

export const recordRefusal = internalMutation({
  args: { jobId: v.id("editJobs"), provider: v.string(), endpoint: v.string(), error: v.string(), outOfCredit: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const now = Date.now();
    await ctx.db.patch(job._id, {
      attempts: withAttempt(job, { provider: args.provider, endpoint: args.endpoint, error: args.error.slice(0, 300), outOfCredit: args.outOfCredit, at: now }),
      updatedAt: now,
    });
    return null;
  },
});

export const recordSubmitted = internalMutation({
  args: {
    jobId: v.id("editJobs"), provider: v.string(), endpoint: v.string(), requestId: v.string(),
    statusUrl: v.optional(v.string()), responseUrl: v.optional(v.string()), estimateUsd: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const now = Date.now();
    await ctx.db.patch(job._id, {
      attempts: withAttempt(job, { provider: args.provider, endpoint: args.endpoint, requestId: args.requestId, at: now }),
      status: "running", provider: args.provider, endpoint: args.endpoint, requestId: args.requestId,
      statusUrl: args.statusUrl, responseUrl: args.responseUrl, estimateUsd: args.estimateUsd,
      submittedAt: now, pollCount: 0, updatedAt: now,
    });
    return null;
  },
});

export const failJob = internalMutation({
  args: { jobId: v.id("editJobs"), error: v.string(), errorKind: errorKindValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "done") return null;
    const now = Date.now();
    // Krea 3 is the edit model; when it fails the same edit runs once on GPT
    // Image 2.5 Flare (~/.claude/CLAUDE.md: "if it fails, GPT Image 2.5").
    // A failed save of a landed result ("ingest") is not a model failure.
    const fallback = job.model === KREA && args.errorKind !== "ingest" ? editModelById(KREA_FALLBACK) : undefined;
    const note = fallback ? ` · sent to ${fallback.name} instead` : "";
    await ctx.db.patch(job._id, { status: "error", error: `${args.error.slice(0, 460)}${note}`, errorKind: args.errorKind, finishedAt: now, updatedAt: now });
    if (fallback) {
      const route = liveRoute(fallback, await providerState(ctx, job.ownerUserId)).route;
      const refs = Math.min(job.refAssetIds.length, fallback.maxRefs);
      const jobId = await ctx.db.insert("editJobs", {
        ownerUserId: job.ownerUserId, sourceAssetId: job.sourceAssetId, folderIds: job.folderIds, worldFolderId: job.worldFolderId,
        prompt: job.prompt, model: fallback.id, modelName: fallback.name, provider: route.provider, endpoint: route.endpoint,
        attempts: [], retries: 0, status: "queued",
        estimateUsd: estimateEditUsd(route.endpoint, job.width, job.height, refs),
        batch: job.batch, take: job.take, of: job.of,
        refAssetIds: job.refAssetIds.slice(0, refs), refNames: job.refNames.slice(0, refs), refsDropped: job.refAssetIds.length - refs,
        width: job.width, height: job.height, createdBy: job.createdBy, pollCount: 0, createdAt: now, updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, runEdit, { jobId });
    }
    return null;
  },
});

/** One poll more; returns the count so the runner can space and stop them. */
export const notePoll = internalMutation({
  args: { jobId: v.id("editJobs") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return 0;
    const pollCount = job.pollCount + 1;
    await ctx.db.patch(job._id, { pollCount, updatedAt: Date.now() });
    return pollCount;
  },
});

/** The landed result becomes a pending take on its job: seen next to its source only. */
export const finishJob = internalMutation({
  args: {
    jobId: v.id("editJobs"), take: takeMediaValidator, resultUrl: v.string(),
    chargedUsd: v.number(), chargedExact: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    // A source deleted while the edit ran: nothing to show the take beside.
    if (!await ctx.db.get(job.sourceAssetId)) {
      await deleteTakeMedia(ctx, args.take);
      await ctx.db.delete(job._id);
      return null;
    }
    // A Retry that files again replaces the take it had (same request, same picture).
    if (job.takeMedia && job.review !== "approved" && job.takeMedia.r2Key !== args.take.r2Key) await deleteTakeMedia(ctx, job.takeMedia);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "done", takeMedia: args.take, review: "pending", reviewedAt: undefined, resultUrl: args.resultUrl,
      chargedUsd: args.chargedUsd, chargedExact: args.chargedExact,
      error: undefined, errorKind: undefined, finishedAt: now, updatedAt: now,
    });
    return null;
  },
});

// ------------------------------------------------------- review and versions

type MediaFields = Pick<Doc<"assets">,
  "r2Key" | "thumbR2Key" | "storageId" | "thumbStorageId" | "sourceUrl" | "contentType" | "contentHash"
  | "size" | "width" | "height" | "thumbSize" | "thumbWidth" | "thumbHeight" | "thumbVariants">;

/** What tells one picture from another: its stored object, else its upstream URL. */
const mediaKey = (media: { r2Key?: string; storageId?: Id<"_storage">; sourceUrl?: string }) =>
  media.r2Key ?? media.storageId ?? media.sourceUrl ?? "";

const mediaOf = (from: Partial<MediaFields>): MediaFields => ({
  r2Key: from.r2Key, thumbR2Key: from.thumbR2Key, storageId: from.storageId, thumbStorageId: from.thumbStorageId,
  sourceUrl: from.sourceUrl, contentType: from.contentType, contentHash: from.contentHash, size: from.size,
  width: from.width, height: from.height, thumbSize: from.thumbSize, thumbWidth: from.thumbWidth,
  thumbHeight: from.thumbHeight, thumbVariants: from.thumbVariants,
});

const deleteTakeMedia = async (ctx: MutationCtx, take: TakeMedia) => {
  for (const key of new Set([take.r2Key, take.thumbR2Key, ...(take.thumbVariants ?? []).map((t) => t.r2Key)])) {
    if (key) await r2.deleteObject(ctx, key);
  }
  for (const id of new Set([take.storageId, take.thumbStorageId])) if (id) await ctx.storage.delete(id);
};

const versionsOf = (ctx: QueryCtx, assetId: Id<"assets">) =>
  ctx.db.query("assetVersions").withIndex("by_asset_number", (q) => q.eq("assetId", assetId)).collect();

const publicVersions = async (ctx: QueryCtx, asset: Doc<"assets">) => {
  const rows = await versionsOf(ctx, asset._id);
  const current = mediaKey(asset);
  return await Promise.all(rows.map(async (row) => ({
    _id: row._id, number: row.number, origin: row.origin, editJobId: row.editJobId, modelName: row.modelName,
    prompt: row.prompt, url: await resolveAssetUrl(ctx, row), thumbUrl: await resolveAssetThumbUrl(ctx, row),
    width: row.width, height: row.height, current: mediaKey(row) === current, createdAt: row.createdAt,
  })));
};

/**
 * Put a picture on the asset: the same row, id, tags, collections and links,
 * new media. Search and the duplicate hash are redone for the new picture.
 */
const showOnAsset = async (ctx: MutationCtx, asset: Doc<"assets">, media: MediaFields) => {
  // Convex drops a field patched to undefined, so absent media fields clear.
  await ctx.db.patch(asset._id, { ...media, sourceUrl: media.sourceUrl ?? asset.sourceUrl });
  await ctx.scheduler.runAfter(0, reindexAsset, { assetId: asset._id });
  await ctx.scheduler.runAfter(0, hashAsset, { assetId: asset._id, force: true });
};

/**
 * Approve a landed take: it becomes the source's current picture. The first
 * approval records the original as version 1; every approved take is the next
 * version. Approving a take approved before shows its version again.
 */
export const approveEdit = ownerMutation({
  args: { ownerUserId: v.string(), jobId: v.id("editJobs") },
  returns: v.object({ jobId: v.id("editJobs"), assetId: v.id("assets"), version: v.number() }),
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.ownerUserId, args.jobId);
    if (job.status !== "done" || !job.takeMedia) throw new ConvexError("Only a landed take can be approved.");
    const asset = await ownedAsset(ctx, args.ownerUserId, job.sourceAssetId);
    const rows = await versionsOf(ctx, asset._id);
    const now = Date.now();
    let next = rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
    if (!rows.some((row) => mediaKey(row) === mediaKey(asset))) {
      // The picture showing now has no row yet (the original, before any approval).
      await ctx.db.insert("assetVersions", {
        ownerUserId: job.ownerUserId, assetId: asset._id, number: next, origin: "original",
        modelName: asset.modelName, ...mediaOf(asset), createdAt: asset.createdAt,
      });
      next += 1;
    }
    const existing = rows.find((row) => row.editJobId === job._id);
    const media = mediaOf({ ...job.takeMedia, sourceUrl: undefined });
    let version = existing?.number ?? next;
    if (!existing) {
      await ctx.db.insert("assetVersions", {
        ownerUserId: job.ownerUserId, assetId: asset._id, number: version, origin: "edit", editJobId: job._id,
        modelName: job.modelName, prompt: job.prompt, ...media, createdAt: now,
      });
    } else {
      version = existing.number;
    }
    if (mediaKey(asset) !== mediaKey(media)) await showOnAsset(ctx, asset, media);
    // The references the take was made with, as lineage on the asset.
    for (const [index, refId] of job.refAssetIds.entries()) {
      if (refId === asset._id || !await ctx.db.get(refId)) continue;
      await upsertLineageInternal(ctx, {
        ownerUserId: job.ownerUserId, targetAssetId: asset._id, sourceAssetId: refId, role: "other", stageOrder: index + 2,
        notes: `Reference <image-${index + 2}> of approved edit editJobs:${job._id} (v${version}): ${job.refNames[index] ?? "reference"}`,
      });
    }
    await ctx.db.patch(job._id, { review: "approved", reviewedAt: now, updatedAt: now });
    return { jobId: job._id, assetId: asset._id, version };
  },
});

/** Discard a take (archived, kept), or bring a discarded one back to pending with reopen. */
export const discardEdit = ownerMutation({
  args: { ownerUserId: v.string(), jobId: v.id("editJobs"), reopen: v.optional(v.boolean()) },
  returns: v.object({ jobId: v.id("editJobs"), review: reviewValidator }),
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.ownerUserId, args.jobId);
    if (job.status !== "done" || !job.takeMedia) throw new ConvexError("Only a landed take can be discarded.");
    if (job.review === "approved") throw new ConvexError("This take is the asset's version now. Restore another version instead.");
    const review = args.reopen ? "pending" as const : "discarded" as const;
    const now = Date.now();
    if (job.review !== review) await ctx.db.patch(job._id, { review, reviewedAt: args.reopen ? undefined : now, updatedAt: now });
    return { jobId: job._id, review };
  },
});

/** Show an earlier version on the asset again. Nothing is deleted; the one it replaces stays a version. */
export const restoreAssetVersion = ownerMutation({
  args: { ownerUserId: v.string(), versionId: v.id("assetVersions") },
  returns: v.object({ assetId: v.id("assets"), version: v.number() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row || !canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId)) throw new ConvexError("Version not found.");
    const asset = await ownedAsset(ctx, args.ownerUserId, row.assetId);
    if (mediaKey(asset) !== mediaKey(row)) await showOnAsset(ctx, asset, mediaOf(row));
    return { assetId: asset._id, version: row.number };
  },
});

/**
 * Part of the asset delete cascade: a source's edit log goes with it, with its
 * takes' pictures and the asset's earlier versions (the picture showing now is
 * deleted by the cascade itself); a result's job forgets it.
 */
export const detachAssetFromEditJobs = async (ctx: MutationCtx, asset: Doc<"assets">) => {
  const assetId = asset._id;
  const r2Keys = new Set<string>();
  const storageIds = new Set<Id<"_storage">>();
  const collect = (media: Partial<MediaFields>) => {
    for (const key of [media.r2Key, media.thumbR2Key, ...(media.thumbVariants ?? []).map((t) => t.r2Key)]) if (key) r2Keys.add(key);
    for (const id of [media.storageId, media.thumbStorageId]) if (id) storageIds.add(id);
  };
  for (const row of await versionsOf(ctx, assetId)) {
    collect(row);
    await ctx.db.delete(row._id);
  }
  const asSource = await ctx.db.query("editJobs").withIndex("by_source_createdAt", (q) => q.eq("sourceAssetId", assetId)).collect();
  for (const job of asSource) {
    if (job.takeMedia) collect(job.takeMedia);
    await ctx.db.delete(job._id);
  }
  // The picture showing now goes with the cascade's own blob delete.
  for (const key of [asset.r2Key, asset.thumbR2Key]) if (key) r2Keys.delete(key);
  for (const id of [asset.storageId, asset.thumbStorageId]) if (id) storageIds.delete(id);
  for (const key of r2Keys) await r2.deleteObject(ctx, key);
  for (const id of storageIds) await ctx.storage.delete(id);
  const asResult = await ctx.db.query("editJobs").withIndex("by_result", (q) => q.eq("resultAssetId", assetId)).collect();
  for (const job of asResult) await ctx.db.patch(job._id, { resultAssetId: undefined, updatedAt: Date.now() });
};
