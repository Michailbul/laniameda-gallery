import { describe, expect, test } from "bun:test";
import { composeCell, pacingEstimate, planGrid, presetFields, shortVersion, variantsOf, type Variant } from "../lib/prompt-grid";

const storybook = { name: "CAS STORYBOOK", moodboards: [{ code: "dfvmdw1" }], profiles: [], srefs: [], parameters: "--raw --stylize 600 --chaos 5 --v 8.2 --weird 10 --seed 9", sentence: "Painted storybook animation frame." };
const city = { name: "CAS SUNLIT CITY", moodboards: [], profiles: [{ code: "37vd7r6" }], srefs: [{ code: "7613287694", sv: "7" }], parameters: "--chaos 30 --ar 16:9 --raw --stylize 300 --v 8.2 --hd" };

describe("presets", () => {
  test("boards first, --weird dropped on board jobs, seed and ar never from the preset", () => {
    expect(presetFields(storybook)).toEqual({ styleRefs: [], profileCodes: ["dfvmdw1"], params: "--raw --stylize 600 --chaos 5 --v 8.2" });
  });
  test("an sref keeps its --sv", () => {
    expect(presetFields(city).params).toBe("--chaos 30 --raw --stylize 300 --v 8.2 --hd --sv 7");
    expect(presetFields(city).styleRefs[0]!.code).toBe("7613287694");
  });
});

describe("composeCell", () => {
  const prompt = { text: "A school patio, wide shot", aspect: "16:9", seed: 5, imagePrompts: [{ url: "https://r2/x.jpg", weight: 0.75 }] };
  test("opening sentence, locked aspect and the variant's seed; Draft on screening", () => {
    const item = composeCell(prompt, { variant: variantsOf(prompt)[0]!, seed: 1111 }, storybook, { draft: true });
    expect(item.prompt).toBe("Painted storybook animation frame. A school patio, wide shot");
    expect(item.params).toBe("--raw --stylize 600 --chaos 5 --v 8.2 --ar 16:9 --seed 1111 --draft");
    expect(item.imagePrompts).toHaveLength(1);
  });
});

describe("planGrid", () => {
  const v = (key: string, seeds: number[]): Variant => ({ key, label: key, kind: "neutral", text: key, seeds });
  const prompts = [{ id: "a", variants: [v("neutral", [1111, 2222]), v("short", [3333])] }, { id: "b", variants: [v("neutral", [1111])] }];
  test("screen = one cell per prompt per preset", () => {
    const cells = planGrid({ prompts, presets: ["P1", "P2"], stage: "screen" });
    expect(cells.map((c) => `${c.promptId}:${c.preset}:${c.cell.variant.key}:${c.cell.seed}`)).toEqual(["a:P1:neutral:1111", "a:P2:neutral:1111", "b:P1:neutral:1111", "b:P2:neutral:1111"]);
  });
  test("refine puts screening first, then other variants and seeds", () => {
    const cells = planGrid({ prompts, presets: ["P1"], stage: "refine", allSeeds: true });
    expect(cells.map((c) => `${c.promptId}:${c.cell.variant.key}:${c.cell.seed}:${c.screen}`)).toEqual(["a:neutral:1111:true", "b:neutral:1111:true", "a:neutral:2222:false", "a:short:3333:false"]);
  });
});

test("short version and pacing", () => {
  expect(shortVersion("The patio of a school, wide shot, a big tree, swings, benches, cream stucco walls with teal railings around it", 10)).toBe("The patio of a school, wide shot, a big tree");
  expect(pacingEstimate(24).label).toBe("about 50 minutes");
  expect(pacingEstimate(60).hours).toBe(2);
  expect(pacingEstimate(200).days).toBe(2);
});
