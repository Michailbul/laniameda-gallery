import { describe, expect, test } from "bun:test";
import { ORDINARY_PROMPT_ASK, buildQuickEditMessages, cleanModelText, protectUrls, restoreUrls } from "../lib/mj-quick-edit";

describe("Midjourney quick edit helpers", () => {
  test("image links survive the model as placeholders", () => {
    const prompt = "https://a.r2.dev/1 A poster of a field --sref https://a.r2.dev/2 --ar 16:9";
    const { masked, urls } = protectUrls(prompt);
    expect(masked).toBe("[[IMG1]] A poster of a field --sref [[IMG2]] --ar 16:9");
    expect(restoreUrls(masked.replace("field", "meadow"), urls)).toBe(prompt.replace("field", "meadow"));
  });

  test("a selection's placeholders match the full prompt's", () => {
    const prompt = "https://x.dev/a A field --sref https://x.dev/b --v 8.2";
    const { messages } = buildQuickEditMessages({ prompt, selection: "--sref https://x.dev/b", instruction: "drop the sref", system: "Dear Annete" });
    expect(messages[1]!.content).toContain("SELECTION:\n--sref [[IMG2]]");
    expect(messages[0]!.content).toContain("Project context");
  });

  test("wrappers chat models add are stripped", () => {
    expect(cleanModelText("```\nA red field\n```")).toBe("A red field");
    expect(cleanModelText("Here is the edited prompt:\nA red field")).toBe("A red field");
    expect(cleanModelText("\"A red field\"")).toBe("A red field");
    expect(cleanModelText("A red field --ar 3:2")).toBe("A red field --ar 3:2");
  });
});

describe("ordinary prompt", () => {
  test("spots a request for an ordinary prompt and leaves other edits alone", () => {
    for (const ask of ["rewrite it as ordinary prompt", "as a normal prompt pls", "no edit mode", "without the attachment"]) {
      expect(ORDINARY_PROMPT_ASK.test(ask)).toBe(true);
    }
    for (const ask of ["make it blue hour", "make the prompt shorter", "add a normal window"]) {
      expect(ORDINARY_PROMPT_ASK.test(ask)).toBe(false);
    }
  });

  test("the request carries the reminder only when asked", () => {
    const prompt = "Put the woman from the attached image into this scene: a close-up of her face.";
    const asked = buildQuickEditMessages({ prompt, instruction: "rewrite it as ordinary prompt" }).messages[1]!.content;
    const other = buildQuickEditMessages({ prompt, instruction: "make it night" }).messages[1]!.content;
    expect(asked).toContain("ordinary-prompt steps");
    expect(other).not.toContain("ordinary-prompt steps");
  });

  test("drops an echoed instruction from the answer", () => {
    expect(cleanModelText("Rewrite as ordinary prompt: A café at night.")).toBe("A café at night.");
    expect(cleanModelText("Ordinary prompt: A café.")).toBe("A café.");
    expect(cleanModelText("A plain prompt: of a café")).toBe("A plain prompt: of a café");
  });
});
