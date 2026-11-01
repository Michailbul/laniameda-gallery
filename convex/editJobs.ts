import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { assetFolderIds, worldsOfAsset } from "./worldCore";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { upsertLineageInternal } from "./generationLineage";
import { MAX_EDIT_REFS, planEditSend, type EditProvider } from "../lib/edit-models";

// In-place edits on an asset: Michael (detail panel, Inbox zoom) or an agent
// sends a prompt to one or more models, one job per model per take. Each job
// runs in convex/editRunner.ts along its model's route (fal / Pika, see
// lib/edit-models.ts), and its result lands as a new asset next to the source.
// A job that has a provider request id is only ever polled, never resubmitted;
// Retry is the one way to send again, under a fresh idempotency key.

const runEdit = makeFunctionReference<"action", { jobId: Id<"editJobs"> }>("editRunner:run");
const pollEdit = makeFunctionReference<"action", { jobId: Id<"editJobs"> }>("editRunner:poll");

const LIST_LIMIT = 80;
/** A running job untouched this long can be retried (its poll chain died). */
export const EDIT_STALE_MS = 20 * 60 * 1000;

const statusValidator = v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("error"));
const errorKindValidator = v.union(
  v.literal("out_of_credit"), v.literal("provider"), v.literal("timeout"), v.literal("ingest"),
);

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
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  createdBy: v.union(v.literal("owner"), v.literal("agent")),
  createdAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

const providerStateValidator = v.object({ key: v.boolean(), blocked: v.optional(v.string()) });

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
    resultUrl: result ? await resolveAssetUrl(ctx, result) : undefined,
    resultThumbUrl: result ? await resolveAssetThumbUrl(ctx, result) : undefined,
    width: result?.width ?? job.width,
    height: result?.height ?? job.height,
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
  const state = (provider: EditProvider, key: boolean) => {
    const attempt = last.get(provider);
    return { key, ...(attempt?.outOfCredit && attempt.error ? { blocked: attempt.error } : {}) };
  };
  return {
    fal: state("fal", Boolean(process.env.FAL_KEY?.trim())),
    pika: state("pika", Boolean(process.env.PIKA_API_KEY?.trim())),
  };
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
    providers: v.object({ fal: providerStateValidator, pika: providerStateValidator }),
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

    const plan = planEditSend({
      prompt: args.prompt, modelIds: args.models, takes: args.takes ?? 1,
      refs: refs.length, width: asset.width, height: asset.height,
    });
    if (!plan.ok) throw new ConvexError(plan.error);

    const folderIds = await assetFolderIds(ctx, asset);
    const worldFolderId = [...await worldsOfAsset(ctx, asset)][0];
    const now = Date.now();
    const batch = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const jobs = [];
    for (const [index, take] of plan.takes.entries()) {
      const used = refs.slice(0, take.refs);
      const first = take.model.routes[0]!;
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
    return {
      job,
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
    await ctx.db.patch(job._id, { status: "error", error: args.error.slice(0, 500), errorKind: args.errorKind, finishedAt: now, updatedAt: now });
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

/** The landed result: lineage to the source and references, then the job closes. */
export const finishJob = internalMutation({
  args: {
    jobId: v.id("editJobs"), resultAssetId: v.id("assets"), resultUrl: v.string(),
    chargedUsd: v.number(), chargedExact: v.boolean(), notes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    if (await ctx.db.get(job.sourceAssetId)) {
      await upsertLineageInternal(ctx, {
        ownerUserId: job.ownerUserId, targetAssetId: args.resultAssetId, sourceAssetId: job.sourceAssetId,
        role: "edit_source", stageOrder: 1, notes: args.notes,
      });
    }
    for (const [index, refId] of job.refAssetIds.entries()) {
      if (!await ctx.db.get(refId)) continue;
      await upsertLineageInternal(ctx, {
        ownerUserId: job.ownerUserId, targetAssetId: args.resultAssetId, sourceAssetId: refId,
        role: "other", stageOrder: index + 2,
        notes: `Reference <image-${index + 2}>: ${job.refNames[index] ?? "reference"}`,
      });
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "done", resultAssetId: args.resultAssetId, resultUrl: args.resultUrl,
      chargedUsd: args.chargedUsd, chargedExact: args.chargedExact,
      error: undefined, errorKind: undefined, finishedAt: now, updatedAt: now,
    });
    return null;
  },
});

/** Part of the asset delete cascade: a source's edit log goes with it; a result's job forgets it. */
export const detachAssetFromEditJobs = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const asSource = await ctx.db.query("editJobs").withIndex("by_source_createdAt", (q) => q.eq("sourceAssetId", assetId)).collect();
  for (const job of asSource) await ctx.db.delete(job._id);
  const asResult = await ctx.db.query("editJobs").withIndex("by_result", (q) => q.eq("resultAssetId", assetId)).collect();
  for (const job of asResult) await ctx.db.patch(job._id, { resultAssetId: undefined, updatedAt: Date.now() });
};
