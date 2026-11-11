import { describe, expect, test } from "bun:test";
import { SHOT_SCALE_RULES } from "../lib/writer-scale";
import { buildQuickEditMessages } from "../lib/mj-quick-edit";
import { buildDescribeMessages } from "../lib/mj-describe";
import { buildExpandMessages } from "../lib/mj-expand";
import { composeBrief } from "../lib/writer-brief";

const systemOf = (messages: Array<{ role: string; content: unknown }>) => String(messages.find((m) => m.role === "system")?.content ?? "");

describe("detail at the scale of the shot", () => {
  test("the rule names the three distances and keeps lamps off a far city", () => {
    expect(SHOT_SCALE_RULES).toContain("FAR");
    expect(SHOT_SCALE_RULES).toContain("MIDDLE");
    expect(SHOT_SCALE_RULES).toContain("NEAR");
    expect(SHOT_SCALE_RULES).toMatch(/no lamps, windows, signs/);
    expect(SHOT_SCALE_RULES).toMatch(/airship is moored/);
  });

  test("every writer mode carries it, with or without a world", () => {
    const image = "data:image/jpeg;base64,AAAA";
    expect(systemOf(buildQuickEditMessages({ prompt: "a city at dusk", instruction: "make it ours" }).messages)).toContain(SHOT_SCALE_RULES);
    expect(systemOf(buildDescribeMessages({ image, mode: "ours", style: { name: "Film" } }))).toContain(SHOT_SCALE_RULES);
    expect(systemOf(buildDescribeMessages({ image, mode: "keep" }))).toContain(SHOT_SCALE_RULES);
    expect(systemOf(buildExpandMessages({ image, count: 3 }))).toContain(SHOT_SCALE_RULES);
  });

  test("Make it ours keeps the picture's camera distance", () => {
    const system = systemOf(buildDescribeMessages({ image: "data:image/jpeg;base64,AAAA", mode: "ours", style: { name: "Film" } }));
    expect(system).toContain("same subject, framing, camera distance and light");
  });

  test("a world's brief tells the writer to size its markers and keep cities apart", () => {
    const brief = composeBrief("DEAR ANNETE", [{ key: "rules", label: "rules", title: "WORLD.md", text: "Gothic city." }]);
    expect(brief.text).toMatch(/at a size this shot can show/);
    expect(brief.text).toMatch(/more than one city or country, a frame is in one of them/);
  });
});
