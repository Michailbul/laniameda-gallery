import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ingestFromApi, updateFromApi } from "../convex/ingest";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "owner";
const PROMPT = "prompts:saved";
const ASSET = "assets:saved";
const SOURCE = "assets:source";
type Reference = Parameters<typeof getFunctionName>[0];
const prompt = { _id: PROMPT, ownerUserId: OWNER, text: "Before", tagIds: [] };
const videoFile = { base64: "YWJj", fileName: "clip.mp4", contentType: "video/mp4" };

describe("ingest and prompt update failure boundaries", () => {
  test("invalid prompt replacement media rejects before changing text or creating tags", async () => {
    const writes: string[] = [];
    const ctx = {
      runQuery: async () => prompt,
      runMutation: async (ref: Reference) => { writes.push(getFunctionName(ref)); return PROMPT; },
    };
    await expect(callAsOwner(updateFromApi)(ctx, {
      ownerUserId: OWNER, target: "prompt", id: PROMPT,
      promptText: "After", tagNames: ["new tag"], file: { base64: "@", contentType: "image/png" },
    })).rejects.toThrow();
    expect(writes).toEqual([]);
    expect(prompt.text).toBe("Before");
  });

  test("a late prompt media failure retains the saved prompt ID and known asset ID", async () => {
    const writes: { name: string; text?: unknown }[] = [];
    const ctx = {
      runQuery: async (ref: Reference) => getFunctionName(ref) === "assets:getAssetIdForIngestKey" ? ASSET : prompt,
      runMutation: async (ref: Reference, args: Record<string, unknown>) => {
        const name = getFunctionName(ref); writes.push({ name, ...(args.text ? { text: args.text } : {}) });
        if (name === "assets:replaceAssetMedia") throw Error("Target media changed concurrently");
        return PROMPT;
      },
    };
    const result = await callAsOwner(updateFromApi)(ctx, {
      ownerUserId: OWNER, target: "prompt", id: PROMPT, promptText: "After", assetIngestKey: "existing-media", file: videoFile,
    });
    expect(result).toMatchObject({ target: "prompt", promptId: PROMPT, assetId: ASSET, partial: true, failedStep: "media" });
    expect(result.error).toContain("Prompt text was saved");
    expect(writes).toEqual([{ name: "prompts:updatePrompt", text: "After" }, { name: "assets:replaceAssetMedia" }]);
  });

  test("an unresolved upstream source prevents every tag, prompt and asset mutation", async () => {
    for (const type of ["asset", "prompt"] as const) {
      const writes: string[] = [];
      let notifications = 0;
      const ctx = {
        runQuery: async () => null,
        runMutation: async (ref: Reference) => { writes.push(getFunctionName(ref)); return []; },
        scheduler: { runAfter: async () => { notifications++; } },
      };
      await expect(callAsOwner(ingestFromApi)(ctx, {
        ownerUserId: OWNER, ingestKey: "stable-save", promptText: "New text", tagNames: ["new tag"],
        file: videoFile, upstreamInputs: [{ type, ingestKey: "missing-source", role: "style_reference" }],
      })).rejects.toThrow(`Upstream ${type} not found`);
      expect(writes).toEqual([]);
      expect(notifications).toBe(0);
    }
  });

  test("upstream deletion after preflight returns both saved IDs with an explicit failed step", async () => {
    const writes: string[] = [];
    let sourceReads = 0;
    let notifications = 0;
    const ctx = {
      runQuery: async (ref: Reference) => {
        expect(getFunctionName(ref)).toBe("assets:getAssetIdForIngestKey");
        return sourceReads++ === 0 ? SOURCE : null;
      },
      runMutation: async (ref: Reference) => {
        const name = getFunctionName(ref); writes.push(name);
        if (name === "prompts:createPrompt") return { promptId: PROMPT, created: true };
        if (name === "assets:createAsset") return { assetId: ASSET, created: true };
        throw Error(`Unexpected mutation ${name}`);
      },
      scheduler: { runAfter: async () => { notifications++; } },
    };
    const result = await callAsOwner(ingestFromApi)(ctx, {
      ownerUserId: OWNER, ingestKey: "stable-save", promptText: "New text", r2Key: "prepared-clip.mp4", mediaContentType: "video/mp4",
      upstreamInputs: [{ type: "asset", ingestKey: "deleted-source", role: "style_reference" }],
    });
    expect(result).toMatchObject({ promptId: PROMPT, assetId: ASSET, partial: true, failedStep: "upstreamInputs" });
    expect(result.error).toContain("Saved records exist");
    expect(sourceReads).toBe(2);
    expect(writes).toEqual(["prompts:createPrompt", "assets:createAsset"]);
    expect(notifications).toBe(0);
  });
});
