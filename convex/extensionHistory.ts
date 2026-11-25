import { ConvexError, v } from "convex/values";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { resolveUserIdCandidates } from "./authz";

// The extension's Recent lists (Grow pictures, Midjourney describes), shared
// by every browser the extension runs in. The background worker merges its
// local list with these rows both ways; the server keeps the newest per kind.
export const HISTORY_CAPS = { grow: 40, describe: 24 } as const;
const kind = v.union(v.literal("grow"), v.literal("describe"));
const rowOut = v.object({ key: v.string(), at: v.number(), rev: v.number(), entry: v.string() });
const MAX_ENTRY = 200_000;

export const list = ownerQuery({
  args: { ownerUserId: v.string(), kind },
  returns: v.array(rowOut),
  handler: async (ctx, args) => {
    const cap = HISTORY_CAPS[args.kind];
    const pages = await Promise.all(resolveUserIdCandidates(args.ownerUserId).map((owner) => ctx.db.query("extensionHistory")
      .withIndex("by_owner_kind_at", (q) => q.eq("ownerUserId", owner).eq("kind", args.kind)).order("desc").take(cap)));
    return pages.flat().sort((a, b) => b.at - a.at).slice(0, cap).map(({ key, at, rev, entry }) => ({ key, at, rev, entry }));
  },
});

// Upsert rows; a row whose rev is older than the stored one is skipped (the
// stored one comes back so the browser merges it). Rows past the cap go.
export const put = ownerMutation({
  args: { ownerUserId: v.string(), kind, rows: v.array(v.object({ key: v.string(), at: v.number(), entry: v.string(), baseRev: v.optional(v.number()) })) },
  returns: v.array(v.object({ key: v.string(), rev: v.number(), stale: v.boolean(), entry: v.optional(v.string()), at: v.optional(v.number()) })),
  handler: async (ctx, args) => {
    if (args.rows.length > 60) throw new ConvexError("Too many history rows at once.");
    const owners = resolveUserIdCandidates(args.ownerUserId);
    const out = [];
    let rev = Date.now();
    for (const row of args.rows) {
      if (!row.key || row.key.length > 2000 || row.entry.length > MAX_ENTRY || !Number.isFinite(row.at)) throw new ConvexError("That history entry is invalid.");
      let old = null;
      for (const owner of owners) {
        old = await ctx.db.query("extensionHistory").withIndex("by_owner_kind_key", (q) => q.eq("ownerUserId", owner).eq("kind", args.kind).eq("key", row.key)).unique();
        if (old) break;
      }
      // Written elsewhere since this browser last read it: send it back to merge.
      if (old && row.baseRev !== undefined && old.rev > row.baseRev) { out.push({ key: row.key, rev: old.rev, stale: true, entry: old.entry, at: old.at }); continue; }
      rev = Math.max(rev + 1, (old?.rev ?? 0) + 1);
      if (old) await ctx.db.patch(old._id, { at: row.at, rev, entry: row.entry });
      else await ctx.db.insert("extensionHistory", { ownerUserId: args.ownerUserId, kind: args.kind, key: row.key, at: row.at, rev, entry: row.entry });
      out.push({ key: row.key, rev, stale: false });
    }
    // Keep the newest rows per kind; older pictures fall off, as they do locally.
    const cap = HISTORY_CAPS[args.kind];
    for (const owner of owners) {
      const extra = await ctx.db.query("extensionHistory").withIndex("by_owner_kind_at", (q) => q.eq("ownerUserId", owner).eq("kind", args.kind)).order("desc").take(cap + 60);
      for (const row of extra.slice(cap)) await ctx.db.delete(row._id);
    }
    return out;
  },
});
