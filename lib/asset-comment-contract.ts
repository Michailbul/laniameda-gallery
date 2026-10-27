import { z } from "zod";

// Agent input for asset comments (MCP tools and /api/agent/comments).
export const commentListSchema = z.object({
  assetId: z.string().min(1).optional().describe("asset:<id> or a bare id: that asset's thread, oldest first. Omit for the newest comments across the vault."),
  since: z.number().int().nonnegative().optional().describe("Only comments written at or after this time (ms since epoch). Vault-wide listing only."),
  author: z.enum(["owner", "agent"]).optional().describe("owner = Michael's comments, agent = agent replies. Vault-wide listing only."),
  limit: z.number().int().min(1).max(200).optional().describe("Vault-wide listing size, default 50."),
});

export const commentAddSchema = z.object({
  assetId: z.string().min(1).describe("asset:<id> or a bare id."),
  body: z.string().min(1).max(4000).describe("The reply, plain text, at most 4000 characters."),
});
