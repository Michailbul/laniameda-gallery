"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { FACET_MODEL } from "../lib/facet-tags";
import { SHELF_MODEL } from "../lib/shelf-rules";
import { jpegOf } from "./tagClassify";

// A search that leaves something out ("no cars") asks a decision model about
// each picture on the page: embeddings rank by likeness and never say "no",
// and a small car in a street scene is rarely in the description. One request
// a picture, every phrase at once. Answers are kept in pictureJudgments, so a
// picture is asked once per phrase.
//
// Two models can answer, in this order: OpenAI Decisions (gpt-6-luna, the
// tagger's model: about 0.6 s and $0.0004 a picture) and Jev (TypeSafe System
// One, the shelf filer's model). When the first cannot be used at all (no
// key, no credits, a refused key) the call moves to the next one instead of
// failing sixty times.

// A whole page is asked in one wave; Jev allows 1,200 requests a minute.
const AT_ONCE = 60;

export const showsStatement = (subject: string, phrase: string) =>
  `${subject} shows ${phrase}: at least one is visible somewhere in the frame, even small or partly hidden.`;

/** The OpenAI Decisions request for one picture: one yes/no per phrase, answered in order. */
export const buildLunaRequest = (jpegBase64: string, phrases: string[]) => ({
  model: FACET_MODEL,
  input: [{ role: "user", content: [
    { type: "input_text", text: "A picture from a creative reference gallery." },
    { type: "input_image", image_url: `data:image/jpeg;base64,${jpegBase64}`, detail: "high" },
  ] }],
  questions: phrases.map((phrase) => ({ type: "predicate", instructions: showsStatement("The picture", phrase) })),
});

/** The Jev request for one picture: one Noul per phrase, keyed q0, q1, … */
export const buildJevRequest = (jpegBase64: string, phrases: string[]) => ({
  model: SHELF_MODEL,
  state: { picture: "pic" },
  assets: { pic: { type: "image", format: "jpg", data_base64: jpegBase64 } },
  questions: Object.fromEntries(phrases.map((phrase, index) => [
    `q${index}`, { type: "noul", instructions: showsStatement("`picture`", phrase) },
  ])),
});

// The model cannot be used at all right now; asking it about the next picture
// would fail the same way.
class ProviderDown extends Error {}
const isDown = (status: number, body: string) =>
  status === 401 || status === 402 || status === 403 ||
  (status === 429 && /credit|quota|billing/i.test(body));

type Provider = { model: string; ask: (jpegBase64: string, phrases: string[]) => Promise<number[]> };

const post = async (url: string, headers: Record<string, string>, body: unknown, name: string) => {
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    if (isDown(response.status, text)) throw new ProviderDown(`${name} HTTP ${response.status}: ${text}`);
    throw new Error(`${name} HTTP ${response.status}: ${text}`);
  }
  return await response.json() as unknown;
};

const allNumbers = (values: Array<number | undefined>, name: string) => {
  if (!values.every((value): value is number => typeof value === "number")) {
    throw new Error(`${name} left a question unanswered.`);
  }
  return values;
};

const providers = (): Provider[] => {
  const list: Provider[] = [];
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) {
    list.push({
      model: FACET_MODEL,
      ask: async (jpeg, phrases) => {
        const body = await post("https://api.openai.com/v1/decisions", { Authorization: `Bearer ${openai}` },
          buildLunaRequest(jpeg, phrases), "OpenAI") as { answers?: Array<{ probability?: number }> };
        return allNumbers(phrases.map((_, index) => body.answers?.[index]?.probability), "OpenAI");
      },
    });
  }
  const typesafe = process.env.TYPESAFE_API_KEY?.trim();
  if (typesafe) {
    list.push({
      model: SHELF_MODEL,
      ask: async (jpeg, phrases) => {
        const body = await post("https://api.typesafe.ai/v1/systemone",
          { Authorization: `Bearer ${typesafe}`, "TypeSafe-Danger-Zone-Images": "true" },
          buildJevRequest(jpeg, phrases), "TypeSafe") as { answers?: Record<string, { noul?: number }> };
        return allNumbers(phrases.map((_, index) => body.answers?.[`q${index}`]?.noul), "TypeSafe");
      },
    });
  }
  return list;
};

/**
 * For each picture, the probability that it shows each phrase, and the model
 * that answered. A picture that could not be judged is left out.
 */
export const judgePictures = internalAction({
  args: {
    pictures: v.array(v.object({ assetId: v.id("assets"), imageUrl: v.string() })),
    phrases: v.array(v.string()),
  },
  returns: v.object({
    model: v.optional(v.string()),
    judged: v.array(v.object({ assetId: v.id("assets"), probabilities: v.array(v.number()) })),
  }),
  handler: async (_ctx, args) => {
    type Judged = { assetId: (typeof args.pictures)[number]["assetId"]; probabilities: number[] };
    const available = providers();
    const judged: Judged[] = [];
    let active = 0;
    let waiting = args.pictures;
    while (waiting.length > 0 && active < available.length) {
      const provider = available[active]!;
      // One picture first shows whether the preferred model can be used at
      // all; a fallback starts with a full batch.
      const batch = waiting.slice(0, active === 0 && judged.length === 0 ? 1 : AT_ONCE);
      const answers = await Promise.all(batch.map(async (picture) => {
        try {
          return { assetId: picture.assetId, probabilities: await provider.ask(await jpegOf(picture.imageUrl), args.phrases) };
        } catch (error) {
          if (error instanceof ProviderDown) return error;
          console.warn(`Search judge (${provider.model}): ${error instanceof Error ? error.message : error}`);
          return null;
        }
      }));
      const down = answers.find((answer): answer is ProviderDown => answer instanceof ProviderDown);
      if (down) {
        console.warn(`Search judge: ${down.message}`);
        active += 1;
        continue;
      }
      for (const answer of answers) {
        if (answer && !(answer instanceof ProviderDown)) judged.push(answer);
      }
      waiting = waiting.slice(batch.length);
    }
    return { model: judged.length > 0 ? available[active]?.model : undefined, judged };
  },
});
