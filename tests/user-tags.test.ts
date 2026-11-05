import { describe, expect, test } from "bun:test";
import {
  archiveUserTag,
  listUserTags,
  listUserTagsPage,
  upsertUserTag,
} from "@/convex/userTags";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

describe("user tags", () => {
  test("creates and archives owner-customized tags", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;

    const result = await callAsOwner(upsertUserTag)(ctx, {
      ownerUserId: "user-1",
      name: "Editorial Portrait",
      category: "style",
      pillar: "creators",
      color: "#123456",
    });

    expect(result.created).toBe(true);

    const active = await callAsOwner(listUserTags)(ctx, {
      ownerUserId: "user-1",
    });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      tagId: result.tagId,
      label: "Editorial Portrait",
      category: "style",
      pillar: "creators",
      color: "#123456",
      isCustomized: true,
    });

    await callAsOwner(archiveUserTag)(ctx, {
      ownerUserId: "user-1",
      name: "Editorial Portrait",
    });

    const afterArchive = await callAsOwner(listUserTags)(ctx, {
      ownerUserId: "user-1",
    });
    expect(afterArchive).toHaveLength(0);

    const archived = await callAsOwner(listUserTags)(ctx, {
      ownerUserId: "user-1",
      includeArchived: true,
    });
    expect(archived[0]?.archivedAt).toBeNumber();
  });

  test("includes tags used by owner content even before customization", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;

    const tagId = await harness.db.insert("tags", {
      name: "Moody",
      normalized: "moody",
      usageCount: 1,
      category: "style",
      pillar: "creators",
      source: "agent",
    });
    await harness.db.insert("assets", {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [tagId],
      pillar: "creators",
      createdAt: Date.now(),
    });

    const tags = await callAsOwner(listUserTags)(ctx, {
      ownerUserId: "user-1",
    });

    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      tagId,
      label: "Moody",
      usageCount: 1,
      isCustomized: false,
    });
  });

  test("the agent page filters, sorts by usage, pages and projects slim rows", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;
    const insertTag = (name: string, category: string, uses: number) => harness.db.insert("tags", { name, normalized: name.toLowerCase(), usageCount: uses, category, source: "agent" });
    const [golden, cinematic, street] = await Promise.all([insertTag("golden-hour", "lighting", 2), insertTag("cinematic", "style", 3), insertTag("street", "environment", 1)]);
    const uses: Record<string, number> = { [golden]: 2, [cinematic]: 3, [street]: 1 };
    for (const [tagId, count] of Object.entries(uses)) {
      for (let index = 0; index < count; index += 1) {
        await harness.db.insert("assets", { ownerUserId: "user-1", kind: "image", tagIds: [tagId], createdAt: Date.now() + index });
      }
    }
    await callAsOwner(upsertUserTag)(ctx, { ownerUserId: "user-1", name: "cinematic", label: "Cinematic", description: "film look", category: "style" });

    const all = await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1" });
    expect(all).toMatchObject({ count: 3, total: 3, limit: 100, cursor: null, isDone: true });
    expect(all.tags.map((tag) => tag.name)).toEqual(["cinematic", "golden-hour", "street"]);
    expect(all.tags[0]).toEqual({ name: "cinematic", label: "Cinematic", category: "style", description: "film look", usageCount: 3, customized: true });
    expect(all.tags[1]).toEqual({ name: "golden-hour", category: "lighting", usageCount: 2 });

    expect((await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", search: "gold" })).tags.map((tag) => tag.name)).toEqual(["golden-hour"]);
    expect((await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", category: "environment" })).tags.map((tag) => tag.name)).toEqual(["street"]);
    expect((await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", minUsage: 2 })).count).toBe(2);

    const first = await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", limit: 2 });
    expect(first).toMatchObject({ count: 2, total: 3, cursor: "2", isDone: false });
    const second = await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", limit: 2, cursor: first.cursor });
    expect(second).toMatchObject({ count: 1, isDone: true, cursor: null });
    expect(second.tags[0]!.name).toBe("street");

    const full = await callAsOwner(listUserTagsPage)(ctx, { ownerUserId: "user-1", fields: "full", limit: 1 });
    expect(full.tags[0]).toMatchObject({ name: "cinematic", tagId: cinematic, isCustomized: true, usageCount: 3, sortOrder: expect.any(Number) });
  });
});
