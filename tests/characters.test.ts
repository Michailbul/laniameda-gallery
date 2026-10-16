import { describe, expect, test } from "bun:test";
import {
  characterCaptionLine, deriveCharacterPrefix, normalizeCharacterName, parseCharacterCode, parseCostumeCode,
} from "../lib/character-codes";
import {
  createCharacter, deleteCharacter, detachAssetFromCharacters, getCharacter, linkAssets, listCharacters,
  listCharactersForAsset, removeCostume, saveCostume, unlinkAssets, updateCharacter,
} from "../convex/characters";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx();
  const world = await db.insert("folders", { ownerUserId: "owner", name: "DEAR ANNETE" });
  const asset = (ownerUserId = "owner") => db.insert("assets", { ownerUserId, kind: "image", tagIds: [], createdAt: Date.now() });
  return { db, ctx, world, asset };
};

describe("character codes", () => {
  test("derive world prefixes, parse codes and costume codes", () => {
    expect(deriveCharacterPrefix("DEAR ANNETE")).toBe("DA");
    expect(deriveCharacterPrefix("Daddy")).toBe("DAD");
    expect(deriveCharacterPrefix("Dear Annete: Live Action")).toBe("DAL");
    expect(deriveCharacterPrefix("—")).toBeUndefined();
    expect(parseCharacterCode("da-ch-7")).toBeUndefined();
    expect(parseCharacterCode("da-ch-007")?.code).toBe("DA-CH-007");
    expect(parseCostumeCode("c1")).toBe("C01");
    expect(parseCostumeCode("DA-CH-007-C02", "DA-CH-007")).toBe("C02");
    expect(parseCostumeCode("DA-CH-008-C02", "DA-CH-007")).toBeUndefined();
    expect(normalizeCharacterName("Ilka ", "Tram-Stop  Flower Seller")).toBe(normalizeCharacterName("ilka", "tram - stop flower seller"));
    expect(characterCaptionLine({ name: "Ilka", alias: "Tram-Stop Flower Seller", code: "DA-CH-007", costumeCode: "C01", label: "sheet", worldName: "Dear Annete" }))
      .toBe("Ilka — Tram-Stop Flower Seller · DA-CH-007 · C01 sheet · Dear Annete");
  });
});

