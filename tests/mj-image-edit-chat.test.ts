import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { buildImageEditMessages, editTimeline, parseImageEditAnswer, runNames, takesToShow } from "../lib/mj-image-edit-chat";
import { agentCapOf, DEFAULT_AGENT_CAP_USD, imageEditUpdateSchema } from "../lib/mj-image-edit-contract";
import { resolveActions } from "../lib/server/image-edit-run";
import { withExtensionGalleryReader, requireAgentAuth, requireAgentReader } from "../lib/server/agent-auth";
import { imageEditGallery } from "../lib/server/image-edit-gallery";

await import("../extension/image-edit-consent.js");
const consent = (globalThis as unknown as { SaveToGalleryEditConsent: { galleryConsent(s: string): boolean | undefined } }).SaveToGalleryEditConsent.galleryConsent;
describe("Gallery consent", () => {
  test("current explicit requests enable access and denial wins", () => {
    expect(consent("Use my gallery for the style lock")).toBe(true);
    expect(consent("Enable gallery access")).toBe(true);
    expect(consent("Do not use the gallery")).toBe(false);
    expect(consent("Gallery access off")).toBe(false);
    for (const text of ["Can you use my gallery?", '"Use my gallery"', "The agent said use gallery", "Change her hair"]) expect(consent(text)).toBeUndefined();
  });
});
describe("image editing conversation", () => {
  test("writer sees original and currently selected take; history stays data", () => {
    const messages = buildImageEditMessages({ source: { url: "https://images.example/original.png" }, activeSource: { url: "https://images.example/take.png" },
      draft: "Keep the face", model: "seedream-5.5", messages: [{ role: "michael", text: "Warm up the light" }] }, [], []);
    expect(JSON.stringify(messages)).toContain("original.png");
    expect(JSON.stringify(messages)).toContain("take.png");
    expect(JSON.stringify(messages)).toContain('"galleryEnabled\\":false');
    expect(messages[0].content).toContain("agent limit");
    expect(messages[0].content).toContain("Never claim a picture ran");
  });
  test("structured drafts and MCP reads are separate; truncated replies fail", () => {
    expect(parseImageEditAnswer('```json\n{"reply":"Ready","prompt":"Only warm up the light"}\n```')).toEqual({ reply: "Ready", prompt: "Only warm up the light", tools: [], actions: [] });
    expect(parseImageEditAnswer('{"reply":"Reading the lock","tools":[{"name":"get_story","arguments":{"id":"story:x"}}]}').tools).toHaveLength(1);
    expect(() => parseImageEditAnswer('{"reply":"unfinished')).toThrow();
    expect(imageEditUpdateSchema.safeParse({ id: "a", count: 4 }).success).toBe(false);
    expect(imageEditUpdateSchema.safeParse({ id: "a", agentCapUsd: 5 }).success).toBe(false);
  });
  test("a malformed action is dropped, the answer kept", () => {
    const answer = parseImageEditAnswer('{"reply":"Try a warmer sky","actions":[{"type":"run","prompt":"Warmer sky","take":"r2t1"},{"type":"save"},{"type":"launch"}]}');
    expect(answer.actions).toEqual([{ type: "run", prompt: "Warmer sky", take: "r2t1" }]);
  });
});

