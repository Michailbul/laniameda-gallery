import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { buildImageEditMessages, parseImageEditAnswer } from "../lib/mj-image-edit-chat";
import { imageEditUpdateSchema } from "../lib/mj-image-edit-contract";
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
    expect(messages[0].content).toContain("never runs images");
  });
  test("structured drafts and MCP reads are separate; truncated replies fail", () => {
    expect(parseImageEditAnswer('```json\n{"reply":"Ready","prompt":"Only warm up the light"}\n```')).toEqual({ reply: "Ready", prompt: "Only warm up the light", tools: [] });
    expect(parseImageEditAnswer('{"reply":"Reading the lock","tools":[{"name":"get_story","arguments":{"id":"story:x"}}]}').tools).toHaveLength(1);
    expect(() => parseImageEditAnswer('{"reply":"unfinished')).toThrow();
    expect(imageEditUpdateSchema.safeParse({ id: "a", count: 4 }).success).toBe(false);
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
