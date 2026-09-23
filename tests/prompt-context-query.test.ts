import { beforeEach, describe, expect, test } from "bun:test";

import { getPromptContext } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const OWNER = "278674008";

describe("prompts.getPromptContext", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  // A two-step workflow: an image prompt with one still, then a video prompt
  // that owns both a poster still and the published cut.
  const seedWorkflow = async () => {
    const workflowId = await harness.db.insert("workflows", {
      ownerUserId: OWNER,
      title: "1890s GRWM vlog",
      tagIds: [],
      stepCount: 2,
      isPublic: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const portraitPrompt = await harness.db.insert("prompts", {
      ownerUserId: OWNER,
      text: "Render a portrait",
      tagIds: [],
      promptSections: {
        finalPrompt: "Render a portrait",
        generationNotes: "Stand-in attached",
      },
      modelName: "GPT Image 2.5",
      workflowId,
      workflowStepOrder: 0,
      workflowStepLabel: "Identity portrait",
      createdAt: 1,
    });
    const vlogPrompt = await harness.db.insert("prompts", {
      ownerUserId: OWNER,
      text: "A 30-second vlog",
      tagIds: [],
      modelName: "Seedance 2.5",
      workflowId,
      workflowStepOrder: 1,
      workflowStepLabel: "Vlog",
      createdAt: 2,
    });
    await harness.db.insert("assets", {
      ownerUserId: OWNER,
      kind: "image",
      promptId: portraitPrompt,
      tagIds: [],
      sourceUrl: "https://cdn.test/portrait.png",
      description: "Stand-in crop",
      createdAt: 1,
    });
    await harness.db.insert("assets", {
      ownerUserId: OWNER,
      kind: "image",
      promptId: vlogPrompt,
      tagIds: [],
      sourceUrl: "https://cdn.test/still.png",
      createdAt: 2,
    });
    await harness.db.insert("assets", {
      ownerUserId: OWNER,
      kind: "video",
      promptId: vlogPrompt,
      tagIds: [],
      sourceUrl: "https://cdn.test/cut.mp4",
      description: "Published cut",
      createdAt: 3,
    });
    return { workflowId, portraitPrompt, vlogPrompt };
  };

  test("the owner gets sections, every file sharing the prompt, and the sibling steps", async () => {
    const { workflowId, vlogPrompt } = await seedWorkflow();

    const result = await getPromptContext._handler(harness.ctx as never, {
      id: vlogPrompt as never,
      ownerUserId: OWNER,
    });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("A 30-second vlog");
    expect(result!.modelName).toBe("Seedance 2.5");
    // Both files ride with the prompt, oldest first, each with its caption.
    expect(result!.media.map((file) => file.kind)).toEqual(["image", "video"]);
    expect(result!.media[1]!.description).toBe("Published cut");
    expect(result!.media[1]!.url).toBe("https://cdn.test/cut.mp4");
    // The workflow around it, with this prompt's place in it.
    expect(result!.workflow?._id).toBe(workflowId);
    expect(result!.workflow?.stepOrder).toBe(1);
    expect(result!.workflow?.stepLabel).toBe("Vlog");
    // Every sibling step's prompt is right there — the image prompt that fed
    // the video is one copy away from the video.
    expect(result!.workflow?.steps.map((step) => step.finalPrompt)).toEqual([
      "Render a portrait",
      "A 30-second vlog",
    ]);
    expect(result!.workflow?.steps[0]!.mediaCount).toBe(1);
    expect(result!.workflow?.steps[0]!.coverThumbUrl).toBe("https://cdn.test/portrait.png");
    expect(result!.workflow?.steps[1]!.mediaCount).toBe(2);
  });

  test("a stranger is refused unless the workflow is public", async () => {
    const { workflowId, portraitPrompt } = await seedWorkflow();

    expect(
      await getPromptContext._handler(harness.ctx as never, {
        id: portraitPrompt as never,
        ownerUserId: "999",
      }),
    ).toBeNull();
    expect(
      await getPromptContext._handler(harness.ctx as never, {
        id: portraitPrompt as never,
      }),
    ).toBeNull();

    await harness.db.patch(workflowId, { isPublic: true });
    const result = await getPromptContext._handler(harness.ctx as never, {
      id: portraitPrompt as never,
    });
    expect(result?.workflow?.title).toBe("1890s GRWM vlog");
    expect(result?.promptSections?.generationNotes).toBe("Stand-in attached");
  });

  test("a prompt outside any workflow returns its files and no workflow", async () => {
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: OWNER,
      text: "Four poster variations",
      tagIds: [],
      createdAt: 1,
    });
    for (let index = 0; index < 4; index++) {
      await harness.db.insert("assets", {
        ownerUserId: OWNER,
        kind: "image",
        promptId,
        tagIds: [],
        sourceUrl: `https://cdn.test/poster-${index}.jpg`,
        createdAt: index + 1,
      });
    }

    const result = await getPromptContext._handler(harness.ctx as never, {
      id: promptId as never,
      ownerUserId: OWNER,
    });

    expect(result?.media).toHaveLength(4);
    expect(result?.workflow).toBeUndefined();

    // A private prompt with no workflow is the owner's alone.
    expect(
      await getPromptContext._handler(harness.ctx as never, {
        id: promptId as never,
      }),
    ).toBeNull();
  });
});
