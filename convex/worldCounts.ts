import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation } from "./actor";
import { canActorAccessOwnerUserId } from "./authz";
import { publicCollectionCountsReady } from "./publicCollectionCounts";
import { childrenOf, cleanSession, recordWorldChange, resolveWorld } from "./worldCore";

// Recount a world's stored collection counts from the membership rows.
//
// folders.memberCount and folders.publicMemberCount are denormalized. Every
// membership write keeps them exact (recountFolderMembers and
// syncPublicCollectionMembership); this is the repair for a count that drifted
// anyway. It walks the world root and each of its children, counts the
// assetFolders rows (and, for the public count, public assets whose legacy
// primary pointer names the collection without a link row), and patches the
// counts that differ. A dry run patches nothing and reports every collection
// with its stored and recounted values.
//
// One call stays well under Convex's per-transaction read limit: it stops at a
// collection boundary once READ_BUDGET is spent, and a collection too large
// for one page is paged across calls with the cursor. Folders already
// recounted keep their counts exact through the normal write paths, so a run
// split over several calls is safe while the gallery is in use.

const PAGE = 400;
const READ_BUDGET = 2_400;

type Folder = Doc<"folders">;

const countsValidator = v.object({ memberCount: v.union(v.null(), v.number()), publicMemberCount: v.union(v.null(), v.number()) });

export const recountRowValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  before: countsValidator,
  after: countsValidator,
  changed: v.boolean(),
});
export type RecountRow = Infer<typeof recountRowValidator>;

export const recountCursorValidator = v.object({
  // Position in [root, ...children by creation].
  index: v.number(),
  phase: v.union(v.literal("links"), v.literal("primaries")),
  // Convex page cursor inside the current collection and phase, when it is paged.
  page: v.union(v.null(), v.string()),
  // Counts gathered so far for the collection at `index`.
  members: v.number(),
  publicMembers: v.number(),
});
export type RecountCursor = Infer<typeof recountCursorValidator>;

const isPublicMember = (asset: Doc<"assets"> | null) => asset?.isPublic === true && asset.createdAt >= 0;

/**
 * The public count is backed by one snapshot row per public asset. A counted
 * member missing from its snapshot would be counted a second time by the next
 * syncPublicCollectionMembership, so the recount adds it there (no delta: the
 * counter is set from the recount).
 */
const ensureSnapshotHas = async (ctx: MutationCtx, assetId: Id<"assets">, folderId: Id<"folders">) => {
  const snapshot = await ctx.db.query("publicCollectionMemberships").withIndex("by_asset", (q) => q.eq("assetId", assetId)).unique();
  if (!snapshot) await ctx.db.insert("publicCollectionMemberships", { assetId, folderIds: [folderId] });
  else if (!snapshot.folderIds.includes(folderId)) await ctx.db.patch(snapshot._id, { folderIds: [...snapshot.folderIds, folderId] });
};

