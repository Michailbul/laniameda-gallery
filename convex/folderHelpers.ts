import { ConvexError } from "convex/values";
import { type Id } from "./_generated/dataModel";
import { type MutationCtx } from "./_generated/server";
import { canActorAccessOwnerUserId } from "./authz";

export const normalizeFolderName = (name: string) =>
  name.trim().replace(/\s+/g, " ");

export const canonicalFolderName = (name: string) =>
  normalizeFolderName(name).toLowerCase();

export const ensureFolderOwnership = async (
  ctx: MutationCtx,
  ownerUserId: string,
  folderId: Id<"folders"> | undefined,
) => {
  if (!folderId) {
    return;
  }

  const folder = await ctx.db.get(folderId);
  if (!folder) {
    throw new ConvexError("Folder not found.");
  }

  if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
    throw new ConvexError("Folder does not belong to this user.");
  }

  // Every caller of this guard is a filing path (assets/prompts/designs into
  // a folder). Projects group collections, never content — a membership here
  // would be invisible to every project query.
  if (folder.kind === "project") {
    throw new ConvexError(
      "Content can't be filed into a project directly — file it into one of the project's collections.",
    );
  }
};
