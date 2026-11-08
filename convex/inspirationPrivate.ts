import { ConvexError, v, type Infer, type ObjectType } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownerSessionMutation, signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import {
  INSPIRATION_PRIVATE as P, PRIVATE_PROCESSORS, cleanLine, parseByteRange, privateMediaPath,
} from "../lib/inspiration";
import { signatureMismatch, sniffFileSignature } from "../lib/file-signature";

// Private originals for inspiration. Catalogue privacy (owner-scoped rows)
// is not byte privacy: the public R2 bucket serves any key it holds for a
// year. So personal material never goes there. It is uploaded to Convex file
// storage, recorded here, and read back only through
// /api/inspiration/media/<id>, which checks the signed-in session or an agent
// token and streams the bytes with `Cache-Control: private, no-store`. That
// route reaches this module's HTTP action with a short-lived signed token;
// no storage URL is ever returned to any caller.
//
// Before a file is recorded its first bytes must match its declared type
// (an HTML error page saved as photo.jpg is refused and its upload removed).
// Images get a display copy and a thumbnail, re-encoded with no EXIF, GPS or
// maker notes (convex/inspirationPrivateNode.ts), served through the same
// route with ?variant=display|thumb. Only Michael, signed in, can delete a
// private original or clear an outside processor for it.

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

const derivativesValidator = v.union(v.literal("pending"), v.literal("ready"), v.literal("original_only"), v.literal("failed"));

export const privateMediaView = (row: PrivateMedia) => {
  const path = privateMediaPath(row._id);
  return {
    mediaId: row._id, kind: row.kind, url: path, contentType: row.contentType, size: row.size,
    sha256: row.sha256, width: row.width, height: row.height, label: row.label, createdAt: row.createdAt,
    // The clean copies (no EXIF / GPS), when this format has them.
    displayUrl: row.displayStorageId ? `${path}?variant=display` : undefined,
    thumbUrl: row.thumbStorageId ? `${path}?variant=thumb` : undefined,
    displayWidth: row.displayWidth, displayHeight: row.displayHeight,
    derivatives: row.derivatives ?? "original_only",
    derivativesNote: row.derivativesNote,
    externalProcessing: row.externalProcessing,
    clearedProcessors: (row.clearedProcessors ?? []).map((entry) => entry.name),
    signature: row.signature,
    captureId: row.captureId,
  };
};

