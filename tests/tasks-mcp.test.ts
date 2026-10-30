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

test("task tools reach one scoped route, say the loop out loud and disclose their effects", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  const names = ["list_tasks", "get_task", "create_task", "claim_task", "release_task", "complete_task", "comment_task"];
  for (const name of names) expect(tools.has(name)).toBe(true);
  for (const name of ["list_tasks", "get_task"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["create_task", "claim_task", "release_task", "complete_task"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  expect(tools.get("comment_task")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  expect(String(tools.get("list_tasks")!.config.description)).toContain("claim_task before working");
  expect(String(tools.get("complete_task")!.config.description)).toContain("blocked: true");
  expect(String(tools.get("complete_task")!.config.description)).toContain("never a silent stop");
  expect(Object.keys(tools.get("list_tasks")!.config.inputSchema as JsonRecord)).toEqual(["world", "status", "assignee", "source", "limit"]);
  expect(Object.keys(tools.get("complete_task")!.config.inputSchema as JsonRecord)).toEqual(["taskId", "result", "blocked", "links", "session", "assignee"]);
  expect(Object.keys(tools.get("claim_task")!.config.inputSchema as JsonRecord)).toEqual(["taskId", "assignee", "leaseMinutes"]);

  await tools.get("list_tasks")!.handler({ status: "open", world: "dear-annete" });
  await tools.get("claim_task")!.handler({ taskId: "task:t1" });
  await tools.get("comment_task")!.handler({ taskId: "t1", body: "halfway" });
  await tools.get("complete_task")!.handler({ taskId: "t1", result: "Repaired: asset:a2", links: [{ kind: "asset", id: "a2" }] });
  await tools.get("release_task")!.handler({ taskId: "t1", note: "out of budget" });
  expect(calls).toEqual([
    { path: "/api/agent/tasks", input: { action: "list", status: "open", world: "dear-annete" } },
    { path: "/api/agent/tasks", input: { action: "claim", taskId: "task:t1" } },
    { path: "/api/agent/tasks", input: { action: "comment", taskId: "t1", body: "halfway" } },
    { path: "/api/agent/tasks", input: { action: "complete", taskId: "t1", result: "Repaired: asset:a2", links: [{ kind: "asset", id: "a2" }] } },
    { path: "/api/agent/tasks", input: { action: "release", taskId: "t1", note: "out of budget" } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.resources).toContain("tasks");
});