export const recountWorldCounts = ownerMutation({
  args: {
    ownerUserId: v.string(),
    world: v.string(),
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(recountCursorValidator),
    note: v.optional(v.string()),
    actor: v.optional(v.string()),
    session: v.optional(v.string()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    world: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
    // Collections finished in this call, in walk order.
    rows: v.array(recountRowValidator),
    done: v.boolean(),
    cursor: v.union(v.null(), recountCursorValidator),
    // False while the public-count backfill is unfinished: public counts are then left alone.
    publicCounts: v.boolean(),
    changeId: v.union(v.null(), v.id("worldChanges")),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const dryRun = args.dryRun ?? false;
    const root = await resolveWorld(ctx, owner, args.world);
    const children = (await childrenOf(ctx, root._id))
      .filter((child) => canActorAccessOwnerUserId(owner, child.ownerUserId))
      .sort((a, b) => a._creationTime - b._creationTime);
    const folders: Folder[] = [root, ...children];
    const publicCounts = await publicCollectionCountsReady(ctx);

    let state: RecountCursor = args.cursor ?? { index: 0, phase: "links", page: null, members: 0, publicMembers: 0 };
    if (state.index < 0 || state.index > folders.length) throw new ConvexError("The recount cursor does not match this world; start again without cursor.");
    let reads = 0;
    let paged = false;
    const rows: RecountRow[] = [];

    // One batch of the current phase: the whole collection when it fits a
    // page, otherwise one Convex page (Convex allows one paginated query per
    // function, so a second large collection waits for the next call). A
    // Convex query runs once, so each read builds a fresh one.
    const nextBatch = async <T>(
      query: () => { take: (n: number) => Promise<T[]>; paginate: (opts: { cursor: string | null; numItems: number }) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }> },
    ): Promise<{ batch: T[]; whole: boolean; next: string | null } | null> => {
      if (state.page === null) {
        reads += 1;
        const all = await query().take(PAGE + 1);
        if (all.length <= PAGE) return { batch: all, whole: true, next: null };
      }
      if (paged) return null;
      paged = true;
      reads += 1;
      const result = await query().paginate({ cursor: state.page, numItems: PAGE });
      return { batch: result.page, whole: false, next: result.isDone ? null : result.continueCursor };
    };

    while (state.index < folders.length && reads < READ_BUDGET) {
      const folder = folders[state.index]!;
      if (state.phase === "links") {
        const got = await nextBatch(() => ctx.db.query("assetFolders")
          .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id).gte("createdAt", 0)));
        if (!got) break;
        const seen = new Set<Id<"assets">>();
        for (const link of got.batch) {
          // A duplicate link row counts once: in memory within one batch, by
          // the first row of the pair across pages.
          if (got.whole) {
            if (seen.has(link.assetId)) continue;
            seen.add(link.assetId);
          } else {
            reads += 1;
            const first = await ctx.db.query("assetFolders")
              .withIndex("by_asset_folder", (q) => q.eq("assetId", link.assetId).eq("folderId", folder._id)).first();
            if (first && first._id !== link._id) continue;
          }
          state.members += 1;
          if (!publicCounts) continue;
          reads += 1;
          if (!isPublicMember(await ctx.db.get(link.assetId))) continue;
          state.publicMembers += 1;
          if (!dryRun) { reads += 1; await ensureSnapshotHas(ctx, link.assetId, folder._id); }
        }
        state = got.next ? { ...state, page: got.next } : { ...state, phase: "primaries", page: null };
        continue;
      }

      // Public assets whose primary pointer names the collection without a link row.
      if (publicCounts) {
        const got = await nextBatch(() => ctx.db.query("assets")
          .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id).gte("createdAt", 0)));
        if (!got) break;
        for (const asset of got.batch) {
          if (!isPublicMember(asset)) continue;
          reads += 1;
          const link = await ctx.db.query("assetFolders")
            .withIndex("by_asset_folder", (q) => q.eq("assetId", asset._id).eq("folderId", folder._id)).first();
          if (link && link.createdAt >= 0) continue;
          state.publicMembers += 1;
          if (!dryRun) { reads += 1; await ensureSnapshotHas(ctx, asset._id, folder._id); }
        }
        if (got.next) { state = { ...state, page: got.next }; continue; }
      }

      const before = { memberCount: folder.memberCount ?? null, publicMemberCount: folder.publicMemberCount ?? null };
      const after = { memberCount: state.members, publicMemberCount: publicCounts ? state.publicMembers : before.publicMemberCount };
      // A count never stored reads as 0 everywhere, so 0 over undefined is no change.
      const changed = (before.memberCount ?? 0) !== after.memberCount || (before.publicMemberCount ?? 0) !== (after.publicMemberCount ?? 0);
      if (changed && !dryRun) {
        await ctx.db.patch(folder._id, publicCounts
          ? { memberCount: after.memberCount, publicMemberCount: state.publicMembers }
          : { memberCount: after.memberCount });
      }
      rows.push({ folderId: folder._id, name: folder.name, before, after, changed });
      state = { index: state.index + 1, phase: "links", page: null, members: 0, publicMembers: 0 };
    }

    const done = state.index >= folders.length;
    const corrected = rows.filter((row) => row.changed);
    let changeId: Id<"worldChanges"> | null = null;
    if (!dryRun && corrected.length > 0) {
      const note = args.note?.trim().slice(0, 160);
      changeId = await recordWorldChange(ctx, {
        ownerUserId: owner, worldFolderId: root._id, op: "world.recount", targetType: "counts", targetId: `${root._id}:counts`,
        summary: `Recounted ${corrected.length} collection${corrected.length === 1 ? "" : "s"}: ${corrected.map((row) => `${row.name} ${row.before.memberCount ?? 0}→${row.after.memberCount}`).join(", ")}${note ? ` (${note})` : ""}`,
        before: corrected.map((row) => ({ folderId: row.folderId, name: row.name, ...row.before })),
        after: corrected.map((row) => ({ folderId: row.folderId, name: row.name, ...row.after })),
        actor: args.actor, session: cleanSession(args.session),
      });
    }
    return {
      dryRun,
      world: { id: root._id, key: root.worldKey ?? "", name: root.name },
      rows,
      done,
      cursor: done ? null : state,
      publicCounts,
      changeId,
    };
  },
});
