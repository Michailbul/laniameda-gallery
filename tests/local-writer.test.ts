import { beforeAll, describe, expect, test } from "bun:test";
import { LOCAL_WRITER_LIMITS, localAnswer, localModelLabel } from "../lib/local-writer";

type Status = { mode?: string; model?: string; up?: boolean };
type WriterApi = {
  writerView: (status: Status) => { label: string; local: boolean; title: string };
  nextWriter: (status: Status) => { mode?: string; model?: string };
};
const page = () => (globalThis as typeof globalThis & { SaveToGalleryExpand: WriterApi }).SaveToGalleryExpand;

beforeAll(async () => {
  await import("../extension/mj-expand.js");
});

describe("local writer: the answer a run on the Mac hands back", () => {
  test("labels the model and marks the provider as local", () => {
    expect(localAnswer({ raw: "TITLE: a\nPROMPT: b", model: "haiku", ms: 2710.4 })).toEqual({
      raw: "TITLE: a\nPROMPT: b", model: "Haiku 5.5 · local", provider: "local", ms: 2710, notes: [],
    });
    expect(localModelLabel("sonnet")).toBe("Sonnet 5.5 · local");
    expect(localModelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5 · local");
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

describe("local writer: the switch on the Grow card", () => {
  test("shows where the writer runs", () => {
    expect(page().writerView({ mode: "auto", model: "haiku", up: true })).toMatchObject({ label: "Haiku · Mac", local: true });
    expect(page().writerView({ mode: "local", model: "sonnet", up: true })).toMatchObject({ label: "Sonnet · Mac", local: true });
    expect(page().writerView({ mode: "cloud", model: "haiku", up: true })).toMatchObject({ label: "Cloud", local: false });
    expect(page().writerView({ mode: "auto", model: "haiku", up: false })).toMatchObject({ label: "Cloud", local: false });
    expect(page().writerView({ mode: "local", model: "haiku", up: false }).title).toContain("nothing can be written");
  });

  test("one click goes Haiku, Sonnet, cloud and back", () => {
    let status: Status = { mode: "auto", model: "haiku", up: true };
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      status = { ...status, ...page().nextWriter(status) };
      seen.push(page().writerView(status).label);
    }
    expect(seen).toEqual(["Sonnet · Mac", "Cloud", "Haiku · Mac", "Sonnet · Mac"]);
  });

  test("without the bridge a click only asks again", () => {
    expect(page().nextWriter({ mode: "auto", model: "sonnet", up: false })).toEqual({ mode: "auto" });
  });
});