export const privateMediaViewValidator = v.object({
  mediaId: v.id("inspirationPrivateMedia"), kind: v.union(v.literal("image"), v.literal("video"), v.literal("audio")),
  url: v.string(), contentType: v.string(), size: v.number(), sha256: v.string(),
  width: v.optional(v.number()), height: v.optional(v.number()), label: v.optional(v.string()), createdAt: v.number(),
  displayUrl: v.optional(v.string()), thumbUrl: v.optional(v.string()),
  displayWidth: v.optional(v.number()), displayHeight: v.optional(v.number()),
  derivatives: derivativesValidator, derivativesNote: v.optional(v.string()),
  externalProcessing: v.union(v.literal("none"), v.literal("cleared")),
  clearedProcessors: v.array(v.string()),
  signature: v.optional(v.string()),
  captureId: v.optional(v.id("inspirationCaptures")),
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

/* ── Recording (called by the checked attach action only) ──────────────── */

export const recordArgs = {
  ownerUserId: v.string(),
  storageId: v.id("_storage"),
  ingestKey: v.string(),
  sourceId: v.optional(v.id("inspirationSources")),
  sha256: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  label: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  // The capture key the source was registered with: files the bytes under that intake event.
  captureKey: v.optional(v.string()),
  // What the first bytes said (the action checked it against the declared type).
  signature: v.optional(v.string()),
};

type RecordArgs = ObjectType<typeof recordArgs>;
const recordResult = v.object({ media: privateMediaViewValidator, created: v.boolean() });

/**
 * Record an uploaded private original. Checks the bytes storage actually
 * holds (size, type, hash) against the limits and the caller's hash, refuses
 * a storageId already recorded for anyone, and is idempotent on ingestKey.
 */
export const recordPrivateMediaHandler = async (ctx: MutationCtx, args: RecordArgs) => {
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
  let captureId: Id<"inspirationCaptures"> | undefined;
  if (args.sourceId) {
    const source = await ctx.db.get(args.sourceId);
    if (!source || !owns(owner, source)) fail("Inspiration source not found.");
    const captureKey = cleanLine(args.captureKey, 300);
    if (captureKey) {
      const captures = [];
      for (const candidate of resolveUserIdCandidates(owner)) {
        captures.push(...await ctx.db.query("inspirationCaptures")
          .withIndex("by_owner_captureKey", (q) => q.eq("ownerUserId", candidate).eq("captureKey", captureKey)).take(50));
      }
      const capture = captures.filter((row) => row.sourceId === args.sourceId)
        .sort((a, b) => b.captureRevision - a.captureRevision || b.createdAt - a.createdAt)[0];
      if (!capture) fail(`No capture ${captureKey} on this source. Register the source with that capture key first.`);
      captureId = capture!._id;
    }
  } else if (args.captureKey) {
    fail("captureKey needs the sourceId it was registered on.");
  }
  const now = Date.now();
  const id = await ctx.db.insert("inspirationPrivateMedia", {
    ownerUserId: owner, storageId: args.storageId, sourceId: args.sourceId, ingestKey, kind, contentType,
    size: meta!.size, sha256, width: args.width, height: args.height, label: cleanLine(args.label, 120),
    externalProcessing: "none", ...(captureId ? { captureId } : {}),
    ...(args.signature ? { signature: cleanLine(args.signature, 20) } : {}),
    derivatives: kind === "image" ? "pending" : "original_only",
    ...(kind === "image" ? {} : { derivativesNote: "Video and voice are kept as received; no clean copy is made." }),
    createdBy: cleanLine(args.createdBy, 80) ?? "agent", createdAt: now,
  });
  if (captureId) {
    const capture = (await ctx.db.get(captureId))!;
    await ctx.db.patch(captureId, { privateMediaIds: [...capture.privateMediaIds, id].slice(0, P.perSource), updatedAt: now });
  }
  if (args.sourceId) {
    const source = (await ctx.db.get(args.sourceId))!;
    await ctx.db.patch(source._id, { revision: source.revision + 1, updatedAt: now });
  }
  return { media: privateMediaView((await ctx.db.get(id))!), created: true };
};

export const recordPrivateMedia = internalMutation({ args: recordArgs, returns: recordResult, handler: recordPrivateMediaHandler });

/** For the attach action: is this upload already recorded, and what does storage say it is? */
export const uploadState = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.object({ recorded: v.boolean(), contentType: v.optional(v.string()), size: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const taken = await ctx.db.query("inspirationPrivateMedia").withIndex("by_storageId", (q) => q.eq("storageId", args.storageId)).first();
    const meta = await ctx.db.system.get(args.storageId);
    return { recorded: Boolean(taken), contentType: meta?.contentType?.split(";")[0]?.trim().toLowerCase(), size: meta?.size };
  },
});

export const setDerivatives = internalMutation({
  args: {
    mediaId: v.id("inspirationPrivateMedia"),
    derivatives: derivativesValidator,
    note: v.optional(v.string()),
    display: v.optional(v.object({ storageId: v.id("_storage"), width: v.number(), height: v.number() })),
    thumb: v.optional(v.object({ storageId: v.id("_storage"), width: v.number(), height: v.number() })),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mediaId);
    // Deleted meanwhile: the copies are not kept either.
    if (!row) {
      if (args.display) await ctx.storage.delete(args.display.storageId);
      if (args.thumb) await ctx.storage.delete(args.thumb.storageId);
      return false;
    }
    await ctx.db.patch(row._id, {
      derivatives: args.derivatives, derivativesNote: cleanLine(args.note, 300),
      ...(args.display ? { displayStorageId: args.display.storageId, displayWidth: args.display.width, displayHeight: args.display.height } : {}),
      ...(args.thumb ? { thumbStorageId: args.thumb.storageId, thumbWidth: args.thumb.width, thumbHeight: args.thumb.height } : {}),
    });
    return true;
  },
});

/* ── The checked attach (the action in inspirationPrivateNode.ts) ──────── */

export type CleanCopy = { bytes: Uint8Array; width: number; height: number };
export type CutCopies = (bytes: Uint8Array) => Promise<{ display: CleanCopy; thumb: CleanCopy } | { note: string }>;

type AttachCtx = Pick<ActionCtx, "runQuery" | "runMutation" | "storage">;

/**
 * Sniff, record, then cut the clean copies. A file whose first bytes do not
 * match its declared type is refused and its fresh upload removed (an
 * unrecorded upload is nobody's file). Repeats of a recorded upload skip the
 * sniff and return the existing row.
 */
type AttachResult = Infer<typeof recordResult>;

