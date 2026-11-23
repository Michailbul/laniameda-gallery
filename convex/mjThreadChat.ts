"use node";

import { ConvexError, v } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { internal } from "./_generated/api";
import {
  cleanRules, finishLocally, localArg, localMessages, modelArg, providerArg, rulesArg, runRoutes, systemOf, worldBriefOf,
  type LocalMessages,
} from "./promptEditRunner";
import { pickWriterModel } from "../lib/writer-models";
import type { QuickEditModel } from "../lib/mj-quick-edit";
import { buildChatMessages, parseChatAnswer, type ChatHistoryEntry, type ChatThreadItem } from "../lib/mj-thread";

// The agent in a thread's chat (23 Nov 2026). Michael's message is already
// in the chat (mjThreads.postMessage); this runs the writer on it where he
// picked (This Mac through the extension's bridge, Cloud · fal or Cloud ·
// Pika, the same routes as Grow and quick edit), applies the operations it
// answers with and posts its reply with what changed. Nothing is sent to
// Midjourney.

type Context = {
  batch: string;
  batchKey: string;
  worldKey?: string;
  text: string;
  items: ChatThreadItem[];
  runs: Array<{ run: number; label: string; count: number }>;
  history: ChatHistoryEntry[];
  profiles: Array<{ name: string; code: string; kind: string }>;
};

const answerOut = v.object({
  reply: v.string(),
  changes: v.array(v.string()),
  run: v.optional(v.number()),
  messageId: v.string(),
  model: v.string(),
  provider: v.string(),
  requestId: v.optional(v.string()),
  ms: v.number(),
  notes: v.array(v.string()),
  systemPrompt: v.optional(v.string()),
  world: v.optional(v.string()),
});

export const answer = ownerAction({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    // Michael's message to answer (from postMessage).
    messageId: v.string(),
    model: modelArg,
    provider: providerArg,
    rules: rulesArg,
    local: localArg,
  },
  returns: v.union(answerOut, localMessages),
  handler: async (ctx, args): Promise<
    { reply: string; changes: string[]; run?: number; messageId: string; model: string; provider: string; requestId?: string; ms: number; notes: string[]; systemPrompt?: string; world?: string }
    | LocalMessages
  > => {
    const owner = args.ownerUserId;
    const context = (await ctx.runQuery(internal.mjThreads.chatContext, { ownerUserId: owner, batch: args.batch, messageId: args.messageId })) as Context;
    const brief = context.worldKey
      ? await worldBriefOf(ctx, { ownerUserId: owner, world: context.worldKey, tier: "short" })
      : null;
    const messages = buildChatMessages({
      batch: context.batch,
      worldName: brief?.world?.name,
      items: context.items,
      runs: context.runs,
      history: context.history,
      message: context.text,
      profiles: context.profiles,
      worldBrief: brief?.text,
      rules: cleanRules(args.rules),
    });
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 6000 } };
    const picked = pickWriterModel(args.model, false);
    let answered;
    try {
      answered = finishLocally(args.local) ?? await runRoutes(ctx, owner, picked.model as QuickEditModel, messages, "Could not answer", 6000, args.provider);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mjThreads.writerFailed, { ownerUserId: owner, messageId: args.messageId, error: reason });
      throw error instanceof ConvexError ? error : new ConvexError(reason);
    }
    const { raw, ...meta } = answered;
    let parsed;
    try {
      parsed = parseChatAnswer(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mjThreads.writerFailed, { ownerUserId: owner, messageId: args.messageId, error: reason });
      throw new ConvexError(reason);
    }
    const author = `writer · ${meta.model}`;
    const applied = await ctx.runMutation(internal.mjThreads.applyChatAnswer, {
      ownerUserId: owner, batch: context.batchKey, messageId: args.messageId,
      reply: parsed.reply, ops: parsed.ops, dropped: parsed.dropped, author, model: meta.model,
    });
    return {
      reply: applied.message.text,
      changes: applied.changes,
      run: applied.run,
      messageId: applied.message.id,
      model: meta.model,
      provider: meta.provider,
      requestId: meta.requestId,
      ms: meta.ms,
      notes: meta.notes,
      systemPrompt: systemOf(messages),
      world: brief?.world?.name,
    };
  },
});
