import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { recountFolderMembers } from "./folderHelpers";
import { reconcileAssetPackMembership, syncPromptAssetPack } from "./assetPackHelpers";
import { syncPublicCollectionMembership } from "./publicCollectionCounts";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  inboxAppliedValidator, inboxCardTypeValidator, inboxChoiceValidator, inboxEvidenceValidator,
  inboxStackDocValidator, inboxStackStatusValidator, inboxTargetKindValidator, inboxTargetValidator,
} from "./inboxValidators";
import {
  INBOX_CARD_ASSETS, INBOX_CHOICES_BY_TYPE, INBOX_LIMITS, INBOX_OUT_FOLDER_NAME, clampBox,
  inboxCaption, type InboxCardType, type InboxChoice,
} from "../lib/inbox";

// The world Inbox ("Decisions" in the UI). Agents post cards into stacks that
// belong to a world (a root collection); Michael answers one card at a time.
// Agents state facts, never taste. Every decision is undoable: undo reverses
// exactly what the decision changed. Deleting an image (duplicates) is the
// one thing undo cannot bring back; the screen confirms it once per group and
// deletes through the gallery's own admin-checked delete route.

type Stack = Doc<"inboxStacks">;
type Card = Doc<"inboxCards">;
type Decision = Doc<"inboxDecisions">;
type Applied = Decision["applied"] extends (infer T)[] | undefined ? T : never;
type Target = NonNullable<Card["targets"]>[number];
type MembershipApplied = Extract<Applied, { kind: "moodboard" | "collection" }>;
type TargetInput = { label?: string; kind: Target["kind"]; moodboardId?: Id<"moodboards">; folderId?: Id<"folders"> };

const MOODBOARD_MAX_ITEMS = 1000;

const text = (value: string | null | undefined, max: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return trimmed;
};

const owns = (owner: string, row: { ownerUserId?: string } | null): boolean =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId));

const requireWorld = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || !owns(owner, folder)) throw new ConvexError("World not found.");
  if (folder.parentFolderId !== undefined || folder.kind !== undefined) {
    throw new ConvexError(`"${folder.name}" is not a world: an Inbox belongs to a root collection.`);
  }
  return folder;
};

const requireStack = async (ctx: QueryCtx, owner: string, stackId: Id<"inboxStacks">) => {
  const stack = await ctx.db.get(stackId);
  if (!stack || !owns(owner, stack)) throw new ConvexError("Stack not found.");
  return stack;
};

const requireCard = async (ctx: QueryCtx, owner: string, cardId: Id<"inboxCards">) => {
  const card = await ctx.db.get(cardId);
  if (!card || !owns(owner, card)) throw new ConvexError("Card not found.");
  const stack = await requireStack(ctx, owner, card.stackId);
  return { card, stack };
};

const requireOpen = (stack: Stack) => {
  if (stack.status !== "open") throw new ConvexError(`"${stack.title}" is closed.`);
};

const cardsOf = async (ctx: QueryCtx, stackId: Id<"inboxStacks">) =>
  (await ctx.db.query("inboxCards").withIndex("by_stack_position", (q) => q.eq("stackId", stackId)).collect())
    .sort((a, b) => a.position - b.position);

const decisionOf = (ctx: QueryCtx, cardId: Id<"inboxCards">) =>
  ctx.db.query("inboxDecisions").withIndex("by_card", (q) => q.eq("cardId", cardId)).first();

const decisionsOf = (ctx: QueryCtx, stackId: Id<"inboxStacks">) =>
  ctx.db.query("inboxDecisions").withIndex("by_stack", (q) => q.eq("stackId", stackId)).collect();

const countOf = (ctx: QueryCtx, stackId: Id<"inboxStacks">) =>
  ctx.db.query("inboxCounts").withIndex("by_stack", (q) => q.eq("stackId", stackId)).first();

const bumpCount = async (ctx: MutationCtx, stackId: Id<"inboxStacks">, change: { cards?: number; decided?: number }) => {
  const row = await countOf(ctx, stackId);
  if (!row) return;
  await ctx.db.patch(row._id, {
    cards: Math.max(0, row.cards + (change.cards ?? 0)),
    decided: Math.max(0, row.decided + (change.decided ?? 0)),
  });
};

const ownedAsset = async (ctx: QueryCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  return asset && owns(owner, asset) ? asset : null;
};

const previewValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

const previewFor = async (ctx: QueryCtx, asset: Doc<"assets">) => ({
  assetId: asset._id,
  kind: asset.kind,
  url: await resolveAssetUrl(ctx, asset),
  thumbUrl: await resolveAssetThumbUrl(ctx, asset),
  width: asset.width,
  height: asset.height,
});

/* ── Applying a decision and undoing it ──────────────────────────────────── */

const addToCollection = async (ctx: MutationCtx, folder: Doc<"folders">, asset: Doc<"assets">): Promise<MembershipApplied> => {
  const link = await ctx.db.query("assetFolders")
    .withIndex("by_asset_folder", (q) => q.eq("assetId", asset._id).eq("folderId", folder._id)).first();
  if (link || asset.folderId === folder._id) {
    return { kind: "collection", folderId: folder._id, assetId: asset._id, added: false, setPrimary: false };
  }
  // Additive: every other membership stays as it is.
  await ctx.db.insert("assetFolders", {
    ownerUserId: asset.ownerUserId ?? folder.ownerUserId ?? "", assetId: asset._id, folderId: folder._id, createdAt: Date.now(),
  });
  await recountFolderMembers(ctx, [folder._id]);
  const setPrimary = !asset.folderId;
  if (setPrimary) await ctx.db.patch(asset._id, { folderId: folder._id });
  await syncPublicCollectionMembership(ctx, asset._id);
  return { kind: "collection", folderId: folder._id, assetId: asset._id, added: true, setPrimary };
};

