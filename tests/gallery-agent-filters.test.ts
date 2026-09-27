import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { listGalleryAssets } from "../convex/assets";
import { addTagAliases, getOrCreateTagsWithMetadata } from "../convex/tags";
import {
  buildCreateArgs,
  buildUpdateArgs,
  canonicalTagKey,
  collectTagNames,
} from "../skills/laniameda-gallery/scripts/ingest";
import {
  handleRefs,
  handleSearch,
  handleSimilar,
  handleSources,
} from "../skills/laniameda-gallery/scripts/query";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const OWNER = "278674008";

describe("tag aliases", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  const insertTag = async (name: string, aliases?: string[]) =>
    await harness.db.insert("tags", {
      name,
      normalized: name.toLowerCase(),
      canonicalKey: canonicalTagKey(name),
      usageCount: 1,
      ...(aliases ? { aliases } : {}),
    });

  test("an alias resolves to its canonical tag; a real tag name wins", async () => {
    const cinematic = await insertTag("cinematic", ["filmic"]);
    const moody = await insertTag("moody", ["cinematic"]);
    const ids = await getOrCreateTagsWithMetadata._handler(harness.ctx as never, {
      tags: [{ name: "Filmic" }, { name: "cinematic" }],
    });
    expect(ids).toEqual([cinematic, cinematic]);
    expect(ids).not.toContain(moody);
  });

  test("addTagAliases ignores aliases that are real tags", async () => {
    const cinematic = await insertTag("cinematic");
    await insertTag("moody");
    const result = await addTagAliases._handler(harness.ctx as never, {
      name: "Cinematic",
      aliases: ["filmic", "film look", "moody", "cinematic"],
    });
    expect(result.tagId).toBe(cinematic);
    expect(result.aliases).toEqual(["filmic", "film look"]);
    expect(result.ignoredExistingTags).toEqual(["moody"]);
  });
});

describe("listGalleryAssets named filters", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    harness = createMockConvexMutationCtx();
    const tag = async (name: string) =>
      await harness.db.insert("tags", {
        name,
        normalized: name.toLowerCase(),
        canonicalKey: canonicalTagKey(name),
        usageCount: 1,
      });
    const character = await tag("Characters");
    const location = await tag("location");
    const animation = await tag("animation");
    const x = await tag("x");
    const asset = async (tagIds: string[], createdAt: number, extra: Record<string, unknown> = {}) =>
      await harness.db.insert("assets", {
        ownerUserId: OWNER,
        kind: "image",
        sourceUrl: `https://example.com/${createdAt}.jpg`,
        tagIds,
        isPublic: false,
        createdAt,
        ...extra,
      });
    ids.animatedCharacter = await asset([character, animation, x], 300);
    ids.liveCharacter = await asset([character], 200, { starredAt: 5 });
    ids.location = await asset([location, x], 100);
  });

  const run = async (args: Record<string, unknown>) => {
    const ctx = { ...harness.ctx, storage: { getUrl: async () => null } };
    const results = await listGalleryAssets._handler(ctx as never, {
      ownerUserId: OWNER,
      limit: 20,
      ...args,
    } as never);
    return results.map((asset) => asset._id);
  };

  test("piece type matches the plural tag", async () => {
    expect(await run({ pieceType: "character" })).toEqual([
      ids.animatedCharacter,
      ids.liveCharacter,
    ]);
  });

  test("medium live-action excludes animation", async () => {
    expect(await run({ pieceType: "character", medium: "live-action" })).toEqual([
      ids.liveCharacter,
    ]);
  });

  test("tagNames require every tag; a missing tag returns nothing", async () => {
    expect(await run({ tagNames: ["X", "animation"] })).toEqual([ids.animatedCharacter]);
    expect(await run({ tagNames: ["does-not-exist"] })).toEqual([]);
  });

  test("onlyStarred and excludeTagNames", async () => {
    expect(await run({ onlyStarred: true })).toEqual([ids.liveCharacter]);
    expect(await run({ excludeTagNames: ["x"] })).toEqual([ids.liveCharacter]);
  });
});

