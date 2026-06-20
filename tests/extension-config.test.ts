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
    const extensionStyles = readFileSync(
      new URL("../extension/styles.css", import.meta.url),
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
    expect(backgroundScript).toContain("folderIds");
    expect(contentScript).toContain("handleContextMenuImageSave");
    expect(contentScript).toContain("stg-context-toast");
    expect(contentScript).toContain("stg-collection-grid");
    expect(contentScript).toContain("stg-collection-card");
    expect(contentScript).toContain("aria-multiselectable");
    expect(contentScript).toContain("folderIds");
    expect(contentScript).toContain("createMidjourneyCollectionFromMenu");
    expect(contentScript).toContain("stg-mj-menu__item--create");
    expect(contentScript).toContain("stg-mj-menu__new-input");
    expect(contentScript).not.toContain("stg-popover__select--collection");
    expect(contentScript).toContain("isMidjourneyImaginePage");
    expect(contentScript).toContain("stg-mj-quick-save--centered");
    expect(contentScript).toContain("stg-mj-quick-save--hover-reveal");
    expect(contentScript).toContain("stg-mj-quick-save--menu-open");
    expect(contentScript).toContain("getMidjourneyWidgetHost");
    expect(contentScript).toContain("PAGE_CONTROL_SELECTOR");
    expect(contentScript).toContain("positionSaveControlAvoidingPageUi");
    expect(contentScript).toContain("getNearbyPageControlRects");
    expect(contentScript).toContain("PAGE_CONTROL_CLEARANCE");
    expect(contentScript).toContain("dataset.stgPlacement");
    expect(contentScript).toContain("isMidjourneyFullSizeViewerOpen");
    expect(contentScript).toContain("suppressMidjourneySaveUiForViewer");
    expect(contentScript).toContain("hasVisibleMidjourneyViewerCloseControl");
    expect(contentScript).toContain("clearInjectedUi();");
    expect(contentScript).not.toContain('window.addEventListener("scroll", updateMidjourneyWidgetPositions');
    expect(extensionStyles).toContain(".stg-mj-quick-save");
    expect(extensionStyles).toContain('[data-stg-mj-host-prepared="1"]:hover > .stg-mj-quick-save--hover-reveal');
    expect(extensionStyles).toContain("position: absolute");
    expect(extensionStyles).toContain(".stg-mj-menu__new");
  });
});