// "Out" files the image into the world's hidden Out collection: it leaves the
// main gallery grid, keeps every other membership, and undo takes it back.
const outFolderFor = async (ctx: MutationCtx, world: Doc<"folders">) => {
  const normalizedName = `${world._id}/${INBOX_OUT_FOLDER_NAME.toLowerCase()}`;
  for (const candidate of resolveUserIdCandidates(world.ownerUserId ?? "")) {
    const existing = await ctx.db.query("folders")
      .withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", normalizedName)).first();
    if (existing) return existing;
  }
  const now = Date.now();
  const folderId = await ctx.db.insert("folders", {
    ownerUserId: world.ownerUserId ?? "", name: INBOX_OUT_FOLDER_NAME, normalizedName,
    description: "Images sent Out from the Inbox. Hidden from the gallery grid; nothing here is deleted.",
    parentFolderId: world._id, hiddenFromGallery: true, createdAt: now, updatedAt: now,
  });
  return (await ctx.db.get(folderId))!;
};

const moodboardItem = (ctx: QueryCtx, moodboardId: Id<"moodboards">, assetId: Id<"assets">) =>
  ctx.db.query("moodboardItems").withIndex("by_moodboard_asset", (q) => q.eq("moodboardId", moodboardId).eq("assetId", assetId)).first();

const addToMoodboard = async (ctx: MutationCtx, owner: string, moodboardId: Id<"moodboards">, label: string, asset: Doc<"assets">): Promise<MembershipApplied> => {
  const board = await ctx.db.get(moodboardId);
  if (!board || !owns(owner, board)) throw new ConvexError(`The moodboard behind "${label}" is gone.`);
  if (await moodboardItem(ctx, board._id, asset._id)) return { kind: "moodboard", moodboardId: board._id, assetId: asset._id, added: false };
  if (board.itemCount >= MOODBOARD_MAX_ITEMS) throw new ConvexError(`"${board.name}" already holds ${MOODBOARD_MAX_ITEMS} images.`);
  const last = await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).order("desc").first();
  const now = Date.now();
  await ctx.db.insert("moodboardItems", {
    ownerUserId: board.ownerUserId, moodboardId: board._id, assetId: asset._id, position: (last?.position ?? -1) + 1, addedAt: now,
  });
  await ctx.db.patch(board._id, {
    itemCount: board.itemCount + 1, coverAssetId: board.coverAssetId ?? asset._id, revision: board.revision + 1, updatedAt: now,
  });
  return { kind: "moodboard", moodboardId: board._id, assetId: asset._id, added: true };
};

const applyTarget = async (ctx: MutationCtx, owner: string, stack: Stack, target: Target, asset: Doc<"assets">) => {
  if (target.kind === "moodboard" && target.moodboardId) return await addToMoodboard(ctx, owner, target.moodboardId, target.label, asset);
  if (target.kind === "collection" && target.folderId) {
    const folder = await ctx.db.get(target.folderId);
    if (!folder || !owns(owner, folder)) throw new ConvexError(`The collection behind "${target.label}" is gone.`);
    return await addToCollection(ctx, folder, asset);
  }
  if (target.kind === "out") return await addToCollection(ctx, await outFolderFor(ctx, await requireWorld(ctx, owner, stack.worldFolderId)), asset);
  return undefined;
};

// Collapse the kept images of a duplicates group into one stack: the cover
// first, the rest as alternates. Images, prompts and memberships stay.
const applyStack = async (ctx: MutationCtx, stack: Stack, members: Doc<"assets">[]): Promise<Applied> => {
  const now = Date.now();
  const cover = members[0]!;
  const packId = await ctx.db.insert("assetPacks", {
    ownerUserId: cover.ownerUserId, kind: "stack", title: stack.title.slice(0, 96), tagIds: [],
    coverAssetId: cover._id, isPublic: cover.isPublic ?? false, isFeatured: cover.isFeatured ?? false,
    itemCount: members.length, createdAt: now, updatedAt: now,
  });
  const previous = members.map((asset) => ({ assetId: asset._id, packId: asset.assetPackId, slot: asset.packSlotIndex }));
  for (const [slot, asset] of members.entries()) await ctx.db.patch(asset._id, { assetPackId: packId, packSlotIndex: slot });
  for (const oldPackId of new Set(previous.map((entry) => entry.packId).filter((id): id is Id<"assetPacks"> => Boolean(id)))) {
    await reconcileAssetPackMembership(ctx, oldPackId);
  }
  return { kind: "stack", packId, members: members.map((asset) => asset._id), previous };
};

const revertApplied = async (ctx: MutationCtx, applied: Applied) => {
  if (applied.kind === "moodboard") {
    if (!applied.added) return;
    const board = await ctx.db.get(applied.moodboardId);
    const item = board ? await moodboardItem(ctx, board._id, applied.assetId) : null;
    if (!board || !item) return;
    await ctx.db.delete(item._id);
    const coverAssetId = board.coverAssetId === applied.assetId
      ? (await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).first())?.assetId
      : board.coverAssetId;
    await ctx.db.patch(board._id, { itemCount: Math.max(0, board.itemCount - 1), coverAssetId, revision: board.revision + 1, updatedAt: Date.now() });
    return;
  }
  if (applied.kind === "collection") {
    if (!applied.added) return;
    const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", applied.assetId)).collect();
    const removed = links.filter((link) => link.folderId === applied.folderId);
    for (const link of removed) await ctx.db.delete(link._id);
    if (removed.length > 0) await recountFolderMembers(ctx, [applied.folderId]);
    const asset = await ctx.db.get(applied.assetId);
    if (!asset) return;
    if (applied.setPrimary && asset.folderId === applied.folderId) {
      await ctx.db.patch(asset._id, { folderId: links.find((link) => link.folderId !== applied.folderId)?.folderId });
    }
    await syncPublicCollectionMembership(ctx, asset._id);
    return;
  }
  // A stack: members leave it, the stack row goes, earlier packs come back.
  for (const assetId of applied.members) {
    const asset = await ctx.db.get(assetId);
    if (asset?.assetPackId === applied.packId) await ctx.db.patch(assetId, { assetPackId: undefined, packSlotIndex: undefined });
  }
  if (await ctx.db.get(applied.packId)) await ctx.db.delete(applied.packId);
  const restoredPacks = new Set<Id<"assetPacks">>();
  const prompts = new Map<Id<"prompts">, string>();
  for (const entry of applied.previous) {
    const asset = await ctx.db.get(entry.assetId);
    if (!asset) continue;
    if (entry.packId && await ctx.db.get(entry.packId)) {
      await ctx.db.patch(asset._id, { assetPackId: entry.packId, packSlotIndex: entry.slot });
      restoredPacks.add(entry.packId);
    } else if (asset.promptId) {
      const prompt = await ctx.db.get(asset.promptId);
      if (prompt?.ownerUserId) prompts.set(prompt._id, prompt.ownerUserId);
    }
  }
  for (const packId of restoredPacks) await reconcileAssetPackMembership(ctx, packId);
  // A prompt pack the stack emptied is rebuilt from the prompt.
  for (const [promptId, ownerUserId] of prompts) await syncPromptAssetPack(ctx, { ownerUserId, promptId });
};

