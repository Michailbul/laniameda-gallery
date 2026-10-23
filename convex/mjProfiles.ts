import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { cleanSession, recordWorldChange, resolveWorld, sameContent } from "./worldCore";
import { cleanMidjourneyCode, normalizeMoodboardStyleTag, profileFlagForCode } from "../lib/moodboards";

// Midjourney personalization profiles: Michael's taste, trained by his
// rankings, applied with --profile <code>. Moodboards are looks, profiles are
// taste; a prompt stacks boards first, then profiles. One profile can serve
// several worlds with a different role in each, and a world reads only its
// own role. Every save names the world it is made for and lands in that
// world's journal.

type Profile = Doc<"mjProfiles">;
const MAX_CODE_HISTORY = 50;

export type ProfileSnapshot = {
  profileId: Id<"mjProfiles">; name: string; code: string; mjProfileId?: string; status: Profile["status"];
  notes?: string; codeHistory: Profile["codeHistory"]; uses: Profile["uses"]; revision: number;
};

const snapshot = (row: Profile): ProfileSnapshot => ({
  profileId: row._id, name: row.name, code: row.code, mjProfileId: row.mjProfileId, status: row.status,
  notes: row.notes, codeHistory: row.codeHistory, uses: row.uses, revision: row.revision,
});

const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const codeFrom = (value: string) => {
  const code = cleanMidjourneyCode(value);
  if (!code || /\s/.test(code) || code.length > 40) throw new ConvexError("A profile code is one token such as h2eu2z6.");
  return code;
};

const profileRowValidator = v.object({
  id: v.id("mjProfiles"), name: v.string(), code: v.string(), flag: v.string(), mjProfileId: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("retired")), notes: v.optional(v.string()),
  codeHistory: v.array(v.object({ code: v.string(), at: v.number(), note: v.optional(v.string()) })),
  // Only the uses of the world asked about, or all uses when no world is given.
  uses: v.array(v.object({ world: v.string(), worldId: v.id("folders"), role: v.string(), styleTag: v.optional(v.string()) })),
  revision: v.number(), updatedAt: v.number(),
});

export const listProfiles = ownerQuery({
  args: { ownerUserId: v.string(), world: v.optional(v.string()), includeRetired: v.optional(v.boolean()) },
  returns: v.array(profileRowValidator),
  handler: async (ctx, args) => {
    const root = args.world ? await resolveWorld(ctx, args.ownerUserId, args.world) : null;
    const rows: Profile[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate)).collect());
    }
    const keys = new Map<string, string>();
    const keyOf = async (id: Id<"folders">) => {
      if (!keys.has(id)) keys.set(id, (await ctx.db.get(id))?.worldKey ?? id);
      return keys.get(id)!;
    };
    const out = [];
    for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
      if (row.status === "retired" && !args.includeRetired) continue;
      const uses = root ? row.uses.filter((use) => use.worldFolderId === root._id) : row.uses;
      if (root && uses.length === 0) continue;
      out.push({
        id: row._id, name: row.name, code: row.code, flag: profileFlagForCode(row.code), mjProfileId: row.mjProfileId,
        status: row.status, notes: row.notes, codeHistory: row.codeHistory,
        uses: await Promise.all(uses.map(async (use) => ({ world: await keyOf(use.worldFolderId), worldId: use.worldFolderId, role: use.role, styleTag: use.styleTag }))),
        revision: row.revision, updatedAt: row.updatedAt,
      });
    }
    return out;
  },
});

