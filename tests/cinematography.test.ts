import { describe, expect, test } from "bun:test";

import {
  CINEMATOGRAPHY_TAG,
  SKILL_SECTION_COPY,
  isCinematographySkill,
} from "../lib/cinematography";
import { skillCardToEntry, type SkillCardData } from "../lib/skill-entries";

const card = (tagNames: string[]): SkillCardData => ({
  _id: "skill1",
  title: "Camera Movements — Dolly & Tracking",
  tagNames,
  stepCount: 9,
  createdAt: 1,
  previewImages: [],
});

describe("cinematography section", () => {
  test("a pack is recognised by its tag, folded like the backend folds tags", () => {
    expect(isCinematographySkill(["camera movements", CINEMATOGRAPHY_TAG])).toBe(true);
    expect(isCinematographySkill(["#Cinematography"])).toBe(true);
    expect(isCinematographySkill(["Cinematography "])).toBe(true);
    expect(isCinematographySkill(["technique", "cinematic"])).toBe(false);
    expect(isCinematographySkill([])).toBe(false);
    expect(isCinematographySkill(undefined)).toBe(false);
  });

  test("a pack card carries the Cinematography label, a skill card keeps Skill", () => {
    expect(skillCardToEntry(card(["cinematography", "dolly-track"])).author).toBe(
      "Cinematography",
    );
    expect(skillCardToEntry(card(["technique"])).author).toBe("Skill");
  });

  test("the two sections never share a name", () => {
    expect(SKILL_SECTION_COPY.cinematography.title).toBe("Cinematography");
    expect(SKILL_SECTION_COPY.cinematography.units).toBe("moves");
    expect(SKILL_SECTION_COPY.skills.units).toBe("steps");
  });
});
