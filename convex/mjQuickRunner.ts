"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { processMediaInput } from "./ingest";
import { resolveProviderKey } from "./providerVault";
import { classifyProviderRefusal } from "../lib/edit-models";
import { FAST_TIMEOUT_MS, fastInput, fastModelById, readFalStatus, readFastImage } from "../lib/mj-fast-helper";

// Runs the fast helper's takes (convex/mjQuickRuns.ts) on fal's queue with
// the owner's fal key (Settings → Edit keys, else the deployment's FAL_KEY;
// never a Gemini key). One queue request per take. A take with a request id
// is only ever polled, never sent again. A landed picture is copied into R2
// so the card, Keep and Fantasy never depend on fal's short-lived links.

type Run = Doc<"mjQuickRuns">;
type Work = { run: Run; sourceUrl?: string; refUrls: string[] } | null;

const runForWork = makeFunctionReference<"query", { runId: Id<"mjQuickRuns"> }, Work>("mjQuickRuns:runForWork");
const claimTake = makeFunctionReference<"mutation", { runId: Id<"mjQuickRuns">; index: number }, boolean>("mjQuickRuns:claimTake");
const recordSubmitted = makeFunctionReference<"mutation", { runId: Id<"mjQuickRuns">; index: number; requestId: string; statusUrl?: string; responseUrl?: string }, null>("mjQuickRuns:recordSubmitted");
const takeFailed = makeFunctionReference<"mutation", { runId: Id<"mjQuickRuns">; index: number; error: string }, null>("mjQuickRuns:takeFailed");
const takeLanded = makeFunctionReference<"mutation", {
  runId: Id<"mjQuickRuns">; index: number; falUrl: string; r2Key?: string; thumbR2Key?: string;
  storageId?: Id<"_storage">; contentType?: string; width?: number; height?: number;
}, null>("mjQuickRuns:takeLanded");
const notePoll = makeFunctionReference<"mutation", { runId: Id<"mjQuickRuns"> }, number>("mjQuickRuns:notePoll");
const pollRef = makeFunctionReference<"action", { runId: Id<"mjQuickRuns"> }>("mjQuickRunner:poll");

const HTTP_TIMEOUT_MS = 60 * 1000;

const http = async (method: string, url: string, key: string, body?: unknown) => {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Key ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text.slice(0, 400) }; }
  return { status: response.status, body: parsed };
};

const load = async (ctx: ActionCtx, runId: Id<"mjQuickRuns">) => (await ctx.runQuery(runForWork, { runId })) as Work;

