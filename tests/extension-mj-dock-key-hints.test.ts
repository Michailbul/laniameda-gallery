import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dock = readFileSync(new URL("../extension/moodboard-dock.js", import.meta.url), "utf8");

describe("Midjourney dock key badges", () => {
  test("only a deliberate Option hold shows them", () => {
    expect(dock).toContain("const HINT_DELAY_MS = 700;");
    expect(dock).toContain("showKeyHints(event.altKey && !event.metaKey);");
  });

  test("a click or a scroll hides them", () => {
    expect(dock).toContain('window.addEventListener("pointerdown", onPointerHideHints, true);');
    expect(dock).toContain('window.removeEventListener("pointerdown", onPointerHideHints, true);');
  });
});
