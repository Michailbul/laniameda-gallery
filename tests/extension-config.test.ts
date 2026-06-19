import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("extension endpoint defaults", () => {
  test("popup and background use the canonical gallery domain", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
    ) as { permissions?: string[] };
    const popupScript = readFileSync(
      new URL("../extension/popup.js", import.meta.url),
      "utf8",
    );
    const backgroundScript = readFileSync(
      new URL("../extension/background.js", import.meta.url),
      "utf8",
    );
    const contentScript = readFileSync(
      new URL("../extension/content.js", import.meta.url),
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
    expect(popupScript).toContain("DEFAULT_FOLDER_ID_KEY");
    expect(manifest.permissions).toContain("contextMenus");
    expect(backgroundScript).toContain("SAVE_IMAGE_CONTEXT_MENU_ID");
    expect(backgroundScript).toContain('contexts: ["image"]');
    expect(backgroundScript).toContain("Save to laniameda");
    expect(backgroundScript).toContain("saveImageFromContextMenu");
    expect(backgroundScript).toContain("contextMenus.onShown");
    expect(contentScript).toContain("handleContextMenuImageSave");
    expect(contentScript).toContain("stg-context-toast");
    expect(contentScript).toContain("stg-collection-grid");
    expect(contentScript).toContain("stg-collection-card");
    expect(contentScript).not.toContain("stg-popover__select--collection");
    expect(contentScript).toContain("isMidjourneyImaginePage");
    expect(contentScript).toContain("stg-mj-quick-save--centered");
  });
});
