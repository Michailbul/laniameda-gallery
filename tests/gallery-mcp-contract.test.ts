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
  for (const name of ["list_assets_page", "get_gallery_contract", "get_skill_instructions", "list_menu_filters", "list_collections", "list_video_refs_page", "list_assets", "list_skills", "get_skill", "get_gallery_item"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["delete_skill", "delete_collection", "delete_video_ref", "delete_gallery_item"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  const result = await tools.get("get_gallery_contract")!.handler({});
  expect(JSON.parse(result.content[0].text)).toMatchObject({ serverVersion: "0.3.0", pagination: { includeWorkflowAssets: { default: true } }, videoReferencePagination: { tool: "list_video_refs_page" }, scopes: { read: "gallery:read", writes: "gallery:write", deletion: "gallery:delete" } });
});
