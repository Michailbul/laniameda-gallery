import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { buildR2PublicUrl } from "./r2_url";
import {
  FAST_LIMITS, FAST_SESSION_LABEL, fastLineage, planFastRun, runStatusOf,
} from "../lib/mj-fast-helper";

// The Midjourney fast helper's runs (extension/mj-fast-helper.js, ⌥F on a
// frame). A run is one instruction on one frame with one fal model and 1–4
// takes; convex/mjQuickRunner.ts sends each take to fal's queue on the
// owner's fal key and polls it until it lands in R2. A take is only a take
// until Michael keeps it: then the extension route saves it as an asset
// (ingest) and records the asset here. Nothing here is visible in the grid.

const submitRun = makeFunctionReference<"action", { runId: Id<"mjQuickRuns"> }>("mjQuickRunner:submit");

type Run = Doc<"mjQuickRuns">;
type Take = Run["takes"][number];

const takeStatus = v.union(v.literal("queued"), v.literal("submitting"), v.literal("running"), v.literal("done"), v.literal("error"));
const reviewValidator = v.union(v.literal("pending"), v.literal("kept"), v.literal("dropped"));

const publicTake = v.object({
  index: v.number(),
  status: takeStatus,
  error: v.optional(v.string()),
  requestId: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  review: reviewValidator,
  savedAssetId: v.optional(v.id("assets")),
  fantasyDraftIds: v.optional(v.array(v.string())),
  fantasyProject: v.optional(v.string()),
});

