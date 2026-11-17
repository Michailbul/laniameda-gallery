import { beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_FAST_MODEL, FAST_MODELS, FAST_TEMPLATES, fastCatalog, fastInput, fastLineage, fastModelById, fastPostSchema,
  fastTakeUsd, planFastRun, priceLabel, readFastImage, runStatusOf,
} from "../lib/mj-fast-helper";
import { buildEditInput, editModelById, estimateEditUsd } from "../lib/edit-models";

type Take = { index: number; status: string; review?: string };
type Run = { _id: string; count: number; modelName: string; instruction: string; status: string; takes: Take[] };
type PageApi = {
  placeBeside: (rect: { left: number; right: number; top: number; bottom: number }, view: { width: number; height: number }, size: { width: number; height: number }) => { x: number; y: number };
  barWithImage: (bar: string, url: string) => string;
  frameUrls: (tile: { jobId: string; index: number } | null, rendered: string) => string[];
  urlFromDrop: (drop: { uri?: string; text?: string; html?: string }) => string;
  anyInFlight: (runs: Array<{ status: string }>) => boolean;
  flattenTakes: (runs: Run[]) => Array<{ key: string; take: Take }>;
  stepSelection: (count: number, current: number, delta: number) => number;
  takeLabel: (run: Run, take: Take) => string;
  fantasyNote: (run: Partial<Run>) => string;
  priceText: (perTake: number, count: number) => string;
};
const page = () => (globalThis as typeof globalThis & { SaveToGalleryFastHelper: PageApi }).SaveToGalleryFastHelper;

beforeAll(async () => {
  await import("../extension/mj-fast-helper.js");
});

const JOB = "0f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("models", () => {
  test("Seedream 5.5 is the default, then Krea 3, GPT Flare and Nano 2.1 on keys 1–4, all on fal", () => {
    expect(DEFAULT_FAST_MODEL.id).toBe("seedream-5.5");
    expect(FAST_MODELS.filter((model) => !model.tool).map((model) => model.id)).toEqual(["seedream-5.5", "krea-3", "gpt-flare", "nano-21"]);
    expect(FAST_MODELS.map((model) => model.endpoint)).toEqual([
      "bytedance/seedream/v5.5/edit", "krea/v3/edit", "openai/gpt-image-2.5/flare/edit", "google/nano-banana-2.1/edit", "fal-ai/seedvr/upscale/image",
    ]);
  });

  test("Seedream 5.5 joins the in-place edit models on fal; Seedream 5 Pro is unchanged", () => {
    expect(editModelById("seedream-5.5")!.routes).toEqual([{ provider: "fal", endpoint: "bytedance/seedream/v5.5/edit" }]);
    expect(editModelById("seedream-5")!.routes.map((route) => route.endpoint)).toEqual([
      "seedream-5-pro", "bytedance/seedream-5.0-pro/image-to-image", "bytedance/seedream/v5/pro/edit",
    ]);
    expect(estimateEditUsd("bytedance/seedream/v5.5/edit", 1456, 816, 3)).toBe(0.03);
  });
});

describe("request bodies (dry, as fal's schemas take them, 17 Nov 2026)", () => {
  const urls = ["https://r2.example/frame.png", "https://r2.example/ref1.png", "https://r2.example/ref2.png"];

  test("Seedream 5.5: prompt, up to 10 image URLs, auto 2K, PNG", () => {
    const body = fastInput(fastModelById("seedream-5.5")!, "Make it night", urls, 1456, 816);
    expect(body).toEqual({ prompt: "Make it night", image_urls: urls, image_size: "auto_2K", output_format: "png" });
    expect(buildEditInput("bytedance/seedream/v5.5/edit", "x", Array.from({ length: 12 }, (_, i) => `u${i}`)).image_urls).toHaveLength(10);
  });

  test("Nano Banana 2.1 on fal: image_urls, the frame's aspect, 1K", () => {
    expect(fastInput(fastModelById("nano-21")!, "Same face", urls.slice(0, 1), 1456, 816))
      .toEqual({ prompt: "Same face", image_urls: urls.slice(0, 1), aspect_ratio: "16:9", resolution: "1K", output_format: "png" });
  });

  test("Krea 3 and GPT Flare reuse the in-place edit bodies", () => {
    expect(fastInput(fastModelById("krea-3")!, "x", urls, 1456, 816)).toEqual(buildEditInput("krea/v3/edit", "x", urls, 1456, 816));
    expect(fastInput(fastModelById("gpt-flare")!, "x", urls)).toEqual({ prompt: "x", image_urls: urls, quality: "high" });
  });

  test("the upscaler takes the frame only, twice the size", () => {
    expect(fastInput(fastModelById("upscale-2k")!, "Upscale", urls))
      .toEqual({ image_url: urls[0], upscale_mode: "factor", upscale_factor: 2, output_format: "png" });
  });

  test("references past a model's limit are left out", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://r2.example/${i}.png`);
    expect((fastInput(fastModelById("nano-21")!, "x", many).image_urls as string[]).length).toBe(7);
  });
});

