import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  actionCalls: [] as Array<Record<string, unknown>>,
  mutationCalls: [] as Array<Record<string, unknown>>,
};

const routePath = new URL("../app/api/extension/save/route.ts", import.meta.url)
  .pathname;

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    query: async () => [
      {
        _id: "folders:one",
        name: "Dear Annete",
      },
      {
        _id: "folders:characters",
        name: "Characters",
        parentFolderId: "folders:one",
      },
    ],
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
      if (payload.parentFolderId) {
        return { folderId: "folders:inspirations", created: true };
      }
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

  test("creates and assigns a collection pillar for extension saves", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.midjourney.com/abc/0_1_1024_N.webp",
          folderIds: ["folders:one"],
          collectionPillar: "inspirations",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.folderId).toBe("folders:one");
    expect(state.mutationCalls).toEqual([
      {
        ownerUserId: "telegram:278674008",
        name: "Inspirations",
        parentFolderId: "folders:one",
      },
      {
        ownerUserId: "telegram:278674008",
        assetId: "assets:1",
        folderIds: ["folders:one", "folders:inspirations"],
      },
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

  test("adds a Midjourney profile source tag", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://cdn.midjourney.com/abc/0_1_1024_N.webp",
          sourceUrl: "https://www.midjourney.com/profile/example",
          folderIds: ["folders:one"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.tagNames).toEqual([
      "midjourney",
      "midjourney-web",
      "midjourney-profile",
    ]);
    expect(state.mutationCalls.at(-1)).toMatchObject({
      assetId: "assets:1",
      folderIds: ["folders:one", "folders:inspirations"],
    });
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

  test("saves Higgsfield video prompt and input images with lineage", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/extension/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://assets.higgsfield.ai/output/dance.mp4",
          sourceUrl: "https://higgsfield.ai/ai/video",
          mediaType: "video",
          modelName: "Higgsfield",
          promptText: "An intimate couple slowly dances in warm window light",
          folderIds: ["folders:one", "folders:two"],
          inputImages: [
            {
              url: "https://assets.higgsfield.ai/input/start.webp",
              role: "start_image",
            },
            {
              url: "https://assets.higgsfield.ai/input/style.webp",
              role: "reference_image",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(3);
    expect(state.actionCalls[0]).toMatchObject({
      ingestKey: "https://assets.higgsfield.ai/input/start.webp",
      generationType: "image_gen",
      assetRole: "reference",
    });
    expect(state.actionCalls[1]).toMatchObject({
      ingestKey: "https://assets.higgsfield.ai/input/style.webp",
      generationType: "image_gen",
      assetRole: "reference",
    });
    expect(state.actionCalls[2]).toMatchObject({
      ingestKey: "https://assets.higgsfield.ai/output/dance.mp4",
      generationType: "video_gen",
      promptType: "video_gen",
      assetRole: "generated_output",
      modelProvider: "other",
      upstreamInputs: [
        {
          type: "asset",
          ingestKey: "https://assets.higgsfield.ai/input/start.webp",
          role: "starting_image_asset",
          stageOrder: 0,
        },
        {
          type: "asset",
          ingestKey: "https://assets.higgsfield.ai/input/style.webp",
          role: "style_reference",
          stageOrder: 1,
        },
      ],
    });
    expect(state.actionCalls[2]?.tagNames).toEqual([
      "higgsfield",
      "higgsfield-web",
      "higgsfield-video",
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
