import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  ownerSessionMutation, signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery,
} from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { inspirationJobStatusValidator } from "./inspirationValidators";
import { INSPIRATION_DISPATCH as D, cleanLine, cycleStartAt } from "../lib/inspiration";

// Dispatch safety for inspiration generation. The rules, enforced here:
//
// - Paused by default. With no dispatch row, or paused, or no allowance, or
//   an expired one, nothing can be reserved. Only Michael (a signed-in
//   browser session) sets an allowance and resumes.
// - One dispatcher per owner. claim returns a nonce and a fence; every job
//   write carries both. Another process is refused while the lease is live,
//   even under the same agent label, and a replaced worker's writes fail.
// - Every paid call is reserved first, priced: an unknown price is refused,
//   the per-job cap and the cycle cap are checked against everything held
//   (reserved, accepted and unknown outcomes from any cycle) plus what was
//   settled in this cycle. Two reservations that together exceed the cap
//   cannot both succeed: Convex mutations are serializable.
// - When a new dispatcher takes over, jobs still in flight under an older
//   fence become unknown_outcome. Unknown outcomes keep their budget held,
//   block new jobs for that adaptation and are never resubmitted: Michael
//   resolves them (charged / not charged), or the dispatcher reconciles one
//   with an authoritative provider lookup.

type Ctx = QueryCtx | MutationCtx;
type Dispatch = Doc<"inspirationDispatch">;
type Job = Doc<"inspirationJobs">;

const fail = (message: string): never => { throw new ConvexError(message); };
const owns = (owner: string, row: { ownerUserId?: string } | null): boolean =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId));

const HELD = ["reserved", "accepted", "unknown_outcome"] as const;
const OPEN = new Set<Job["status"]>(HELD);

