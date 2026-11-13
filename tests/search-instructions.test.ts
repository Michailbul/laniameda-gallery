import { describe, expect, test } from "bun:test";

import {
  readSearchInstructions,
  searchInstructionsKey,
  searchOnlyFilters,
  searchPieceFilter,
  searchRequestFromKey,
  searchWordsMatcher,
  splitSearchSteps,
} from "../lib/search-instructions";

const FOLDERS = [
  { id: "f:da", name: "DEAR ANNETE" },
  { id: "f:da-places", name: "Places", parentId: "f:da" },
  { id: "f:da-cast", name: "Cast", parentId: "f:da" },
  { id: "f:deco", name: "DEAR ANNETE — ART DECO" },
  { id: "f:anya", name: "ANDROMEDA — ANYA" },
  { id: "f:cars", name: "Cars" },
  { id: "f:cass", name: "CASSANDRA" },
];

describe("a typed line becomes steps", () => {
  test("one instruction a step", () => {
    expect(splitSearchSteps("dear annete world, interiors / city street", FOLDERS))
      .toEqual(["dear annete world", "interiors / city street"]);
    expect(splitSearchSteps("interiors without cars", FOLDERS)).toEqual(["interiors", "no cars"]);
    expect(splitSearchSteps("dark street but no people", FOLDERS)).toEqual(["dark street", "no people"]);
    expect(splitSearchSteps("interiors in dear annete", FOLDERS)).toEqual(["in DEAR ANNETE", "interiors"]);
    expect(splitSearchSteps("  ,  ", FOLDERS)).toEqual([]);
  });
});

