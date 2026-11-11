import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";

import { buildJevRequest, buildLunaRequest, judgePictures, showsStatement } from "../convex/searchJudge";
import { callAsOwner } from "./helpers/call-as-owner";

const pictures = [1, 2, 3].map((index) => ({
  assetId: `assets:${index}` as never, imageUrl: `https://img.example/${index}.webp`,
}));

describe("the picture check behind \"no …\" searches", () => {
  const originalFetch = global.fetch;
  let calls: string[] = [];
  let openaiStatus = 200;
  beforeEach(async () => {
    calls = [];
    openaiStatus = 200;
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TYPESAFE_API_KEY = "test-typesafe-key";
    const image = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#884422" } }).png().toBuffer();
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://img.example/")) return new Response(new Uint8Array(image));
      calls.push(new URL(url).hostname);
      const body = JSON.parse(String(init?.body)) as { questions: unknown[] | Record<string, unknown> };
      if (url.includes("api.openai.com")) {
        if (openaiStatus !== 200) {
          return new Response(JSON.stringify({ error: { message: "You have no credits remaining." } }), { status: openaiStatus });
        }
        return Response.json({ answers: (body.questions as unknown[]).map(() => ({ probability: 0.9 })) });
      }
      return Response.json({
        answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: 0.2 }])),
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
  });

  test("one yes/no per phrase, in order, for either model", () => {
    const luna = buildLunaRequest("abc", ["cars", "people"]);
    expect(luna.questions).toEqual([
      { type: "predicate", instructions: showsStatement("The picture", "cars") },
      { type: "predicate", instructions: showsStatement("The picture", "people") },
    ]);
    const jev = buildJevRequest("abc", ["cars", "people"]);
    expect(Object.keys(jev.questions)).toEqual(["q0", "q1"]);
    expect(jev.questions.q1).toEqual({ type: "noul", instructions: showsStatement("`picture`", "people") });
    expect(jev.state).toEqual({ picture: "pic" });
  });

  test("the tagger's model answers when it can", async () => {
    const result = await callAsOwner(judgePictures)({} as never, { pictures, phrases: ["cars", "people"] });
    expect(result.model).toBe("gpt-6-luna");
    expect(result.judged).toEqual(pictures.map((picture) => ({ assetId: picture.assetId, probabilities: [0.9, 0.9] })));
    expect(calls).toEqual(["api.openai.com", "api.openai.com", "api.openai.com"]);
  });

  test("out of credits: one failed request, then the other model answers every picture", async () => {
    openaiStatus = 429;
    const result = await callAsOwner(judgePictures)({} as never, { pictures, phrases: ["cars"] });
    expect(result.model).toBe("jev-latest");
    expect(result.judged).toEqual(pictures.map((picture) => ({ assetId: picture.assetId, probabilities: [0.2] })));
    expect(calls.filter((host) => host === "api.openai.com")).toHaveLength(1);
    expect(calls.filter((host) => host === "api.typesafe.ai")).toHaveLength(3);
  });

  test("no usable model: nothing is judged and nothing is retried", async () => {
    openaiStatus = 401;
    delete process.env.TYPESAFE_API_KEY;
    const result = await callAsOwner(judgePictures)({} as never, { pictures, phrases: ["cars"] });
    expect(result).toEqual({ judged: [] });
    expect(calls).toEqual(["api.openai.com"]);
  });
});
