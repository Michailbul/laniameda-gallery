import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

export type SemanticGalleryAsset = FunctionReturnType<
  typeof api.semanticSearch.searchAssets
>[number];

export type GalleryAsset = FunctionReturnType<
  typeof api.assets.listGalleryAssets
>[number];

export type PromptOnlyGalleryPrompt = FunctionReturnType<
  typeof api.prompts.listPromptOnlyGalleryPrompts
>[number];

export type TagRecord = FunctionReturnType<typeof api.tags.listTags>[number];

export type FolderRecord = FunctionReturnType<
  typeof api.folders.listFolders
>[number];
