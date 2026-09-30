import { authedMutation } from "./actor";
import { v } from "convex/values";

export const generateUploadUrl = authedMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
