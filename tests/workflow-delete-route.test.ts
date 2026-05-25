import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  user: { ownerUserId: "telegram:278674008" },
  mutationCalls: [] as Array<{ args: Record<string, unknown> }>,
};

const routePath = new URL("../app/api/workflows/[id]/route.ts", import.meta.url)
  .pathname;
const originalAdminUserIds = process.env.CURATION_ADMIN_USER_IDS;

mock.module("@/lib/server/app-user", () => ({
  requireAppUser: async () => state.user,
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    mutation: async (_reference: unknown, args: Record<string, unknown>) => {
      state.mutationCalls.push({ args });
      return null;
    },
  }),
}));

describe("DELETE /api/workflows/[id]", () => {
  beforeEach(() => {
    state.user = { ownerUserId: "telegram:278674008" };
    state.mutationCalls = [];
    process.env.CURATION_ADMIN_USER_IDS = "telegram:278674008";
  });

  afterEach(() => {
    if (originalAdminUserIds === undefined) {
      delete process.env.CURATION_ADMIN_USER_IDS;
      return;
    }
    process.env.CURATION_ADMIN_USER_IDS = originalAdminUserIds;
  });

  test("deletes the workflow for the authenticated admin owner", async () => {
    const { DELETE } = await import(routePath);

    const response = await DELETE(
      new Request("http://localhost/api/workflows/workflows:1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workflows:1" }) },
    );

    expect(response.status).toBe(200);
    expect(state.mutationCalls).toEqual([
      {
        args: {
          id: "workflows:1",
          ownerUserId: "telegram:278674008",
        },
      },
    ]);
    expect(await response.json()).toEqual({
      deleted: true,
      workflowId: "workflows:1",
    });
  });

  test("rejects non-admin users", async () => {
    process.env.CURATION_ADMIN_USER_IDS = "telegram:admin";
    const { DELETE } = await import(routePath);

    const response = await DELETE(
      new Request("http://localhost/api/workflows/workflows:1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workflows:1" }) },
    );

    expect(response.status).toBe(403);
    expect(state.mutationCalls).toHaveLength(0);
  });
});