const money = (value: number | undefined, label: string) => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be a non-negative number.`);
  return Math.round(value * 10_000) / 10_000;
};

const readDispatch = async (ctx: Ctx, owner: string): Promise<Dispatch | null> => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("inspirationDispatch").withIndex("by_owner", (q) => q.eq("ownerUserId", candidate)).first();
    if (row) return row;
  }
  return null;
};

const ensureDispatch = async (ctx: MutationCtx, owner: string): Promise<Dispatch> => {
  const existing = await readDispatch(ctx, owner);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("inspirationDispatch", {
    ownerUserId: owner, paused: true, pausedReason: "Generation is off until Michael sets an allowance.",
    providers: [], cycleHours: D.cycleHours, cycleAnchor: now, fence: 0, revision: 1, updatedAt: now,
  });
  return (await ctx.db.get(id))!;
};

const jobsWithStatus = async (ctx: Ctx, owner: string, status: Job["status"]) => {
  const rows: Job[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("inspirationJobs")
      .withIndex("by_owner_status_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("status", status))
      .order("desc").take(D.scan));
  }
  return rows;
};

/** What the allowance has left: held (in flight, any cycle) + settled this cycle. */
const spend = async (ctx: Ctx, owner: string, dispatch: Pick<Dispatch, "cycleAnchor" | "cycleHours">, now: number) => {
  const cycleStart = cycleStartAt(dispatch.cycleAnchor, dispatch.cycleHours, now);
  let heldUsd = 0;
  let unknown = 0;
  for (const status of HELD) {
    for (const job of await jobsWithStatus(ctx, owner, status)) {
      heldUsd += job.estimateUsd;
      if (status === "unknown_outcome") unknown += 1;
    }
  }
  let settledUsd = 0;
  for (const job of await jobsWithStatus(ctx, owner, "settled")) {
    if (job.cycleStart >= cycleStart) settledUsd += job.settledUsd ?? job.estimateUsd;
  }
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return { cycleStart, cycleEnd: cycleStart + dispatch.cycleHours * 3_600_000, heldUsd: round(heldUsd), settledUsd: round(settledUsd), unknown };
};

/** The writer must be the current dispatcher: same nonce, same fence, live lease. */
const requireFence = (dispatch: Dispatch | null, nonce: string, fence: number, now: number): Dispatch => {
  if (!dispatch || !dispatch.holderNonce) return fail("No dispatcher holds the lease. Claim it first (inspiration_dispatch claim).");
  if (dispatch.holderNonce !== nonce || dispatch.fence !== fence) {
    return fail(`Stale dispatcher: fence ${fence} was replaced by fence ${dispatch.fence} (${dispatch.holder ?? "another worker"}). Stop; do not call any provider.`);
  }
  if ((dispatch.leaseUntil ?? 0) <= now) return fail("Your dispatcher lease expired. Claim again before any paid call; in-flight jobs were not touched.");
  return dispatch;
};

const requireJob = async (ctx: Ctx, owner: string, id: Id<"inspirationJobs">) => {
  const job = await ctx.db.get(id);
  if (!job || !owns(owner, job)) fail("Job not found.");
  return job!;
};

const jobView = (job: Job) => ({
  jobId: job._id, adaptationId: job.adaptationId, sourceId: job.sourceId, ingestKey: job.ingestKey, status: job.status,
  fence: job.fence, worker: job.worker, provider: job.provider, model: job.model, estimateUsd: job.estimateUsd,
  settledUsd: job.settledUsd, costExact: job.costExact, providerHandle: job.providerHandle, versionId: job.versionId,
  cycleStart: job.cycleStart, note: job.note, resolvedBy: job.resolvedBy, createdAt: job.createdAt, updatedAt: job.updatedAt,
});

const jobViewValidator = v.object({
  jobId: v.id("inspirationJobs"), adaptationId: v.id("inspirationAdaptations"), sourceId: v.id("inspirationSources"),
  ingestKey: v.string(), status: inspirationJobStatusValidator, fence: v.number(), worker: v.string(),
  provider: v.string(), model: v.string(), estimateUsd: v.number(), settledUsd: v.optional(v.number()),
  costExact: v.optional(v.boolean()), providerHandle: v.optional(v.string()), versionId: v.optional(v.id("inspirationVersions")),
  cycleStart: v.number(), note: v.optional(v.string()), resolvedBy: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
});

/* ── Status ─────────────────────────────────────────────────────────────── */

const statusValidator = v.object({
  paused: v.boolean(),
  pausedReason: v.optional(v.string()),
  allowance: v.union(v.null(), v.object({
    cycleCapUsd: v.number(), perJobCapUsd: v.optional(v.number()), expiresAt: v.optional(v.number()), providers: v.array(v.string()),
  })),
  cycleHours: v.number(),
  cycleStart: v.number(),
  cycleEnd: v.number(),
  heldUsd: v.number(),
  settledUsd: v.number(),
  remainingUsd: v.number(),
  canDispatch: v.boolean(),
  why: v.optional(v.string()),
  dispatcher: v.union(v.null(), v.object({ holder: v.string(), leaseUntil: v.number(), fence: v.number(), live: v.boolean() })),
  unknownOutcomes: v.array(jobViewValidator),
  revision: v.number(),
});

const blockReason = (dispatch: Dispatch | null, now: number) => {
  if (!dispatch || dispatch.paused) return dispatch?.pausedReason ?? "Generation is off until Michael sets an allowance.";
  if (dispatch.cycleCapUsd === undefined || dispatch.cycleCapUsd <= 0) return "No allowance is set.";
  if (dispatch.allowanceExpiresAt !== undefined && dispatch.allowanceExpiresAt <= now) return "The allowance expired.";
  return undefined;
};

export const getInspirationDispatch = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: statusValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const dispatch = await readDispatch(ctx, args.ownerUserId);
    const window = { cycleAnchor: dispatch?.cycleAnchor ?? now, cycleHours: dispatch?.cycleHours ?? D.cycleHours };
    const totals = await spend(ctx, args.ownerUserId, window, now);
    const why = blockReason(dispatch, now);
    const cap = dispatch?.cycleCapUsd;
    const unknownOutcomes = (await jobsWithStatus(ctx, args.ownerUserId, "unknown_outcome")).slice(0, D.listed).map(jobView);
    return {
      paused: dispatch?.paused ?? true,
      pausedReason: dispatch?.pausedReason ?? (dispatch ? undefined : "Generation is off until Michael sets an allowance."),
      allowance: cap !== undefined ? {
        cycleCapUsd: cap, perJobCapUsd: dispatch?.perJobCapUsd, expiresAt: dispatch?.allowanceExpiresAt, providers: dispatch?.providers ?? [],
      } : null,
      cycleHours: window.cycleHours,
      cycleStart: totals.cycleStart,
      cycleEnd: totals.cycleEnd,
      heldUsd: totals.heldUsd,
      settledUsd: totals.settledUsd,
      remainingUsd: Math.max(0, Math.round(((cap ?? 0) - totals.heldUsd - totals.settledUsd) * 10_000) / 10_000),
      canDispatch: !why,
      why,
      dispatcher: dispatch?.holder && dispatch.leaseUntil !== undefined
        ? { holder: dispatch.holder, leaseUntil: dispatch.leaseUntil, fence: dispatch.fence, live: dispatch.leaseUntil > now }
        : null,
      unknownOutcomes,
      revision: dispatch?.revision ?? 0,
    };
  },
});

export const listInspirationJobs = ownerQuery({
  args: { ownerUserId: v.string(), status: v.optional(inspirationJobStatusValidator), adaptationId: v.optional(v.id("inspirationAdaptations")) },
  returns: v.array(jobViewValidator),
  handler: async (ctx, args) => {
    if (args.adaptationId) {
      const rows = await ctx.db.query("inspirationJobs").withIndex("by_adaptation_createdAt", (q) => q.eq("adaptationId", args.adaptationId!))
        .order("desc").take(D.listed);
      return rows.filter((row) => owns(args.ownerUserId, row) && (!args.status || row.status === args.status)).map(jobView);
    }
    const statuses = args.status ? [args.status] : (["unknown_outcome", "reserved", "accepted", "settled", "released"] as const);
    const rows: Job[] = [];
    for (const status of statuses) rows.push(...await jobsWithStatus(ctx, args.ownerUserId, status));
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, D.listed).map(jobView);
  },
});

/* ── The dispatcher lease ───────────────────────────────────────────────── */

const leaseResult = v.object({ nonce: v.string(), fence: v.number(), leaseUntil: v.number(), quarantined: v.number() });

/**
 * Become the one dispatcher. Refused while another process holds a live
 * lease, whatever its label. A takeover moves every job still in flight
 * under an older fence to unknown_outcome: the new dispatcher never assumes
 * the old one's provider call did or did not happen.
 */
export const claimInspirationDispatcher = ownerMutation({
  args: { ownerUserId: v.string(), worker: v.string(), leaseMinutes: v.optional(v.number()) },
  returns: leaseResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const worker = cleanLine(args.worker, 80) ?? fail("worker is required.");
    const dispatch = await ensureDispatch(ctx, args.ownerUserId);
    if (dispatch.holderNonce && (dispatch.leaseUntil ?? 0) > now) {
      fail(`The dispatcher lease is held by ${dispatch.holder ?? "another worker"} until ${new Date(dispatch.leaseUntil!).toISOString()}. One dispatcher at a time; do not dispatch.`);
    }
    const minutes = Math.min(Math.max(Math.floor(args.leaseMinutes ?? D.leaseMinutes), 1), D.maxLeaseMinutes);
    const fence = dispatch.fence + 1;
    const nonce = crypto.randomUUID();
    const leaseUntil = now + minutes * 60_000;
    let quarantined = 0;
    for (const status of ["reserved", "accepted"] as const) {
      for (const job of await jobsWithStatus(ctx, args.ownerUserId, status)) {
        if (job.fence >= fence) continue;
        await ctx.db.patch(job._id, {
          status: "unknown_outcome", updatedAt: now,
          note: cleanLine(`Dispatcher replaced while ${status === "accepted" ? "the provider had accepted it" : "it was reserved"}; outcome unknown. ${job.note ?? ""}`, D.note),
        });
        quarantined += 1;
      }
    }
    await ctx.db.patch(dispatch._id, { holder: worker, holderNonce: nonce, leaseUntil, fence, revision: dispatch.revision + 1, updatedAt: now });
    return { nonce, fence, leaseUntil, quarantined };
  },
});

export const renewInspirationDispatcher = ownerMutation({
  args: { ownerUserId: v.string(), nonce: v.string(), fence: v.number(), leaseMinutes: v.optional(v.number()) },
  returns: leaseResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const dispatch = await readDispatch(ctx, args.ownerUserId);
    // An expired lease nobody else took may be renewed by its own holder.
    if (!dispatch || dispatch.holderNonce !== args.nonce || dispatch.fence !== args.fence) {
      fail(`Stale dispatcher: fence ${args.fence} is no longer current. Stop; claim again.`);
    }
    const minutes = Math.min(Math.max(Math.floor(args.leaseMinutes ?? D.leaseMinutes), 1), D.maxLeaseMinutes);
    const leaseUntil = now + minutes * 60_000;
    await ctx.db.patch(dispatch!._id, { leaseUntil, updatedAt: now });
    return { nonce: args.nonce, fence: args.fence, leaseUntil, quarantined: 0 };
  },
});

export const releaseInspirationDispatcher = ownerMutation({
  args: { ownerUserId: v.string(), nonce: v.string(), fence: v.number() },
  returns: v.object({ released: v.boolean() }),
  handler: async (ctx, args) => {
    const dispatch = await readDispatch(ctx, args.ownerUserId);
    if (!dispatch || dispatch.holderNonce !== args.nonce || dispatch.fence !== args.fence) return { released: false };
    // The fence stays: the next claim gets a higher one.
    await ctx.db.patch(dispatch._id, { holder: undefined, holderNonce: undefined, leaseUntil: undefined, revision: dispatch.revision + 1, updatedAt: Date.now() });
    return { released: true };
  },
});

/* ── Jobs ───────────────────────────────────────────────────────────────── */

const fenceArgs = { ownerUserId: v.string(), nonce: v.string(), fence: v.number() };

/**
 * Reserve one priced call before making it. Idempotent on ingestKey (a
 * retried reserve returns the same job, it never reserves twice).
 */
export const reserveInspirationJob = ownerMutation({
  args: {
    ...fenceArgs,
    adaptationId: v.id("inspirationAdaptations"),
    ingestKey: v.string(),
    provider: v.string(),
    model: v.string(),
    estimateUsd: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({ job: jobViewValidator, created: v.boolean(), remainingUsd: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const owner = args.ownerUserId;
    const ingestKey = cleanLine(args.ingestKey, D.ingestKey) ?? fail("ingestKey is required.");
    const dispatch = requireFence(await readDispatch(ctx, owner), args.nonce, args.fence, now);
    for (const candidate of resolveUserIdCandidates(owner)) {
      const repeat = await ctx.db.query("inspirationJobs").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
      if (repeat) {
        if (repeat.adaptationId !== args.adaptationId) fail("This ingestKey belongs to another adaptation's job.");
        const totals = await spend(ctx, owner, dispatch, now);
        return { job: jobView(repeat), created: false, remainingUsd: Math.max(0, (dispatch.cycleCapUsd ?? 0) - totals.heldUsd - totals.settledUsd) };
      }
    }
    const why = blockReason(dispatch, now);
    if (why) fail(`Not dispatched: ${why} Capture and proposals continue; paid work waits for Michael.`);
    const provider = cleanLine(args.provider, D.label) ?? fail("provider is required.");
    const model = cleanLine(args.model, D.label) ?? fail("model is required.");
    if (dispatch.providers.length && !dispatch.providers.includes(provider.toLowerCase())) {
      fail(`The allowance does not cover ${provider} (covers: ${dispatch.providers.join(", ")}).`);
    }
    const estimate = money(args.estimateUsd, "estimateUsd");
    if (estimate === undefined || estimate <= 0) fail("Unknown price: quote the live price (estimateUsd) before reserving. Unknown cost blocks paid work.");
    if (dispatch.perJobCapUsd !== undefined && estimate! > dispatch.perJobCapUsd) {
      fail(`$${estimate} is above the per-job cap of $${dispatch.perJobCapUsd}. Ask Michael.`);
    }
    const adaptation = await ctx.db.get(args.adaptationId);
    if (!adaptation || !owns(owner, adaptation)) fail("Adaptation not found.");
    if (adaptation!.status === "dropped") fail("Michael dropped this adaptation. No new spend on it.");
    if (adaptation!.status === "approved") fail("This adaptation is approved. A new version needs his redo first.");
    const source = await ctx.db.get(adaptation!.sourceId);
    if (!source || source.review === "dropped") fail("Michael dropped this source. No new spend on it.");
    const prior = await ctx.db.query("inspirationJobs").withIndex("by_adaptation_createdAt", (q) => q.eq("adaptationId", adaptation!._id))
      .order("desc").take(D.listed);
    const open = prior.find((job) => OPEN.has(job.status));
    if (open) {
      fail(open.status === "unknown_outcome"
        ? `job:${open._id} has an unknown outcome. Nothing is resubmitted until it is resolved (Michael, or a reconcile from the provider's own record).`
        : `job:${open._id} is still ${open.status} for this adaptation. Settle or release it first.`);
    }
    const totals = await spend(ctx, owner, dispatch, now);
    const used = totals.heldUsd + totals.settledUsd;
    const cap = dispatch.cycleCapUsd!;
    if (used + estimate! > cap + 1e-9) {
      fail(`Over the allowance: $${Math.round(used * 100) / 100} held or spent of $${cap} this cycle, this needs $${estimate}. Wait for the next cycle or ask Michael.`);
    }
    const jobId = await ctx.db.insert("inspirationJobs", {
      ownerUserId: adaptation!.ownerUserId, adaptationId: adaptation!._id, sourceId: adaptation!.sourceId, ingestKey,
      status: "reserved", fence: dispatch.fence, worker: dispatch.holder ?? "dispatcher", provider, model,
      estimateUsd: estimate!, cycleStart: totals.cycleStart, note: cleanLine(args.note, D.note), createdAt: now, updatedAt: now,
    });
    return { job: jobView((await ctx.db.get(jobId))!), created: true, remainingUsd: Math.max(0, Math.round((cap - used - estimate!) * 10_000) / 10_000) };
  },
});

