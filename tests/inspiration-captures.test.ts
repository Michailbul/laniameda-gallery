import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import {
  getInspiration, listInspiration, postInspirationVersion, promoteInspirationOutput, proposeInspirationAdaptation,
  registerInspirationSource, reviewInspirationAdaptation, undoInspirationPromotion, UNDO_PROMOTION_HIDE_REASON,
} from "../convex/inspiration";
import { createAsset, listAssetCaptures } from "../convex/assets";
import { INSPIRATION_ACTION_SCOPES, adaptReachesWorld, grantingScope } from "../lib/agent-scopes";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

// The critic's provenance (P0.4), Telegram boundary and narrow-credential
// (P0.3) tests, plus the two PRD limitations (cursor ties, undo leaving an
// unfiled piece), on the real handlers. skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b

const OWNER = "telegram:42";

type Fn = { _handler: (ctx: never, args: never) => unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const as = (identity: Record<string, unknown> | null) => <F extends Fn>(fn: F) => (ctx: Any, args: Any) =>
  (fn._handler as (ctx: unknown, args: unknown) => Promise<Any>)({ ...ctx, auth: { getUserIdentity: async () => identity } }, args);
const agent = as({ subject: OWNER });
const session = as({ subject: OWNER, via: "session" });

const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);
const dm = (messageId: number, extra: Record<string, unknown> = {}) =>
  ({ channel: "telegram", chatType: "private", chatId: 42, senderId: 42, messageId, bot: "main_bot", ...extra });

