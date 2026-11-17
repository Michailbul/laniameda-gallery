import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

type Call = { kind: string; name: string; args: Record<string, unknown> };
const state = { calls: [] as Call[], context: {} as Record<string, unknown> };

const routePath = new URL("../app/api/extension/quick-run/route.ts", import.meta.url).pathname;

const record = (kind: string) => async (reference: unknown, args: Record<string, unknown>) => {
  const name = getFunctionName(reference as never);
  state.calls.push({ kind, name, args });
  if (name === "mjQuickRuns:saveContext") return state.context;
  if (name === "ingest:ingestFromApi") return { assetId: "asset9" };
  if (name === "mjQuickRuns:startRun") return { runId: "run1", estimateUsd: 0.06, run: { _id: "run1" } };
  return { _id: args.runId ?? "run1" };
};

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({ query: record("query"), mutation: record("mutation"), action: record("action") }),
}));

const call = async (method: "GET" | "POST", body?: unknown, query = "", token = "test-extension-token") => {
  const route = await import(routePath);
  return route[method](new Request(`http://localhost/api/extension/quick-run${query}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-extension-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })) as Promise<Response>;
};

const JOB = "0f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("/api/extension/quick-run", () => {
  beforeEach(() => {
    state.calls = [];
    state.context = {
      resultUrl: "https://r2.example/take.png", width: 2048, height: 1152, ingestKey: "mj-fast-helper:run1:0",
      promptText: "Make it night", modelName: "Seedream 5.5", agentDescription: "Fast helper edit of Midjourney job …",
      sourceUrl: `https://www.midjourney.com/jobs/${JOB}?index=0`, folderId: "folderWorld", upstreamAssetId: "assetSrc",
    };
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
    process.env.EXTENSION_API_TOKEN = "test-extension-token";
  });

  test("refuses a request without the extension token", async () => {
    expect((await call("POST", { action: "save", runId: "run1", index: 0 }, "", "")).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  test("the catalog needs no Convex call", async () => {
    const data = await (await call("GET", undefined, "?catalog=1&w=1456&h=816")).json();
    expect(data.models[0]).toMatchObject({ id: "seedream-5.5", perTakeUsd: 0.03 });
    expect(state.calls).toHaveLength(0);
  });

  test("start runs as the owner with the frame and its job", async () => {
    const response = await call("POST", {
      action: "start", model: "seedream-5.5", instruction: "Night", count: 2,
      source: { r2Key: "uploads/k", mjJobId: JOB, mjIndex: 0 }, world: { key: "dear-annete", name: "DEAR ANNETE", folderId: "f1" },
    });
    expect(response.status).toBe(200);
    expect(state.calls[0]).toMatchObject({
      name: "mjQuickRuns:startRun",
      args: { ownerUserId: "telegram:278674008", model: "seedream-5.5", count: 2, refs: [], source: { r2Key: "uploads/k" } },
    });
    expect(state.calls[0]!.args.action).toBeUndefined();
  });

  test("polls a list of runs", async () => {
    await call("GET", undefined, "?ids=a,b");
    expect(state.calls[0]).toMatchObject({ name: "mjQuickRuns:getRuns", args: { ids: ["a", "b"] } });
  });

  test("keep saves the take into the world with its lineage, then marks it kept", async () => {
    const data = await (await call("POST", { action: "save", runId: "run1", index: 0, section: "location" })).json();
    expect(data).toMatchObject({ ok: true, assetId: "asset9" });
    const ingest = state.calls.find((entry) => entry.name === "ingest:ingestFromApi")!;
    expect(ingest.args).toMatchObject({
      url: "https://r2.example/take.png", ingestKey: "mj-fast-helper:run1:0", promptText: "Make it night", modelName: "Seedream 5.5",
      tagNames: ["location"], folderId: "folderWorld", sourceUrl: `https://www.midjourney.com/jobs/${JOB}?index=0`,
      assetRole: "generated_output", upstreamInputs: [{ type: "asset", id: "assetSrc", role: "edit_source" }],
    });
    expect(state.calls.at(-1)).toMatchObject({ name: "mjQuickRuns:markSaved", args: { assetId: "asset9", index: 0 } });
  });

  test("a world picked in the card wins over the run's", async () => {
    await call("POST", { action: "save", runId: "run1", index: 0, folderId: "otherWorld" });
    expect(state.calls.find((entry) => entry.name === "ingest:ingestFromApi")!.args.folderId).toBe("otherWorld");
  });

  test("a take already kept is not saved twice", async () => {
    state.context = { ...state.context, alreadySaved: "assetOld" };
    const data = await (await call("POST", { action: "save", runId: "run1", index: 0 })).json();
    expect(data).toMatchObject({ ok: true, assetId: "assetOld", already: true });
    expect(state.calls.some((entry) => entry.name === "ingest:ingestFromApi")).toBe(false);
  });

  test("records the Fantasy draft a take became", async () => {
    await call("POST", { action: "fantasy", runId: "run1", index: 1, draftId: "d7", project: "Film" });
    expect(state.calls[0]).toMatchObject({ name: "mjQuickRuns:markFantasy", args: { draftId: "d7", project: "Film", index: 1 } });
  });
});
