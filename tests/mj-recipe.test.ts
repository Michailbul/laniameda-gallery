import { describe, expect, test } from "bun:test";
import { composeRecipe, parseFlags, templateWords } from "../lib/mj-recipe";

describe("composeRecipe", () => {
  test("sref only recipe keeps its line and fills the template", () => {
    const out = composeRecipe({
      parameters: "--chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd",
      template: "[subject] in Mexico City, feature animation film --chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd",
      unknownCodes: ["--sref 7613287694"],
    });
    expect(out.params).toBe("--chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd");
    expect(out.prompt).toBe("[subject] in Mexico City, feature animation film --chaos 30 --ar 16:9 --raw --sref 7613287694 --stylize 300 --v 8.2 --hd");
  });

  test("a --profile kept only in the template reaches the parameter line", () => {
    const out = composeRecipe({
      parameters: "--chaos 30 --ar 16:9 --raw --sref 2116335797 --stylize 300 --v 8.2 --hd",
      template: "[subject] in Mexico City --chaos 30 --ar 16:9 --raw --sref 2116335797 --profile dfvmdw1 2vuz9bf nhwnqau --stylize 300 --v 8.2 --hd",
      moodboardCodes: ["dfvmdw1"],
      unknownCodes: ["--sref 2116335797", "2vuz9bf", "nhwnqau"],
    });
    expect(out.params).toBe("--chaos 30 --ar 16:9 --raw --sref 2116335797 --stylize 300 --v 8.2 --hd --profile dfvmdw1 2vuz9bf nhwnqau");
    expect(out.profiles).toEqual(["dfvmdw1", "2vuz9bf", "nhwnqau"]);
  });

  test("moodboard and profile codes join an existing --profile once each", () => {
    const out = composeRecipe({
      parameters: "--raw --stylize 600 --chaos 5 --v 8.2",
      moodboardCodes: ["dfvmdw1"],
      profileCodes: ["37vd7r6", "dfvmdw1"],
    });
    expect(out.params).toBe("--raw --stylize 600 --chaos 5 --v 8.2 --profile dfvmdw1 37vd7r6");
    expect(out.prompt).toBeUndefined();
  });

  test("--p is read as --profile and the parameters' order wins", () => {
    const out = composeRecipe({ parameters: "--ar 2:1 --p xvkk4gf pkdbjf8 --v 8.1", profileCodes: ["s65c54q"] });
    expect(out.params).toBe("--ar 2:1 --profile xvkk4gf pkdbjf8 s65c54q --v 8.1");
  });

  test("helpers", () => {
    expect(templateWords("A plaza, wide shot --ar 16:9")).toBe("A plaza, wide shot");
    expect(parseFlags("words --hd --ar 3:2")).toEqual([{ name: "hd", values: [] }, { name: "ar", values: ["3:2"] }]);
  });
});
