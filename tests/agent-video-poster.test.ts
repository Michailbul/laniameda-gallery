import { describe, expect, test } from "bun:test";
import { setVideoPosterFromApi } from "../convex/thumbnails";
import { callAsOwner } from "./helpers/call-as-owner";

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=";

describe("agent video poster", () => {
  test("updates only the poster and retains playable media and organization", async () => {
    const asset = { _id: "assets:1", ownerUserId: "owner", kind: "video", r2Key: "original.mp4", contentType: "video/mp4", promptId: "prompts:1", folderId: "folders:1" };
    let written: Record<string, unknown> | undefined;
    const ctx = {
      runQuery: async () => asset,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => { written = args; return asset._id; },
    };
    const result = await callAsOwner(setVideoPosterFromApi)(ctx, { ownerUserId: "owner", assetId: asset._id, posterBase64: image });
    expect(result).toBe(asset._id);
    expect(written).toMatchObject({ assetId: asset._id, ownerUserId: "owner", thumbWidth: 1, thumbHeight: 1 });
    expect(written?.newThumbR2Key).toBeTruthy();
    expect(written).not.toHaveProperty("kind");
    expect(written).not.toHaveProperty("r2Key");
    expect(written).not.toHaveProperty("promptId");
    expect(written).not.toHaveProperty("folderId");
    expect(asset.r2Key).toBe("original.mp4");
  });

  test("rejects images and missing or unsigned video targets before writing", async () => {
    let writes = 0;
    const ctx = { runQuery: async () => ({ kind: "image" }), runMutation: async () => { writes++; } };
    const input = { ownerUserId: "owner", assetId: "assets:1", posterBase64: image };
    await expect(callAsOwner(setVideoPosterFromApi)(ctx, input)).rejects.toThrow("owned video");
    await expect(callAsOwner(setVideoPosterFromApi)({ ...ctx, runQuery: async () => null }, input)).rejects.toThrow("owned video");
    await expect(callAsOwner(setVideoPosterFromApi)({ ...ctx, auth: { getUserIdentity: async () => null } }, input)).rejects.toThrow("Not authenticated");
    expect(writes).toBe(0);
  });
});
