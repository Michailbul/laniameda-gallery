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

// Self-healing denormalized member count. Recounts a folder's assetFolders
// links from the index and patches folders.memberCount when it changed. Call
// after any mutation that inserts or deletes links for the folder — a full
// recount per touched folder is cheap, exact, and immune to the ±1 drift
// that killed hand-maintained counters.
export const recountFolderMembers = async (
  ctx: MutationCtx,
  folderIds: Iterable<Id<"folders"> | undefined>,
) => {
  const unique = new Set<Id<"folders">>();
  for (const folderId of folderIds) {
    if (folderId) unique.add(folderId);
  }
  for (const folderId of unique) {
    const folder = await ctx.db.get(folderId);
    if (!folder) continue;
    const links = await ctx.db
      .query("assetFolders")
      .withIndex("by_folder_createdAt", (q) =>
        q.eq("folderId", folderId).gte("createdAt", 0),
      )
      .collect();
    const memberCount = new Set(links.map((link) => link.assetId)).size;
    if (folder.memberCount !== memberCount) {
      await ctx.db.patch(folderId, { memberCount });
    }
  }
};