const revertAll = async (ctx: MutationCtx, applied: Applied[] | undefined) => {
  for (const entry of [...(applied ?? [])].reverse()) await revertApplied(ctx, entry);
};

const hasComment = (row: Pick<Decision, "commentText" | "audioStorageId">) => Boolean(row.commentText || row.audioStorageId);

/* ── Reads ───────────────────────────────────────────────────────────────── */

// The navigation badges: open cards per world. Reads the small count rows only.
export const listInboxWorlds = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({
    worldFolderId: v.id("folders"),
    worldName: v.string(),
    openCards: v.number(),
    openStacks: v.number(),
  })),
  handler: async (ctx, args) => {
    const byWorld = new Map<Id<"folders">, { openCards: number; openStacks: number }>();
    const seen = new Set<string>();
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      const rows = await ctx.db.query("inboxCounts").withIndex("by_owner_status", (q) => q.eq("ownerUserId", candidate).eq("status", "open")).take(500);
      for (const row of rows) {
        if (seen.has(row._id)) continue;
        seen.add(row._id);
        const entry = byWorld.get(row.worldFolderId) ?? { openCards: 0, openStacks: 0 };
        entry.openCards += Math.max(0, row.cards - row.decided);
        entry.openStacks += 1;
        byWorld.set(row.worldFolderId, entry);
      }
    }
    const result = [];
    for (const [worldFolderId, counts] of byWorld) {
      const world = await ctx.db.get(worldFolderId);
      if (!world || !owns(args.ownerUserId, world)) continue;
      result.push({ worldFolderId, worldName: world.name, ...counts });
    }
    return result.sort((a, b) => b.openCards - a.openCards || a.worldName.localeCompare(b.worldName));
  },
});

const stackRowValidator = v.object({
  ...inboxStackDocValidator.fields,
  worldName: v.string(),
  cards: v.number(),
  decided: v.number(),
  previewItems: v.array(previewValidator),
});

export const listInboxStacks = ownerQuery({
  args: {
    ownerUserId: v.string(),
    worldFolderId: v.optional(v.id("folders")),
    status: v.optional(inboxStackStatusValidator),
    limit: v.optional(v.number()),
    // Preview images per stack, 0 to 4 (default 4).
    previewLimit: v.optional(v.number()),
  },
  returns: v.array(stackRowValidator),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const status = args.status ?? "open";
    const limit = Math.min(INBOX_LIMITS.listStacks, Math.max(1, Math.floor(args.limit ?? 50)));
    const previewLimit = Math.min(INBOX_LIMITS.previews, Math.max(0, Math.floor(args.previewLimit ?? INBOX_LIMITS.previews)));
    const stacks: Stack[] = [];
    if (args.worldFolderId) {
      const worldFolderId = args.worldFolderId;
      await requireWorld(ctx, owner, worldFolderId);
      stacks.push(...await ctx.db.query("inboxStacks")
        .withIndex("by_world_status_createdAt", (q) => q.eq("worldFolderId", worldFolderId).eq("status", status))
        .order("desc").take(limit));
    } else {
      for (const candidate of resolveUserIdCandidates(owner)) {
        stacks.push(...await ctx.db.query("inboxStacks")
          .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", status))
          .order("desc").take(limit));
      }
    }
    const visible = [...new Map(stacks.filter((stack) => owns(owner, stack)).map((stack) => [stack._id, stack])).values()]
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    const worldNames = new Map<Id<"folders">, string>();
    const rows = [];
    for (const stack of visible) {
      if (!worldNames.has(stack.worldFolderId)) worldNames.set(stack.worldFolderId, (await ctx.db.get(stack.worldFolderId))?.name ?? "Unknown world");
      const counts = await countOf(ctx, stack._id);
      const previewItems = [];
      if (previewLimit > 0) {
        const cards = await ctx.db.query("inboxCards").withIndex("by_stack_position", (q) => q.eq("stackId", stack._id)).take(previewLimit);
        for (const assetId of cards.flatMap((card) => card.assetIds)) {
          if (previewItems.length >= previewLimit) break;
          const asset = await ownedAsset(ctx, owner, assetId);
          if (asset) previewItems.push(await previewFor(ctx, asset));
        }
      }
      rows.push({
        ...stack, worldName: worldNames.get(stack.worldFolderId)!,
        cards: counts?.cards ?? 0, decided: counts?.decided ?? 0, previewItems,
      });
    }
    return rows;
  },
});

const cardAssetValidator = v.object({
  assetId: v.id("assets"),
  // The image was deleted (e.g. by a duplicates decision) or is not this owner's.
  missing: v.boolean(),
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  caption: v.optional(v.string()),
  modelName: v.optional(v.string()),
  createdAt: v.optional(v.number()),
});

const resolvedTargetValidator = v.object({
  ...inboxTargetValidator.fields,
  name: v.optional(v.string()),
  missing: v.boolean(),
  previewThumbUrl: v.optional(v.string()),
});

const cardViewValidator = v.object({
  _id: v.id("inboxCards"),
  position: v.number(),
  type: inboxCardTypeValidator,
  question: v.optional(v.string()),
  assets: v.array(cardAssetValidator),
  labels: v.optional(v.array(v.string())),
  targets: v.optional(v.array(resolvedTargetValidator)),
  evidence: v.optional(inboxEvidenceValidator),
  ruleText: v.optional(v.string()),
});