describe("a thread of steps", () => {
  test("where to look, what for, and what to leave out", () => {
    const read = readSearchInstructions(
      ["dear annete world", "interiors / city street", "no cars", "dark"], FOLDERS,
    );
    expect(read.folderIds).toEqual(["f:da", "f:da-places", "f:da-cast"]);
    expect(read.folderName).toBe("DEAR ANNETE");
    expect(read.phrasings).toEqual(["interiors, dark", "city street, dark"]);
    expect(read.exclude).toEqual(["cars"]);
    expect(read.steps).toEqual([
      { kind: "place", label: "DEAR ANNETE" },
      { kind: "words", label: "interiors / city street" },
      { kind: "exclude", label: "no cars" },
      { kind: "words", label: "dark" },
    ]);
  });

  test("a world needs a cue; a bare name is a search word", () => {
    expect(readSearchInstructions(["cars"], FOLDERS)).toMatchObject({ phrasings: ["cars"] });
    expect(readSearchInstructions(["cars"], FOLDERS).folderIds).toBeUndefined();
    expect(readSearchInstructions(["cars collection"], FOLDERS).folderIds).toEqual(["f:cars"]);
    expect(readSearchInstructions(["in cassandra"], FOLDERS).folderIds).toEqual(["f:cass"]);
    expect(readSearchInstructions(["from the cassandra world"], FOLDERS).folderIds).toEqual(["f:cass"]);
    // The longer name wins; a dashed name answers to its first part.
    expect(readSearchInstructions(["dear annete art deco world"], FOLDERS).folderIds).toEqual(["f:deco"]);
    expect(readSearchInstructions(["andromeda world"], FOLDERS).folderIds).toEqual(["f:anya"]);
    // A world alone still shows that world.
    expect(readSearchInstructions(["dear annete world"], FOLDERS).phrasings).toEqual(["DEAR ANNETE"]);
  });

  test("filters said in words", () => {
    expect(readSearchInstructions(["knight", "only videos"], FOLDERS)).toMatchObject({
      phrasings: ["knight"], kind: "video",
    });
    expect(readSearchInstructions(["knight", "no videos"], FOLDERS)).toMatchObject({ kind: "image", exclude: [] });
    expect(readSearchInstructions(["castle", "locations", "liked", "animation"], FOLDERS)).toMatchObject({
      phrasings: ["castle"], pieceType: "location", onlyLiked: true, medium: "animation",
    });
    // Inside a phrase the same words are just words.
    expect(readSearchInstructions(["female characters in armor"], FOLDERS)).toMatchObject({
      phrasings: ["female characters in armor"],
    });
    expect(readSearchInstructions(["female characters in armor"], FOLDERS).pieceType).toBeUndefined();
  });

  test("a filter word alone browses everything it marks", () => {
    const read = readSearchInstructions(["animation"], FOLDERS);
    expect(read).toMatchObject({ phrasings: [], medium: "animation" });
    expect(read.steps).toEqual([{ kind: "filter", label: "Animation" }]);
    const { steps: _steps, ...request } = read;
    expect(searchOnlyFilters(request)).toBeTrue();
    const keep = searchPieceFilter(request);
    // No word of its own: any text passes, the tag decides.
    expect(keep({ kind: "image", tagNames: ["Animation", "scene"] }, "a painted street")).toBeTrue();
    expect(keep({ kind: "image", tagNames: ["live-action"] }, "a post about animation")).toBeFalse();
    expect(keep({ kind: "image", tagNames: [] }, "an X post about animation")).toBeFalse();
    const { steps: _plain, ...plain } = readSearchInstructions(["knight"], FOLDERS);
    expect(searchOnlyFilters(plain)).toBeFalse();
  });

  test("a word the tagger answers rules out what it marked as the opposite", () => {
    expect(readSearchInstructions(["dark interiors"], FOLDERS)).toMatchObject({
      phrasings: ["dark interiors"], excludeTags: ["exterior"],
    });
    expect(readSearchInstructions(["city street at night", "close up"], FOLDERS)).toMatchObject({
      phrasings: ["city street at night, close up"], excludeTags: ["day", "golden-hour", "wide-shot"],
    });
    // Either of two things: nothing is ruled out.
    expect(readSearchInstructions(["interiors / city street"], FOLDERS).excludeTags).toBeUndefined();
    // Left out by name: the tag goes too.
    expect(readSearchInstructions(["street", "no interiors"], FOLDERS)).toMatchObject({
      exclude: ["interiors"], excludeTags: ["interior"],
    });
    const { steps: _steps, ...request } = readSearchInstructions(["interiors", "locations", "liked"], FOLDERS);
    const keep = searchPieceFilter(request);
    const text = "A brass-lit interior hall";
    expect(keep({ kind: "image", isLiked: true, tagNames: ["location", "interior"] }, text)).toBeTrue();
    // The tagger could not judge inside or out: the piece stays.
    expect(keep({ kind: "image", isLiked: true, tagNames: ["Locations"] }, text)).toBeTrue();
    expect(keep({ kind: "image", isLiked: true, tagNames: ["location", "exterior"] }, text)).toBeFalse();
    expect(keep({ kind: "image", isLiked: false, tagNames: ["location"] }, text)).toBeFalse();
    expect(keep({ kind: "image", isLiked: true, tagNames: ["character"] }, text)).toBeFalse();
    expect(keep({ kind: "image", isLiked: true, tagNames: ["location"] }, "A garden")).toBeFalse();
  });

  test("leaving out several things, in any wording", () => {
    expect(readSearchInstructions(["street", "no cars or people", "-text", "without the fog"], FOLDERS).exclude)
      .toEqual(["cars", "people", "text", "fog"]);
  });

  test("only the newest choice forks the search, and it forks at most three ways", () => {
    const read = readSearchInstructions(["red / blue", "car / bike / boat / plane"], FOLDERS);
    expect(read.phrasings).toEqual(["red or blue, car", "red or blue, bike", "red or blue, boat"]);
  });

  test("the same request has the same key however it was typed", () => {
    const stepped = readSearchInstructions(["interiors", "no cars"], FOLDERS);
    const typed = readSearchInstructions(splitSearchSteps("interiors without cars", FOLDERS), FOLDERS);
    expect(searchInstructionsKey(typed)).toBe(searchInstructionsKey(stepped));
    expect(searchInstructionsKey(readSearchInstructions(["interiors"], FOLDERS)))
      .not.toBe(searchInstructionsKey(stepped));
    const { steps: _steps, ...request } = stepped;
    expect(searchRequestFromKey(searchInstructionsKey(stepped))).toEqual(request);
  });

  test("keyword matches follow the same instructions", () => {
    const matches = searchWordsMatcher(readSearchInstructions(["interiors / city street", "no cars", "dark"], FOLDERS));
    expect(matches("A dark interior with a brass lamp")).toBeTrue();
    expect(matches("Dark city street after rain")).toBeTrue();
    expect(matches("Dark city street with parked cars")).toBeFalse();
    expect(matches("A bright interior")).toBeFalse();
  });

describe("a filter at the head of a line", () => {
  test("\"only videos foggy forest\" filters to videos and searches the rest", () => {
    const read = readSearchInstructions(["only videos foggy forest"], FOLDERS);
    expect(read.kind).toBe("video");
    expect(read.phrasings).toEqual(["foggy forest"]);
  });

  test("without only or just, the words stay words", () => {
    const read = readSearchInstructions(["videos of rain"], FOLDERS);
    expect(read.kind).toBeUndefined();
    expect(read.phrasings).toEqual(["videos of rain"]);
  });

  test("two-word filters: \"just live action street\"", () => {
    const read = readSearchInstructions(["just live action street"], FOLDERS);
    expect(read.medium).toBe("live-action");
    expect(read.phrasings).toEqual(["street"]);
  });
});
});
