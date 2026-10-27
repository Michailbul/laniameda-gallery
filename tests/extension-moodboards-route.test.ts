import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  queryCalls: [] as Array<Record<string, unknown>>,
};

const routePath = new URL(
  "../app/api/extension/moodboards/route.ts",
  import.meta.url,
).pathname;

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    query: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.queryCalls.push(payload);
      if ("world" in payload) {
        return {
          worldId: "world1",
          key: "dear-annete",
          name: "DEAR ANNETE",
          folderIds: ["world1"],
        };
      }
      if ("folderId" in payload) {
        return [
          {
            _id: "board1",
            name: "DA FILM · Golden",
            folderName: "Film · Live Action",
            styleTag: "da-film",
            status: "in-midjourney",
            mjCode: "88ji6bg",
            itemCount: 12,
            updatedAt: 10,
            notes: "private",
            previewItems: [
              { thumbUrl: "https://example.com/t.jpg", url: "https://example.com/f.jpg", kind: "image" },
              { url: "https://example.com/only-full.jpg", kind: "image" },
              { thumbUrl: "https://example.com/v.jpg", url: "https://example.com/v.mp4", kind: "video" },
            ],
          },
          {
            _id: "board2",
            name: "DA DRAFT",
            folderName: "Film · Live Action",
            status: "draft",
            itemCount: 3,
            updatedAt: 5,
            previewItems: [],
          },
        ];
      }
      return [{ worldId: "world1", key: "dear-annete", name: "DEAR ANNETE" }];
    },
  }),
}));

const getMoodboards = async (query = "", token: string | null = "test-extension-token") => {
  const { GET } = await import(routePath);
  return GET(
    new Request(`http://localhost/api/extension/moodboards${query}`, {
      method: "GET",
      headers: token ? { "x-extension-token": token } : {},
    }),
  );
};

describe("GET /api/extension/moodboards", () => {
  beforeEach(() => {
    state.queryCalls = [];
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
    process.env.EXTENSION_API_TOKEN = "test-extension-token";
  });

  test("rejects requests without the extension token", async () => {
    const response = await getMoodboards("?world=dear-annete", null);
    expect(response.status).toBe(401);
    expect(state.queryCalls).toHaveLength(0);
  });

  test("returns only the world list without a world param", async () => {
    const response = await getMoodboards();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      worlds: [{ worldId: "world1", key: "dear-annete", name: "DEAR ANNETE" }],
      world: null,
      moodboards: [],
    });
  });

  test("returns the filtered moodboard DTO for a world", async () => {
    const response = await getMoodboards("?world=dear-annete");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.world).toEqual({
      worldId: "world1",
      key: "dear-annete",
      name: "DEAR ANNETE",
    });
    expect(body.moodboards).toEqual([
      {
        id: "board1",
        name: "DA FILM · Golden",
        shortName: "Golden",
        collection: "Film · Live Action",
        styleTag: "da-film",
        status: "in-midjourney",
        mjCode: "88ji6bg",
        flag: "-p 88ji6bg",
        thumbUrl: "https://example.com/t.jpg",
        previews: [
          { thumbUrl: "https://example.com/t.jpg", url: "https://example.com/f.jpg" },
          {
            thumbUrl: "https://example.com/only-full.jpg",
            url: "https://example.com/only-full.jpg",
          },
        ],
        itemCount: 12,
        updatedAt: 10,
      },
    ]);
  });

  test("asks for child boards with six previews each", async () => {
    await getMoodboards("?world=dear-annete");
    const boardQuery = state.queryCalls.find((call) => "folderId" in call);
    expect(boardQuery).toMatchObject({
      folderId: "world1",
      includeChildren: true,
      previewLimit: 6,
    });
    expect(boardQuery).not.toHaveProperty("includeArchived");
  });
});
