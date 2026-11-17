import { describe, expect, test } from "bun:test";
import { DESCRIBE_FIELDS, aspectOf, buildDescribeMessages, describeParams, parseDescribeAnswer, wordsOnly } from "../lib/mj-describe";

describe("mj-describe", () => {
  test("aspect from Midjourney's pair, a ratio string or pixel sizes", () => {
    expect(aspectOf([16, 9])).toBe("16:9");
    expect(aspectOf("4:6")).toBe("2:3");
    expect(aspectOf(undefined, 1920, 1080)).toBe("16:9");
    expect(aspectOf(undefined, 1000, 1000)).toBe("1:1");
    expect(aspectOf(null)).toBeUndefined();
    expect(describeParams("16:9")).toBe("--ar 16:9");
    expect(describeParams(undefined)).toBe("");
  });

  test("the answer parses into labelled lines and a prompt, flags cut", () => {
    const parsed = parseDescribeAnswer([
      "TITLE: The tram at dusk.",
      "SUBJECT: A woman in a dark wool coat waits at a tram stop.",
      "**SHOT:** A full shot from eye level.",
      "LENS: 35mm, deep focus.",
      "COMPOSITION: She stands left of centre; the street runs away to the right.",
      "LIGHT: Low blue dusk from behind the houses, one warm window on her face.",
      "PALETTE: Slate blue, wet black, one amber.",
      "MATERIALS: Wet cobbles, wool, soot-dark sandstone.",
      "SETTING: A narrow late Gothic street, steep slate roofs, drizzle.",
      "MOOD: Quiet, patient.",
      "MEDIUM: 35mm colour negative film, fine grain.",
      "PROMPT: A full shot of a woman in a dark wool coat waiting at a tram stop on a narrow late Gothic street. --ar 16:9",
    ].join("\n"));
    expect(parsed.title).toBe("The tram at dusk");
    expect(parsed.fields.map((field) => field.key)).toEqual(DESCRIBE_FIELDS.map((field) => field.key));
    expect(parsed.fields.find((field) => field.key === "shot")?.text).toBe("A full shot from eye level.");
    expect(parsed.fields.find((field) => field.key === "light")?.label).toBe("Light");
    expect(parsed.prompt).toBe("A full shot of a woman in a dark wool coat waiting at a tram stop on a narrow late Gothic street.");
    expect(wordsOnly("\"A fox in snow --v 8\"")).toBe("A fox in snow");
    expect(parseDescribeAnswer("nothing useful").fields).toEqual([]);
  });

  test("messages carry the picture, Midjourney's reading and ask for every line", () => {
    const [system, user] = buildDescribeMessages({
      image: "data:image/jpeg;base64,AAAA", descriptions: ["a tram, cinematic"], system: "Never a real city.", note: "make it night",
    });
    expect(system!.content).toContain("cinematographer");
    expect(system!.content).toContain("CINEMATIC RULES");
    expect(system!.content).toContain("Never a real city.");
    expect(system!.content).toContain("V8.2");
    const parts = user!.content as Array<{ type: string; text?: string }>;
    expect(parts[0]!.type).toBe("image_url");
    expect(parts[1]!.text).toContain("HOW MIDJOURNEY READS THIS IMAGE");
    for (const field of DESCRIBE_FIELDS) expect(parts[1]!.text).toContain(`${field.label.toUpperCase()}:`);
    expect(parts[1]!.text).toContain("PROMPT:");
    expect(parts[1]!.text).toContain("make it night");
  });
});
