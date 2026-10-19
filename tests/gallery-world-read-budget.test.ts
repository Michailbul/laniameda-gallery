import { describe, expect, test } from "bun:test";

import {
  collectAssetsForFolder,
  collectAssetsForFolderTree,
  FOLDER_MEMBER_READ_CAP,
  listGalleryAssets,
  QUERY_READ_BUDGET,
} from "../convex/assets";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

// Convex fails a query past 4,096 reads, counting each newly read document
// (db.get) and each index range (db.query) once. This meter counts the same
// way on the mock database and fails the same way.
const CONVEX_READ_LIMIT = 4096;

type Harness = ReturnType<typeof createMockConvexMutationCtx>;

const meterReads = (h: Harness) => {
  const docs = new Set<string>();
  let ranges = 0;
  const check = () => {
    if (docs.size + ranges > CONVEX_READ_LIMIT) {
      throw new Error(`Too many reads in a single function execution (limit: ${CONVEX_READ_LIMIT})`);
    }
  };
  const get = h.db.get.bind(h.db);
  const query = h.db.query.bind(h.db);
  h.db.get = (async (id: string) => {
    docs.add(id);
    check();
    return await get(id);
  }) as typeof h.db.get;
  h.db.query = ((table: string) => {
    ranges += 1;
    check();
    return query(table);
  }) as typeof h.db.query;
  return () => docs.size + ranges;
};

const OWNER = "278674008";

// A world shaped like DEAR ANNETE after the ART DECO split: a root, 32
// shelves, every piece filed on the root and on two shelves, its own prompt,
// a few shared tags. 1,700 pieces make 5,100 memberships.
const buildWorld = async (h: Harness, pieces = 1700, shelves = 32) => {
  const tags = [];
  for (let i = 0; i < 24; i++) tags.push(await h.db.insert("tags", { name: `Tag ${i}` }));
  const root = await h.db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", createdAt: 0 });
  const children = [];
  for (let i = 0; i < shelves; i++) {
    children.push(await h.db.insert("folders", {
      ownerUserId: OWNER, name: `Shelf ${i}`, parentFolderId: root, createdAt: 0,
    }));
  }
  const assets: { _id: string; createdAt: number; tagIds: string[] }[] = [];
  let memberships = 0;
  for (let i = 0; i < pieces; i++) {
    const createdAt = 1_000 + i;
    const promptId = await h.db.insert("prompts", { ownerUserId: OWNER, text: `prompt ${i}`, tagIds: [], createdAt });
    const tagIds = [tags[i % tags.length]!, tags[(i * 7) % tags.length]!];
    const assetId = await h.db.insert("assets", {
      ownerUserId: OWNER, kind: "image", promptId, tagIds, folderId: root, createdAt,
      r2Key: `assets/${i}.webp`, thumbR2Key: `thumbs/${i}.webp`,
    });
    for (const folderId of [root, children[i % shelves]!, children[(i + 5) % shelves]!]) {
      await h.db.insert("assetFolders", { ownerUserId: OWNER, assetId, folderId, createdAt });
      memberships += 1;
    }
    assets.push({ _id: assetId, createdAt, tagIds });
  }
  const newestFirst = [...assets].sort((a, b) => b.createdAt - a.createdAt);
  return { root, children, tags, memberships, newestFirst };
};

const ids = (rows: { _id: string }[]) => rows.map((row) => row._id);

