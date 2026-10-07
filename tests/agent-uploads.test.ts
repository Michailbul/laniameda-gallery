import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import sharp from "sharp";

process.env.MCP_OAUTH_SECRET = "test-mcp-oauth-secret-0123456789abcdef";
process.env.AGENT_UPLOAD_METADATA_WAIT_MS = "300";

const OWNER = "telegram:278674008";

const state = {
  keyCounter: 0,
  objects: new Map<string, { bytes: Buffer; contentType?: string }>(),
  ingestPayloads: [] as Array<Record<string, unknown>>,
  failIngestFor: new Set<string>(),
};

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      if ("folderIds" in payload) return { folderIds: payload.folderIds };
      if ("key" in payload) return null; // r2:syncMetadata
      state.keyCounter += 1;
      const key = `key-${state.keyCounter}`;
      return { key, url: `https://r2.test/put/${key}` };
    },
    query: async (_reference: unknown, payload: { key: string }) => {
      const object = state.objects.get(payload.key);
      return object
        ? { url: `https://r2.test/get/${payload.key}`, contentType: object.contentType, bucket: "gallery" }
        : null;
    },
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      if (state.failIngestFor.has(String(payload.description))) throw new Error("ingest exploded");
      state.ingestPayloads.push(payload);
      return { assetId: `assets:${state.ingestPayloads.length}` };
    },
  }),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  const key = url.replace("https://r2.test/get/", "");
  const object = state.objects.get(key);
  if (!object) return new Response("missing", { status: 404 });
  return new Response(new Uint8Array(object.bytes), { status: 200 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const agent = {
  tokenId: "agentTokens:1",
  ownerUserId: OWNER,
  tokenPrefix: "lgat_prefix",
  label: "MCP",
  scopes: ["gallery:read", "gallery:write"],
} as never;

mock.module("@/lib/server/agent-auth", () => ({
  AgentAuthError: class extends Error {
    status = 401;
  },
  requireAgentAuth: async () => agent,
}));

const uploads = await import("../lib/server/agent-uploads");
const { ingestForAgent } = await import("../lib/server/agent-ingest");
const batchRoute = await import("../app/api/agent/ingest/batch/route");

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 60 } } })
    .png()
    .toBuffer();

// What the agent's curl does: put bytes at the slot's key.
const putFile = (uploadUrl: string, bytes: Buffer, contentType?: string) =>
  state.objects.set(uploadUrl.replace("https://r2.test/put/", ""), { bytes, contentType });

