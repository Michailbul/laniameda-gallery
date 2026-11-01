"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { processMediaInput } from "./ingest";
import {
  buildEditInput, classifyProviderRefusal, editIdempotencyKey, editModelById, estimateEditUsd,
  pikaCharge, readFalResult, readFalStatus, readPikaJob, type EditPollResult, type EditProvider,
} from "../lib/edit-models";

// Runs one in-place edit job (convex/editJobs.ts): submit along the model's
// route, poll by request id until it lands, then file the result as a new
// asset next to its source. Ported from reviewer-kit/server.py (Fal, Pika,
// Board._run). The source and references go to the provider as their public
// gallery URLs, so nothing is uploaded first.

const PIKA_BASE = "https://api.dev.pika.art";
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const HTTP_TIMEOUT_MS = 60 * 1000;

type Job = Doc<"editJobs">;
type Loaded = {
  job: unknown; sourceUrl?: string; refUrls: string[];
  sourceTagIds: Id<"tags">[]; sourceFolderId?: Id<"folders">; folderIds: Id<"folders">[];
};
type Submitted = { requestId: string; statusUrl?: string; responseUrl?: string };

/** A billing or auth block: the next route gets the job. */
class Refused extends Error {
  constructor(message: string, readonly outOfCredit: boolean) { super(message); }
}

const keyFor = (provider: EditProvider) =>
  (provider === "fal" ? process.env.FAL_KEY : process.env.PIKA_API_KEY)?.trim() || undefined;

const headersFor = (provider: EditProvider, key: string): Record<string, string> =>
  provider === "fal" ? { Authorization: `Key ${key}` } : { "X-API-Key": key };

const http = async (method: string, url: string, headers: Record<string, string>, body?: unknown) => {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text.slice(0, 400) }; }
  return { status: response.status, body: parsed };
};

