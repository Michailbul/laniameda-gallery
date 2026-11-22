import { describe, expect, test } from "bun:test";
import { WRITER_MODELS, WRITER_MODEL_KEYS, cloudModelLabel, pickWriterModel, writerModelList, writerRoutes } from "../lib/writer-models";
import { QUICK_EDIT_ROUTES, QUICK_EDIT_SYSTEM_DEFAULT, buildQuickEditMessages } from "../lib/mj-quick-edit";
import { EXPAND_SYSTEM_DEFAULT, buildExpandMessages } from "../lib/mj-expand";
import { DESCRIBE_BASE_RULES, buildDescribeMessages } from "../lib/mj-describe";

const systemOf = (messages: Array<{ role: string; content: unknown }>) => String(messages.find((m) => m.role === "system")?.content ?? "");
const IMAGE = "https://example.com/frame.jpg";

describe("writer models: one default for every tool", () => {
  test("every model has a cloud route, and the Claude ones a local id", () => {
    for (const key of WRITER_MODEL_KEYS) {
      expect(WRITER_MODELS[key].routes.length).toBeGreaterThan(0);
      expect(WRITER_MODELS[key].routes[0]!.provider).toBe("fal");
      expect(QUICK_EDIT_ROUTES[key]).toBe(WRITER_MODELS[key].routes);
    }
    expect(WRITER_MODELS.opus.local).toBe("claude-opus-5-5");
    expect(WRITER_MODELS.fable.local).toBe("claude-fable-5-2");
    expect(WRITER_MODELS.deepseek.local).toBeUndefined();
    expect(writerModelList().map((m) => m.key)).toEqual([...WRITER_MODEL_KEYS]);
  });

  test("a chosen provider keeps to its own routes; none chosen tries fal then Pika", () => {
    for (const key of WRITER_MODEL_KEYS) {
      expect(writerRoutes(key, "fal").every((route) => route.provider === "fal")).toBe(true);
      expect(writerRoutes(key, "pika").every((route) => route.provider === "pika")).toBe(true);
      expect(writerRoutes(key, "fal").length).toBeGreaterThan(0);
      expect(writerRoutes(key, "pika").length).toBeGreaterThan(0);
      expect(writerRoutes(key)).toBe(WRITER_MODELS[key].routes);
    }
    expect(cloudModelLabel("haiku", "pika")).toBe("Haiku 4.5");
    expect(cloudModelLabel("haiku", "fal")).toBe("Haiku 5.5");
    expect(writerModelList()[0]!.cloud).toEqual({ fal: "Haiku 5.5", pika: "Haiku 4.5" });
  });

  test("unknown or missing picks Haiku; a picture never goes to a text-only model", () => {
    expect(pickWriterModel(undefined, false)).toEqual({ model: "haiku" });
    expect(pickWriterModel("gpt", true)).toEqual({ model: "haiku" });
    expect(pickWriterModel("opus", true)).toEqual({ model: "opus" });
    expect(pickWriterModel("deepseek", false)).toEqual({ model: "deepseek" });
    const swapped = pickWriterModel("deepseek", true);
    expect(swapped.model).toBe("haiku");
    expect(swapped.note).toContain("cannot see pictures");
  });
});

describe("writer system prompts: the default, or the art director's own", () => {
  test("quick edit", () => {
    const base = buildQuickEditMessages({ prompt: "a street", instruction: "make it night", system: "WORLD NOTE" });
    expect(systemOf(base.messages).startsWith(QUICK_EDIT_SYSTEM_DEFAULT)).toBe(true);
    const own = buildQuickEditMessages({ prompt: "a street", instruction: "make it night", system: "WORLD NOTE", rules: "MY RULES" });
    expect(systemOf(own.messages).startsWith("MY RULES")).toBe(true);
    expect(systemOf(own.messages)).not.toContain(QUICK_EDIT_SYSTEM_DEFAULT);
    expect(systemOf(own.messages)).toContain("WORLD NOTE");
  });

  test("grow", () => {
    expect(systemOf(buildExpandMessages({ image: IMAGE, count: 2, idea: "x" })).startsWith(EXPAND_SYSTEM_DEFAULT)).toBe(true);
    const own = systemOf(buildExpandMessages({ image: IMAGE, count: 2, idea: "x", rules: "MY GROW", system: "NOTES", worldBrief: "BRIEF" }));
    expect(own.startsWith("MY GROW")).toBe(true);
    expect(own).toContain("BRIEF");
    expect(own).toContain("NOTES");
    expect(systemOf(buildExpandMessages({ image: IMAGE, count: 2, idea: "x", rules: "   " })).startsWith(EXPAND_SYSTEM_DEFAULT)).toBe(true);
  });

  test("describe", () => {
    expect(systemOf(buildDescribeMessages({ image: IMAGE })).startsWith(DESCRIBE_BASE_RULES)).toBe(true);
    expect(systemOf(buildDescribeMessages({ image: IMAGE, rules: "MY DESCRIBE" }))).toBe("MY DESCRIBE");
  });
});

describe("writer call: an older backend without model and rules", () => {
  test("retries without the new fields only on that refusal", async () => {
    const { withWriterFallback } = await import("../lib/server/writer-call");
    const seen: Array<Record<string, unknown>> = [];
    const result = await withWriterFallback({ image: "x", model: "opus", rules: "R" }, async (args) => {
      seen.push(args);
      if ("rules" in args) throw new Error("ArgumentValidationError: Object contains extra field `rules` that is not in the validator.");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen[1]).toEqual({ image: "x" });
    await expect(withWriterFallback({ model: "opus" }, async () => { throw new Error("fal needs a top-up"); })).rejects.toThrow("top-up");
  });
});
