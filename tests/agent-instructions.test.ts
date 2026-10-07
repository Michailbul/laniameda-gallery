import { describe, expect, test } from "bun:test";
import { getResource, saveResource } from "../convex/agentInstructions";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const input = { ownerUserId: "telegram:42", resourcePath: "references/worlds.md", content: "# Private filing rules\n\nResolve worlds from live collections.", version: "1.5.0" };

describe("private agent instruction resources", () => {
  test("keeps exact owner data, resolves aliases and deduplicates exact retries", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const first = await callAsOwner(saveResource)(ctx, input);
    expect(first.created).toBe(true);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await callAsOwner(saveResource)(ctx, input)).toEqual({ ...first, created: false });
    const resource = await callAsOwner(getResource)(ctx, { ownerUserId: "42", resourcePath: input.resourcePath });
    expect(resource?.content).toBe(input.content);
    expect(resource?.sha256).toBe(first.sha256);
    expect(await callAsOwner(getResource)(ctx, { ownerUserId: "other", resourcePath: input.resourcePath })).toBeNull();
    expect(db.getTableDocs("agentInstructions")).toHaveLength(1);
  });

  test("requires the last-read hash when changing existing policy", async () => {
    const { ctx } = createMockConvexMutationCtx();
    const first = await callAsOwner(saveResource)(ctx, input);
    await expect(callAsOwner(saveResource)(ctx, { ...input, content: "Changed without a baseline" })).rejects.toThrow("Instructions changed");
    const next = await callAsOwner(saveResource)(ctx, { ...input, content: "Updated rule", expectedSha256: first.sha256 });
    expect(next.created).toBe(false);
    expect(next.sha256).not.toBe(first.sha256);
    await expect(callAsOwner(saveResource)(ctx, { ...input, content: "Stale rule", expectedSha256: first.sha256 })).rejects.toThrow("Instructions changed");
  });

  test("unsigned and foreign actors cannot read or change policy", async () => {
    const { ctx } = createMockConvexMutationCtx();
    const previous = process.env.LEGACY_OWNER_ARG_AUTH;
    process.env.LEGACY_OWNER_ARG_AUTH = "true";
    try {
      const unsigned = { ...ctx, auth: { getUserIdentity: async () => null } };
      const foreign = { ...ctx, auth: { getUserIdentity: async () => ({ subject: "intruder" }) } };
      await expect(callAsOwner(getResource)(unsigned, input)).rejects.toThrow("Not authenticated");
      await expect(callAsOwner(saveResource)(unsigned, input)).rejects.toThrow("Not authenticated");
      await expect(callAsOwner(saveResource)(foreign, input)).rejects.toThrow("does not match");
    } finally {
      if (previous === undefined) delete process.env.LEGACY_OWNER_ARG_AUTH;
      else process.env.LEGACY_OWNER_ARG_AUTH = previous;
    }
  });
});
