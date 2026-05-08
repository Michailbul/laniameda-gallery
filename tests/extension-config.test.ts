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

    expect(popupScript).toContain("laniameda-galery.vercel.app");
    expect(backgroundScript).toContain("laniameda-galery.vercel.app");
    expect(popupScript).toContain("LEGACY_API_HOSTS");
    expect(backgroundScript).toContain("LEGACY_API_HOSTS");
    // The previous canonical host stays on the legacy list so old
    // configurations still get rewritten.
    expect(popupScript).toContain('"laniameda.gallery"');
    expect(backgroundScript).toContain('"laniameda.gallery"');
  });
});
