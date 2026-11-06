import { beforeEach, describe, expect, test } from "bun:test";

import { getInspiration, registerInspirationSource } from "../convex/inspiration";
import { attachPrivateMedia, base64ToHex, servePrivateMedia } from "../convex/inspirationPrivate";
import { parseByteRange, privateMediaPath } from "../lib/inspiration";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

// Private originals: the critic's owner-isolation and byte-preservation
// checks (skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b) on the real handlers.

const OWNER = "telegram:42";
const OTHER = "telegram:99";

type Fn = { _handler: (ctx: never, args: never) => unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const as = (identity: Record<string, unknown> | null) => <F extends Fn>(fn: F) => (ctx: Any, args: Any) =>
  (fn._handler as (ctx: unknown, args: unknown) => Promise<Any>)({ ...ctx, auth: { getUserIdentity: async () => identity } }, args);
const agent = as({ subject: OWNER });
const otherAgent = as({ subject: OTHER });

const BYTES = new Uint8Array(Array.from({ length: 1000 }, (_, index) => index % 251));
const hexOf = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

describe("inspiration private originals", () => {
  let env: ReturnType<typeof createMockConvexMutationCtx>;
  let ctx: Any;
  let storage: Map<string, { blob: Blob; meta: Any }>;
  let sourceId: string;
  let sha: string;

  const store = async (id: string, contentType = "image/jpeg", bytes = BYTES) => {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    storage.set(id, { blob: new Blob([bytes], { type: contentType }), meta: { _id: id, sha256: Buffer.from(digest).toString("base64"), size: bytes.length, contentType } });
  };
  const attach = (fn: typeof agent, args: Record<string, unknown>) => fn(attachPrivateMedia)(ctx, { ownerUserId: OWNER, ...args });

  beforeEach(async () => {
    env = createMockConvexMutationCtx();
    storage = new Map();
    ctx = { ...env.ctx, db: Object.assign(env.ctx.db, { system: { get: async (id: string) => storage.get(id)?.meta ?? null } }) };
    sha = await hexOf(BYTES);
    await store("storage-1");
    const source = await agent(registerInspirationSource)(ctx, {
      ownerUserId: OWNER, ingestKey: "telegram:1:100", kind: "media", title: "Saturday at the lake", platform: "telegram",
      preservation: "owner_uploaded_bytes",
    });
    sourceId = source.sourceId;
  });

  const serveCtx = (subject: string | null) => ({
    auth: { getUserIdentity: async () => (subject ? { subject } : null) },
    runQuery: async (_ref: unknown, args: Any) => {
      const row = (await env.db.query("inspirationPrivateMedia").collect() as Any[]).find((item) => item._id === args.mediaId);
      if (!row || row.ownerUserId !== args.caller) return null;
      return { storageId: row.storageId, contentType: row.contentType, size: row.size, sha256: row.sha256 };
    },
    storage: { get: async (id: string) => storage.get(id)?.blob ?? null },
  }) as Any;

  test("storage's base64 hash is compared as hex", async () => {
    expect(base64ToHex(Buffer.from("ab", "hex").toString("base64"))).toBe("ab");
    expect(storage.get("storage-1")!.meta.sha256).not.toBe(sha);
    expect(base64ToHex(storage.get("storage-1")!.meta.sha256)).toBe(sha);
  });

  test("attach records the stored bytes, is idempotent, and the only URL is the gated route", async () => {
    const first = await attach(agent, { storageId: "storage-1", ingestKey: "telegram:1:100:1", sourceId, sha256: sha, label: "Lake, morning" });
    expect(first.created).toBe(true);
    expect(first.media.sha256).toBe(sha);
    expect(first.media.size).toBe(1000);
    expect(first.media.url).toBe(privateMediaPath(first.media.mediaId));
    const again = await attach(agent, { storageId: "storage-1", ingestKey: "telegram:1:100:1", sourceId, sha256: sha });
    expect(again.created).toBe(false);
    const detail = await agent(getInspiration)(ctx, { ownerUserId: OWNER, sourceId });
    expect(detail.privateMedia).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("storage-1");
    expect(detail.privateMedia[0].url.startsWith("/api/inspiration/media/")).toBe(true);
  });

  test("recorded bytes cannot be claimed again, by another key or another owner", async () => {
    await attach(agent, { storageId: "storage-1", ingestKey: "k1", sourceId });
    await expect(attach(agent, { storageId: "storage-1", ingestKey: "k2" })).rejects.toThrow(/already recorded/);
    await expect(otherAgent(attachPrivateMedia)(ctx, { ownerUserId: OTHER, storageId: "storage-1", ingestKey: "k3" })).rejects.toThrow(/already recorded/);
  });

  test("another owner cannot attach to this owner's source", async () => {
    await store("storage-2");
    await expect(otherAgent(attachPrivateMedia)(ctx, { ownerUserId: OTHER, storageId: "storage-2", ingestKey: "x", sourceId })).rejects.toThrow(/not found/);
  });

  test("a hash mismatch, an unsupported type, a missing upload and an oversized file are refused", async () => {
    await expect(attach(agent, { storageId: "storage-1", ingestKey: "k", sha256: "0".repeat(64) })).rejects.toThrow(/do not match/);
    await store("storage-html", "text/html");
    await expect(attach(agent, { storageId: "storage-html", ingestKey: "h" })).rejects.toThrow(/not kept/);
    await expect(attach(agent, { storageId: "nothing", ingestKey: "n" })).rejects.toThrow(/Upload not found/);
    storage.set("storage-big", { blob: new Blob([]), meta: { _id: "storage-big", sha256: "", size: 30 * 1024 * 1024, contentType: "video/mp4" } });
    await expect(attach(agent, { storageId: "storage-big", ingestKey: "b" })).rejects.toThrow(/20 MB/);
    expect(await env.db.query("inspirationPrivateMedia").collect()).toHaveLength(0);
  });

  test("delivery: 401 without a token, 404 for another owner or a bad id, private no-store bytes for the owner", async () => {
    const { media } = await attach(agent, { storageId: "storage-1", ingestKey: "k1", sourceId });
    const url = `https://example.convex.site/inspiration/private-media?id=${media.mediaId}`;
    const anonymous = await servePrivateMedia(serveCtx(null), new Request(url));
    expect(anonymous.status).toBe(401);
    expect((await servePrivateMedia(serveCtx(OTHER), new Request(url))).status).toBe(404);
    expect((await servePrivateMedia(serveCtx(OWNER), new Request("https://example.convex.site/inspiration/private-media?id=nope"))).status).toBe(404);
    const ok = await servePrivateMedia(serveCtx(OWNER), new Request(url));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(ok.headers.get("cache-control")).toContain("private");
    const body = new Uint8Array(await ok.arrayBuffer());
    expect(await hexOf(body)).toBe(sha);
  });

  test("delivery honours byte ranges so phone video can seek", async () => {
    const { media } = await attach(agent, { storageId: "storage-1", ingestKey: "k1", sourceId });
    const url = `https://example.convex.site/inspiration/private-media?id=${media.mediaId}`;
    const part = await servePrivateMedia(serveCtx(OWNER), new Request(url, { headers: { Range: "bytes=10-19" } }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual(Array.from(BYTES.slice(10, 20)));
    expect((await servePrivateMedia(serveCtx(OWNER), new Request(url, { headers: { Range: "bytes=5000-" } }))).status).toBe(416);
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("items=0-1", 1000)).toBe("invalid");
  });
});