export const attachChecked = async (ctx: AttachCtx, args: RecordArgs, cut: CutCopies): Promise<AttachResult> => {
  const state = await ctx.runQuery(internal.inspirationPrivate.uploadState, { storageId: args.storageId });
  let signature: string | undefined;
  if (!state.recorded) {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) fail("Upload not found. POST the file to the upload URL first.");
    const head = new Uint8Array(await blob!.slice(0, 64).arrayBuffer());
    const sniffed = sniffFileSignature(head);
    const declared = state.contentType ?? "";
    const problem = P.types[declared] ? signatureMismatch(declared, sniffed) : null;
    if (problem) {
      await ctx.storage.delete(args.storageId);
      fail(problem);
    }
    signature = sniffed;
  }
  const result: AttachResult = await ctx.runMutation(internal.inspirationPrivate.recordPrivateMedia, { ...args, ...(signature ? { signature } : {}) });
  if (!result.created || result.media.kind !== "image") return result;
  const blob = await ctx.storage.get(args.storageId);
  let outcome: { derivatives: "ready" | "original_only" | "failed"; note?: string; display?: { storageId: Id<"_storage">; width: number; height: number }; thumb?: { storageId: Id<"_storage">; width: number; height: number } };
  try {
    const copies = blob ? await cut(new Uint8Array(await blob.arrayBuffer())) : { note: "The upload could not be read back." };
    if ("note" in copies) {
      outcome = { derivatives: "original_only", note: copies.note };
    } else {
      const display = await ctx.storage.store(new Blob([copies.display.bytes as BlobPart], { type: "image/webp" }));
      const thumb = await ctx.storage.store(new Blob([copies.thumb.bytes as BlobPart], { type: "image/webp" }));
      outcome = {
        derivatives: "ready",
        display: { storageId: display, width: copies.display.width, height: copies.display.height },
        thumb: { storageId: thumb, width: copies.thumb.width, height: copies.thumb.height },
      };
    }
  } catch (error) {
    outcome = { derivatives: "failed", note: `The clean copy failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
  }
  await ctx.runMutation(internal.inspirationPrivate.setDerivatives, { mediaId: result.media.mediaId, ...outcome });
  const media: AttachResult["media"] | null = await ctx.runQuery(internal.inspirationPrivate.mediaViewById, { mediaId: result.media.mediaId });
  return { media: media ?? result.media, created: true };
};

export const mediaViewById = internalQuery({
  args: { mediaId: v.id("inspirationPrivateMedia") },
  returns: v.union(v.null(), privateMediaViewValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mediaId);
    return row ? privateMediaView(row) : null;
  },
});

/* ── Michael's controls (signed-in browser session only) ───────────────── */

/**
 * Delete a private original for good: the bytes, the clean copies and the
 * row. Leaves a tombstone (hash, size, type, when) so the deletion itself is
 * on record. Agents cannot call this.
 */
export const deletePrivateMedia = ownerSessionMutation({
  args: { ownerUserId: v.string(), mediaId: v.id("inspirationPrivateMedia") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mediaId);
    if (!row || !owns(args.ownerUserId, row)) return { deleted: false };
    for (const id of [row.storageId, row.displayStorageId, row.thumbStorageId]) {
      if (id && await ctx.db.system.get(id)) await ctx.storage.delete(id);
    }
    if (row.captureId) {
      const capture = await ctx.db.get(row.captureId);
      if (capture) await ctx.db.patch(capture._id, { privateMediaIds: capture.privateMediaIds.filter((id) => id !== row._id), updatedAt: Date.now() });
    }
    await ctx.db.delete(row._id);
    const now = Date.now();
    await ctx.db.insert("inspirationPrivateDeletions", {
      ownerUserId: row.ownerUserId, mediaId: row._id, sourceId: row.sourceId, sha256: row.sha256, size: row.size,
      contentType: row.contentType, by: "owner", deletedAt: now,
    });
    if (row.sourceId) {
      const source = await ctx.db.get(row.sourceId);
      if (source) await ctx.db.patch(source._id, { revision: source.revision + 1, updatedAt: now });
    }
    return { deleted: true };
  },
});

/**
 * Clear (or withdraw) one named outside processor for every private file of
 * a source. Until a processor is cleared, no paid job for that source may
 * use it (inspirationDispatch.reserveInspirationJob checks).
 */
export const setPrivateProcessor = ownerSessionMutation({
  args: { ownerUserId: v.string(), sourceId: v.id("inspirationSources"), processor: v.string(), cleared: v.boolean() },
  returns: v.object({ files: v.number(), processors: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const name = args.processor.trim().toLowerCase();
    if (!(PRIVATE_PROCESSORS as readonly string[]).includes(name)) fail(`Unknown processor ${args.processor}.`);
    const source = await ctx.db.get(args.sourceId);
    if (!source || !owns(args.ownerUserId, source)) fail("Inspiration source not found.");
    const rows = await privateMediaOfSource(ctx, args.ownerUserId, args.sourceId);
    const now = Date.now();
    const cleared = new Set<string>();
    for (const row of rows) {
      const current = (row.clearedProcessors ?? []).filter((entry) => entry.name !== name);
      const next = args.cleared ? [...current, { name, clearedAt: now }] : current;
      for (const entry of next) cleared.add(entry.name);
      await ctx.db.patch(row._id, { clearedProcessors: next, externalProcessing: next.length ? "cleared" : "none" });
    }
    await ctx.db.patch(source!._id, { revision: source!.revision + 1, updatedAt: now });
    return { files: rows.length, processors: [...cleared].sort() };
  },
});

/** Private files of a source an outside processor may not see (for the dispatch check). */
export const privateFilesBlockingProcessor = async (ctx: Ctx, owner: string, sourceId: Id<"inspirationSources">, provider: string) => {
  const name = provider.trim().toLowerCase();
  return (await privateMediaOfSource(ctx, owner, sourceId))
    .filter((row) => !(row.clearedProcessors ?? []).some((entry) => entry.name === name)).length;
};

/** Michael's export: every private original's record, newest first (bytes through the gated route). */
export const listPrivateMediaForExport = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({
    ...privateMediaViewValidator.fields,
    sourceId: v.optional(v.id("inspirationSources")), sourceTitle: v.optional(v.string()), ingestKey: v.string(),
  })),
  handler: async (ctx, args) => {
    const rows: PrivateMedia[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("inspirationPrivateMedia").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate)).take(P.exportMax));
    }
    const titles = new Map<string, string | undefined>();
    const out = [];
    for (const row of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      if (row.sourceId && !titles.has(row.sourceId)) titles.set(row.sourceId, (await ctx.db.get(row.sourceId))?.title);
      out.push({ ...privateMediaView(row), sourceId: row.sourceId, sourceTitle: row.sourceId ? titles.get(row.sourceId) : undefined, ingestKey: row.ingestKey });
    }
    return out;
  },
});

/* ── Delivery ───────────────────────────────────────────────────────────── */

export const PRIVATE_VARIANTS = ["original", "display", "thumb"] as const;
export type PrivateVariant = (typeof PRIVATE_VARIANTS)[number];

/** For the HTTP action only: the bytes to serve, if the caller owns the file. */
export const privateMediaForCaller = internalQuery({
  args: { caller: v.string(), mediaId: v.string(), variant: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), contentType: v.string(), size: v.number(), sha256: v.string(), variant: v.string() })),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("inspirationPrivateMedia", args.mediaId);
    if (!id) return null;
    const row = await ctx.db.get(id);
    if (!row || !owns(args.caller, row)) return null;
    return pickVariant(row, args.variant);
  },
});

/**
 * Which stored bytes a variant serves. No variant = the clean display copy
 * when there is one (so a shared or agent read never carries GPS), else the
 * original. thumb never falls back to the original; original is explicit.
 */
export const pickVariant = (row: PrivateMedia, variant: string | undefined) => {
  const wanted = (PRIVATE_VARIANTS as readonly string[]).includes(variant ?? "") ? variant as PrivateVariant : undefined;
  if (wanted === "thumb") {
    return row.thumbStorageId ? { storageId: row.thumbStorageId, contentType: "image/webp", size: 0, sha256: `${row.sha256}-thumb`, variant: "thumb" } : null;
  }
  if ((wanted === "display" || wanted === undefined) && row.displayStorageId) {
    return { storageId: row.displayStorageId, contentType: "image/webp", size: 0, sha256: `${row.sha256}-display`, variant: "display" };
  }
  if (wanted === "display") return null;
  return { storageId: row.storageId, contentType: row.contentType, size: row.size, sha256: row.sha256, variant: "original" };
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-site",
  "Referrer-Policy": "no-referrer",
};

type ServeCtx = Pick<ActionCtx, "auth" | "runQuery" | "storage">;

/** GET ?id=<mediaId>[&variant=original|display|thumb] with a signed Bearer token. 401 without one; 404 for anyone but the owner. */
export const servePrivateMedia = async (ctx: ServeCtx, request: Request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return new Response("Not authenticated.", { status: 401, headers: PRIVATE_HEADERS });
  const params = new URL(request.url).searchParams;
  const mediaId = params.get("id") ?? "";
  const row = await ctx.runQuery(internal.inspirationPrivate.privateMediaForCaller, {
    caller: identity.subject, mediaId, variant: params.get("variant") ?? undefined,
  });
  if (!row) return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
  const blob = await ctx.storage.get(row.storageId);
  if (!blob) return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
  const range = parseByteRange(request.headers.get("range"), blob.size);
  const common = {
    ...PRIVATE_HEADERS, "Content-Type": row.contentType, "Accept-Ranges": "bytes", ETag: `"${row.sha256}"`,
    "Content-Disposition": params.get("download") === "1" && row.variant === "original" ? "attachment" : "inline",
    "X-Private-Variant": row.variant,
  };
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${blob.size}` } });
  if (range) {
    return new Response(blob.slice(range.start, range.end + 1), {
      status: 206, headers: { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${blob.size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(blob, { status: 200, headers: { ...common, "Content-Length": String(blob.size) } });
};

export const privateMediaHttp = httpAction(servePrivateMedia);
