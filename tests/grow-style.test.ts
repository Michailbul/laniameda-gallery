import { describe, expect, test } from "bun:test";
import {
  EXPAND_SYSTEM_DEFAULT, GROW_LOCK, buildExpandMessages, expandPreset, parseExpandAnswer, stripStyle, styleOf, withStyle,
} from "../lib/mj-expand";

// Michael, 22 Nov 2026: the writer dropped the book and the artists from this style.
const STYLE = "Painted concept art for Jack Vance's The Dying Earth, in the manner of Moebius and Philippe Druillet: clean ink linework filled with luminous gouache and watercolour, vast strange ornate spaces, a palette of ember red, deep violet, tarnished gold and pale turquoise, airy and dreamlike.";
const SOURCE = `${STYLE} A lone wizard in a tall violet robe stands on a crumbling terrace above a red-sun valley.`;
const TRIMMED = "Painted concept art: clean ink linework filled with luminous gouache and watercolour, vast strange spaces, a palette of ember red, deep violet, tarnished gold and pale turquoise, airy and dreamlike.";
const systemOf = (messages: ReturnType<typeof buildExpandMessages>) => String(messages[0]!.content);

describe("Grow keeps the style word for word", () => {
  test("a trimmed style comes back as the source's own sentence, names included", () => {
    const kept = styleOf(TRIMMED, SOURCE, false);
    expect(kept).toEqual({ style: STYLE, restored: true });
    expect(kept.style).toContain("Jack Vance's The Dying Earth");
    expect(kept.style).toContain("Moebius and Philippe Druillet");
    expect(kept.style).not.toContain("lone wizard");
  });

  test("the source's own words pass as they are; an asked-for change is kept", () => {
    expect(styleOf(STYLE, SOURCE, false)).toEqual({ style: STYLE, restored: false });
    expect(styleOf("Black and white woodcut print.", SOURCE, true)).toEqual({ style: "Black and white woodcut print.", restored: false });
    expect(styleOf("Grainy 35mm photograph.", undefined)).toEqual({ style: "Grainy 35mm photograph.", restored: false });
    expect(styleOf(undefined, SOURCE).style).toBe("");
  });

  test("prompts take turns: style first, then what we see first and the style at the end", () => {
    const items = withStyle([
      { title: "a", words: "Close-up of the wizard's hands on a brass astrolabe" },
      { title: "b", words: "Extreme close-up of the violet robe's embroidered hem." },
      { title: "c", words: "Close-up of the wizard's face." },
    ], STYLE);
    expect(items[0]!.words).toBe(`${STYLE} Close-up of the wizard's hands on a brass astrolabe`);
    expect(items[1]!.words).toBe(`Extreme close-up of the violet robe's embroidered hem. ${STYLE}`);
    expect(items[2]!.words.startsWith(STYLE)).toBe(true);
    expect(withStyle([{ words: "Wide shot of the valley" }], "")[0]!.words).toBe("Wide shot of the valley");
  });

  test("a style the writer repeated in the content is not doubled", () => {
    expect(stripStyle(`${STYLE} Wide shot of the red-sun valley.`, STYLE)).toBe("Wide shot of the red-sun valley.");
    expect(stripStyle(`Wide shot of the red-sun valley. ${TRIMMED}`, STYLE)).toBe("Wide shot of the red-sun valley.");
    const [one] = withStyle([{ words: `${TRIMMED} Medium shot of the wizard on the terrace.` }], STYLE);
    expect(one!.words).toBe(`${STYLE} Medium shot of the wizard on the terrace.`);
  });

  test("the answer carries STYLE and STYLE CHANGED", () => {
    const parsed = parseExpandAnswer(`SET: Wizard close-ups\nSTYLE: ${STYLE}\nSTYLE CHANGED: no\nTITLE: Hands\nPROMPT: Close-up of the wizard's hands.\nTITLE: Hem\nPROMPT: Extreme close-up of the hem.`);
    expect(parsed.style).toBe(STYLE);
    expect(parsed.styleChanged).toBe(false);
    expect(parsed.items.map((item) => item.words)).toEqual(["Close-up of the wizard's hands.", "Extreme close-up of the hem."]);
    expect(parseExpandAnswer("STYLE: none\nTITLE: a\nPROMPT: b").style).toBeUndefined();
    expect(parseExpandAnswer("STYLE: x y z\nSTYLE CHANGED: yes\nTITLE: a\nPROMPT: b").styleChanged).toBe(true);
  });
});

describe("Grow's rules ride on every call, the art director's own prompt included", () => {
  const base = { image: "https://example.com/f.jpg", sourceWords: SOURCE, preset: expandPreset("close"), count: 3 };

  test("the lock follows the default and a custom prompt alike", () => {
    expect(systemOf(buildExpandMessages(base))).toContain(GROW_LOCK);
    const own = systemOf(buildExpandMessages({ ...base, rules: "MY OLD GROW PROMPT: no artist or film title words." }));
    expect(own.startsWith("MY OLD GROW PROMPT")).toBe(true);
    expect(own).toContain(GROW_LOCK);
  });

  test("the lock: style kept with its names, shot first, thought from the camera", () => {
    expect(GROW_LOCK).toContain("names included");
    expect(GROW_LOCK).toContain("covers only words you add");
    expect(GROW_LOCK).toContain("opens with the shot");
    expect(GROW_LOCK).toMatch(/Close-up and extreme close-up: .*surface in detail/);
    expect(GROW_LOCK).toMatch(/Wide and establishing shots: the place leads\. Describe the background/);
    expect(EXPAND_SYSTEM_DEFAULT).toContain("names in the source's own style words stay, exactly");
    expect(EXPAND_SYSTEM_DEFAULT).not.toMatch(/no real city, landmark, river, artist/);
  });

  test("the answer form asks for the style once and content-only prompts", () => {
    const text = String((buildExpandMessages(base)[1]!.content as Array<{ type: string; text?: string }>)[1]!.text);
    expect(text).toContain("STYLE: the source prompt's style words, copied exactly, names included");
    expect(text).toContain("STYLE CHANGED: no");
    expect(text).toContain("PROMPT: the content only, opening with the shot, without the style words");
  });
});
