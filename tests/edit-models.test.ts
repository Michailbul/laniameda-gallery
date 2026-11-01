import { describe, expect, test } from "bun:test";

import {
  EDIT_MODELS, MAX_SEND_USD, aspectOf, buildEditInput, classifyProviderRefusal, editIdempotencyKey,
  editModelById, editSize, estimateEditUsd, liveRoute, planEditSend, readFalResult, readFalStatus, readPikaJob,
} from "../lib/edit-models";

// Expected values are the reviewer kit's (reviewer-kit/server.py) for the same inputs.

describe("routing", () => {
  test("follows the routing table: Krea on fal, Seedream on Pika first, GPT on fal first", () => {
    expect(editModelById("krea-3")!.routes.map((r) => r.provider)).toEqual(["fal"]);
    expect(editModelById("seedream-5")!.routes.map((r) => r.provider)).toEqual(["pika", "fal"]);
    expect(editModelById("gpt-flare")!.routes.map((r) => r.provider)).toEqual(["fal", "pika"]);
    expect(editModelById("gpt-sunburst")!.routes.map((r) => r.provider)).toEqual(["fal", "pika"]);
    expect(editModelById("nano-21")!.routes.map((r) => r.provider)).toEqual(["pika"]);
    expect(EDIT_MODELS.filter((m) => m.default).map((m) => m.id)).toEqual(["krea-3"]);
  });

  test("the live route skips a blocked or keyless provider", () => {
    const gpt = editModelById("gpt-flare")!;
    expect(liveRoute(gpt, { fal: { key: true, blocked: "fal: out of credits (403)" }, pika: { key: true } }))
      .toEqual({ route: gpt.routes[1]!, blocked: false });
    expect(liveRoute(gpt, { fal: { key: false }, pika: { key: true } }).route.provider).toBe("pika");
    const krea = editModelById("krea-3")!;
    expect(liveRoute(krea, { fal: { key: true, blocked: "out" }, pika: { key: true } }))
      .toEqual({ route: krea.routes[0]!, blocked: true });
    expect(liveRoute(krea).blocked).toBe(false);
  });
});

describe("estimates", () => {
  test("Krea 3 prices output and inputs per megapixel, inputs capped at the output size", () => {
    // 1456×816 stays under 2 MP: output 1456×816 → 1.188 MP; 0.025 × (1.188 + 1.188)
    expect(estimateEditUsd("krea/v3/edit", 1456, 816)).toBe(0.0594);
    // a 4K source is scaled to ~2 MP; each reference adds the capped size
    expect(estimateEditUsd("krea/v3/edit", 3840, 2160, 2)).toBe(0.1977);
  });

  test("Seedream adds a fee per extra image, flat endpoints are flat", () => {
    expect(estimateEditUsd("bytedance/seedream-5.0-pro/image-to-image", 1000, 1000, 2)).toBe(0.0434);
    expect(estimateEditUsd("bytedance/seedream/v5/pro/edit", 1000, 1000, 1)).toBe(0.072);
    expect(estimateEditUsd("openai/gpt-image-2.5/flare/edit")).toBe(0.055);
    expect(estimateEditUsd("openai/gpt-image-2.5-flare/image-to-image")).toBe(0.049);
    expect(estimateEditUsd("fal-ai/flux-pro/kontext/max")).toBe(0.08);
    expect(estimateEditUsd("unknown/endpoint")).toBe(0.1);
  });

  test("edit size caps at 2 MP in multiples of 16", () => {
    expect(editSize(3840, 2160)).toEqual({ width: 1872, height: 1056 });
    expect(editSize(800, 600)).toEqual({ width: 800, height: 592 });
    expect(editSize(undefined, undefined)).toEqual({ width: 1456, height: 816 });
  });

  test("aspect picks the nearest supported ratio", () => {
    expect(aspectOf(1920, 1080)).toBe("16:9");
    expect(aspectOf(1080, 1920)).toBe("9:16");
    expect(aspectOf(2560, 1080)).toBe("21:9");
    expect(aspectOf(1000, 1000)).toBe("1:1");
    expect(aspectOf(1200, 1000)).toBe("4:3");
  });
});

