import { beforeEach, describe, expect, test } from "bun:test";

import { ingestFromAgentPayload } from "../convex/agent_ingest";

const tinyGifBase64 = "R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=";

type MutationArgs = Record<string, unknown>;

const createAgentIngestHarness = () => {
  const state = {
    createPromptCalls: [] as MutationArgs[],
    createAssetCalls: [] as MutationArgs[],
    createDesignInspirationCalls: [] as MutationArgs[],
    appendRunEventCalls: [] as MutationArgs[],
    deletedPromptIds: [] as string[],
    scheduledCalls: [] as Array<{ delayMs: number; payload: MutationArgs }>,
    storedBlobSizes: [] as number[],
  };

  let tagSeq = 0;
  let promptSeq = 0;
  let assetSeq = 0;
  let designSeq = 0;
  let storageSeq = 0;

  const ctx = {
    runMutation: async (_ref: unknown, args: MutationArgs) => {
      if (Array.isArray(args.tags)) {
        return args.tags.map(() => `tags:${++tagSeq}`);
      }

      if (typeof args.text === "string" && Array.isArray(args.tagIds)) {
        promptSeq += 1;
        state.createPromptCalls.push(args);
        return { promptId: `prompts:${promptSeq}`, created: true };
      }

      if (typeof args.kind === "string" && Array.isArray(args.tagIds)) {
        assetSeq += 1;
        state.createAssetCalls.push(args);
        return { assetId: `assets:${assetSeq}`, created: true };
      }

      if (typeof args.inspirationType === "string" && Array.isArray(args.tagIds)) {
        designSeq += 1;
        state.createDesignInspirationCalls.push(args);
        return { designInspirationId: `designInspirations:${designSeq}`, created: true };
      }

      if (typeof args.runId === "string" && typeof args.type === "string") {
        state.appendRunEventCalls.push(args);
        return { eventId: "run_events:1", seq: state.appendRunEventCalls.length };
      }

      if (typeof args.id === "string") {
        state.deletedPromptIds.push(args.id);
        return null;
      }

      throw new Error(`Unhandled mutation args: ${JSON.stringify(args)}`);
    },
    storage: {
      store: async (blob: Blob) => {
        storageSeq += 1;
        state.storedBlobSizes.push(blob.size);
        return `_storage:${storageSeq}`;
      },
    },
    scheduler: {
      runAfter: async (delayMs: number, _ref: unknown, payload: MutationArgs) => {
        state.scheduledCalls.push({ delayMs, payload });
        return null;
      },
    },
  };

  return { ctx, state };
};

describe("agent ingest", () => {
  let harness: ReturnType<typeof createAgentIngestHarness>;

  beforeEach(() => {
    harness = createAgentIngestHarness();
  });

  test("assigns prompt-scoped tags to each asset and generates image derivatives", async () => {
    const result = await ingestFromAgentPayload._handler(harness.ctx as never, {
      runId: "runs:1" as never,
      ownerUserId: "telegram:278674008",
      payload: {
        prompts: [
          { final_prompt: "Prompt A", tags: ["alpha"], pillar: "creators" },
          { final_prompt: "Prompt B", tags: ["beta"], pillar: "dump" },
        ],
        designInspirations: [],
        selectedTelegramMediaIds: ["media-1", "media-2"],
        selectedUrls: [],
        allowPromptOnly: false,
      },
      mediaFiles: [
        {
          mediaId: "media-1",
          kind: "image",
          mimeType: "image/gif",
          fileName: "one.gif",
          base64: tinyGifBase64,
          linkedPromptIndex: 1,
        },
        {
          mediaId: "media-2",
          kind: "image",
          mimeType: "image/gif",
          fileName: "two.gif",
          base64: tinyGifBase64,
          linkedPromptIndex: 2,
        },
      ],
    });

    expect(result.assetIds).toEqual(["assets:1", "assets:2"]);
    expect(harness.state.createAssetCalls).toHaveLength(2);

    expect(harness.state.createAssetCalls[0]?.tagIds).toEqual([
      "tags:1",
      "tags:3",
      "tags:4",
    ]);
    expect(harness.state.createAssetCalls[1]?.tagIds).toEqual([
      "tags:2",
      "tags:3",
      "tags:4",
    ]);

    expect(harness.state.createAssetCalls[0]?.promptId).toBe("prompts:1");
    expect(harness.state.createAssetCalls[1]?.promptId).toBe("prompts:2");
    expect(harness.state.createAssetCalls[0]?.thumbStorageId).toBeDefined();
    expect(harness.state.createAssetCalls[0]?.width).toBe(1);
    expect(harness.state.createAssetCalls[0]?.height).toBe(1);
  });

  test("persists selected URLs as design inspirations linked to the prompt", async () => {
    const result = await ingestFromAgentPayload._handler(harness.ctx as never, {
      runId: "runs:2" as never,
      ownerUserId: "telegram:278674008",
      payload: {
        prompts: [
          {
            final_prompt: "Build an editorial landing page",
            tags: ["editorial"],
            pillar: "designs",
            workflowType: "page_prompt",
          },
        ],
        designInspirations: [],
        selectedTelegramMediaIds: [],
        selectedUrls: ["https://example.com/library/ref"],
        notes: "Saved from Telegram",
        allowPromptOnly: false,
      },
      mediaFiles: [],
    });

    expect(result.promptIds).toEqual(["prompts:1"]);
    expect(result.designInspirationIds).toEqual(["designInspirations:1"]);
    expect(harness.state.deletedPromptIds).toEqual([]);
    expect(harness.state.createDesignInspirationCalls).toHaveLength(1);
    expect(harness.state.createDesignInspirationCalls[0]?.sourceUrl).toBe(
      "https://example.com/library/ref",
    );
    expect(harness.state.createDesignInspirationCalls[0]?.promptId).toBe("prompts:1");
    expect(harness.state.createDesignInspirationCalls[0]?.inspirationType).toBe("other");
    expect(harness.state.createDesignInspirationCalls[0]?.summary).toBe("Saved from Telegram");
    expect(harness.state.createDesignInspirationCalls[0]?.tagIds).toEqual([
      "tags:2",
      "tags:3",
    ]);
    expect(harness.state.appendRunEventCalls).toHaveLength(1);
  });
});