const publicRun = v.object({
  _id: v.id("mjQuickRuns"),
  status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("error")),
  model: v.string(),
  modelName: v.string(),
  instruction: v.string(),
  count: v.number(),
  estimateUsd: v.number(),
  costUsd: v.optional(v.number()),
  error: v.optional(v.string()),
  worldName: v.optional(v.string()),
  source: v.object({
    url: v.optional(v.string()),
    mjJobId: v.optional(v.string()),
    mjIndex: v.optional(v.number()),
    pageUrl: v.optional(v.string()),
    prompt: v.optional(v.string()),
    parentRunId: v.optional(v.id("mjQuickRuns")),
    parentIndex: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  }),
  takes: v.array(publicTake),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const imageRefArg = v.object({
  r2Key: v.optional(v.string()),
  url: v.optional(v.string()),
  mjJobId: v.optional(v.string()),
  mjIndex: v.optional(v.number()),
});

/** The public URL fal reads a picture from: the R2 copy, else the URL given. */
export const pictureUrl = (ref: { r2Key?: string; url?: string }) =>
  (ref.r2Key ? buildR2PublicUrl(ref.r2Key) : undefined) ?? ref.url;

const takeUrl = (take: Take) => (take.r2Key ? buildR2PublicUrl(take.r2Key) : undefined) ?? take.falUrl;
const takeThumb = (take: Take) => (take.thumbR2Key ? buildR2PublicUrl(take.thumbR2Key) : undefined) ?? takeUrl(take);

const toPublic = (run: Run) => ({
  _id: run._id,
  status: run.status,
  model: run.model,
  modelName: run.modelName,
  instruction: run.instruction,
  count: run.count,
  estimateUsd: run.estimateUsd,
  ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
  ...(run.error ? { error: run.error } : {}),
  ...(run.world?.name ? { worldName: run.world.name } : {}),
  source: {
    url: pictureUrl(run.source),
    mjJobId: run.source.mjJobId,
    mjIndex: run.source.mjIndex,
    pageUrl: run.source.pageUrl,
    prompt: run.source.prompt?.slice(0, 400),
    parentRunId: run.source.parentRunId,
    parentIndex: run.source.parentIndex,
    width: run.source.width,
    height: run.source.height,
  },
  takes: run.takes.map((take, index) => ({
    index,
    status: take.status,
    ...(take.error ? { error: take.error } : {}),
    ...(take.requestId ? { requestId: take.requestId } : {}),
    url: takeUrl(take),
    thumbUrl: takeThumb(take),
    width: take.width,
    height: take.height,
    review: take.review,
    ...(take.savedAssetId ? { savedAssetId: take.savedAssetId } : {}),
    ...(take.fantasyDraftIds?.length ? { fantasyDraftIds: take.fantasyDraftIds } : {}),
    ...(take.fantasyProject ? { fantasyProject: take.fantasyProject } : {}),
  })),
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

const ownedRun = async (ctx: QueryCtx, owner: string, rawId: string) => {
  const id = ctx.db.normalizeId("mjQuickRuns", rawId);
  const run = id ? await ctx.db.get(id) : null;
  if (!run || !canActorAccessOwnerUserId(owner, run.ownerUserId)) throw new ConvexError("That run is gone.");
  return run;
};

const takeAt = (run: Run, index: number) => {
  const take = run.takes[index];
  if (!take) throw new ConvexError("That take is gone.");
  return take;
};

/** Write new takes and the run status, cost and finish time that follow from them. */
const writeTakes = async (ctx: MutationCtx, run: Run, takes: Take[], extra: Partial<Run> = {}) => {
  const status = runStatusOf(takes);
  const perTake = run.count ? run.estimateUsd / run.count : 0;
  const landed = takes.filter((take) => take.status === "done").length;
  const settled = status === "done" || status === "error";
  await ctx.db.patch(run._id, {
    takes,
    status,
    costUsd: Math.round(perTake * landed * 1e5) / 1e5,
    ...(status === "error" && !extra.error ? { error: takes.find((take) => take.error)?.error ?? "Nothing came back." } : {}),
    ...(settled && !run.finishedAt ? { finishedAt: Date.now() } : {}),
    updatedAt: Date.now(),
    ...extra,
  });
};

/** Start a run: checked, stored, handed to the runner. Returns at once; the card polls. */
export const startRun = ownerMutation({
  args: {
    ownerUserId: v.string(),
    model: v.string(),
    threadId: v.optional(v.string()),
    requestKey: v.optional(v.string()),
    instruction: v.string(),
    count: v.number(),
    source: v.object({
      r2Key: v.optional(v.string()),
      url: v.optional(v.string()),
      mjJobId: v.optional(v.string()),
      mjIndex: v.optional(v.number()),
      pageUrl: v.optional(v.string()),
      prompt: v.optional(v.string()),
      parentRunId: v.optional(v.string()),
      parentIndex: v.optional(v.number()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
    }),
    refs: v.array(imageRefArg),
    world: v.optional(v.object({ key: v.optional(v.string()), name: v.optional(v.string()), folderId: v.optional(v.string()) })),
  },
  returns: v.object({ runId: v.id("mjQuickRuns"), estimateUsd: v.number(), run: publicRun }),
  handler: async (ctx, args) => {
    if (args.requestKey && args.requestKey.length > 100) throw new ConvexError("Invalid send key.");
    if (args.requestKey) {
      for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
        const old = await ctx.db.query("mjQuickRuns").withIndex("by_owner_request", q => q.eq("ownerUserId", owner).eq("requestKey", args.requestKey)).unique();
        if (old) return { runId: old._id, estimateUsd: old.estimateUsd, run: toPublic(old) };
      }
    }
    const threadId = args.threadId ? ctx.db.normalizeId("mjImageEditThreads", args.threadId) : null;
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (args.threadId && (!thread || !canActorAccessOwnerUserId(args.ownerUserId, thread.ownerUserId))) throw new ConvexError("That edit thread is unavailable.");
    if (thread && args.count > 3) throw new ConvexError("Choose 1, 2 or 3 takes.");
    if (thread && thread.runIds.length >= 100) throw new ConvexError("Start another edit thread to keep this history.");
    const plan = planFastRun({
      modelId: args.model, instruction: args.instruction, count: args.count, refs: args.refs.length,
      width: args.source.width, height: args.source.height,
    });
    if (!plan.ok) throw new ConvexError(plan.error);
    if (!pictureUrl(args.source)) throw new ConvexError("The frame has no public address for fal. Reload and try again.");
    for (const ref of args.refs) if (!pictureUrl(ref)) throw new ConvexError("A reference picture has no public address.");

    let parentRunId: Id<"mjQuickRuns"> | undefined;
    if (args.source.parentRunId) {
      const parent = await ownedRun(ctx, args.ownerUserId, args.source.parentRunId);
      parentRunId = parent._id;
    }
    let folderId: Id<"folders"> | undefined;
    if (args.world?.folderId) {
      const id = ctx.db.normalizeId("folders", args.world.folderId);
      const folder = id ? await ctx.db.get(id) : null;
      if (folder && canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId)) folderId = folder._id;
    }

    const now = Date.now();
    const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);
    const runId = await ctx.db.insert("mjQuickRuns", {
      ...(args.requestKey ? { requestKey: args.requestKey.slice(0, 100) } : {}),
      ownerUserId: args.ownerUserId,
      source: {
        r2Key: clip(args.source.r2Key, 500),
        url: clip(args.source.url, FAST_LIMITS.url),
        mjJobId: clip(args.source.mjJobId, 64),
        mjIndex: args.source.mjIndex,
        pageUrl: clip(args.source.pageUrl, FAST_LIMITS.url),
        prompt: clip(args.source.prompt, FAST_LIMITS.prompt),
        parentRunId,
        parentIndex: parentRunId ? args.source.parentIndex : undefined,
        width: args.source.width,
        height: args.source.height,
      },
      refs: args.refs.slice(0, plan.refs).map((ref) => ({
        r2Key: clip(ref.r2Key, 500), url: clip(ref.url, FAST_LIMITS.url), mjJobId: clip(ref.mjJobId, 64), mjIndex: ref.mjIndex,
      })),
      model: plan.model.id,
      modelName: plan.model.name,
      endpoint: plan.model.endpoint,
      instruction: plan.instruction,
      count: plan.count,
      status: "queued",
      takes: Array.from({ length: plan.count }, () => ({ status: "queued" as const, review: "pending" as const })),
      estimateUsd: plan.totalUsd,
      ...(args.world && (args.world.key || args.world.name || folderId)
        ? { world: { key: clip(args.world.key, 120), name: clip(args.world.name, 200), folderId } }
        : {}),
      sessionLabel: FAST_SESSION_LABEL,
      pollCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, submitRun, { runId });
    if (thread) await ctx.db.patch(thread._id, { runIds: [...thread.runIds, runId], draft: plan.instruction, updatedAt: now });
    const run = (await ctx.db.get(runId))!;
    return { runId, estimateUsd: plan.totalUsd, run: toPublic(run) };
  },
});

/** The card's poll: these runs as they stand. Unknown or foreign ids are left out. */
export const getRuns = ownerQuery({
  args: { ownerUserId: v.string(), ids: v.array(v.string()) },
  returns: v.array(publicRun),
  handler: async (ctx, args) => {
    const out = [];
    for (const raw of [...new Set(args.ids)].slice(0, 30)) {
      const id = ctx.db.normalizeId("mjQuickRuns", raw);
      const run = id ? await ctx.db.get(id) : null;
      if (run && canActorAccessOwnerUserId(args.ownerUserId, run.ownerUserId)) out.push(toPublic(run));
    }
    return out;
  },
});

/** The card's Recent strip: the newest runs, newest first. */
export const listRecent = ownerQuery({
  args: { ownerUserId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(publicRun),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? FAST_LIMITS.recent)), FAST_LIMITS.recent);
    const rows: Run[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("mjQuickRuns")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", candidate))
        .order("desc").take(limit));
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(toPublic);
  },
});

