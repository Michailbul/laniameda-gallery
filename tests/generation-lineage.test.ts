import { describe, expect, test } from "bun:test";

import { createAsset, deleteAsset } from "../convex/assets";
import {
  getDownstreamForPrompt,
  getUpstreamForAsset,
  upsertLineage,
} from "../convex/generationLineage";
import { createPrompt } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("generation lineage backend", () => {
  test("links workflow outputs to upstream prompts idempotently", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const prompt = await createPrompt._handler(ctx as never, {
      ownerUserId: "user-1",
      text: "Starting image prompt",
      tagIds: [],
      ingestKey: "prompt:start:v1",
    });
    const asset = await createAsset._handler(ctx as never, {
      ownerUserId: "user-1",
      kind: "video",
      tagIds: [],
      ingestKey: "video:output:v1",
      promptId: prompt.promptId,
      contentType: "video/mp4",
      generationType: "video_gen",
      assetRole: "generated_output",
    });

    const first = await upsertLineage._handler(ctx as never, {
      ownerUserId: "user-1",
      targetAssetId: asset.assetId,
      sourcePromptId: prompt.promptId,
      role: "starting_image_prompt",
      stageOrder: 1,
      notes: "Seedance video used this starting-frame prompt.",
    });
    const second = await upsertLineage._handler(ctx as never, {
      ownerUserId: "user-1",
      targetAssetId: asset.assetId,
      sourcePromptId: prompt.promptId,
      role: "starting_image_prompt",
      stageOrder: 1,
      notes: "Seedance video used this starting-frame prompt.",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.lineageId).toBe(first.lineageId);

    const upstream = await getUpstreamForAsset._handler(ctx as never, {
      ownerUserId: "user-1",
      assetId: asset.assetId,
    });
    expect(upstream).toHaveLength(1);
    expect(upstream[0]?.lineage.sourcePromptId).toBe(prompt.promptId);
    expect(upstream[0]?.lineage.targetAssetId).toBe(asset.assetId);
    expect(upstream[0]?.sourcePrompt?.text).toBe("Starting image prompt");
    expect(upstream[0]?.targetAsset?.kind).toBe("video");

    const downstream = await getDownstreamForPrompt._handler(ctx as never, {
      ownerUserId: "user-1",
      promptId: prompt.promptId,
    });
    expect(downstream.map((row) => row.lineage._id)).toEqual([first.lineageId]);
    expect(db.getTableDocs("generationLineage")).toHaveLength(1);
  });

  test("rejects lineage links across owners", async () => {
    const { ctx } = createMockConvexMutationCtx();
    const prompt = await createPrompt._handler(ctx as never, {
      ownerUserId: "user-1",
      text: "Starting image prompt",
      tagIds: [],
    });
    const asset = await createAsset._handler(ctx as never, {
      ownerUserId: "user-2",
      kind: "video",
      tagIds: [],
      contentType: "video/mp4",
    });

    await expect(
      upsertLineage._handler(ctx as never, {
        ownerUserId: "user-1",
        targetAssetId: asset.assetId,
        sourcePromptId: prompt.promptId,
        role: "starting_image_prompt",
      }),
    ).rejects.toThrow("Target asset does not belong to this user.");
  });

  test("deleting an asset clears workflow lineage rows", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const prompt = await createPrompt._handler(ctx as never, {
      ownerUserId: "user-1",
      text: "Source prompt",
      tagIds: [],
    });
    const asset = await createAsset._handler(ctx as never, {
      ownerUserId: "user-1",
      kind: "video",
      tagIds: [],
      contentType: "video/mp4",
    });

    await upsertLineage._handler(ctx as never, {
      ownerUserId: "user-1",
      targetAssetId: asset.assetId,
      sourcePromptId: prompt.promptId,
      role: "starting_image_prompt",
    });

    expect(db.getTableDocs("generationLineage")).toHaveLength(1);
    await deleteAsset._handler(ctx as never, {
      ownerUserId: "user-1",
      id: asset.assetId,
    });
    expect(db.getTableDocs("generationLineage")).toHaveLength(0);
  });
});
