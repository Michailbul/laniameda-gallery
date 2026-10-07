import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { updateFromApi } from "../convex/ingest";
import { callAsOwner } from "./helpers/call-as-owner";

const asset = { _id: "assets:1", kind: "video", ownerUserId: "owner", tagIds: [], description: "Current" };

describe("asset update persistence reporting", () => {
  test("bad media bytes reject before changing the existing caption", async () => {
    let writes = 0;
    const ctx = { runQuery: async () => asset, runMutation: async () => { writes++; return asset._id; } };
    await expect(callAsOwner(updateFromApi)(ctx, { ownerUserId: "owner", target: "asset", id: asset._id, description: "Should not persist", file: { base64: "@", contentType: "image/png" } })).rejects.toThrow();
    expect(writes).toBe(0);
  });

  test("a late media mutation failure returns the saved record and failed step", async () => {
    const calls: string[] = [];
    const ctx = {
      runQuery: async () => asset,
      runMutation: async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref); calls.push(name);
        if (name === "assets:replaceAssetMedia") throw Error("A concurrent update removed the target.");
        return asset._id;
      },
    };
    const result = await callAsOwner(updateFromApi)(ctx, { ownerUserId: "owner", target: "asset", id: asset._id, description: "Saved caption", file: { base64: "YWJj", contentType: "video/mp4" } });
    expect(result).toMatchObject({ assetId: asset._id, partial: true, failedStep: "media" });
    expect(calls).toEqual(["assets:updateAssetMetadata", "assets:replaceAssetMedia"]);
  });
});