describe("prices and plans", () => {
  test("a take's price per model", () => {
    expect(fastTakeUsd(fastModelById("seedream-5.5")!)).toBe(0.03);
    expect(fastTakeUsd(fastModelById("krea-3")!, 1456, 816)).toBe(0.0594);
    expect(fastTakeUsd(fastModelById("gpt-flare")!)).toBe(0.055);
    expect(fastTakeUsd(fastModelById("upscale-2k")!, 1456, 816)).toBe(0.0048);
    expect(priceLabel(0.03, 1)).toBe("≈ $0.030");
    expect(priceLabel(0.03, 3)).toBe("≈ $0.090 · 3 × $0.030");
  });

  test("plans a run and refuses the ones it must not send", () => {
    expect(planFastRun({ modelId: "seedream-5.5", instruction: "  Make it   night ", count: 2, refs: 1 }))
      .toMatchObject({ ok: true, count: 2, refs: 1, perTakeUsd: 0.03, totalUsd: 0.06, instruction: "Make it night" });
    expect(planFastRun({ modelId: "seedream-5.5", instruction: " ", count: 1, refs: 0 })).toEqual({ ok: false, error: "Say what to change." });
    expect(planFastRun({ modelId: "upscale-2k", instruction: "", count: 1, refs: 2 })).toMatchObject({ ok: true, instruction: "SeedVR2 upscale", refs: 0, refsDropped: 2 });
    expect(planFastRun({ modelId: "seedream-5.5", instruction: "x", count: 5, refs: 0 })).toMatchObject({ ok: false });
    expect(planFastRun({ modelId: "seedream-5.5", instruction: "x", count: 1, refs: 7 })).toMatchObject({ ok: false });
    expect(planFastRun({ modelId: "midjourney", instruction: "x", count: 1, refs: 0 })).toMatchObject({ ok: false });
  });

  test("the catalog gives the card every model with its price, and the chips", () => {
    const catalog = fastCatalog(1456, 816);
    expect(catalog.models.find((model) => model.id === "seedream-5.5")).toMatchObject({ default: true, perTakeUsd: 0.03 });
    expect(catalog.templates.map((template) => template.label)).toEqual(FAST_TEMPLATES.map((template) => template.label));
    expect(catalog.templates.find((template) => template.key === "upscale")?.model).toBe("upscale-2k");
  });
});

describe("runs and results", () => {
  test("a run's status follows its takes", () => {
    expect(runStatusOf([{ status: "queued" }, { status: "queued" }])).toBe("queued");
    expect(runStatusOf([{ status: "done" }, { status: "running" }])).toBe("running");
    expect(runStatusOf([{ status: "done" }, { status: "error" }])).toBe("done");
    expect(runStatusOf([{ status: "error" }])).toBe("error");
    expect(runStatusOf([])).toBe("error");
  });

  test("reads the picture from an edit result and from the upscaler", () => {
    expect(readFastImage(200, { images: [{ url: "https://fal.media/a.png", width: 2048, height: 1152 }] }))
      .toEqual({ url: "https://fal.media/a.png", width: 2048, height: 1152 });
    expect(readFastImage(200, { image: { url: "https://fal.media/b.png" } })).toEqual({ url: "https://fal.media/b.png" });
    expect(readFastImage(200, { images: [] })).toEqual({ error: "fal returned no image (safety filter?)" });
    expect("error" in readFastImage(422, { detail: "bad" })).toBe(true);
  });

  test("the lineage line names the job, the model, the request and the session", () => {
    const line = fastLineage({
      modelName: "Seedream 5.5", endpoint: "bytedance/seedream/v5.5/edit", instruction: "Make it night", requestId: "req-1",
      mjJobId: JOB, mjIndex: 2, mjPrompt: "a viaduct at dusk --v 8.2",
    });
    expect(line).toContain(`Midjourney job ${JOB} image 3`);
    expect(line).toContain("request req-1");
    expect(line).toContain("Midjourney prompt: a viaduct at dusk --v 8.2");
    expect(line).toContain("Session mj-fast-helper.");
  });
});

