import { describe, expect, test } from "bun:test";
import { aspectOf, buildDescribeMessages, describeParams, parseDescribeAnswer, wordsOnly } from "../lib/mj-describe";

describe("mj-describe", () => {
  test("aspect from Midjourney's pair, a ratio string or pixel sizes", () => {
    expect(aspectOf([16, 9])).toBe("16:9");
    expect(aspectOf("4:6")).toBe("2:3");
    expect(aspectOf(undefined, 1920, 1080)).toBe("16:9");
    expect(aspectOf(undefined, 1000, 1000)).toBe("1:1");
    expect(aspectOf(null)).toBeUndefined();
  });

  test("answers parse into title, keep and ours, flags cut", () => {
    const parsed = parseDescribeAnswer("TITLE: The tram at dusk.\nKEEP: Grainy 35mm film still. A tram crosses. --ar 16:9\nOURS: DEAR ANNETE, Film look. A cable tram crosses between spires.");
    expect(parsed.title).toBe("The tram at dusk");
    expect(parsed.keep).toBe("Grainy 35mm film still. A tram crosses.");
    expect(parsed.ours).toBe("DEAR ANNETE, Film look. A cable tram crosses between spires.");
    expect(wordsOnly("\"A fox in snow --v 8\"")).toBe("A fox in snow");
  });

  test("our style takes the recipe's codes; keep only the aspect", () => {
    const style = { name: "Film", params: "--chaos 10 --ar 21:9 --sref 123 --profile abc m77 --stylize 250" };
    const ours = describeParams("ours", "16:9", style);
    expect(ours.params).toBe("--ar 16:9 --chaos 10 --stylize 250 --sref 123 --profile abc m77");
    expect(ours.rest).toBe("--ar 16:9 --chaos 10 --stylize 250");
    expect(ours.profiles).toEqual(["abc", "m77"]);
    expect(ours.srefs).toEqual(["123"]);
    expect(describeParams("keep", "2:3", style).params).toBe("--ar 2:3");
  });

  test("messages carry the picture, Midjourney's reading and the style lock", () => {
    const [system, user] = buildDescribeMessages({
      image: "data:image/jpeg;base64,AAAA", descriptions: ["a tram, cinematic"], mode: "both",
      style: { name: "Film", lock: "DEAR ANNETE, Film look.", raises: ["grain"] }, system: "Never a real city.",
    });
    expect(system.content).toContain("OURS:");
    expect(system.content).toContain("Never a real city.");
    const parts = user.content as Array<{ type: string; text?: string }>;
    expect(parts[0]!.type).toBe("image_url");
    expect(parts[1]!.text).toContain("HOW MIDJOURNEY READS THIS IMAGE");
    expect(parts[1]!.text).toContain("STYLE LOCK:\nDEAR ANNETE, Film look.");
    expect(parts[1]!.text).toContain("KEEP:");
  });

  test("keep mode without a style asks only for KEEP", () => {
    const [system, user] = buildDescribeMessages({ image: "https://x/y.png", mode: "keep" });
    expect(system.content).not.toContain("OURS:");
    expect((user.content as Array<{ text?: string }>)[1]!.text).not.toContain("OURS:");
  });
});
