"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { jpegOf } from "./tagClassify";
import {
  SHELF_MODEL, SHELF_RULE_VERSION, buildShelfQuestions,
  type Shelf, type ShelfAnswers, type ShelfGroup,
} from "../lib/shelf-rules";

// Auto-shelving with Jev (TypeSafe System One): after a picture is saved into
// a world, it is put on the world's Places shelf and romance mood shelf when
// Jev is sure (lib/shelf-rules.ts). Runs after the tagging (convex/tagClassify.ts).
// Off unless the deployment sets SHELF_CLASSIFY_ENABLED=true and TYPESAFE_API_KEY.

const API_URL = "https://api.typesafe.ai/v1/systemone";
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [60_000, 300_000] as const;

const getShelfContextRef = makeFunctionReference<"query">("assetShelves:getShelfContext");
const saveShelfFilingRef = makeFunctionReference<"mutation">("assetShelves:saveShelfFiling");
const getClassifySourceRef = makeFunctionReference<"query">("assetClassifications:getClassifySource");
const fileOnShelvesRef = makeFunctionReference<"action">("shelfClassify:fileOnShelves");

export const shelvesEnabled = () =>
  process.env.SHELF_CLASSIFY_ENABLED?.trim().toLowerCase() === "true" && Boolean(process.env.TYPESAFE_API_KEY?.trim());

class DecisionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

type RawAnswer = { type: string; choice?: string; confidence?: number; noul?: number };

const askJev = async (jpegBase64: string, assetId: string, shelves: Shelf[], skip: Set<ShelfGroup>, worldName: string): Promise<ShelfAnswers> => {
  const questions = buildShelfQuestions(shelves, skip, worldName);
  if (questions.length === 0) return {};
  const ref = `img${assetId.slice(-12)}`;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY?.trim()}`,
      "Content-Type": "application/json",
      "TypeSafe-Danger-Zone-Images": "true",
    },
    body: JSON.stringify({
      model: SHELF_MODEL,
      state: { picture: ref },
      assets: { [ref]: { type: "image", format: "jpg", data_base64: jpegBase64 } },
      questions: Object.fromEntries(questions.map(({ key, ...question }) => [key, question])),
    }),
  });
  if (!response.ok) {
    throw new DecisionError(`TypeSafe HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`, RETRYABLE.has(response.status));
  }
  const body = await response.json() as { answers: Record<string, RawAnswer> };
  const answers: ShelfAnswers = {};
  for (const [key, raw] of Object.entries(body.answers)) {
    if (raw.type === "noul" && typeof raw.noul === "number") answers[key] = { p: Math.round(raw.noul * 1000) / 1000 };
    else if (raw.choice) answers[key] = { choice: raw.choice, confidence: Math.round((raw.confidence ?? 0) * 1000) / 1000 };
  }
  return answers;
};

type Context = { worldId: Id<"folders">; worldName: string; shelves: Shelf[]; skipGroups: string[]; filed: boolean };

const fileOne = async (ctx: ActionCtx, assetId: Id<"assets">, opts: { force?: boolean; apply?: boolean }) => {
  if (!shelvesEnabled()) return { outcome: "disabled" as const };
  const context = await ctx.runQuery(getShelfContextRef, { assetId }) as Context | null;
  if (!context || (context.filed && !opts.force)) return { outcome: "skipped" as const };
  const source = await ctx.runQuery(getClassifySourceRef, { assetId }) as { imageUrl?: string; kind: string } | null;
  if (!source?.imageUrl) return { outcome: "no_image" as const, retryable: source?.kind === "video" };
  try {
    const answers = await askJev(await jpegOf(source.imageUrl), assetId, context.shelves, new Set(context.skipGroups as ShelfGroup[]), context.worldName);
    const shelves = await ctx.runMutation(saveShelfFilingRef, {
      assetId, model: SHELF_MODEL, version: SHELF_RULE_VERSION, status: "done", answers, apply: opts.apply,
    }) as string[];
    return { outcome: "filed" as const, shelves };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Shelf filing failed for asset:${assetId}: ${message}`);
    await ctx.runMutation(saveShelfFilingRef, { assetId, model: SHELF_MODEL, version: SHELF_RULE_VERSION, status: "error", error: message.slice(0, 300) });
    return { outcome: "error" as const, retryable: !(error instanceof DecisionError) || error.retryable };
  }
};

export const fileOnShelves = internalAction({
  args: {
    assetId: v.id("assets"),
    force: v.optional(v.boolean()),
    // Store the answers without filing (a dry run).
    apply: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  },
  returns: v.object({ outcome: v.string(), shelves: v.optional(v.array(v.string())), retryScheduled: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const result = await fileOne(ctx, args.assetId, { force: args.force, apply: args.apply });
    const attempt = args.attempt ?? 0;
    if ("retryable" in result && result.retryable && attempt < RETRY_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt]!, fileOnShelvesRef, { ...args, attempt: attempt + 1 });
      return { outcome: result.outcome, retryScheduled: true };
    }
    return { outcome: result.outcome, shelves: "shelves" in result ? result.shelves : undefined };
  },
});
