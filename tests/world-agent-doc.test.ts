import { describe, expect, test } from "bun:test";
import { buildWorldAgentSections, joinAgentSections, type WorldContext } from "@/lib/world-agent-doc";

const id = <T extends string>(value: string) => value as never as T;

const worldBody = "# DEAR ANNETE\n\nOrnate dark-fantasy couture.\n\n## Rules\n1. Midjourney is the source of every look.\n";

const context = {
  world: { id: id("w1"), key: "dear-annete", name: "DEAR ANNETE", description: "A film world.", rootCount: 312 },
  worldDoc: { body: worldBody, revision: 7, updatedAt: Date.UTC(2026, 9, 27, 12) },
  learnings: null,
  docs: [
    { path: "WORLD.md", chars: worldBody.length, revision: 7, updatedAt: 1, updatedBy: "owner" },
    { path: "docs/midjourney.md", chars: 20, revision: 3, updatedAt: 1, updatedBy: "agent:claude" },
  ],
  limits: { worldDoc: 8000, learnings: 6000, learningEntries: 40, doc: 12000, docs: 8 },
  styles: [{ styleTag: "da-film", branch: "DA FILM", moodboards: 1, locks: [] }],
  otherLocks: [],
  storyCount: 0,
  shelves: [{ id: id("s1"), name: "Cast", kind: "shelf", group: "Cast", count: 24 }],
  storybooks: [],
  stories: [],
  moodboards: [{
    id: id("m1"), name: "DA FILM v3", collection: "DA FILM", styleTag: "da-film", status: "in-midjourney",
    profileFlag: "--profile abc123", itemCount: 32, sync: "in sync",
  }],
  profiles: [{ id: id("p1"), name: "Annete taste", code: "xyz", flag: "--profile xyz", status: "active", role: "base taste" }],
  characters: [{ id: id("c1"), code: "DA-CH-001", name: "Annete", status: "active" }],
  recentChanges: [],
} as unknown as WorldContext;

describe("world agent document", () => {
  const docs = [{ path: "docs/midjourney.md", body: "# MIDJOURNEY\n\n- --profile xyz first\n", revision: 3, updatedAt: 1, updatedBy: "agent:claude" }];
  const sections = buildWorldAgentSections(context, docs);
  const text = joinAgentSections(sections);

  test("carries WORLD.md and every doc verbatim, each editable by path", () => {
    expect(text).toContain(worldBody.trimEnd());
    expect(text).toContain("- --profile xyz first");
    expect(sections.filter((section) => section.docPath).map((section) => section.docPath))
      .toEqual(["WORLD.md", "LEARNINGS.md", "docs/midjourney.md"]);
    expect(text).toContain("_LEARNINGS.md is not written yet._");
  });

  test("lists codes, profiles, shelves and characters the way open_world reports them", () => {
    expect(text).toContain("`--profile abc123` · in sync");
    expect(text).toContain("- **Annete taste** · `--profile xyz` · role: base taste");
    expect(text).toContain("- **Cast** · Cast · 24 pieces");
    expect(text).toContain("- `DA-CH-001` Annete · active");
    expect(text.startsWith("# DEAR ANNETE\n")).toBe(true);
  });
});
