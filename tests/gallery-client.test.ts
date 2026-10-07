import { describe, expect, test } from "bun:test";
import { createGalleryClient, GalleryError } from "../skills/laniameda-gallery/scripts/gallery-client.mjs";

const wrapped = (result: unknown) => ({ content: [{ type: "text", text: JSON.stringify(result) }] });
describe("agent-written local code Gallery client", () => {
  test("complete iterator follows empty pages, deduplicates IDs and reports scope", async () => {
    const cursors: unknown[] = [];
    const client = createGalleryClient({ callTool: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("list_assets_page"); cursors.push(args.cursor);
      if (!args.cursor) return wrapped({ assets: [], cursor: "1", isDone: false, scannedCount: 2 });
      if (args.cursor === "1") return wrapped({ assets: [{ _id: "a" }], cursor: "2", isDone: false, scannedCount: 1 });
      return wrapped({ assets: [{ _id: "a" }, { _id: "b" }], cursor: null, isDone: true, scannedCount: 2 });
    } });
    const result = await client.assets.inventory({ includeWorkflowAssets: false });
    expect(result).toMatchObject({ complete: true, pageCount: 3, scannedCount: 5, filters: { includeWorkflowAssets: false }, assets: [{ _id: "a" }, { _id: "b" }] });
    expect(cursors).toEqual([null, "1", "2"]);
  });
  test("never silently returns complete when cursors or budgets fail", async () => {
    const client = createGalleryClient({ maxCalls: 2, callTool: async () => wrapped({ assets: [], cursor: "same", isDone: false }) });
    await expect(client.assets.inventory()).rejects.toThrow("cursor did not advance");
    const budget = createGalleryClient({ maxCalls: 1, callTool: async () => wrapped({ assets: [], cursor: "next", isDone: false }) });
    await expect(budget.assets.all()).rejects.toThrow("call budget");
    const pages = createGalleryClient({ callTool: async () => wrapped({ assets: [], cursor: "next", isDone: false }) });
    await expect(pages.assets.all({}, { maxPages: 1 })).rejects.toThrow("page budget");
    const legacy = createGalleryClient({ callTool: async () => wrapped({ assets: [] }) });
    await expect(legacy.assets.all()).rejects.toThrow("pagination contract");
    await expect(legacy.assets.inventory({ cursor: "middle" })).rejects.toThrow("must start without a cursor");
    await expect(legacy.assets.all({ cursor: "middle" })).rejects.toThrow("must start without a cursor");
    await expect(legacy.videoRefs.inventory({ cursor: "middle" })).rejects.toThrow("must start without a cursor");
    await expect(legacy.videoRefs.all({ cursor: "middle" })).rejects.toThrow("must start without a cursor");
  });
  test("preserves partial persisted IDs and per-item failures on successful HTTP/tool responses", async () => {
    const partial = { ok: false, partial: true, result: { assetId: "saved" }, persistedIDs: { assetId: "saved" }, failedStep: "addFolder", error: "Collection vanished" };
    const client = createGalleryClient({ callTool: async () => wrapped(partial) });
    try { await client.assets.save({ ingestKey: "stable" }); throw new Error("Expected partial error"); }
    catch (error) {
      expect(error).toBeInstanceOf(GalleryError);
      expect(error.result).toEqual(partial);
      expect(error.persistedIDs).toEqual({ assetId: "saved" });
    }
  });
  test("discovery filters schemas locally and caches the deployed tool catalogue", async () => {
    let listings = 0;
    const client = createGalleryClient({ callTool: async () => wrapped({}), listTools: async () => { listings++; return { tools: [{ name: "list_assets_page", description: "owned assets", inputSchema: { properties: { pageSize: {} } } }, { name: "save_asset", description: "save" }] }; } });
    expect((await client.discover({ query: "list assets" }))[0].inputSchema).toBeUndefined();
    expect((await client.schema("list_assets_page")).inputSchema.properties).toHaveProperty("pageSize");
    expect(listings).toBe(1);
    await expect(client.schema("missing")).rejects.toThrow("No deployed Gallery tool");
  });
  test("HTTP sends the scoped token to one configured endpoint, preserves error body, no retry", async () => {
    let calls = 0;
    const client = createGalleryClient({ token: "test-scoped-token", apiUrl: "https://gallery.test/", fetch: async (url: string, input: RequestInit) => {
      calls++;
      expect(url).toBe("https://gallery.test/api/mcp");
      expect(input.headers.authorization).toBe("Bearer test-scoped-token");
      expect(JSON.parse(input.body).params.arguments).toEqual({ id: "asset:abc" });
      return Response.json({ jsonrpc: "2.0", id: 1, result: wrapped({ asset: { _id: "abc" } }) });
    } });
    expect(await client.assets.get("abc")).toEqual({ asset: { _id: "abc" } });
    expect(calls).toBe(1);
  });
  test("bridge timeout marks write outcome unknown and does not retry", async () => {
    let calls = 0;
    const client = createGalleryClient({ timeoutMs: 5, callTool: () => { calls++; return new Promise(() => {}); } });
    await expect(client.assets.save({ ingestKey: "stable" })).rejects.toMatchObject({ persistenceUnknown: true });
    expect(calls).toBe(1);
  });
  test("video reference inventory uses its cursor resource and skill deletion uses its recipe API", async () => {
    const called: string[] = [];
    const client = createGalleryClient({ callTool: async (name: string) => {
      called.push(name);
      return name === "list_video_refs_page" ? wrapped({ videos: [{ _id: "v" }], cursor: null, isDone: true }) : wrapped({ ok: true, removed: true, mediaPreserved: true });
    } });
    expect((await client.videoRefs.inventory()).videos).toEqual([{ _id: "v" }]);
    expect(await client.skills.delete("s")).toMatchObject({ mediaPreserved: true });
    expect(called).toEqual(["list_video_refs_page", "delete_skill"]);
  });
});
