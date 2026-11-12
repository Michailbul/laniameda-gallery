import { beforeEach, describe, expect, test } from "bun:test";

import {
  GUEST_TOOL_NAMES, guestCollectionRows, guestMayCall, guestVisibleFolderIds, isGuestTool, isGuestVisibleAsset,
  isGuestVisibleSkill, sanitizeGuestAsset, stripGuestFilters,
} from "../lib/guest-access";
import { authenticateAgentToken, createAgentToken, updateAgentTokenScopes, listAgentTokens } from "../convex/agentTokens";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

// The guest reader rule (lib/guest-access.ts): visible only when filed in an
// allowed shelf and in nothing hidden. Deny wins.
const FOLDERS = [
  { _id: "art" },
  { _id: "art-child", parentFolderId: "art" },
  { _id: "cars" },
  { _id: "cars-skills", parentFolderId: "cars" },
  { _id: "techniques" },
  { _id: "love" },
  { _id: "pets" },
  { _id: "dear-annete", worldKey: "dear-annete" },
  { _id: "da-shelf", parentFolderId: "dear-annete" },
  { _id: "da-3d", worldKey: "dear-annete-3d", universeRootId: "dear-annete" },
  { _id: "cassandra", project: { client: "x" } },
  { _id: "new-root" },
];
const ALLOWED = ["art", "cars", "techniques", "dear-annete", "cassandra"];

describe("guest reader visibility", () => {
  const visible = guestVisibleFolderIds(FOLDERS, ALLOWED);

  test("allowed roots and their children are visible; worlds never, even when allowlisted", () => {
    expect([...visible].sort()).toEqual(["art", "art-child", "cars", "cars-skills", "techniques"]);
    expect(visible.has("dear-annete")).toBe(false);
    expect(visible.has("da-shelf")).toBe(false);
    expect(visible.has("cassandra")).toBe(false);
    expect(visible.has("new-root")).toBe(false);
  });

  test("asset only in ART is visible", () => {
    expect(isGuestVisibleAsset({ folderIds: ["art"] }, visible)).toBe(true);
    expect(isGuestVisibleAsset({ folderId: "art-child", folderIds: [] }, visible)).toBe(true);
  });

  test("asset in ART and DEAR ANNETE is hidden (deny wins)", () => {
    expect(isGuestVisibleAsset({ folderIds: ["art", "dear-annete"] }, visible)).toBe(false);
    expect(isGuestVisibleAsset({ folderId: "da-shelf", folderIds: ["art"] }, visible)).toBe(false);
  });

  test("asset only in a world is hidden", () => {
    expect(isGuestVisibleAsset({ folderIds: ["da-shelf"] }, visible)).toBe(false);
    expect(isGuestVisibleAsset({ folderIds: ["da-3d"] }, visible)).toBe(false);
  });

  test("asset in LOVE and YOUTUBE CARS is hidden", () => {
    expect(isGuestVisibleAsset({ folderIds: ["cars", "love"] }, visible)).toBe(false);
  });

  test("asset with no collection, or in a root not on the allowlist, is hidden", () => {
    expect(isGuestVisibleAsset({ folderIds: [] }, visible)).toBe(false);
    expect(isGuestVisibleAsset({ folderIds: ["art", "new-root"] }, visible)).toBe(false);
    expect(isGuestVisibleAsset(null, visible)).toBe(false);
  });

  test("skill in TECHNIQUES is visible; skill in a world is hidden", () => {
    expect(isGuestVisibleSkill({ folderIds: ["techniques"] }, visible)).toBe(true);
    expect(isGuestVisibleSkill({ collections: [{ _id: "cars-skills" }] }, visible)).toBe(true);
    expect(isGuestVisibleSkill({ folderIds: ["dear-annete"] }, visible)).toBe(false);
    expect(isGuestVisibleSkill({ folderIds: ["techniques", "da-shelf"] }, visible)).toBe(false);
  });

  test("collection listing drops hidden collections and every count", () => {
    const rows = guestCollectionRows(FOLDERS.map((folder) => ({ ...folder, memberCount: 9, publicMemberCount: 1 })), visible);
    expect(rows.map((row) => row._id).sort()).toEqual(["art", "art-child", "cars", "cars-skills", "techniques"]);
    expect(rows.every((row) => !("memberCount" in row) && !("publicMemberCount" in row))).toBe(true);
  });

  test("private marks and notes are stripped from an asset", () => {
    const asset = sanitizeGuestAsset({ _id: "a", isLiked: true, superLikedAt: 1, starredAt: 2, starNote: "mine", bookmark: { text: "post", userNote: "private" } });
    expect(asset).toEqual({ _id: "a", bookmark: { text: "post" } } as never);
  });

  test("like and star filters are dropped", () => {
    expect(stripGuestFilters({ onlyLiked: true, onlySuperLiked: true, onlyStarred: true, mustShow: ["x"], world: "da", query: "car" })).toEqual({ query: "car" });
  });
});

