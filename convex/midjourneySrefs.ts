import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import type { Doc, Id } from "./_generated/dataModel";
import { hydrateGalleryAssetResults } from "./galleryAssetResults";
import {
  extractMidjourneySrefs, parseSrefInput, readSrefNote, httpSourceUrl, SREF_DOMAIN,
  type MidjourneySref,
} from "../lib/midjourney-srefs";

const exampleValidator = v.object({
  assetId: v.id("assets"), url: v.string(), thumbUrl: v.string(),
  promptText: v.optional(v.string()), sourceUrl: v.optional(v.string()),
});
export const srefResultValidator = v.object({
  value: v.string(), parameters: v.string(),
  modelVersion: v.optional(v.string()), styleVersion: v.optional(v.string()),
  styleWeight: v.optional(v.string()), title: v.optional(v.string()),
  note: v.optional(v.string()), sourceUrls: v.array(v.string()),
  promptIds: v.array(v.id("prompts")), examples: v.array(exampleValidator),
});

// A collection view over existing saved media/prompts/bookmarks, not another
// media store. Reads its complete membership via indexes; never a recent-page
// scan of the whole vault. Private even when a source asset is published.
export const list = signedOwnerQuery({
  args: { ownerUserId: v.string(), folderId: v.id("folders"), search: v.optional(v.string()) },
  returns: v.array(srefResultValidator),
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || !canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Collection not found.");
    }
    const links = await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", q => q.eq("folderId", folder._id)).collect();
    const assetDocs: Doc<"assets">[] = [];
    for (const assetId of new Set(links.map(link => link.assetId))) {
      const asset = await ctx.db.get(assetId);
      if (asset && canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) assetDocs.push(asset);
    }
    const assets = await hydrateGalleryAssetResults(ctx, assetDocs);
    const originals = new Set(assets.filter(a => a.assetRole !== "bookmark").map(a => a.sourceUrl).filter(Boolean));
    type Entry = MidjourneySref & {
      title?: string; note?: string; sourceUrls: string[]; promptIds: Id<"prompts">[];
      examples: { assetId: Id<"assets">; url: string; thumbUrl: string; promptText?: string; sourceUrl?: string }[];
    };
    const entries = new Map<string, Entry>();
    const get = (ref: MidjourneySref) => {
      let entry = entries.get(ref.parameters);
      if (!entry) {
        entry = { ...ref, sourceUrls: [], promptIds: [], examples: [] };
        entries.set(ref.parameters, entry);
      }
      return entry;
    };
    for (const asset of assets) {
      // A post preview is only a fallback when its original attachments have
      // not been saved. Do not show a second copy of the first example.
      if (asset.assetRole === "bookmark" && originals.has(asset.sourceUrl)) continue;
      const altRefs = (asset.bookmark?.media ?? []).flatMap(m => extractMidjourneySrefs(m.alt));
      const promptRefs = extractMidjourneySrefs(asset.promptText);
      const refs = promptRefs.length ? promptRefs : altRefs.length ? altRefs : extractMidjourneySrefs(asset.bookmark?.text);
      const previewPrompt = asset.bookmark?.media[0]?.alt;
      const previewRefs = extractMidjourneySrefs(previewPrompt);
      for (const ref of refs) {
        const entry = get(ref);
        const sourceUrl = httpSourceUrl(asset.sourceUrl);
        if (sourceUrl && !entry.sourceUrls.includes(sourceUrl)) entry.sourceUrls.push(sourceUrl);
        if (asset.promptId && !entry.promptIds.includes(asset.promptId)) entry.promptIds.push(asset.promptId);
        const matchesPreview = asset.assetRole !== "bookmark" || !altRefs.length ||
          previewRefs.some(preview => preview.parameters === ref.parameters);
        if (matchesPreview && asset.url && !entry.examples.some(example => example.assetId === asset._id)) {
          entry.examples.push({ assetId: asset._id, url: asset.url, thumbUrl: asset.thumbUrl ?? asset.url,
            promptText: asset.promptText ?? (asset.assetRole === "bookmark" ? previewPrompt : undefined), sourceUrl: asset.sourceUrl });
        }
        entry.note ??= asset.bookmark?.userNote;
      }
    }
    // Text-only saves and media prompts share the same representation. Only
    // our explicit domain reads generationNotes as library metadata.
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const prompts = await ctx.db.query("prompts")
        .withIndex("by_owner_folder_createdAt", q => q.eq("ownerUserId", owner).eq("folderId", folder._id))
        .order("desc").collect();
      for (const prompt of prompts) {
        if (prompt.domain !== SREF_DOMAIN) continue;
        const metadata = readSrefNote(prompt.promptSections?.generationNotes);
        for (const ref of extractMidjourneySrefs(prompt.promptSections?.finalPrompt ?? prompt.text)) {
          const entry = get(ref);
          entry.title ??= metadata.title;
          entry.note = metadata.note ?? entry.note;
          if (metadata.sourceUrl && !entry.sourceUrls.includes(metadata.sourceUrl)) entry.sourceUrls.push(metadata.sourceUrl);
          if (!entry.promptIds.includes(prompt._id)) entry.promptIds.push(prompt._id);
        }
      }
    }
    const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return [...entries.values()].filter(entry => {
      const haystack = [entry.parameters, entry.title, entry.note, ...entry.sourceUrls,
        ...entry.examples.map(example => example.promptText)].join("\n").toLowerCase();
      return words.every(word => haystack.includes(word));
    }).sort((a, b) => a.parameters.localeCompare(b.parameters));
  },
});