describe("input building", () => {
  const urls = ["https://cdn/frame.png", "https://cdn/sheet.png"];
  test("Krea sends every image with a capped size", () => {
    expect(buildEditInput("krea/v3/edit", "p", urls, 3840, 2160)).toEqual({
      prompt: "p", image_urls: urls, image_size: { width: 1872, height: 1056 }, reasoning_level: "medium", output_format: "png",
    });
  });
  test("Seedream on fal caps at 1536², on Pika sends 1.5K and an aspect", () => {
    expect(buildEditInput("bytedance/seedream/v5/pro/edit", "p", urls, 3840, 2160).image_size).toEqual({ width: 2048, height: 1152 });
    expect(buildEditInput("bytedance/seedream-5.0-pro/image-to-image", "p", urls, 1080, 1920))
      .toEqual({ prompt: "p", image_urls: urls, size: "1.5K", aspect_ratio: "9:16" });
  });
  test("GPT on fal asks for high quality, on Pika for 1K at the source aspect", () => {
    expect(buildEditInput("openai/gpt-image-2.5/flare/edit", "p", urls)).toEqual({ prompt: "p", image_urls: urls, quality: "high" });
    expect(buildEditInput("openai/gpt-image-2.5-sunburst/image-to-image", "p", urls, 1920, 1080))
      .toEqual({ prompt: "p", image_urls: urls, aspect_ratio: "16:9", resolution: "1K" });
  });
  test("Kontext takes the frame only", () => {
    expect(buildEditInput("fal-ai/flux-pro/kontext/max", "p", urls, 1000, 1000)).toEqual({ prompt: "p", image_url: urls[0], aspect_ratio: "1:1" });
  });
});

describe("idempotency", () => {
  test("a retry and a route fall-through are new keys; the same attempt repeats its key", () => {
    const first = editIdempotencyKey("job1", 0, 0);
    expect(editIdempotencyKey("job1", 0, 0)).toBe(first);
    expect(editIdempotencyKey("job1", 1, 0)).not.toBe(first);
    expect(editIdempotencyKey("job1", 0, 1)).not.toBe(first);
    expect(editIdempotencyKey("job2", 0, 0)).not.toBe(first);
  });
});

describe("out-of-credit parsing", () => {
  test("fal's locked balance is an out-of-credit block", () => {
    const fal = classifyProviderRefusal("fal", 403, "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.");
    expect(fal).toEqual({ blocked: true, outOfCredit: true, message: "fal: out of credits (403)" });
  });
  test("Pika's insufficient credit is a block on any 4xx", () => {
    const pika = classifyProviderRefusal("pika", 400, { code: "insufficient_credits", message: "Insufficient credits" });
    expect(pika.blocked).toBe(true);
    expect(pika.outOfCredit).toBe(true);
    expect(classifyProviderRefusal("pika", 402, { message: "Payment required" }).blocked).toBe(true);
  });
  test("a bad key blocks without claiming credit; a 422 is a plain error", () => {
    expect(classifyProviderRefusal("fal", 401, "Invalid key")).toMatchObject({ blocked: true, outOfCredit: false });
    expect(classifyProviderRefusal("fal", 422, { detail: [{ msg: "field required" }] })).toMatchObject({ blocked: false, outOfCredit: false });
  });
});