describe("ingest script: agent fields", () => {
  test("create carries the agent description, source URL and primary collection", () => {
    const args = buildCreateArgs(
      {
        url: "https://pbs.twimg.com/media/abc?name=orig",
        agentDescription: "  Neon alley at night.  ",
        sourceUrl: "https://x.com/a/status/1",
        folderIds: ["folders:1", "folders:2"],
        tagNames: ["inspiration"],
      },
      OWNER,
    );
    expect(args.agentDescription).toBe("Neon alley at night.");
    expect(args.sourceUrl).toBe("https://x.com/a/status/1");
    expect(args.folderId).toBe("folders:1");
    expect(args.folderIds).toBeUndefined();
  });

  test("update passes agentDescription, including null to clear", () => {
    const args = buildUpdateArgs(
      { operation: "update", target: "asset", id: "assets:1", agentDescription: null },
      OWNER,
    );
    expect(args).toHaveProperty("agentDescription", null);
  });

  test("collects tag names for the new-tag warning", () => {
    expect(
      collectTagNames([
        { url: "u", tagNames: ["a"], typedTags: [{ name: "b" }] },
        { operation: "update", target: "asset", id: "assets:1", tagNames: ["c"] },
      ]),
    ).toEqual(["a", "b", "c"]);
    expect(canonicalTagKey("#Golden_Hour!")).toBe("golden hour");
  });
});

describe("query script: new actions", () => {
  const capture = () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!init?.body) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const path = body.path as string;
      const value =
        path === "assets:findAssetsBySourceUrls"
          ? [
              { sourceUrl: "https://x.com/a/status/1", assetIds: ["assets:1"] },
              { sourceUrl: "https://x.com/a/status/2", assetIds: [] },
            ]
          : [
              {
                _id: "assets:9",
                kind: "image",
                fileName: "nine.png",
                agentDescription: "Clay character waving.",
                tagNames: ["character"],
                url: "https://cdn.example/nine.png",
                starredAt: 3,
                score: 0.9,
                textScore: 0.7,
              },
            ];
      return new Response(JSON.stringify({ status: "success", value }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return {
      calls,
      runtime: { convexUrl: "https://convex.example", ownerUserId: OWNER, fetchImpl },
    };
  };

  test("search forwards mode and named filters and returns agent fields", async () => {
    const { calls, runtime } = capture();
    const result = await handleSearch(
      {
        action: "search",
        query: "clay character",
        mode: "hybrid",
        pieceType: "character",
        medium: "animation",
        tagNames: ["x"],
        onlyStarred: true,
      },
      runtime,
    );
    expect(calls[0]?.body.path).toBe("semanticSearch:searchAssets");
    expect(calls[0]?.body.args).toMatchObject({
      mode: "hybrid",
      pieceType: "character",
      medium: "animation",
      tagNames: ["x"],
      onlyStarred: true,
    });
    expect(result.results[0]).toMatchObject({
      agentDescription: "Clay character waving.",
      starred: true,
      textScore: 0.7,
    });
  });

  test("similar resolves a typed asset id", async () => {
    const { calls, runtime } = capture();
    await handleSimilar({ action: "similar", assetId: "asset:abc", mode: "visual" }, runtime);
    expect(calls[0]?.body).toMatchObject({
      path: "semanticSearch:findSimilarAssets",
      args: { assetId: "abc", mode: "visual", scope: "mine" },
    });
  });

  test("sources splits saved from not saved", async () => {
    const { runtime } = capture();
    const result = await handleSources(
      { action: "sources", sourceUrls: ["https://x.com/a/status/1", "https://x.com/a/status/2"] },
      runtime,
    );
    expect(result.alreadySaved).toBe(1);
    expect(result.notSaved).toEqual(["https://x.com/a/status/2"]);
  });

  test("refs downloads matches and writes a manifest", async () => {
    const { runtime } = capture();
    const outDir = `${process.env.TMPDIR ?? "/tmp"}/gallery-refs-test-${Date.now()}`;
    const result = await handleRefs(
      { action: "refs", query: "clay character", limit: 3, outDir },
      runtime,
    );
    expect(result.count).toBe(1);
    expect(result.refs[0]?.savedPath).toBe(join(outDir, "assets:9.png"));
    const markdown = await Bun.file(result.markdownPath).text();
    expect(markdown).toContain("Clay character waving.");
  });
});
