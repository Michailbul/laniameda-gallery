import { describe, expect, test } from "bun:test";
import { madeWith, madeWithFlags, codeHint } from "@/lib/review-client";

describe("madeWith", () => {
  test("names from metadata, then the style recipe, unknown codes as themselves, srefs from the prompt", () => {
    const chips = madeWith({
      prompt: "a rainy street --ar 16:9 --profile dfvmdw1 2vuz9bf nhwnqau --sref 2116335797 --stylize 250",
      midjourney: {
        personalization: [
          { code: "dfvmdw1", type: "moodboard", name: "Cassandra night" },
          { code: "2vuz9bf", type: "unknown" },
        ],
        otherFlags: [],
      },
      style: { recipes: [{ moodboards: [], profiles: [{ name: "Michael main", code: "2vuz9bf" }] }] },
    });
    expect(chips).toEqual([
      { kind: "moodboard", code: "dfvmdw1", name: "Cassandra night" },
      { kind: "profile", code: "2vuz9bf", name: "Michael main" },
      { kind: "profile", code: "nhwnqau", name: "nhwnqau" },
      { kind: "sref", code: "2116335797", name: "Style ref" },
    ]);
    expect(madeWithFlags(chips)).toBe("--profile dfvmdw1 2vuz9bf nhwnqau --sref 2116335797");
  });

  test("srefs in otherFlags are not doubled", () => {
    const chips = madeWith({ prompt: "x --sref 1 2", midjourney: { personalization: [], otherFlags: ["--sref 1", "--weird 20"] } });
    expect(chips.map((row) => row.code)).toEqual(["1", "2"]);
    expect(madeWithFlags(chips)).toBe("--sref 1 2");
  });

  test("nothing in, nothing out", () => {
    expect(madeWith(null)).toEqual([]);
    expect(madeWithFlags([])).toBe("");
    expect(codeHint("2116335797123")).toBe("2116…7123");
  });
});