describe("character registry", () => {
  test("assigns sequential world codes, dedupes retries and never reissues a deleted code", async () => {
    const { ctx, world } = await setup();
    const dari = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari", lane: "live-action" });
    const retry = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: " dari " });
    const liz = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Liz" });
    expect([dari.code, retry.code, liz.code]).toEqual(["DA-CH-001", "DA-CH-001", "DA-CH-002"]);
    expect(retry.created).toBe(false);
    await callAsOwner(deleteCharacter)(ctx, { ownerUserId: "owner", character: "DA-CH-002" });
    const rhea = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Rhea" });
    expect(rhea.code).toBe("DA-CH-003");
    const listed = await callAsOwner(listCharacters)(ctx, { ownerUserId: "owner" });
    expect(listed.map((row) => row.character.code)).toEqual(["DA-CH-001", "DA-CH-003"]);
    expect(listed[0].worldName).toBe("DEAR ANNETE");
  });

  test("worlds are owned root collections with distinct prefixes", async () => {
    const { db, ctx, world } = await setup();
    const child = await db.insert("folders", { ownerUserId: "owner", name: "Dari", parentFolderId: world });
    const foreign = await db.insert("folders", { ownerUserId: "other", name: "Theirs" });
    const daddy = await db.insert("folders", { ownerUserId: "owner", name: "Dark Arts" });
    await expect(callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: child, name: "X" })).rejects.toThrow("root collection");
    await expect(callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: foreign, name: "X" })).rejects.toThrow("World collection not found");
    await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari" });
    await expect(callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: daddy, name: "Mike" })).rejects.toThrow("belongs to another world");
    const mike = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: daddy, name: "Mike", prefix: "dk" });
    expect(mike.code).toBe("DK-CH-001");
    await expect(callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Liz", prefix: "LZ" })).rejects.toThrow("already uses the prefix DA");
  });

  test("updates need the current revision and keep names unique inside the world", async () => {
    const { ctx, world, asset } = await setup();
    const sheet = await asset();
    const dari = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari" });
    await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Liz" });
    await expect(callAsOwner(updateCharacter)(ctx, { ownerUserId: "owner", character: dari.code, expectedRevision: 9, status: "approved" })).rejects.toThrow("Reload");
    await expect(callAsOwner(updateCharacter)(ctx, { ownerUserId: "owner", character: dari.code, expectedRevision: 1, name: "liz" })).rejects.toThrow("DA-CH-002 already has that name");
    const updated = await callAsOwner(updateCharacter)(ctx, { ownerUserId: "owner", character: `character:${dari.id}`, expectedRevision: 1, alias: "Long-Haired Civilian", sheetAssetId: sheet, otherNames: ["Dari (civilian)"] });
    expect(updated.revision).toBe(2);
    const same = await callAsOwner(updateCharacter)(ctx, { ownerUserId: "owner", character: dari.code, expectedRevision: 2, alias: "Long-Haired Civilian" });
    expect(same.revision).toBe(2);
    const read = await callAsOwner(getCharacter)(ctx, { ownerUserId: "owner", character: "da-ch-001" });
    expect(read.character.sheetAssetId).toBe(sheet);
    expect(read.character.linkCount).toBe(1);
    expect(read.links.map((link) => link.role)).toEqual(["sheet"]);
    const cleared = await callAsOwner(updateCharacter)(ctx, { ownerUserId: "owner", character: dari.code, expectedRevision: 2, alias: null });
    expect(cleared.revision).toBe(3);
    expect((await callAsOwner(listCharacters)(ctx, { ownerUserId: "owner", search: "civilian" })).map((row) => row.character.code)).toEqual(["DA-CH-001"]);
  });

  test("costumes get stable never-reused codes; removing one keeps its links on the person", async () => {
    const { ctx, world, asset } = await setup();
    const [sheet, face] = [await asset(), await asset()];
    const dari = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari" });
    const c01 = await callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, name: "Black lacquer gown", sheetAssetId: sheet });
    const c02 = await callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, name: "Brass armour" });
    const again = await callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, name: "brass armour" });
    expect([c01.fullCode, c02.fullCode, again.costumeCode, again.created]).toEqual(["DA-CH-001-C01", "DA-CH-001-C02", "C02", false]);
    await callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, code: "DA-CH-001-C01", faceAssetId: face, status: "sheeted" });
    await expect(callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, code: "C09" })).rejects.toThrow("no costume C09");
    let read = await callAsOwner(getCharacter)(ctx, { ownerUserId: "owner", character: dari.code });
    expect(read.character.costumes[0]).toMatchObject({ code: "C01", status: "sheeted", sheetAssetId: sheet, faceAssetId: face });
    expect(read.links.map((link) => [link.role, link.costumeCode])).toEqual([["sheet", "C01"], ["face", "C01"]]);
    await callAsOwner(removeCostume)(ctx, { ownerUserId: "owner", character: dari.code, code: "c1" });
    const c03 = await callAsOwner(saveCostume)(ctx, { ownerUserId: "owner", character: dari.code, name: "Ivory lace" });
    expect(c03.costumeCode).toBe("C03");
    read = await callAsOwner(getCharacter)(ctx, { ownerUserId: "owner", character: dari.code });
    expect(read.links.every((link) => link.costumeCode === undefined)).toBe(true);
  });

  test("links are typed, owner-checked, unlinkable, and drop with a deleted asset", async () => {
    const { ctx, world, asset } = await setup();
    const [sheet, scene, theirs] = [await asset(), await asset(), await asset("other")];
    const dari = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari", sheetAssetId: sheet });
    const mike = await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Mike" });
    await expect(callAsOwner(linkAssets)(ctx, { ownerUserId: "owner", character: dari.code, links: [{ assetId: theirs, role: "reference" }] })).rejects.toThrow("Asset not found");
    const linked = await callAsOwner(linkAssets)(ctx, { ownerUserId: "owner", character: dari.code, links: [{ assetId: scene, role: "appears-in" }, { assetId: sheet, role: "sheet" }] });
    expect([linked.created, linked.unchanged]).toEqual([1, 1]);
    await callAsOwner(linkAssets)(ctx, { ownerUserId: "owner", character: mike.code, links: [{ assetId: scene, role: "appears-in", note: "left of frame" }] });
    expect((await callAsOwner(listCharactersForAsset)(ctx, { ownerUserId: "owner", assetId: scene })).map((row) => row.code)).toEqual(["DA-CH-001", "DA-CH-002"]);
    const unlinked = await callAsOwner(unlinkAssets)(ctx, { ownerUserId: "owner", character: dari.code, assetIds: [sheet] });
    expect(unlinked.removed).toBe(1);
    let read = await callAsOwner(getCharacter)(ctx, { ownerUserId: "owner", character: dari.code });
    expect(read.character.sheetAssetId).toBeUndefined();
    expect(read.character.linkCount).toBe(1);
    await detachAssetFromCharacters(ctx as never, scene as never);
    read = await callAsOwner(getCharacter)(ctx, { ownerUserId: "owner", character: dari.code });
    expect(read.links).toHaveLength(0);
    expect(read.character.linkCount).toBe(0);
  });

  test("private to the signed owner", async () => {
    const { ctx, world } = await setup();
    await callAsOwner(createCharacter)(ctx, { ownerUserId: "owner", worldFolderId: world, name: "Dari" });
    await expect(callAsOwner(listCharacters)({ ...ctx, auth: { getUserIdentity: async () => null } }, { ownerUserId: "owner" })).rejects.toThrow("Not authenticated");
    await expect(callAsOwner(getCharacter)({ ...ctx, auth: { getUserIdentity: async () => ({ subject: "other" }) } }, { ownerUserId: "", character: "DA-CH-001" })).rejects.toThrow("Character not found");
  });
});
