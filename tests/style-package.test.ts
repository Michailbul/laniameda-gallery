import { expect, test } from "bun:test";
import { registerGalleryTools, type JsonRecord } from "../mcp/laniameda-gallery/tools";
import {
  boardForCode, buildStyleLockBody, matchBoards, MISSING_BOARD_FLAG, styleSlug, stylePackageIngestKey, stylePackageSchema, type BoardRow,
} from "../lib/style-package";

type Tool = { config: JsonRecord; handler: (input: JsonRecord) => Promise<{ content: { text: string }[] }> };
const registry = (apiFetch: (path: string, input: JsonRecord) => Promise<JsonRecord>) => {
  const tools = new Map<string, Tool>();
  registerGalleryTools({ registerTool: (name: string, config: JsonRecord, handler: Tool["handler"]) => { tools.set(name, { config, handler }); } } as never, { apiUrl: "https://gallery.test", apiFetch });
  return tools;
};

const boards: BoardRow[] = [
  { _id: "b-home", name: "DA LACQUER 3D · World", folderId: "shelf-3d", mjCode: "h2rdly5", mjMoodboardId: "7510665128084745260", status: "in-midjourney", itemCount: 9 },
  { _id: "b-away", name: "STYLE · Art Deco Animation", folderId: "deco-branch", folderName: "Art Deco Animation", mjCode: "l9gg966", mjMoodboardId: "7510338823872077076", status: "in-midjourney", itemCount: 20 },
  { _id: "b-old", name: "DA FILM · Golden", folderId: "film", mjCode: "88ji6bg", mjCodeHistory: [{ code: "oldgold" }] },
];

test("style keys are stable slugs of the name inside the world", () => {
  expect(styleSlug("Patent Noir")).toBe("patent-noir");
  expect(styleSlug("Café · Brass & Lamplight")).toBe("cafe-brass-lamplight");
  expect(stylePackageIngestKey("dear-annete-3d", "Patent Noir")).toBe("style-lock:dear-annete-3d:patent-noir");
});

test("a code finds its board by current code, Midjourney id or an earlier code", () => {
  expect(boardForCode(boards, "l9gg966")?._id).toBe("b-away");
  expect(boardForCode(boards, "m7510665128084745260")?._id).toBe("b-home");
  expect(boardForCode(boards, "oldgold")?._id).toBe("b-old");
  expect(boardForCode(boards, "nope123")).toBeUndefined();
});

test("boards are linked in the world, cited from another world, flagged when missing", () => {
  const matches = matchBoards(["h2rdly5", "l9gg966", "zzz9999"], boards, new Set(["root-3d", "shelf-3d"]));
  expect(matches.map((match) => match.state)).toEqual(["linked", "other-world", "missing"]);
});

test("the lock body carries recipe, prompt, examples, words and the missing-board flag", () => {
  const input = stylePackageSchema.parse({
    world: "dear-annete-3d", name: "Patent Noir", styleTag: "da-3d-patent-noir",
    recipe: { opener: "feature animation film, dark art deco style,", moodboardCodes: ["zzz9999"], parameters: "--stylize 650 --v 8.2" },
    exampleAssetIds: ["asset:a1"], raises: ["one warm machine light (2 of 4 liked)"], lowers: ["--raw (0 of 43 glossy)"],
  });
  const body = buildStyleLockBody({
    input, worldName: "DEAR ANNETE — 3D", worldKey: "dear-annete-3d", ingestKey: "style-lock:dear-annete-3d:patent-noir",
    boards: matchBoards(input.recipe.moodboardCodes, boards, new Set(["root-3d"])),
    examples: [{ id: "a1", prompt: "feature animation film, a woman --profile zzz9999", description: "Woman in a laundry." }], date: "2026-11-01",
  });
  expect(body).toContain(`**${MISSING_BOARD_FLAG}:** \`zzz9999\``);
  expect(body).toContain("```text\nfeature animation film, dark art deco style, [SCENE");
  expect(body).toContain("--profile zzz9999 --stylize 650 --v 8.2\n```");
  expect(body).toContain("1. asset:a1 · Woman in a laundry.");
  expect(body).toContain("- --raw (0 of 43 glossy)");
  expect(body).toContain("Profiles: none");
});