/** Drop a take (2), or bring it back. A kept take stays kept: it is an asset now. */
export const reviewTake = ownerMutation({
  args: { ownerUserId: v.string(), runId: v.string(), index: v.number(), review: v.union(v.literal("pending"), v.literal("dropped")) },
  returns: publicRun,
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.ownerUserId, args.runId);
    const take = takeAt(run, args.index);
    if (take.review !== "kept") {
      await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index ? { ...row, review: args.review } : row)));
    }
    return toPublic((await ctx.db.get(run._id))!);
  },
});

const MJ_VARIANTS = ["png", "webp", "jpeg"];

/**
 * What the extension route needs to save a take as an asset: the picture, the
 * words, the lineage and where it goes. `alreadySaved` when it is an asset.
 */
export const saveContext = ownerQuery({
  args: { ownerUserId: v.string(), runId: v.string(), index: v.number() },
  returns: v.object({
    alreadySaved: v.optional(v.id("assets")),
    resultUrl: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    contentType: v.optional(v.string()),
    ingestKey: v.string(),
    promptText: v.string(),
    modelName: v.string(),
    agentDescription: v.string(),
    sourceUrl: v.optional(v.string()),
    folderId: v.optional(v.id("folders")),
    upstreamAssetId: v.optional(v.id("assets")),
  }),
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.ownerUserId, args.runId);
    const take = takeAt(run, args.index);
    const resultUrl = takeUrl(take);
    if (take.status !== "done" || !resultUrl) throw new ConvexError("That take has not landed yet.");

    // The frame it grew from, when that is in the gallery: a saved Midjourney
    // frame (saved under its CDN address) or the kept take of the parent run.
    let upstreamAssetId: Id<"assets"> | undefined;
    if (run.source.parentRunId) {
      const parent = await ctx.db.get(run.source.parentRunId);
      upstreamAssetId = parent?.takes[run.source.parentIndex ?? -1]?.savedAssetId;
    } else if (run.source.mjJobId && typeof run.source.mjIndex === "number") {
      outer: for (const owner of resolveUserIdCandidates(run.ownerUserId)) {
        for (const ext of MJ_VARIANTS) {
          const ingestKey = `https://cdn.midjourney.com/${run.source.mjJobId}/0_${run.source.mjIndex}.${ext}`;
          const asset = await ctx.db.query("assets")
            .withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", owner).eq("ingestKey", ingestKey))
            .first();
          if (asset) { upstreamAssetId = asset._id; break outer; }
        }
      }
    }
    const pageUrl = run.source.mjJobId
      ? `https://www.midjourney.com/jobs/${run.source.mjJobId}?index=${run.source.mjIndex ?? 0}`
      : run.source.pageUrl;
    return {
      ...(take.savedAssetId ? { alreadySaved: take.savedAssetId } : {}),
      resultUrl,
      width: take.width,
      height: take.height,
      contentType: take.contentType,
      ingestKey: `${FAST_SESSION_LABEL}:${run._id}:${args.index}`,
      promptText: run.instruction,
      modelName: run.modelName,
      agentDescription: fastLineage({
        modelName: run.modelName, endpoint: run.endpoint, instruction: run.instruction, requestId: take.requestId,
        mjJobId: run.source.mjJobId, mjIndex: run.source.mjIndex, pageUrl: run.source.pageUrl, mjPrompt: run.source.prompt,
        parentRunId: run.source.parentRunId,
      }),
      ...(pageUrl ? { sourceUrl: pageUrl } : {}),
      ...(run.world?.folderId ? { folderId: run.world.folderId } : {}),
      ...(upstreamAssetId ? { upstreamAssetId } : {}),
    };
  },
});

