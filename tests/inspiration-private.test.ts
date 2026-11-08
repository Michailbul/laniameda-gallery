import { beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import { getInspiration, registerInspirationSource } from "../convex/inspiration";
import {
  attachChecked, base64ToHex, deletePrivateMedia, listPrivateMediaForExport, mediaViewById, recordPrivateMedia,
  servePrivateMedia, setDerivatives, setPrivateProcessor, uploadState, type CutCopies,
} from "../convex/inspirationPrivate";
import { parseByteRange, privateMediaPath } from "../lib/inspiration";
import { signatureMismatch, sniffFileSignature } from "../lib/file-signature";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

// Private originals: the critic's owner-isolation, byte-preservation and
// display-export checks (skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b) on the real handlers.

const OWNER = "telegram:42";
const OTHER = "telegram:99";

type Fn = { _handler: (ctx: never, args: never) => unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const as = (identity: Record<string, unknown> | null) => <F extends Fn>(fn: F) => (ctx: Any, args: Any) =>
  (fn._handler as (ctx: unknown, args: unknown) => Promise<Any>)({ ...ctx, auth: { getUserIdentity: async () => identity } }, args);
const agent = as({ subject: OWNER });
const session = as({ subject: OWNER, via: "session" });
const otherSession = as({ subject: OTHER, via: "session" });
const internalCall = (fn: Fn) => (ctx: Any, args: Any) => (fn._handler as (ctx: unknown, args: unknown) => Promise<Any>)(ctx, args);

// A real JPEG header followed by filler bytes.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 996 }, (_, index) => index % 251)]);
const HTML = new TextEncoder().encode("<!DOCTYPE html><html><body>Rate limited</body></html>");
const hexOf = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).toString("hex");

describe("inspiration private originals", () => {
  let env: ReturnType<typeof createMockConvexMutationCtx>;
  let ctx: Any;
  let storage: Map<string, { blob: Blob; meta: Any }>;
  let sourceId: string;
  let sha: string;
  let cutCalls: number;

  const store = async (id: string, contentType = "image/jpeg", bytes: Uint8Array = JPEG) => {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    storage.set(id, { blob: new Blob([bytes as BlobPart], { type: contentType }), meta: { _id: id, sha256: Buffer.from(digest).toString("base64"), size: bytes.length, contentType } });
  };

  // The clean-copy cutter stands in for sharp: two small WebP-typed outputs.
  const cut: CutCopies = async () => {
    cutCalls += 1;
    return { display: { bytes: new Uint8Array([1, 2, 3]), width: 2048, height: 1536 }, thumb: { bytes: new Uint8Array([4, 5]), width: 480, height: 360 } };
  };

  // The action context: internal functions by name, storage over the map.
  const actionCtx = () => {
    const handlers: Record<string, Fn> = {
      "inspirationPrivate:uploadState": uploadState as unknown as Fn,
      "inspirationPrivate:recordPrivateMedia": recordPrivateMedia as unknown as Fn,
      "inspirationPrivate:setDerivatives": setDerivatives as unknown as Fn,
      "inspirationPrivate:mediaViewById": mediaViewById as unknown as Fn,
    };
    const run = (ref: Any, args: Any) => internalCall(handlers[getFunctionName(ref)]!)(ctx, args);
    return {
      runQuery: run, runMutation: run,
      storage: {
        get: async (id: string) => storage.get(id)?.blob ?? null,
        delete: async (id: string) => { storage.delete(id); },
        store: async (blob: Blob) => {
          const id = `derived-${storage.size + 1}`;
          storage.set(id, { blob, meta: { _id: id, sha256: "", size: blob.size, contentType: blob.type } });
          return id;
        },
      },
    } as Any;
  };
  const attach = (args: Record<string, unknown>, owner = OWNER) => attachChecked(actionCtx(), { ownerUserId: owner, ...args } as Any, cut);

  beforeEach(async () => {
    env = createMockConvexMutationCtx();
    storage = new Map();
    cutCalls = 0;
    ctx = { ...env.ctx, db: Object.assign(env.ctx.db, { system: { get: async (id: string) => storage.get(id)?.meta ?? null } }) };
    ctx.storage = { ...env.ctx.storage, delete: async (id: string) => { storage.delete(id); } };
    sha = await hexOf(JPEG);
    await store("storage-1");
    // Sent by Michael himself in his private chat with the bot.
    const source = await agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "telegram:dm:100", kind: "media", title: "Saturday at the lake", platform: "telegram",
      preservation: "owner_uploaded_bytes",
      capture: { key: "telegram:dm:100", via: { channel: "telegram", chatType: "private", chatId: 42, senderId: 42, messageId: 100, bot: "main_bot" } },
    });
    sourceId = source.sourceId;
  });

  const serveCtx = (subject: string | null) => ({
    auth: { getUserIdentity: async () => (subject ? { subject } : null) },
    runQuery: async (_ref: unknown, args: Any) => {
      const row = (await env.db.query("inspirationPrivateMedia").collect() as Any[]).find((item) => item._id === args.mediaId);
      if (!row || row.ownerUserId !== args.caller) return null;
      const { pickVariant } = await import("../convex/inspirationPrivate");
      return pickVariant(row, args.variant);
    },
    storage: { get: async (id: string) => storage.get(id)?.blob ?? null },
  }) as Any;

  test("storage's base64 hash is compared as hex", async () => {
    expect(base64ToHex(Buffer.from("ab", "hex").toString("base64"))).toBe("ab");
    expect(base64ToHex(storage.get("storage-1")!.meta.sha256)).toBe(sha);
  });

  test("file signatures: real headers pass, a web page or a different format is named and refused", () => {
    expect(sniffFileSignature(JPEG)).toBe("jpeg");
    expect(sniffFileSignature(HTML)).toBe("html");
    expect(sniffFileSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);
    expect(sniffFileSignature(heic)).toBe("heic");
    const mov = new Uint8Array([0, 0, 0, 0x14, ...new TextEncoder().encode("ftypqt  ")]);
    expect(sniffFileSignature(mov)).toBe("quicktime");
    expect(signatureMismatch("image/jpeg", "jpeg")).toBeNull();
    expect(signatureMismatch("video/quicktime", "quicktime")).toBeNull();
    expect(signatureMismatch("image/jpeg", "html")).toMatch(/web page/);
    expect(signatureMismatch("image/png", "jpeg")).toMatch(/declared as image\/png/);
    expect(signatureMismatch("image/jpeg", "unknown")).toMatch(/truncated/);
  });

  test("a file whose bytes do not match its type is refused, its upload removed, nothing recorded", async () => {
    await store("storage-html", "image/jpeg", HTML);
    await expect(attach({ storageId: "storage-html", ingestKey: "h", sourceId })).rejects.toThrow(/web page/);
    expect(storage.has("storage-html")).toBe(false);
    expect(await env.db.query("inspirationPrivateMedia").collect()).toHaveLength(0);
  });

  test("attach records the bytes, cuts a clean display copy and thumbnail, is idempotent, and only the gated route is exposed", async () => {
    const first = await attach({ storageId: "storage-1", ingestKey: "telegram:dm:100:1", sourceId, sha256: sha, label: "Lake, morning", captureKey: "telegram:dm:100" });
    expect(first.created).toBe(true);
    expect(first.media.sha256).toBe(sha);
    expect(first.media.signature).toBe("jpeg");
    expect(first.media.derivatives).toBe("ready");
    expect(first.media.url).toBe(privateMediaPath(first.media.mediaId));
    expect(first.media.displayUrl).toBe(`${privateMediaPath(first.media.mediaId)}?variant=display`);
    expect(first.media.thumbUrl).toBe(`${privateMediaPath(first.media.mediaId)}?variant=thumb`);
    expect(first.media.externalProcessing).toBe("none");
    expect(first.media.captureId).toBeDefined();
    const again = await attach({ storageId: "storage-1", ingestKey: "telegram:dm:100:1", sourceId, sha256: sha });
    expect(again.created).toBe(false);
    expect(cutCalls).toBe(1);
    const detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId });
    expect(detail.privateMedia).toHaveLength(1);
    expect(detail.captures).toHaveLength(1);
    expect(detail.captures[0].privateMediaIds).toEqual([first.media.mediaId]);
    const json = JSON.stringify(detail);
    expect(json).not.toContain("storage-1");
    expect(json).not.toContain("derived-");
    // The capture keeps the channel, never the raw Telegram ids.
    expect(detail.captures[0].channel).toBe("telegram");
    expect(json).not.toContain('"senderId"');
  });

  test("a format the encoder cannot read keeps the original only, honestly labelled", async () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), ...new Array(100).fill(1)]);
    await store("storage-heic", "image/heic", heic);
    const result = await attachChecked(actionCtx(), { ownerUserId: OWNER, storageId: "storage-heic", ingestKey: "heic", sourceId } as Any,
      async () => ({ note: "This format cannot be re-encoded here (often iPhone HEIC); only the original is kept." }));
    expect(result.media.derivatives).toBe("original_only");
    expect(result.media.displayUrl).toBeUndefined();
    expect(result.media.derivativesNote).toMatch(/HEIC/);
  });

  test("recorded bytes cannot be claimed again, by another key or another owner", async () => {
    await attach({ storageId: "storage-1", ingestKey: "k1", sourceId });
    await expect(attach({ storageId: "storage-1", ingestKey: "k2" })).rejects.toThrow(/already recorded/);
    await expect(attach({ storageId: "storage-1", ingestKey: "k3" }, OTHER)).rejects.toThrow(/already recorded/);
  });

  test("another owner cannot attach to this owner's source", async () => {
    await store("storage-2");
    await expect(attach({ storageId: "storage-2", ingestKey: "x", sourceId }, OTHER)).rejects.toThrow(/not found/);
  });

  test("a hash mismatch, an unsupported type, a missing upload and an oversized file are refused", async () => {
    await expect(attach({ storageId: "storage-1", ingestKey: "k", sha256: "0".repeat(64) })).rejects.toThrow(/do not match/);
    await store("storage-html", "text/html", HTML);
    await expect(attach({ storageId: "storage-html", ingestKey: "h" })).rejects.toThrow(/not kept/);
    await expect(attach({ storageId: "nothing", ingestKey: "n" })).rejects.toThrow(/Upload not found/);
    storage.set("storage-big", { blob: new Blob([new Uint8Array([0, 0, 0, 0x14, ...new TextEncoder().encode("ftypisom")])]), meta: { _id: "storage-big", sha256: "", size: 30 * 1024 * 1024, contentType: "video/mp4" } });
    await expect(attach({ storageId: "storage-big", ingestKey: "b" })).rejects.toThrow(/20 MB/);
    await expect(attach({ storageId: "storage-1", ingestKey: "c", captureKey: "telegram:dm:999", sourceId })).rejects.toThrow(/No capture/);
    expect(await env.db.query("inspirationPrivateMedia").collect()).toHaveLength(0);
  });

  test("delivery: 401 without a token, 404 for another owner, the clean copy by default, the original only when asked", async () => {
    const { media } = await attach({ storageId: "storage-1", ingestKey: "k1", sourceId });
    const base = `https://example.convex.site/inspiration/private-media?id=${media.mediaId}`;
    expect((await servePrivateMedia(serveCtx(null), new Request(base))).status).toBe(401);
    expect((await servePrivateMedia(serveCtx(OTHER), new Request(base))).status).toBe(404);
    expect((await servePrivateMedia(serveCtx(OWNER), new Request("https://example.convex.site/inspiration/private-media?id=nope"))).status).toBe(404);
    const display = await servePrivateMedia(serveCtx(OWNER), new Request(base));
    expect(display.status).toBe(200);
    expect(display.headers.get("x-private-variant")).toBe("display");
    expect(display.headers.get("content-type")).toBe("image/webp");
    expect(Array.from(new Uint8Array(await display.arrayBuffer()))).toEqual([1, 2, 3]);
    const thumb = await servePrivateMedia(serveCtx(OWNER), new Request(`${base}&variant=thumb`));
    expect(Array.from(new Uint8Array(await thumb.arrayBuffer()))).toEqual([4, 5]);
    const original = await servePrivateMedia(serveCtx(OWNER), new Request(`${base}&variant=original&download=1`));
    expect(original.headers.get("cache-control")).toContain("no-store");
    expect(original.headers.get("cache-control")).toContain("private");
    expect(original.headers.get("content-disposition")).toBe("attachment");
    expect(await hexOf(new Uint8Array(await original.arrayBuffer()))).toBe(sha);
  });

  test("delivery honours byte ranges so phone video can seek", async () => {
    const { media } = await attach({ storageId: "storage-1", ingestKey: "k1", sourceId });
    const url = `https://example.convex.site/inspiration/private-media?id=${media.mediaId}&variant=original`;
    const part = await servePrivateMedia(serveCtx(OWNER), new Request(url, { headers: { Range: "bytes=10-19" } }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual(Array.from(JPEG.slice(10, 20)));
    expect((await servePrivateMedia(serveCtx(OWNER), new Request(url, { headers: { Range: "bytes=5000-" } }))).status).toBe(416);
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("items=0-1", 1000)).toBe("invalid");
  });

  test("only Michael's session deletes a private original: bytes and copies gone, a tombstone kept", async () => {
    const { media } = await attach({ storageId: "storage-1", ingestKey: "k1", sourceId, captureKey: "telegram:dm:100" });
    await expect(agent(deletePrivateMedia)(ctx, { ownerUserId: OWNER, mediaId: media.mediaId })).rejects.toThrow(/Only Michael/);
    expect((await otherSession(deletePrivateMedia)(ctx, { ownerUserId: OTHER, mediaId: media.mediaId })).deleted).toBe(false);
    expect((await session(deletePrivateMedia)(ctx, { ownerUserId: OWNER, mediaId: media.mediaId })).deleted).toBe(true);
    expect(storage.has("storage-1")).toBe(false);
    expect([...storage.keys()].filter((key) => key.startsWith("derived-"))).toHaveLength(0);
    expect(await env.db.query("inspirationPrivateMedia").collect()).toHaveLength(0);
    const tombstones = await env.db.query("inspirationPrivateDeletions").collect() as Any[];
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].sha256).toBe(sha);
    const detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId });
    expect(detail.captures[0].privateMediaIds).toEqual([]);
    const url = `https://example.convex.site/inspiration/private-media?id=${media.mediaId}`;
    expect((await servePrivateMedia(serveCtx(OWNER), new Request(url))).status).toBe(404);
  });

  test("processors: none by default; only Michael clears or withdraws a named one; export lists every file", async () => {
    await attach({ storageId: "storage-1", ingestKey: "k1", sourceId });
    await expect(agent(setPrivateProcessor)(ctx, { ownerUserId: OWNER, sourceId, processor: "fal", cleared: true })).rejects.toThrow(/Only Michael/);
    await expect(session(setPrivateProcessor)(ctx, { ownerUserId: OWNER, sourceId, processor: "someone", cleared: true })).rejects.toThrow(/Unknown processor/);
    const cleared = await session(setPrivateProcessor)(ctx, { ownerUserId: OWNER, sourceId, processor: "fal", cleared: true });
    expect(cleared).toEqual({ files: 1, processors: ["fal"] });
    let detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId });
    expect(detail.privateMedia[0].externalProcessing).toBe("cleared");
    expect(detail.privateMedia[0].clearedProcessors).toEqual(["fal"]);
    await session(setPrivateProcessor)(ctx, { ownerUserId: OWNER, sourceId, processor: "fal", cleared: false });
    detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId });
    expect(detail.privateMedia[0].externalProcessing).toBe("none");
    const exported = await agent(listPrivateMediaForExport)(ctx, { ownerUserId: OWNER });
    expect(exported).toHaveLength(1);
    expect(exported[0].sourceTitle).toBe("Saturday at the lake");
    expect(JSON.stringify(exported)).not.toContain("storage-1");
    expect(await as({ subject: OTHER })(listPrivateMediaForExport)(ctx, { ownerUserId: OTHER })).toHaveLength(0);
  });
});