describe("guest reader tools and routes", () => {
  test("write tools are refused", () => {
    for (const name of ["save_asset", "save_assets", "update_gallery_item", "delete_gallery_item", "create_collection", "edit_asset", "save_video_refs", "add_asset_comment", "open_world", "list_stories", "list_tags", "list_asset_comments", "inspiration_private_media"]) {
      expect(isGuestTool(name)).toBe(false);
    }
    for (const name of ["search_gallery", "get_gallery_item", "list_collections", "list_video_refs", "get_skill"]) {
      expect(isGuestTool(name)).toBe(true);
    }
    expect(GUEST_TOOL_NAMES.size).toBe(14);
  });

  test("only read actions on three routes are open", () => {
    expect(guestMayCall("/api/agent/gallery", "searchAssets")).toBe(true);
    expect(guestMayCall("/api/agent/gallery", "findBySourceUrls")).toBe(false);
    expect(guestMayCall("/api/agent/gallery", "listDesigns")).toBe(false);
    expect(guestMayCall("/api/agent/customize", "listFolders")).toBe(true);
    expect(guestMayCall("/api/agent/customize", "listTags")).toBe(false);
    expect(guestMayCall("/api/agent/customize", "createFolder")).toBe(false);
    expect(guestMayCall("/api/agent/video-refs", "save")).toBe(false);
    expect(guestMayCall("/api/agent/ingest", undefined)).toBe(false);
  });
});

describe("guest reader tokens", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  const owner = "owner-1";

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
    process.env.AGENT_TOKEN_ISSUER_SECRET = "issuer-secret";
  });

  const folder = (fields: Record<string, unknown>) => harness.db.insert("folders", { ownerUserId: owner, name: "F", ...fields });

  test("mints with allowed roots, authenticates with them, and is not editable", async () => {
    const art = await folder({ name: "ART" });
    const token = await callAsOwner(createAgentToken)(harness.ctx as never, {
      serverSecret: "issuer-secret", ownerUserId: owner, tokenHash: "h", tokenPrefix: "lgat_guest",
      label: "Guest", scopes: ["guest:read"], allowedRootIds: [art],
    });
    expect(token.canEditScopes).toBe(false);
    const auth = await callAsOwner(authenticateAgentToken)(harness.ctx as never, { tokenHash: "h" });
    expect(auth?.scopes).toEqual(["guest:read"]);
    expect(auth?.allowedRootIds).toEqual([art]);
    // An owner-scope check (every existing route) refuses it.
    expect(await callAsOwner(authenticateAgentToken)(harness.ctx as never, { tokenHash: "h", requiredScope: "gallery:read" })).toBeNull();
    await expect(callAsOwner(updateAgentTokenScopes)(harness.ctx as never, {
      serverSecret: "issuer-secret", ownerUserId: owner, tokenId: token._id, scopes: ["gallery:read"],
    })).rejects.toThrow("fixed");
    const listed = await callAsOwner(listAgentTokens)(harness.ctx as never, { serverSecret: "issuer-secret", ownerUserId: owner });
    expect(listed[0]?.allowedRootIds).toEqual([art]);
  });

  test("refuses worlds, children, other scopes and an empty allowlist", async () => {
    const world = await folder({ name: "DA", worldKey: "dear-annete" });
    const root = await folder({ name: "ART" });
    const child = await folder({ name: "child", parentFolderId: root });
    const mint = (extra: Record<string, unknown>) => callAsOwner(createAgentToken)(harness.ctx as never, {
      serverSecret: "issuer-secret", ownerUserId: owner, tokenHash: `h-${Math.random()}`, tokenPrefix: "p", scopes: ["guest:read"], ...extra,
    });
    await expect(mint({ allowedRootIds: [world] })).rejects.toThrow("world");
    await expect(mint({ allowedRootIds: [child] })).rejects.toThrow("root collections");
    await expect(mint({ allowedRootIds: [] })).rejects.toThrow("at least one");
    await expect(mint({ allowedRootIds: [root], scopes: ["guest:read", "gallery:write"] })).rejects.toThrow("cannot be combined");
    await expect(mint({ allowedRootIds: [root], scopes: ["gallery:read"] })).rejects.toThrow("guest:read token only");
  });
});

describe("guest reader MCP tool list", () => {
  test("registers exactly the guest tools, and every guest tool exists", async () => {
    const { registerGalleryTools } = await import("../mcp/laniameda-gallery/tools");
    const names: string[] = [];
    const fake = { registerTool: (name: string) => { names.push(name); } };
    registerGalleryTools(fake as never, { apiFetch: async () => ({}), apiUrl: "http://test", onlyTools: GUEST_TOOL_NAMES });
    expect(names.sort()).toEqual([...GUEST_TOOL_NAMES].sort());
    const all: string[] = [];
    registerGalleryTools({ registerTool: (name: string) => { all.push(name); } } as never, { apiFetch: async () => ({}), apiUrl: "http://test" });
    expect(all.length).toBeGreaterThan(100);
  });
});
