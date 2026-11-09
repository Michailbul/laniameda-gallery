import { describe, expect, test } from "bun:test";
import { isModelTag, isTileHiddenTag, withoutModelTags } from "../lib/tag-hygiene";

describe("tag hygiene", () => {
  test("model names are model tags", () => {
    for (const name of [
      "Midjourney", "Midjourney 7", "midjourney-v7", "MJ", "niji 6", "Nano Banana 2", "nano-banana-pro",
      "GPT Image 2.5 Flare", "gpt-image-2", "flux pro", "FLUX 3", "seedream 5 pro", "krea 3", "Kling 2.1",
      "veo 3", "sd 1.5", "sdxl", "gen 4", "gemini 3",
    ]) expect([name, isModelTag(name)]).toEqual([name, true]);
  });

  test("ordinary words and real tags are kept", () => {
    for (const name of [
      "portrait", "cinematic", "midjourney-explore", "mj-profile-test", "da4", "art-deco-1",
      "anim-style-dark-deco-noir", "gemini", "gen", "runway", "firefly", "flux", "luma", "fashion",
      "flux-capacitor", "runway-show", "krea-test", "pinterest",
    ]) expect([name, isModelTag(name)]).toEqual([name, false]);
  });

  test("tiles also leave out pickup sources", () => {
    expect(isTileHiddenTag("midjourney-explore")).toBe(true);
    expect(isTileHiddenTag("Midjourney 7")).toBe(true);
    expect(isTileHiddenTag("pinterest")).toBe(false);
    expect(withoutModelTags([{ name: "Midjourney" }, { name: "night" }])).toEqual([{ name: "night" }]);
  });
});
