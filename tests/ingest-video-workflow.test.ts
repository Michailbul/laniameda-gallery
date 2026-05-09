import { beforeEach, describe, expect, test } from "bun:test";

import { ingestFromApi } from "../convex/ingest";

type MutationArgs = Record<string, unknown>;

const videoBase64 = Buffer.from("fake mp4 bytes").toString("base64");

const createIngestHarness = () => {
  const state = {
    createPromptCalls: [] as MutationArgs[],
    createAssetCalls: [] as MutationArgs[],
    lineageCalls: [] as MutationArgs[],
    scheduledCalls: [] as Array<{ delayMs: number; payload: MutationArgs }>,
    storedBlobTypes: [] as string[],
  };

  let tagSeq = 0;
  let promptSeq = 0;
  let assetSeq = 0;
  let storageSeq = 0;
  let lineageSeq = 0;

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

      if (typeof args.role === "string") {
        lineageSeq += 1;
        state.lineageCalls.push(args);
        return { lineageId: `generationLineage:${lineageSeq}`, created: true };
      }

      throw new Error(`Unhandled mutation args: ${JSON.stringify(args)}`);
    },
    runQuery: async (_ref: unknown, args: MutationArgs) => {
      if (typeof args.id === "string") {
        return { _id: args.id };
      }
      return null;
    },
    storage: {
      store: async (blob: Blob) => {
        storageSeq += 1;
        state.storedBlobTypes.push(blob.type);
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

describe("video workflow ingest", () => {
  let harness: ReturnType<typeof createIngestHarness>;

  beforeEach(() => {
    harness = createIngestHarness();
  });

  test("stores video outputs and attaches upstream workflow lineage", async () => {
    const result = await ingestFromApi._handler(harness.ctx as never, {
      ownerUserId: "telegram:278674008",
      promptText: "Slow dolly-in from the starting frame.",
      file: {
        base64: videoBase64,
        fileName: "seedance-output.mp4",
        contentType: "video/mp4",
      },
      tagNames: ["seedance", "motion"],
      pillar: "creators",
      promptType: "video_gen",
      generationType: "video_gen",
      workflowType: "asset_recipe",
      assetRole: "generated_output",
      ingestKey: "video:seedance-output:v1",
      promptIngestKey: "prompt:seedance-workflow:v1",
      upstreamInputs: [
        {
          type: "prompt",
          id: "prompts:upstream" as never,
          role: "starting_image_prompt",
          stageOrder: 1,
          notes: "Prompt used to produce the starting frame.",
        },
      ],
    });

    expect(result).toEqual({
      assetId: "assets:1",
      promptId: "prompts:1",
      designInspirationId: undefined,
    });
    expect(harness.state.storedBlobTypes).toEqual([]);
    expect(harness.state.createPromptCalls[0]).toMatchObject({
      text: "Slow dolly-in from the starting frame.",
      promptType: "video_gen",
      workflowType: "asset_recipe",
      ingestKey: "prompt:seedance-workflow:v1",
    });
    expect(harness.state.createAssetCalls[0]).toMatchObject({
      kind: "video",
      contentType: "video/mp4",
      fileName: "seedance-output.mp4",
      promptId: "prompts:1",
      ingestKey: "video:seedance-output:v1",
      generationType: "video_gen",
      assetRole: "generated_output",
    });
    expect(harness.state.createAssetCalls[0]?.r2Key).toBeDefined();
    expect(harness.state.createAssetCalls[0]?.thumbStorageId).toBeUndefined();
    expect(harness.state.lineageCalls).toEqual([
      {
        ownerUserId: "telegram:278674008",
        targetAssetId: "assets:1",
        targetPromptId: undefined,
        sourcePromptId: "prompts:upstream",
        sourceAssetId: undefined,
        role: "starting_image_prompt",
        stageOrder: 1,
        notes: "Prompt used to produce the starting frame.",
      },
    ]);
  });
});