/** Send every queued take of a run to fal. */
export const submit = internalAction({
  args: { runId: v.id("mjQuickRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const work = await load(ctx, args.runId);
    if (!work) return null;
    const { run } = work;
    const queued = run.takes.map((take, index) => ({ take, index })).filter(({ take }) => take.status === "queued");
    if (!queued.length) return null;
    const failAll = async (error: string) => {
      for (const { index } of queued) {
        if (await ctx.runMutation(claimTake, { runId: run._id, index })) await ctx.runMutation(takeFailed, { runId: run._id, index, error });
      }
      return null;
    };
    const model = fastModelById(run.model);
    if (!model) return await failAll(`Unknown model ${run.model}.`);
    if (!work.sourceUrl) return await failAll("The frame has no public address.");
    const key = await resolveProviderKey(ctx, run.ownerUserId, "fal");
    if (!key) return await failAll("fal: no API key (Settings → Edit keys). Nothing was charged.");

    const input = fastInput(model, run.instruction, [work.sourceUrl, ...work.refUrls], run.source.width, run.source.height);
    let sent = 0;
    for (const { index } of queued) {
      if (!await ctx.runMutation(claimTake, { runId: run._id, index })) continue;
      try {
        const { status, body } = await http("POST", `https://queue.fal.run/${model.endpoint}`, key, input);
        const refusal = classifyProviderRefusal("fal", status, (body as { detail?: unknown } | null)?.detail ?? body);
        const row = body as { request_id?: string; status_url?: string; response_url?: string } | null;
        if (refusal.blocked) {
          await ctx.runMutation(takeFailed, { runId: run._id, index, error: `${refusal.message}. Nothing was charged.` });
          continue;
        }
        if (status >= 300 || !row?.request_id) {
          await ctx.runMutation(takeFailed, { runId: run._id, index, error: `fal ${status}: ${JSON.stringify(body).slice(0, 300)}` });
          continue;
        }
        await ctx.runMutation(recordSubmitted, {
          runId: run._id, index, requestId: row.request_id,
          ...(row.status_url ? { statusUrl: row.status_url } : {}),
          ...(row.response_url ? { responseUrl: row.response_url } : {}),
        });
        sent += 1;
      } catch (error) {
        // Unknown whether fal took it: say so rather than send again.
        await ctx.runMutation(takeFailed, {
          runId: run._id, index,
          error: `Could not reach fal (${error instanceof Error ? error.message : String(error)}). Run it again if nothing shows in fal's history.`,
        });
      }
    }
    if (sent) await ctx.scheduler.runAfter(4000, pollRef, { runId: run._id });
    return null;
  },
});

/** Ask fal about every running take; reschedules itself until all have landed or failed. */
export const poll = internalAction({
  args: { runId: v.id("mjQuickRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const work = await load(ctx, args.runId);
    if (!work) return null;
    const { run } = work;
    const running = run.takes.map((take, index) => ({ take, index })).filter(({ take }) => take.status === "running" && take.requestId);
    if (!running.length) return null;
    const count = await ctx.runMutation(notePoll, { runId: run._id });
    const key = await resolveProviderKey(ctx, run.ownerUserId, "fal");
    const timedOut = Date.now() - (run.submittedAt ?? run.createdAt) > FAST_TIMEOUT_MS;
    let still = 0;
    for (const { take, index } of running) {
      if (!key) { await ctx.runMutation(takeFailed, { runId: run._id, index, error: "fal: the key is gone (Settings → Edit keys)." }); continue; }
      try {
        const statusUrl = take.statusUrl ?? `https://queue.fal.run/${run.endpoint}/requests/${take.requestId}/status`;
        const status = await http("GET", statusUrl, key);
        const read = readFalStatus(status.status, status.body);
        if (read === "running") {
          if (timedOut) await ctx.runMutation(takeFailed, { runId: run._id, index, error: `Not back from fal after 10 min (request ${take.requestId}).` });
          else still += 1;
          continue;
        }
        if (read !== "completed") { await ctx.runMutation(takeFailed, { runId: run._id, index, error: read.error }); continue; }
        const responseUrl = take.responseUrl ?? `https://queue.fal.run/${run.endpoint}/requests/${take.requestId}`;
        const result = await http("GET", responseUrl, key);
        const image = readFastImage(result.status, result.body);
        if ("error" in image) { await ctx.runMutation(takeFailed, { runId: run._id, index, error: image.error }); continue; }
        try {
          const media = await processMediaInput(ctx, { url: image.url });
          if (media.kind !== "image") throw new Error(`fal returned ${media.contentType}, not an image`);
          await ctx.runMutation(takeLanded, {
            runId: run._id, index, falUrl: image.url,
            ...(media.r2Key ? { r2Key: media.r2Key } : {}),
            ...(media.thumbR2Key ? { thumbR2Key: media.thumbR2Key } : {}),
            ...(media.storageId ? { storageId: media.storageId } : {}),
            contentType: media.contentType,
            ...(media.width ?? image.width ? { width: media.width ?? image.width } : {}),
            ...(media.height ?? image.height ? { height: media.height ?? image.height } : {}),
          });
        } catch {
          // The picture is at fal even if the copy failed: show fal's link.
          await ctx.runMutation(takeLanded, {
            runId: run._id, index, falUrl: image.url,
            ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}),
          });
        }
      } catch {
        if (timedOut) await ctx.runMutation(takeFailed, { runId: run._id, index, error: `Not back from fal after 10 min (request ${take.requestId}).` });
        else still += 1; // a network blip: ask again
      }
    }
    if (still) await ctx.scheduler.runAfter(Math.min(10000, 2500 + count * 500), pollRef, { runId: run._id });
    return null;
  },
});
