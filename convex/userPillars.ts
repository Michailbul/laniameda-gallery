import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_PILLARS = [
  {
    key: "creators",
    label: "Creators",
    description: "AI creators, portraits, fashion, and character references.",
    color: "#ff7a64",
    icon: "sparkles",
    sortOrder: 10,
  },
  {
    key: "cars",
    label: "Cars",
    description: "Cinematic automotive references and prompts.",
    color: "#e5534b",
    icon: "car",
    sortOrder: 20,
  },
  {
    key: "designs",
    label: "Designs",
    description: "Websites, apps, components, and UI references.",
    color: "#5d6bfa",
    icon: "layout",
    sortOrder: 30,
  },
  {
    key: "dump",
    label: "Dump",
    description: "Useful saves that do not fit a focused board yet.",
    color: "#2eb8b4",
    icon: "archive",
    sortOrder: 40,
  },
] as const;

const normalizeKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const normalizeOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeColor = (value: string | undefined) => {
  const trimmed = normalizeOptional(value);
  if (!trimmed) return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
    throw new ConvexError("Pillar color must be a 6-digit hex value.");
  }
  return trimmed;
};

const pillarResultValidator = v.object({
  _id: v.optional(v.id("userPillars")),
  ownerUserId: v.string(),
  key: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
  icon: v.optional(v.string()),
  sortOrder: v.number(),
  isDefault: v.optional(v.boolean()),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const listPillars = query({
  args: {
    ownerUserId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(pillarResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const persisted = await ctx.db
      .query("userPillars")
      .withIndex("by_owner_sortOrder", (q) => q.eq("ownerUserId", ownerUserId))
      .order("asc")
      .collect();

    const now = Date.now();
    const persistedByKey = new Map(persisted.map((pillar) => [pillar.key, pillar]));
    const merged = DEFAULT_PILLARS.map((defaultPillar) => {
      const row = persistedByKey.get(defaultPillar.key);
      if (row) return row;
      return {
        ownerUserId,
        key: defaultPillar.key,
        label: defaultPillar.label,
        description: defaultPillar.description,
        color: defaultPillar.color,
        icon: defaultPillar.icon,
        sortOrder: defaultPillar.sortOrder,
        isDefault: true,
        archivedAt: undefined,
        createdAt: now,
        updatedAt: now,
      };
    });

    for (const row of persisted) {
      if (!DEFAULT_PILLARS.some((pillar) => pillar.key === row.key)) {
        merged.push(row);
      }
    }

    return merged
      .filter((pillar) => args.includeArchived || !pillar.archivedAt)
      .sort((left, right) => {
        const orderDiff = left.sortOrder - right.sortOrder;
        if (orderDiff !== 0) return orderDiff;
        return left.label.localeCompare(right.label);
      });
  },
});

export const upsertPillar = mutation({
  args: {
    ownerUserId: v.string(),
    key: v.optional(v.string()),
    label: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.object({
    pillarId: v.id("userPillars"),
    key: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const label = args.label.trim();
    const key = normalizeKey(args.key || label);
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (!label) {
      throw new ConvexError("Pillar label is required.");
    }
    if (!key) {
      throw new ConvexError("Pillar key could not be derived.");
    }

    const existing = await ctx.db
      .query("userPillars")
      .withIndex("by_owner_key", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("key", key),
      )
      .unique();
    const now = Date.now();
    const patch = {
      label,
      description: normalizeOptional(args.description),
      color: normalizeColor(args.color),
      icon: normalizeOptional(args.icon),
      sortOrder: args.sortOrder ?? existing?.sortOrder ?? 100,
      archivedAt: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { pillarId: existing._id, key, created: false };
    }

    const defaultMatch = DEFAULT_PILLARS.find((pillar) => pillar.key === key);
    const pillarId = await ctx.db.insert("userPillars", {
      ownerUserId,
      key,
      ...patch,
      isDefault: Boolean(defaultMatch),
      createdAt: now,
    });
    return { pillarId, key, created: true };
  },
});

export const archivePillar = mutation({
  args: {
    ownerUserId: v.string(),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const key = normalizeKey(args.key);
    if (!ownerUserId || !key) {
      throw new ConvexError("ownerUserId and key are required.");
    }
    if (DEFAULT_PILLARS.some((pillar) => pillar.key === key)) {
      throw new ConvexError("Default pillars cannot be archived.");
    }

    const existing = await ctx.db
      .query("userPillars")
      .withIndex("by_owner_key", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("key", key),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