const submit = async (provider: EditProvider, endpoint: string, input: Record<string, unknown>, idempotencyKey: string): Promise<Submitted> => {
  const key = keyFor(provider);
  if (!key) throw new Refused(`${provider}: no API key in the deployment`, false);
  if (provider === "fal") {
    const { status, body } = await http("POST", `https://queue.fal.run/${endpoint}`, headersFor("fal", key), input);
    const refusal = classifyProviderRefusal("fal", status, (body as { detail?: unknown } | null)?.detail ?? body);
    if (refusal.blocked) throw new Refused(refusal.message, refusal.outOfCredit);
    const row = body as { request_id?: string; status_url?: string; response_url?: string } | null;
    if (status >= 300 || !row?.request_id) throw new Error(`fal ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    return { requestId: row.request_id, statusUrl: row.status_url, responseUrl: row.response_url };
  }
  const { status, body } = await http("POST", `${PIKA_BASE}/v1/media/${endpoint}`,
    { ...headersFor("pika", key), "Idempotency-Key": idempotencyKey }, input);
  const row = body as { id?: string; status?: string; error?: unknown } | null;
  const refusal = classifyProviderRefusal("pika", status, row?.error ?? body);
  if (refusal.blocked) throw new Refused(refusal.message, refusal.outOfCredit);
  if (status >= 300 || !row?.id) throw new Error(`pika ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (row.status === "failed") throw new Error(`pika failed: ${JSON.stringify(row.error).slice(0, 300)}`);
  return { requestId: row.id };
};

const pollProvider = async (job: Job): Promise<EditPollResult> => {
  const provider = job.provider as EditProvider;
  const key = keyFor(provider);
  if (!key) return { state: "error", error: `${provider}: no API key in the deployment` };
  if (provider === "fal") {
    const statusUrl = job.statusUrl ?? `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}/status`;
    const status = await http("GET", statusUrl, headersFor("fal", key));
    const read = readFalStatus(status.status, status.body);
    if (read === "running") return { state: "running" };
    if (read !== "completed") return { state: "error", error: read.error };
    const responseUrl = job.responseUrl ?? `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}`;
    const result = await http("GET", responseUrl, headersFor("fal", key));
    return readFalResult(result.status, result.body);
  }
  const result = await http("GET", `${PIKA_BASE}/v1/media/jobs/${job.requestId}`, headersFor("pika", key));
  return readPikaJob(result.status, result.body);
};

/** Pika settles the bill a moment after the image: wait for the exact charge a little. */
const settledPikaCharge = async (requestId: string) => {
  const key = keyFor("pika");
  if (!key) return undefined;
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { status, body } = await http("GET", `${PIKA_BASE}/v1/media/jobs/${requestId}`, headersFor("pika", key));
    if (status < 300 && body && typeof body === "object") {
      const usd = pikaCharge(body as Parameters<typeof pikaCharge>[0]);
      if (usd !== undefined) return usd;
    }
  }
  return undefined;
};

const modelProviderOf = (model: string) =>
  model.startsWith("gpt-") ? "openai" as const : model.startsWith("nano-") ? "google" as const
    : model.startsWith("kontext") ? "flux" as const : "other" as const;

const usdText = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

/** Submit a queued job along its route. A job with a request id is only polled. */
export const run = internalAction({
  args: { jobId: v.id("editJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const loaded: Loaded | null = await ctx.runQuery(internal.editJobs.jobForRun, { jobId: args.jobId });
    if (!loaded) return null;
    const job = loaded.job as Job;
    if (job.requestId) {
      if (job.status === "running") await ctx.scheduler.runAfter(0, internal.editRunner.poll, { jobId: job._id });
      return null;
    }
    if (!await ctx.runMutation(internal.editJobs.claimJob, { jobId: job._id })) return null;
    const fail = async (error: string, errorKind: "out_of_credit" | "provider"): Promise<null> => {
      await ctx.runMutation(internal.editJobs.failJob, { jobId: job._id, error, errorKind });
      return null;
    };

    const model = editModelById(job.model);
    if (!model) return await fail(`Unknown model ${job.model}.`, "provider");
    if (!loaded.sourceUrl) return await fail("The source image has no URL.", "provider");
    const urls = [loaded.sourceUrl, ...loaded.refUrls];

    const refusals: Refused[] = [];
    for (const [index, route] of model.routes.entries()) {
      const input = buildEditInput(route.endpoint, job.prompt, urls, job.width, job.height);
      try {
        const sent = await submit(route.provider, route.endpoint, input, editIdempotencyKey(job._id, job.retries, index));
        await ctx.runMutation(internal.editJobs.recordSubmitted, {
          jobId: job._id, provider: route.provider, endpoint: route.endpoint, ...sent,
          estimateUsd: estimateEditUsd(route.endpoint, job.width, job.height, job.refAssetIds.length),
        });
        await ctx.scheduler.runAfter(3000, internal.editRunner.poll, { jobId: job._id });
        return null;
      } catch (error) {
        if (!(error instanceof Refused)) {
          return await fail(error instanceof Error ? error.message : String(error), "provider");
        }
        refusals.push(error);
        await ctx.runMutation(internal.editJobs.recordRefusal, {
          jobId: job._id, provider: route.provider, endpoint: route.endpoint,
          error: error.message, outOfCredit: error.outOfCredit,
        });
      }
    }
    const outOfCredit = refusals.some((refusal) => refusal.outOfCredit);
    const message = refusals.map((refusal) => refusal.message).join(" · ") + "."
      + (outOfCredit ? " Nothing was charged. Add credit on fal or Pika, then press Retry." : "");
    return await fail(message, outOfCredit ? "out_of_credit" : "provider");
  },
});

/** Poll the provider by request id; reschedules itself until the job lands or times out. */
export const poll = internalAction({
  args: { jobId: v.id("editJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const loaded: Loaded | null = await ctx.runQuery(internal.editJobs.jobForRun, { jobId: args.jobId });
    const job = loaded?.job as Job | undefined;
    if (!loaded || !job || job.status !== "running" || !job.requestId) return null;
    const count = await ctx.runMutation(internal.editJobs.notePoll, { jobId: job._id });
    const again = async (): Promise<null> => {
      if (Date.now() - (job.submittedAt ?? job.createdAt) > POLL_TIMEOUT_MS) {
        await ctx.runMutation(internal.editJobs.failJob, {
          jobId: job._id, errorKind: "timeout",
          error: `Timed out after 15 min at ${job.provider}. The request id is kept; Retry polls it again.`,
        });
        return null;
      }
      await ctx.scheduler.runAfter(Math.min(15000, 3000 + count * 1000), internal.editRunner.poll, { jobId: job._id });
      return null;
    };

    let result: EditPollResult;
    try {
      result = await pollProvider(job);
    } catch {
      return await again(); // a network blip: ask again
    }
    if (result.state === "running") return await again();
    if (result.state === "error") {
      await ctx.runMutation(internal.editJobs.failJob, { jobId: job._id, error: result.error, errorKind: "provider" });
      return null;
    }
    try {
      await land(ctx, job, loaded, result);
    } catch (error) {
      await ctx.runMutation(internal.editJobs.failJob, {
        jobId: job._id, errorKind: "ingest",
        error: `Landed at ${job.provider} but could not be filed: ${error instanceof Error ? error.message : String(error)}. Retry files it again without a new charge.`,
      });
    }
    return null;
  },
});

/** File the result: a new asset in the source's collections and tags, prompt and cost in its notes. */
const land = async (
  ctx: ActionCtx,
  job: Job,
  loaded: { sourceTagIds: Id<"tags">[]; sourceFolderId?: Id<"folders">; folderIds: Id<"folders">[] },
  result: Extract<EditPollResult, { state: "done" }>,
): Promise<void> => {
  let usd = result.usd;
  if (usd === undefined && result.pendingBill && job.provider === "pika") usd = await settledPikaCharge(job.requestId!);
  const exact = usd !== undefined;
  const charged = usd ?? job.estimateUsd;

  const refs = job.refNames.map((name, index) => `<image-${index + 2}> ${name}`).join(", ");
  const notes = [
    `In-place edit of asset:${job.sourceAssetId}`,
    `${job.modelName} via ${job.provider} (${job.endpoint})`,
    `${exact ? "" : "≈"}${usdText(charged)}${exact ? "" : " est"}`,
    job.of > 1 ? `take ${job.take}/${job.of}` : undefined,
    refs ? `refs ${refs}` : undefined,
    `job editJobs:${job._id}`,
  ].filter(Boolean).join(" · ");

  const media = await processMediaInput(ctx, { url: result.url });
  const key = `edit:${job._id}:${job.retries}`;
  const { promptId }: { promptId: Id<"prompts"> } = await ctx.runMutation(internal.prompts.createPromptInternal, {
    ownerUserId: job.ownerUserId,
    text: job.prompt,
    tagIds: loaded.sourceTagIds,
    folderId: loaded.sourceFolderId,
    ingestKey: `${key}:prompt`,
    promptType: "image_gen",
    modelName: job.modelName,
    modelProvider: modelProviderOf(job.model),
    promptSections: { finalPrompt: job.prompt, generationNotes: notes },
  });
  const { assetId }: { assetId: Id<"assets"> } = await ctx.runMutation(internal.assets.createAssetInternal, {
    ownerUserId: job.ownerUserId,
    kind: media.kind,
    r2Key: media.r2Key,
    thumbR2Key: media.thumbR2Key,
    contentType: media.contentType,
    size: media.size,
    width: media.width,
    height: media.height,
    thumbSize: media.thumbSize,
    thumbWidth: media.thumbWidth,
    thumbHeight: media.thumbHeight,
    thumbVariants: media.thumbVariants,
    fileName: `edit-${job.model}-${job._id}.${media.contentType.includes("png") ? "png" : "jpg"}`,
    contentHash: media.contentHash,
    promptId,
    tagIds: loaded.sourceTagIds,
    folderId: loaded.sourceFolderId,
    ingestKey: key,
    modelName: job.modelName,
    generationType: "image_gen",
    ingestSource: job.createdBy === "agent" ? "agent" : "manual",
    agentDescription: `In-place edit of asset:${job.sourceAssetId} with ${job.modelName}: ${job.prompt}`.slice(0, 400),
    agentDescriptionSource: "agent",
  });
  if (loaded.folderIds.length) {
    await ctx.runMutation(internal.assets.addAssetFoldersInternal, {
      ownerUserId: job.ownerUserId, assetId, folderIds: loaded.folderIds,
    });
  }
  await ctx.runMutation(internal.editJobs.finishJob, {
    jobId: job._id, resultAssetId: assetId, resultUrl: result.url,
    chargedUsd: Math.round(charged * 1e5) / 1e5, chargedExact: exact, notes,
  });
};
