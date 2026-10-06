import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getShowcaseHome, getWorld } from '../convex/showcase';
import { createMockConvexMutationCtx } from './helpers/mock-convex-context';
import { callAsOwner } from './helpers/call-as-owner';

const owner = 'showcase-test-owner';
describe('published world routes', () => {
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
  const insertWorld = async (extra: Record<string, unknown> = {}) => harness.db.insert('folders', {
    ownerUserId: owner, name: 'CASSANDRA', normalizedName: 'cassandra',
    showcased: true, slug: 'cassandra', createdAt: 1, ...extra,
  });
  test('a flat published collection retains its world route and only published media', async () => {
    const folderId = await insertWorld();
    const publicId = await harness.db.insert('assets', {
      ownerUserId: owner, folderId, kind: 'image', tagIds: [], isPublic: true,
      sourceUrl: 'https://example.com/published.png', createdAt: 2,
    });
    const privateId = await harness.db.insert('assets', {
      ownerUserId: owner, folderId, kind: 'image', tagIds: [], isPublic: false,
      sourceUrl: 'https://example.com/private.png', createdAt: 3,
    });
    for (const assetId of [publicId, privateId]) {
      await harness.db.insert('assetFolders', {ownerUserId: owner, folderId, assetId, createdAt: 2});
    }
    const world = await callAsOwner(getWorld)(harness.ctx as never, {slug: 'cassandra'});
    expect(world?.name).toBe('CASSANDRA');
    expect(world?.sections.flatMap(section => section.assets.map(asset => asset._id))).toEqual([publicId]);
  });
  test('flat worlds appear in home cards and retain featured-piece world attribution', async () => {
    const folderId = await insertWorld();
    const assetId = await harness.db.insert('assets', {
      ownerUserId: owner, folderId, kind: 'video', tagIds: [], isPublic: true,
      isFeatured: true, sourceUrl: 'https://example.com/film.mp4', createdAt: 2,
    });
    await harness.db.insert('assetFolders', {ownerUserId: owner, folderId, assetId, createdAt: 2});
    const home = await callAsOwner(getShowcaseHome)(harness.ctx as never, {});
    expect(home.worlds.map(world => world.slug)).toEqual(['cassandra']);
    expect(home.worlds[0]?.count).toBe(1);
    expect(home.featuredReel.find(entry => entry.asset._id === assetId)?.world?.slug).toBe('cassandra');
  });
  test('unpublished and foreign-owner world addresses stay inaccessible', async () => {
    const id = await insertWorld({showcased: false});
    expect(await callAsOwner(getWorld)(harness.ctx as never, {slug: 'cassandra'})).toBeNull();
    await harness.db.patch(id, {showcased: true, ownerUserId: 'someone-else'});
    expect(await callAsOwner(getWorld)(harness.ctx as never, {slug: 'cassandra'})).toBeNull();
    expect((await callAsOwner(getShowcaseHome)(harness.ctx as never, {})).worlds).toHaveLength(0);
  });
  test('a nested collection cannot become a separate world through a legacy slug', async () => {
    const parentFolderId = await harness.db.insert('folders', {ownerUserId: owner, name: 'Parent', normalizedName: 'parent'});
    await insertWorld({parentFolderId});
    expect(await callAsOwner(getWorld)(harness.ctx as never, {slug: 'cassandra'})).toBeNull();
  });
});
