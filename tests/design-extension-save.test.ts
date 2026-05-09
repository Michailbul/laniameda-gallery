import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createAsset, deleteAsset } from "../convex/assets";
import { saveFromExtension } from "../convex/designExtensionSaves";
import { getDesignSaveTemplateByKey, upsertDesignSaveTemplate } from "../convex/designSaveTemplates";
import {
  createDesignInspiration,
  getDesignInspiration,
  getDesignInspirationIdForSourceFingerprint,
  listDesignGalleryEntries,
  updateDesignInspiration,
} from "../convex/designInspirations";
import { getOrCreateTags } from "../convex/tags";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const ONE_BY_ONE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4////fwAJ+wP92PZgeAAAAABJRU5ErkJggg==";

const getFunctionName = (reference: object) => {
  const [symbol] = Object.getOwnPropertySymbols(reference);
  return symbol
    ? ((reference as Record<PropertyKey, string | undefined>)[symbol] ?? "")
    : "";
};

const createActionHarness = () => {
  const harness = createMockConvexMutationCtx();
  const mutationCtx = harness.ctx;
  const queryCtx = harness.ctx;

  const ctx = {
    ...harness.ctx,
    runMutation: async (reference: object, args: unknown) => {
      switch (getFunctionName(reference)) {
        case "assets:createAsset":
          return await createAsset._handler(mutationCtx as never, args as never);
        case "assets:deleteAsset":
          return await deleteAsset._handler(mutationCtx as never, args as never);
        case "designInspirations:createDesignInspiration":
          return await createDesignInspiration._handler(mutationCtx as never, args as never);
        case "designInspirations:updateDesignInspiration":
          return await updateDesignInspiration._handler(mutationCtx as never, args as never);
        case "tags:getOrCreateTags":
          return await getOrCreateTags._handler(mutationCtx as never, args as never);
        case "designSaveTemplates:upsertDesignSaveTemplate":
          return await upsertDesignSaveTemplate._handler(mutationCtx as never, args as never);
        default:
          throw new Error(`Unknown mutation reference: ${getFunctionName(reference)}`);
      }
    },
    runQuery: async (reference: object, args: unknown) => {
      switch (getFunctionName(reference)) {
        case "designInspirations:getDesignInspiration":
          return await getDesignInspiration._handler(queryCtx as never, args as never);
        case "designInspirations:getDesignInspirationIdForSourceFingerprint":
          return await getDesignInspirationIdForSourceFingerprint._handler(
            queryCtx as never,
            args as never,
          );
        case "designSaveTemplates:getDesignSaveTemplateByKey":
          return await getDesignSaveTemplateByKey._handler(queryCtx as never, args as never);
        default:
          throw new Error(`Unknown query reference: ${getFunctionName(reference)}`);
      }
    },
  };

  return { ...harness, ctx };
};

