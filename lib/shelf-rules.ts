// Auto-shelving: a picture saved into a world also lands on that world's
// Places shelf and its romance mood shelf, picked by Jev (TypeSafe System One)
// from each shelf's name and description. Only those two: on 206 labelled
// Dear Annete pictures (2 Nov 2026, Dear Annette/shelf-world-test-2026-11-02)
// Jev was right on 59 of the 64 places it was sure of and 21 of 24 romance
// calls; World building shelves and the other moods were right too rarely
// (59–79 %) to file without a person. Cast (named people) and Styles (an
// experiment) are never auto-filed. A group the picture already has a shelf
// in is left alone, so a shelf picked by hand always wins.

export const SHELF_GROUPS = ["Places", "World building", "Moods"] as const;
export type ShelfGroup = (typeof SHELF_GROUPS)[number];
export type Shelf = { id: string; name: string; group: ShelfGroup; description?: string };

export const SHELF_MODEL = "jev-latest";
export const SHELF_RULE_VERSION = 2;
export const NONE = "none";
// Confidence a pick needs before the picture is filed.
export const SHELF_SURE = { place: 0.8, mood: 0.8 };

export const isShelfGroup = (group: string | undefined): group is ShelfGroup =>
  (SHELF_GROUPS as readonly string[]).includes(group ?? "");

/** The mood shelves worth filing by machine: romance and love. */
export const isRomanceShelf = (shelf: Shelf) => shelf.group === "Moods" && /romance|romantic|love/i.test(shelf.name);

export type ShelfQuestion =
  | { key: string; type: "choice"; instructions: string; criteria: Record<string, string> }
  | { key: string; type: "noul"; instructions: string };
export type ShelfAnswer = { choice?: string; confidence?: number; p?: number };
export type ShelfAnswers = Record<string, ShelfAnswer>;

const NOT_A_PLACE = "Not a place: a portrait, a figure, an object or a close detail where the setting does not matter.";

const describe = (shelf: Shelf) => `${shelf.name}. ${shelf.description ?? ""}`.trim();
/** Jev's choice keys are identifiers; this one maps back to the shelf. */
export const shelfSlug = (shelf: Shelf) => `s_${shelf.id}`;

/** The questions for one picture: one choice among the world's places, one yes/no per romance mood. */
export const buildShelfQuestions = (shelves: Shelf[], skipGroups: Set<ShelfGroup>, world: string): ShelfQuestion[] => {
  const questions: ShelfQuestion[] = [];
  const places = skipGroups.has("Places") ? [] : shelves.filter((shelf) => shelf.group === "Places");
  if (places.length > 0) {
    const criteria: Record<string, string> = {};
    for (const shelf of places) criteria[shelfSlug(shelf)] = describe(shelf);
    criteria[NONE] = NOT_A_PLACE;
    questions.push({
      key: "places", type: "choice", criteria,
      instructions: `\`picture\` belongs to the story world "${world}". Which kind of place in that world does it show?`,
    });
  }
  if (!skipGroups.has("Moods")) {
    for (const shelf of shelves.filter(isRomanceShelf)) {
      questions.push({ key: `mood_${shelf.id}`, type: "noul", instructions: `The mood of \`picture\` is: ${describe(shelf)}` });
    }
  }
  return questions;
};

/** Which shelves the answers earn. */
export const decideShelves = (shelves: Shelf[], answers: ShelfAnswers, skipGroups: Set<ShelfGroup>): string[] => {
  const picked: string[] = [];
  const place = answers.places;
  if (!skipGroups.has("Places") && place?.choice && place.choice !== NONE && (place.confidence ?? 0) >= SHELF_SURE.place) {
    const shelf = shelves.find((candidate) => candidate.group === "Places" && shelfSlug(candidate) === place.choice);
    if (shelf) picked.push(shelf.id);
  }
  if (!skipGroups.has("Moods")) {
    for (const shelf of shelves.filter(isRomanceShelf)) {
      if ((answers[`mood_${shelf.id}`]?.p ?? 0) >= SHELF_SURE.mood) picked.push(shelf.id);
    }
  }
  return picked;
};
