import { beforeEach, describe, expect, test } from "bun:test";

import {
  addSkillToCollection,
  listWorkflows,
  markdownExcerpt,
  parseBodyAssetIds,
  removeSkillFromCollection,
  updateSkill,
} from "../convex/workflows";
import { buildSkillTextLane } from "../convex/semanticIndex";
import { skillCardToEntry } from "../lib/skill-entries";
import { handleGetById } from "../skills/laniameda-gallery/scripts/query";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "telegram:278674008";

describe("skill helpers", () => {
  test("markdownExcerpt flattens markdown to a lead", () => {
    const excerpt = markdownExcerpt(
      "# Title\n\nUse **Seedream** to [paint](https://x.y) frames.\n\n![cover](asset:abc)\n\n```\ncode\n```",
    );
    expect(excerpt).toBe("Title Use Seedream to paint frames.");
    expect(markdownExcerpt(undefined)).toBeUndefined();
    expect(markdownExcerpt("x".repeat(400))!.length).toBeLessThanOrEqual(220);
  });

  test("parseBodyAssetIds finds asset embeds once each", () => {
    const id = "k17abc123def456ghi789jkl0mn";
    expect(
      parseBodyAssetIds(`![a](asset:${id}) and again asset:${id}, plus asset:short`),
    ).toEqual([id]);
    expect(parseBodyAssetIds(undefined)).toEqual([]);
  });

  test("the skill text lane leads with title, tags and models", () => {
    const lane = buildSkillTextLane({
      title: "Depth Map Storyboards",
      description: "Composition-first Seedance control.",
      body: "## Why\nDepth keeps blocking.",
      tagNames: ["seedance", "depth map"],
      stepLabels: ["Plate", "Depth"],
      modelNames: ["Seedance 2.0"],
    });
    expect(lane.startsWith("skill: Depth Map Storyboards")).toBe(true);
    expect(lane).toContain("tags: seedance, depth map");
    expect(lane).toContain("models: Seedance 2.0");
    expect(lane).toContain("steps: Plate / Depth");
    expect(lane).toContain("Depth keeps blocking.");
  });

  test("a skill without media maps to a document-shaped card", () => {
    const entry = skillCardToEntry({
      _id: "wf_1",
      title: "Lookbook prompts",
      excerpt: "Studio editorials.",
      tagNames: ["fashion"],
      stepCount: 1,
      createdAt: 1,
      previewImages: [],
    });
    expect(entry.galleryItemType).toBe("workflow");
    expect(entry.excerpt).toBe("Studio editorials.");
    expect(entry.width! / entry.height!).toBeCloseTo(0.8);
    expect(entry.src).toBe("/placeholder.svg");
  });
});

describe("skill tags and collections", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  const seedSkill = async () => {
    const folderId = await harness.db.insert("folders", {
      ownerUserId: OWNER,
      name: "DEAR ANNETE",
      normalizedName: "dear annete",
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const workflowId = await harness.db.insert("workflows", {
      ownerUserId: OWNER,
      title: "Torn paper reveal",
      tagIds: [],
      stepCount: 0,
      createdAt: 1,
      updatedAt: 1,
    } as never);
    return { folderId, workflowId };
  };

  test("tags are added, filtered on and removed canonically", async () => {
    const { workflowId } = await seedSkill();
    const result = await callAsOwner(updateSkill)(harness.ctx, {
      ownerUserId: OWNER,
      id: workflowId,
      addTagNames: ["#Stop-Motion", "seedream"],
    });
    expect(result.tagNames).toEqual(["Stop-Motion", "seedream"]);

    const matched = await callAsOwner(listWorkflows)(harness.ctx, {
      ownerUserId: OWNER,
      tagNames: ["stop motion"],
    });
    expect(matched.map((card: { _id: string }) => card._id)).toEqual([workflowId]);

    const removed = await callAsOwner(updateSkill)(harness.ctx, {
      ownerUserId: OWNER,
      id: workflowId,
      removeTagNames: ["stop_motion"],
    });
    expect(removed.tagNames).toEqual(["seedream"]);
  });

  test("a skill is filed into a collection, listed there, and taken out", async () => {
    const { folderId, workflowId } = await seedSkill();
    const first = await callAsOwner(addSkillToCollection)(harness.ctx, {
      ownerUserId: OWNER,
      id: workflowId,
      folderId,
    });
    const again = await callAsOwner(addSkillToCollection)(harness.ctx, {
      ownerUserId: OWNER,
      id: workflowId,
      folderId,
    });
    expect(first.added).toBe(true);
    expect(again.added).toBe(false);

    const inFolder = await callAsOwner(listWorkflows)(harness.ctx, {
      ownerUserId: OWNER,
      folderId,
    });
    expect(inFolder).toHaveLength(1);
    expect(inFolder[0].folderIds).toEqual([folderId]);

    await callAsOwner(removeSkillFromCollection)(harness.ctx, {
      ownerUserId: OWNER,
      id: workflowId,
      folderId,
    });
    const after = await callAsOwner(listWorkflows)(harness.ctx, {
      ownerUserId: OWNER,
      folderId,
    });
    expect(after).toHaveLength(0);
  });

  test("another owner cannot retag someone else's skill", async () => {
    const { workflowId } = await seedSkill();
    await expect(
      callAsOwner(updateSkill)(harness.ctx, {
        ownerUserId: "telegram:999",
        id: workflowId,
        addTagNames: ["x"],
      }),
    ).rejects.toThrow("Skill does not belong to this user.");
  });
});

describe("query script resolves skill ids", () => {
  test("getById routes workflow:<id> to workflows:getWorkflow", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
    const response = await handleGetById(
      { action: "getById", id: "workflow:wf_1" },
      {
        convexUrl: "https://example.convex.cloud",
        ownerUserId: OWNER,
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({ status: "success", value: { _id: "wf_1", title: "Skill" } }),
          );
        },
      },
    );
    expect(calls[0]!.path).toBe("workflows:getWorkflow");
    expect(calls[0]!.args.id).toBe("wf_1");
    expect((response as { skill: { id: string } }).skill.id).toBe("skill:wf_1");
  });
});
