import { describe, expect, test } from "bun:test";
import { extractHeadings, parseLearningLine, parseLearnings, parseRef, splitRefs } from "../lib/world-doc-markdown";

describe("world doc reading helpers", () => {
  test("headings skip code fences and get unique ids", () => {
    const body = "# Title\n\n## 1. Vocabulary\n```\n## not a heading\n```\n### Film\n## Film\n";
    expect(extractHeadings(body).map((heading) => [heading.level, heading.id, heading.line])).toEqual([
      [1, "title", 0], [2, "1-vocabulary", 2], [3, "film", 6], [2, "film-2", 7],
    ]);
  });

  test("references split out of prose", () => {
    const parts = splitRefs("World bible story:px73012fgbfsk4tmz8jcynny398gkqhj (draft), face asset:j576de56h7hjhwwfj9nc88fd5h8gj388.");
    expect(parts.filter((part) => typeof part !== "string")).toEqual([
      { kind: "story", id: "px73012fgbfsk4tmz8jcynny398gkqhj" },
      { kind: "asset", id: "j576de56h7hjhwwfj9nc88fd5h8gj388" },
    ]);
    expect(parseRef("moodboard:rh705v833579ksc8ngc0k6n5898gj6d2")).toEqual({ kind: "moodboard", id: "rh705v833579ksc8ngc0k6n5898gj6d2" });
    expect(parseRef("see story:px73012fgbfsk4tmz8jcynny398gkqhj")).toBeNull();
  });

  test("a learning splits into id, date, text and the last source", () => {
    const line = "- L-014 · 2026-10-27 · Golden already makes a period street · one marker. · src: Michael, 27 Oct; docs/midjourney.md §2";
    expect(parseLearningLine(line)).toEqual({
      id: "L-014", date: "2026-10-27", text: "Golden already makes a period street · one marker.",
      source: "Michael, 27 Oct; docs/midjourney.md §2", line: 0,
    });
    const blocks = parseLearnings(`# LEARNINGS\n\nOne line per learning.\n\n${line}\n- L-015 · 2026-10-28 · No source here.`);
    expect(blocks.map((block) => block.kind)).toEqual(["prose", "learnings"]);
    expect(blocks[1].kind === "learnings" && blocks[1].items[1].source).toBeNull();
  });
});
