"use node";
import { v, ConvexError } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { buildImageEditMessages, parseImageEditAnswer } from "../lib/mj-image-edit-chat";
import { cleanRules, finishLocally, localArg, localMessages, modelArg, providerArg, rulesArg, runRoutes, type LocalMessages } from "./promptEditRunner";
import { pickWriterModel } from "../lib/writer-models";
import type { QuickEditModel } from "../lib/mj-quick-edit";

export const answer = ownerAction({
  args: { ownerUserId: v.string(), context: v.any(), tools: v.array(v.any()), results: v.array(v.any()), model: modelArg, provider: providerArg, rules: rulesArg, local: localArg },
  returns: v.union(localMessages, v.object({ reply: v.string(), prompt: v.optional(v.string()), tools: v.array(v.object({ name: v.string(), arguments: v.any() })), model: v.string(), provider: v.string(), systemPrompt: v.string() })),
  handler: async (ctx, args): Promise<LocalMessages | { reply: string; prompt?: string; tools: Array<{ name: string; arguments: Record<string, unknown> }>; model: string; provider: string; systemPrompt: string }> => {
    const messages = buildImageEditMessages(args.context, args.tools, args.results);
    const rules = cleanRules(args.rules);
    if (rules) messages[0].content += `\nMichael's writing preferences:\n${rules}`;
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 2800 } };
    const picked = pickWriterModel(args.model, true);
    const result = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, picked.model as QuickEditModel, messages, "Could not prepare an edit", 2800, args.provider);
    try { return { ...parseImageEditAnswer(result.raw), model: result.model, provider: result.provider, systemPrompt: String(messages[0].content) }; }
    catch { throw new ConvexError("The writer returned an incomplete answer. Your message is saved; try again."); }
  },
});
