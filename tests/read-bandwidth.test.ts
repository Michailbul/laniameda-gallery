import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { listMenuFilters, listPublicMenuFilters } from "../convex/menuFilters";
import { getShowcaseHome } from "../convex/showcase";
import { listSkills } from "../convex/skills";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

// Convex bills database bandwidth by the documents a function reads. These
// pin the Nov 2026 cuts: the same cards, counts and reel, read from fewer and
// smaller rows. The mock counts every document a query reads (see
// tests/helpers/mock-convex-context.ts).

const OWNER = "278674008";

describe("skills:listSkills cards", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("a card keeps its fields and stops reading step frames once its previews are full", async () => {
    const tagId = await harness.db.insert("tags", { name: "stop-motion", normalized: "stop-motion", canonicalKey: "stopmotion", usageCount: 1 });
    const folderId = await harness.db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete", createdAt: 1 });
    const skillId = await harness.db.insert("skills", {
      ownerUserId: OWNER, title: "Torn paper reveal", description: "Paper tears open on the next shot.",
      body: "## Steps\n".padEnd(20_000, "x"), tagIds: [tagId], stepCount: 2, createdAt: 1, updatedAt: 1,
    });
    await harness.db.insert("skillFolders", { ownerUserId: OWNER, skillId, folderId, createdAt: 1 });
    for (const [stepOrder, modelName] of [[0, "midjourney v8.2"], [1, "seedance 2"]] as const) {
      const promptId = await harness.db.insert("prompts", {
        ownerUserId: OWNER, text: `step ${stepOrder}`, tagIds: [], skillId, stepOrder, modelName, createdAt: 1,
      });
      for (let index = 0; index < 40; index += 1) {
        await harness.db.insert("assets", {
          ownerUserId: OWNER, kind: "image", promptId, tagIds: [], isPublic: false,
          sourceUrl: `https://example.com/${stepOrder}-${index}.png`, width: 800, height: 1000, createdAt: 10 + index,
        });
      }
    }

    harness.db.resetReads();
    const [card] = await callAsOwner(listSkills)(harness.ctx, { ownerUserId: OWNER, previewLimit: 8, slim: true });

    expect(card).toMatchObject({
      _id: skillId, title: "Torn paper reveal", description: "Paper tears open on the next shot.",
      tagNames: ["stop-motion"], folderIds: [folderId], modelNames: ["midjourney v8.2", "seedance 2"], stepCount: 2,
    });
    expect(card.previewImages).toHaveLength(8);
    expect(card.previewImages[0]).toMatchObject({ kind: "image", url: "https://example.com/0-0.png", width: 800, height: 1000 });
    // Eight frames shown, eight read: not all 80 of the skill's frames.
    expect(harness.db.reads.assets?.docs).toBe(8);
    // The skill row (with its 20 KB body) is read once, not again for previews.
    expect(harness.db.reads.skills?.docs).toBe(1);
    // Steps are read once and shared by model names and previews.
    expect(harness.db.reads.prompts?.docs).toBe(2);
  });
});