describe("design extension save backend", () => {
  let harness: ReturnType<typeof createActionHarness>;
  let originalFetch: typeof globalThis.fetch;
  let originalR2PublicBaseUrl: string | undefined;

  beforeEach(() => {
    harness = createActionHarness();
    originalFetch = globalThis.fetch;
    originalR2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = "https://r2.test";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalR2PublicBaseUrl === undefined) {
      delete process.env.R2_PUBLIC_BASE_URL;
    } else {
      process.env.R2_PUBLIC_BASE_URL = originalR2PublicBaseUrl;
    }
  });

  test("page capture creates a design inspiration with preview asset", async () => {
    await upsertDesignSaveTemplate._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      key: "utility-site",
      label: "Utility site",
      defaults: {
        saveIntent: "utility",
        captureKind: "website",
        tagNames: ["gsap"],
      },
    });

    const result = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "page",
        sourceUrl: "https://example.com/library/scroll-trigger",
        sourceTitle: "ScrollTrigger Reference",
        title: "ScrollTrigger Reference",
        screenshotBase64: ONE_BY_ONE_PNG,
        screenshotContentType: "image/png",
      },
      captureKind: "website",
      saveIntent: "utility",
      tagNames: ["gsap", "scroll"],
      userNote: "Pinned scroll examples",
      templateKey: "utility-site",
    });

    expect(result.created).toBeTrue();

    const design = await getDesignInspiration._handler(harness.ctx as never, {
      id: result.designInspirationId,
      ownerUserId: "278674008",
    });
    expect(design?.assetId).toBe(result.assetId);
    expect(design?.captureKind).toBe("website");
    expect(design?.saveIntent).toBe("utility");
    expect(design?.sourceTitle).toBe("ScrollTrigger Reference");
    expect(design?.userNote).toBe("Pinned scroll examples");
    expect(design?.templateKey).toBe("utility-site");
    expect(design?.sourceFingerprint).toBe(
      "website:https://example.com/library/scroll-trigger",
    );

    const asset = await harness.db.get<Record<string, unknown>>(result.assetId);
    expect(asset?.r2Key).toBeDefined();
    expect(asset?.thumbR2Key).toBeDefined();
    expect(asset?.pillar).toBe("designs");
  });

  test("source fingerprint dedupes repeated saves and merges tag metadata", async () => {
    const first = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "page",
        sourceUrl: "https://example.com/blocks/card-grid?utm_source=x",
        sourceTitle: "Card Grid",
        title: "Card Grid",
        screenshotBase64: ONE_BY_ONE_PNG,
        screenshotContentType: "image/png",
      },
      captureKind: "component",
      saveIntent: "component",
      tagNames: ["cards"],
      userNote: "first note",
    });

    const second = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "telegram:278674008",
      capture: {
        mode: "page",
        sourceUrl: "https://example.com/blocks/card-grid#section",
        sourceTitle: "Card Grid",
        title: "Card Grid",
        screenshotBase64: ONE_BY_ONE_PNG,
        screenshotContentType: "image/png",
      },
      captureKind: "component",
      saveIntent: "component",
      tagNames: ["layout"],
      userNote: "updated note",
    });

    expect(second.created).toBeFalse();
    expect(second.designInspirationId).toBe(first.designInspirationId);
    expect(harness.db.getTableDocs("assets")).toHaveLength(1);

    const design = await getDesignInspiration._handler(harness.ctx as never, {
      id: first.designInspirationId,
      ownerUserId: "278674008",
    });
    expect(design?.userNote).toBe("updated note");
    expect(design?.tagIds).toHaveLength(2);
    expect(design?.sourceFingerprint).toBe(
      "component:https://example.com/blocks/card-grid",
    );
  });

  test("image capture stores preview and design gallery filters hydrate preview urls", async () => {
    const result = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "image",
        imageUrl: "https://cdn.example.com/reference/grid.png",
        sourceUrl: "https://example.com/tutorials/grid-systems",
        sourceTitle: "Grid systems tutorial",
        title: "Grid systems tutorial",
        imageBase64: ONE_BY_ONE_PNG,
        imageContentType: "image/png",
      },
      captureKind: "image",
      saveIntent: "inspiration",
      tagNames: ["grid", "layout"],
      userNote: "reference image",
      platform: "web",
      workflowType: "page_prompt",
    });

    const results = await listDesignGalleryEntries._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      captureKind: "image",
      saveIntent: "inspiration",
      platform: "web",
      workflowType: "page_prompt",
      search: "layout",
      requireAsset: true,
      limit: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe(result.designInspirationId);
    expect(results[0]?.previewUrl).toContain("https://r2.test/");
    expect(results[0]?.previewThumbUrl).toContain("https://r2.test/");
    expect(results[0]?.tagNames).toEqual(["grid", "layout"]);
    expect(results[0]?.sourceDomain).toBe("example.com");
  });

  test("template defaults fill missing save metadata and tags", async () => {
    await upsertDesignSaveTemplate._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      key: "component-library",
      label: "Component library",
      defaults: {
        captureKind: "component",
        saveIntent: "component",
        inspirationType: "component",
        platform: "web",
        workflowType: "component_prompt",
        tagNames: ["components", "library"],
      },
    });

    const result = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "page",
        sourceUrl: "https://example.com/ui/cards",
        sourceTitle: "UI Cards",
        screenshotBase64: ONE_BY_ONE_PNG,
        screenshotContentType: "image/png",
      },
      platform: undefined,
      workflowType: undefined,
      templateKey: "component-library",
      tagNames: ["cards"],
    });

    const design = await getDesignInspiration._handler(harness.ctx as never, {
      id: result.designInspirationId,
      ownerUserId: "278674008",
    });
    expect(design?.captureKind).toBe("component");
    expect(design?.saveIntent).toBe("component");
    expect(design?.inspirationType).toBe("component");
    expect(design?.platform).toBe("web");
    expect(design?.workflowType).toBe("component_prompt");
    expect(design?.templateKey).toBe("component-library");
    expect(design?.tagIds).toHaveLength(3);
  });

  test("same image can be saved from different source pages", async () => {
    const first = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "image",
        imageUrl: "https://cdn.example.com/reference/grid.png",
        sourceUrl: "https://example.com/tutorials/grid-systems",
        imageBase64: ONE_BY_ONE_PNG,
        imageContentType: "image/png",
      },
      captureKind: "image",
    });

    const second = await saveFromExtension._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      capture: {
        mode: "image",
        imageUrl: "https://cdn.example.com/reference/grid.png",
        sourceUrl: "https://example.com/inspiration/editorial-grid",
        imageBase64: ONE_BY_ONE_PNG,
        imageContentType: "image/png",
      },
      captureKind: "image",
    });

    expect(second.created).toBeTrue();
    expect(second.designInspirationId).not.toBe(first.designInspirationId);
    expect(harness.db.getTableDocs("designInspirations")).toHaveLength(2);
  });
});
