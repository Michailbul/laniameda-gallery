"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { FACET_MODEL } from "../lib/facet-tags";
import { jpegOf } from "./tagClassify";

// A search that leaves something out ("no cars") asks the Decisions model
// about each picture on the page: embeddings rank by likeness and never say
// "no", and a small car in a street scene is rarely in the description. One
// request a picture, every phrase at once: about 0.6 s and $0.0004 each.
// Answers are kept in pictureJudgments, so a picture is asked once per phrase.

const API_URL = "https://api.openai.com/v1/decisions";
const AT_ONCE = 20;
export const JUDGE_MODEL = FACET_MODEL;

export const showsQuestion = (phrase: string) =>
  `The picture shows ${phrase}: at least one is visible somewhere in the frame, even small or partly hidden.`;

/** The Decisions request for one picture: one yes/no per phrase, answered in order. */
export const buildShowsRequest = (jpegBase64: string, phrases: string[]) => ({
  model: JUDGE_MODEL,
  input: [{ role: "user", content: [
    { type: "input_text", text: "A picture from a creative reference gallery." },
    { type: "input_image", image_url: `data:image/jpeg;base64,${jpegBase64}`, detail: "high" },
  ] }],
  questions: phrases.map((phrase) => ({ type: "predicate", instructions: showsQuestion(phrase) })),
});

const judgeOne = async (imageUrl: string, phrases: string[]): Promise<number[] | null> => {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildShowsRequest(await jpegOf(imageUrl), phrases)),
    });
    if (!response.ok) {
      console.warn(`Search judge: OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
      return null;
    }
    const body = await response.json() as { answers?: Array<{ probability?: number }> };
    const probabilities = phrases.map((_, index) => body.answers?.[index]?.probability);
    return probabilities.every((value): value is number => typeof value === "number") ? probabilities : null;
  } catch (error) {
    console.warn(`Search judge: ${error instanceof Error ? error.message : error}`);
    return null;
  }
};

/** For each picture, the probability that it shows each phrase. A picture that could not be judged is left out. */
export const judgePictures = internalAction({
  args: {
    pictures: v.array(v.object({ assetId: v.id("assets"), imageUrl: v.string() })),
    phrases: v.array(v.string()),
  },
  returns: v.array(v.object({ assetId: v.id("assets"), probabilities: v.array(v.number()) })),
  handler: async (_ctx, args) => {
    const judged: Array<{ assetId: (typeof args.pictures)[number]["assetId"]; probabilities: number[] }> = [];
    for (let start = 0; start < args.pictures.length; start += AT_ONCE) {
      const answers = await Promise.all(args.pictures.slice(start, start + AT_ONCE).map(async (picture) => ({
        assetId: picture.assetId, probabilities: await judgeOne(picture.imageUrl, args.phrases),
      })));
      for (const answer of answers) {
        if (answer.probabilities) judged.push({ assetId: answer.assetId, probabilities: answer.probabilities });
      }
    }
    return judged;
  },
});