describe("provider replies", () => {
  test("fal queue states", () => {
    expect(readFalStatus(200, { status: "IN_QUEUE" })).toBe("running");
    expect(readFalStatus(200, { status: "IN_PROGRESS" })).toBe("running");
    expect(readFalStatus(200, { status: "COMPLETED" })).toBe("completed");
    expect(readFalStatus(502, null)).toBe("running");
    expect(readFalStatus(404, { detail: "gone" })).toEqual({ error: expect.stringContaining("fal status 404") });
    expect(readFalResult(200, { images: [{ url: "https://fal.media/x.png" }] })).toEqual({ state: "done", url: "https://fal.media/x.png" });
    expect(readFalResult(200, { images: [] })).toEqual({ state: "error", error: "fal returned no image (safety filter?)" });
  });
  test("Pika jobs carry the exact charge once settled", () => {
    expect(readPikaJob(200, { status: "running" })).toEqual({ state: "running" });
    expect(readPikaJob(503, null)).toEqual({ state: "running" });
    expect(readPikaJob(200, { status: "failed", error: { message: "nsfw" } })).toEqual({ state: "error", error: "pika: nsfw" });
    expect(readPikaJob(200, {
      status: "completed", output: { images: [{ url: "https://pika/x.png" }] }, billing: { state: "settled", charge_micro_usd: 49000 },
    })).toEqual({ state: "done", url: "https://pika/x.png", usd: 0.049, pendingBill: false });
    expect(readPikaJob(200, {
      status: "completed", output: { images: [{ url: "https://pika/x.png" }] }, billing: { state: "pending" },
    })).toEqual({ state: "done", url: "https://pika/x.png", usd: undefined, pendingBill: true });
  });
});

describe("planning a send", () => {
  test("one job per model per take, priced on the first route, references capped per model", () => {
    const plan = planEditSend({ prompt: "make it night", modelIds: ["krea-3", "kontext-max"], takes: 2, refs: 2, width: 1456, height: 816 });
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.takes.map((t) => `${t.model.id}:${t.take}/${t.of}:${t.refs}`)).toEqual([
      "krea-3:1/2:2", "krea-3:2/2:2", "kontext-max:1/2:0", "kontext-max:2/2:0",
    ]);
    expect(plan.takes[2]!.refsDropped).toBe(2);
    expect(plan.totalUsd).toBeCloseTo(2 * estimateEditUsd("krea/v3/edit", 1456, 816, 2) + 2 * 0.08, 4);
  });
  test("refuses what the gallery must not send", () => {
    expect(planEditSend({ prompt: " ", modelIds: ["krea-3"], takes: 1, refs: 0 })).toMatchObject({ ok: false });
    expect(planEditSend({ prompt: "x", modelIds: [], takes: 1, refs: 0 })).toEqual({ ok: false, error: "Pick a model." });
    expect(planEditSend({ prompt: "x", modelIds: ["nope"], takes: 1, refs: 0 })).toMatchObject({ ok: false });
    expect(planEditSend({ prompt: "x", modelIds: ["krea-3"], takes: 9, refs: 0 })).toMatchObject({ ok: false });
    expect(planEditSend({ prompt: "x", modelIds: EDIT_MODELS.map((m) => m.id), takes: 8, refs: 0 })).toMatchObject({ ok: false });
  });
  test("refuses a send at or over the $30 line", () => {
    // At today's prices 24 takes stay far under $30 (Krea caps its output), so
    // the refusal is checked against a moved line; the default is MAX_SEND_USD.
    const most = planEditSend({ prompt: "x", modelIds: ["krea-3", "gpt-flare", "seedream-5"], takes: 8, refs: 7, width: 1e5, height: 1e5 });
    if (!most.ok) throw new Error(most.error);
    expect(most.totalUsd).toBeLessThan(MAX_SEND_USD);
    expect(planEditSend({ prompt: "x", modelIds: ["kontext-max"], takes: 5, refs: 0, limitUsd: 0.4 }))
      .toEqual({ ok: false, error: "≈$0.40 is over the $0.4 ask-first line." });
    expect(planEditSend({ prompt: "x", modelIds: ["kontext-max"], takes: 4, refs: 0, limitUsd: 0.4 }).ok).toBe(true);
  });
});
