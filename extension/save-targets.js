// Keys bound in Chrome (Mac): Cmd+Shift+D world, Cmd+Shift+L location, Cmd+Shift+P scene, Cmd+Shift+M comment.
// Where a Midjourney hotkey files an image. Dear Annete is a world root,
// not a shelf the user has to pick each time.
(function registerSaveTargets(root) {
  "use strict";

  const DEAR_ANNETE_WORLD_KEY = "dear-annete";
  const QUICK_SAVES = {
    world: { tagNames: [], label: "Dear Annete" },
    location: { tagNames: ["location"], label: "Dear Annete · location" },
    scene: { tagNames: ["scene"], label: "Dear Annete · scene" },
  };

  function worldIdFromList(worlds) {
    const match = (Array.isArray(worlds) ? worlds : []).find(
      (world) => world && world.key === DEAR_ANNETE_WORLD_KEY,
    );
    return match ? String(match.worldId || "").trim() : "";
  }

  function buildQuickSave(kind, worldId) {
    const spec = QUICK_SAVES[kind];
    if (!spec) throw new Error("Unknown save.");
    const id = String(worldId || "").trim();
    if (!id) throw new Error("Dear Annete world was not found.");
    return {
      folderId: id,
      folderIds: [id],
      tagNames: spec.tagNames.slice(),
      label: spec.label,
    };
  }

  root.SaveToGallerySaveTargets = {
    DEAR_ANNETE_WORLD_KEY,
    buildQuickSave,
    worldIdFromList,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
