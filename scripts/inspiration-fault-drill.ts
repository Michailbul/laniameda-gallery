// Live fault drill for inspiration dispatch safety (critic test "Uncertain
// job", skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b): a provider accepts a job,
// the dispatcher crashes before it records the outcome, a second dispatcher
// takes over, the job is quarantined, nothing is resubmitted, and the job is
// reconciled from the provider's own record.
//
// It runs the deployed Convex functions under a throwaway drill owner
// ("drill:<timestamp>"), never Michael's account: no allowance of his is
// touched, no provider is called, nothing costs money. The "provider" is a
// fixed record ("drill", $0.01) whose request id the drill holds.
//
//   CONVEX_URL=https://<deployment>.convex.cloud \
//   CONVEX_AUTH_PRIVATE_KEY_FILE=/path/to/key.pem \
//   bun scripts/inspiration-fault-drill.ts
//
// The private key signs the drill owner's tokens exactly as the gallery's
// server does; it is read from a file and never printed.

import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintConvexActorToken } from "../lib/convex-auth";

const url = process.env.CONVEX_URL;
const keyFile = process.env.CONVEX_AUTH_PRIVATE_KEY_FILE;
if (!url || !keyFile) throw new Error("Set CONVEX_URL and CONVEX_AUTH_PRIVATE_KEY_FILE.");
const privateKeyPem = readFileSync(keyFile, "utf8").replace(/\\n/g, "\n");

const stamp = Date.now();
const owner = `drill:${stamp}`;
const client = (via?: "session") => {
  const convex = new ConvexHttpClient(url);
  convex.setAuth(mintConvexActorToken(owner, { privateKeyPem, via, ttlSeconds: 600 }));
  return convex;
};
const agent = client();
const session = client("session");

