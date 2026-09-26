import { describe, expect, test } from "bun:test";

import {
  arePromptVariations,
  clusterPromptFamilies,
  promptFingerprint,
  VARIATION_WINDOW_MS,
} from "../lib/prompt-family";

const HOUR = 60 * 60 * 1000;

const MASA_BASE =
  "Masa, a 24 year old Japanese woman with a sharp black bob, oversized grey hoodie, " +
  "sitting on the edge of her bed in a small Tokyo apartment, phone selfie, soft window light, " +
  "candid UGC style, slight grain, text overlay reads";

const print = (text: string) => {
  const fingerprint = promptFingerprint(text);
  if (!fingerprint) throw new Error(`no fingerprint for: ${text}`);
  return fingerprint;
};

describe("prompt fingerprints", () => {
  test("ignores case, punctuation and generation parameters", () => {
    const left = print(`${MASA_BASE} "no drama" --ar 9:16 --seed 1234 --v 7`);
    const right = print(`${MASA_BASE.toUpperCase()}: NO DRAMA! --ar 4:5 --seed 99`);
    expect(left.key).toBe(right.key);
  });

  test("placeholders and short labels are not groupable", () => {
    expect(promptFingerprint("Untitled prompt")).toBeNull();
    expect(promptFingerprint("img_0421.png")).toBeNull();
    expect(promptFingerprint("Dear Annete cover")).toBeNull();
    expect(promptFingerprint("")).toBeNull();
  });
});

describe("prompt variations", () => {
  test("the same prompt with the last line rewritten is a variation", () => {
    expect(
      arePromptVariations(
        print(`${MASA_BASE} "no drama"`),
        print(`${MASA_BASE} "be part of something"`),
      ),
    ).toBe(true);
  });

  test("a prompt extended by a sentence is a variation", () => {
    expect(
      arePromptVariations(
        print(MASA_BASE),
        print(
          `${MASA_BASE} "no drama". She is holding a matcha latte, a cat walks behind her.`,
        ),
      ),
    ).toBe(true);
  });

  test("two different shots in the same style are not", () => {
    expect(
      arePromptVariations(
        print(
          "A cinematic portrait of a young man in a red jacket standing in the rain at night, 35mm, shallow depth of field",
        ),
        print(
          "A cinematic portrait of an old woman in a blue coat sitting in a sunny cafe, 35mm, shallow depth of field",
        ),
      ),
    ).toBe(false);
  });
});

describe("prompt families", () => {
  test("folds separately saved renders and variations together", () => {
    const now = 10 * 24 * HOUR;
    const families = clusterPromptFamilies([
      { createdAt: now, promptTexts: [`${MASA_BASE} "be part of something"`] },
      { createdAt: now - HOUR, promptTexts: [`${MASA_BASE} "no drama"`] },
      { createdAt: now - 2 * HOUR, promptTexts: [`${MASA_BASE} "no drama" --seed 7`] },
      {
        createdAt: now - 3 * HOUR,
        promptTexts: [
          "Brutalist concrete villa on a cliff above the ocean, golden hour, architectural photography, wide angle",
        ],
      },
      { createdAt: now - 4 * HOUR, promptTexts: [] },
    ]);

    expect(families).toEqual([[0, 1, 2], [3], [4]]);
  });

  test("a variation from long ago starts its own pack; the same prompt does not", () => {
    const now = 100 * 24 * HOUR;
    const families = clusterPromptFamilies([
      { createdAt: now, promptTexts: [`${MASA_BASE} "be part of something"`] },
      {
        createdAt: now - VARIATION_WINDOW_MS - HOUR,
        promptTexts: [`${MASA_BASE} "no drama"`],
      },
      {
        createdAt: now - 60 * 24 * HOUR,
        promptTexts: [`${MASA_BASE} "be part of something"`],
      },
    ]);

    expect(families).toEqual([[0, 2], [1]]);
  });

  test("stays fast on a large vault", () => {
    const items = Array.from({ length: 3000 }, (_, index) => ({
      createdAt: index * HOUR,
      promptTexts: [
        `subject ${index} word${index % 97} scene${index % 89} cinematic portrait lighting ${index % 13} lens ${index % 7} mood${index % 31}`,
      ],
    }));
    const startedAt = performance.now();
    const families = clusterPromptFamilies(items);
    expect(performance.now() - startedAt).toBeLessThan(1500);
    expect(families.flat()).toHaveLength(3000);
  });
});
