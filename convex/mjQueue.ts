import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { resolveWorld } from "./worldCore";
import { mjQueueDescribeValidator, mjQueueItemFields, mjQueueRefValidator, mjQueueStatusValidator } from "./mjQueueValidators";
import { MJ_QUEUE_LIMITS, batchKeyOf, composeMjCommand } from "../lib/mj-queue";

// Midjourney prompt queue. Agents queue prompts with their references set;
// Michael reviews each one in the Imagine bar (extension Queue panel) and
// sends it himself. Nothing here submits anything to Midjourney.

type Item = Doc<"mjQueueItems">;
type Ctx = QueryCtx | MutationCtx;

const refInput = v.object({
  url: v.optional(v.string()),
  code: v.optional(v.string()),
  assetId: v.optional(v.string()),
  weight: v.optional(v.number()),
  label: v.optional(v.string()),
});
type RefInput = Infer<typeof refInput>;
type Ref = Infer<typeof mjQueueRefValidator>;

const itemInput = v.object({
  ingestKey: v.optional(v.string()),
  title: v.optional(v.string()),
  prompt: v.string(),
  imagePrompts: v.optional(v.array(refInput)),
  styleRefs: v.optional(v.array(refInput)),
  omniRef: v.optional(refInput),
  characterRef: v.optional(refInput),
  profileCodes: v.optional(v.array(v.string())),
  params: v.optional(v.string()),
  note: v.optional(v.string()),
  order: v.optional(v.number()),
  describe: v.optional(mjQueueDescribeValidator),
});

const { ownerUserId: _owner, ...publicFields } = mjQueueItemFields;
void _owner;
export const mjQueueItemOutValidator = v.object({
  id: v.id("mjQueueItems"),
  ...publicFields,
  command: v.string(),
  warnings: v.array(v.string()),
});

const batchOutValidator = v.object({
  batch: v.string(),
  batchKey: v.string(),
  worldKey: v.optional(v.string()),
  total: v.number(),
  queued: v.number(),
  injected: v.number(),
  sent: v.number(),
  skipped: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const text = (value: string | null | undefined, max: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return trimmed;
};

const toOut = (row: Item) => {
  const { _id, _creationTime, ownerUserId, ...rest } = row;
  void _creationTime;
  void ownerUserId;
  return { id: _id, ...rest, ...composeMjCommand(row) };
};

const assetRefPattern = /^asset:/;

export async function resolveRef(ctx: Ctx, owner: string, input: RefInput, label: string): Promise<Ref> {
  const weight = typeof input.weight === "number" && Number.isFinite(input.weight) ? input.weight : undefined;
  const refLabel = text(input.label, 120, "A reference label");
  const rawUrl = input.url?.trim();
  const assetRef = input.assetId?.trim() || (rawUrl && assetRefPattern.test(rawUrl) ? rawUrl : undefined);
  if (assetRef) {
    const bare = assetRef.replace(assetRefPattern, "");
    const assetId = ctx.db.normalizeId("assets", bare);
    const asset = assetId ? await ctx.db.get(assetId) : null;
    if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) {
      throw new ConvexError(`${label}: no gallery image ${assetRef}.`);
    }
    if (asset.kind !== "image") throw new ConvexError(`${label}: ${assetRef} is a video; Midjourney references are images.`);
    const url = await resolveAssetUrl(ctx, asset);
    if (!url || !/^https:\/\//.test(url)) {
      throw new ConvexError(`${label}: ${assetRef} has no public image URL Midjourney can fetch.`);
    }
    const thumbUrl = (await resolveAssetThumbUrl(ctx, asset)) ?? url;
    return { url, assetId: asset._id, thumbUrl, weight, label: refLabel };
  }
  if (rawUrl) {
    if (rawUrl.length > MJ_QUEUE_LIMITS.url || !/^https?:\/\/\S+$/.test(rawUrl)) {
      throw new ConvexError(`${label}: "${rawUrl.slice(0, 80)}" is not a public image URL.`);
    }
    return { url: rawUrl, thumbUrl: rawUrl, weight, label: refLabel };
  }
  const code = input.code?.trim();
  if (code) {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(code)) throw new ConvexError(`${label}: "${code}" is not an sref code.`);
    return { code, weight, label: refLabel };
  }
  throw new ConvexError(`${label}: give a url, an asset:<id> or a code.`);
}

