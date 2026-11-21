import { describe, expect, test } from "bun:test";
import { asksForShots, looseShotCard, parseShotCard, pickShots, randomShots, shotModeOf, shotsBlock, type ShotCard } from "../lib/cinematic-shots";

const description = (title: string, shotName: string, base: string) => [
  `CINEMATIC SHOT · ${title}`,
  shotName,
  "",
  "Size & lens: A wide on a normal lens.",
  "Camera: Static, at eye level.",
  "Composition: Centred.",
  "Staging: One man.",
  "Light & colour: Hard noon sun.",
  "",
  "Base prompt (style-neutral; put a world's style sentence in front and add its codes):",
  base,
  "",
  "Reference frame: attach this image in Midjourney V8.2 Edit to keep the layout while the look changes. Source: Better Call Saul (AMC).",
].join("\n");

const card = (id: string, title: string, shotName: string, tags: string[], base = `A ${shotName.toLowerCase()} of a place.`): ShotCard =>
  parseShotCard(id, description(title, shotName, base), ["inspiration", "cinematic-shot", ...tags])!;

describe("the writer's cinematic shot library", () => {
  test("a frame's description gives up its shot card", () => {
    const parsed = parseShotCard("a1", description("Lone man on a hallway bench", "Static medium-wide · eye level · planimetric", "A static medium-wide shot at eye level. Only this one person."), ["medium-wide"]);
    expect(parsed).toEqual({
      id: "a1", title: "Lone man on a hallway bench", shotName: "Static medium-wide · eye level · planimetric",
      basePrompt: "A static medium-wide shot at eye level. Only this one person.", tags: ["medium-wide"],
    });
    expect(parseShotCard("a2", "Screenshot from a show, kept for reference.")).toBeNull();
    expect(parseShotCard("a3", undefined)).toBeNull();
  });

  test("only requests about shots, framing or the camera open the library", () => {
    expect(asksForShots("give me some cinematic prompts")).toBe(true);
    expect(asksForShots("make it an over-the-shoulder")).toBe(true);
    expect(asksForShots(undefined, "a low angle from the floor")).toBe(true);
    expect(asksForShots("make her hair red")).toBe(false);
    expect(asksForShots(undefined, "")).toBe(false);
  });

  test("the closest shots come first; source tags never decide a match", () => {
    const cards = [
      card("1", "Two men face to face", "Profile two-shot medium close-up", ["two-shot", "medium-close-up"]),
      card("2", "Bald man listens in the desert", "Over-the-shoulder medium shot · slightly low", ["over-the-shoulder", "medium", "low-angle"]),
      card("3", "Ranch house under a huge sky", "Extreme wide · low camera · planimetric", ["extreme-wide", "planimetric"]),
    ];
    expect(pickShots(cards, "an over the shoulder in the desert").map((entry) => entry.id)).toEqual(["2"]);
    expect(pickShots(cards, "extreme wide, planimetric").map((entry) => entry.id)[0]).toBe("3");
    // "inspiration" is on every card and matches nothing.
    expect(pickShots(cards, "inspiration").length).toBe(3);
  });

  test("with nothing named the writer sees a spread of shot types", () => {
    const cards = [
      card("1", "A", "Wide", ["wide"]), card("2", "B", "Wide again", ["wide"]),
      card("3", "C", "Close-up", ["close-up"]), card("4", "D", "Top-down", ["top-down"]),
    ];
    expect(pickShots(cards, "some cinematic prompts").map((entry) => entry.id)).toEqual(["1", "3", "4"]);
  });

  test("the block lays out the picked cards whole and names the rest", () => {
    const cards = [card("1", "Lone tree on the plain", "Extreme wide", ["extreme-wide"], "An extreme wide shot of a plain."), card("2", "Diner booth from above", "Top-down", ["top-down"])];
    const text = shotsBlock([cards[0]!], cards);
    expect(text).toContain("CINEMATIC SHOTS LIBRARY");
    expect(text).toContain("1. Lone tree on the plain · Extreme wide [extreme-wide]\n   An extreme wide shot of a plain.");
    expect(text).toContain("Also on the shelf (ask for one by name): Diner booth from above.");
    expect(text).not.toContain("inspiration");
    expect(shotsBlock([], cards)).toBe("");
  });

  test("the Shots switch reads off, auto and random; anything else is auto", () => {
    expect(shotModeOf("off")).toBe("off");
    expect(shotModeOf("random")).toBe("random");
    expect(shotModeOf(undefined)).toBe("auto");
    expect(shotModeOf("always")).toBe("auto");
  });

  test("random draws different shots, the same ones for the same seed", () => {
    const cards = Array.from({ length: 20 }, (_, index) => card(String(index), `Shot ${index}`, "Wide", ["wide"]));
    const first = randomShots(cards, 4, 42).map((entry) => entry.id);
    expect(first.length).toBe(4);
    expect(new Set(first).size).toBe(4);
    expect(randomShots(cards, 4, 42).map((entry) => entry.id)).toEqual(first);
    expect(randomShots(cards, 4, 43).map((entry) => entry.id)).not.toEqual(first);
    // Never more than the writer is given whole.
    expect(randomShots(cards, 30, 1).length).toBe(8);
  });

  test("a random block hands out the shots in order and names its collection", () => {
    const cards = [card("1", "Lone tree on the plain", "Extreme wide", ["extreme-wide"]), card("2", "Diner booth from above", "Top-down", ["top-down"])];
    const text = shotsBlock(cards, cards, { random: true, from: "NERVY — Night Rooftop Plates" });
    expect(text).toContain("random shot layouts from the collection \"NERVY — Night Rooftop Plates\"");
    expect(text).toContain("prompt 1 takes shot 1, prompt 2 takes shot 2");
    expect(text).not.toContain("Also on the shelf");
  });

  test("a frame with no shot card stands in with its own words", () => {
    const loose = looseShotCard("a9", { title: "rooftop-plate_02.png", agentDescription: "A singer stands alone on a wet rooftop at night, city lights soft behind her." }, ["night"]);
    expect(loose).toEqual({ id: "a9", title: "rooftop plate 02", shotName: "", basePrompt: "A singer stands alone on a wet rooftop at night, city lights soft behind her.", tags: ["night"] });
    expect(looseShotCard("a10", { title: "x.png", description: "short" })).toBeNull();
  });
});
