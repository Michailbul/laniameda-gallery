import { expect, test } from "bun:test";
import { registerGalleryTools, type JsonRecord } from "../mcp/laniameda-gallery/tools";
import { reviewRoundSchema, reviewSetupSchema } from "../lib/review-contract";

type Tool = { config: JsonRecord; handler: (input: JsonRecord) => Promise<{ content: { text: string }[] }> };
const registry = (apiFetch: (path: string, input: JsonRecord) => Promise<JsonRecord>) => {
  const tools = new Map<string, Tool>();
  registerGalleryTools({ registerTool: (name: string, config: JsonRecord, handler: Tool["handler"]) => { tools.set(name, { config, handler }); } } as never, {
    apiUrl: "https://gallery.test", apiFetch,
  });
  return tools;
};

test("director review tools reach one route, map ops to actions and disclose their effects", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => { calls.push({ path, input }); return {}; });
  const names = ["review_open", "review_items", "review_feedback", "review_setup", "review_promote", "review_organize", "review_round", "review_comment"];
  for (const name of names) expect(tools.has(name)).toBe(true);
  for (const name of ["review_open", "review_items", "review_feedback"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  expect(tools.get("review_promote")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  for (const name of ["review_setup", "review_organize", "review_round", "review_comment"]) expect(tools.get(name)!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(String(tools.get("review_round")!.config.description)).toContain("confirmed: true");
  expect(String(tools.get("review_setup")!.config.description)).toContain("never email or post it");

  await tools.get("review_open")!.handler({ project: "cassandra" });
  await tools.get("review_setup")!.handler({ op: "folders", project: "p", folders: [{ section: "locations", name: "Beach" }] });
  await tools.get("review_setup")!.handler({ op: "invite", project: "p", email: "a@b.co" });
  await tools.get("review_promote")!.handler({ project: "p", frames: ["asset:a1"], folder: "beach" });
  await tools.get("review_organize")!.handler({ op: "move", project: "p", items: ["CA-ABC123"], folder: "sea" });
  await tools.get("review_round")!.handler({ op: "set_current", project: "p", round: "v0.1", confirmed: true });
  await tools.get("review_comment")!.handler({ op: "add", project: "p", frames: ["asset:a1"], body: "Done." });
  await tools.get("review_comment")!.handler({ op: "reopen", project: "p", commentId: "c1" });
  expect(calls).toEqual([
    { path: "/api/agent/review", input: { action: "open", project: "cassandra" } },
    { path: "/api/agent/review", input: { action: "folder", project: "p", folders: [{ section: "locations", name: "Beach" }] } },
    { path: "/api/agent/review", input: { action: "invite", project: "p", email: "a@b.co" } },
    { path: "/api/agent/review", input: { action: "promote", project: "p", frames: ["asset:a1"], folder: "beach" } },
    { path: "/api/agent/review", input: { action: "move", project: "p", items: ["CA-ABC123"], folder: "sea" } },
    { path: "/api/agent/review", input: { action: "set_current", project: "p", round: "v0.1", confirmed: true } },
    { path: "/api/agent/review", input: { action: "comment", project: "p", frames: ["asset:a1"], body: "Done." } },
    { path: "/api/agent/review", input: { action: "resolve_comment", project: "p", commentId: "c1", resolved: false } },
  ]);
  const contract = JSON.parse((await tools.get("get_gallery_contract")!.handler({})).content[0].text);
  expect(contract.resources).toContain("review");
});

test("review inputs accept round labels and numbers, and setup keeps each op's fields apart", () => {
  expect(reviewRoundSchema.parse({ project: "p", op: "set_current", round: 2 }).round).toBe(2);
  expect(reviewRoundSchema.parse({ project: "p", op: "set_current", round: "v0.2" }).round).toBe("v0.2");
  expect(reviewRoundSchema.safeParse({ project: "p", op: "rollback" }).success).toBe(false);
  expect(Object.keys(reviewSetupSchema.shape)).toEqual(expect.arrayContaining(["op", "project", "styles", "folders", "order", "folder", "email"]));
});

test("saving with project files the pieces in the gallery and puts them into the project's draft, held", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(async (path, input) => {
    calls.push({ path, input });
    if (path === "/api/agent/ingest") return { ok: true, result: { assetId: "s1" }, collections: { assetId: "s1" } };
    if (path === "/api/agent/ingest/batch") return { ok: true, results: (input.items as JsonRecord[]).map((_, i) => ({ ok: true, assetId: `b${i}` })) };
    return { ok: true, added: 1 };
  });
  expect(String(tools.get("save_assets")!.config.description)).toContain("project");
  const target = { project: "cassandra", folder: "apartment", section: "locations", style: "Storybook" };

  const single = JSON.parse((await tools.get("save_asset")!.handler({ url: "https://x.test/a.png", project: target })).content[0].text);
  expect(single.project).toEqual({ ok: true, added: 1 });
  const ingest = calls.find((call) => call.path === "/api/agent/ingest")!;
  expect(ingest.input.project).toBeUndefined();

  calls.length = 0;
  const batch = JSON.parse((await tools.get("save_assets")!.handler({
    project: target,
    items: [{ url: "https://x.test/1.png" }, { url: "https://x.test/2.png", project: { project: "cassandra", folder: "school" } }],
  })).content[0].text);
  expect(batch.saved).toBe(2);
  expect(batch.project).toHaveLength(2);
  const promotes = calls.filter((call) => call.input.action === "promote").map((call) => call.input);
  expect(promotes).toEqual([
    { action: "promote", ...target, frames: ["asset:b0"], held: true },
    { action: "promote", project: "cassandra", folder: "school", frames: ["asset:b1"], held: true },
  ]);
  for (const item of (calls.find((call) => call.path === "/api/agent/ingest/batch")!.input.items as JsonRecord[])) expect(item.project).toBeUndefined();

  calls.length = 0;
  await tools.get("save_assets")!.handler({ items: [{ url: "https://x.test/3.png" }] });
  expect(calls.some((call) => call.input.action === "promote")).toBe(false);
});