export async function resolveRefs(ctx: Ctx, owner: string, inputs: RefInput[] | undefined, max: number, label: string) {
  const list = inputs ?? [];
  if (list.length > max) throw new ConvexError(`At most ${max} ${label.toLowerCase()}s per prompt.`);
  const out: Ref[] = [];
  for (const [index, input] of list.entries()) out.push(await resolveRef(ctx, owner, input, `${label} ${index + 1}`));
  return out;
}

const cleanCodes = (codes: string[] | undefined) => {
  const out = [...new Set((codes ?? []).map((code) => code.trim().replace(/^--?p(?:rofile)?\s+/, "")).filter(Boolean))];
  if (out.length > MJ_QUEUE_LIMITS.profileCodes) throw new ConvexError(`At most ${MJ_QUEUE_LIMITS.profileCodes} profile codes.`);
  for (const code of out) {
    if (!/^[A-Za-z0-9]{1,40}$/.test(code)) throw new ConvexError(`"${code}" is not a Midjourney profile code (e.g. vtrctg9, m7510337594627371941).`);
  }
  return out;
};

async function ownedRows(ctx: Ctx, owner: string) {
  const rows: Item[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("mjQueueItems")
      .withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate))
      .order("desc").take(MJ_QUEUE_LIMITS.listItems * 2));
  }
  return rows;
}

export async function batchRows(ctx: Ctx, owner: string, batchKey: string) {
  const rows: Item[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("mjQueueItems")
      .withIndex("by_owner_batchKey_order", (q) => q.eq("ownerUserId", candidate).eq("batchKey", batchKey))
      .take(MJ_QUEUE_LIMITS.itemsPerBatch + 1));
  }
  return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

async function itemFor(ctx: Ctx, owner: string, ref: string) {
  const id = ctx.db.normalizeId("mjQueueItems", ref.trim().replace(/^mjq(?:ueue)?:/, ""));
  const row = id ? await ctx.db.get(id) : null;
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) throw new ConvexError(`No queued prompt ${ref}.`);
  return row;
}

export const listQueue = ownerQuery({
  args: {
    ownerUserId: v.string(),
    batch: v.optional(v.string()),
    world: v.optional(v.string()),
    status: v.optional(mjQueueStatusValidator),
    includeDone: v.optional(v.boolean()),
  },
  returns: v.object({ batches: v.array(batchOutValidator), items: v.array(mjQueueItemOutValidator) }),
  handler: async (ctx, args) => {
    const worldKey = args.world?.trim() ? (await resolveWorld(ctx, args.ownerUserId, args.world)).worldKey : undefined;
    const rows = (await ownedRows(ctx, args.ownerUserId)).filter((row) => !worldKey || row.worldKey === worldKey);

    const batches = new Map<string, Infer<typeof batchOutValidator>>();
    for (const row of rows) {
      const entry = batches.get(row.batchKey) ?? {
        batch: row.batch, batchKey: row.batchKey, worldKey: row.worldKey,
        total: 0, queued: 0, injected: 0, sent: 0, skipped: 0, createdAt: row.createdAt, updatedAt: row.updatedAt,
      };
      entry.total += 1;
      entry[row.status] += 1;
      entry.createdAt = Math.min(entry.createdAt, row.createdAt);
      entry.updatedAt = Math.max(entry.updatedAt, row.updatedAt);
      batches.set(row.batchKey, entry);
    }

    const batchKey = args.batch?.trim() ? batchKeyOf(args.batch) : undefined;
    const items = rows
      .filter((row) => !batchKey || row.batchKey === batchKey)
      .filter((row) => (args.status ? row.status === args.status : args.includeDone !== false || row.status === "queued" || row.status === "injected"))
      .sort((a, b) => a.batchKey.localeCompare(b.batchKey) || a.order - b.order || a.createdAt - b.createdAt)
      .slice(0, MJ_QUEUE_LIMITS.listItems)
      .map(toOut);
    // Batches with prompts still to send first, then the newest.
    const batchList = [...batches.values()].sort((a, b) =>
      Number(b.queued + b.injected > 0) - Number(a.queued + a.injected > 0) || b.updatedAt - a.updatedAt);
    return { batches: batchList, items };
  },
});

