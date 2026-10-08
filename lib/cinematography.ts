// Cinematography references: packs of camera moves, each step a reusable move
// prompt with its looping example. They are stored as native Skills, and
// one tag decides where they show: tagged `cinematography` they
// live in the Cinematography tab and stay out of the Skills tab, the default
// grid and the agents' skill lists.

export const CINEMATOGRAPHY_TAG = "cinematography";

// The same fold the backend matches tags with: case, "#", "-" and "_".
const canonicalTag = (tag: string) =>
  tag.trim().toLowerCase().replace(/^#+/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export const isCinematographySkill = (tagNames?: readonly string[]) =>
  (tagNames ?? []).some((tag) => canonicalTag(tag) === CINEMATOGRAPHY_TAG);

export type SkillSection = "skills" | "cinematography";

// Everything that differs between the two tabs and their cards, one place.
export const SKILL_SECTION_COPY: Record<
  SkillSection,
  {
    title: string;
    noun: string;
    unit: string;
    units: string;
    placeholder: string;
    emptyTitle: string;
    emptyFiltered: string;
    emptyCopy: string;
    switchPrompt: string;
    deleted: string;
  }
> = {
  skills: {
    title: "Skills",
    noun: "skill",
    unit: "step",
    units: "steps",
    placeholder: "Search skills by meaning — “turn footage into paint”",
    emptyTitle: "No skills yet",
    emptyFiltered: "No skill matches",
    emptyCopy:
      "Ask an agent to save a multi-step recipe as a skill. It lands here with its prompts, media and markdown.",
    switchPrompt: "SWITCH TO MY GALLERY TO BROWSE SKILLS.",
    deleted: "SKILL REMOVED · ITS STEPS STAY IN THE GALLERY",
  },
  cinematography: {
    title: "Cinematography",
    noun: "pack",
    unit: "move",
    units: "moves",
    placeholder: "Search cinematography by meaning — “slow push toward a face”",
    emptyTitle: "No cinematography yet",
    emptyFiltered: "No cinematography matches",
    emptyCopy:
      "Ask an agent to save camera moves and shot references with the cinematography tag. They land here with their prompts and examples.",
    switchPrompt: "SWITCH TO MY GALLERY TO BROWSE CINEMATOGRAPHY.",
    deleted: "PACK REMOVED · ITS MOVES STAY IN THE GALLERY",
  },
};
