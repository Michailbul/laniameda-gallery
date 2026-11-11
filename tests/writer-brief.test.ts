import { describe, expect, test } from "bun:test";
import {
  VOTE, WRITER_BRIEF_LIMITS, castLines, commandCodes, composeBrief, isBibleTitle, isCastTitle, isWorldKnowledgeDoc,
  pickWorld, recipeCodes, type BriefPart,
} from "../lib/writer-brief";
import { buildQuickEditMessages } from "../lib/mj-quick-edit";
import { buildDescribeMessages } from "../lib/mj-describe";

const part = (key: BriefPart["key"], label: string, text: string, title = label): BriefPart => ({ key, label, title, text });

describe("the writer's world brief", () => {
  test("a command's codes: profiles, moodboards and style codes, each once, links left out", () => {
    const codes = commandCodes("https://s.mj.run/abc a woman in crimson silk --ar 16:9 --profile hbczyur 9ts8jmb --sref 2071090430::2 https://cdn.x/y.png --p HBCZYUR --sw 300 --v 8.2");
    expect(codes.profiles).toEqual(["hbczyur", "9ts8jmb"]);
    expect(codes.srefs).toEqual(["2071090430"]);
    expect(commandCodes("a street at dusk, no flags")).toEqual({ profiles: [], srefs: [] });
    // An em-dash pasted by a text editor still reads as a flag.
    expect(commandCodes("a hall —profile esga8jv").profiles).toEqual(["esga8jv"]);
  });

  test("a recipe's own text gives up its codes", () => {
    const codes = recipeCodes({ parameters: "--sref 7613287694 --stylize 300", template: "[subject] in fog --profile 37vd7r6", unknownCodes: ["2k7kjkp", "--sw"] });
    expect([...codes].sort()).toEqual(["2k7kjkp", "37vd7r6", "7613287694"]);
  });

  test("the world with the most evidence wins; a level score is never guessed", () => {
    expect(pickWorld([])).toEqual({ tie: [] });
    // A moodboard of one world beats a profile shared by two.
    expect(pickWorld([
      { world: "dear-annete", universe: "dear-annete", weight: VOTE.moodboard },
      { world: "dear-annete", universe: "dear-annete", weight: VOTE.sharedProfile },
      { world: "cassandra", universe: "cassandra", weight: VOTE.sharedProfile },
    ])).toEqual({ world: "dear-annete", tie: [] });
    // One profile used by two unrelated worlds: a tie, named, not picked.
    expect(pickWorld([
      { world: "cassandra", universe: "cassandra", weight: VOTE.sharedProfile },
      { world: "cyber-gothic-city", universe: "cyber-gothic-city", weight: VOTE.sharedProfile },
    ])).toEqual({ tie: ["cassandra", "cyber-gothic-city"] });
    // Level worlds of one universe: the universe's own world, whose bible covers both.
    expect(pickWorld([
      { world: "dear-annete-art-deco", universe: "dear-annete", weight: VOTE.sharedProfile },
      { world: "dear-annete", universe: "dear-annete", weight: VOTE.sharedProfile },
    ])).toEqual({ world: "dear-annete", tie: [] });
  });

  test("the brief leads with how the files bind, keeps the rule file whole and says what it read", () => {
    const rules = `Never everyday clothes.\n\n${"Couture rule. ".repeat(500)}`;
    const brief = composeBrief("DEAR ANNETE", [
      part("bible", "bible", "Annete writes letters she never sends.", "DEAR ANNETE — World Bible"),
      part("rules", "rules", rules, "WORLD.md"),
      part("cast", "cast", "- Dari: long dark hair, civilian coat"),
      part("cast", "cast", "Directory text", "Character directory"),
      part("learnings", "learnings", ""),
    ]);
    expect(brief.text.startsWith("THE WORLD THIS WORK BELONGS TO: DEAR ANNETE.")).toBe(true);
    expect(brief.text).toContain("Never invent a new look for a named character");
    // Parts come in priority order whatever order they were gathered in.
    expect(brief.text.indexOf("=== WORLD.md ===")).toBeLessThan(brief.text.indexOf("=== cast ==="));
    expect(brief.text.indexOf("=== Character directory ===")).toBeLessThan(brief.text.indexOf("=== DEAR ANNETE — World Bible ==="));
    expect(brief.text).toContain(rules.trim());
    expect(brief.read).toEqual(["rules", "cast", "bible"]);
    expect(brief.chars).toBe(brief.text.length);
    expect(composeBrief("EMPTY", [])).toEqual({ text: "", read: [], chars: 0 });
  });

  test("a long file is cut at its cap with a note; the quick edit's brief leaves the bible out", () => {
    const long = Array.from({ length: 4000 }, (_, index) => `Line ${index} of the bible.`).join("\n");
    const parts = [part("rules", "rules", "Never a real city."), part("bible", "bible", long), part("stories", "stories", "- The Bath"), part("docs", "world notes", "Trams are cable trams.", "docs/vehicles.md")];
    const full = composeBrief("W", parts, "full");
    expect(full.text).toContain("[… cut here; the rest is in the gallery]");
    expect(full.chars).toBeLessThan(WRITER_BRIEF_LIMITS.full + 2000);
    expect(full.read).toEqual(["rules", "bible", "stories", "world notes"]);
    const short = composeBrief("W", parts, "short");
    expect(short.read).toEqual(["rules"]);
    expect(short.text).not.toContain("Line 1 of the bible.");
  });

  test("which stories and docs count as world knowledge", () => {
    expect(isBibleTitle("DEAR ANNETE — World Bible")).toBe(true);
    expect(isBibleTitle("The Wedding · opening hook")).toBe(false);
    expect(isCastTitle("CASSANDRA — Character directory")).toBe(true);
    expect(isCastTitle("GAL-AN-CHAR-003 · Review daughter design")).toBe(false);
    expect(["docs/character-sheets.md", "docs/vehicles.md", "docs/skyline.md"].every(isWorldKnowledgeDoc)).toBe(true);
    expect(["docs/midjourney.md", "docs/tags.md", "docs/workflow.md", "docs/prompting-guide-v8-2.md", "docs/look-research.md"].some(isWorldKnowledgeDoc)).toBe(false);
  });

  test("the cast reads as plain lines without ids; retired people and costumes are left out", () => {
    const text = castLines([
      { code: "DA-CH-001", name: "Dari", alias: "the civilian", otherNames: [], role: "lead", lane: "live-action", status: "sheeted", notes: "Long dark hair.\nNever the bob.", costumes: [{ name: "Crimson silk gown", status: "approved", notes: "gold filigree collar" }, { name: "Old coat", status: "retired" }] },
      { code: "DA-CH-009", name: "Bob", otherNames: [], status: "retired", costumes: [] },
      { code: "DA-CH-004", name: "Rhea", otherNames: ["the seamstress"], status: "concept", costumes: [] },
    ]);
    expect(text).toContain("- Dari (also: the civilian) · lead · live-action lane: Long dark hair. Never the bob.");
    expect(text).toContain('  - costume "Crimson silk gown": gold filigree collar');
    expect(text).toContain("- Rhea (also: the seamstress) · still a concept, look not approved");
    expect(text).not.toContain("Bob");
    expect(text).not.toContain("Old coat");
    expect(text).not.toContain("DA-CH");
  });

  test("the quick edit and Make it ours carry the brief; a plain recreation does not", () => {
    const brief = composeBrief("DEAR ANNETE", [part("rules", "rules", "Never everyday clothes.")]).text;
    const edit = buildQuickEditMessages({ prompt: "a woman in a coat --ar 16:9", instruction: "make it a gown", worldBrief: brief });
    expect(edit.messages[0]!.content).toContain("Never everyday clothes.");
    expect(edit.messages[0]!.content).toContain("still return the edited text and nothing else");
    expect(buildQuickEditMessages({ prompt: "a woman", instruction: "older" }).messages[0]!.content).not.toContain("THE WORLD THIS WORK BELONGS TO");

    const style = { name: "Crimson Fog", raises: [], lowers: [] };
    const ours = buildDescribeMessages({ image: "https://x/y.png", mode: "both", style, worldBrief: brief });
    expect(ours[0]!.content).toContain("Never everyday clothes.");
    expect(ours[0]!.content).toContain("KEEP stays a plain recreation");
    const keep = buildDescribeMessages({ image: "https://x/y.png", mode: "keep", worldBrief: brief });
    expect(keep[0]!.content).not.toContain("Never everyday clothes.");
  });
});

