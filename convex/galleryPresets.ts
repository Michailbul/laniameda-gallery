import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { presetFiltersValidator } from "./storyValidators";
import { canonicalTagKey, findTagIdsByCanonicalKeys, normalizeTagName } from "./helpers";

const resultValidator = v.object({ _id: v.id("galleryPresets"), _creationTime: v.number(), ownerUserId: v.string(), name: v.string(), normalizedName: v.string(), filters: presetFiltersValidator, createdAt: v.number(), updatedAt: v.number() });

const ownedPreset = async (ctx: QueryCtx, owner: string, id: Id<"galleryPresets">) => {
  const preset = await ctx.db.get(id);
  if (!preset || !canActorAccessOwnerUserId(owner, preset.ownerUserId)) throw new ConvexError("Preset not found.");
  return preset;
};

const validateFilters = async (ctx: QueryCtx, owner: string, filters: Doc<"galleryPresets">["filters"]) => {
  for (const id of [...filters.selectedFilterIds, ...filters.excludedFilterIds]) {
    const entry = await ctx.db.get(id);
    if (!entry || !canActorAccessOwnerUserId(owner, entry.ownerUserId)) throw new ConvexError("Filter not found.");
    if (filters.selectedFilterIds.includes(id) && entry.kind !== "tag") throw new ConvexError("Included filters must be tag filters; choose a collection with folderId.");
    if (filters.selectedFilterIds.includes(id)) {
      const idsByKey = await findTagIdsByCanonicalKeys(ctx, (entry.tagNames ?? []).map(canonicalTagKey));
      if (![...idsByKey.values()].some((ids) => ids.length > 0)) throw new ConvexError("Included filter has no available tags.");
    }
  }
  if (filters.selectedFilterIds.some((id) => filters.excludedFilterIds.includes(id))) throw new ConvexError("A filter cannot be both included and excluded.");
  if (filters.folderId) {
    const folder = await ctx.db.get(filters.folderId);
    if (!folder || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) throw new ConvexError("Collection not found.");
  }
};

export const listPresets = ownerQuery({
  args: { ownerUserId: v.string() }, returns: v.array(resultValidator),
  handler: async (ctx, args) => {
    const rows: Doc<"galleryPresets">[] = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) rows.push(...await ctx.db.query("galleryPresets").withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner)).collect());
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const savePreset = ownerMutation({
  args: { ownerUserId: v.string(), name: v.string(), filters: presetFiltersValidator }, returns: v.id("galleryPresets"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name || name.length > 80) throw new ConvexError("A preset name is required (at most 80 characters).");
    await validateFilters(ctx, args.ownerUserId, args.filters);
    const normalizedName = name.toLowerCase().replace(/\s+/g, " ");
    let existing: Doc<"galleryPresets"> | null = null;
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      existing = await ctx.db.query("galleryPresets").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", owner).eq("normalizedName", normalizedName)).unique();
      if (existing) break;
    }
    const filters = { ...args.filters, selectedFilterIds: [...new Set(args.filters.selectedFilterIds)], excludedFilterIds: [...new Set(args.filters.excludedFilterIds)] };
    if (existing) {
      if (existing.name !== name || JSON.stringify(existing.filters) !== JSON.stringify(filters)) await ctx.db.patch(existing._id, { name, filters, updatedAt: Date.now() });
      return existing._id;
    }
    const now = Date.now();
    return ctx.db.insert("galleryPresets", { ownerUserId: args.ownerUserId, name, normalizedName, filters, createdAt: now, updatedAt: now });
  },
});

export const deletePreset = ownerMutation({
  args: { ownerUserId: v.string(), id: v.id("galleryPresets") }, returns: v.null(),
  handler: async (ctx, args) => {
    if (!await ctx.db.get(args.id)) return null;
    await ownedPreset(ctx, args.ownerUserId, args.id);
    await ctx.db.delete(args.id);
    return null;
  },
});

// Only adds missing presets. Re-running never overwrites an owner's edits.
export const seedPresets = ownerMutation({
  args: { ownerUserId: v.string() }, returns: v.array(v.id("galleryPresets")),
  handler: async (ctx, args) => {
    const menus: Doc<"menuFilters">[] = [];
    const presets: Doc<"galleryPresets">[] = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      menus.push(...await ctx.db.query("menuFilters").withIndex("by_owner_sortOrder", (q) => q.eq("ownerUserId", owner)).collect());
      presets.push(...await ctx.db.query("galleryPresets").withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner)).collect());
    }
    const specs = [
      { name: "No skills", tags: [] },
      { name: "Inspirations", tags: ["inspiration"] },
      { name: "Animated characters", tags: ["character", "animation"] },
      { name: "Locations", tags: ["location"] },
      { name: "Game views", tags: ["game-view"] },
    ];
    for (const tag of new Set(specs.flatMap((spec) => spec.tags))) {
      const key = canonicalTagKey(tag);
      const matches = await findTagIdsByCanonicalKeys(ctx, [key]);
      if (!matches.has(key)) await ctx.db.insert("tags", { name: tag, normalized: normalizeTagName(tag), canonicalKey: key, usageCount: 0, source: "agent", category: "content_type" });
    }
    const ids: Id<"galleryPresets">[] = [];
    let sortOrder = Math.max(-1, ...menus.map((menu) => menu.sortOrder));
    for (const spec of specs) {
      const existing = presets.find((preset) => preset.normalizedName === spec.name.toLowerCase());
      if (existing) { ids.push(existing._id); continue; }
      const selectedFilterIds: Id<"menuFilters">[] = [];
      for (const tag of spec.tags) {
        // Exact one-tag predicates keep a preset from accidentally broadening.
        const menu = menus.find((entry) => entry.kind === "tag" && entry.tagNames?.length === 1 && canonicalTagKey(entry.tagNames[0]) === canonicalTagKey(tag));
        const now = Date.now();
        const id = menu?._id ?? await ctx.db.insert("menuFilters", { ownerUserId: args.ownerUserId, label: tag === "game-view" ? "Game views" : tag[0].toUpperCase() + tag.slice(1), kind: "tag", tagNames: [tag], sortOrder: ++sortOrder, createdAt: now, updatedAt: now });
        selectedFilterIds.push(id);
      }
      const now = Date.now();
      ids.push(await ctx.db.insert("galleryPresets", { ownerUserId: args.ownerUserId, name: spec.name, normalizedName: spec.name.toLowerCase(), filters: { selectedFilterIds, excludedFilterIds: [], onlyLiked: false, includeSkills: false, flattenStacks: false, sortOrder: "newest" }, createdAt: now, updatedAt: now }));
    }
    return ids;
  },
});
