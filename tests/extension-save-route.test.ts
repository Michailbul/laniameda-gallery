import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  actionCalls: [] as Array<Record<string, unknown>>,
  mutationCalls: [] as Array<Record<string, unknown>>,
};

const routePath = new URL("../app/api/extension/save/route.ts", import.meta.url)
  .pathname;

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.actionCalls.push(payload);

      if (payload.target === "asset") {
        return { assetId: "assets:1" };
      }

      if (payload.target === "prompt") {
        return { promptId: "prompts:1" };
      }

      return { assetId: "assets:1", promptId: "prompts:1" };
    },
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.mutationCalls.push(payload);
      return {
        assetId: payload.assetId,
        folderId: Array.isArray(payload.folderIds) ? payload.folderIds[0] : undefined,
        folderIds: Array.isArray(payload.folderIds) ? payload.folderIds : [],
      };
    },
  }),
}));

describe("POST /api/extension/save", () => {
  beforeEach(() => {
    state.actionCalls = [];
    state.mutationCalls = [];
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
  });

  test("updates prompt metadata without re-ingesting media", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "updatePrompt",
          imageUrl: "https://cdn.example.com/image.png",
          sourceUrl: "https://example.com/post/1",
          promptText: "cinematic portrait",
          pillar: "creators",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(3);
    expect(state.actionCalls[0]?.allowPromptOnly).toBe(true);
    expect(state.actionCalls[0]?.promptIngestKey).toBe(
      "https://cdn.example.com/image.png",
    );
    expect(state.actionCalls[1]?.target).toBe("prompt");
    expect(state.actionCalls[2]?.target).toBe("asset");

    expect(await response.json()).toEqual({
      ok: true,
      result: {
        assetId: "assets:1",
        promptId: "prompts:1",
      },
    });
  });

  test("adds Midjourney metadata for CDN-only image saves", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.midjourney.com/abc/0_1_1024_N.webp",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.modelName).toBe("Midjourney");
    expect(state.actionCalls[0]?.modelProvider).toBe("midjourney");
    expect(state.actionCalls[0]?.tagNames).toEqual([
      "midjourney",
      "midjourney-web",
    ]);
  });

  test("adds filterable Midjourney teach page tags", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.midjourney.com/abc/0_1_1024_N.webp",
          sourceUrl: "https://www.midjourney.com/personalize/7466790784553975846/teach",
          modelName: "unknown",
          tagNames: ["midjourney", "Midjourney"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.modelName).toBe("Midjourney");
    expect(state.actionCalls[0]?.modelProvider).toBe("midjourney");
    expect(state.actionCalls[0]?.tagNames).toEqual([
      "midjourney",
      "midjourney-web",
      "midjourney-teach",
      "midjourney-personalize",
      "personalize",
    ]);
  });

  test("adds filterable Midjourney explore page tags", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.midjourney.com/abc/0_1_1024_N.webp",
          sourceUrl: "https://www.midjourney.com/explore?tab=top",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.modelName).toBe("Midjourney");
    expect(state.actionCalls[0]?.modelProvider).toBe("midjourney");
    expect(state.actionCalls[0]?.tagNames).toEqual([
      "midjourney",
      "midjourney-web",
      "midjourney-explore",
    ]);
  });

  test("adds saved image to multiple collections", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.example.com/image.png",
          folderIds: ["folders:one", " folders:two ", "folders:one"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.folderId).toBe("folders:one");
    expect(state.mutationCalls).toEqual([
      {
        ownerUserId: "telegram:278674008",
        assetId: "assets:1",
        folderIds: ["folders:one", "folders:two"],
      },
    ]);
  });

  test("rejects prompt updates without promptText", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "updatePrompt",
          imageUrl: "https://cdn.example.com/image.png",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "promptText is required for prompt updates.",
    });
    expect(state.actionCalls).toHaveLength(0);
  });
});