/** Keep (1): the route saved the take as this asset. */
export const markSaved = ownerMutation({
  args: { ownerUserId: v.string(), runId: v.string(), index: v.number(), assetId: v.id("assets") },
  returns: publicRun,
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.ownerUserId, args.runId);
    takeAt(run, args.index);
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index ? { ...row, review: "kept" as const, savedAssetId: args.assetId } : row)));
    return toPublic((await ctx.db.get(run._id))!);
  },
});

/** The take became a waiting Seedance draft in Fantasy Studio. */
export const markFantasy = ownerMutation({
  args: { ownerUserId: v.string(), runId: v.string(), index: v.number(), draftId: v.string(), project: v.string() },
  returns: publicRun,
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.ownerUserId, args.runId);
    const take = takeAt(run, args.index);
    const ids = [...new Set([...(take.fantasyDraftIds ?? []), args.draftId.slice(0, 80)])].slice(-10);
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index ? { ...row, fantasyDraftIds: ids, fantasyProject: args.project.slice(0, 200) } : row)));
    return toPublic((await ctx.db.get(run._id))!);
  },
});

// ── The runner's side (convex/mjQuickRunner.ts) ──

export const runForWork = internalQuery({
  args: { runId: v.id("mjQuickRuns") },
  returns: v.union(v.null(), v.object({
    run: v.any(),
    sourceUrl: v.optional(v.string()),
    refUrls: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    return {
      run,
      sourceUrl: pictureUrl(run.source),
      refUrls: run.refs.map(pictureUrl).filter((url): url is string => Boolean(url)),
    };
  },
});

/** A queued take becomes "submitting" once, so a retried action never sends it twice. */
export const claimTake = internalMutation({
  args: { runId: v.id("mjQuickRuns"), index: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const take = run?.takes[args.index];
    if (!run || !take || take.status !== "queued") return false;
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index ? { ...row, status: "submitting" as const } : row)), {
      ...(run.submittedAt ? {} : { submittedAt: Date.now() }),
    });
    return true;
  },
});

export const recordSubmitted = internalMutation({
  args: {
    runId: v.id("mjQuickRuns"), index: v.number(), requestId: v.string(),
    statusUrl: v.optional(v.string()), responseUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.takes[args.index]) return null;
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index
      ? { ...row, status: "running" as const, requestId: args.requestId, statusUrl: args.statusUrl, responseUrl: args.responseUrl }
      : row)));
    return null;
  },
});

export const takeFailed = internalMutation({
  args: { runId: v.id("mjQuickRuns"), index: v.number(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.takes[args.index]) return null;
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === args.index ? { ...row, status: "error" as const, error: args.error.slice(0, 500) } : row)));
    return null;
  },
});

export const takeLanded = internalMutation({
  args: {
    runId: v.id("mjQuickRuns"), index: v.number(), falUrl: v.string(),
    r2Key: v.optional(v.string()), thumbR2Key: v.optional(v.string()), storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()), width: v.optional(v.number()), height: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.takes[args.index]) return null;
    const { runId: _runId, index: at, ...media } = args;
    void _runId;
    await writeTakes(ctx, run, run.takes.map((row, index) => (index === at ? { ...row, status: "done" as const, error: undefined, ...media } : row)));
    return null;
  },
});

export const notePoll = internalMutation({
  args: { runId: v.id("mjQuickRuns") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return 0;
    await ctx.db.patch(run._id, { pollCount: run.pollCount + 1 });
    return run.pollCount + 1;
  },
});