// A stack and its cards with their images. Decisions come from
// listInboxDecisions, so answering a card never re-runs this read.
export const getInboxStack = ownerQuery({
  args: { ownerUserId: v.string(), stackId: v.id("inboxStacks") },
  returns: v.object({ stack: inboxStackDocValidator, worldName: v.string(), cards: v.array(cardViewValidator) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const stack = await requireStack(ctx, owner, args.stackId);
    const world = await ctx.db.get(stack.worldFolderId);
    const prompts = new Map<Id<"prompts">, string | undefined>();
    const assetView = async (assetId: Id<"assets">) => {
      const asset = await ownedAsset(ctx, owner, assetId);
      if (!asset) {
        return {
          assetId, missing: true, kind: undefined, url: undefined, thumbUrl: undefined, width: undefined, height: undefined,
          caption: undefined, modelName: undefined, createdAt: undefined,
        };
      }
      if (!asset.agentDescription && !asset.description && asset.promptId && !prompts.has(asset.promptId)) {
        prompts.set(asset.promptId, (await ctx.db.get(asset.promptId))?.text?.slice(0, 400));
      }
      return {
        ...await previewFor(ctx, asset), missing: false, modelName: asset.modelName, createdAt: asset.createdAt,
        caption: inboxCaption({
          agentDescription: asset.agentDescription, description: asset.description,
          promptText: asset.promptId ? prompts.get(asset.promptId) : undefined, fileName: asset.fileName,
        }),
      };
    };
    const thumbOf = async (assetId: Id<"assets"> | undefined) => {
      const asset = assetId ? await ownedAsset(ctx, owner, assetId) : null;
      return asset ? await resolveAssetThumbUrl(ctx, asset) : undefined;
    };
    const cards = [];
    for (const card of await cardsOf(ctx, stack._id)) {
      const assets = [];
      for (const assetId of card.assetIds) assets.push(await assetView(assetId));
      let targets: Array<Target & { name: string | undefined; missing: boolean; previewThumbUrl: string | undefined }> | undefined;
      if (card.targets) {
        targets = [];
        for (const target of card.targets) {
          if (target.kind === "moodboard" && target.moodboardId) {
            const board = await ctx.db.get(target.moodboardId);
            const live = board && owns(owner, board) ? board : null;
            targets.push({ ...target, name: live?.name, missing: !live, previewThumbUrl: await thumbOf(live?.coverAssetId) });
          } else if (target.kind === "collection" && target.folderId) {
            const folder = await ctx.db.get(target.folderId);
            const live = folder && owns(owner, folder) ? folder : null;
            targets.push({ ...target, name: live?.name, missing: !live, previewThumbUrl: await thumbOf(live?.coverAssetId) });
          } else {
            targets.push({ ...target, name: undefined, missing: false, previewThumbUrl: undefined });
          }
        }
      }
      cards.push({
        _id: card._id, position: card.position, type: card.type, question: card.question, assets,
        labels: card.labels, targets, evidence: card.evidence, ruleText: card.ruleText,
      });
    }
    return { stack, worldName: world?.name ?? "Unknown world", cards };
  },
});

const decisionRowValidator = v.object({
  cardId: v.id("inboxCards"),
  choice: v.optional(inboxChoiceValidator),
  targetHotkey: v.optional(v.number()),
  pickedAssetId: v.optional(v.id("assets")),
  coverAssetId: v.optional(v.id("assets")),
  deleteAssetIds: v.optional(v.array(v.id("assets"))),
  deletedAssetIds: v.optional(v.array(v.id("assets"))),
  applied: v.optional(v.array(inboxAppliedValidator)),
  decidedAt: v.optional(v.number()),
  commentText: v.optional(v.string()),
  audioUrl: v.optional(v.string()),
  audioDurationMs: v.optional(v.number()),
  audioContentType: v.optional(v.string()),
  commentedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export const listInboxDecisions = ownerQuery({
  args: { ownerUserId: v.string(), stackId: v.id("inboxStacks") },
  returns: v.array(decisionRowValidator),
  handler: async (ctx, args) => {
    const stack = await requireStack(ctx, args.ownerUserId, args.stackId);
    const rows = [];
    for (const row of await decisionsOf(ctx, stack._id)) {
      rows.push({
        cardId: row.cardId, choice: row.choice, targetHotkey: row.targetHotkey, pickedAssetId: row.pickedAssetId,
        coverAssetId: row.coverAssetId, deleteAssetIds: row.deleteAssetIds, deletedAssetIds: row.deletedAssetIds,
        applied: row.applied, decidedAt: row.decidedAt, commentText: row.commentText,
        audioUrl: row.audioStorageId ? (await ctx.storage.getUrl(row.audioStorageId)) ?? undefined : undefined,
        audioDurationMs: row.audioDurationMs, audioContentType: row.audioContentType,
        commentedAt: row.commentedAt, updatedAt: row.updatedAt,
      });
    }
    return rows;
  },
});

// Michael's notes on the stack's images (asset comments), newest first per
// image, so the screen can mark them and agents can read them with the answers.
export const listInboxNotes = ownerQuery({
  args: { ownerUserId: v.string(), stackId: v.id("inboxStacks") },
  returns: v.array(v.object({
    assetId: v.id("assets"),
    notes: v.array(v.object({
      commentId: v.id("assetComments"),
      author: v.union(v.literal("owner"), v.literal("agent")),
      body: v.string(),
      audioUrl: v.optional(v.string()),
      audioDurationMs: v.optional(v.number()),
      createdAt: v.number(),
    })),
  })),
  handler: async (ctx, args) => {
    const stack = await requireStack(ctx, args.ownerUserId, args.stackId);
    const assetIds = new Set<Id<"assets">>();
    for (const card of await cardsOf(ctx, stack._id)) for (const assetId of card.assetIds) assetIds.add(assetId);
    const result = [];
    for (const assetId of assetIds) {
      const rows = await ctx.db.query("assetComments").withIndex("by_asset_createdAt", (q) => q.eq("assetId", assetId)).order("desc").take(20);
      const notes = [];
      for (const row of rows) {
        if (!owns(args.ownerUserId, row)) continue;
        notes.push({
          commentId: row._id, author: row.author, body: row.body, createdAt: row.createdAt,
          audioUrl: row.audioStorageId ? (await ctx.storage.getUrl(row.audioStorageId)) ?? undefined : undefined,
          audioDurationMs: row.audioDurationMs,
        });
      }
      if (notes.length) result.push({ assetId, notes });
    }
    return result;
  },
});

/* ── Posting, closing and deleting stacks ────────────────────────────────── */

const cardInputValidator = v.object({
  type: inboxCardTypeValidator,
  key: v.optional(v.string()),
  question: v.optional(v.string()),
  assetIds: v.array(v.id("assets")),
  labels: v.optional(v.array(v.string())),
  targets: v.optional(v.array(v.object({
    label: v.optional(v.string()),
    kind: inboxTargetKindValidator,
    moodboardId: v.optional(v.id("moodboards")),
    folderId: v.optional(v.id("folders")),
  }))),
  evidence: v.optional(inboxEvidenceValidator),
  ruleText: v.optional(v.string()),
});

const buildTargets = async (ctx: QueryCtx, owner: string, inputs: TargetInput[] | undefined, where: string) => {
  if (!inputs || inputs.length < INBOX_LIMITS.minTargets || inputs.length > INBOX_LIMITS.maxTargets) {
    throw new ConvexError(`${where}: a sort card has ${INBOX_LIMITS.minTargets} to ${INBOX_LIMITS.maxTargets} targets (hotkeys 1–9).`);
  }
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const [index, input] of inputs.entries()) {
    const hotkey = index + 1;
    let label = text(input.label, INBOX_LIMITS.label, `${where}, target ${hotkey} label`);
    if (input.kind === "moodboard") {
      if (!input.moodboardId || input.folderId) throw new ConvexError(`${where}, target ${hotkey}: a moodboard target takes moodboardId only.`);
      const board = await ctx.db.get(input.moodboardId);
      if (!board || !owns(owner, board)) throw new ConvexError(`${where}, target ${hotkey}: moodboard not found.`);
      label ??= board.name.slice(0, INBOX_LIMITS.label);
      if (seen.has(`m:${board._id}`)) throw new ConvexError(`${where}, target ${hotkey}: that moodboard is already a target.`);
      seen.add(`m:${board._id}`);
      targets.push({ hotkey, label, kind: "moodboard", moodboardId: board._id });
    } else if (input.kind === "collection") {
      if (!input.folderId || input.moodboardId) throw new ConvexError(`${where}, target ${hotkey}: a collection target takes folderId only.`);
      const folder = await ctx.db.get(input.folderId);
      if (!folder || !owns(owner, folder)) throw new ConvexError(`${where}, target ${hotkey}: collection not found.`);
      if (folder.kind !== undefined) throw new ConvexError(`${where}, target ${hotkey}: "${folder.name}" is a storybook; targets are plain collections.`);
      label ??= folder.name.slice(0, INBOX_LIMITS.label);
      if (seen.has(`c:${folder._id}`)) throw new ConvexError(`${where}, target ${hotkey}: that collection is already a target.`);
      seen.add(`c:${folder._id}`);
      targets.push({ hotkey, label, kind: "collection", folderId: folder._id });
    } else {
      if (input.moodboardId || input.folderId) throw new ConvexError(`${where}, target ${hotkey}: an ${input.kind} target takes no moodboardId or folderId.`);
      if (input.kind === "out") {
        if (seen.has("out")) throw new ConvexError(`${where}: only one Out target.`);
        seen.add("out");
        label ??= "Out";
      }
      if (!label) throw new ConvexError(`${where}, target ${hotkey}: an option needs a label.`);
      targets.push({ hotkey, label, kind: input.kind });
    }
  }
  if (new Set(targets.map((target) => target.label.toLowerCase())).size !== targets.length) {
    throw new ConvexError(`${where}: each target needs its own label.`);
  }
  return targets;
};

const cleanEvidence = (evidence: Card["evidence"], where: string): Card["evidence"] => {
  if (!evidence) return undefined;
  const matches = evidence.matches?.map((match) => ({
    kind: match.kind,
    label: text(match.label, INBOX_LIMITS.matchLabel, `${where}, match label`) ?? match.kind,
    ...(match.score !== undefined && Number.isFinite(match.score) ? { score: match.score } : {}),
  }));
  if (evidence.priceUsd !== undefined && (!Number.isFinite(evidence.priceUsd) || evidence.priceUsd < 0)) {
    throw new ConvexError(`${where}: priceUsd is a positive amount in dollars.`);
  }
  return {
    text: text(evidence.text, INBOX_LIMITS.evidenceText, `${where}, evidence text`),
    ...(matches?.length ? { matches: matches.slice(0, 12) } : {}),
    ...(evidence.defect ? { defect: { box: clampBox(evidence.defect.box), note: text(evidence.defect.note, INBOX_LIMITS.matchLabel, `${where}, defect note`) } } : {}),
    ...(evidence.priceUsd !== undefined ? { priceUsd: evidence.priceUsd } : {}),
    priceNote: text(evidence.priceNote, INBOX_LIMITS.matchLabel, `${where}, price note`),
  };
};

export const postInboxCards = ownerMutation({
  args: {
    ownerUserId: v.string(),
    worldFolderId: v.id("folders"),
    // Append to this open stack; otherwise the stack with this ingestKey in
    // the world, otherwise a new stack titled stackTitle.
    stackId: v.optional(v.id("inboxStacks")),
    stackTitle: v.optional(v.string()),
    ingestKey: v.optional(v.string()),
    note: v.optional(v.string()),
    agent: v.optional(v.string()),
    cards: v.array(cardInputValidator),
  },
  returns: v.object({
    stackId: v.id("inboxStacks"),
    createdStack: v.boolean(),
    added: v.array(v.id("inboxCards")),
    // Card keys already in the stack; left as they were.
    skippedKeys: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const world = await requireWorld(ctx, owner, args.worldFolderId);
    if (args.cards.length === 0) throw new ConvexError("Post at least one card.");
    if (args.cards.length > INBOX_LIMITS.cardsPerPost) throw new ConvexError(`Post at most ${INBOX_LIMITS.cardsPerPost} cards per call.`);
    const ingestKey = text(args.ingestKey, INBOX_LIMITS.ingestKey, "ingestKey");

    let stack: Stack | null = null;
    if (args.stackId) {
      stack = await requireStack(ctx, owner, args.stackId);
      if (stack.worldFolderId !== world._id) throw new ConvexError("That stack belongs to another world.");
    } else if (ingestKey) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        stack ??= await ctx.db.query("inboxStacks")
          .withIndex("by_owner_world_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", world._id).eq("ingestKey", ingestKey))
          .first();
      }
    }
    if (stack) requireOpen(stack);

    // Validate every card before writing anything.
    const prepared = [];
    for (const [index, input] of args.cards.entries()) {
      const where = `Card ${index + 1} (${input.type})`;
      const assetIds = [...new Set(input.assetIds)];
      const { min, max } = INBOX_CARD_ASSETS[input.type as InboxCardType];
      if (assetIds.length < min || assetIds.length > max) {
        throw new ConvexError(min === max ? `${where}: takes exactly ${min} image${min === 1 ? "" : "s"}.` : `${where}: takes ${min} to ${max} images.`);
      }
      for (const assetId of assetIds) {
        if (!await ownedAsset(ctx, owner, assetId)) throw new ConvexError(`${where}: asset not found: asset:${assetId}`);
      }
      const labels = input.labels?.map((label) => text(label, INBOX_LIMITS.label, `${where}, label`) ?? "");
      if (labels && labels.length !== assetIds.length) throw new ConvexError(`${where}: labels needs one entry per image.`);
      const targets = input.type === "sort" ? await buildTargets(ctx, owner, input.targets, where) : undefined;
      if (input.type !== "sort" && input.targets?.length) throw new ConvexError(`${where}: only sort cards take targets.`);
      const ruleText = text(input.ruleText, INBOX_LIMITS.ruleText, `${where}, rule`);
      if (input.type === "rule" && !ruleText) throw new ConvexError(`${where}: a rule card needs ruleText.`);
      const evidence = cleanEvidence(input.evidence, where);
      if (input.type === "artifact" && !evidence?.defect) throw new ConvexError(`${where}: an artifact card needs evidence.defect.box.`);
      prepared.push({
        type: input.type, key: text(input.key, INBOX_LIMITS.cardKey, `${where}, key`),
        question: text(input.question, INBOX_LIMITS.question, `${where}, question`),
        assetIds, labels, targets, evidence, ruleText,
      });
    }

    const now = Date.now();
    let createdStack = false;
    if (!stack) {
      const title = text(args.stackTitle, INBOX_LIMITS.stackTitle, "stackTitle");
      if (!title) throw new ConvexError("A new stack needs stackTitle.");
      const stackId = await ctx.db.insert("inboxStacks", {
        ownerUserId: world.ownerUserId ?? owner, worldFolderId: world._id, title,
        note: text(args.note, INBOX_LIMITS.note, "Note"), agent: text(args.agent, INBOX_LIMITS.agent, "Agent"),
        ingestKey, status: "open", cardTypes: [], createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("inboxCounts", { ownerUserId: world.ownerUserId ?? owner, stackId, worldFolderId: world._id, status: "open", cards: 0, decided: 0 });
      stack = (await ctx.db.get(stackId))!;
      createdStack = true;
    }

    const existing = await cardsOf(ctx, stack._id);
    let position = (existing.at(-1)?.position ?? -1);
    let assetTotal = existing.reduce((sum, card) => sum + card.assetIds.length, 0);
    const added: Id<"inboxCards">[] = [];
    const skippedKeys: string[] = [];
    for (const card of prepared) {
      if (card.key) {
        const key = card.key;
        if (await ctx.db.query("inboxCards").withIndex("by_stack_key", (q) => q.eq("stackId", stack._id).eq("key", key)).first()) {
          skippedKeys.push(key);
          continue;
        }
      }
      if (existing.length + added.length >= INBOX_LIMITS.cardsPerStack) throw new ConvexError(`A stack holds at most ${INBOX_LIMITS.cardsPerStack} cards; start a new stack.`);
      assetTotal += card.assetIds.length;
      if (assetTotal > INBOX_LIMITS.assetsPerStack) throw new ConvexError(`A stack shows at most ${INBOX_LIMITS.assetsPerStack} images; start a new stack.`);
      position += 1;
      added.push(await ctx.db.insert("inboxCards", {
        ownerUserId: stack.ownerUserId, stackId: stack._id, worldFolderId: world._id, position, createdAt: now,
        type: card.type, assetIds: card.assetIds,
        ...(card.key ? { key: card.key } : {}), ...(card.question ? { question: card.question } : {}),
        ...(card.labels ? { labels: card.labels } : {}), ...(card.targets ? { targets: card.targets } : {}),
        ...(card.evidence ? { evidence: card.evidence } : {}), ...(card.ruleText ? { ruleText: card.ruleText } : {}),
      }));
    }
    if (added.length > 0) {
      const cardTypes = [...new Set([...stack.cardTypes, ...prepared.map((card) => card.type)])];
      await ctx.db.patch(stack._id, { cardTypes, updatedAt: now });
      await bumpCount(ctx, stack._id, { cards: added.length });
    }
    return { stackId: stack._id, createdStack, added, skippedKeys };
  },
});

export const closeInboxStack = ownerMutation({
  args: { ownerUserId: v.string(), stackId: v.id("inboxStacks"), reopen: v.optional(v.boolean()) },
  returns: v.object({ stackId: v.id("inboxStacks"), status: inboxStackStatusValidator }),
  handler: async (ctx, args) => {
    const stack = await requireStack(ctx, args.ownerUserId, args.stackId);
    const status = args.reopen ? "open" as const : "closed" as const;
    if (stack.status !== status) {
      const now = Date.now();
      await ctx.db.patch(stack._id, { status, closedAt: status === "closed" ? now : undefined, updatedAt: now });
      const counts = await countOf(ctx, stack._id);
      if (counts) await ctx.db.patch(counts._id, { status });
    }
    return { stackId: stack._id, status };
  },
});

// The stack, its cards, decisions and card-level voice notes go. What the
// decisions changed in the gallery stays, and so do notes on images.
export const deleteInboxStack = ownerMutation({
  args: { ownerUserId: v.string(), stackId: v.id("inboxStacks") },
  returns: v.object({ deleted: v.boolean(), removedCards: v.number() }),
  handler: async (ctx, args) => {
    const stack = await ctx.db.get(args.stackId);
    if (!stack) return { deleted: false, removedCards: 0 };
    if (!owns(args.ownerUserId, stack)) throw new ConvexError("Stack not found.");
    for (const row of await decisionsOf(ctx, stack._id)) {
      if (row.audioStorageId) await ctx.storage.delete(row.audioStorageId);
      await ctx.db.delete(row._id);
    }
    const cards = await cardsOf(ctx, stack._id);
    for (const card of cards) await ctx.db.delete(card._id);
    const counts = await countOf(ctx, stack._id);
    if (counts) await ctx.db.delete(counts._id);
    await ctx.db.delete(stack._id);
    return { deleted: true, removedCards: cards.length };
  },
});

/* ── Deciding ────────────────────────────────────────────────────────────── */

const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id) => (b ?? []).includes(id));