type CardApi = {
  autoWorldLabel: (found: { world?: { key: string; name: string } | null; tie?: string[] } | null) => string;
  briefLine: (res: { world?: string; read?: string[]; worldTie?: string[] }) => string;
};
const card = () => (globalThis as typeof globalThis & { SaveToGalleryExpand: CardApi }).SaveToGalleryExpand;

describe("the Grow card says which world it reads", () => {
  test("the Auto option names the world found, a tie, or nothing found", async () => {
    await import("../extension/mj-expand.js");
    expect(card().autoWorldLabel(null)).toBe("Auto");
    expect(card().autoWorldLabel({ world: { key: "dear-annete", name: "DEAR ANNETE" }, tie: [] })).toBe("Auto · DEAR ANNETE");
    expect(card().autoWorldLabel({ world: null, tie: ["CASSANDRA", "CYBER-GOTHIC CITY"] })).toBe("Auto · two worlds fit, pick one");
    expect(card().autoWorldLabel({ world: null, tie: [] })).toBe("Auto · no world in these codes");
  });

  test("the status line lists the files the writer was given", async () => {
    await import("../extension/mj-expand.js");
    expect(card().briefLine({ world: "Dear Annete", read: ["rules", "cast", "bible"] })).toBe("DEAR ANNETE: rules, cast, bible");
    expect(card().briefLine({ world: "Giant Herd" })).toBe("GIANT HERD rules");
    expect(card().briefLine({ worldTie: ["CASSANDRA", "CYBER-GOTHIC CITY"] })).toBe("no world read (CASSANDRA or CYBER-GOTHIC CITY? pick one)");
    expect(card().briefLine({})).toBe("");
  });
});
