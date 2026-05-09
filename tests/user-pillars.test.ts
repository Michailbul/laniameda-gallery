import { describe, expect, test } from "bun:test";
import {
  archivePillar,
  listPillars,
  upsertPillar,
} from "@/convex/userPillars";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("user pillars", () => {
  test("lists default pillars and custom boards for a user", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;

    await upsertPillar._handler(ctx, {
      ownerUserId: "user-1",
      label: "Inspirations",
      color: "#abcdef",
    });

    const pillars = await listPillars._handler(ctx, {
      ownerUserId: "user-1",
    });

    expect(pillars.map((pillar) => pillar.key)).toContain("creators");
    expect(pillars.map((pillar) => pillar.key)).toContain("cars");
    expect(pillars.map((pillar) => pillar.key)).toContain("inspirations");
    expect(
      pillars.find((pillar) => pillar.key === "inspirations")?.color,
    ).toBe("#abcdef");
  });

  test("archives only custom pillars", async () => {
    const harness = createMockConvexMutationCtx();
    const ctx = harness.ctx as never;

    await upsertPillar._handler(ctx, {
      ownerUserId: "user-1",
      label: "Moodboard",
    });
    await archivePillar._handler(ctx, {
      ownerUserId: "user-1",
      key: "moodboard",
    });

    const active = await listPillars._handler(ctx, {
      ownerUserId: "user-1",
    });
    expect(active.some((pillar) => pillar.key === "moodboard")).toBe(false);

    await expect(
      archivePillar._handler(ctx, {
        ownerUserId: "user-1",
        key: "creators",
      }),
    ).rejects.toThrow("Default pillars cannot be archived.");
  });
});