export const queueItems = ownerMutation({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    world: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    items: v.array(itemInput),
  },
  returns: v.object({
    batch: v.string(),
    batchKey: v.string(),
    worldKey: v.optional(v.string()),
    items: v.array(v.object({
      id: v.id("mjQueueItems"), ingestKey: v.optional(v.string()), created: v.boolean(), order: v.number(),
      command: v.string(), warnings: v.array(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const batch = text(args.batch, MJ_QUEUE_LIMITS.batch, "A batch label")?.replace(/\s+/g, " ");
    if (!batch) throw new ConvexError("Name the batch (e.g. Dear Annete · name lettering studies).");
    if (args.items.length === 0 || args.items.length > MJ_QUEUE_LIMITS.itemsPerCall) {
      throw new ConvexError(`Queue 1 to ${MJ_QUEUE_LIMITS.itemsPerCall} prompts per call.`);
    }
    const batchKey = batchKeyOf(batch);
    const world = args.world?.trim() ? await resolveWorld(ctx, owner, args.world) : null;
    const existing = await batchRows(ctx, owner, batchKey);
    let maxOrder = existing.reduce((max, row) => Math.max(max, row.order), 0);
    let count = existing.length;
    const createdBy = text(args.createdBy, 80, "createdBy") ?? "agent";
    const now = Date.now();
    const out = [];

    for (const [index, input] of args.items.entries()) {
      const ingestKey = text(input.ingestKey, 200, "An ingestKey");
      if (ingestKey) {
        let found: Item | null = null;
        for (const candidate of resolveUserIdCandidates(owner)) {
          found ??= await ctx.db.query("mjQueueItems")
            .withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
        }
        if (found) {
          out.push({ id: found._id, ingestKey, created: false, order: found.order, ...composeMjCommand(found) });
          continue;
        }
      }
      if (count >= MJ_QUEUE_LIMITS.itemsPerBatch) throw new ConvexError(`A batch holds at most ${MJ_QUEUE_LIMITS.itemsPerBatch} prompts.`);
      const label = `Prompt ${index + 1}`;
      const prompt = text(input.prompt, MJ_QUEUE_LIMITS.prompt, `${label} text`) ?? "";
      const imagePrompts = await resolveRefs(ctx, owner, input.imagePrompts, MJ_QUEUE_LIMITS.imagePrompts, "Image prompt");
      if (!prompt && imagePrompts.length === 0) throw new ConvexError(`${label} needs words or an image prompt.`);
      const order = typeof input.order === "number" && Number.isFinite(input.order) ? input.order : maxOrder + 1;
      maxOrder = Math.max(maxOrder, order);
      count += 1;
      const doc = {
        ownerUserId: owner,
        worldFolderId: world?._id,
        worldKey: world?.worldKey,
        batch, batchKey, order,
        title: text(input.title, MJ_QUEUE_LIMITS.title, `${label} title`),
        prompt,
        imagePrompts,
        styleRefs: await resolveRefs(ctx, owner, input.styleRefs, MJ_QUEUE_LIMITS.styleRefs, "Style reference"),
        omniRef: input.omniRef ? await resolveRef(ctx, owner, input.omniRef, "Omni reference") : undefined,
        characterRef: input.characterRef ? await resolveRef(ctx, owner, input.characterRef, "Character reference") : undefined,
        profileCodes: cleanCodes(input.profileCodes),
        params: text(input.params, MJ_QUEUE_LIMITS.params, `${label} params`),
        note: text(input.note, MJ_QUEUE_LIMITS.note, `${label} note`),
        describe: input.describe ? {
          sourceUrl: /^https:\/\//i.test(input.describe.sourceUrl ?? "") ? input.describe.sourceUrl!.slice(0, MJ_QUEUE_LIMITS.url) : undefined,
          pageUrl: /^https?:\/\//i.test(input.describe.pageUrl ?? "") ? input.describe.pageUrl!.slice(0, MJ_QUEUE_LIMITS.url) : undefined,
          descriptions: input.describe.descriptions.map((line) => line.trim().slice(0, 1500)).filter(Boolean).slice(0, 4),
          mode: input.describe.mode,
        } : undefined,
        status: "queued" as const,
        ingestKey,
        createdBy,
        createdAt: now,
        updatedAt: now,
      };
      const id = await ctx.db.insert("mjQueueItems", doc);
      out.push({ id, ingestKey, created: true, order, ...composeMjCommand(doc) });
    }
    return { batch, batchKey, worldKey: world?.worldKey, items: out };
  },
});

const clearableText = v.optional(v.union(v.string(), v.null()));

export const updateItem = ownerMutation({
  args: {
    ownerUserId: v.string(),
    itemId: v.string(),
    title: clearableText,
    prompt: v.optional(v.string()),
    imagePrompts: v.optional(v.array(refInput)),
    styleRefs: v.optional(v.array(refInput)),
    omniRef: v.optional(v.union(refInput, v.null())),
    characterRef: v.optional(v.union(refInput, v.null())),
    profileCodes: v.optional(v.array(v.string())),
    params: clearableText,
    note: clearableText,
    status: v.optional(mjQueueStatusValidator),
    jobId: clearableText,
    sentCommand: v.optional(v.string()),
    // 0-based place inside its batch; the others shift around it.
    position: v.optional(v.number()),
  },
  returns: mjQueueItemOutValidator,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const row = await itemFor(ctx, owner, args.itemId);
    const now = Date.now();
    const patch: Partial<Item> = { updatedAt: now };
    const clear = <K extends keyof Item>(key: K, value: string | null | undefined, max: number, label: string) => {
      if (value === undefined) return;
      patch[key] = (value === null ? undefined : text(value, max, label)) as Item[K];
    };
    clear("title", args.title, MJ_QUEUE_LIMITS.title, "A title");
    clear("params", args.params, MJ_QUEUE_LIMITS.params, "Params");
    clear("note", args.note, MJ_QUEUE_LIMITS.note, "A note");
    if (args.jobId !== undefined) {
      const jobId = args.jobId === null ? undefined : text(args.jobId, 80, "A job id");
      if (jobId && !/^[0-9a-f-]{8,80}$/i.test(jobId)) throw new ConvexError(`"${jobId}" is not a Midjourney job id.`);
      patch.jobId = jobId;
    }
    if (args.prompt !== undefined) patch.prompt = text(args.prompt, MJ_QUEUE_LIMITS.prompt, "Prompt text") ?? "";
    if (args.imagePrompts) patch.imagePrompts = await resolveRefs(ctx, owner, args.imagePrompts, MJ_QUEUE_LIMITS.imagePrompts, "Image prompt");
    if (args.styleRefs) patch.styleRefs = await resolveRefs(ctx, owner, args.styleRefs, MJ_QUEUE_LIMITS.styleRefs, "Style reference");
    if (args.omniRef !== undefined) patch.omniRef = args.omniRef ? await resolveRef(ctx, owner, args.omniRef, "Omni reference") : undefined;
    if (args.characterRef !== undefined) {
      patch.characterRef = args.characterRef ? await resolveRef(ctx, owner, args.characterRef, "Character reference") : undefined;
    }
    if (args.profileCodes) patch.profileCodes = cleanCodes(args.profileCodes);
    if (args.sentCommand !== undefined) patch.sentCommand = text(args.sentCommand, MJ_QUEUE_LIMITS.prompt + 2000, "The sent command");
    if (args.status && args.status !== row.status) {
      patch.status = args.status;
      if (args.status === "injected") patch.injectedAt = now;
      if (args.status === "sent") patch.sentAt = now;
    } else if (args.status === "sent" && !row.sentAt) {
      patch.sentAt = now;
    }
    const next = { ...row, ...patch };
    if (!next.prompt && next.imagePrompts.length === 0) throw new ConvexError("A prompt needs words or an image prompt.");

    if (typeof args.position === "number" && Number.isFinite(args.position)) {
      const siblings = (await batchRows(ctx, owner, row.batchKey)).filter((other) => other._id !== row._id);
      const at = Math.max(0, Math.min(siblings.length, Math.round(args.position)));
      siblings.splice(at, 0, row);
      for (const [index, sibling] of siblings.entries()) {
        const order = index + 1;
        if (sibling._id === row._id) patch.order = order;
        else if (sibling.order !== order) await ctx.db.patch(sibling._id, { order });
      }
    }
    await ctx.db.patch(row._id, patch);
    const saved = await ctx.db.get(row._id);
    return toOut(saved!);
  },
});

export type MjQueueItemId = Id<"mjQueueItems">;
