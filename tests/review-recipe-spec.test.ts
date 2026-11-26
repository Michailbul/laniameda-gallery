import { describe, expect, test } from "bun:test";
import { recipeSettings } from "../components/review/Recipe";

describe("recipeSettings (style heading chips)", () => {
  test("Niji 8 recipe: model first, codes and --ar left out", () => {
    expect(recipeSettings("--chaos 50 --ar 16:9 --profile e6pj8eo --stylize 250 --hd --niji 8"))
      .toEqual({ model: "Niji 8", settings: ["chaos 50", "stylize 250", "hd"] });
  });
  test("V8.2 recipe with raw and a profile stack; no version means V8.2", () => {
    expect(recipeSettings("--profile xeyqml8 2k7kjkp --raw --stylize 900 --chaos 5 --hd"))
      .toEqual({ model: "V8.2", settings: ["raw", "stylize 900", "chaos 5", "hd"] });
    expect(recipeSettings("--sref 1310938064 --profile 37vd7r6 --s 450 --v 8.2").model).toBe("V8.2");
    expect(recipeSettings("--sref 1310938064 --s 450 --weird 150").settings).toEqual(["stylize 450", "weird 150"]);
  });
});
