import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  user: { ownerUserId: "278674008" },
  calls: [] as Array<{ args: Record<string, unknown> }>,
  responses: [] as unknown[],
};

const routePath = new URL("../app/api/gallery/prompts/route.ts", import.meta.url)
  .pathname;

mock.module("@/lib/server/app-user", () => ({
  requireAppUser: async () => state.user,
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    query: async (_reference: unknown, args: Record<string, unknown>) => {
      state.calls.push({ args });
      const next = state.responses.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  }),
}));

const buildPrompt = (id: string, createdAt: number) => ({
  _id: id,
  _creationTime: createdAt,
  ownerUserId: "278674008",
  text: `prompt ${id}`,
  tagIds: [],
  folderId: undefined,
  ingestKey: `prompt:${id}`,
  pillar: "dump" as const,
  promptType: "other" as const,
  domain: undefined,
  modelName: undefined,
  modelProvider: "other" as const,
  workflowType: undefined,
  promptSections: undefined,
  promptProfile: undefined,
  createdAt,
});

describe("GET /api/gallery/prompts", () => {
  beforeEach(() => {
    state.user = { ownerUserId: "278674008" };
    state.calls = [];
    state.responses = [];
  });

  test("returns prompt-only results from the dedicated Convex query when available", async () => {
    state.responses = [[
      {
        ...buildPrompt("p1", 1),
        linkedAssetCount: 0,
        linkedDesignInspirationCount: 0,
      },
    ]];
    const { GET } = await import(routePath);

    const response = await GET(
      new Request("http://localhost/api/gallery/prompts?limit=50"),
    );

    expect(response.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(await response.json()).toEqual({
      prompts: [
        {
          ...buildPrompt("p1", 1),
          linkedAssetCount: 0,
          linkedDesignInspirationCount: 0,
        },
      ],
    });
  });

  test("falls back to older deployed queries when the dedicated Convex query is missing", async () => {
    state.responses = [
      new Error(
        "Could not find public function for 'prompts:listPromptOnlyGalleryPrompts'.",
      ),
      [buildPrompt("p1", 1), buildPrompt("p2", 2)],
      [],
      [{ _id: "asset-1" }],
      [],
    ];
    const { GET } = await import(routePath);

    const response = await GET(
      new Request("http://localhost/api/gallery/prompts?limit=50"),
    );

    expect(response.status).toBe(200);
    expect(state.calls).toHaveLength(5);
    expect(await response.json()).toEqual({
      prompts: [
        {
          ...buildPrompt("p2", 2),
          linkedAssetCount: 0,
          linkedDesignInspirationCount: 0,
        },
      ],
    });
  });
});