const fakeGallery = (calls: { path: string; input: JsonRecord }[], options: { exampleFolder?: string; storyError?: string } = {}) => async (path: string, input: JsonRecord): Promise<JsonRecord> => {
  calls.push({ path, input });
  if (path === "/api/agent/worlds" && input.action === "open") {
    return { world: { id: "root-3d", key: "dear-annete-3d", name: "DEAR ANNETE — 3D" }, shelves: [{ id: "shelf-vb", name: "Velvet Burlesque", group: "Styles" }, { id: "shelf-3d", name: "3D Animation" }] };
  }
  if (path === "/api/agent/gallery") return { asset: { _id: String(input.id).replace("asset:", ""), folderIds: [options.exampleFolder ?? "shelf-3d"], promptText: "feature animation film --profile l9gg966", agentDescription: "A frame." } };
  if (path === "/api/agent/moodboards" && input.action === "list") return { moodboards: boards };
  if (path === "/api/agent/moodboards" && input.action === "get") return { parentFolderName: "DEAR ANNETE — ART DECO", folderName: "Art Deco Animation" };
  if (path === "/api/agent/stories" && input.action === "save") {
    if (options.storyError) throw new Error(options.storyError);
    return { ok: true, id: "s1", created: true, revision: 1, story: { _id: "s1", url: "https://gallery.test/stories/s1" } };
  }
  if (path === "/api/agent/stories" && input.action === "list") return { stories: [{ _id: "s1", ingestKey: "style-lock:dear-annete-3d:patent-noir", revision: 3 }] };
  return { ok: true };
};
const args = {
  world: "dear-annete-3d", name: "Patent Noir", styleTag: "da-3d-patent-noir", shelf: "Velvet Burlesque",
  recipe: { opener: "feature animation film, dark art deco style,", moodboardCodes: ["l9gg966"], parameters: "--stylize 650" },
  exampleAssetIds: ["asset:a1", "a2"], session: "style-test",
};

test("package_style dry run checks everything and writes nothing", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const result = await registry(fakeGallery(calls)).get("package_style")!.handler({ ...args, dryRun: true });
  const out = JSON.parse(result.content[0].text);
  expect(out).toMatchObject({ ok: true, dryRun: true, ingestKey: "style-lock:dear-annete-3d:patent-noir", wouldFile: 2, shelf: { id: "shelf-vb" } });
  expect(out.moodboards).toEqual([{ code: "l9gg966", state: "other-world", moodboardId: "moodboard:b-away", name: "STYLE · Art Deco Animation", world: "DEAR ANNETE — ART DECO" }]);
  expect(out.body).toContain("Lives in another world (DEAR ANNETE — ART DECO › Art Deco Animation)");
  expect(calls.some((call) => call.input.action === "save" || call.input.action === "file")).toBe(false);
});

test("package_style files the examples on the style shelf and saves one style lock", async () => {
  const calls: { path: string; input: JsonRecord }[] = [];
  const tools = registry(fakeGallery(calls));
  expect(tools.get("package_style")!.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  const out = JSON.parse((await tools.get("package_style")!.handler(args)).content[0].text);
  expect(out).toMatchObject({ ok: true, created: true, revision: 1, story: { id: "story:s1", url: "https://gallery.test/stories/s1" } });
  expect(calls.find((call) => call.input.action === "file")!.input).toMatchObject({ world: "dear-annete-3d", assetIds: ["a1", "a2"], addTo: ["shelf-vb"], session: "style-test" });
  expect(calls.find((call) => call.input.action === "save")!.input).toMatchObject({
    kind: "style-lock", status: "draft", folderId: "shelf-vb", styleTag: "da-3d-patent-noir", tagNames: ["style-lock", "da-3d-patent-noir"],
    assetIds: ["a1", "a2"], ingestKey: "style-lock:dear-annete-3d:patent-noir", title: "DEAR ANNETE — 3D · Patent Noir · Midjourney recipe",
  });
});

test("package_style refuses examples from another world and names the lock to update on a revision clash", async () => {
  const tools = registry(fakeGallery([], { exampleFolder: "elsewhere" }));
  await expect(tools.get("package_style")!.handler(args)).rejects.toThrow("Examples must live in DEAR ANNETE — 3D: asset:a1, asset:a2");
  const clash = registry(fakeGallery([], { storyError: "expectedRevision is required to change an existing Story. Read it before saving." }));
  await expect(clash.get("package_style")!.handler(args)).rejects.toThrow("pass expectedRevision: 3");
});