/** Record what happened to a reserved job. Every step needs the current fence. */
export const updateInspirationJob = ownerMutation({
  args: {
    ...fenceArgs,
    jobId: v.id("inspirationJobs"),
    // accepted: the provider returned a handle. settled: done, charged.
    // unknown: acceptance or charge unknown (timeout, lost reply): quarantine.
    // released: never submitted (or the provider refused it before charging).
    // reconcile: an unknown outcome checked against the provider's own record.
    step: v.union(v.literal("accepted"), v.literal("settled"), v.literal("unknown"), v.literal("released"), v.literal("reconcile")),
    providerHandle: v.optional(v.string()),
    settledUsd: v.optional(v.number()),
    costExact: v.optional(v.boolean()),
    // reconcile only: what the provider's record shows.
    found: v.optional(v.boolean()),
    evidence: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: jobViewValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const dispatch = requireFence(await readDispatch(ctx, args.ownerUserId), args.nonce, args.fence, now);
    const job = await requireJob(ctx, args.ownerUserId, args.jobId);
    const note = cleanLine(args.note, D.note) ?? job.note;
    const handle = cleanLine(args.providerHandle, D.handle);
    let patch: Partial<Job>;
    if (args.step === "reconcile") {
      if (job.status !== "unknown_outcome") fail("Only an unknown outcome is reconciled.");
      const evidence = cleanLine(args.evidence, D.note) ?? fail("Reconcile needs evidence: the provider record you checked (request id, history entry).");
      if (args.found === undefined) fail("Reconcile needs found: true (the provider ran it) or false (no such job at the provider).");
      patch = args.found
        ? { status: "settled", providerHandle: handle ?? job.providerHandle, settledUsd: money(args.settledUsd, "settledUsd") ?? job.estimateUsd, costExact: args.costExact ?? false, resolvedBy: `${dispatch.holder ?? "dispatcher"}: ${evidence}` }
        : { status: "released", resolvedBy: `${dispatch.holder ?? "dispatcher"}: ${evidence}` };
    } else {
      // A job reserved under an older fence was quarantined at takeover; the
      // stale worker cannot settle or release it.
      if (job.fence !== dispatch.fence) fail(`job:${job._id} belongs to fence ${job.fence}; it was quarantined when the dispatcher changed.`);
      if (args.step === "accepted") {
        if (job.status !== "reserved") fail(`Only a reserved job can be accepted (this one is ${job.status}).`);
        patch = { status: "accepted", providerHandle: handle ?? fail("accepted needs the providerHandle (request id).") };
      } else if (args.step === "settled") {
        if (job.status !== "reserved" && job.status !== "accepted") fail(`A ${job.status} job cannot be settled here.`);
        patch = { status: "settled", providerHandle: handle ?? job.providerHandle, settledUsd: money(args.settledUsd, "settledUsd") ?? job.estimateUsd, costExact: args.costExact ?? false };
      } else if (args.step === "unknown") {
        if (job.status !== "reserved" && job.status !== "accepted") fail(`A ${job.status} job cannot be quarantined.`);
        patch = { status: "unknown_outcome", providerHandle: handle ?? job.providerHandle };
      } else {
        if (job.status !== "reserved") fail("Only a reserved job is released. An accepted call may have been charged: settle it, or mark it unknown.");
        patch = { status: "released" };
      }
    }
    await ctx.db.patch(job._id, { ...patch, note, updatedAt: now });
    return jobView((await ctx.db.get(job._id))!);
  },
});

