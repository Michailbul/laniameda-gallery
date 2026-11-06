import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { httpAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { signedOwnerMutation as ownerMutation } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { INSPIRATION_PRIVATE as P, cleanLine, parseByteRange, privateMediaPath } from "../lib/inspiration";

// Private originals for inspiration. Catalogue privacy (owner-scoped rows)
// is not byte privacy: the public R2 bucket serves any key it holds for a
// year. So personal material never goes there. It is uploaded to Convex file
// storage, recorded here, and read back only through
// /api/inspiration/media/<id>, which checks the signed-in session or an agent
// token and streams the bytes with `Cache-Control: private, no-store`. That
// route reaches this module's HTTP action with a short-lived signed token;
// no storage URL is ever returned to any caller.

type Ctx = QueryCtx | MutationCtx;
type PrivateMedia = Doc<"inspirationPrivateMedia">;

const fail = (message: string): never => { throw new ConvexError(message); };
const owns = (owner: string, row: { ownerUserId?: string } | null): boolean =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId));

/** Convex storage records sha256 as base64; we store and compare hex. */
export const base64ToHex = (value: string) => {
  const binary = atob(value);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  return hex;
};

export const privateMediaView = (row: PrivateMedia) => ({
  mediaId: row._id, kind: row.kind, url: privateMediaPath(row._id), contentType: row.contentType, size: row.size,
  sha256: row.sha256, width: row.width, height: row.height, label: row.label, createdAt: row.createdAt,
});

export const privateMediaViewValidator = v.object({
  mediaId: v.id("inspirationPrivateMedia"), kind: v.union(v.literal("image"), v.literal("video"), v.literal("audio")),
  url: v.string(), contentType: v.string(), size: v.number(), sha256: v.string(),
  width: v.optional(v.number()), height: v.optional(v.number()), label: v.optional(v.string()), createdAt: v.number(),
});

export const privateMediaOfSource = async (ctx: Ctx, owner: string, sourceId: Id<"inspirationSources">) =>
  (await ctx.db.query("inspirationPrivateMedia").withIndex("by_source_createdAt", (q) => q.eq("sourceId", sourceId))
    .order("asc").take(P.perSource)).filter((row) => owns(owner, row));

/** A one-time Convex storage upload URL (POST the bytes; it returns a storageId). Expires within the hour. */
export const createPrivateUploadUrl = ownerMutation({
  args: { ownerUserId: v.string() },
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * Record an uploaded private original. Checks the bytes storage actually
 * holds (size, type, hash) against the limits and the caller's hash, refuses
 * a storageId already recorded for anyone, and is idempotent on ingestKey.
 */
export const attachPrivateMedia = ownerMutation({
  args: {
    ownerUserId: v.string(),
    storageId: v.id("_storage"),
    ingestKey: v.string(),
    sourceId: v.optional(v.id("inspirationSources")),
    sha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    label: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({ media: privateMediaViewValidator, created: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const ingestKey = cleanLine(args.ingestKey, 300) ?? fail("ingestKey is required.");
    for (const candidate of resolveUserIdCandidates(owner)) {
      const repeat = await ctx.db.query("inspirationPrivateMedia").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
      if (repeat) {
        if (repeat.storageId !== args.storageId) fail("This ingestKey already holds other bytes. A new representation needs its own key.");
        return { media: privateMediaView(repeat), created: false };
      }
    }
    const taken = await ctx.db.query("inspirationPrivateMedia").withIndex("by_storageId", (q) => q.eq("storageId", args.storageId)).first();
    if (taken) fail("These uploaded bytes are already recorded. Upload again for a separate copy.");
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) fail("Upload not found. POST the file to the upload URL first.");
    const contentType = (meta!.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const kind = P.types[contentType];
    if (!kind) fail(`${contentType || "This file type"} is not kept as a private original (images, video and voice only).`);
    if (meta!.size > P.maxBytes) fail(`The file is ${Math.round(meta!.size / 1048576)} MB; private originals up to 20 MB. Keep larger ones on the iMac.`);
    const sha256 = base64ToHex(meta!.sha256);
    if (args.sha256 && args.sha256.trim().toLowerCase() !== sha256) fail("The stored bytes do not match the hash you sent. Nothing was recorded; upload again.");
    if (args.sourceId) {
      const source = await ctx.db.get(args.sourceId);
      if (!source || !owns(owner, source)) fail("Inspiration source not found.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("inspirationPrivateMedia", {
      ownerUserId: owner, storageId: args.storageId, sourceId: args.sourceId, ingestKey, kind, contentType,
      size: meta!.size, sha256, width: args.width, height: args.height, label: cleanLine(args.label, 120),
      externalProcessing: "none", createdBy: cleanLine(args.createdBy, 80) ?? "agent", createdAt: now,
    });
    if (args.sourceId) {
      const source = (await ctx.db.get(args.sourceId))!;
      await ctx.db.patch(source._id, { revision: source.revision + 1, updatedAt: now });
    }
    return { media: privateMediaView((await ctx.db.get(id))!), created: true };
  },
});

/** For the HTTP action only: the row, if the caller owns it. */
export const privateMediaForCaller = internalQuery({
  args: { caller: v.string(), mediaId: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), contentType: v.string(), size: v.number(), sha256: v.string() })),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("inspirationPrivateMedia", args.mediaId);
    if (!id) return null;
    const row = await ctx.db.get(id);
    if (!row || !owns(args.caller, row)) return null;
    return { storageId: row.storageId, contentType: row.contentType, size: row.size, sha256: row.sha256 };
  },
});

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-site",
  "Referrer-Policy": "no-referrer",
};

type ServeCtx = Pick<ActionCtx, "auth" | "runQuery" | "storage">;

/** GET ?id=<mediaId> with a signed Bearer token. 401 without one; 404 for anyone but the owner. */
export const servePrivateMedia = async (ctx: ServeCtx, request: Request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return new Response("Not authenticated.", { status: 401, headers: PRIVATE_HEADERS });
  const mediaId = new URL(request.url).searchParams.get("id") ?? "";
  const row = await ctx.runQuery(internal.inspirationPrivate.privateMediaForCaller, { caller: identity.subject, mediaId });
  if (!row) return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
  const blob = await ctx.storage.get(row.storageId);
  if (!blob) return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
  const range = parseByteRange(request.headers.get("range"), blob.size);
  const common = { ...PRIVATE_HEADERS, "Content-Type": row.contentType, "Accept-Ranges": "bytes", ETag: `"${row.sha256}"`, "Content-Disposition": "inline" };
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${blob.size}` } });
  if (range) {
    return new Response(blob.slice(range.start, range.end + 1), {
      status: 206, headers: { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${blob.size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(blob, { status: 200, headers: { ...common, "Content-Length": String(blob.size) } });
};

export const privateMediaHttp = httpAction(servePrivateMedia);
