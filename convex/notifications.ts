"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { resolveTelegramChatId, resolveTelegramNotificationBotToken, sendTelegramMessage } from "./telegram";

export const notifyKBIngest = internalAction({
  args: {
    ownerUserId: v.string(),
    pillar: v.string(),
    promptText: v.optional(v.string()),
    modelName: v.optional(v.string()),
    tagNames: v.optional(v.array(v.string())),
    assetId: v.optional(v.string()),
    promptId: v.optional(v.string()),
    isDuplicate: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const token = resolveTelegramNotificationBotToken();
    if (!token) {
      return null;
    }

    const chatId = resolveTelegramChatId(args.ownerUserId);
    if (!chatId) {
      return null;
    }

    const promptText = args.promptText?.trim();
    const preview = promptText
      ? `"${promptText.slice(0, 60)}${promptText.length > 60 ? "..." : ""}"`
      : args.assetId
        ? "image/asset"
        : args.promptId
          ? "prompt"
          : "unknown";

    const model = args.modelName ? ` · ${args.modelName}` : "";
    const tags = args.tagNames?.length
      ? ` · ${args.tagNames.slice(0, 4).join(", ")}`
      : "";
    const status = args.isDuplicate ? "⚠️ Duplicate" : "✅ Saved";
    const text = `${status} → [${args.pillar}] ${preview}${model}${tags}`;

    await sendTelegramMessage(token, chatId, text, "KB ingest");
    return null;
  },
});
