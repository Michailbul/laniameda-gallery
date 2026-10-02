import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  actionCalls: [] as Array<{ name: string; payload: Record<string, unknown> }>,
};

const routePath = new URL("../app/api/extension/x-post/route.ts", import.meta.url).pathname;

const getFunctionName = (reference: object) => {
  const [symbol] = Object.getOwnPropertySymbols(reference);
  return symbol
    ? ((reference as Record<PropertyKey, string | undefined>)[symbol] ?? "")
    : "";
};

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (reference: object, payload: Record<string, unknown>) => {
      state.actionCalls.push({ name: getFunctionName(reference), payload });
      return { bookmarkId: "bookmarks:1", assetId: "assets:1", created: true };
    },
  }),
}));

const post = (body: unknown, token = "test-extension-token") =>
  new Request("https://gallery.test/api/extension/x-post", {
    method: "POST",
    headers: { "content-type": "application/json", "x-extension-token": token },
    body: JSON.stringify(body),
  });

describe("POST /api/extension/x-post", () => {
  beforeEach(() => {
    state.actionCalls = [];
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
    process.env.EXTENSION_API_TOKEN = "test-extension-token";
  });

  test("forwards the post, preview, collections, tags and note to the save action", async () => {
    const { POST } = await import(routePath);
    const response = await POST(
      post({
        post: { url: "https://x.com/a/status/1840000000000000001", text: "hi" },
        preview: { base64: "AAAA", contentType: "image/png" },
        folderId: "folders:cars",
        folderIds: ["folders:cars", "folders:refs", 7],
        tagNames: [" cars ", "", 3],
        userNote: "why",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { bookmarkId: "bookmarks:1", assetId: "assets:1", created: true },
    });
    expect(state.actionCalls).toEqual([
      {
        name: "bookmarkSaves:saveXPostFromExtension",
        payload: {
          ownerUserId: "telegram:278674008",
          post: { url: "https://x.com/a/status/1840000000000000001", text: "hi" },
          preview: { base64: "AAAA", contentType: "image/png" },
          folderIds: ["folders:cars", "folders:refs"],
          tagNames: ["cars"],
          userNote: "why",
        },
      },
    ]);
  });

  test("rejects a wrong extension token", async () => {
    const { POST } = await import(routePath);
    const response = await POST(post({ post: { url: "https://x.com/a/status/1" } }, "nope"));
    expect(response.status).toBe(401);
    expect(state.actionCalls).toHaveLength(0);
  });

  test("requires post.url", async () => {
    const { POST } = await import(routePath);
    const response = await POST(post({ post: { text: "no url" } }));
    expect(response.status).toBe(400);
    expect(state.actionCalls).toHaveLength(0);
  });
});
