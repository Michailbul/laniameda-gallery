import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  actionCalls: [] as Array<Record<string, unknown>>,
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
  }),
}));

describe("POST /api/extension/save", () => {
  beforeEach(() => {
    state.actionCalls = [];
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
