// Collection names can already classify an asset. Keep this tiny shared
// helper available to both the side panel and the background shortcut so the
// extension never asks for Character twice (tag + Characters collection).
(function (root) {
  "use strict";

  const TYPE_BY_COLLECTION_KEY = {
    character: "character",
    characters: "character",
    location: "location",
    locations: "location",
    scene: "scene",
    scenes: "scene",
    still: "scene",
    stills: "scene",
  };

  const normalize = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^#+/, "");

  const assetTypeTagForCollectionName = (name) =>
    TYPE_BY_COLLECTION_KEY[normalize(name)] || "";

  const resolveFolderAssetTypeTag = (folderId, folders) => {
    const normalizedId = String(folderId || "").trim();
    if (!normalizedId || !Array.isArray(folders)) return "";
    const folder = folders.find(
      (entry) => String(entry?.id || entry?._id || "").trim() === normalizedId,
    );
    return assetTypeTagForCollectionName(folder?.name);
  };

  const applyImpliedAssetTypeTag = (tagNames, impliedTag) => {
    const implied = normalize(impliedTag);
    const values = Array.isArray(tagNames) ? tagNames : [];
    if (!implied) return values.slice();
    return [
      ...values.filter((tagName) => !TYPE_BY_COLLECTION_KEY[normalize(tagName)]),
      implied,
    ];
  };

  root.SaveToGalleryCollectionClassification = {
    applyImpliedAssetTypeTag,
    assetTypeTagForCollectionName,
    resolveFolderAssetTypeTag,
  };
})(globalThis);