/**
 * Link a posted version to the job that produced it. Called by
 * postInspirationVersion; returns false when the job's fence is stale, so
 * that version is stored as an orphan and never replaces the current one.
 */
export const attachVersionToJob = async (
  ctx: MutationCtx, owner: string, input: { jobId: Id<"inspirationJobs">; nonce?: string; fence?: number; adaptationId: Id<"inspirationAdaptations"> },
) => {
  const job = await ctx.db.get(input.jobId);
  if (!job || !owns(owner, job) || job.adaptationId !== input.adaptationId) fail("That job is not for this adaptation.");
  const dispatch = await readDispatch(ctx, owner);
  const current = Boolean(dispatch && input.nonce && dispatch.holderNonce === input.nonce && dispatch.fence === input.fence && job!.fence === input.fence
    && job!.status !== "unknown_outcome" && job!.status !== "released");
  return { job: job!, current };
};

export const linkJobVersion = async (ctx: MutationCtx, jobId: Id<"inspirationJobs">, versionId: Id<"inspirationVersions">) =>
  ctx.db.patch(jobId, { versionId, updatedAt: Date.now() });

/* ── Michael's controls (browser session only) ──────────────────────────── */

/**
 * Pause, resume, or set the standing allowance. Resuming needs a cycle cap
 * and an expiry; pausing always works and stops the next reservation.
 */