describe("inspiration captures and safety gates", () => {
  let env: ReturnType<typeof createMockConvexMutationCtx>;
  let ctx: Any;

  beforeEach(() => {
    setSystemTime(new Date(T0));
    env = createMockConvexMutationCtx();
    ctx = env.ctx;
  });
  afterEach(() => setSystemTime());

  const register = (extra: Record<string, unknown>) => agent(registerInspirationSource)(ctx, {
    ownerUserId: OWNER, ingestKey: "telegram:dm:500", kind: "text", title: "An idea from the tram", platform: "telegram",
    text: "Memory is a room you redecorate.", preservation: "text", ...extra,
  });
  const captures = async () => (await env.db.query("inspirationCaptures").collect()) as Any[];
  const sources = async () => (await env.db.query("inspirationSources").collect()) as Any[];

  test("Telegram boundary: only Michael's own private chat is accepted; groups, other senders and bare telegram keys are refused", async () => {
    await expect(register({})).rejects.toThrow(/verified sender/);
    await expect(register({ capture: { via: dm(500, { chatType: "group", chatId: -100123 }) } })).rejects.toThrow(/private chat/);
    await expect(register({ capture: { via: dm(500, { chatType: "supergroup" }) } })).rejects.toThrow(/private chat/);
    // Someone else, even one whose display name looks like Michael's.
    await expect(register({ capture: { via: dm(500, { senderId: 777, chatId: 777, forwardedFrom: "Michael" }) } })).rejects.toThrow(/not from Michael/);
    // Michael's id as sender, but the chat is not his private chat with the bot.
    await expect(register({ capture: { via: dm(500, { chatId: 555 }) } })).rejects.toThrow(/private chat with the bot/);
    await expect(register({ capture: { via: dm(500, { messageId: undefined }) } })).rejects.toThrow(/message id/);
    expect(await sources()).toHaveLength(0);
    expect(await captures()).toHaveLength(0);
    // A forward of someone else's post, sent by Michael in his DM, is fine: the sender is what counts.
    const ok = await register({ capture: { via: dm(500, { forwardedFrom: "@romances" }) } });
    expect(ok.created).toBe(true);
    expect((await captures())[0].via.forwardedFrom).toBe("@romances");
  });

  test("replaying one message ten times gives one source and one capture; an edit is a new revision, never a new source", async () => {
    for (let index = 0; index < 10; index += 1) await register({ capture: { via: dm(500) } });
    expect(await sources()).toHaveLength(1);
    expect(await captures()).toHaveLength(1);
    const edited = await register({ text: "Memory is a room you redecorate every time.", capture: { revision: 2, via: dm(500) } });
    expect(edited.created).toBe(false);
    expect(edited.captureCreated).toBe(true);
    const rows = await captures();
    expect(rows.map((row) => row.captureRevision).sort()).toEqual([1, 2]);
    expect(rows.find((row) => row.captureRevision === 2).text).toBe("Memory is a room you redecorate every time.");
    // The source keeps its first text (a repeat only fills empty fields); no adaptation appeared.
    expect((await sources())[0].text).toBe("Memory is a room you redecorate.");
    expect(await env.db.query("inspirationAdaptations").collect()).toHaveLength(0);
  });

  test("same bytes from two platforms: one asset, two contexts kept, at asset and capture level", async () => {
    const first = await callAsOwner(createAsset)(ctx, { ownerUserId: OWNER, kind: "image", tagIds: [], contentHash: "h-same", sourceUrl: "https://www.instagram.com/p/AAA/" }) as Any;
    const second = await callAsOwner(createAsset)(ctx, { ownerUserId: OWNER, kind: "image", tagIds: [], contentHash: "h-same", sourceUrl: "https://x.com/someone/status/1" }) as Any;
    expect(second.assetId).toBe(first.assetId);
    expect(second.duplicate).toBe(true);
    // The first URL stays on the asset; the second is not lost.
    expect(((await env.db.get(first.assetId)) as Any).sourceUrl).toBe("https://www.instagram.com/p/AAA/");
    const also = await callAsOwner(listAssetCaptures)(ctx, { ownerUserId: OWNER, assetId: first.assetId }) as Any[];
    expect(also.map((row) => [row.sourceUrl, row.matchedBy])).toEqual([["https://x.com/someone/status/1", "contentHash"]]);
    // Saving the X copy again adds nothing more.
    await callAsOwner(createAsset)(ctx, { ownerUserId: OWNER, kind: "image", tagIds: [], contentHash: "h-same", sourceUrl: "https://x.com/someone/status/1" });
    expect(await callAsOwner(listAssetCaptures)(ctx, { ownerUserId: OWNER, assetId: first.assetId })).toHaveLength(1);

    const insta = await agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "instagram:AAA", kind: "media", title: "Window light", platform: "instagram",
      sourceUrl: "https://www.instagram.com/p/AAA/", creator: "@romances", assetIds: [first.assetId], preservation: "source_served_file",
    });
    const x = await agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "x:1", kind: "media", title: "Window light (repost)", platform: "x",
      sourceUrl: "https://x.com/someone/status/1", creator: "@someone", assetIds: [first.assetId], preservation: "source_served_file",
    });
    const rows = await captures();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.platform, row.creator, row.contentHashes[0]])).toEqual([
      ["instagram", "@romances", "h-same"], ["x", "@someone", "h-same"],
    ]);
    expect(insta.sourceId).not.toBe(x.sourceId);
    // A capture key cannot be moved onto another reference.
    await expect(agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "x:2", kind: "text", title: "Other", platform: "x", text: "t", preservation: "text", capture: { key: "instagram:AAA" },
    })).rejects.toThrow(/another reference/);
  });

  test("screenshot first, full file later: both representations kept and the source upgrades", async () => {
    const shot = await callAsOwner(createAsset)(ctx, { ownerUserId: OWNER, kind: "image", tagIds: [], contentHash: "h-shot" }) as Any;
    const full = await callAsOwner(createAsset)(ctx, { ownerUserId: OWNER, kind: "image", tagIds: [], contentHash: "h-full" }) as Any;
    const base = { ownerUserId: OWNER, ingestKey: "instagram:BBB", kind: "media", title: "Stair turn", platform: "instagram", sourceUrl: "https://www.instagram.com/p/BBB/" };
    const first = await agent(registerInspirationSource)(ctx, { ...base, assetIds: [shot.assetId], preservation: "screenshot_only" });
    expect(first.preservation).toBe("screenshot_only");
    const upgraded = await agent(registerInspirationSource)(ctx, { ...base, assetIds: [full.assetId], preservation: "source_served_file" });
    expect(upgraded.sourceId).toBe(first.sourceId);
    expect(upgraded.preservation).toBe("source_served_file");
    const detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId: first.sourceId });
    expect(detail.assetIds).toEqual([shot.assetId, full.assetId]);
    expect(detail.captures.map((row: Any) => [row.representation, row.assetIds])).toEqual([
      ["screenshot_only", [shot.assetId]], ["source_served_file", [full.assetId]],
    ]);
    // A later screenshot never downgrades it.
    const again = await agent(registerInspirationSource)(ctx, { ...base, assetIds: [shot.assetId], preservation: "screenshot_only" });
    expect(again.preservation).toBe("source_served_file");
    expect(again.captureCreated).toBe(false);
  });

  test("library cursor: sources saved in the same millisecond are never skipped at a page edge", async () => {
    for (let index = 0; index < 5; index += 1) {
      await agent(registerInspirationSource)(ctx, {
        ownerUserId: OWNER, ingestKey: `idea:${index}`, kind: "text", title: `Idea ${index}`, platform: "other", text: "t", preservation: "text",
      });
    }
    const seen: string[] = [];
    let cursor: { before?: number; beforeTie?: number } = {};
    for (let page = 0; page < 5; page += 1) {
      const result = await agent(listInspiration)(ctx, { ownerUserId: OWNER, limit: 2, ...cursor });
      seen.push(...result.rows.map((row: Any) => row.sourceId));
      if (result.nextBefore === undefined) break;
      cursor = { before: result.nextBefore, beforeTie: result.nextBeforeTie };
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test("undoing a promotion that created the piece moves it to the Archive tray; promoting again brings it back", async () => {
    const world = await env.db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete", worldKey: "dear-annete" });
    const shelf = await env.db.insert("folders", { ownerUserId: OWNER, name: "Scenes", normalizedName: "dear annete/scenes", parentFolderId: world });
    const source = await agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "idea:promote", kind: "text", title: "A beat", platform: "other", text: "t", preservation: "text",
    });
    const { adaptationId } = await agent(proposeInspirationAdaptation)(ctx, {
      ownerUserId: OWNER, sourceId: source.sourceId, ingestKey: "adapt:promote", targetWorldId: world, targetLabel: "Dear Annete · Film",
      intendedUse: "One beat.", routing: "owner",
    });
    await agent(postInspirationVersion)(ctx, {
      ownerUserId: OWNER, adaptationId, ingestKey: "v1", basedOnVersion: 0, model: "m",
      outputs: [{ key: "o1", kind: "image", r2Key: "r2/o1.png", contentType: "image/png", contentHash: "h-o1", size: 10 }],
    });
    const revision = async () => ((await env.db.get(adaptationId)) as Any).revision;
    await session(reviewInspirationAdaptation)(ctx, { ownerUserId: OWNER, adaptationId, eventKey: "a", action: "approve", version: 1, expectedRevision: await revision() });
    const promoted = await session(promoteInspirationOutput)(ctx, { ownerUserId: OWNER, adaptationId, eventKey: "p", version: 1, outputKey: "o1", folderId: shelf, expectedRevision: await revision() });
    await session(undoInspirationPromotion)(ctx, { ownerUserId: OWNER, adaptationId, eventKey: "u", expectedRevision: await revision() });
    const archived = (await env.db.query("assetArchive").collect()) as Any[];
    expect(archived.map((row) => row.assetId)).toEqual([promoted.assetId]);
    const asset = (await env.db.get(promoted.assetId)) as Any;
    expect(asset).not.toBeNull();
    expect(asset.worldPageHidden).toBe(true);
    expect(asset.worldPageHiddenReason).toBe(UNDO_PROMOTION_HIDE_REASON);
    expect(await env.db.query("assetFolders").collect()).toHaveLength(0);
    const again = await session(promoteInspirationOutput)(ctx, { ownerUserId: OWNER, adaptationId, eventKey: "p2", version: 1, outputKey: "o1", folderId: shelf, expectedRevision: await revision() });
    expect(again.assetId).toBe(promoted.assetId);
    expect(await env.db.query("assetArchive").collect()).toHaveLength(0);
    expect(((await env.db.get(promoted.assetId)) as Any).worldPageHidden).toBeUndefined();
    expect(((await env.db.query("assetFolders").collect()) as Any[]).map((row) => row.folderId)).toEqual([shelf]);
  });

  test("narrow tokens: capture registers and reads back only; takes reach only their own projects", () => {
    const capture = { scopes: ["inspiration:capture"] };
    const takes = { scopes: ["inspiration:adapt"], worldIds: ["folders:1"] };
    const full = { scopes: ["gallery:read", "gallery:write"] };
    expect(grantingScope(capture, INSPIRATION_ACTION_SCOPES.register)).toBe("inspiration:capture");
    expect(grantingScope(capture, INSPIRATION_ACTION_SCOPES.private_media)).toBe("inspiration:capture");
    expect(grantingScope(capture, INSPIRATION_ACTION_SCOPES.get)).toBe("inspiration:capture");
    for (const action of ["list", "feedback", "propose", "post_version", "block", "dispatch", "job"] as const) {
      expect(grantingScope(capture, INSPIRATION_ACTION_SCOPES[action])).toBeNull();
    }
    for (const action of ["list", "get", "feedback", "propose", "post_version", "block", "dispatch", "job"] as const) {
      expect(grantingScope(takes, INSPIRATION_ACTION_SCOPES[action])).toBe("inspiration:adapt");
    }
    expect(grantingScope(takes, INSPIRATION_ACTION_SCOPES.register)).toBeNull();
    expect(grantingScope(takes, INSPIRATION_ACTION_SCOPES.private_media)).toBeNull();
    // Owner-wide scopes win, so a full token is never treated as narrow.
    expect(grantingScope({ scopes: ["inspiration:adapt", "gallery:write"] }, INSPIRATION_ACTION_SCOPES.propose)).toBe("gallery:write");
    expect(grantingScope(full, INSPIRATION_ACTION_SCOPES.register)).toBe("gallery:write");
    expect(adaptReachesWorld(takes, "folders:1")).toBe(true);
    expect(adaptReachesWorld(takes, "folders:2")).toBe(false);
    expect(adaptReachesWorld(takes, undefined)).toBe(false);
  });
});
