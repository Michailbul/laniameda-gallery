// The relevance check behind the agents' search. Embeddings rank by likeness
// and never say "no": the 24 nearest pieces come back whether 4 or 400 pieces
// answer the request. Here every candidate is asked, by a decision model that
// sees the picture and what the gallery wrote about it, whether it is a good
// result for the request and whether each required part holds. Answers are
// kept in pictureJudgments, so the same check on the same piece is paid once.
//
// Wording and thresholds, with what they were measured to do:
// lib/search-relevance.ts and agent-docs/SEARCH_EVAL.md.

import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  DecisionUnavailable,
  GEMINI_DECISION_MODEL,
  askGeminiDecision,
  geminiDecisionEnabled,
  pictureInput,
  type DecisionInput,
  type DecisionQuestion,
} from "./decisionGemini";
import { sha256Hex } from "./semanticStorage";
import {
  RELEVANCE_PART_FALSE,
  RELEVANCE_PART_TRUE,
  RELEVANCE_WHOLE_FALSE,
  RELEVANCE_WHOLE_TRUE,
} from "../lib/search-relevance";

const getJudgmentsQueryRef = makeFunctionReference<"query">("pictureJudgments:getJudgments");
const saveJudgmentsMutationRef = makeFunctionReference<"mutation">("pictureJudgments:saveJudgments");
const judgeRelevanceJevRef = makeFunctionReference<"action">("searchVerifyJev:judgeRelevance");

// Bump when the questions or the words shown to a model change: older answers
// were given to a different question.
const QUESTION_VERSION = "v3";
const MAX_REQUEST_CHARS = 300;
const MAX_PART_CHARS = 160;
export const MAX_PARTS = 5;
const MAX_WORDS_CHARS = 900;
// A grid rendition of about this width shows what a result is; the full card
// thumb costs more tokens for the same answer.
const PICTURE_MIN_WIDTH = 400;

export type VerifiablePiece = {
  _id: Id<"assets">;
  kind: "image" | "video";
  url?: string;
  thumbUrl?: string;
  thumbVariants?: Array<{ width: number; height: number; url: string }>;
  agentDescription?: string;
  description?: string;
  promptText?: string;
  tagNames: string[];
};

export type Relevance = {
  // Good result for the whole request: whole-request answer x weakest part.
  match: number;
  // The whole-request answer alone: high while a detail is doubtful.
  whole: number;
};

const clean = (text: string, max: number) => text.trim().replace(/\s+/g, " ").slice(0, max);
export const normalizeRequest = (request: string) => clean(request, MAX_REQUEST_CHARS);
export const normalizeParts = (parts?: string[]) =>
  [...new Set((parts ?? []).map((part) => clean(part, MAX_PART_CHARS).replace(/[.\s]+$/, "")).filter(Boolean))]
    .slice(0, MAX_PARTS);

export const relevanceOf = (whole: number, parts: number[]): Relevance => ({
  whole,
  match: parts.length === 0 ? whole : whole * Math.min(...parts),
});

/** Gemini Decision: one yes/no for the whole request and one per required part. */
export const geminiQuestions = (request: string, parts: string[]): Record<string, DecisionQuestion> => {
  const questions: Record<string, DecisionQuestion> = {
    whole: {
      type: "noul",
      instructions: `Someone searching a creative reference gallery asked for: "${request}". This piece is a good result for that request.`,
      criteria: { true_description: RELEVANCE_WHOLE_TRUE, false_description: RELEVANCE_WHOLE_FALSE },
    },
  };
  parts.forEach((part, index) => {
    questions[`p${index}`] = {
      type: "noul",
      instructions: `In this piece: ${part}.`,
      criteria: { true_description: RELEVANCE_PART_TRUE, false_description: RELEVANCE_PART_FALSE },
    };
  });
  return questions;
};