describe("agent uploads", () => {
  beforeEach(() => {
    state.objects.clear();
    state.ingestPayloads = [];
    state.failIngestFor.clear();
  });

  test("prepareUploads hands out signed slots, capped at 50", async () => {
    const slots = await uploads.prepareUploads(OWNER, 3);
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((slot) => slot.uploadUrl)).size).toBe(3);
    expect(slots[0]!.uploadId.split(".")).toHaveLength(3);
    expect(await uploads.prepareUploads(OWNER, 500)).toHaveLength(50);
  });

  test("an uploaded image is measured, hashed and given a poster", async () => {
    const [slot] = await uploads.prepareUploads(OWNER, 1);
    const bytes = await png(1200, 800);
    putFile(slot!.uploadUrl, bytes, "application/octet-stream");

    const media = await uploads.resolveUploadedMedia({
      ownerUserId: OWNER,
      uploadId: slot!.uploadId,
      fileName: "frame.png",
    });
    expect(media.r2Key).toBe(slot!.uploadUrl.replace("https://r2.test/put/", ""));
    expect(media.mediaContentType).toBe("image/png");
    expect(media.mediaWidth).toBe(1200);
    expect(media.mediaHeight).toBe(800);
    expect(media.mediaContentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(media.posterFile?.contentType).toBe("image/jpeg");
    expect(media.posterFile?.width).toBe(1200);
  });

  test("a video is hashed and takes its size from the poster upload", async () => {
    const [video, poster] = await uploads.prepareUploads(OWNER, 2);
    putFile(video!.uploadUrl, Buffer.from("not really an mp4"), "video/mp4");
    putFile(poster!.uploadUrl, await png(1920, 1080), "image/png");

    const media = await uploads.resolveUploadedMedia({
      ownerUserId: OWNER,
      uploadId: video!.uploadId,
      posterUploadId: poster!.uploadId,
      fileName: "clip.mp4",
    });
    expect(media.mediaContentType).toBe("video/mp4");
    expect(media.mediaSize).toBe(17);
    expect(media.posterFile).toBeDefined();
    expect(media.mediaWidth! / media.mediaHeight!).toBeCloseTo(16 / 9, 2);
  });

  test("uploadIds are bound to their owner and must exist", async () => {
    const [slot] = await uploads.prepareUploads(OWNER, 1);
    await expect(
      uploads.resolveUploadedMedia({ ownerUserId: "telegram:1", uploadId: slot!.uploadId }),
    ).rejects.toThrow(/uploadId/);
    await expect(
      uploads.resolveUploadedMedia({ ownerUserId: OWNER, uploadId: "forged.token.value" }),
    ).rejects.toThrow(/uploadId/);
    // Slot reserved but nothing PUT yet.
    await expect(
      uploads.resolveUploadedMedia({ ownerUserId: OWNER, uploadId: slot!.uploadId }),
    ).rejects.toThrow(/PUT the file/);
  });

  test("poster uploads must be readable images and belong to the caller", async () => {
    const [slot] = await uploads.prepareUploads(OWNER, 1);
    putFile(slot!.uploadUrl, Buffer.from("video bytes"), "video/mp4");
    await expect(uploads.resolveUploadedPoster(OWNER, slot!.uploadId)).rejects.toThrow("not a readable image");
    await expect(uploads.resolveUploadedPoster("telegram:other", slot!.uploadId)).rejects.toThrow("uploadId");
    putFile(slot!.uploadUrl, await png(400, 600), "image/png");
    expect(await uploads.resolveUploadedPoster(OWNER, slot!.uploadId)).toMatchObject({ width: 400, height: 600, contentType: "image/jpeg" });
  });

  test("ingestForAgent saves an upload, ignoring a raw r2Key", async () => {
    const [slot] = await uploads.prepareUploads(OWNER, 1);
    putFile(slot!.uploadUrl, await png(400, 600));
    await ingestForAgent(agent, {
      uploadId: slot!.uploadId,
      r2Key: "someone-elses-object",
      tagNames: ["character"],
      folderIds: ["folder-a"],
    });
    const payload = state.ingestPayloads[0]!;
    expect(payload.r2Key).toBe(slot!.uploadUrl.replace("https://r2.test/put/", ""));
    expect(payload.ownerUserId).toBe(OWNER);
    expect(payload.folderId).toBe("folder-a");
    expect(payload.mediaWidth).toBe(400);
    expect(payload).not.toHaveProperty("uploadId");
  });

  test("batch route saves every item and reports failures per item", async () => {
    const slots = await uploads.prepareUploads(OWNER, 3);
    for (const slot of slots) putFile(slot.uploadUrl, await png(300, 300));
    state.failIngestFor.add("second");

    const response = await batchRoute.POST(
      new Request("https://gallery.test/api/agent/ingest/batch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer lgat_x" },
        body: JSON.stringify({
          items: [
            { uploadId: slots[0]!.uploadId, description: "first" },
            { uploadId: slots[1]!.uploadId, description: "second" },
            { uploadId: slots[2]!.uploadId, description: "third" },
            "not an object",
          ],
        }),
      }),
    );
    const body = (await response.json()) as {
      saved: number;
      failed: number;
      results: Array<{ index: number; ok: boolean; error?: string }>;
    };
    expect(body.saved).toBe(2);
    expect(body.failed).toBe(2);
    expect(body.results.map((entry) => entry.ok)).toEqual([true, false, true, false]);
    expect(body.results[1]!.error).toBe("ingest exploded");
  });

  test("batch route refuses more than 50 items", async () => {
    const response = await batchRoute.POST(
      new Request("https://gallery.test/api/agent/ingest/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: Array.from({ length: 51 }, () => ({ url: "https://x.test/a.png" })) }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
