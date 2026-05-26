import { beforeEach, describe, expect, test } from "bun:test";

import { adminUpdateAsset, createAsset, getAsset, updateAssetMetadata } from "../convex/assets";
import { createDesignInspiration, getDesignInspiration } from "../convex/designInspirations";
import { createFolder } from "../convex/folders";
import { createPrompt, deletePrompt, getPrompt } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("ingest management backend", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("deletePrompt clears linked design inspiration promptId", async () => {
    const prompt = await createPrompt._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      text: "Original prompt",
      tagIds: [],
      ingestKey: "prompt:key",
    });

    const design = await createDesignInspiration._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      title: "Reference",
      inspirationType: "website",
      tagIds: [],
      promptId: prompt.promptId,
      ingestKey: "design:key",
    });

    await deletePrompt._handler(harness.ctx as never, {
      id: prompt.promptId,
    });

    const updatedDesign = await getDesignInspiration._handler(harness.ctx as never, {
      id: design.designInspirationId,
      ownerUserId: "user-1",
    });
    expect(updatedDesign?.promptId).toBeUndefined();
  });

  test("updateAssetMetadata patches ingest-managed asset fields", async () => {
    const folder = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Refs",
    });
    const prompt = await createPrompt._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      text: "Prompt A",
      tagIds: [],
      ingestKey: "prompt:key",
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      ingestKey: "asset:key",
    });

    const updatedAssetId = await updateAssetMetadata._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: asset.assetId,
      tagIds: [],
      folderId: folder.folderId,
      promptId: prompt.promptId,
      sourceUrl: "https://example.com/updated.png",
      fileName: "updated.png",
      contentType: "image/png",
      modelName: "gpt-image-1",
      pillar: "designs",
      generationType: "ui_design",
      assetRole: "reference",
      ingestSource: "agent",
    });

    expect(updatedAssetId).toBe(asset.assetId);

    const updatedAsset = await getAsset._handler(harness.ctx as never, {
      id: asset.assetId,
      ownerUserId: "user-1",
    });
    expect(updatedAsset?.folderId).toBe(folder.folderId);
    expect(updatedAsset?.promptId).toBe(prompt.promptId);
    expect(updatedAsset?.sourceUrl).toBe("https://example.com/updated.png");
    expect(updatedAsset?.fileName).toBe("updated.png");
    expect(updatedAsset?.contentType).toBe("image/png");
    expect(updatedAsset?.modelName).toBe("gpt-image-1");
    expect(updatedAsset?.pillar).toBe("designs");
    expect(updatedAsset?.generationType).toBe("ui_design");
    expect(updatedAsset?.assetRole).toBe("reference");
    expect(updatedAsset?.ingestSource).toBe("agent");
  });

  test("adminUpdateAsset edits prompt, description, tags, and model metadata", async () => {
    const previousSecret = process.env.CURATION_ADMIN_SECRET;
    const previousAdmins = process.env.CURATION_ADMIN_USER_IDS;
    process.env.CURATION_ADMIN_SECRET = "test-secret";
    process.env.CURATION_ADMIN_USER_IDS = "admin-1";

    try {
      const asset = await createAsset._handler(harness.ctx as never, {
        ownerUserId: "owner-1",
        kind: "image",
        tagIds: [],
        ingestKey: "asset:admin-edit",
        pillar: "creators",
        modelName: "old-model",
      });

      const result = await adminUpdateAsset._handler(harness.ctx as never, {
        actorUserId: "admin-1",
        adminSecret: "test-secret",
        assetId: asset.assetId,
        promptText: "Updated admin prompt",
        description: "Updated admin description",
        tagNames: ["portrait", " editorial ", "portrait"],
        kind: "video",
        contentType: "video/mp4",
        modelName: "GPT-Image-2",
        pillar: "designs",
        generationType: "video_gen",
        assetRole: "generated_output",
        ingestSource: "manual",
        sourceUrl: "https://example.com/admin.png",
        fileName: "admin.png",
      });

      expect(result.promptText).toBe("Updated admin prompt");
      expect(result.kind).toBe("video");
      expect(result.description).toBe("Updated admin description");
      expect(result.tagNames).toEqual(["portrait", "editorial"]);
      expect(result.contentType).toBe("video/mp4");
      expect(result.modelName).toBe("GPT-Image-2");
      expect(result.pillar).toBe("designs");
      expect(result.generationType).toBe("video_gen");
      expect(result.assetRole).toBe("generated_output");
      expect(result.ingestSource).toBe("manual");

      const updatedAsset = await getAsset._handler(harness.ctx as never, {
        id: asset.assetId,
        ownerUserId: "owner-1",
      });
      expect(updatedAsset?.promptId).toBe(result.promptId);
      expect(updatedAsset?.kind).toBe("video");
      expect(updatedAsset?.description).toBe("Updated admin description");
      expect(updatedAsset?.contentType).toBe("video/mp4");
      expect(updatedAsset?.tagIds).toEqual(result.tagIds);

      const prompt = await getPrompt._handler(harness.ctx as never, {
        id: result.promptId!,
        ownerUserId: "owner-1",
      });
      expect(prompt?.text).toBe("Updated admin prompt");
      expect(prompt?.tagIds).toEqual(result.tagIds);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CURATION_ADMIN_SECRET;
      } else {
        process.env.CURATION_ADMIN_SECRET = previousSecret;
      }
      if (previousAdmins === undefined) {
        delete process.env.CURATION_ADMIN_USER_IDS;
      } else {
        process.env.CURATION_ADMIN_USER_IDS = previousAdmins;
      }
    }
  });
});
