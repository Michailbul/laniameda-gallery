import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  buildAssetTextLane,
  normalizeAgentDescription,
} from "../convex/agentDescriptionText";
import {
  buildDescribePrompt,
  describeAsset,
  saveAutoDescription,
} from "../convex/agentDescriptions";
import {
  createAsset,
  findAssetsBySourceUrls,
  setAgentDescription,
} from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const OWNER = "278674008";

describe("agent description text", () => {
  test("keeps short descriptions and collapses whitespace", () => {
    expect(normalizeAgentDescription("  Rain-slick   alley,\n neon signs. ")).toBe(
      "Rain-slick alley, neon signs.",
    );
    expect(normalizeAgentDescription("   ")).toBeUndefined();
    expect(normalizeAgentDescription(null)).toBeUndefined();
  });

  test("clips long descriptions at a sentence end", () => {
    const first = "A woman stands on a balcony above a night city, wind in her hair. ".repeat(4);
    const long = `${first}${"More detail that runs on and on ".repeat(20)}`;
    const normalized = normalizeAgentDescription(long)!;
    expect(normalized.length).toBeLessThanOrEqual(400);
    expect(normalized.endsWith(".")).toBeTrue();
  });

  test("text lane leads with the agent description and names the source domain", () => {
    const lane = buildAssetTextLane({
      agentDescription: "Brutalist landing page hero with a slow 3D product turn.",
      description: "saved for the depth layering",
      promptText: "p".repeat(5000),
      tagNames: ["inspiration", "landing-page"],
      modelName: "GPT Image 2",
      sourceUrl: "https://www.x.com/someone/status/1",
    });
    const lines = lane.split("\n");
    expect(lines[0]).toBe("Brutalist landing page hero with a slow 3D product turn.");
    expect(lane).toContain("tags: inspiration, landing-page");
    expect(lane).toContain("model: GPT Image 2");
    expect(lane).toContain("source: x.com");
    // The prompt is clipped so it can't drown the rest.
    expect(lane.length).toBeLessThan(3000);
    expect(buildAssetTextLane({ tagNames: [] })).toBe("");
  });

  test("describe prompt carries archive context", () => {
    const prompt = buildDescribePrompt({
      assetId: "assets:1" as never,
      kind: "video",
      tagNames: ["character", "animation"],
      promptText: "clay figure waves",
      sourceUrl: "https://www.instagram.com/p/abc",
    });
    expect(prompt).toContain("Tags: character, animation");
    expect(prompt).toContain("Generation prompt: clay figure waves");
    expect(prompt).toContain("Source: instagram.com");
    expect(prompt).toContain("poster frame of a video");
  });
});

describe("agent description write paths", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  let scheduled: Array<{ delayMs: number; args: Record<string, unknown> }>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
    scheduled = [];
    harness.ctx.scheduler.runAfter = (async (delayMs: number, _ref: unknown, args: Record<string, unknown>) => {
      scheduled.push({ delayMs, args });
      return null;
    }) as never;
  });

  const baseAsset = {
    ownerUserId: OWNER,
    kind: "image" as const,
    storageId: "_storage:1" as never,
    tagIds: [],
  };

  test("createAsset stores an agent description and skips the auto pass", async () => {
    const { assetId } = await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      agentDescription: "  Clay character waving from a doorway.  ",
      sourceUrl: "https://x.com/a/status/1",
    });
    const asset = await harness.db.get<Record<string, unknown>>(assetId);
    expect(asset?.agentDescription).toBe("Clay character waving from a doorway.");
    expect(asset?.agentDescriptionSource).toBe("agent");
    expect(asset?.sourceUrl).toBe("https://x.com/a/status/1");
    // reindex only; no describe job
    expect(scheduled).toHaveLength(1);
  });

  test("createAsset indexes directly while automatic descriptions are off", async () => {
    await createAsset._handler(harness.ctx as never, baseAsset);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args).toEqual({ assetId: expect.any(String) });
  });

  test("with automatic descriptions on, createAsset describes first and indexes once after", async () => {
    process.env.AGENT_DESCRIPTIONS_ENABLED = "true";
    try {
      await createAsset._handler(harness.ctx as never, baseAsset);
    } finally {
      delete process.env.AGENT_DESCRIPTIONS_ENABLED;
    }
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args).toMatchObject({ reindexAfter: true });
    expect(scheduled[0]?.delayMs).toBeGreaterThan(0);
  });

  test("a repeat save fills a missing description but never overwrites", async () => {
    const first = await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      ingestKey: "x:1:1",
    });
    await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      ingestKey: "x:1:1",
      agentDescription: "First description.",
      sourceUrl: "https://x.com/a/status/1",
    });
    await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      ingestKey: "x:1:1",
      agentDescription: "Second description.",
    });
    const asset = await harness.db.get<Record<string, unknown>>(first.assetId);
    expect(asset?.agentDescription).toBe("First description.");
    expect(asset?.sourceUrl).toBe("https://x.com/a/status/1");
  });

  test("setAgentDescription protects agent-written text unless overwrite is set", async () => {
    const { assetId } = await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      agentDescription: "Original.",
    });
    const refused = await setAgentDescription._handler(harness.ctx as never, {
      ownerUserId: OWNER,
      assetId,
      agentDescription: "Replacement.",
    });
    expect(refused.updated).toBeFalse();
    const replaced = await setAgentDescription._handler(harness.ctx as never, {
      ownerUserId: OWNER,
      assetId,
      agentDescription: "Replacement.",
      overwrite: true,
    });
    expect(replaced.updated).toBeTrue();
    const asset = await harness.db.get<Record<string, unknown>>(assetId);
    expect(asset?.agentDescription).toBe("Replacement.");
  });

  test("setAgentDescription rejects another owner's asset", async () => {
    const { assetId } = await createAsset._handler(harness.ctx as never, baseAsset);
    await expect(
      setAgentDescription._handler(harness.ctx as never, {
        ownerUserId: "someone-else",
        assetId,
        agentDescription: "x",
      }),
    ).rejects.toThrow();
  });

  test("findAssetsBySourceUrls reports saved and unsaved sources", async () => {
    const { assetId } = await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      sourceUrl: "https://x.com/a/status/1",
    });
    const matches = await findAssetsBySourceUrls._handler(harness.ctx as never, {
      ownerUserId: OWNER,
      sourceUrls: ["https://x.com/a/status/1", "https://x.com/a/status/2", " "],
    });
    expect(matches).toEqual([
      { sourceUrl: "https://x.com/a/status/1", assetIds: [assetId] },
      { sourceUrl: "https://x.com/a/status/2", assetIds: [] },
    ]);
  });

  test("the auto pass never overwrites an agent description", async () => {
    const { assetId } = await createAsset._handler(harness.ctx as never, {
      ...baseAsset,
      agentDescription: "Agent wrote this.",
    });
    const saved = await saveAutoDescription._handler(harness.ctx as never, {
      assetId,
      agentDescription: "Auto text.",
      replaceAuto: true,
    });
    expect(saved).toBeFalse();

    const other = await createAsset._handler(harness.ctx as never, baseAsset);
    expect(
      await saveAutoDescription._handler(harness.ctx as never, {
        assetId: other.assetId,
        agentDescription: "Auto text.",
      }),
    ).toBeTrue();
    const asset = await harness.db.get<Record<string, unknown>>(other.assetId);
    expect(asset?.agentDescription).toBe("Auto text.");
    expect(asset?.agentDescriptionSource).toBe("auto");
  });
});

