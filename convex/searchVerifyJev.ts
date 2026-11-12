"use node";

// Jev (TypeSafe System One) behind the agents' relevance check, for when
// Gemini Decision cannot answer (convex/searchVerify.ts). Jev takes JPEG
// bytes, so each picture is fetched and re-encoded here (jpegOf).
// Measured on 17 graded searches (12 Nov 2026): about 3,500 input tokens a
// piece with three questions, $0.042 per million, so about $0.00015 a piece;
// 8 at once answered ~900 pieces in 50 s.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { SHELF_MODEL } from "../lib/shelf-rules";
import {
  RELEVANCE_PART_FALSE,
  RELEVANCE_PART_TRUE,
  RELEVANCE_WHOLE_FALSE,
  RELEVANCE_WHOLE_TRUE,
} from "../lib/search-relevance";
import { jpegOf } from "./tagClassify";

const API_URL = "https://api.typesafe.ai/v1/systemone";
const AT_ONCE = 30;

const pieceValidator = v.object({
  assetId: v.id("assets"),
  imageUrl: v.optional(v.string()),
  words: v.string(),
});

type JevQuestion = { type: "noul"; instructions: string; criteria: { true: string; false: string } };
const WHOLE_TRUE = RELEVANCE_WHOLE_TRUE;
const WHOLE_FALSE = RELEVANCE_WHOLE_FALSE;
const PART_TRUE = RELEVANCE_PART_TRUE;
const PART_FALSE = RELEVANCE_PART_FALSE;

export const jevQuestions = (request: string, parts: string[]) => {
  const questions: Record<string, JevQuestion> = {
    whole: {
      type: "noul",
      instructions:
        `Someone searching a creative reference gallery asked for: "${request}". \`picture\` (described in \`notes\`) ` +
        "is a good result: it plainly is or shows every part of that request.",
      criteria: { true: WHOLE_TRUE, false: WHOLE_FALSE },
    },
  };
  parts.forEach((part, index) => {
    questions[`p${index}`] = {
      type: "noul",
      instructions: `In \`picture\` (described in \`notes\`): ${part}.`,
      criteria: { true: PART_TRUE, false: PART_FALSE },
    };
  });
  return questions;
};

/**
 * For each piece: the probability it is a good result for the whole request,
 * and for each required part. `unavailable` is set when Jev cannot be used at
 * all; a piece Jev could not judge is left out.
 */
export const judgeRelevance = internalAction({
  args: {
    request: v.string(),
    parts: v.array(v.string()),
    pieces: v.array(pieceValidator),
  },
  returns: v.object({
    model: v.string(),
    judged: v.array(v.object({ assetId: v.id("assets"), whole: v.number(), parts: v.array(v.number()) })),
    unavailable: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const key = process.env.TYPESAFE_API_KEY?.trim();
    const result: {
      model: string;
      judged: Array<{ assetId: (typeof args.pieces)[number]["assetId"]; whole: number; parts: number[] }>;
      unavailable?: string;
    } = { model: SHELF_MODEL, judged: [] };
    if (!key) return { ...result, unavailable: "TYPESAFE_API_KEY is not set." };
    const questions = jevQuestions(args.request, args.parts);
    const judgeOne = async (piece: (typeof args.pieces)[number]) => {
      const state: Record<string, string> = { notes: piece.words || "(nothing written)" };
      const assets: Record<string, unknown> = {};
      if (piece.imageUrl) {
        try {
          assets.pic = { type: "image", format: "jpg", data_base64: await jpegOf(piece.imageUrl) };
          state.picture = "pic";
        } catch {
          state.picture = "(no picture: judge from notes)";
        }
      } else {
        state.picture = "(no picture: judge from notes)";
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "TypeSafe-Danger-Zone-Images": "true",
          },
          body: JSON.stringify({ model: SHELF_MODEL, state, assets, questions }),
        });
        if (response.ok) {
          const body = (await response.json()) as { answers?: Record<string, { noul?: number }> };
          const whole = body.answers?.whole?.noul;
          const parts = args.parts.map((_, index) => body.answers?.[`p${index}`]?.noul);
          if (typeof whole !== "number" || parts.some((value) => typeof value !== "number")) return null;
          return { assetId: piece.assetId, whole, parts: parts as number[] };
        }
        const text = (await response.text().catch(() => "")).slice(0, 200);
        if ([401, 402, 403].includes(response.status) || (response.status === 429 && /credit|quota|billing/i.test(text))) {
          result.unavailable = `TypeSafe HTTP ${response.status}: ${text}`;
          return null;
        }
        if (![429, 500, 502, 503, 529].includes(response.status)) return null;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
      return null;
    };
    for (let start = 0; start < args.pieces.length && !result.unavailable; start += AT_ONCE) {
      const answers = await Promise.all(args.pieces.slice(start, start + AT_ONCE).map(judgeOne));
      for (const answer of answers) if (answer) result.judged.push(answer);
    }
    return result;
  },
});
