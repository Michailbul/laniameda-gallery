import { describe, expect, test } from "bun:test";
import { characterCreateSchema, characterListSchema, characterRefOf, characterRefSchema, worldRefOf } from "../lib/character-contract";
import { inboxListSchema, inboxPostSchema, inboxStackRefOf, inboxStackRefSchema, inboxWorldRefOf, similarGroupsSchema } from "../lib/inbox-contract";
import { moodboardRefOf, moodboardRefSchema } from "../lib/moodboard-contract";
import { TYPED_ID_ROUTES, galleryIdHelp, normalizeGalleryIdKind, parseGalleryId, typedIdRoute } from "../lib/gallery-ids";

// Character and Inbox tools take `world` (key, name or root id) with
// worldFolderId as the older alias, refuse keys they do not take, and accept
// `id` where another tool would say moodboardId / character / stackId.

describe("world arguments on character and inbox tools", () => {
  test("list and create take world or worldFolderId and refuse stray keys", () => {
    expect(characterListSchema.parse({ world: "dear-annete" })).toEqual({ world: "dear-annete" });
    expect(worldRefOf(characterListSchema.parse({ worldFolderId: "j97root" }))).toBe("j97root");
    expect(worldRefOf(characterListSchema.parse({}))).toBeUndefined();
    expect(characterListSchema.safeParse({ world: "dear-annete", folderId: "x" }).success).toBe(false);
    expect(characterListSchema.safeParse({ worldId: "x" }).success).toBe(false);

    expect(characterCreateSchema.safeParse({ name: "Ilka" }).success).toBe(false);
    expect(characterCreateSchema.safeParse({ world: "dear-annete", name: "Ilka" }).success).toBe(true);
    expect(characterCreateSchema.safeParse({ worldFolderId: "j97root", name: "Ilka" }).success).toBe(true);
    expect(characterCreateSchema.safeParse({ world: "dear-annete", name: "Ilka", costume: "C01" }).success).toBe(false);

    expect(inboxListSchema.parse({ world: "dear-annete", status: "closed" })).toEqual({ world: "dear-annete", status: "closed" });
    expect(inboxWorldRefOf(inboxListSchema.parse({ worldFolderId: "j97root" }))).toBe("j97root");
    expect(inboxListSchema.safeParse({ world: "dear-annete", stackId: "s" }).success).toBe(false);

    const cards = [{ type: "ab", assetIds: ["asset:a", "asset:b"] }];
    expect(inboxPostSchema.safeParse({ stackTitle: "x", cards }).success).toBe(false);
    expect(inboxPostSchema.safeParse({ world: "dear-annete", stackTitle: "x", cards }).success).toBe(true);
    expect(inboxPostSchema.safeParse({ worldFolderId: "j97root", stackTitle: "x", cards }).success).toBe(true);
    expect(inboxPostSchema.safeParse({ world: "dear-annete", stackTitle: "x", cards, folderId: "f" }).success).toBe(false);

    expect(similarGroupsSchema.safeParse({}).success).toBe(false);
    expect(similarGroupsSchema.safeParse({ world: "dear-annete" }).success).toBe(true);
    expect(similarGroupsSchema.safeParse({ folderId: "j97shelf", maxDistance: 4 }).success).toBe(true);
  });

  test("get_character, get_moodboard and list_inbox_decisions accept id as an alias and refuse a stray world", () => {
    expect(characterRefOf(characterRefSchema.parse({ character: "DA-CH-001" }))).toBe("DA-CH-001");
    expect(characterRefOf(characterRefSchema.parse({ id: "character:c1" }))).toBe("character:c1");
    expect(characterRefSchema.safeParse({}).success).toBe(false);
    expect(characterRefSchema.safeParse({ character: "DA-CH-001", world: "dear-annete" }).success).toBe(false);

    expect(moodboardRefOf(moodboardRefSchema.parse({ moodboardId: "moodboard:m1" }))).toBe("moodboard:m1");
    expect(moodboardRefOf(moodboardRefSchema.parse({ id: "m1" }))).toBe("m1");
    expect(moodboardRefSchema.safeParse({}).success).toBe(false);

    expect(inboxStackRefOf(inboxStackRefSchema.parse({ stackId: "stack:s1" }))).toBe("stack:s1");
    expect(inboxStackRefOf(inboxStackRefSchema.parse({ id: "s1" }))).toBe("s1");
    expect(inboxStackRefSchema.safeParse({ world: "dear-annete" }).success).toBe(false);
  });
});

describe("typed gallery ids", () => {
  test("every prefix names one read tool and argument", () => {
    const prefixes = TYPED_ID_ROUTES.map((route) => route.prefix);
    expect(prefixes).toEqual(expect.arrayContaining(["asset", "pack", "skill", "design", "moodboard", "story", "character", "stack", "card", "task", "video", "world", "collection"]));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(typedIdRoute("moodboards")).toMatchObject({ tool: "get_moodboard", argument: "moodboardId" });
    expect(typedIdRoute("folders")).toMatchObject({ tool: "list_collections" });
    expect(typedIdRoute("nope")).toBeUndefined();
    expect(normalizeGalleryIdKind("workflow")).toBe("skill");
    expect(normalizeGalleryIdKind("assetPacks")).toBe("pack");
    expect(normalizeGalleryIdKind("moodboard")).toBeNull();
  });

  test("parseGalleryId reads asset, skill, pack and design and names the right tool for the rest", () => {
    expect(parseGalleryId("asset:a1")).toEqual({ kind: "asset", id: "a1" });
    expect(parseGalleryId(" skill:s1 ")).toEqual({ kind: "skill", id: "s1" });
    expect(parseGalleryId("workflow:w1")).toEqual({ kind: "skill", id: "w1" });
    expect(parseGalleryId("pack:p1")).toEqual({ kind: "pack", id: "p1" });
    expect(parseGalleryId("a1", "asset")).toEqual({ kind: "asset", id: "a1" });
    expect(() => parseGalleryId("moodboard:m1")).toThrow(/moodboard:m1 is read with get_moodboard \{ moodboardId: "m1" \}/);
    expect(() => parseGalleryId("story:s1")).toThrow(/get_story \{ id: "s1" \}/);
    expect(() => parseGalleryId("character:c1")).toThrow(/get_character \{ character: "character:c1" \}/);
    expect(() => parseGalleryId("stack:k1")).toThrow(/list_inbox_decisions \{ stackId: "k1" \}/);
    expect(() => parseGalleryId("task:t1")).toThrow(/get_task \{ taskId: "t1" \}/);
    expect(() => parseGalleryId("bare1")).toThrow(/asset:bare1/);
    expect(() => parseGalleryId("bare1")).toThrow(/references\/data-model.md/);
    expect(() => parseGalleryId("thing:x")).toThrow(/Unknown id prefix "thing:"/);
    expect(() => parseGalleryId("moodboard:m1", "asset")).toThrow(/read with get_moodboard/);
    expect(() => parseGalleryId("pack:p1", "asset")).toThrow(/Expected asset:<id>, got pack:p1/);
    expect(() => parseGalleryId("")).toThrow("id is required.");
    expect(galleryIdHelp("story:s1")).toContain("not get_gallery_item");
  });
});