describe("describeAsset action", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AGENT_DESCRIPTIONS_ENABLED;
    delete process.env.GEMINI_API_KEY;
  });

  const source = {
    assetId: "assets:1",
    kind: "image",
    imageUrl: "https://r2.example/thumb.webp",
    tagNames: ["character"],
  };

  test("is a no-op unless enabled, but still indexes a deferred asset", async () => {
    const indexed: unknown[] = [];
    const ctx = {
      runQuery: async () => source,
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: unknown) => {
          indexed.push(args);
          return null;
        },
      },
    };
    expect(
      (await describeAsset._handler(ctx as never, { assetId: "assets:1" as never })).status,
    ).toBe("disabled");
    expect(indexed).toHaveLength(0);
    await describeAsset._handler(ctx as never, {
      assetId: "assets:1" as never,
      reindexAfter: true,
    });
    expect(indexed).toEqual([{ assetId: "assets:1" }]);
  });

  test("describes the picture and saves it", async () => {
    process.env.AGENT_DESCRIPTIONS_ENABLED = "true";
    process.env.GEMINI_API_KEY = "test-gemini-key-123";
    const calls: string[] = [];
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("thumb.webp")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/webp" },
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "\"Clay character waves from a doorway, soft window light.\"" }] } },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const saves: unknown[] = [];
    const ctx = {
      runQuery: async () => source,
      runMutation: async (_ref: unknown, args: unknown) => {
        saves.push(args);
        return true;
      },
      scheduler: { runAfter: async () => null },
    };
    const result = await describeAsset._handler(ctx as never, { assetId: "assets:1" as never });
    expect(result.status).toBe("described");
    expect(calls.some((url) => url.includes(":generateContent"))).toBeTrue();
    expect(saves[0]).toMatchObject({
      assetId: "assets:1",
      agentDescription: "Clay character waves from a doorway, soft window light.",
    });
  });

  test("schedules a retry on rate limits", async () => {
    process.env.AGENT_DESCRIPTIONS_ENABLED = "true";
    process.env.GEMINI_API_KEY = "test-gemini-key-123";
    global.fetch = mock(async (input: string | URL | Request) =>
      String(input).includes("thumb.webp")
        ? new Response(new Uint8Array([1]), { headers: { "content-type": "image/webp" } })
        : new Response("slow down", { status: 429 }),
    ) as unknown as typeof fetch;
    const retries: unknown[] = [];
    const ctx = {
      runQuery: async () => source,
      runMutation: async () => true,
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: unknown) => {
          retries.push(args);
          return null;
        },
      },
    };
    const result = await describeAsset._handler(ctx as never, { assetId: "assets:1" as never });
    expect(result).toEqual({ status: "error", retryScheduled: true });
    expect(retries[0]).toMatchObject({ assetId: "assets:1", attempt: 1 });
  });
});
