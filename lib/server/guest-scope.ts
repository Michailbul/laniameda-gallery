import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import type { getServerConvexClient } from "@/lib/server/convex";
import type { GuestReach } from "@/lib/server/agent-auth";
import { guestVisibleFolderIds, isGuestVisibleMembership } from "@/lib/guest-access";

type Client = ReturnType<typeof getServerConvexClient>;

export type GuestScope = {
  folders: Array<Record<string, unknown> & { _id: string; parentFolderId?: string }>;
  visible: Set<string>;
};

const assetMembershipsRef = makeFunctionReference<"query">("guestAccess:assetMemberships");

/** The owner's folders and the set this guest may see. One query per request. */
export const loadGuestScope = async (client: Client, ownerUserId: string, guest: GuestReach): Promise<GuestScope> => {
  const folders = (await client.query(api.folders.listFolders, { ownerUserId })) as unknown as GuestScope["folders"];
  return { folders, visible: guestVisibleFolderIds(folders as never, guest.allowedRootIds) };
};

/** Every visible collection inside one visible collection (itself, plus children for a root). */
export const guestFolderAndChildren = (scope: GuestScope, folderId: string) => {
  if (!scope.visible.has(folderId)) return null;
  const ids = [folderId];
  for (const folder of scope.folders) {
    if (folder.parentFolderId === folderId && scope.visible.has(String(folder._id))) ids.push(String(folder._id));
  }
  return ids;
};

/** Which of these asset ids the guest may see (deny wins); hidden and missing look the same. */
export const guestVisibleAssetIds = async (client: Client, ownerUserId: string, scope: GuestScope, assetIds: string[]) => {
  if (assetIds.length === 0) return new Set<string>();
  const rows = (await client.query(assetMembershipsRef, {
    ownerUserId,
    assetIds: assetIds as Id<"assets">[],
  })) as Array<{ assetId: string; folderIds: string[] }>;
  return new Set(rows.filter((row) => isGuestVisibleMembership(row.folderIds, scope.visible)).map((row) => row.assetId));
};

/**
 * Media embedded in a Skill the guest may read: a step example with no
 * collection of its own stays (it belongs to the Skill); one filed anywhere
 * hidden is dropped.
 */
export const guestEmbeddableMediaIds = async (client: Client, ownerUserId: string, scope: GuestScope, assetIds: string[]) => {
  const unique = Array.from(new Set(assetIds)).slice(0, 200);
  if (unique.length === 0) return new Set<string>();
  const rows = (await client.query(assetMembershipsRef, {
    ownerUserId,
    assetIds: unique as Id<"assets">[],
  })) as Array<{ assetId: string; folderIds: string[] }>;
  return new Set(rows.filter((row) => row.folderIds.every((id) => scope.visible.has(String(id)))).map((row) => row.assetId));
};
