import { expect, test } from "bun:test";
import { registerGalleryTools, type JsonRecord } from "../mcp/laniameda-gallery/tools";

type Tool = { config: JsonRecord; handler: (input: JsonRecord) => Promise<{ content: { text: string }[] }> };
const registry = (apiFetch: (path: string, input: JsonRecord) => Promise<JsonRecord>, local = false) => {
  const tools = new Map<string, Tool>();
  registerGalleryTools({ registerTool: (name: string, config: JsonRecord, handler: Tool["handler"]) => { tools.set(name, { config, handler }); } } as never, {
    apiUrl: "https://gallery.test", apiFetch,
    ...(local ? { readLocalFile: () => { throw new Error("Local file missing"); } } : {}),
  });
  return tools;
};
test("MCP batch preflight reports a failed file while preserving successful item indices", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => {
    calls.push({ path, input });
    return { ok: true, results: [{ index: 0, ok: true, result: { assetId: "saved" } }], saved: 1, failed: 0 };
  }, true);
  const result = await tools.get("save_assets")!.handler({ items: [{ filePath: "/missing.jpg" }, { url: "https://example.test/okay.jpg", ingestKey: "stable" }] });
  const body = JSON.parse(result.content[0].text);
  expect(body).toMatchObject({ ok: false, saved: 1, failed: 1, results: [{ index: 0, ok: false, failedStep: "prepare" }, { index: 1, ok: true, result: { assetId: "saved" } }] });
  expect(calls).toEqual([{ path: "/api/agent/ingest/batch", input: { items: [{ url: "https://example.test/okay.jpg", ingestKey: "stable" }] } }]);
});
test("MCP reads have read hints and destructive recipe/media tools disclose deletion", async () => {
  const tools = registry(async () => ({}));
  for (const name of ["list_srefs", "list_assets_page", "get_gallery_contract", "get_skill_instructions", "list_menu_filters", "list_collections", "list_video_refs_page", "list_assets", "list_skills", "get_skill", "get_gallery_item"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["delete_skill", "delete_collection", "delete_video_ref", "delete_gallery_item"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  const result = await tools.get("get_gallery_contract")!.handler({});
  expect(JSON.parse(result.content[0].text)).toMatchObject({ serverVersion: "0.3.0", pagination: { includeSkillExamples: { default: false } }, videoReferencePagination: { tool: "list_video_refs_page" }, scopes: { read: "gallery:read", writes: "gallery:write", deletion: "gallery:delete" } });
});
test("sref tools reach the same scoped route for hosted and stdio clients", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  await tools.get("list_srefs")!.handler({ folderId: "collection", search: "3534013297" });
  await tools.get("save_sref")!.handler({ folderId: "collection", parameters: "--sref 3534013297 --v 8.2" });
  expect(calls).toEqual([
    { path: "/api/agent/srefs", input: { action: "list", folderId: "collection", search: "3534013297" } },
    { path: "/api/agent/srefs", input: { action: "save", folderId: "collection", parameters: "--sref 3534013297 --v 8.2" } },
  ]);
  expect(tools.get("save_sref")!.config.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });
});
test("character tools reach one scoped route and disclose their effects", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  for (const name of ["list_characters", "get_character"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["unlink_character_assets", "remove_character_costume", "delete_character"]) expect(tools.get(name)!.config.annotations).toMatchObject({ destructiveHint: true });
  expect(tools.get("create_character")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  await tools.get("get_character")!.handler({ character: "DA-CH-001" });
  await tools.get("link_character_assets")!.handler({ character: "DA-CH-001", links: [{ assetId: "asset:abc", role: "sheet", costumeCode: "C01" }] });
  expect(calls).toEqual([
    { path: "/api/agent/characters", input: { action: "get", character: "DA-CH-001" } },
    { path: "/api/agent/characters", input: { action: "link", character: "DA-CH-001", links: [{ assetId: "asset:abc", role: "sheet", costumeCode: "C01" }] } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.resources).toContain("characters");
});
test("moodboard tools reach one scoped route, describe the Midjourney loop and disclose their effects", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  const names = ["list_moodboards", "get_moodboard", "save_moodboard", "add_moodboard_items", "remove_moodboard_items",
    "reorder_moodboard_items", "set_moodboard_midjourney", "list_moodboard_generations", "delete_moodboard"];
  for (const name of names) expect(tools.has(name)).toBe(true);
  for (const name of ["list_moodboards", "get_moodboard", "list_moodboard_generations"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["save_moodboard", "add_moodboard_items", "reorder_moodboard_items", "set_moodboard_midjourney"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  for (const name of ["remove_moodboard_items", "delete_moodboard"]) expect(tools.get(name)!.config.annotations).toMatchObject({ destructiveHint: true });
  expect(String(tools.get("get_moodboard")!.config.description)).toContain("imageUrls");
  expect(String(tools.get("set_moodboard_midjourney")!.config.description)).toContain("--profile m<id>");
  const schemas = Object.fromEntries(names.map((name) => [name, Object.keys(tools.get(name)!.config.inputSchema as JsonRecord)]));
  expect(schemas.save_moodboard).toEqual(expect.arrayContaining(["moodboardId", "folderId", "name", "mjCode", "mjMoodboardId", "mjUrl", "expectedRevision"]));
  expect(schemas.add_moodboard_items).toEqual(["moodboardId", "assetIds", "note"]);
  expect(schemas.set_moodboard_midjourney).toEqual(["moodboardId", "mjCode", "mjMoodboardId", "mjUrl", "syncedItemCount", "note"]);

  await tools.get("get_moodboard")!.handler({ moodboardId: "moodboard:m1" });
  await tools.get("add_moodboard_items")!.handler({ moodboardId: "m1", assetIds: ["asset:a1"] });
  await tools.get("set_moodboard_midjourney")!.handler({ moodboardId: "m1", mjCode: "88ji6bg" });
  await tools.get("list_moodboard_generations")!.handler({ moodboardId: "m1" });
  expect(calls).toEqual([
    { path: "/api/agent/moodboards", input: { action: "get", moodboardId: "moodboard:m1" } },
    { path: "/api/agent/moodboards", input: { action: "add", moodboardId: "m1", assetIds: ["asset:a1"] } },
    { path: "/api/agent/moodboards", input: { action: "set_midjourney", moodboardId: "m1", mjCode: "88ji6bg" } },
    { path: "/api/agent/moodboards", input: { action: "generations", moodboardId: "m1" } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.contractVersion).toBe("2026-10-21.1");
  expect(contract.resources).toContain("moodboards");
  expect(contract.limits).toMatchObject({ moodboardItems: 1000, addMoodboardItems: 100 });
});
test("collection tools take a display group and update without resending the name", () => {
  const tools = registry(async () => ({}));
  const create = tools.get("create_collection")!.config.inputSchema as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  const update = tools.get("update_collection")!.config.inputSchema as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  for (const shape of [create, update]) {
    expect(shape.group.safeParse("Styles").success).toBe(true);
    expect(shape.group.safeParse(null).success).toBe(true);
    expect(shape.group.safeParse("x".repeat(41)).success).toBe(false);
    expect(shape.sortOrder.safeParse(2).success).toBe(true);
  }
  expect(update.name.safeParse(undefined).success).toBe(true);
});
test("inbox tools reach one scoped route, state facts only and disclose their effects", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  for (const name of ["list_inbox_stacks", "list_inbox_decisions", "find_similar_groups"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  expect(tools.get("post_inbox_cards")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  expect(tools.get("close_stack")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  expect(tools.get("delete_inbox_stack")!.config.annotations).toMatchObject({ destructiveHint: true });
  expect(String(tools.get("post_inbox_cards")!.config.description)).toContain("never rank");
  expect(String(tools.get("list_inbox_decisions")!.config.description)).toContain("transcribe");
  const post = tools.get("post_inbox_cards")!.config.inputSchema as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  expect(Object.keys(post)).toEqual(["worldFolderId", "stackId", "stackTitle", "ingestKey", "note", "agent", "cards"]);
  const option = (label: string) => ({ kind: "option", label });
  expect(post.cards.safeParse([{ type: "sort", assetIds: ["a1"], targets: [option("A"), option("B"), { kind: "out" }] }]).success).toBe(true);
  expect(post.cards.safeParse([{ type: "sort", assetIds: ["a1"], targets: [option("A")] }]).success).toBe(false);
  expect(post.cards.safeParse([{ type: "suggestion", assetIds: ["a1"] }]).success).toBe(false);
  expect(post.cards.safeParse([{ type: "artifact", assetIds: ["a1"], evidence: { defect: { box: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 } }, priceUsd: 0.04 } }]).success).toBe(true);
  expect(post.cards.safeParse([]).success).toBe(false);
  await tools.get("post_inbox_cards")!.handler({ worldFolderId: "w1", stackTitle: "Duplicates · 2", cards: [{ type: "duplicates", assetIds: ["asset:a1", "a2"] }] });
  await tools.get("list_inbox_decisions")!.handler({ stackId: "stack:s1" });
  await tools.get("close_stack")!.handler({ stackId: "s1" });
  await tools.get("find_similar_groups")!.handler({ folderId: "w1", includeChildren: true, maxDistance: 4 });
  expect(String(tools.get("find_similar_groups")!.config.description)).toContain("never say which to keep");
  expect(calls).toEqual([
    { path: "/api/agent/inbox", input: { action: "post", worldFolderId: "w1", stackTitle: "Duplicates · 2", cards: [{ type: "duplicates", assetIds: ["asset:a1", "a2"] }] } },
    { path: "/api/agent/inbox", input: { action: "decisions", stackId: "stack:s1" } },
    { path: "/api/agent/inbox", input: { action: "close", stackId: "s1" } },
    { path: "/api/agent/inbox", input: { action: "similar_groups", folderId: "w1", includeChildren: true, maxDistance: 4 } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.resources).toContain("inbox");
  expect(contract.limits).toMatchObject({ postInboxCards: 100 });
});
