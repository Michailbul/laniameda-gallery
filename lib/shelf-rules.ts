// Auto-shelving: a picture saved into a world also lands on that world's
// building-block shelves (Places, World building, Moods), picked by OpenAI's
// Decisions API from each shelf's name and description. Cast (named people)
// and Styles (an experiment) are never auto-filed. A group the picture already
// has a shelf in is left alone, so a shelf picked by hand always wins.

export const SHELF_GROUPS = ["Places", "World building", "Moods"] as const;
export type ShelfGroup = (typeof SHELF_GROUPS)[number];
export type Shelf = { id: string; name: string; group: ShelfGroup; description?: string };

export const SHELF_MODEL = "gpt-6-luna";
export const SHELF_RULE_VERSION = 1;
export const NONE = "none";
// Confidence a pick needs before the picture is filed (calibrated on Dear Annete shelves).
export const SHELF_SURE = { choice: 0.8, mood: 0.8 };

export const isShelfGroup = (group: string | undefined): group is ShelfGroup =>
  (SHELF_GROUPS as readonly string[]).includes(group ?? "");

type Choice = { value: string; description: string };
export type ShelfQuestion =
  | { key: string; type: "choice"; instructions: string; choices: Choice[] }
  | { key: string; type: "predicate"; instructions: string };
export type ShelfAnswer = { choice?: string; confidence?: number; p?: number };
export type ShelfAnswers = Record<string, ShelfAnswer>;

const NOT_A_PLACE = "Not a place: a portrait, a figure, an object or a close detail where the setting does not matter.";
const NO_BLOCK = "None of these: the picture is not mainly about any of these kinds of world element.";

const describe = (shelf: Shelf) => `${shelf.name}. ${shelf.description ?? ""}`.trim();

/** The questions for one picture: one choice per single-pick group, one yes/no per mood. */
export const buildShelfQuestions = (shelves: Shelf[], skipGroups: Set<ShelfGroup>, world: string): ShelfQuestion[] => {
  const of = (group: ShelfGroup) => (skipGroups.has(group) ? [] : shelves.filter((shelf) => shelf.group === group));
  const questions: ShelfQuestion[] = [];
  const places = of("Places");
  if (places.length > 0) {
    questions.push({
      key: "places", type: "choice",
      instructions: `This picture belongs to the story world "${world}". Which kind of place in that world does it show?`,
      choices: [...places.map((shelf) => ({ value: shelf.name, description: describe(shelf) })), { value: NONE, description: NOT_A_PLACE }],
    });
  }
  const blocks = of("World building");
  if (blocks.length > 0) {
    questions.push({
      key: "building", type: "choice",
      instructions: `This picture belongs to the story world "${world}". Which of the world's building blocks is it mainly about?`,
      choices: [...blocks.map((shelf) => ({ value: shelf.name, description: describe(shelf) })), { value: NONE, description: NO_BLOCK }],
    });
  }
  for (const shelf of of("Moods")) {
    questions.push({ key: `mood:${shelf.name}`, type: "predicate", instructions: `The picture's mood is: ${describe(shelf)}` });
  }
  return questions;
};

/** Which shelves the answers earn. */
export const decideShelves = (shelves: Shelf[], answers: ShelfAnswers, skipGroups: Set<ShelfGroup>): string[] => {
  const byName = (group: ShelfGroup, name: string | undefined) =>
    shelves.find((shelf) => shelf.group === group && shelf.name === name);
  const picked: string[] = [];
  const single = (key: string, group: ShelfGroup) => {
    const answer = answers[key];
    if (skipGroups.has(group) || !answer?.choice || answer.choice === NONE) return;
    if ((answer.confidence ?? 0) < SHELF_SURE.choice) return;
    const shelf = byName(group, answer.choice);
    if (shelf) picked.push(shelf.id);
  };
  single("places", "Places");
  single("building", "World building");
  if (!skipGroups.has("Moods")) {
    for (const shelf of shelves) {
      if (shelf.group === "Moods" && (answers[`mood:${shelf.name}`]?.p ?? 0) >= SHELF_SURE.mood) picked.push(shelf.id);
    }
  }
  return picked;
};