// Explicitly requested text recipes need no placeholder image. The key
// includes collection + all saved compatibility settings; retries retain the
// original note. No publication/curator fields are written.
export const save = signedOwnerMutation({
  args: {
    ownerUserId: v.string(), folderId: v.id("folders"), parameters: v.string(),
    title: v.optional(v.string()), note: v.optional(v.string()), sourceUrl: v.optional(v.string()),
  },
  returns: v.object({ promptId: v.id("prompts"), created: v.boolean(), parameters: v.string() }),
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || !canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId)) throw new ConvexError("Collection not found.");
    if (args.parameters.length > 2000 || (args.title?.length ?? 0) > 200 || (args.note?.length ?? 0) > 2000) {
      throw new ConvexError("Sref parameters or note are too long.");
    }
    let ref: MidjourneySref;
    try { ref = parseSrefInput(args.parameters); }
    catch (error) { throw new ConvexError(error instanceof Error ? error.message : "Invalid sref."); }
    const sourceUrl = args.sourceUrl?.trim() || undefined;
    if (sourceUrl) {
      try {
        if (!/^https?:$/.test(new URL(sourceUrl).protocol)) throw new Error();
      } catch { throw new ConvexError("Source must be an http or https URL."); }
    }
    const ingestKey = `midjourney-sref:${args.folderId}:${ref.parameters}`;
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const existing = await ctx.db.query("prompts")
        .withIndex("by_owner_ingestKey", q => q.eq("ownerUserId", owner).eq("ingestKey", ingestKey)).unique();
      if (existing) return { promptId: existing._id, created: false, parameters: ref.parameters };
    }
    const title = args.title?.trim() || undefined;
    const note = args.note?.trim() || undefined;
    const promptId = await ctx.db.insert("prompts", {
      ownerUserId: args.ownerUserId, folderId: folder._id, tagIds: [], ingestKey,
      text: [title, ref.parameters, note, sourceUrl].filter(Boolean).join("\n\n"),
      domain: SREF_DOMAIN, promptType: "other", workflowType: "asset_recipe", modelProvider: "midjourney",
      modelName: ref.modelVersion ? `Midjourney ${ref.modelVersion}` : "Midjourney",
      promptSections: { finalPrompt: ref.parameters, generationNotes: JSON.stringify({ title, note, sourceUrl }) },
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("semanticIndex:reindexPrompt"), { promptId });
    return { promptId, created: true, parameters: ref.parameters };
  },
});
