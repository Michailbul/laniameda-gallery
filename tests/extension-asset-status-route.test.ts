import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  queryCalls: [] as Array<Record<string, unknown>>,
  matchedKeys: [] as string[],
  matchedPrefixes: [] as string[],
};

const routePath = new URL(
  "../app/api/extension/asset-status/route.ts",
  import.meta.url,
).pathname;

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    query: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.queryCalls.push(payload);
      return {
        matchedKeys: state.matchedKeys,
        matchedPrefixes: state.matchedPrefixes,
      };
    },
  }),
}));

const postStatus = async (body: unknown) => {
  const { POST } = await import(routePath);
  return POST(
    new Request("http://localhost/api/extension/asset-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

const JOB_ID = "60815ee1-104c-4daa-a5d0-f342821edf92";
const VIEWER_URL = `https://cdn.midjourney.com/${JOB_ID}/0_1.jpeg`;
const GRID_URL = `https://cdn.midjourney.com/${JOB_ID}/0_1_640_N.webp?method=shortest`;

describe("POST /api/extension/asset-status", () => {
  beforeEach(() => {
    state.queryCalls = [];
    state.matchedKeys = [];
    state.matchedPrefixes = [];
    process.env.EXTENSION_OWNER_USER_ID = "telegram:278674008";
  });

  test("rejects empty payloads", async () => {
    const response = await postStatus({ imageUrls: [] });
    expect(response.status).toBe(400);
  });

  test("sends exact keys plus midjourney variant prefixes", async () => {
    await postStatus({ imageUrls: [VIEWER_URL] });

    expect(state.queryCalls).toHaveLength(1);
    const payload = state.queryCalls[0];
    expect(payload.keys).toEqual([VIEWER_URL]);
    expect(payload.prefixes).toEqual([
      `https://cdn.midjourney.com/${JOB_ID}/0_1.`,
      `https://cdn.midjourney.com/${JOB_ID}/0_1_`,
    ]);
  });

  test("marks saved via exact key match", async () => {
    state.matchedKeys = [VIEWER_URL];

    const response = await postStatus({ imageUrls: [VIEWER_URL] });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.statuses).toEqual([{ url: VIEWER_URL, saved: true }]);
  });

  test("marks the viewer jpeg saved when the grid webp variant was saved", async () => {
    // The stored ingestKey is the grid URL; only the prefix matches.
    state.matchedPrefixes = [`https://cdn.midjourney.com/${JOB_ID}/0_1_`];

    const response = await postStatus({ imageUrls: [VIEWER_URL] });
    const data = await response.json();

    expect(data.statuses).toEqual([{ url: VIEWER_URL, saved: true }]);
  });

  test("reports unsaved urls as not saved", async () => {
    state.matchedPrefixes = [`https://cdn.midjourney.com/${JOB_ID}/0_1_`];
    const otherUrl = "https://cdn.midjourney.com/5d6bb5c7-07a5-4d0d-9b68-44eec9ad89ce/0_0.jpeg";

    const response = await postStatus({ imageUrls: [GRID_URL, otherUrl] });
    const data = await response.json();

    expect(data.statuses).toEqual([
      { url: GRID_URL, saved: true },
      { url: otherUrl, saved: false },
    ]);
  });
});
