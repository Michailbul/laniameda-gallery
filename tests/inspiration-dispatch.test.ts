import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import {
  postInspirationVersion, proposeInspirationAdaptation, registerInspirationSource, reviewInspirationAdaptation,
} from "../convex/inspiration";
import {
  claimInspirationDispatcher, getInspirationDispatch, releaseInspirationDispatcher, renewInspirationDispatcher,
  reserveInspirationJob, resolveInspirationJob, setInspirationDispatch, updateInspirationJob,
} from "../convex/inspirationDispatch";
import { cycleStartAt } from "../lib/inspiration";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

// Dispatch safety: the critic's lease, budget, uncertain-job and revocation
// tests (skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b), against the real handlers.

const OWNER = "telegram:42";

type Fn = { _handler: (ctx: never, args: never) => unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const as = (identity: Record<string, unknown> | null) => <F extends Fn>(fn: F) => (ctx: Any, args: Any) =>
  (fn._handler as (ctx: unknown, args: unknown) => Promise<Any>)({ ...ctx, auth: { getUserIdentity: async () => identity } }, args);
const session = as({ subject: OWNER, via: "session" });
const agent = as({ subject: OWNER });

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0); // 24 Oct 2026, the day before Prague leaves summer time

describe("inspiration dispatch safety", () => {
  let env: ReturnType<typeof createMockConvexMutationCtx>;
  let ctx: Any;
  let adaptations: string[];

  const status = () => agent(getInspirationDispatch)(ctx, { ownerUserId: OWNER });
  const allow = async (cycleCapUsd = 1, extra: Record<string, unknown> = {}) => {
    const current = await status();
    return session(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: current.revision, paused: false, cycleCapUsd, ...extra });
  };
  const claim = (worker = "agent:main") => agent(claimInspirationDispatcher)(ctx, { ownerUserId: OWNER, worker });
  const reserve = (lease: Any, adaptationId: string, key: string, estimateUsd: number | undefined = 0.4, extra: Record<string, unknown> = {}) =>
    agent(reserveInspirationJob)(ctx, {
      ownerUserId: OWNER, nonce: lease.nonce, fence: lease.fence, adaptationId, ingestKey: key,
      provider: "fal", model: "Seedream 5 Pro", estimateUsd, ...extra,
    });
  const step = (lease: Any, jobId: string, stepName: string, extra: Record<string, unknown> = {}) =>
    agent(updateInspirationJob)(ctx, { ownerUserId: OWNER, nonce: lease.nonce, fence: lease.fence, jobId, step: stepName, ...extra });

  beforeEach(async () => {
    setSystemTime(new Date(T0));
    env = createMockConvexMutationCtx();
    ctx = env.ctx;
    const world = await env.db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete", worldKey: "dear-annete" });
    adaptations = [];
    for (const index of [1, 2, 3]) {
      const source = await agent(registerInspirationSource)(ctx, {
        ownerUserId: OWNER, ingestKey: `idea:${index}`, kind: "text", title: `Idea ${index}`,
        platform: "telegram", text: "A room you redecorate every time you remember it.", preservation: "text",
      });
      const proposal = await agent(proposeInspirationAdaptation)(ctx, {
        ownerUserId: OWNER, sourceId: source.sourceId, ingestKey: `adapt:${index}`, targetWorldId: world,
        targetLabel: "Dear Annete · Film", intendedUse: "One beat from the idea.", routing: "owner",
      });
      adaptations.push(proposal.adaptationId);
    }
  });
  afterEach(() => setSystemTime());

  test("generation is off by default: nothing reserves until Michael sets an allowance", async () => {
    const initial = await status();
    expect(initial.paused).toBe(true);
    expect(initial.canDispatch).toBe(false);
    expect(initial.allowance).toBeNull();
    const lease = await claim();
    await expect(reserve(lease, adaptations[0], "job:a")).rejects.toThrow(/Not dispatched/);
    expect(await env.db.query("inspirationJobs").collect()).toHaveLength(0);
  });

  test("only a browser session turns generation on, and only with a cap", async () => {
    await expect(agent(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: 0, paused: false, cycleCapUsd: 5 }))
      .rejects.toThrow(/Only Michael/);
    await expect(session(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: 0, paused: false }))
      .rejects.toThrow(/cap/);
    await expect(session(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: 0, paused: false, cycleCapUsd: 500 }))
      .rejects.toThrow(/not offered/);
    await allow(5);
    const on = await status();
    expect(on.canDispatch).toBe(true);
    expect(on.allowance?.cycleCapUsd).toBe(5);
    // A stale revision is refused.
    await expect(session(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: 0, paused: true })).rejects.toThrow(/changed/);
  });

  test("lease conflict: a second process is refused even under the same label, and a replaced worker cannot write", async () => {
    await allow(5);
    const first = await claim("agent:main");
    await expect(claim("agent:main")).rejects.toThrow(/held by agent:main/);
    // The lease lapses; a second process takes over with a higher fence.
    setSystemTime(new Date(T0 + 31 * 60_000));
    const second = await claim("agent:main");
    expect(second.fence).toBe(first.fence + 1);
    await expect(reserve(first, adaptations[0], "job:stale")).rejects.toThrow(/Stale dispatcher/);
    await expect(agent(renewInspirationDispatcher)(ctx, { ownerUserId: OWNER, nonce: first.nonce, fence: first.fence })).rejects.toThrow(/Stale/);
    expect((await agent(releaseInspirationDispatcher)(ctx, { ownerUserId: OWNER, nonce: first.nonce, fence: first.fence })).released).toBe(false);
    const job = await reserve(second, adaptations[0], "job:fresh");
    expect(job.created).toBe(true);
  });

  test("budget: two reservations that together exceed the cap cannot both succeed; unknown price is refused", async () => {
    await allow(1);
    const lease = await claim();
    await expect(reserve(lease, adaptations[0], "job:noprice", 0.4, { estimateUsd: undefined })).rejects.toThrow(/Unknown price/);
    const a = await reserve(lease, adaptations[0], "job:a", 0.6);
    expect(a.created).toBe(true);
    await expect(reserve(lease, adaptations[1], "job:b", 0.6)).rejects.toThrow(/Over the allowance/);
    // A retried reserve under the same key returns the same job, it does not reserve twice.
    const again = await reserve(lease, adaptations[0], "job:a", 0.6);
    expect(again.created).toBe(false);
    expect(again.job.jobId).toBe(a.job.jobId);
    // Task splitting does not bypass the cap: a second job on the same adaptation is refused while one is open.
    await expect(reserve(lease, adaptations[0], "job:a2", 0.1)).rejects.toThrow(/still reserved/);
    const fits = await reserve(lease, adaptations[1], "job:b-small", 0.4);
    expect(fits.remainingUsd).toBe(0);
  });

  test("a per-job cap and a provider list bound each call", async () => {
    await allow(5, { perJobCapUsd: 0.5, providers: ["fal"] });
    const lease = await claim();
    await expect(reserve(lease, adaptations[0], "job:big", 0.8)).rejects.toThrow(/per-job cap/);
    await expect(reserve(lease, adaptations[0], "job:pika", 0.2, { provider: "pika" })).rejects.toThrow(/does not cover pika/);
  });

  test("uncertain job: a takeover quarantines the in-flight job; it is never resubmitted and its budget stays held across cycles", async () => {
    await allow(1);
    const first = await claim();
    const job = await reserve(first, adaptations[0], "job:a", 0.5);
    await step(first, job.job.jobId, "accepted", { providerHandle: "fal-req-123" });
    // The worker crashes before it records the result. The lease lapses.
    setSystemTime(new Date(T0 + 31 * 60_000));
    const second = await claim();
    expect(second.quarantined).toBe(1);
    const row = (await env.db.get(job.job.jobId)) as Any;
    expect(row.status).toBe("unknown_outcome");
    expect(row.providerHandle).toBe("fal-req-123");
    // The old worker cannot settle it; the new one cannot resubmit for that adaptation.
    await expect(step(first, job.job.jobId, "settled", { settledUsd: 0.5 })).rejects.toThrow(/Stale/);
    await expect(reserve(second, adaptations[0], "job:a-retry", 0.5)).rejects.toThrow(/unknown outcome/);
    // A new cycle starts: the uncertain charge is still held.
    setSystemTime(new Date(T0 + 49 * HOUR));
    const third = await claim();
    const later = await status();
    expect(later.heldUsd).toBe(0.5);
    expect(later.unknownOutcomes).toHaveLength(1);
    await expect(reserve(third, adaptations[1], "job:b", 0.6)).rejects.toThrow(/Over the allowance/);
    // Reconcile needs the provider's own record.
    await expect(step(third, job.job.jobId, "reconcile", { found: true })).rejects.toThrow(/evidence/);
    const settled = await step(third, job.job.jobId, "reconcile", { found: true, settledUsd: 0.45, costExact: true, evidence: "fal request fal-req-123 completed" });
    expect(settled.status).toBe("settled");
  });

  test("Michael resolves an unknown outcome; an agent cannot", async () => {
    await allow(1);
    const lease = await claim();
    const job = await reserve(lease, adaptations[0], "job:a", 0.5);
    await step(lease, job.job.jobId, "unknown", { note: "timeout after submit" });
    await expect(agent(resolveInspirationJob)(ctx, { ownerUserId: OWNER, jobId: job.job.jobId, charged: false })).rejects.toThrow(/Only Michael/);
    const resolved = await session(resolveInspirationJob)(ctx, { ownerUserId: OWNER, jobId: job.job.jobId, charged: false });
    expect(resolved.status).toBe("released");
    expect((await status()).heldUsd).toBe(0);
  });

  test("revocation: pausing stops the next reservation; a dropped adaptation takes no new spend", async () => {
    await allow(5);
    const lease = await claim();
    const job = await reserve(lease, adaptations[0], "job:a", 0.2);
    await step(lease, job.job.jobId, "settled", { settledUsd: 0.2, costExact: true });
    const current = await status();
    await session(setInspirationDispatch)(ctx, { ownerUserId: OWNER, expectedRevision: current.revision, paused: true });
    await expect(reserve(lease, adaptations[1], "job:b", 0.2)).rejects.toThrow(/Paused by Michael/);
    await allow(5);
    const adaptation = (await env.db.get(adaptations[2])) as Any;
    await session(reviewInspirationAdaptation)(ctx, {
      ownerUserId: OWNER, adaptationId: adaptations[2], eventKey: "drop-1", action: "drop", version: 0, expectedRevision: adaptation.revision,
    });
    await expect(reserve(lease, adaptations[2], "job:c", 0.2)).rejects.toThrow(/dropped/);
    // An expired allowance stops it too.
    setSystemTime(new Date(T0 + 15 * 24 * HOUR));
    const renewed = await claim();
    await expect(reserve(renewed, adaptations[1], "job:late", 0.2)).rejects.toThrow(/expired/);
  });

  test("a stale fence's result is kept privately as an orphan and never replaces the current version", async () => {
    await allow(5);
    const first = await claim();
    const job = await reserve(first, adaptations[0], "job:a", 0.2);
    setSystemTime(new Date(T0 + 31 * 60_000));
    await claim();
    const posted = await agent(postInspirationVersion)(ctx, {
      ownerUserId: OWNER, adaptationId: adaptations[0], ingestKey: "v1", basedOnVersion: 0, outputs: [], text: "A late result.",
      jobId: job.job.jobId, dispatchNonce: first.nonce, dispatchFence: first.fence,
    });
    expect(posted.orphan).toBe(true);
    const adaptation = (await env.db.get(adaptations[0])) as Any;
    expect(adaptation.currentVersion).toBe(0);
    expect(((await env.db.get(job.job.jobId)) as Any).versionId).toBeUndefined();
  });

  test("a current fence links its version to the job", async () => {
    await allow(5);
    const lease = await claim();
    const job = await reserve(lease, adaptations[0], "job:a", 0.2);
    const posted = await agent(postInspirationVersion)(ctx, {
      ownerUserId: OWNER, adaptationId: adaptations[0], ingestKey: "v1", basedOnVersion: 0, outputs: [], text: "The beat.",
      jobId: job.job.jobId, dispatchNonce: lease.nonce, dispatchFence: lease.fence,
    });
    expect(posted.orphan).toBe(false);
    expect(((await env.db.get(job.job.jobId)) as Any).versionId).toBe(posted.versionId);
  });

  test("cycles are 48 hours of real time across the DST change and month ends", () => {
    const anchor = Date.UTC(2026, 9, 24, 12, 0, 0);
    // 25 Oct 2026: Prague leaves summer time; the cycle still ends 48 real hours later.
    expect(cycleStartAt(anchor, 48, anchor + 47 * HOUR)).toBe(anchor);
    expect(cycleStartAt(anchor, 48, anchor + 48 * HOUR)).toBe(anchor + 48 * HOUR);
    // A missed week resumes in the current cycle: one window, no burst of back cycles.
    expect(cycleStartAt(anchor, 48, anchor + 7 * 24 * HOUR + HOUR)).toBe(anchor + 144 * HOUR);
    expect(cycleStartAt(anchor, 48, anchor - HOUR)).toBe(anchor);
  });

  test("private originals: no paid job may use a processor Michael has not cleared for that source", async () => {
    await allow(5);
    const lease = await claim();
    const adaptation = (await env.db.get(adaptations[0] as never)) as Any;
    const mediaId = await env.db.insert("inspirationPrivateMedia", {
      ownerUserId: OWNER, storageId: "_storage:1", sourceId: adaptation.sourceId, ingestKey: "p1", kind: "image",
      contentType: "image/jpeg", size: 10, sha256: "ab", externalProcessing: "none", createdBy: "agent", createdAt: T0,
    });
    await expect(reserve(lease, adaptations[0], "job:private")).rejects.toThrow(/not cleared fal/);
    // Cleared for another processor only: still refused for fal.
    await env.db.patch(mediaId, { externalProcessing: "cleared", clearedProcessors: [{ name: "pika", clearedAt: T0 }] });
    await expect(reserve(lease, adaptations[0], "job:private")).rejects.toThrow(/not cleared fal/);
    await env.db.patch(mediaId, { clearedProcessors: [{ name: "pika", clearedAt: T0 }, { name: "fal", clearedAt: T0 }] });
    expect((await reserve(lease, adaptations[0], "job:private")).created).toBe(true);
    // A source with no private files is unaffected.
    expect((await reserve(lease, adaptations[1], "job:public")).created).toBe(true);
  });
});
