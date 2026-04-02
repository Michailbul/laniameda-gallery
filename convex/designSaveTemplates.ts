import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { trimOptionalText } from "./designSaveHelpers";
import { designSaveTemplateDefaultsValidator } from "./validators";

const designSaveTemplateValidator = v.object({
  _id: v.id("designSaveTemplates"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  key: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
  defaults: designSaveTemplateDefaultsValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

const normalizeTemplateKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const upsertDesignSaveTemplate = mutation({
  args: {
    ownerUserId: v.string(),
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    defaults: designSaveTemplateDefaultsValidator,
  },
  returns: v.object({
    templateId: v.id("designSaveTemplates"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const key = normalizeTemplateKey(args.key);
    const label = trimOptionalText(args.label);
    if (!key || !label) {
      throw new ConvexError("Template key and label are required.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("designSaveTemplates")
      .withIndex("by_owner_key", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("key", key),
      )
      .unique();

    const defaults = {
      ...args.defaults,
      tagNames: args.defaults.tagNames?.map((tag) => tag.trim()).filter(Boolean),
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        label,
        description: trimOptionalText(args.description),
        defaults,
        updatedAt: now,
      });
      return { templateId: existing._id, created: false };
    }

    const templateId = await ctx.db.insert("designSaveTemplates", {
      ownerUserId,
      key,
      label,
      description: trimOptionalText(args.description),
      defaults,
      createdAt: now,
      updatedAt: now,
    });
    return { templateId, created: true };
  },
});

export const listDesignSaveTemplates = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(designSaveTemplateValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const rows = await Promise.all(
      ownerUserIds.map((ownerCandidate) =>
        ctx.db
          .query("designSaveTemplates")
          .withIndex("by_owner_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
          )
          .order("desc")
          .collect(),
      ),
    );

    const seen = new Set<string>();
    return rows
      .flat()
      .filter((template) => {
        if (seen.has(template.key)) {
          return false;
        }
        seen.add(template.key);
        return true;
      });
  },
});

export const getDesignSaveTemplateByKey = internalQuery({
  args: {
    ownerUserId: v.string(),
    key: v.string(),
  },
  returns: v.union(v.null(), designSaveTemplateValidator),
  handler: async (ctx, args) => {
    const key = normalizeTemplateKey(args.key);
    if (!key) {
      return null;
    }

    const ownerUserIds = resolveUserIdCandidates(args.ownerUserId.trim());
    for (const ownerCandidate of ownerUserIds) {
      const template = await ctx.db
        .query("designSaveTemplates")
        .withIndex("by_owner_key", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("key", key),
        )
        .unique();
      if (template) {
        return template;
      }
    }

    return null;
  },
});

export const deleteDesignSaveTemplate = mutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("designSaveTemplates"),
  },
  returns: v.id("designSaveTemplates"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const template = await ctx.db.get(args.id);
    if (!template) {
      throw new ConvexError("Design save template not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, template.ownerUserId)) {
      throw new ConvexError("Design save template does not belong to this user.");
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});
