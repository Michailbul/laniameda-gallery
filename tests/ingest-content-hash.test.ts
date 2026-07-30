import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { ingestFromApi } from "../convex/ingest";

type MutationArgs = Record<string, unknown>;

const bytes = Buffer.from("the very same pixels");
const base64 = bytes.toString("base64");
const expectedHash = createHash("sha256").update(bytes).digest("hex");

/**
 * `twinExists` makes the fake createAsset behave the way the real mutation does
 * when the content hash already matches a row: hand back the ORIGINAL id with
 * `created: false, duplicate: true` instead of inserting.
 */
const createHarness = ({ twinExists = false } = {}) => {
  const state = {
    createAssetCalls: [] as MutationArgs[],
    notifications: [] as MutationArgs[],
  };
  let tagSeq = 0;
  let promptSeq = 0;
  let assetSeq = 0;
  let storageSeq = 0;

  const ctx = {
    runMutation: async (_ref: unknown, args: MutationArgs) => {
      if (Array.isArray(args.tags)) {
        return args.tags.map(() => `tags:${++tagSeq}`);
      }
      if (typeof args.text === "string" && Array.isArray(args.tagIds)) {
        promptSeq += 1;
        return { promptId: `prompts:${promptSeq}`, created: true };
      }
      if (typeof args.kind === "string" && Array.isArray(args.tagIds)) {
        state.createAssetCalls.push(args);
        if (twinExists) {
          return { assetId: "assets:original", created: false, duplicate: true };
        }
        assetSeq += 1;
        return { assetId: `assets:${assetSeq}`, created: true };
      }
      throw new Error(`Unhandled mutation args: ${JSON.stringify(args)}`);
    },
    runQuery: async () => null,
    storage: {
      store: async () => `_storage:${++storageSeq}`,
    },
    scheduler: {
      runAfter: async (_delayMs: number, _ref: unknown, payload: MutationArgs) => {
        state.notifications.push(payload);
        return null;
      },
    },
  };

  return { ctx, state };
};

describe("content-hash duplicate detection", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("hashes the original bytes of an inline file", async () => {
    await ingestFromApi._handler(harness.ctx as never, {
      ownerUserId: "telegram:278674008",
      promptText: "A first save.",
      file: { base64, fileName: "a.png", contentType: "image/png" },
      ingestKey: "hash-test:a",
    } as never);

    expect(harness.state.createAssetCalls[0]?.contentHash).toBe(expectedHash);
  });

  test("passes the browser-computed digest straight through for R2 media", async () => {
    await ingestFromApi._handler(harness.ctx as never, {
      ownerUserId: "telegram:278674008",
      promptText: "A video that never touched the action.",
      r2Key: "uploads/clip.mp4",
      mediaContentType: "video/mp4",
      mediaContentHash: "deadbeef",
      ingestKey: "hash-test:r2",
    } as never);

    expect(harness.state.createAssetCalls[0]?.contentHash).toBe("deadbeef");
  });

  test("reports a duplicate instead of creating a second asset", async () => {
    const dupeHarness = createHarness({ twinExists: true });
    const result = await ingestFromApi._handler(dupeHarness.ctx as never, {
      ownerUserId: "telegram:278674008",
      // Deliberately a DIFFERENT name, prompt and ingestKey from the first
      // save — only the bytes match, which is exactly what ingestKey misses.
      promptText: "Same picture, described differently.",
      file: { base64, fileName: "renamed-copy.png", contentType: "image/png" },
      ingestKey: "hash-test:b",
    } as never);

    expect(result.duplicateMedia).toBe(true);
    expect(result.assetId).toBe("assets:original");
    expect(dupeHarness.state.createAssetCalls).toHaveLength(1);
    // The save still counts as a duplicate for the ingest notification.
    expect(dupeHarness.state.notifications[0]?.isDuplicate).toBe(true);
  });

  test("a genuinely new file is not flagged", async () => {
    const result = await ingestFromApi._handler(harness.ctx as never, {
      ownerUserId: "telegram:278674008",
      promptText: "Brand new.",
      file: { base64, fileName: "new.png", contentType: "image/png" },
      ingestKey: "hash-test:c",
    } as never);

    expect(result.duplicateMedia).toBe(false);
  });
});