describe("menu filter counts", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  let previousOwner: string | undefined;
  beforeEach(() => {
    previousOwner = process.env.SHOWCASE_OWNER_USER_ID;
    process.env.SHOWCASE_OWNER_USER_ID = OWNER;
    harness = createMockConvexMutationCtx();
  });
  afterEach(() => {
    if (previousOwner === undefined) delete process.env.SHOWCASE_OWNER_USER_ID;
    else process.env.SHOWCASE_OWNER_USER_ID = previousOwner;
  });

  const seed = async () => {
    const characterTag = await harness.db.insert("tags", { name: "character", normalized: "character", canonicalKey: "character", usageCount: 0 });
    const folderId = await harness.db.insert("folders", { ownerUserId: OWNER, name: "Cast", normalizedName: "cast", createdAt: 1 });
    let members = 0;
    let publicMembers = 0;
    for (let index = 0; index < 30; index += 1) {
      const isPublic = index % 3 === 0;
      const tagIds = index % 2 === 0 ? [characterTag] : [];
      const assetId = await harness.db.insert("assets", {
        ownerUserId: OWNER, kind: "image", tagIds, isPublic, sourceUrl: `https://example.com/${index}.png`, createdAt: index + 1,
      });
      for (const tagId of tagIds) await harness.db.insert("assetTags", { assetId, tagId, createdAt: index + 1 });
      if (index < 20) {
        await harness.db.insert("assetFolders", { ownerUserId: OWNER, assetId, folderId, createdAt: index + 1 });
        members += 1;
        if (isPublic) publicMembers += 1;
      }
    }
    await harness.db.patch(folderId, { memberCount: members, publicMemberCount: publicMembers });
    await harness.db.insert("publicCollectionCountBackfill", { key: "v1", cursor: null, complete: true, scanned: 30 });
    await harness.db.insert("menuFilters", {
      ownerUserId: OWNER, label: "Characters", kind: "tag", tagNames: ["character"], sortOrder: 0, createdAt: 1, updatedAt: 1,
    });
    await harness.db.insert("menuFilters", {
      ownerUserId: OWNER, label: "Cast", kind: "collection", folderId, sortOrder: 1, createdAt: 1, updatedAt: 1,
    });
    return { characterTag, folderId };
  };

  test("the vault scope counts a collection from its stored member count", async () => {
    const { characterTag, folderId } = await seed();
    harness.db.resetReads();
    const pills = await callAsOwner(listMenuFilters)(harness.ctx, { ownerUserId: OWNER });
    expect(pills.map((pill: { label: string; count: number }) => [pill.label, pill.count])).toEqual([["Characters", 15], ["Cast", 20]]);
    expect(pills[0]).toMatchObject({ kind: "tag", tagIds: [characterTag] });
    expect(pills[1]).toMatchObject({ kind: "collection", folderId, tagIds: [] });
    expect(harness.db.reads.assetFolders).toBeUndefined();
    expect(harness.db.reads.assets).toBeUndefined();
  });

  test("the public scope reads the public slice once and no tag or membership links", async () => {
    await seed();
    harness.db.resetReads();
    const pills = await callAsOwner(listPublicMenuFilters)(harness.ctx, {});
    // Public assets are every third one: 10 of 30; 5 of them carry the tag
    // (even index), 7 of the first 20 sit in Cast.
    expect(pills.map((pill: { label: string; count: number }) => [pill.label, pill.count])).toEqual([["Characters", 5], ["Cast", 7]]);
    expect(harness.db.reads.assets?.docs).toBe(10);
    expect(harness.db.reads.assetTags).toBeUndefined();
    expect(harness.db.reads.assetFolders).toBeUndefined();
  });

  test("without stored counts the link rows still give the same numbers", async () => {
    const { folderId } = await seed();
    await harness.db.patch(folderId, { memberCount: undefined, publicMemberCount: undefined });
    const mine = await callAsOwner(listMenuFilters)(harness.ctx, { ownerUserId: OWNER });
    expect(mine.map((pill: { count: number }) => pill.count)).toEqual([15, 20]);
    const pub = await callAsOwner(listPublicMenuFilters)(harness.ctx, {});
    expect(pub.map((pill: { count: number }) => pill.count)).toEqual([5, 7]);
  });
});

describe("showcase:getShowcaseHome featured reel", () => {
  const owner = "showcase-test-owner";
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  let previousOwner: string | undefined;
  beforeEach(() => {
    previousOwner = process.env.SHOWCASE_OWNER_USER_ID;
    process.env.SHOWCASE_OWNER_USER_ID = owner;
    harness = createMockConvexMutationCtx();
  });
  afterEach(() => {
    if (previousOwner === undefined) delete process.env.SHOWCASE_OWNER_USER_ID;
    else process.env.SHOWCASE_OWNER_USER_ID = previousOwner;
  });

  test("the reel is the featured public pieces, owner order first, read without the rest", async () => {
    for (let index = 0; index < 200; index += 1) {
      await harness.db.insert("assets", {
        ownerUserId: owner, kind: "image", tagIds: [], isPublic: true, sourceUrl: `https://example.com/p${index}.png`, createdAt: 100 + index,
      });
    }
    const still = await harness.db.insert("assets", {
      ownerUserId: owner, kind: "image", tagIds: [], isPublic: true, isFeatured: true, sourceUrl: "https://example.com/still.png", createdAt: 50,
    });
    const film = await harness.db.insert("assets", {
      ownerUserId: owner, kind: "video", tagIds: [], isPublic: true, isFeatured: true, sourceUrl: "https://example.com/film.mp4", createdAt: 40,
    });
    const pinned = await harness.db.insert("assets", {
      ownerUserId: owner, kind: "image", tagIds: [], isPublic: true, isFeatured: true, orderPriority: 5,
      sourceUrl: "https://example.com/pinned.png", createdAt: 30,
    });
    // Featured but private, or someone else's: never on the public reel.
    await harness.db.insert("assets", {
      ownerUserId: owner, kind: "image", tagIds: [], isPublic: false, isFeatured: true, sourceUrl: "https://example.com/private.png", createdAt: 60,
    });
    await harness.db.insert("assets", {
      ownerUserId: "someone-else", kind: "image", tagIds: [], isPublic: true, isFeatured: true, sourceUrl: "https://example.com/other.png", createdAt: 70,
    });

    harness.db.resetReads();
    const home = await callAsOwner(getShowcaseHome)(harness.ctx as never, {});
    expect(home.featuredReel.map((entry: { asset: { _id: string } }) => entry.asset._id)).toEqual([pinned, film, still]);
    expect(home.featuredReel[0].asset).toMatchObject({ url: "https://example.com/pinned.png", isFeatured: true, isPublic: true });
    // The reel reads the four featured public rows, not all 204 public ones.
    // The rest is the legacy inspiration tail (no taste collection here),
    // which reads its own capped page of 120.
    expect(harness.db.reads.assets!.docs).toBe(4 + 120);
  });
});
