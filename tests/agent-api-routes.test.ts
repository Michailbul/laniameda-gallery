import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";

const state = {
  ownerUserId: "telegram:278674008",
  requiredScopes: [] as string[],
  actionCalls: [] as Array<{ payload: Record<string, unknown> }>,
  actionResult: { ok: true } as Record<string, unknown>,
  queryCalls: [] as Array<{ payload: Record<string, unknown>; name?: string }>,
  queryResult: undefined as unknown,
  // Per-function results, for routes that make more than one query (a world resolver, then the list).
  queryResultByName: {} as Record<string, unknown>,
  mutationCalls: [] as Array<{ payload: Record<string, unknown> }>,
  queryFailure: undefined as string | undefined,
  mutationFailure: undefined as string | undefined,
};

const ingestRoutePath = new URL("../app/api/agent/ingest/route.ts", import.meta.url).pathname;
const ingestUpdateRoutePath = new URL(
  "../app/api/agent/ingest/update/route.ts",
  import.meta.url,
).pathname;
const galleryRoutePath = new URL("../app/api/agent/gallery/route.ts", import.meta.url).pathname;
const customizeRoutePath = new URL("../app/api/agent/customize/route.ts", import.meta.url).pathname;
const charactersRoutePath = new URL("../app/api/agent/characters/route.ts", import.meta.url).pathname;
const moodboardsRoutePath = new URL("../app/api/agent/moodboards/route.ts", import.meta.url).pathname;
const inboxRoutePath = new URL("../app/api/agent/inbox/route.ts", import.meta.url).pathname;
const worldsRoutePath = new URL("../app/api/agent/worlds/route.ts", import.meta.url).pathname;
const storiesRoutePath = new URL("../app/api/agent/stories/route.ts", import.meta.url).pathname;
const instructionsRoutePath = new URL("../app/api/agent/instructions/route.ts", import.meta.url).pathname;

class MockAgentAuthError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
  }
}

mock.module("@/lib/server/agent-auth", () => ({
  AgentAuthError: MockAgentAuthError,
  requireAgentAuth: async (_request: Request, requiredScope: string) => {
    state.requiredScopes.push(requiredScope);
    return {
      tokenId: "agentTokens:1",
      ownerUserId: state.ownerUserId,
      tokenPrefix: "lgat_prefix",
      label: "Codex",
      scopes: ["gallery:read", "gallery:write"],
    };
  },
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.actionCalls.push({ payload });
      return state.actionResult;
    },
    query: async (reference: unknown, payload: Record<string, unknown>) => {
      const name = getFunctionName(reference as FunctionReference<"query">);
      state.queryCalls.push({ payload, name });
      if (state.queryFailure) throw new Error(state.queryFailure);
      return state.queryResultByName[name] ?? state.queryResult ?? [];
    },
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.mutationCalls.push({ payload });
      if (state.mutationFailure) throw new Error(state.mutationFailure);
      return { ok: true };
    },
  }),
}));

