import { describe, expect, test } from "bun:test";
import { buildShelfQuestions, decideShelves, NONE, shelfSlug, type Shelf, type ShelfGroup } from "../lib/shelf-rules";

const shelves: Shelf[] = [
  { id: "p1", name: "Canals & Waterfronts", group: "Places", description: "Canal streets, quays, bridges." },
  { id: "p2", name: "Rooftops, Skylines & Transit", group: "Places" },
  { id: "b1", name: "Creatures & Wildlife", group: "World building" },
  { id: "m1", name: "Night, Rain & Lamplight", group: "Moods" },
  { id: "m2", name: "Romance & Quiet Moments", group: "Moods" },
];
const none = new Set<ShelfGroup>();

describe("decideShelves", () => {
  test("files a sure place and a sure romance mood, nothing else", () => {
    const picks = decideShelves(shelves, {
      places: { choice: shelfSlug(shelves[0]!), confidence: 0.92 },
      mood_m1: { p: 0.99 },
      mood_m2: { p: 0.9 },
    }, none);
    expect(picks).toEqual(["p1", "m2"]);
  });

  test("an unsure pick or 'none' files nothing", () => {
    expect(decideShelves(shelves, { places: { choice: shelfSlug(shelves[0]!), confidence: 0.6 } }, none)).toEqual([]);
    expect(decideShelves(shelves, { places: { choice: NONE, confidence: 0.99 } }, none)).toEqual([]);
  });

  test("a group already picked by hand is left alone", () => {
    const picks = decideShelves(shelves, {
      places: { choice: shelfSlug(shelves[1]!), confidence: 0.99 },
      mood_m2: { p: 0.99 },
    }, new Set<ShelfGroup>(["Places"]));
    expect(picks).toEqual(["m2"]);
  });

  test("a choice naming no shelf of this world files nothing", () => {
    expect(decideShelves(shelves, { places: { choice: "s_other", confidence: 0.99 } }, none)).toEqual([]);
  });
});

describe("buildShelfQuestions", () => {
  test("one choice among the places with a way out, one yes/no per romance mood", () => {
    const questions = buildShelfQuestions(shelves, none, "DEAR ANNETE");
    expect(questions.map((question) => question.key)).toEqual(["places", "mood_m2"]);
    const places = questions[0]!;
    expect(places.type === "choice" && Object.keys(places.criteria)).toEqual(["s_p1", "s_p2", NONE]);
  });

  test("skips the groups already picked by hand", () => {
    expect(buildShelfQuestions(shelves, new Set<ShelfGroup>(["Places", "Moods"]), "DEAR ANNETE")).toEqual([]);
  });
});
