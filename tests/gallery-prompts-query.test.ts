import { beforeEach, describe, expect, test } from "bun:test";

import { listPromptOnlyGalleryPrompts } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("prompt-only gallery queries", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("returns only prompt rows without linked assets or design inspirations", async () => {
    const promptOnlyTagId = await harness.db.insert("tags", {
      name: "Workflow",
      normalized: "workflow",
      usageCount: 1,
    });
    const linkedTagId = await harness.db.insert("tags", {
      name: "Linked",
      normalized: "linked",
      usageCount: 1,
    });

    const promptOnlyId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Prompt only workflow",
      tagIds: [promptOnlyTagId],
      promptType: "workflow",
      pillar: "creators",
      createdAt: 200,
    });
    const linkedPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Prompt linked to asset",
      tagIds: [linkedTagId],
      promptType: "image_gen",
      pillar: "creators",
      createdAt: 100,
    });

    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      promptId: linkedPromptId,
      tagIds: [linkedTagId],
      createdAt: 150,
    });

    const results = await listPromptOnlyGalleryPrompts._handler(
      harness.ctx as never,
      {
        ownerUserId: "278674008",
        limit: 20,
      },
    );

    expect(results.map((prompt) => prompt._id)).toEqual([promptOnlyId]);
    expect(results[0]?.linkedAssetCount).toBe(0);
    expect(results[0]?.linkedDesignInspirationCount).toBe(0);
  });

  test("supports folder, tag, model, and lexical filtering", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "PromptOps",
      normalized: "promptops",
      usageCount: 1,
    });
    const folderId = await harness.db.insert("folders", {
      ownerUserId: "278674008",
      name: "Playbook",
      normalizedName: "playbook",
      createdAt: 1,
    });

    await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Rejected prompt",
      tagIds: [tagId],
      folderId,
      modelName: "Other Model",
      pillar: "cars",
      createdAt: 100,
    });
    const matchingPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "LTX workflow note",
      tagIds: [tagId],
      folderId,
      modelName: "Nano Banana Pro",
      pillar: "designs",
      promptType: "workflow",
      promptSections: {
        finalPrompt: "LTX motion control workflow",
      },
      createdAt: 200,
    });

    const results = await listPromptOnlyGalleryPrompts._handler(
      harness.ctx as never,
      {
        ownerUserId: "278674008",
        folderId,
        tagIds: [tagId],
        modelName: "Nano Banana Pro",
        pillar: "designs",
        search: "motion control",
        limit: 20,
      },
    );

    expect(results.map((prompt) => prompt._id)).toEqual([matchingPromptId]);
  });
});
