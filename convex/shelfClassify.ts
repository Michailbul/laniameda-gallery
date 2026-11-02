"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { jpegOf } from "./jevClassify";
import {
  SHELF_MODEL, SHELF_RULE_VERSION, buildShelfQuestions,
  type Shelf, type ShelfAnswers, type ShelfGroup,
} from "../lib/shelf-rules";

// Auto-shelving with OpenAI's Decisions API: after a picture is saved into a
// world, it is put on the world's Places / World building / Moods shelves the
// model is sure about. Runs after the Jev classification (convex/jevClassify.ts).
// Off unless the deployment sets SHELF_CLASSIFY_ENABLED=true and OPENAI_API_KEY.

const API_URL = "https://api.openai.com/v1/decisions";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [60_000, 300_000] as const;

const getShelfContextRef = makeFunctionReference<"query">("assetShelves:getShelfContext");
const saveShelfFilingRef = makeFunctionReference<"mutation">("assetShelves:saveShelfFiling");
const getClassifySourceRef = makeFunctionReference<"query">("assetClassifications:getClassifySource");
const fileOnShelvesRef = makeFunctionReference<"action">("shelfClassify:fileOnShelves");

export const shelvesEnabled = () =>
  process.env.SHELF_CLASSIFY_ENABLED?.trim().toLowerCase() === "true" && Boolean(process.env.OPENAI_API_KEY?.trim());

class DecisionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

type RawAnswer = { choice?: string; probability?: number; probabilities?: { label?: string; value?: string; probability: number }[] };

const askOpenAI = async (jpegBase64: string, shelves: Shelf[], skip: Set<ShelfGroup>, worldName: string): Promise<ShelfAnswers> => {
  const questions = buildShelfQuestions(shelves, skip, worldName);
  if (questions.length === 0) return {};
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SHELF_MODEL,
      input: [{ role: "user", content: [
        { type: "input_text", text: `A picture saved into the story world "${worldName}".` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${jpegBase64}`, detail: "high" },
      ] }],
      questions: questions.map(({ key: _key, ...question }) => question),
    }),
  });
  if (!response.ok) {
    throw new DecisionError(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`, RETRYABLE.has(response.status));
  }
  const body = await response.json() as { answers: RawAnswer[] };
  const answers: ShelfAnswers = {};
  questions.forEach((question, index) => {
    const raw = body.answers[index];
    if (!raw) return;
    if (question.type === "predicate") {
      answers[question.key] = { p: Math.round((raw.probability ?? 0) * 1000) / 1000 };
      return;
    }
    const picked = raw.probabilities?.find((option) => (option.value ?? option.label) === raw.choice);
    const confidence = picked?.probability ?? raw.probability ?? 0;
    answers[question.key] = { choice: raw.choice, confidence: Math.round(confidence * 1000) / 1000 };
  });
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
    const answers = await askOpenAI(await jpegOf(source.imageUrl), context.shelves, new Set(context.skipGroups as ShelfGroup[]), context.worldName);
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