describe("world reads stay under Convex's read limit", () => {
  test("a flattened world view returns its newest pieces within the budget", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h);
    expect(world.memberships).toBeGreaterThan(CONVEX_READ_LIMIT);
    const reads = meterReads(h);

    const rows = await callAsOwner(listGalleryAssets)(h.ctx, {
      ownerUserId: OWNER, folderId: world.root, includeDescendants: true, limit: 2000,
    });

    expect(reads()).toBeLessThanOrEqual(QUERY_READ_BUDGET);
    expect(rows.length).toBeGreaterThan(800);
    // The newest pieces, newest first, with no gaps and no duplicates.
    expect(ids(rows)).toEqual(ids(world.newestFirst.slice(0, rows.length)));
    expect(rows[0]!.promptText).toBe("prompt 1699");
    expect(rows[0]!.tagNames.length).toBe(2);
  });

  test("the usual 600-piece world view with the skills exclusion fills its page", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h);
    const excluded = world.tags[3]!;
    const reads = meterReads(h);

    const rows = await callAsOwner(listGalleryAssets)(h.ctx, {
      ownerUserId: OWNER, folderId: world.root, includeDescendants: true,
      excludeTagIds: [excluded], limit: 600,
    });

    expect(reads()).toBeLessThanOrEqual(QUERY_READ_BUDGET);
    const expected = world.newestFirst.filter((asset) => !asset.tagIds.includes(excluded)).slice(0, 600);
    expect(ids(rows)).toEqual(ids(expected));
  });

  test("a search inside a big world checks only what the budget pays for", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h);
    const reads = meterReads(h);

    const rows = await callAsOwner(listGalleryAssets)(h.ctx, {
      ownerUserId: OWNER, folderId: world.root, includeDescendants: true,
      search: "prompt 16", limit: 600,
    });

    expect(reads()).toBeLessThanOrEqual(QUERY_READ_BUDGET);
    // "prompt 16xx" are the newest hundred pieces. The old "prompt 16" lies
    // past what one read can check, so it is left out rather than failing.
    expect(rows.length).toBe(100);
    expect(rows[0]!.promptText).toBe("prompt 1699");
  });

  test("a search across the whole vault is bounded too", async () => {
    const h = createMockConvexMutationCtx();
    for (let i = 0; i < 5000; i++) {
      const promptId = await h.db.insert("prompts", { ownerUserId: OWNER, text: `vault ${i}`, tagIds: [], createdAt: i });
      await h.db.insert("assets", { ownerUserId: OWNER, kind: "image", promptId, tagIds: [], createdAt: i });
    }
    const reads = meterReads(h);

    const rows = await callAsOwner(listGalleryAssets)(h.ctx, {
      ownerUserId: OWNER, search: "vault 49", limit: 600,
    });

    expect(reads()).toBeLessThanOrEqual(QUERY_READ_BUDGET);
    // vault 4900..4999 are among the newest pieces it can check.
    expect(rows.length).toBe(100);
    expect(rows[0]!.promptText).toBe("vault 4999");
  });

  test("folder helpers fetch at most the cap, merged across the world, newest first", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h, 2600, 8);
    const reads = meterReads(h);

    const single = await collectAssetsForFolder(h.ctx as never, [OWNER, `telegram:${OWNER}`], world.root as never, 5000);
    expect(single.length).toBe(FOLDER_MEMBER_READ_CAP);
    expect(ids(single)).toEqual(ids(world.newestFirst.slice(0, FOLDER_MEMBER_READ_CAP)));
    expect(reads()).toBeLessThanOrEqual(FOLDER_MEMBER_READ_CAP + 10);
  });

  test("a world tree read counts distinct pieces, not memberships", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h, 1200, 32);
    const reads = meterReads(h);

    const tree = await collectAssetsForFolderTree(h.ctx as never, [OWNER, `telegram:${OWNER}`], world.root as never, 300);
    expect(ids(tree)).toEqual(ids(world.newestFirst.slice(0, 300)));
    // 300 pieces + the children read + 33 folders x 2 owner spellings.
    expect(reads()).toBeLessThanOrEqual(300 + 1 + 33 * 2);
  });

  test("a legacy owner spelling still merges into a world read", async () => {
    const h = createMockConvexMutationCtx();
    const world = await buildWorld(h, 50, 4);
    const legacy = await h.db.insert("assets", {
      ownerUserId: `telegram:${OWNER}`, kind: "image", tagIds: [], createdAt: 99_999,
    });
    await h.db.insert("assetFolders", {
      ownerUserId: `telegram:${OWNER}`, assetId: legacy, folderId: world.children[1]!, createdAt: 99_999,
    });

    const rows = await callAsOwner(listGalleryAssets)(h.ctx, {
      ownerUserId: OWNER, folderId: world.root, includeDescendants: true, limit: 600,
    });
    expect(rows.length).toBe(51);
    expect(rows[0]!._id).toBe(legacy);
  });
});
