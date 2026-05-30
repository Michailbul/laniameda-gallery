import { describe, expect, test } from "bun:test";
import {
  archiveUserTag,
  listUserTags,
  upsertUserTag,
} from "@/convex/userTags";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("user tags", () => {
  test("creates and archives owner-customized tags", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;

    const result = await upsertUserTag._handler(ctx, {
      ownerUserId: "user-1",
      name: "Editorial Portrait",
      category: "style",
      pillar: "creators",
      color: "#123456",
    });

    expect(result.created).toBe(true);

    const active = await listUserTags._handler(ctx, {
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

    await archiveUserTag._handler(ctx, {
      ownerUserId: "user-1",
      name: "Editorial Portrait",
    });

    const afterArchive = await listUserTags._handler(ctx, {
      ownerUserId: "user-1",
    });
    expect(afterArchive).toHaveLength(0);

    const archived = await listUserTags._handler(ctx, {
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

    const tags = await listUserTags._handler(ctx, {
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
});
