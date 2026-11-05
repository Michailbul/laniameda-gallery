import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = { calls: [] as Array<Record<string, unknown>> };

const routePath = new URL("../app/api/extension/comments/route.ts", import.meta.url)
  .pathname;

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.calls.push(payload);
      return { _id: "comment1", assetId: payload.assetId, body: payload.body };
    },
  }),
}));

const postComment = async (body: unknown, token = "test-extension-token") => {
  const { POST } = await import(routePath);
  return POST(
    new Request("http://localhost/api/extension/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-extension-token": token } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
};

describe("POST /api/extension/comments", () => {
  beforeEach(() => {
    state.calls = [];
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
    process.env.EXTENSION_API_TOKEN = "test-extension-token";
  });

  test("rejects a missing token", async () => {
    const response = await postComment({ assetId: "asset1", body: "keep" }, "");
    expect(response.status).toBe(401);
  });

  test("writes the comment as the owner", async () => {
    const response = await postComment({ assetId: "asset1", body: "  the bridge  " });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(state.calls[0]).toMatchObject({
      assetId: "asset1",
      body: "the bridge",
      author: "owner",
      ownerUserId: "telegram:278674008",
    });
  });

  test("rejects an empty comment", async () => {
    const response = await postComment({ assetId: "asset1", body: "   " });
    expect(response.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
