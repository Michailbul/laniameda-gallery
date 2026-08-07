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

    expect(popupScript).toContain("gallery.laniameda.space");
    expect(backgroundScript).toContain("gallery.laniameda.space");
    expect(popupScript).toContain("LEGACY_API_HOSTS");
    expect(backgroundScript).toContain("LEGACY_API_HOSTS");
    // Every previous canonical host stays on the legacy list so installs that
    // stored one keep working without the user re-entering the API URL.
    for (const legacyHost of [
      '"laniameda.gallery"',
      '"laniameda-galery.vercel.app"',
    ]) {
      expect(popupScript).toContain(legacyHost);
      expect(backgroundScript).toContain(legacyHost);
    }
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
    expect(contentScript).toContain("isMidjourneyJobPage");
    expect(contentScript).toContain("isMidjourneyCreateExperiencePage");
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
    expect(contentScript).toContain("hasVisibleMidjourneyCreateDetailPanel");
    expect(contentScript).toContain("Creation Actions");
    expect(contentScript).toContain("clearInjectedUi();");
    expect(contentScript).toContain("updateMidjourneyLikedNavigation");
    expect(contentScript).toContain("applyMidjourneyLikedOnlyFilter");
    expect(contentScript).toContain("getMidjourneyGenerationRowRoot");
    expect(contentScript).toContain("hasMidjourneyHistoryText");
    expect(contentScript).toContain("data-stg-mj-liked-filter-hidden");
    expect(contentScript).toContain("Liked only");
    expect(contentScript).not.toContain("MJ likes");
    expect(contentScript).not.toContain("Next liked");
    expect(contentScript).not.toContain("data-stg-mj-liked-sort");
    expect(contentScript).not.toContain('window.addEventListener("scroll", updateMidjourneyWidgetPositions');
    expect(extensionStyles).toContain(".stg-mj-quick-save");
    expect(extensionStyles).toContain('[data-stg-mj-host-prepared="1"]:hover > .stg-mj-quick-save--hover-reveal');
    expect(extensionStyles).toContain("position: absolute");
    expect(extensionStyles).toContain(".stg-mj-menu__new");
    expect(extensionStyles).toContain(".stg-mj-liked-nav");
    expect(extensionStyles).toContain('[data-stg-mj-liked-filter-hidden="1"]');
    expect(extensionStyles).not.toContain('[data-stg-mj-liked-sort="liked"]');
  });

  // Save N+1 has to open on the exact picker state save N used: the whole
  // collection set and the pillar, not just the first collection.
  test("every save surface restores the remembered save preset", () => {
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

    // One storage contract, shared by all three scripts.
    for (const script of [popupScript, backgroundScript, contentScript]) {
      expect(script).toContain('"lastFolderIds"');
    }
    expect(contentScript).toContain('"lastCollectionPillar"');
    expect(popupScript).toContain('"lastCollectionPillar"');

    // An explicit "no collection" save stores []. Reading the preset must key on
    // the array being present, not on it having entries, or the popup default
    // silently comes back.
    expect(contentScript).toContain("Array.isArray(cfg[LAST_FOLDER_IDS_KEY])");
    expect(backgroundScript).toContain("Array.isArray(cfg[LAST_FOLDER_IDS_KEY])");

    // Written on submit from both pickers, read back by both plus the two
    // one-click paths (quick Save button, context menu).
    expect(contentScript).toContain("function rememberSavePreset");
    expect(contentScript).toContain("function readSavePreset");
    expect(
      contentScript.match(/rememberSavePreset\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(
      contentScript.match(/readSavePreset\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(5);
    expect(backgroundScript).toContain("getSavePresetFolderIds");

    // The old single-id readers are gone; lastFolderId is now write-only compat.
    expect(contentScript).not.toContain("readSavedFolderIds");
    expect(contentScript).not.toContain("getDefaultSaveFolderId");
    expect(backgroundScript).not.toContain("getDefaultSaveFolderId(");

    // Changing the popup default is the one deliberate reset of the preset.
    expect(popupScript).toContain("chrome.storage.sync.remove");
    expect(popupScript).toContain("storedDefaultFolderId");
  });
});