/** What the gallery wrote about a piece: names, worlds and medium a picture cannot show. */
export const pieceWords = (piece: VerifiablePiece) =>
  [
    piece.agentDescription ?? piece.description ?? "",
    piece.promptText ? `Prompt: ${piece.promptText.slice(0, 300)}` : "",
    piece.tagNames.length > 0 ? `Tags: ${piece.tagNames.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_WORDS_CHARS);

/** The picture a model is shown: a grid rendition, else the card thumb; a video is seen through its poster. */
export const piecePicture = (piece: VerifiablePiece) =>
  piece.thumbVariants?.find((variant) => variant.width >= PICTURE_MIN_WIDTH)?.url ??
  piece.thumbUrl ??
  (piece.kind === "image" ? piece.url : undefined);

export const geminiInput = (piece: VerifiablePiece): DecisionInput[] => {
  const words = pieceWords(piece);
  const input: DecisionInput[] = [
    { type: "text", text: `What the gallery knows about this piece:\n${words || "(nothing written)"}\n` },
  ];
  const picture = piecePicture(piece);
  if (picture) input.push(pictureInput(picture));
  return input;
};

type Provider = "gemini" | "jev";
const MODEL_OF: Record<Provider, string> = { gemini: GEMINI_DECISION_MODEL, jev: "jev-latest" };

const cacheKeys = async (provider: Provider, request: string, parts: string[]) => {
  const digest = await sha256Hex(JSON.stringify([request.toLowerCase(), parts.map((part) => part.toLowerCase())]));
  const base = `relevance|${QUESTION_VERSION}|${provider}|${digest}`;
  return { match: `${base}|match`, whole: `${base}|whole` };
};

export type VerifyOutcome = {
  judged: Map<Id<"assets">, Relevance>;
  // Asked of a model in this call (the rest came from kept answers).
  asked: number;
  // The model that answered this call's fresh questions.
  model?: string;
  // Set when no model could be used; pieces not yet answered stay unjudged.
  unavailable?: string;
};

type Judged = { assetId: Id<"assets">; whole: number; parts: number[] };

const askGemini = async (pieces: VerifiablePiece[], request: string, parts: string[]) => {
  const questions = geminiQuestions(request, parts);
  let unavailable: string | undefined;
  const judgeOne = async (piece: VerifiablePiece): Promise<Judged | null> => {
    if (unavailable) return null;
    try {
      const answer = await askGeminiDecision(geminiInput(piece), questions);
      const whole = answer?.whole?.noul;
      const partAnswers = parts.map((_, index) => answer?.[`p${index}`]?.noul);
      if (typeof whole !== "number" || partAnswers.some((value) => typeof value !== "number")) return null;
      return { assetId: piece._id, whole, parts: partAnswers as number[] };
    } catch (error) {
      if (error instanceof DecisionUnavailable) unavailable = error.message;
      return null;
    }
  };
  // One piece first: an account with no credit costs one refused call, not a wave of them.
  const [first, ...rest] = pieces;
  const answers = [await judgeOne(first!)];
  if (!unavailable) answers.push(...(await Promise.all(rest.map(judgeOne))));
  return { judged: answers.filter((answer): answer is Judged => answer !== null), unavailable };
};

// Jev needs JPEG bytes, and one Node action re-encodes pictures one core at a
// time: 96 pictures took 8-10 s in one action, 20 took 2 s. So a wave is split
// across actions that run side by side.
const JEV_PIECES_PER_ACTION = 16;

const askJev = async (ctx: ActionCtx, pieces: VerifiablePiece[], request: string, parts: string[]) => {
  const chunks: VerifiablePiece[][] = [];
  for (let start = 0; start < pieces.length; start += JEV_PIECES_PER_ACTION) {
    chunks.push(pieces.slice(start, start + JEV_PIECES_PER_ACTION));
  }
  const answers = (await Promise.all(chunks.map((chunk) =>
    ctx.runAction(judgeRelevanceJevRef, {
      request,
      parts,
      pieces: chunk.map((piece) => ({
        assetId: piece._id,
        words: pieceWords(piece),
        ...(piecePicture(piece) ? { imageUrl: piecePicture(piece) } : {}),
      })),
    })))) as Array<{ judged: Judged[]; unavailable?: string }>;
  return {
    judged: answers.flatMap((answer) => answer.judged),
    unavailable: answers.find((answer) => answer.unavailable)?.unavailable,
  };
};

/** The models that can answer here, in order of preference. */
export const relevanceProviders = (): Provider[] => [
  ...(geminiDecisionEnabled() ? (["gemini"] as const) : []),
  ...(process.env.TYPESAFE_API_KEY?.trim() ? (["jev"] as const) : []),
];

/**
 * Relevance of each piece to the request. Kept answers are read first; the
 * rest are asked in one wave of the first model that can answer, moving to
 * the next when one cannot be used at all. A piece a model refuses (safety
 * filter, an unreadable picture) is left out of `judged`.
 */
export const verifyPieces = async (
  ctx: ActionCtx,
  pieces: VerifiablePiece[],
  rawRequest: string,
  rawParts?: string[],
): Promise<VerifyOutcome> => {
  const request = normalizeRequest(rawRequest);
  const parts = normalizeParts(rawParts);
  const judged = new Map<Id<"assets">, Relevance>();
  const providers = relevanceProviders();
  if (pieces.length === 0) return { judged, asked: 0 };
  if (providers.length === 0) return { judged, asked: 0, unavailable: "No decision model is configured." };

  const keysByProvider = new Map<Provider, { match: string; whole: string }>();
  for (const provider of providers) keysByProvider.set(provider, await cacheKeys(provider, request, parts));
  const kept = (await ctx.runQuery(getJudgmentsQueryRef, {
    assetIds: pieces.map((piece) => piece._id),
    phrases: [...keysByProvider.values()].flatMap((keys) => [keys.match, keys.whole]),
  })) as Array<{ assetId: Id<"assets">; phrase: string; probability: number }>;
  // An answer from the preferred model wins over one from a fallback.
  for (const provider of [...providers].reverse()) {
    const keys = keysByProvider.get(provider)!;
    const match = new Map(kept.filter((row) => row.phrase === keys.match).map((row) => [row.assetId, row.probability]));
    const whole = new Map(kept.filter((row) => row.phrase === keys.whole).map((row) => [row.assetId, row.probability]));
    for (const [assetId, value] of match) judged.set(assetId, { match: value, whole: whole.get(assetId) ?? value });
  }

  let unasked = pieces.filter((piece) => !judged.has(piece._id));
  if (unasked.length === 0) return { judged, asked: 0 };
  const asked = unasked.length;
  const failures: string[] = [];
  let model: string | undefined;
  for (const provider of providers) {
    if (unasked.length === 0) break;
    const answer = provider === "gemini"
      ? await askGemini(unasked, request, parts)
      : await askJev(ctx, unasked, request, parts);
    if (answer.judged.length > 0) {
      model = MODEL_OF[provider];
      const keys = keysByProvider.get(provider)!;
      const rows: Array<{ assetId: Id<"assets">; phrase: string; probability: number }> = [];
      for (const row of answer.judged) {
        const relevance = relevanceOf(row.whole, row.parts);
        judged.set(row.assetId, relevance);
        rows.push(
          { assetId: row.assetId, phrase: keys.match, probability: relevance.match },
          { assetId: row.assetId, phrase: keys.whole, probability: relevance.whole },
        );
      }
      await ctx.runMutation(saveJudgmentsMutationRef, { model: MODEL_OF[provider], judgments: rows });
    }
    if (!answer.unavailable) break;
    failures.push(answer.unavailable);
    unasked = unasked.filter((piece) => !judged.has(piece._id));
  }
  const allDown = failures.length === providers.length;
  return {
    judged,
    asked,
    ...(model ? { model } : {}),
    ...(allDown ? { unavailable: failures.join(" | ") } : {}),
  };
};
