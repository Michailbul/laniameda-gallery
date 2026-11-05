import { describe, expect, test } from "bun:test";
import { extractMidjourneySrefs, parseSrefInput } from "../lib/midjourney-srefs";
import { list, save } from "../convex/midjourneySrefs";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

describe("reusable sref extraction", () => {
  test("retains source versions, weights, long string codes and mixtures", () => {
    const recipe = parseSrefInput("--sref 0009007199254740993::2 3534013297 --v 8.2 --sv 6 --sw 500");
    expect(recipe.parameters).toBe("--sref 0009007199254740993::2 3534013297 --sw 500 --sv 6 --v 8.2");
    expect(extractMidjourneySrefs(`A park ${recipe.parameters} --ar 16:9 --stylize 600`)).toEqual([recipe]);
    expect(parseSrefInput("https://example.com/reference.jpg::2 123").value).toBe("https://example.com/reference.jpg::2 123");
  });
  test("extracts ALT prompts, deduplicates repeated recipes, excludes random", () => {
    const text = "A beautiful sref!\n--sref 3534013297\nPrompts in ALT";
    expect(extractMidjourneySrefs(text).map(ref => ref.value)).toEqual(["3534013297"]);
    expect(extractMidjourneySrefs("--sref 123 --v 7\n--sref 123 --v 7\n--sref 123 --v 6\n--sref random")).toHaveLength(2);
    expect(extractMidjourneySrefs("--sref 123 kept for later")[0].parameters).toBe("--sref 123");
  });
  test("rejects incomplete, ambiguous or non-reusable manual inputs", () => {
    for (const input of ["random", "123 prose", "--sref 123 --ar 16:9", "--sref 123 --sw 1001",
      "--sref 123 --v 7 --v 6", "--sref 123\n--sref 456", "--sref 123 --sw nope", "--sref 123 random"]) {
      expect(() => parseSrefInput(input)).toThrow();
    }
  });
});

describe("private collection recipes", () => {
  test("idempotent saves preserve notes and separate version changes", async () => {
    const { db, ctx } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "owner", name: "Midjourney Srefs" });
    const args = { ownerUserId: "owner", folderId, parameters: "--sref 3534013297 --v 8.2", note: "Keep this note", sourceUrl: "https://x.com/umesh_ai/status/2109521650316358055" };
    const first = await callAsOwner(save)(ctx, args);
    const again = await callAsOwner(save)(ctx, { ...args, note: "Do not overwrite" });
    expect(again).toEqual({ ...first, created: false });
    await callAsOwner(save)(ctx, { ...args, parameters: "--sref 3534013297 --v 7" });
    const rows = await callAsOwner(list)(ctx, { ownerUserId: "owner", folderId });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.note === "Keep this note")).toBe(true);
    expect(await callAsOwner(list)(ctx, { ownerUserId: "owner", folderId, search: "8.2 keep" })).toHaveLength(1);
    const stored = await db.get(first.promptId);
    expect(stored?.domain).toBe("midjourney-sref");
    expect(stored).not.toHaveProperty("isPublic");
  });
  test("rejects foreign collections and unsigned access", async () => {
    const { db, ctx } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "other", name: "Private" });
    await expect(callAsOwner(save)(ctx, { ownerUserId: "owner", folderId, parameters: "123" })).rejects.toThrow("Collection not found");
    await expect(callAsOwner(list)(ctx, { ownerUserId: "owner", folderId })).rejects.toThrow("Collection not found");
    await expect(callAsOwner(list)({ ...ctx, auth: { getUserIdentity: async () => null } }, { ownerUserId: "other", folderId })).rejects.toThrow("Not authenticated");
    await expect(callAsOwner(list)({ ...ctx, auth: { getUserIdentity: async () => ({ subject: "owner" }) } }, { ownerUserId: "other", folderId })).rejects.toThrow("does not match");
  });
  test("groups saved examples, excludes duplicate post preview and foreign links", async () => {
    const { db, ctx } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "owner", name: "Midjourney Srefs" });
    const sourceUrl = "https://x.com/umesh_ai/status/2109521650316358055";
    const promptId = await db.insert("prompts", { ownerUserId: "owner", text: "A park --sref 3534013297 --sw 500 --v 8.2" });
    for (const values of [
      { ownerUserId: "owner", promptId, sourceUrl, assetRole: "inspiration_capture" },
      { ownerUserId: "owner", promptId, sourceUrl, assetRole: "inspiration_capture" },
      { ownerUserId: "owner", promptId, sourceUrl, assetRole: "bookmark" },
      { ownerUserId: "other", promptId, sourceUrl, assetRole: "inspiration_capture" },
    ]) {
      const assetId = await db.insert("assets", { ...values, kind: "image", tagIds: [], createdAt: Date.now() });
      await db.insert("assetFolders", { assetId, folderId, createdAt: Date.now() });
    }
    const rows = await callAsOwner(list)(ctx, { ownerUserId: "owner", folderId });
    expect(rows).toHaveLength(1);
    expect(rows[0].examples).toHaveLength(2);
    expect(rows[0].sourceUrls).toEqual([sourceUrl]);
    expect(rows[0].parameters).toBe("--sref 3534013297 --sw 500 --v 8.2");
  });
  test("a bookmark preview is not attributed to another attachment's code", async () => {
    const { db, ctx } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "owner", name: "Midjourney Srefs" });
    const bookmarkId = await db.insert("bookmarks", { ownerUserId: "owner", media: [
      { kind: "image", url: "https://example.com/first.jpg", alt: "Park --sref 111 --v 7" },
      { kind: "image", url: "https://example.com/second.jpg", alt: "Portrait --sref 222 --v 7" },
    ] });
    const assetId = await db.insert("assets", { ownerUserId: "owner", kind: "image", assetRole: "bookmark",
      bookmarkId, sourceUrl: "https://example.com/post", tagIds: [], createdAt: Date.now() });
    await db.insert("assetFolders", { assetId, folderId, createdAt: Date.now() });
    const rows = await callAsOwner(list)(ctx, { ownerUserId: "owner", folderId });
    expect(rows.find(row => row.value === "111")?.examples).toHaveLength(1);
    expect(rows.find(row => row.value === "222")?.examples).toHaveLength(0);
  });
});