export const decideInboxCard = ownerMutation({
  args: {
    ownerUserId: v.string(),
    cardId: v.id("inboxCards"),
    choice: inboxChoiceValidator,
    // sort: the target's hotkey.
    targetHotkey: v.optional(v.number()),
    // ab winner / choose-one pick.
    pickedAssetId: v.optional(v.id("assets")),
    // duplicates: the cover of a stack, and the images to delete.
    coverAssetId: v.optional(v.id("assets")),
    deleteAssetIds: v.optional(v.array(v.id("assets"))),
  },
  returns: v.object({
    cardId: v.id("inboxCards"),
    choice: inboxChoiceValidator,
    // What changed, in words: "added to DA FILM · Golden", "stacked 3 under a cover".
    effects: v.array(v.string()),
    // Duplicates: the images the screen now deletes through the delete route.
    deleteAssetIds: v.array(v.id("assets")),
    unchanged: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const { card, stack } = await requireCard(ctx, owner, args.cardId);
    requireOpen(stack);
    const choice = args.choice as InboxChoice;
    if (!INBOX_CHOICES_BY_TYPE[card.type].includes(choice)) {
      throw new ConvexError(`A ${card.type} card does not take "${choice}".`);
    }
    const inCard = (assetId: Id<"assets"> | undefined) => Boolean(assetId && card.assetIds.includes(assetId));
    const target = choice === "target" ? card.targets?.find((entry) => entry.hotkey === args.targetHotkey) : undefined;
    if (choice === "target" && !target) {
      throw new ConvexError(args.targetHotkey === undefined ? "Choose a target by its hotkey." : `This card has no target ${args.targetHotkey}.`);
    }
    if ((choice === "winner" || choice === "pick") && !inCard(args.pickedAssetId)) throw new ConvexError("Pick one of this card's images.");
    const deleteAssetIds = [...new Set(args.deleteAssetIds ?? [])];
    if (deleteAssetIds.some((assetId) => !inCard(assetId))) throw new ConvexError("Only this card's images can be deleted here.");
    if (deleteAssetIds.length && choice !== "resolve" && choice !== "stack") throw new ConvexError("Deleting images is a duplicates decision.");
    if (choice === "resolve" && deleteAssetIds.length === 0) throw new ConvexError("Mark at least one image to delete.");
    if (deleteAssetIds.length > 0 && deleteAssetIds.length >= card.assetIds.length) throw new ConvexError("Keep at least one image of the group.");
    const kept = card.assetIds.filter((assetId) => !deleteAssetIds.includes(assetId));
    if (choice === "stack") {
      if (!inCard(args.coverAssetId) || deleteAssetIds.includes(args.coverAssetId!)) throw new ConvexError("Choose a cover the stack keeps.");
      if (kept.length < 2) throw new ConvexError("A stack needs at least two images that stay.");
    }

    const existing = await decisionOf(ctx, card._id);
    const fields = {
      choice, targetHotkey: target?.hotkey,
      pickedAssetId: choice === "winner" || choice === "pick" ? args.pickedAssetId : undefined,
      coverAssetId: choice === "stack" ? args.coverAssetId : undefined,
      deleteAssetIds: deleteAssetIds.length ? deleteAssetIds : undefined,
    };
    if (existing && existing.choice === fields.choice && existing.targetHotkey === fields.targetHotkey
      && existing.pickedAssetId === fields.pickedAssetId && existing.coverAssetId === fields.coverAssetId
      && sameIds(existing.deleteAssetIds, fields.deleteAssetIds)) {
      return { cardId: card._id, choice, effects: [], deleteAssetIds: [], unchanged: true };
    }

    // A changed decision first takes back what the earlier one did.
    await revertAll(ctx, existing?.applied);
    const applied: Applied[] = [];
    const effects: string[] = [];
    const asset = async (assetId: Id<"assets">) => {
      const row = await ownedAsset(ctx, owner, assetId);
      if (!row) throw new ConvexError(`asset:${assetId} is no longer in the gallery.`);
      return row;
    };
    if (target) {
      const result = await applyTarget(ctx, owner, stack, target, await asset(card.assetIds[0]!));
      if (result) applied.push(result);
      effects.push(!result ? `recorded: ${target.label}` : result.added ? `added to ${target.label}` : `already in ${target.label}`);
    } else if (choice === "out") {
      const result = await addToCollection(ctx, await outFolderFor(ctx, await requireWorld(ctx, owner, stack.worldFolderId)), await asset(card.assetIds[0]!));
      applied.push(result);
      effects.push(result.added ? "sent Out (hidden from the gallery grid)" : "already Out");
    } else if (choice === "stack") {
      const ordered = [args.coverAssetId!, ...kept.filter((assetId) => assetId !== args.coverAssetId)];
      const members = [];
      for (const assetId of ordered) members.push(await asset(assetId));
      applied.push(await applyStack(ctx, stack, members));
      effects.push(`stacked ${members.length} under one cover`);
    } else if (choice === "skip") {
      effects.push("decide later");
    } else {
      effects.push(`recorded: ${choice}`);
    }
    if (deleteAssetIds.length) effects.push(`delete ${deleteAssetIds.length}`);

    const now = Date.now();
    const row = { ...fields, applied: applied.length ? applied : undefined, decidedAt: now, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("inboxDecisions", { ownerUserId: stack.ownerUserId, stackId: stack._id, cardId: card._id, ...row });
    if (!existing?.choice) await bumpCount(ctx, stack._id, { decided: 1 });
    const alreadyDeleted = new Set(existing?.deletedAssetIds ?? []);
    return { cardId: card._id, choice, effects, deleteAssetIds: deleteAssetIds.filter((id) => !alreadyDeleted.has(id)), unchanged: false };
  },
});

// After the screen deleted images through the gallery's delete route, it
// records which ones are gone.
export const recordInboxDeletions = ownerMutation({
  args: { ownerUserId: v.string(), cardId: v.id("inboxCards"), deletedAssetIds: v.array(v.id("assets")) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const { card } = await requireCard(ctx, args.ownerUserId, args.cardId);
    const existing = await decisionOf(ctx, card._id);
    if (!existing) throw new ConvexError("Decide the card before recording deletions.");
    const planned = new Set(existing.deleteAssetIds ?? []);
    const done = new Set(existing.deletedAssetIds ?? []);
    for (const assetId of args.deletedAssetIds) {
      if (!planned.has(assetId)) throw new ConvexError(`asset:${assetId} was not marked for deletion on this card.`);
      // Only record what is really gone.
      if (!await ctx.db.get(assetId)) done.add(assetId);
    }
    await ctx.db.patch(existing._id, { deletedAssetIds: [...done], updatedAt: Date.now() });
    return { deleted: done.size };
  },
});

// Undo: the card goes back to open; what the decision changed is taken back.
// Deleted images stay deleted; the row remembers them.
export const clearInboxDecision = ownerMutation({
  args: { ownerUserId: v.string(), cardId: v.id("inboxCards") },
  returns: v.object({ cleared: v.boolean(), deletedForGood: v.number() }),
  handler: async (ctx, args) => {
    const { card, stack } = await requireCard(ctx, args.ownerUserId, args.cardId);
    requireOpen(stack);
    const existing = await decisionOf(ctx, card._id);
    if (!existing?.choice) return { cleared: false, deletedForGood: 0 };
    await revertAll(ctx, existing.applied);
    const deletedForGood = existing.deletedAssetIds?.length ?? 0;
    if (hasComment(existing) || deletedForGood) {
      await ctx.db.patch(existing._id, {
        choice: undefined, targetHotkey: undefined, pickedAssetId: undefined, coverAssetId: undefined,
        deleteAssetIds: undefined, applied: undefined, decidedAt: undefined, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.delete(existing._id);
    }
    await bumpCount(ctx, stack._id, { decided: -1 });
    return { cleared: true, deletedForGood };
  },
});

// A comment on the card as a whole (a rule card, or the decision itself).
// Notes on a single image are asset comments (assetComments.addAssetComment).
export const setInboxCardComment = ownerMutation({
  args: {
    ownerUserId: v.string(),
    cardId: v.id("inboxCards"),
    text: v.optional(v.union(v.string(), v.null())),
    audio: v.optional(v.union(v.null(), v.object({ storageId: v.id("_storage"), durationMs: v.number(), contentType: v.optional(v.string()) }))),
  },
  returns: v.object({ hasText: v.boolean(), hasAudio: v.boolean() }),
  handler: async (ctx, args) => {
    const { card, stack } = await requireCard(ctx, args.ownerUserId, args.cardId);
    requireOpen(stack);
    const existing = await decisionOf(ctx, card._id);
    const commentText = args.text === undefined ? existing?.commentText : text(args.text, INBOX_LIMITS.commentText, "Comment");
    let audio = existing?.audioStorageId
      ? { storageId: existing.audioStorageId, durationMs: existing.audioDurationMs ?? 0, contentType: existing.audioContentType }
      : undefined;
    if (args.audio === null) {
      if (audio) await ctx.storage.delete(audio.storageId);
      audio = undefined;
    } else if (args.audio) {
      const durationMs = Math.round(args.audio.durationMs);
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > INBOX_LIMITS.audioMs) {
        throw new ConvexError(`A voice comment runs at most ${INBOX_LIMITS.audioMs / 60000} minutes.`);
      }
      const meta = await ctx.db.system.get(args.audio.storageId);
      if (!meta) throw new ConvexError("The recording upload was not found.");
      if (meta.size > INBOX_LIMITS.audioBytes) throw new ConvexError("The recording is too large.");
      const contentType = args.audio.contentType ?? meta.contentType ?? undefined;
      if (contentType && !/^(audio\/[\w.+-]+|video\/webm|video\/mp4)(;.*)?$/i.test(contentType)) throw new ConvexError("A voice comment must be audio.");
      if (audio && audio.storageId !== args.audio.storageId) await ctx.storage.delete(audio.storageId);
      audio = { storageId: args.audio.storageId, durationMs, contentType };
    }
    const now = Date.now();
    const fields = {
      commentText, audioStorageId: audio?.storageId, audioDurationMs: audio?.durationMs, audioContentType: audio?.contentType,
      commentedAt: commentText || audio ? now : undefined, updatedAt: now,
    };
    if (existing) {
      if (!existing.choice && !commentText && !audio && !existing.deletedAssetIds?.length) await ctx.db.delete(existing._id);
      else await ctx.db.patch(existing._id, fields);
    } else if (commentText || audio) {
      await ctx.db.insert("inboxDecisions", { ownerUserId: stack.ownerUserId, stackId: stack._id, cardId: card._id, ...fields });
    }
    return { hasText: Boolean(commentText), hasAudio: Boolean(audio) };
  },
});
