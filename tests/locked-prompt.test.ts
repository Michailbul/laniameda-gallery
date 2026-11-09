import { describe, expect, test } from "bun:test";
import { applyStyleTemplate, midjourneyJobOf, restyle, seedFor } from "../lib/locked-prompt";

const city = {
  name: "CAS SUNLIT CITY",
  parameters: "--chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd",
  template: "[subject] in Mexico City, feature animation film, wide shot, hand-drawn 2.5D animation with elements of 3D --chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd",
  moodboardCodes: [], profileCodes: [], unknownCodes: ["--sref 7613287694"],
};
const storybook = { name: "CAS STORYBOOK", parameters: "--raw --stylize 600 --chaos 5 --v 8.2", template: "Painted storybook animation frame. [subject]", moodboardCodes: ["dfvmdw1"], profileCodes: [], unknownCodes: [] };
const locked = {
  text: "A public primary school in Mexico City, wide shot, the patio with a big tree",
  aspect: "16:9", seed: 1234,
  imagePrompts: [{ url: "https://r2.example/brief.jpg", weight: 0.75 }],
};

describe("applyStyleTemplate", () => {
  test("adds the template's medium words once, never its place words", () => {
    expect(applyStyleTemplate(locked.text, city.template)).toBe(
      "A public primary school in Mexico City, wide shot, the patio with a big tree, feature animation film, hand-drawn 2.5D animation with elements of 3D",
    );
    expect(applyStyleTemplate("A beach-town street", city.template)).toBe("A beach-town street, feature animation film, wide shot, hand-drawn 2.5D animation with elements of 3D");
  });
  test("a lead sentence goes first; no template keeps the words", () => {
    expect(applyStyleTemplate("A patio.", storybook.template)).toBe("Painted storybook animation frame. A patio");
    expect(applyStyleTemplate("A patio", undefined)).toBe("A patio");
  });
});

describe("restyle", () => {
  test("same prompt and seed carries the style's recipe, the locked aspect and seed", () => {
    const item = restyle({ ...locked, aspect: "21:9" }, city, "seed");
    expect(item.styleRefs).toEqual([{ code: "7613287694", label: "CAS SUNLIT CITY sref" }]);
    expect(item.params).toBe("--chaos 30 --raw --stylize 300 --v 8.2 --hd --ar 21:9 --seed 1234");
    expect(item.imagePrompts).toHaveLength(1);
    expect(item.editRefs).toEqual([]);
  });
  test("frame mode attaches the locked frame and drops image prompts", () => {
    const item = restyle(locked, storybook, "frame", { url: "https://cdn.midjourney.com/x/0_1.png" });
    expect(item.editRefs).toEqual([{ url: "https://cdn.midjourney.com/x/0_1.png", assetId: undefined, label: "Locked frame" }]);
    expect(item.imagePrompts).toEqual([]);
    expect(item.profileCodes).toEqual(["dfvmdw1"]);
    expect(item.params).toBe("--raw --stylize 600 --chaos 5 --v 8.2 --ar 16:9 --seed 1234");
  });
  test("frame mode without a frame falls back with a warning", () => {
    const item = restyle(locked, storybook, "frame");
    expect(item.editRefs).toEqual([]);
    expect(item.warnings[0]).toContain("No locked frame");
  });
});

test("seeds and job ids", () => {
  expect(seedFor("cas-school-v1-A1")).toBe(seedFor("cas-school-v1-A1"));
  expect(seedFor("a")).toBeLessThanOrEqual(4294967295);
  expect(midjourneyJobOf("https://www.midjourney.com/jobs/1c8e8ead-03c5-47ec-9ac0-5e9472ee466a?index=2")).toEqual({ jobId: "1c8e8ead-03c5-47ec-9ac0-5e9472ee466a", index: 2 });
  expect(midjourneyJobOf(undefined, "mj-1c8e8ead-03c5-47ec-9ac0-5e9472ee466a-3.png")).toEqual({ jobId: "1c8e8ead-03c5-47ec-9ac0-5e9472ee466a", index: 3 });
});