describe("agent API routes", () => {
  beforeEach(() => {
    state.ownerUserId = "telegram:278674008";
    state.requiredScopes = [];
    state.actionCalls = [];
    state.actionResult = { ok: true };
    state.queryCalls = [];
    state.queryResult = undefined;
    state.queryResultByName = {};
    state.mutationCalls = [];
    state.queryFailure = undefined;
    state.mutationFailure = undefined;
  });

  test("complete listing rejects unknown predicates and token-owner overrides", async () => {
    const { POST } = await import(galleryRoutePath);
    for (const bad of [{ pieceType: "characters" }, { ownerUserId: "attacker" }, { pageSize: 201 }]) {
      const response = await POST(new Request("http://localhost/api/agent/gallery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "listAssetsPage", ...bad }),
      }));
      expect(response.status).toBe(400);
    }
    expect(state.queryCalls).toHaveLength(0);
    const response = await POST(new Request("http://localhost/api/agent/gallery", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "listAssetsPage", folderId: "folders:1", includeDescendants: true, includeWorkflowAssets: false, cursor: "cursor", pageSize: 100 }),
    }));
    expect(response.status).toBe(200);
    expect(state.queryCalls[0]?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", includeDescendants: true, includeWorkflowAssets: false, cursor: "cursor", pageSize: 100 });
    expect(state.requiredScopes.every(scope => scope === "gallery:read")).toBe(true);
  });

  test("collections, worlds, moodboards and stories carry their gallery page url", async () => {
    const send = (path: string, payload: Record<string, unknown>) => async () => {
      const { POST } = await import(path);
      return POST(new Request("http://localhost/api/agent/x", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }));
    };
    state.queryResult = [
      { _id: "w1", name: "DEAR ANNETE", worldKey: "dear-annete" },
      { _id: "s1", name: "Cast", parentFolderId: "w1" },
      { _id: "art", name: "ART" },
    ];
    const folders = (await (await send(customizeRoutePath, { action: "listFolders" })()).json()).folders;
    expect(folders.map((folder: { url: string }) => folder.url)).toEqual([
      "https://gallery.laniameda.space/w/dear-annete",
      "https://gallery.laniameda.space/w/dear-annete/s1",
      "https://gallery.laniameda.space/w/art",
    ]);

    state.queryResult = [{ key: "dear-annete", name: "DEAR ANNETE" }];
    const worlds = (await (await send(worldsRoutePath, { action: "open" })()).json()).worlds;
    expect(worlds[0].url).toBe("https://gallery.laniameda.space/w/dear-annete");

    state.queryResult = {
      world: { id: "w1", key: "dear-annete", name: "DEAR ANNETE" },
      shelves: [{ id: "s1", name: "Cast" }], storybooks: [{ id: "b1", name: "Two Pears" }],
      moodboards: [{ id: "m1", name: "Golden" }], stories: [{ id: "t1", title: "Idea" }],
    };
    const context = await (await send(worldsRoutePath, { action: "open", world: "dear-annete" })()).json();
    expect(context.world.url).toBe("https://gallery.laniameda.space/w/dear-annete");
    expect(context.world.instructionsUrl).toBe("https://gallery.laniameda.space/w/dear-annete/instructions");
    expect(context.shelves[0].url).toBe("https://gallery.laniameda.space/w/dear-annete/s1");
    expect(context.storybooks[0].url).toBe("https://gallery.laniameda.space/storybooks/b1");
    expect(context.moodboards[0].url).toBe("https://gallery.laniameda.space/moodboards/m1");
    expect(context.stories[0].url).toBe("https://gallery.laniameda.space/stories/t1");

    state.queryResult = { moodboard: { _id: "m1", name: "Golden", itemCount: 0 }, items: [] };
    const board = await (await send(moodboardsRoutePath, { action: "get", moodboardId: "moodboard:m1" })()).json();
    expect(board.moodboard.url).toBe("https://gallery.laniameda.space/moodboards/m1");

    state.queryResult = { _id: "t1", title: "Idea" };
    const story = await (await send(storiesRoutePath, { action: "get", id: "story:t1" })()).json();
    expect(story.story.url).toBe("https://gallery.laniameda.space/stories/t1");
  });

  test("character route strips copied ID prefixes and scopes each action", async () => {
    const { POST } = await import(charactersRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/characters", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    // `world` (key, name or root id) and the older worldFolderId both go through the world resolver.
    state.queryResultByName["worlds:resolveWorldRef"] = { worldId: "w1", key: "dear-annete", name: "DEAR ANNETE", folderIds: ["w1"] };
    // A caller-supplied owner is a stray key now: refused before any query runs.
    expect((await send({ action: "list", worldFolderId: "collection:w1", ownerUserId: "attacker" })).status).toBe(400);
    expect(state.queryCalls).toHaveLength(0);
    expect((await send({ action: "list", worldFolderId: "collection:w1" })).status).toBe(200);
    expect((await send({ action: "list", world: "dear-annete" })).status).toBe(200);
    expect((await send({ action: "list", world: "dear-annete", folderId: "stray" })).status).toBe(400);
    expect((await send({ action: "get", character: "DA-CH-001", world: "dear-annete" })).status).toBe(400);
    expect((await send({ action: "get", id: "DA-CH-001" })).status).toBe(200);
    expect((await send({ action: "link", character: "DA-CH-001", links: [{ assetId: "asset:a1", role: "sheet", costumeCode: "C01" }] })).status).toBe(200);
    expect((await send({ action: "update", character: "character:c1", expectedRevision: 2, alias: null, faceAssetId: "asset:f1" })).status).toBe(200);
    expect((await send({ action: "link", character: "DA-CH-001", links: [{ assetId: "a1", role: "cameo" }] })).status).toBe(400);
    expect((await send({ action: "delete", character: "DA-CH-001" })).status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read", "gallery:read", "gallery:read", "gallery:read", "gallery:read", "gallery:read", "gallery:write", "gallery:write", "gallery:write", "gallery:delete"]);
    expect(state.queryCalls.slice(0, 4).map((call) => [call.name, call.payload])).toEqual([
      ["worlds:resolveWorldRef", { ownerUserId: state.ownerUserId, world: "w1" }],
      ["characters:listCharacters", { ownerUserId: state.ownerUserId, worldFolderId: "w1" }],
      ["worlds:resolveWorldRef", { ownerUserId: state.ownerUserId, world: "dear-annete" }],
      ["characters:listCharacters", { ownerUserId: state.ownerUserId, worldFolderId: "w1" }],
    ]);
    expect(state.queryCalls.at(-1)).toEqual({ name: "characters:getCharacter", payload: { ownerUserId: state.ownerUserId, character: "DA-CH-001" } });
    expect(state.mutationCalls.map(call => call.payload)).toEqual([
      { ownerUserId: state.ownerUserId, character: "DA-CH-001", links: [{ assetId: "a1", role: "sheet", costumeCode: "C01" }] },
      { ownerUserId: state.ownerUserId, character: "character:c1", expectedRevision: 2, alias: null, faceAssetId: "f1" },
      { ownerUserId: state.ownerUserId, character: "DA-CH-001" },
    ]);
  });

  test("menu discovery is read-scoped and child storybooks are write-scoped", async () => {
    const { POST } = await import(customizeRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/customize", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect((await send({ action: "listMenuFilters" })).status).toBe(200);
    expect((await send({ action: "createFolder", name: "Board", parentFolderId: "folders:parent", kind: "storybook", ownerUserId: "attacker" })).status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read", "gallery:write"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({ ownerUserId: state.ownerUserId, name: "Board", parentFolderId: "folders:parent", kind: "storybook" });
  });

  test("explicit collection options preserve false and do not invent publication intent", async () => {
    const { POST } = await import(customizeRoutePath);
    for (const [option, field] of [["pinned", "pinned"], ["hidden", "hidden"], ["showcased", "showcased"], ["featured", "featured"]]) {
      const response = await POST(new Request("http://localhost/api/agent/customize", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setCollectionOption", folderId: "folders:1", option, enabled: false }),
      }));
      expect(response.status).toBe(200);
      expect(state.mutationCalls.at(-1)?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", [field]: false });
    }
    const response = await POST(new Request("http://localhost/api/agent/customize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setCollectionOption", folderId: "folders:1", option: "cover", assetId: null }),
    }));
    expect(response.status).toBe(200);
    expect(state.mutationCalls.at(-1)?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", assetId: null });
    expect(state.requiredScopes.every(scope => scope === "gallery:write")).toBe(true);
  });

  test("agent ingest derives ownerUserId from token auth", async () => {
    const { POST } = await import(ingestRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/ingest", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ownerUserId: "attacker",
          promptText: "cinematic portrait",
          allowPromptOnly: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:write"]);
    expect(state.actionCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      promptText: "cinematic portrait",
      allowPromptOnly: true,
      ingestSource: "agent",
    });
  });

  test("agent ingest resolves multiple asset collections after create", async () => {
    const { POST } = await import(ingestRoutePath);
    state.actionResult = { assetId: "assets:1" };

    const response = await POST(
      new Request("http://localhost/api/agent/ingest", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          promptText: "cinematic romance",
          url: "https://example.com/video.mp4",
          folderIds: ["folders:love", "folders:cinematic", "folders:love"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderId: "folders:love",
    });
    expect(state.actionCalls[0]?.payload.folderIds).toBeUndefined();
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      assetId: "assets:1",
      folderIds: ["folders:love", "folders:cinematic"],
    });
  });

  test("agent asset update replaces multiple collections", async () => {
    const { POST } = await import(ingestUpdateRoutePath);
    state.actionResult = { target: "asset", assetId: "assets:1" };

    const response = await POST(
      new Request("http://localhost/api/agent/ingest/update", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target: "asset",
          id: "assets:1",
          folderIds: ["folders:love", "folders:cinematic"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.payload).toEqual({
      target: "asset",
      id: "assets:1",
      ownerUserId: "telegram:278674008",
    });
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderIds: ["folders:love", "folders:cinematic"],
    });
  });

  test("invalid secondary collections reject before creating or changing media", async () => {
    state.queryFailure = "Collection not found.";
    for (const routePath of [ingestRoutePath, ingestUpdateRoutePath]) {
      const { POST } = await import(routePath);
      const response = await POST(new Request("http://localhost/api/agent/ingest", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: JSON.stringify({ target: "asset", id: "assets:1", url: "https://example.com/movie.mp4", folderIds: ["folders:valid", "folders:foreign"] }),
      }));
      expect(response.status).toBe(400);
    }
    expect(state.actionCalls).toHaveLength(0);
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("a filing race reports the persisted ID instead of an empty save failure", async () => {
    state.actionResult = { assetId: "assets:persisted", created: true };
    state.mutationFailure = "Collection was deleted.";
    const { POST } = await import(ingestRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ url: "https://example.com/movie.mp4", ingestKey: "test:movie", folderIds: ["folders:valid"] }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, assetId: "assets:persisted", result: { assetId: "assets:persisted" }, failedStep: "collections" });
    expect(state.actionCalls).toHaveLength(1);
  });

  test("a partly persisted create reports its IDs and stops secondary filing", async () => {
    state.actionResult = { promptId: "prompts:persisted", assetId: "assets:persisted", partial: true, failedStep: "upstreamInputs", error: "Source was deleted during the save." };
    const { POST } = await import(ingestRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ url: "https://example.com/movie.mp4", ingestKey: "test:partial-create", folderIds: ["folders:valid"] }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, promptId: "prompts:persisted", assetId: "assets:persisted", failedStep: "upstreamInputs" });
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("a partly persisted media update remains explicit at the HTTP boundary", async () => {
    state.actionResult = { target: "asset", assetId: "assets:persisted", partial: true, failedStep: "media", error: "Read before retrying." };
    const { POST } = await import(ingestUpdateRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest/update", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" }, body: JSON.stringify({ target: "asset", id: "assets:persisted" }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, result: { assetId: "assets:persisted", failedStep: "media" } });
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("agent gallery reads derive ownerUserId from token auth", async () => {
    const { POST } = await import(galleryRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "listAssets",
          ownerUserId: "attacker",
          kind: "image",
          limit: 5,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read"]);
    expect(state.queryCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      kind: "image",
      limit: 5,
    });
  });

  test("agent contact sheet strips typed ids and pins the token owner", async () => {
    const { POST } = await import(galleryRoutePath);
    state.actionResult = { imageBase64: "AAAA", cells: [] };

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "contactSheet",
          ownerUserId: "attacker",
          ids: ["asset:a1", "a2"],
          columns: 2,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read"]);
    expect(state.actionCalls[0]?.payload).toEqual({
      ownerUserId: "telegram:278674008",
      assetIds: ["a1", "a2"],
      columns: 2,
      maxEdge: undefined,
    });
    expect(await response.json()).toEqual({ sheet: { imageBase64: "AAAA", cells: [] } });
  });

  test("agent contact sheet requires ids", async () => {
    const { POST } = await import(galleryRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "contactSheet" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(state.actionCalls).toEqual([]);
  });

  test("agent customization writes derive ownerUserId from token auth", async () => {
    const { POST } = await import(customizeRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/customize", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "createFolder",
          ownerUserId: "attacker",
          name: "Moodboards",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:write"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      name: "Moodboards",
    });
  });

  test("agent folder delete requires delete scope and derives ownerUserId", async () => {
    const { POST } = await import(customizeRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/customize", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "deleteFolder",
          ownerUserId: "attacker",
          folderId: "folders:1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:delete"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderId: "folders:1",
    });
  });
  test("moodboard route strips copied ID prefixes and scopes each action", async () => {
    const { POST } = await import(moodboardsRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/moodboards", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect((await send({ action: "list", folderId: "collection:w1", includeChildren: true, ownerUserId: "attacker" })).status).toBe(200);
    expect((await send({ action: "add", moodboardId: "moodboard:m1", assetIds: ["asset:a1", "a2"] })).status).toBe(200);
    expect((await send({ action: "save", moodboardId: "moodboard:m1", expectedRevision: 3, description: null, coverAssetId: "asset:a2" })).status).toBe(200);
    expect((await send({ action: "set_midjourney", moodboardId: "m1", mjCode: "88ji6bg", syncedItemCount: 2 })).status).toBe(200);
    expect((await send({ action: "reorder", moodboardId: "m1", assetIds: ["a2", "asset:a1"] })).status).toBe(200);
    expect((await send({ action: "delete", moodboardId: "moodboard:m1" })).status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read", "gallery:write", "gallery:write", "gallery:write", "gallery:write", "gallery:delete"]);
    expect(state.queryCalls[0]?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "w1", includeChildren: true });
    // Every write names the token as its actor for the world journal.
    const actor = "agent:Codex";
    expect(state.mutationCalls.map((call) => call.payload)).toEqual([
      { ownerUserId: state.ownerUserId, moodboardId: "m1", assetIds: ["a1", "a2"], actor },
      { ownerUserId: state.ownerUserId, moodboardId: "m1", expectedRevision: 3, description: null, coverAssetId: "a2", actor },
      { ownerUserId: state.ownerUserId, moodboardId: "m1", mjCode: "88ji6bg", syncedItemCount: 2, actor },
      { ownerUserId: state.ownerUserId, moodboardId: "m1", assetIds: ["a2", "a1"], actor },
      { ownerUserId: state.ownerUserId, moodboardId: "m1", actor },
    ]);
  });

  test("moodboard create needs a collection and a name, and leaves patch-only fields to a patch", async () => {
    const { POST } = await import(moodboardsRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/moodboards", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect((await send({ action: "save", name: "Golden" })).status).toBe(400);
    expect((await send({ action: "save", folderId: "w1", name: "Golden", status: "archived" })).status).toBe(400);
    expect((await send({ action: "add", moodboardId: "m1", assetIds: [] })).status).toBe(400);
    expect((await send({ action: "sync" })).status).toBe(400);
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("collection create and update pass a display group; update keeps an omitted name", async () => {
    const { POST } = await import(customizeRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/customize", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect((await send({ action: "createFolder", name: "DA FILM", parentFolderId: "folders:w1", group: "Styles", sortOrder: 1 })).status).toBe(200);
    expect((await send({ action: "updateFolder", folderId: "folders:c1", group: null, sortOrder: 2 })).status).toBe(200);
    expect(state.mutationCalls[0]?.payload).toMatchObject({ name: "DA FILM", group: "Styles", sortOrder: 1 });
    expect(state.mutationCalls[1]?.payload).toMatchObject({ folderId: "folders:c1", group: null, sortOrder: 2 });
    expect(state.mutationCalls[1]?.payload.name).toBeUndefined();
  });
  test("inbox route strips copied ID prefixes, never takes an owner and scopes each action", async () => {
    const { POST } = await import(inboxRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/inbox", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    state.queryResultByName["worlds:resolveWorldRef"] = { worldId: "w1", key: "dear-annete", name: "DEAR ANNETE", folderIds: ["w1"] };
    expect((await send({ action: "list", worldFolderId: "collection:w1", ownerUserId: "attacker" })).status).toBe(400);
    expect(state.queryCalls).toHaveLength(0);
    expect((await send({ action: "list", worldFolderId: "collection:w1" })).status).toBe(200);
    expect((await send({ action: "list", world: "dear-annete", folderId: "stray" })).status).toBe(400);
    const posted = await send({
      action: "post", world: "dear-annete", stackTitle: "Sort · 1", ingestKey: "k1",
      cards: [{ type: "sort", assetIds: ["asset:a1"], targets: [{ kind: "moodboard", moodboardId: "moodboard:m1" }, { kind: "collection", folderId: "collection:f1", label: "Keep" }, { kind: "out" }] }],
    });
    expect(posted.status).toBe(200);
    expect((await send({ action: "post", worldFolderId: "w1", stackTitle: "x", cards: [{ type: "sort", assetIds: ["a1"], targets: [{ kind: "option", label: "Only" }] }] })).status).toBe(400);
    expect((await send({ action: "close", stackId: "stack:s1" })).status).toBe(200);
    expect((await send({ action: "delete", stackId: "s1" })).status).toBe(200);
    expect((await send({ action: "suggest", stackId: "s1" })).status).toBe(400);
    expect(state.requiredScopes).toEqual(["gallery:read", "gallery:read", "gallery:read", "gallery:write", "gallery:write", "gallery:write", "gallery:delete"]);
    expect(state.queryCalls.slice(0, 2).map((call) => [call.name, call.payload])).toEqual([
      ["worlds:resolveWorldRef", { ownerUserId: state.ownerUserId, world: "w1" }],
      ["inbox:listInboxStacks", { ownerUserId: state.ownerUserId, status: undefined, limit: undefined, previewLimit: 0, worldFolderId: "w1" }],
    ]);
    expect(state.mutationCalls.map((call) => call.payload)).toEqual([
      {
        ownerUserId: state.ownerUserId, worldFolderId: "w1", stackId: undefined, stackTitle: "Sort · 1", ingestKey: "k1", note: undefined, agent: undefined,
        cards: [{
          type: "sort", assetIds: ["a1"],
          targets: [
            { kind: "moodboard", label: undefined, moodboardId: "m1", folderId: undefined },
            { kind: "collection", label: "Keep", moodboardId: undefined, folderId: "f1" },
            { kind: "out", label: undefined, moodboardId: undefined, folderId: undefined },
          ],
        }],
      },
      { ownerUserId: state.ownerUserId, stackId: "s1", reopen: undefined },
      { ownerUserId: state.ownerUserId, stackId: "s1" },
    ]);
  });

  test("instructions write is owner-only, write-scoped, carries the last-read sha256 and keeps reads unchanged", async () => {
    const { POST } = await import(instructionsRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/instructions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" }, body: JSON.stringify(payload),
    }));
    const previousOwner = process.env.KB_OWNER_USER_ID;
    const previousAllowed = process.env.MCP_ALLOWED_USER_IDS;
    process.env.KB_OWNER_USER_ID = state.ownerUserId;
    delete process.env.MCP_ALLOWED_USER_IDS;
    try {
      const sha = "a".repeat(64);
      const written = await send({ action: "write", resource: "references/worlds.md", content: "# Worlds\n\n| dear-annete-3d |", expectedSha256: sha });
      expect(written.status).toBe(200);
      expect(await written.json()).toMatchObject({ ok: true, resource: "references/worlds.md", chars: 28, changed: true });
      expect(state.requiredScopes).toEqual(["gallery:write"]);
      expect(state.mutationCalls[0]?.payload).toMatchObject({ ownerUserId: state.ownerUserId, resourcePath: "references/worlds.md", content: "# Worlds\n\n| dear-annete-3d |", expectedSha256: sha });
      expect(typeof state.mutationCalls[0]?.payload.version).toBe("string");
      expect((state.mutationCalls[0]?.payload.version as string).length).toBeGreaterThan(0);

      // Only the two owner-data resources are writable; a public skill file is not.
      expect((await send({ action: "write", resource: "SKILL.md", content: "x" })).status).toBe(400);
      expect(state.mutationCalls).toHaveLength(1);

      // A stale hash comes back as 409, in the backend's own words.
      state.mutationFailure = "Instructions changed. Read the current resource before updating.";
      const stale = await send({ action: "write", resource: "references/worlds.md", content: "y", expectedSha256: sha });
      expect(stale.status).toBe(409);
      state.mutationFailure = undefined;

      // Someone who is not the configured owner is refused before any write.
      process.env.KB_OWNER_USER_ID = "telegram:1";
      expect((await send({ action: "write", resource: "references/worlds.md", content: "z", expectedSha256: sha })).status).toBe(403);
      expect(state.mutationCalls).toHaveLength(2);

      // Reads still take only {resource} and stay read-scoped.
      state.requiredScopes = [];
      const read = await send({ resource: "SKILL.md" });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ resource: "SKILL.md" });
      expect(state.requiredScopes).toEqual(["gallery:read"]);
    } finally {
      if (previousOwner === undefined) delete process.env.KB_OWNER_USER_ID; else process.env.KB_OWNER_USER_ID = previousOwner;
      if (previousAllowed === undefined) delete process.env.MCP_ALLOWED_USER_IDS; else process.env.MCP_ALLOWED_USER_IDS = previousAllowed;
    }
  });
});
