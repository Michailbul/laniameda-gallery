import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("extension endpoint defaults", () => {
  test("popup and background use the canonical gallery domain", () => {
    const popupScript = readFileSync(
      new URL("../extension/popup.js", import.meta.url),
      "utf8",
    );
    const backgroundScript = readFileSync(
      new URL("../extension/background.js", import.meta.url),
      "utf8",
    );

    expect(popupScript).toContain("https://laniameda.gallery");
    expect(backgroundScript).toContain("https://laniameda.gallery");
    expect(popupScript).toContain("LEGACY_API_HOSTS");
    expect(backgroundScript).toContain("LEGACY_API_HOSTS");
  });
});