describe("the edit timeline", () => {
  const take = (index: number, review = "pending") => ({ index, status: "done", review, url: `https://r2.example/${index}.webp`, thumbUrl: `https://r2.example/${index}-t.webp` });
  const runs = [
    { _id: "run-b", modelName: "Seedream 5.5", instruction: "Warmer sky", count: 2, status: "done", estimateUsd: 0.06, source: { parentRunId: "run-a", parentIndex: 1 }, takes: [take(0, "kept"), take(1, "dropped")], createdAt: 300 },
    { _id: "run-a", modelName: "Seedream 5.5", instruction: "Make it night", count: 2, status: "done", estimateUsd: 0.06, source: {}, takes: [take(0), take(1)], createdAt: 100 },
  ];
  const messages = [
    { id: "m1", role: "michael", text: "Make it night", createdAt: 50 },
    { id: "m2", role: "michael", text: "Sky too blue here", take: { runId: "run-a", index: 1 }, createdAt: 200 },
  ];
  test("runs are named in the order they ran, takes r2t1", () => {
    const { name, resolve } = runNames(runs);
    expect(name({ runId: "run-b", index: 0 })).toBe("r2t1");
    expect(resolve("r1t2")).toEqual({ runId: "run-a", index: 1 });
    expect(resolve("r3t1")).toBeUndefined();
  });
  test("messages and runs interleave in time, with lineage and reviews", () => {
    const timeline = editTimeline(messages, runs) as Array<Record<string, unknown>>;
    expect(timeline.map(e => e.run ?? e.text)).toEqual(["Make it night", "r1", "Sky too blue here", "r2"]);
    expect(timeline[2].about).toBe("r1t2");
    expect(timeline[3].from).toBe("r1t2");
    expect((timeline[3].takes as Array<{ review: string }>)[0].review).toBe("kept");
  });
  test("a run the agent started comes right after its answer", () => {
    const answered = [...messages, { id: "m2:answer", role: "agent", text: "Warming it", ran: { runId: "run-b", estimateUsd: 0.03 }, createdAt: 310 }];
    const timeline = editTimeline(answered, runs) as Array<Record<string, unknown>>;
    expect(timeline.map(e => e.run ?? e.text)).toEqual(["Make it night", "r1", "Sky too blue here", "Warming it", "r2"]);
  });
  test("the agent looks at the noted and kept takes first", () => {
    const shown = takesToShow(messages, runs, 2).map(t => t.name);
    expect(shown).toEqual(["r1t2", "r2t1"]);
  });
  test("action take names become run ids; a save without a known take is dropped", () => {
    expect(resolveActions([{ type: "run", prompt: "Warmer", take: "r2t1" }, { type: "save", take: "r9t1" }, { type: "queue", prompt: "A tower at night" }], runs))
      .toEqual([{ type: "run", prompt: "Warmer", take: { runId: "run-b", index: 0 } }, { type: "queue", prompt: "A tower at night" }]);
  });
  test("a thread without a limit uses the default; 0 means suggest only", () => {
    expect(agentCapOf({})).toBe(DEFAULT_AGENT_CAP_USD);
    expect(agentCapOf({ agentCapUsd: 0 })).toBe(0);
  });
});

describe("authenticated Gallery delegation", () => {
  const oldToken = process.env.EXTENSION_API_TOKEN; const oldOwner = process.env.EXTENSION_OWNER_USER_ID;
  const request = () => new Request("https://gallery.example/api/extension/image-edit-gallery", { headers: { "x-extension-token": "test-extension-secret" } });
  beforeAll(() => { process.env.EXTENSION_API_TOKEN = "test-extension-secret"; process.env.EXTENSION_OWNER_USER_ID = "image-edit-test"; });
  afterAll(() => {
    if (oldToken === undefined) delete process.env.EXTENSION_API_TOKEN; else process.env.EXTENSION_API_TOKEN = oldToken;
    if (oldOwner === undefined) delete process.env.EXTENSION_OWNER_USER_ID; else process.env.EXTENSION_OWNER_USER_ID = oldOwner;
  });
  test("invalid extension token cannot delegate", async () => {
    expect(() => withExtensionGalleryReader(new Request("https://gallery.example"), async () => 1)).toThrow("Unauthorized");
  });
  test("scope is read-only and cannot leak into a concurrent request", async () => {
    const outside = new Request("https://gallery.example");
    await Promise.all([
      withExtensionGalleryReader(request(), async () => {
        expect((await requireAgentReader(outside)).ownerUserId).toBe("image-edit-test");
        await expect(requireAgentAuth(outside, "gallery:write")).rejects.toThrow("lacks gallery:write");
        await expect(requireAgentAuth(outside, "gallery:delete")).rejects.toThrow("lacks gallery:delete");
      }),
      expect(requireAgentReader(outside)).rejects.toThrow("Missing bearer"),
    ]);
    await expect(requireAgentReader(outside)).rejects.toThrow("Missing bearer");
  });
  test("MCP uses actual registered schemas and refuses generation and writes", async () => {
    const tools = await imageEditGallery(request()) as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.some(t => t.name === "open_world" && t.inputSchema)).toBe(true);
    expect(tools.some(t => /^(save|delete|edit_asset|reply)/.test(t.name))).toBe(false);
    await expect(imageEditGallery(request(), { name: "edit_asset", arguments: {} })).rejects.toThrow("only has reading access");
  });
});
