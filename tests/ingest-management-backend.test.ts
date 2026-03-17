import { beforeEach, describe, expect, test } from "bun:test";

import { createAsset, getAsset, updateAssetMetadata } from "../convex/assets";
import { createDesignInspiration, getDesignInspiration } from "../convex/designInspirations";
import { createFolder } from "../convex/folders";
import { createPrompt, deletePrompt } from "../convex/prompts";
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
});
