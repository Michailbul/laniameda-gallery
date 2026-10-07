import { z } from "zod";

const ids = z.array(z.string().min(1)).max(200);
const names = z.array(z.string().trim().min(1)).max(100);

/** Strict scoped listing contract, shared by HTTP and MCP entry points. */
export const galleryAssetPageInputSchema = z.object({
  cursor: z.string().max(100_000).nullable().optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  kind: z.enum(["image", "video"]).optional(), folderId: z.string().min(1).optional(),
  includeDescendants: z.boolean().optional(), includeWorkflowAssets: z.boolean().optional(),
  modelName: z.string().optional(),
  assetRole: z.enum(["generated_output", "reference", "inspiration_capture", "workflow_asset", "cinema_frame", "other"]).optional(),
  tagNames: names.optional(), anyTagNames: names.optional(), excludeTagNames: names.optional(),
  tagIdGroups: z.array(ids).max(50).optional(), excludeTagIds: ids.optional(), excludeFolderIds: ids.optional(),
  pieceType: z.enum(["character", "location", "scene", "inspiration"]).optional(),
  medium: z.enum(["animation", "live-action"]).optional(),
  onlyLiked: z.boolean().optional(), onlyStarred: z.boolean().optional(), search: z.string().max(4000).optional(),
}).strict();
