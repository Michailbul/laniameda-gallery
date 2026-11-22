import { beforeAll, describe, expect, test } from "bun:test";
import { LOCAL_WRITER_LIMITS, localAnswer, localModelLabel } from "../lib/local-writer";

type Status = { mode?: string; model?: string; up?: boolean; local?: boolean };
type WriterApi = {
  writerView: (status: Status) => { label: string; local: boolean; title: string };
  nextWriter: (status: Status) => { mode?: string; model?: string };
};
const page = () => (globalThis as typeof globalThis & { SaveToGalleryExpand: WriterApi }).SaveToGalleryExpand;

beforeAll(async () => {
  await import("../extension/writer-choice.js");
  await import("../extension/mj-expand.js");
});

describe("local writer: the answer a run on the Mac hands back", () => {
  test("labels the model and marks the provider as local", () => {
    expect(localAnswer({ raw: "TITLE: a\nPROMPT: b", model: "haiku", ms: 2710.4 })).toEqual({
      raw: "TITLE: a\nPROMPT: b", model: "Haiku 5.5 · local", provider: "local", ms: 2710, notes: [],
    });
    expect(localModelLabel("sonnet")).toBe("Sonnet 5.5 · local");
    expect(localModelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5 · local");
    expect(localModelLabel("opus")).toBe("Opus 5.5 · local");
    expect(localModelLabel("claude-fable-5-2")).toBe("Fable 5.2 · local");
    expect(localModelLabel("something-else")).toBe("Haiku 5.5 · local");
    expect(localModelLabel(undefined)).toBe("Haiku 5.5 · local");
  });

  test("an empty answer is an error, never a result", () => {
    expect(() => localAnswer({ raw: "  \n " })).toThrow("returned nothing");
    expect(() => localAnswer({})).toThrow("returned nothing");
  });

  test("a bad duration becomes 0 and a long answer is cut at the limit", () => {
    expect(localAnswer({ raw: "x", ms: -5 }).ms).toBe(0);
    expect(localAnswer({ raw: "x", ms: Number.NaN }).ms).toBe(0);
    expect(localAnswer({ raw: "y".repeat(LOCAL_WRITER_LIMITS.raw + 50) }).raw.length).toBe(LOCAL_WRITER_LIMITS.raw);
  });
});

describe("writer picker on the Grow card: This Mac, Cloud · fal or Cloud · Pika", () => {
  test("shows the model and where it runs, in plain words", () => {
    expect(page().writerView({ mode: "local", model: "haiku", up: true })).toMatchObject({ label: "Haiku · Mac", local: true });
    expect(page().writerView({ mode: "local", model: "sonnet", up: true })).toMatchObject({ label: "Sonnet · Mac", local: true });
    expect(page().writerView({ mode: "fal", model: "haiku" })).toMatchObject({ label: "Cloud · fal · Haiku 5.5", local: false });
    expect(page().writerView({ mode: "pika", model: "haiku" })).toMatchObject({ label: "Cloud · Pika · Haiku 4.5", local: false });
    expect(page().writerView({ mode: "pika", model: "fable" })).toMatchObject({ label: "Cloud · Pika · Fable 5.1", local: false });
    expect(page().writerView({ mode: "local", model: "haiku", up: false }).title).toContain("nothing can be written");
  });

  test("old stored places still read: auto is the Mac, cloud is fal", () => {
    expect(page().writerView({ mode: "auto", model: "haiku" })).toMatchObject({ label: "Haiku · Mac", local: true });
    expect(page().writerView({ mode: "cloud", model: "opus" })).toMatchObject({ label: "Cloud · fal · Opus 5.5", local: false });
  });

  test("DeepSeek cannot see the picture, so Grow names Haiku", () => {
    expect(page().writerView({ mode: "fal", model: "deepseek" })).toMatchObject({ label: "Cloud · fal · Haiku 5.5" });
  });

  test("the next choice steps through the Mac, then fal, then Pika, and back", () => {
    let status: Status = { mode: "local", model: "haiku" };
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      status = { ...status, ...page().nextWriter(status) };
      seen.push(`${status.mode}:${status.model}`);
    }
    expect(seen).toEqual([
      "local:sonnet", "local:opus", "local:fable",
      "fal:haiku", "fal:sonnet", "fal:opus", "fal:fable",
      "pika:haiku", "pika:sonnet", "pika:opus", "pika:fable",
      "local:haiku",
    ]);
  });
});

type Choice = {
  groups: (opts?: { vision?: boolean }) => Array<{ group: string; where: string; items: Array<{ value: string; label: string; mode: string; model: string }> }>;
  offerFor: (res: { ok: boolean; where?: string; model?: string }) => { mode: string; model: string; label: string } | null;
  parse: (value: string) => { mode: string; model: string };
  runs: (mode: string, model: string) => string;
};
const choice = () => (globalThis as typeof globalThis & { SaveToGalleryWriterChoice: Choice }).SaveToGalleryWriterChoice;

describe("writer choice: one pick for Grow, Describe and the quick edit", () => {
  test("the picker groups This Mac, Cloud · fal and Cloud · Pika", () => {
    const groups = choice().groups();
    expect(groups.map((g) => g.group)).toEqual(["This Mac", "Cloud · fal", "Cloud · Pika"]);
    expect(groups[0]!.items.map((i) => i.label)).toEqual(["Haiku · Mac", "Sonnet · Mac", "Opus · Mac", "Fable · Mac"]);
    expect(groups[1]!.items.map((i) => i.label)).toContain("Cloud · fal · DeepSeek V4.1");
    expect(choice().groups({ vision: true })[1]!.items.map((i) => i.model)).not.toContain("deepseek");
    expect(choice().parse("pika:sonnet")).toEqual({ mode: "pika", model: "sonnet" });
    expect(choice().parse("nonsense")).toEqual({ mode: "local", model: "haiku" });
  });

  test("a failure offers the other place, never switches by itself", () => {
    expect(choice().offerFor({ ok: false, where: "fal", model: "sonnet" })).toEqual({ mode: "pika", model: "sonnet", label: "Try Cloud · Pika · Sonnet 5.5" });
    expect(choice().offerFor({ ok: false, where: "pika", model: "haiku" })).toEqual({ mode: "fal", model: "haiku", label: "Try Cloud · fal · Haiku 5.5" });
    expect(choice().offerFor({ ok: false, where: "local", model: "opus" })).toEqual({ mode: "fal", model: "opus", label: "Try Cloud · fal · Opus 5.5" });
    expect(choice().offerFor({ ok: true, where: "fal" })).toBeNull();
  });

  test("the extension names the same model each provider runs as the gallery", async () => {
    const { WRITER_MODEL_KEYS, cloudModelLabel, WRITER_PROVIDERS } = await import("../lib/writer-models");
    for (const model of WRITER_MODEL_KEYS) {
      for (const provider of WRITER_PROVIDERS) expect(choice().runs(provider, model)).toBe(cloudModelLabel(model, provider));
    }
  });
});