const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`);
};
const refused = async (step: string, run: () => Promise<unknown>, pattern: RegExp) => {
  try {
    await run();
    record(step, false, "was accepted");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(step, pattern.test(message), message.replace(/^[\s\S]*ConvexError: /, "").split("\n")[0]!.slice(0, 160));
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  console.log(`Fault drill on ${url} as ${owner}`);
  const source = await agent.mutation(api.inspiration.registerInspirationSource, {
    ownerUserId: owner, ingestKey: `drill:${stamp}:source`, kind: "text", title: "Fault drill source", platform: "other",
    text: "Drill only. Not Michael's material.", preservation: "text", createdBy: "agent:fault-drill",
  });
  const proposal = await agent.mutation(api.inspiration.proposeInspirationAdaptation, {
    ownerUserId: owner, sourceId: source.sourceId, ingestKey: `drill:${stamp}:take`, targetLabel: "Drill",
    intendedUse: "Exercise dispatch recovery.", routing: "suggestion", routingReason: "fault drill", createdBy: "agent:fault-drill",
  });
  if (proposal.suppressed) throw new Error("Drill proposal was suppressed.");
  const adaptationId = proposal.adaptationId as Id<"inspirationAdaptations">;

  await refused("agent cannot turn generation on", () => agent.mutation(api.inspirationDispatch.setInspirationDispatch, {
    ownerUserId: owner, expectedRevision: 0, paused: false, cycleCapUsd: 1,
  }), /Only Michael/);
  const status0 = await agent.query(api.inspirationDispatch.getInspirationDispatch, { ownerUserId: owner });
  await session.mutation(api.inspirationDispatch.setInspirationDispatch, {
    ownerUserId: owner, expectedRevision: status0.revision, paused: false, cycleCapUsd: 1, perJobCapUsd: 0.05, allowanceDays: 1, providers: ["drill"],
  });

  const leaseA = await agent.mutation(api.inspirationDispatch.claimInspirationDispatcher, { ownerUserId: owner, worker: "agent:drill-A", leaseMinutes: 1 });
  record("dispatcher A claims", true, `fence ${leaseA.fence}, lease until ${new Date(leaseA.leaseUntil).toISOString()}`);
  const reserved = await agent.mutation(api.inspirationDispatch.reserveInspirationJob, {
    ownerUserId: owner, nonce: leaseA.nonce, fence: leaseA.fence, adaptationId, ingestKey: `drill:${stamp}:job1`,
    provider: "drill", model: "fault-drill", estimateUsd: 0.01, note: "fault drill",
  });
  const jobId = reserved.job.jobId;
  const handle = `drill-req-${stamp}`;
  await agent.mutation(api.inspirationDispatch.updateInspirationJob, {
    ownerUserId: owner, nonce: leaseA.nonce, fence: leaseA.fence, jobId, step: "accepted", providerHandle: handle,
  });
  record("provider accepts the job; A records the handle", true, handle);
  // A crashes here: it never records settled or unknown.

  await refused("a second dispatcher is refused while A's lease is live", () => agent.mutation(api.inspirationDispatch.claimInspirationDispatcher, {
    ownerUserId: owner, worker: "agent:drill-B",
  }), /held by agent:drill-A/);

  const wait = Math.max(0, leaseA.leaseUntil - Date.now()) + 2_000;
  console.log(`… waiting ${Math.round(wait / 1000)} s for A's lease to lapse`);
  await sleep(wait);

  const leaseB = await agent.mutation(api.inspirationDispatch.claimInspirationDispatcher, { ownerUserId: owner, worker: "agent:drill-B", leaseMinutes: 5 });
  record("dispatcher B takes over and quarantines A's in-flight job", leaseB.fence === leaseA.fence + 1 && leaseB.quarantined === 1,
    `fence ${leaseB.fence}, quarantined ${leaseB.quarantined}`);
  const afterTakeover = await agent.query(api.inspirationDispatch.listInspirationJobs, { ownerUserId: owner, adaptationId });
  const quarantined = afterTakeover.find((job) => job.jobId === jobId);
  record("the job is unknown_outcome with the provider handle kept", quarantined?.status === "unknown_outcome" && quarantined.providerHandle === handle,
    `${quarantined?.status} · ${quarantined?.providerHandle}`);
  const held = await agent.query(api.inspirationDispatch.getInspirationDispatch, { ownerUserId: owner });
  record("its budget stays held", held.heldUsd === 0.01 && held.unknownOutcomes.length === 1, `held $${held.heldUsd}, unknown ${held.unknownOutcomes.length}`);

  await refused("A, restarted, cannot settle with its old fence", () => agent.mutation(api.inspirationDispatch.updateInspirationJob, {
    ownerUserId: owner, nonce: leaseA.nonce, fence: leaseA.fence, jobId, step: "settled", settledUsd: 0.01,
  }), /Stale dispatcher/);
  await refused("B cannot resubmit while the outcome is unknown", () => agent.mutation(api.inspirationDispatch.reserveInspirationJob, {
    ownerUserId: owner, nonce: leaseB.nonce, fence: leaseB.fence, adaptationId, ingestKey: `drill:${stamp}:job2`,
    provider: "drill", model: "fault-drill", estimateUsd: 0.01,
  }), /unknown outcome/);
  await refused("reconcile needs the provider record as evidence", () => agent.mutation(api.inspirationDispatch.updateInspirationJob, {
    ownerUserId: owner, nonce: leaseB.nonce, fence: leaseB.fence, jobId, step: "reconcile", found: true,
  }), /evidence/);

  // B looks the request id up at the provider: the drill provider's record says it ran and cost $0.01.
  const reconciled = await agent.mutation(api.inspirationDispatch.updateInspirationJob, {
    ownerUserId: owner, nonce: leaseB.nonce, fence: leaseB.fence, jobId, step: "reconcile", found: true,
    evidence: `drill provider record ${handle}: completed, charged $0.01`, settledUsd: 0.01, costExact: true,
  });
  record("B reconciles it from the provider's record", reconciled.status === "settled" && reconciled.settledUsd === 0.01,
    `${reconciled.status} $${reconciled.settledUsd} · ${reconciled.resolvedBy}`);
  const final = await agent.query(api.inspirationDispatch.getInspirationDispatch, { ownerUserId: owner });
  const jobs = await agent.query(api.inspirationDispatch.listInspirationJobs, { ownerUserId: owner });
  record("exactly one job, charged once; nothing held", jobs.length === 1 && final.heldUsd === 0 && final.settledUsd === 0.01,
    `${jobs.length} job, held $${final.heldUsd}, settled $${final.settledUsd}`);

  await agent.mutation(api.inspirationDispatch.releaseInspirationDispatcher, { ownerUserId: owner, nonce: leaseB.nonce, fence: leaseB.fence });
  await session.mutation(api.inspirationDispatch.setInspirationDispatch, { ownerUserId: owner, expectedRevision: final.revision, paused: true });
  const failed = steps.filter((step) => !step.ok);
  console.log(JSON.stringify({ owner, adaptationId, jobId, passed: steps.length - failed.length, failed: failed.length }));
  if (failed.length) process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
