import { expect, test } from "bun:test";
import { registerGalleryTools, type JsonRecord } from "../mcp/laniameda-gallery/tools";

type Tool = { config: JsonRecord; handler: (input: JsonRecord) => Promise<{ content: { text: string }[] }> };
const registry = (apiFetch: (path: string, input: JsonRecord) => Promise<JsonRecord>) => {
  const tools = new Map<string, Tool>();
  registerGalleryTools({ registerTool: (name: string, config: JsonRecord, handler: Tool["handler"]) => { tools.set(name, { config, handler }); } } as never, {
    apiUrl: "https://gallery.test", apiFetch,
  });
  return tools;
};

test("newspaper tools reach one scoped route, separate facts from prose and never touch publication", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  for (const name of ["get_newspaper", "write_newspaper", "compile_newspaper"]) expect(tools.has(name)).toBe(true);
  expect(tools.get("get_newspaper")!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["write_newspaper", "compile_newspaper"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  expect(Object.keys(tools.get("get_newspaper")!.config.inputSchema as JsonRecord)).toEqual(["date"]);
  expect(Object.keys(tools.get("write_newspaper")!.config.inputSchema as JsonRecord)).toEqual(["date", "prose"]);
  expect(String(tools.get("get_newspaper")!.config.description)).toContain("needsYou");
  expect(String(tools.get("write_newspaper")!.config.description)).toContain("Never star, publish, feature or delete");

  await tools.get("get_newspaper")!.handler({});
  await tools.get("get_newspaper")!.handler({ date: "2026-10-30" });
  await tools.get("write_newspaper")!.handler({ date: "2026-10-30", prose: "What mattered." });
  await tools.get("compile_newspaper")!.handler({});
  expect(calls).toEqual([
    { path: "/api/agent/newspaper", input: { action: "get" } },
    { path: "/api/agent/newspaper", input: { action: "get", date: "2026-10-30" } },
    { path: "/api/agent/newspaper", input: { action: "write", date: "2026-10-30", prose: "What mattered." } },
    { path: "/api/agent/newspaper", input: { action: "compile" } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.resources).toContain("newspapers");
});