describe("route payloads", () => {
  test("start: a frame by R2 key with its job, refs default to none", () => {
    const parsed = fastPostSchema.parse({
      action: "start", model: "seedream-5.5", instruction: "Night", count: 2,
      source: { r2Key: "uploads/abc", mjJobId: JOB, mjIndex: 1, width: 1456, height: 816 },
    });
    expect(parsed).toMatchObject({ action: "start", count: 2, refs: [], source: { r2Key: "uploads/abc", mjIndex: 1 } });
  });

  test("start refuses a frame with neither key nor address, and five takes", () => {
    expect(fastPostSchema.safeParse({ action: "start", model: "krea-3", instruction: "x", source: { mjJobId: JOB } }).success).toBe(false);
    expect(fastPostSchema.safeParse({ action: "start", model: "krea-3", instruction: "x", count: 5, source: { r2Key: "k" } }).success).toBe(false);
  });

  test("save defaults to a scene; review only drops or restores", () => {
    expect(fastPostSchema.parse({ action: "save", runId: "r1", index: 0 })).toMatchObject({ section: "scene" });
    expect(fastPostSchema.safeParse({ action: "review", runId: "r1", index: 0, review: "kept" }).success).toBe(false);
    expect(fastPostSchema.parse({ action: "fantasy", runId: "r1", index: 1, draftId: "d1", project: "Film" })).toMatchObject({ draftId: "d1" });
  });
});

describe("the card's helpers", () => {
  test("puts a take at the head of the bar as an image prompt, once", () => {
    const url = "https://r2.example/take.png";
    expect(page().barWithImage("", url)).toBe(`${url} `);
    expect(page().barWithImage("a viaduct --ar 16:9", url)).toBe(`${url} a viaduct --ar 16:9`);
    expect(page().barWithImage(`${url} a viaduct`, url)).toBe(`${url} a viaduct`);
  });

  test("reads a tile from the PNG original first", () => {
    expect(page().frameUrls({ jobId: JOB, index: 3 }, `https://cdn.midjourney.com/${JOB}/0_3_640_N.webp`)).toEqual([
      `https://cdn.midjourney.com/${JOB}/0_3.png`, `https://cdn.midjourney.com/${JOB}/0_3.webp`, `https://cdn.midjourney.com/${JOB}/0_3_640_N.webp`,
    ]);
    expect(page().frameUrls(null, "data:image/png;base64,xx")).toEqual([]);
  });

  test("takes a dropped Midjourney frame, nothing else", () => {
    const url = `https://cdn.midjourney.com/${JOB}/0_0.webp`;
    expect(page().urlFromDrop({ uri: `# comment\n${url}` })).toBe(url);
    expect(page().urlFromDrop({ html: `<img class="x" src="${url}">` })).toBe(url);
    expect(page().urlFromDrop({ text: "https://example.com/a.png" })).toBe("");
  });

  test("takes on screen, selection and labels", () => {
    const runs: Run[] = [
      { _id: "b", count: 2, modelName: "Krea 3", instruction: "x", status: "running", takes: [{ index: 0, status: "done" }, { index: 1, status: "running" }] },
      { _id: "a", count: 1, modelName: "Seedream 5.5", instruction: "y", status: "done", takes: [{ index: 0, status: "done" }] },
    ];
    expect(page().flattenTakes(runs).map((entry) => entry.key)).toEqual(["b:0", "b:1", "a:0"]);
    expect(page().anyInFlight(runs)).toBe(true);
    expect(page().anyInFlight([runs[1]!])).toBe(false);
    expect(page().stepSelection(3, -1, 1)).toBe(0);
    expect(page().stepSelection(3, 2, 1)).toBe(2);
    expect(page().stepSelection(0, 0, 1)).toBe(-1);
    expect(page().takeLabel(runs[0]!, runs[0]!.takes[1]!)).toBe("Take 2/2 · Krea 3");
    expect(page().takeLabel(runs[1]!, runs[1]!.takes[0]!)).toBe("Take · Seedream 5.5");
  });

  test("the Fantasy note and the price on the Run button", () => {
    expect(page().fantasyNote({ modelName: "Seedream 5.5", instruction: "Make it night" })).toBe("From Midjourney · Seedream 5.5: Make it night");
    expect(page().priceText(0.03, 1)).toBe("≈ $0.030");
    expect(page().priceText(0.03, 4)).toBe("≈ $0.12");
    expect(page().priceText(0, 2)).toBe("");
  });

  test("the card sits beside the frame", () => {
    expect(page().placeBeside({ left: 100, right: 500, top: 80, bottom: 400 }, { width: 1400, height: 900 }, { width: 432, height: 600 }))
      .toEqual({ x: 512, y: 80 });
  });
});