export const saveProfile = ownerMutation({
  args: {
    ownerUserId: v.string(),
    // The world this save is made for; its role is set, and the change lands in its journal.
    world: v.string(),
    // An existing profile (id, name or code). Omit to create one.
    profile: v.optional(v.string()),
    name: v.optional(v.string()),
    // A new code moves the old one to codeHistory (codes are frozen snapshots).
    code: v.optional(v.string()),
    codeNote: v.optional(v.string()),
    mjProfileId: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.literal("active"), v.literal("retired"))),
    // This world's role for the profile; null removes the world's use.
    role: v.optional(v.union(v.string(), v.null())),
    styleTag: v.optional(v.union(v.string(), v.null())),
    expectedRevision: v.optional(v.number()),
    actor: v.optional(v.string()), session: v.optional(v.string()),
  },
  returns: v.object({ profileId: v.id("mjProfiles"), created: v.boolean(), revision: v.number(), changeId: v.union(v.null(), v.id("worldChanges")) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const now = Date.now();
    const styleTag = args.styleTag === null ? undefined : args.styleTag ? normalizeMoodboardStyleTag(args.styleTag) || undefined : undefined;
    const role = args.role?.trim().slice(0, 600);
    const notes = args.notes === null ? undefined : args.notes?.trim().slice(0, 2000) || undefined;

    let row: Profile | null = null;
    if (args.profile?.trim()) {
      const ref = args.profile.trim().replace(/^profile:/, "");
      const byId = ctx.db.normalizeId("mjProfiles", ref);
      row = byId ? await ctx.db.get(byId) : null;
      for (const candidate of resolveUserIdCandidates(owner)) {
        row ??= await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", normalizeName(ref))).first();
        row ??= await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", cleanMidjourneyCode(ref) ?? ref)).first();
      }
      if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) throw new ConvexError(`No profile matches "${args.profile}".`);
    }

    if (!row) {
      const name = args.name?.trim().replace(/\s+/g, " ");
      if (!name || !args.code) throw new ConvexError("A new profile needs a name and its code.");
      if (!role) throw new ConvexError(`Say what the profile does in ${root.name} (role).`);
      for (const candidate of resolveUserIdCandidates(owner)) {
        const clash = await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", normalizeName(name))).first();
        if (clash) throw new ConvexError(`A profile named "${clash.name}" exists; pass profile: "${clash.name}" to add ${root.name}'s role.`);
      }
      const profileId = await ctx.db.insert("mjProfiles", {
        ownerUserId: owner, name, normalizedName: normalizeName(name), code: codeFrom(args.code),
        mjProfileId: args.mjProfileId?.trim() || undefined, status: args.status ?? "active", notes, codeHistory: [],
        uses: [{ worldFolderId: root._id, role, styleTag }], revision: 1, createdAt: now, updatedAt: now,
      });
      const created = (await ctx.db.get(profileId))!;
      const changeId = await recordWorldChange(ctx, {
        ownerUserId: owner, worldFolderId: root._id, op: "profile.save", targetType: "profile", targetId: profileId,
        summary: `Added profile ${name} (${created.code}): ${role}`, after: snapshot(created), actor: args.actor, session: cleanSession(args.session),
      });
      return { profileId, created: true, revision: 1, changeId };
    }

    if (args.expectedRevision !== undefined && args.expectedRevision !== row.revision) {
      throw new ConvexError(`Profile ${row.name} changed (revision ${row.revision}). Read it again.`);
    }
    const before = snapshot(row);
    const name = args.name?.trim().replace(/\s+/g, " ") || row.name;
    const code = args.code ? codeFrom(args.code) : row.code;
    const codeHistory = code !== row.code
      ? [...row.codeHistory, { code: row.code, at: now, ...(args.codeNote?.trim() ? { note: args.codeNote.trim().slice(0, 300) } : {}) }].slice(-MAX_CODE_HISTORY)
      : row.codeHistory;
    let uses = row.uses;
    if (args.role === null) uses = uses.filter((use) => use.worldFolderId !== root._id);
    else if (role || args.styleTag !== undefined) {
      const current = uses.find((use) => use.worldFolderId === root._id);
      const nextUse = { worldFolderId: root._id, role: role ?? current?.role ?? "", styleTag: args.styleTag === undefined ? current?.styleTag : styleTag };
      if (!nextUse.role) throw new ConvexError(`Say what the profile does in ${root.name} (role).`);
      uses = [...uses.filter((use) => use.worldFolderId !== root._id), nextUse];
    }
    const patch = {
      name, normalizedName: normalizeName(name), code, codeHistory, uses,
      mjProfileId: args.mjProfileId === undefined ? row.mjProfileId : args.mjProfileId?.trim() || undefined,
      notes: args.notes === undefined ? row.notes : notes,
      status: args.status ?? row.status,
    };
    if (JSON.stringify({ ...before, revision: 0 }) === JSON.stringify({ ...snapshot({ ...row, ...patch } as Profile), revision: 0 })) {
      return { profileId: row._id, created: false, revision: row.revision, changeId: null };
    }
    const revision = row.revision + 1;
    await ctx.db.patch(row._id, { ...patch, revision, updatedAt: now });
    const what = [
      code !== row.code ? `code ${row.code} → ${code}` : "",
      args.role === null ? `no longer used in ${root.name}` : role ? `role in ${root.name}: ${role}` : "",
      patch.status !== row.status ? patch.status : "",
      name !== row.name ? `renamed from ${row.name}` : "",
    ].filter(Boolean).join("; ") || "details";
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "profile.save", targetType: "profile", targetId: row._id,
      summary: `Profile ${name}: ${what}`, before, after: snapshot({ ...row, ...patch, revision } as Profile), actor: args.actor, session: cleanSession(args.session),
    });
    // A shared profile's code, name or status changes for every world using
    // it: each of them sees the change in its own journal (undo it from one).
    const shared = new Set([...row.uses, ...uses].map((use) => use.worldFolderId).filter((id) => id !== root._id));
    for (const worldFolderId of shared) {
      await recordWorldChange(ctx, {
        ownerUserId: owner, worldFolderId, op: "profile.save", targetType: "profile", targetId: row._id,
        summary: `Profile ${name} changed from ${root.name}: ${what}`, before, after: snapshot({ ...row, ...patch, revision } as Profile), actor: args.actor, session: cleanSession(args.session),
      });
    }
    return { profileId: row._id, created: false, revision, changeId };
  },
});

/** Undo support: put a profile back to `before` (null = it did not exist). */
export const restoreProfileSnapshot = async (
  ctx: MutationCtx, owner: string, profileId: Id<"mjProfiles">,
  before: ProfileSnapshot | null, after: ProfileSnapshot | null, dryRun: boolean,
): Promise<{ ok: true; restored: ProfileSnapshot | null } | { ok: false; reason: string }> => {
  const row = await ctx.db.get(profileId);
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) return { ok: false, reason: "the profile is gone" };
  if (after && !sameContent(snapshot(row), after)) return { ok: false, reason: `profile ${row.name} changed since` };
  if (dryRun) return { ok: true, restored: null };
  if (!before) {
    // Undoing a create retires the profile rather than deleting a record
    // prompts may already cite.
    await ctx.db.patch(row._id, { status: "retired", revision: row.revision + 1, updatedAt: Date.now() });
    return { ok: true, restored: snapshot((await ctx.db.get(row._id))!) };
  }
  const { profileId: _id, revision: _revision, ...fields } = before;
  void _id; void _revision;
  await ctx.db.patch(row._id, { ...fields, normalizedName: normalizeName(fields.name), revision: row.revision + 1, updatedAt: Date.now() });
  return { ok: true, restored: snapshot((await ctx.db.get(row._id))!) };
};
