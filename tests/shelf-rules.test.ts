import { describe, expect, test } from "bun:test";
import { buildShelfQuestions, decideShelves, NONE, type Shelf, type ShelfGroup } from "../lib/shelf-rules";

const shelves: Shelf[] = [
  { id: "p1", name: "Canals & Waterfronts", group: "Places", description: "Canal streets, quays, bridges." },
  { id: "p2", name: "Rooftops, Skylines & Transit", group: "Places" },
  { id: "b1", name: "Creatures & Wildlife", group: "World building" },
  { id: "m1", name: "Night, Rain & Lamplight", group: "Moods" },
  { id: "m2", name: "Sunlight, Blossom & Haze", group: "Moods" },
];
const none = new Set<ShelfGroup>();

describe("decideShelves", () => {
  test("files a sure place, a sure building block and every sure mood", () => {
    const picks = decideShelves(shelves, {
      places: { choice: "Canals & Waterfronts", confidence: 0.92 },
      building: { choice: "Creatures & Wildlife", confidence: 0.85 },
      "mood:Night, Rain & Lamplight": { p: 0.9 },
      "mood:Sunlight, Blossom & Haze": { p: 0.2 },
    }, none);
    expect(picks).toEqual(["p1", "b1", "m1"]);
  });

  test("an unsure pick or 'none' files nothing", () => {
    const picks = decideShelves(shelves, {
      places: { choice: "Canals & Waterfronts", confidence: 0.6 },
      building: { choice: NONE, confidence: 0.99 },
    }, none);
    expect(picks).toEqual([]);
  });

  test("a group already picked by hand is left alone", () => {
    const picks = decideShelves(shelves, {
      places: { choice: "Rooftops, Skylines & Transit", confidence: 0.99 },
      "mood:Night, Rain & Lamplight": { p: 0.99 },
    }, new Set<ShelfGroup>(["Places"]));
    expect(picks).toEqual(["m1"]);
  });

  test("a choice naming no shelf of this world files nothing", () => {
    expect(decideShelves(shelves, { places: { choice: "Ballrooms", confidence: 0.99 } }, none)).toEqual([]);
  });
});

describe("buildShelfQuestions", () => {
  test("one choice per single-pick group with a way out, one yes/no per mood", () => {
    const questions = buildShelfQuestions(shelves, none, "DEAR ANNETE");
    expect(questions.map((question) => question.key)).toEqual([
      "places", "building", "mood:Night, Rain & Lamplight", "mood:Sunlight, Blossom & Haze",
    ]);
    const places = questions[0]!;
    expect(places.type === "choice" && places.choices.map((choice) => choice.value)).toEqual([
      "Canals & Waterfronts", "Rooftops, Skylines & Transit", NONE,
    ]);
  });

  test("skips the groups already picked by hand", () => {
    const questions = buildShelfQuestions(shelves, new Set<ShelfGroup>(["Places", "Moods"]), "DEAR ANNETE");
    expect(questions.map((question) => question.key)).toEqual(["building"]);
  });
});
