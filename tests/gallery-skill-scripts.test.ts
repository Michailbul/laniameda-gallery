import { describe, expect, test } from "bun:test";

import {
  buildCreateArgs,
  buildUpdateArgs,
} from "../skills/laniameda-gallery-ingest/scripts/ingest";
import {
  handleGetDesign,
  handleGetById,
  handleGetPack,
  handleList,
  handleListDesigns,
  handleSearch,
} from "../skills/laniameda-gallery-query/scripts/query";

describe("gallery skill scripts", () => {
  test("ingest create args preserve extended design inspiration metadata", () => {
    const args = buildCreateArgs(
      {
        pillar: "designs",
        typedTags: [
          {
            name: "editorial",
            category: "design_style",
            pillar: "designs",
            source: "agent",
          },
        ],
        designInspiration: {
          title: "Pricing reference",
          summary: "Tight plan-card hierarchy",
          sourceUrl: "https://example.com/pricing",
          sourceTitle: "Pricing Page",
          userNote: "Borrow the CTA ordering",
          inspirationType: "website",
          platform: "web",
          workflowType: "page_prompt",
          captureKind: "website",
          saveIntent: "inspiration",
          templateKey: "design-default",
          sourceFingerprint: "website:https://example.com/pricing",
          status: "active",
          ingestKey: "design:pricing:v1",
        },
      },
      "telegram:278674008",
    );

    expect(args.ownerUserId).toBe("telegram:278674008");
    expect(args.designInspiration).toEqual({
      title: "Pricing reference",
      summary: "Tight plan-card hierarchy",
      sourceUrl: "https://example.com/pricing",
      sourceTitle: "Pricing Page",
      userNote: "Borrow the CTA ordering",
      inspirationType: "website",
      platform: "web",
      workflowType: "page_prompt",
      captureKind: "website",
      saveIntent: "inspiration",
      templateKey: "design-default",
      sourceFingerprint: "website:https://example.com/pricing",
      status: "active",
      ingestKey: "design:pricing:v1",
    });
  });

  test("ingest update args expose extended design inspiration metadata fields", () => {
    const args = buildUpdateArgs(
      {
        operation: "update",
        target: "designInspiration",
        ingestKey: "design:pricing:v1",
        sourceTitle: "Pricing Page 2026",
        userNote: "Keep the bold CTA contrast",
        captureKind: "website",
        saveIntent: "inspiration",
        templateKey: "design-default",
        sourceFingerprint: "website:https://example.com/pricing",
        status: "active",
      },
      "telegram:278674008",
    );

    expect(args).toMatchObject({
      ownerUserId: "telegram:278674008",
      target: "designInspiration",
      ingestKey: "design:pricing:v1",
      sourceTitle: "Pricing Page 2026",
      userNote: "Keep the bold CTA contrast",
      captureKind: "website",
      saveIntent: "inspiration",
      templateKey: "design-default",
      sourceFingerprint: "website:https://example.com/pricing",
      status: "active",
    });
  });

  test("prompt-only ingest still requires explicit allowPromptOnly", () => {
    expect(() =>
      buildCreateArgs(
        {
          pillar: "creators",
          promptText: "prompt only without media",
        },
        "telegram:278674008",
      ),
    ).toThrow("Prompt-only create requests must set allowPromptOnly=true.");
  });

  test("asset list requires KB_OWNER_USER_ID for mine scope", async () => {
    const previousOwner = process.env.KB_OWNER_USER_ID;
    delete process.env.KB_OWNER_USER_ID;

    try {
      await expect(
        handleList(
          {
            action: "list",
            scope: "mine",
          },
          {
            convexUrl: "https://example.convex.cloud",
            fetchImpl: async () =>
              new Response(JSON.stringify({ status: "success", value: [] }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
          },
        ),
      ).rejects.toThrow("KB_OWNER_USER_ID is required for mine-scoped gallery reads.");
    } finally {
      if (previousOwner === undefined) {
        delete process.env.KB_OWNER_USER_ID;
      } else {
        process.env.KB_OWNER_USER_ID = previousOwner;
      }
    }
  });

  test("semantic asset search forwards folder and asset-role filters", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

    const response = await handleSearch(
      {
        action: "search",
        scope: "mine",
        query: "dark moody editorial portrait",
        folderId: "folders:1",
        assetRole: "reference",
        limit: 3,
      },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: "telegram:278674008",
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ status: "success", value: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );

    expect(response).toEqual({ count: 0, results: [] });
    expect(calls[0]).toMatchObject({
      path: "semanticSearch:searchAssets",
      args: {
        ownerUserId: "telegram:278674008",
        scope: "mine",
        query: "dark moody editorial portrait",
        folderId: "folders:1",
        assetRole: "reference",
        limit: 3,
      },
    });
  });

  test("getById resolves copied pack IDs through the pack query", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

    const response = await handleGetById(
      {
        action: "getById",
        id: "pack:pack_1",
      },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: "telegram:278674008",
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              status: "success",
              value: {
                pack: {
                  _id: "pack_1",
                  title: "Editorial pose pack",
                  description: "Three pose references",
                  pillar: "creators",
                  modelName: "midjourney",
                  coverAssetId: "asset_1",
                  itemCount: 3,
                  createdAt: 1,
                  updatedAt: 2,
                },
                assets: [
                  {
                    _id: "asset_1",
                    kind: "image",
                    pillar: "creators",
                    modelName: "midjourney",
                    promptText: "Editorial portrait",
                    tagNames: ["portrait"],
                    url: "https://cdn.example.com/full.png",
                    thumbUrl: "https://cdn.example.com/thumb.png",
                    assetPackId: "pack_1",
                    packSlotIndex: 0,
                    createdAt: 1,
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(calls[0]).toMatchObject({
      path: "assetPacks:getGalleryAssetPack",
      args: {
        packId: "pack_1",
        ownerUserId: "telegram:278674008",
      },
    });
    expect(response).toMatchObject({
      pack: {
        id: "pack_1",
        title: "Editorial pose pack",
        coverAssetId: "asset_1",
      },
      count: 1,
      assets: [
        {
          id: "asset_1",
          assetPackId: "pack_1",
          packSlotIndex: 0,
        },
      ],
    });
  });

  test("getPack accepts raw pack IDs for direct calls", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

    await handleGetPack(
      {
        action: "getPack",
        packId: "pack_1",
      },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: "telegram:278674008",
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              status: "success",
              value: {
                pack: {
                  _id: "pack_1",
                  title: "Editorial pose pack",
                  createdAt: 1,
                  updatedAt: 2,
                },
                assets: [],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(calls[0]?.args).toMatchObject({
      packId: "pack_1",
      ownerUserId: "telegram:278674008",
    });
  });

  test("design list forwards structured filters to the designs pillar query", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

    const response = await handleListDesigns(
      {
        action: "listDesigns",
        platform: "web",
        captureKind: "website",
        saveIntent: "inspiration",
        search: "pricing",
        requireAsset: true,
      },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: "telegram:278674008",
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              status: "success",
              value: [
                {
                  _id: "designInspirations:1",
                  title: "Pricing reference",
                  summary: "Tight hierarchy",
                  sourceUrl: "https://example.com/pricing",
                  sourceDomain: "example.com",
                  sourceTitle: "Pricing Page",
                  userNote: "Borrow this",
                  inspirationType: "website",
                  platform: "web",
                  workflowType: "page_prompt",
                  captureKind: "website",
                  saveIntent: "inspiration",
                  templateKey: "design-default",
                  sourceFingerprint: "website:https://example.com/pricing",
                  status: "active",
                  tagNames: ["pricing"],
                  previewUrl: "https://cdn.example.com/preview.png",
                  previewThumbUrl: "https://cdn.example.com/preview-thumb.png",
                  previewWidth: 1440,
                  previewHeight: 960,
                  folderId: "folders:1",
                  assetId: "assets:1",
                  promptId: "prompts:1",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(calls[0]).toMatchObject({
      path: "designInspirations:listDesignGalleryEntries",
      args: {
        ownerUserId: "telegram:278674008",
        platform: "web",
        captureKind: "website",
        saveIntent: "inspiration",
        search: "pricing",
        requireAsset: true,
      },
    });
    expect(response.count).toBe(1);
    expect(response.designs[0]).toMatchObject({
      id: "designInspirations:1",
      sourceTitle: "Pricing Page",
      captureKind: "website",
      saveIntent: "inspiration",
      previewUrl: "https://cdn.example.com/preview.png",
    });
  });

  test("getDesign hydrates the linked preview asset when present", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

    const response = await handleGetDesign(
      {
        action: "getDesign",
        designInspirationId: "designInspirations:1",
      },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: "telegram:278674008",
        fetchImpl: async (_url, init) => {
          const request = JSON.parse(String(init?.body)) as {
            path: string;
            args: Record<string, unknown>;
          };
          calls.push(request);

          if (request.path === "designInspirations:getDesignInspiration") {
            return new Response(
              JSON.stringify({
                status: "success",
                value: {
                  _id: "designInspirations:1",
                  title: "Pricing reference",
                  summary: "Tight hierarchy",
                  sourceUrl: "https://example.com/pricing",
                  sourceDomain: "example.com",
                  sourceTitle: "Pricing Page",
                  userNote: "Borrow this",
                  inspirationType: "website",
                  platform: "web",
                  workflowType: "page_prompt",
                  captureKind: "website",
                  saveIntent: "inspiration",
                  templateKey: "design-default",
                  sourceFingerprint: "website:https://example.com/pricing",
                  status: "active",
                  tagNames: ["pricing"],
                  folderId: "folders:1",
                  assetId: "assets:1",
                  promptId: "prompts:1",
                  createdAt: 1,
                  updatedAt: 2,
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }

          return new Response(
            JSON.stringify({
              status: "success",
              value: {
                _id: "assets:1",
                kind: "image",
                pillar: "designs",
                modelName: "midjourney",
                promptText: "Warm editorial SaaS pricing page",
                tagNames: ["pricing"],
                fileName: "pricing.png",
                url: "https://cdn.example.com/full.png",
                thumbUrl: "https://cdn.example.com/thumb.png",
                sourceUrl: "https://example.com/pricing",
                width: 1440,
                height: 960,
                folderId: "folders:1",
                assetRole: "reference",
                createdAt: 1,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(calls.map((call) => call.path)).toEqual([
      "designInspirations:getDesignInspiration",
      "assets:getGalleryAsset",
    ]);
    expect(response.design).toMatchObject({
      id: "designInspirations:1",
      assetId: "assets:1",
    });
    expect(response.linkedAsset).toMatchObject({
      id: "assets:1",
      promptText: "Warm editorial SaaS pricing page",
    });
  });
});