export const setInspirationDispatch = ownerSessionMutation({
  args: {
    ownerUserId: v.string(),
    expectedRevision: v.number(),
    paused: v.boolean(),
    cycleCapUsd: v.optional(v.number()),
    perJobCapUsd: v.optional(v.number()),
    allowanceDays: v.optional(v.number()),
    providers: v.optional(v.array(v.string())),
  },
  returns: v.object({ revision: v.number(), paused: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await readDispatch(ctx, args.ownerUserId);
    if ((existing?.revision ?? 0) !== args.expectedRevision) {
      fail(`The generation settings changed while you were looking (revision ${existing?.revision ?? 0}). Reload; nothing was applied.`);
    }
    const now = Date.now();
    if (args.paused) {
      const dispatch = existing ?? await ensureDispatch(ctx, args.ownerUserId);
      await ctx.db.patch(dispatch._id, { paused: true, pausedReason: "Paused by Michael.", revision: dispatch.revision + 1, updatedAt: now });
      return { revision: dispatch.revision + 1, paused: true };
    }
    const cap = money(args.cycleCapUsd, "cycleCapUsd");
    if (cap === undefined || cap <= 0) fail("Set a cap per 48 hours before turning generation on.");
    if (cap! > D.maxCycleCapUsd) fail(`A standing allowance above $${D.maxCycleCapUsd} per cycle is not offered; approve such a batch on its own.`);
    const perJob = money(args.perJobCapUsd, "perJobCapUsd");
    const days = Math.min(Math.max(Math.floor(args.allowanceDays ?? D.defaultAllowanceDays), 1), D.maxAllowanceDays);
    const providers = [...new Set((args.providers ?? []).map((value) => cleanLine(value, D.label)?.toLowerCase()).filter((value): value is string => Boolean(value)))].slice(0, 8);
    const dispatch = existing ?? await ensureDispatch(ctx, args.ownerUserId);
    await ctx.db.patch(dispatch._id, {
      paused: false, pausedReason: undefined, cycleCapUsd: cap, perJobCapUsd: perJob,
      allowanceExpiresAt: now + days * 86_400_000, providers, revision: dispatch.revision + 1, updatedAt: now,
    });
    return { revision: dispatch.revision + 1, paused: false };
  },
});

/** Michael settles an unknown outcome: it was charged (cost) or it was not. */
export const resolveInspirationJob = ownerSessionMutation({
  args: { ownerUserId: v.string(), jobId: v.id("inspirationJobs"), charged: v.boolean(), settledUsd: v.optional(v.number()) },
  returns: jobViewValidator,
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.ownerUserId, args.jobId);
    if (job.status !== "unknown_outcome") fail("Only an unknown outcome needs your call.");
    const now = Date.now();
    await ctx.db.patch(job._id, args.charged
      ? { status: "settled", settledUsd: money(args.settledUsd, "settledUsd") ?? job.estimateUsd, costExact: args.settledUsd !== undefined, resolvedBy: "owner", updatedAt: now }
      : { status: "released", resolvedBy: "owner", updatedAt: now });
    return jobView((await ctx.db.get(job._id))!);
  },
});
