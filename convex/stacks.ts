import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation } from "./actor";
import { canActorAccessOwnerUserId } from "./authz";
import { reconcileAssetPackMembership, syncPromptAssetPack } from "./assetPackHelpers";

// Stacks of alternates: near-identical images collapsed under one cover. A
// stack is an asset pack of kind "stack" (the grid already shows a pack as one
// card with a count). Every image, prompt and membership stays; prompt-pack
// syncing never moves a stack's members. Used by Inbox duplicates decisions
// and by "Group similar" in the grid.

const MAX_STACK = 50;

export type StackRecord = {
  packId: Id<"assetPacks">;
  members: Id<"assets">[];
  // Each member's pack before, to restore on undo.
  previous: Array<{ assetId: Id<"assets">; packId?: Id<"assetPacks">; slot?: number }>;
};

export const stackRecordValidator = v.object({
  packId: v.id("assetPacks"),
  members: v.array(v.id("assets")),
  previous: v.array(v.object({ assetId: v.id("assets"), packId: v.optional(v.id("assetPacks")), slot: v.optional(v.number()) })),
});

/** Members in order: the cover first, then the alternates. */
export const stackAssetsInto = async (ctx: MutationCtx, title: string, members: Doc<"assets">[]): Promise<StackRecord> => {
  const now = Date.now();
  const cover = members[0]!;
  const packId = await ctx.db.insert("assetPacks", {
    ownerUserId: cover.ownerUserId, kind: "stack", title: title.slice(0, 96) || "Stack", tagIds: [],
    coverAssetId: cover._id, isPublic: cover.isPublic ?? false, isFeatured: cover.isFeatured ?? false,
    itemCount: members.length, createdAt: now, updatedAt: now,
  });
  const previous = members.map((asset) => ({ assetId: asset._id, packId: asset.assetPackId, slot: asset.packSlotIndex }));
  for (const [slot, asset] of members.entries()) await ctx.db.patch(asset._id, { assetPackId: packId, packSlotIndex: slot });
  for (const oldPackId of new Set(previous.map((entry) => entry.packId).filter((id): id is Id<"assetPacks"> => Boolean(id)))) {
    await reconcileAssetPackMembership(ctx, oldPackId);
  }
  return { packId, members: members.map((asset) => asset._id), previous };
};

/** Undo a stack: members leave it, the stack row goes, earlier packs come back. */
export const unstack = async (ctx: MutationCtx, record: StackRecord) => {
  for (const assetId of record.members) {
    const asset = await ctx.db.get(assetId);
    if (asset?.assetPackId === record.packId) await ctx.db.patch(assetId, { assetPackId: undefined, packSlotIndex: undefined });
  }
  if (await ctx.db.get(record.packId)) await ctx.db.delete(record.packId);
  const restoredPacks = new Set<Id<"assetPacks">>();
  const prompts = new Map<Id<"prompts">, string>();
  for (const entry of record.previous) {
    const asset = await ctx.db.get(entry.assetId);
    if (!asset) continue;
    if (entry.packId && await ctx.db.get(entry.packId)) {
      await ctx.db.patch(asset._id, { assetPackId: entry.packId, packSlotIndex: entry.slot });
      restoredPacks.add(entry.packId);
    } else if (entry.packId && asset.promptId) {
      // It was in a prompt pack that the stack emptied; rebuild that pack.
      const prompt = await ctx.db.get(asset.promptId);
      if (prompt?.ownerUserId) prompts.set(prompt._id, prompt.ownerUserId);
    }
  }
  for (const packId of restoredPacks) await reconcileAssetPackMembership(ctx, packId);
  for (const [promptId, ownerUserId] of prompts) await syncPromptAssetPack(ctx, { ownerUserId, promptId });
};

// "Stack" from a Group-similar cluster in the grid. Returns the record the
// screen keeps for its undo.
export const stackAssets = ownerMutation({
  args: {
    ownerUserId: v.string(),
    // The cover first.
    assetIds: v.array(v.id("assets")),
    title: v.optional(v.string()),
  },
  returns: stackRecordValidator,
  handler: async (ctx, args) => {
    const ids = [...new Set(args.assetIds)];
    if (ids.length < 2) throw new ConvexError("A stack needs at least two images.");
    if (ids.length > MAX_STACK) throw new ConvexError(`A stack holds at most ${MAX_STACK} images.`);
    const members: Doc<"assets">[] = [];
    for (const assetId of ids) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) throw new ConvexError(`Asset not found: asset:${assetId}`);
      members.push(asset);
    }
    return await stackAssetsInto(ctx, args.title?.trim() || "Similar images", members);
  },
});

export const unstackAssets = ownerMutation({
  args: { ownerUserId: v.string(), record: stackRecordValidator },
  returns: v.object({ unstacked: v.boolean() }),
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.record.packId);
    if (!pack) return { unstacked: false };
    if (pack.kind !== "stack" || !canActorAccessOwnerUserId(args.ownerUserId, pack.ownerUserId)) throw new ConvexError("Stack not found.");
    await unstack(ctx, args.record);
    return { unstacked: true };
  },
});
