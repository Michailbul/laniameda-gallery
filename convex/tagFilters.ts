// Named tag filters shared by browse (assets:listGalleryAssets) and semantic
// search. Pure: no Convex runtime imports.

export type PieceType = "character" | "location" | "scene" | "inspiration";
export type Medium = "animation" | "live-action";

// Canonical tag keys that mark each piece type. Plural and "still" spellings
// count, matching lib/collection-sections.ts.
export const PIECE_TYPE_KEYS: Record<PieceType, string[]> = {
  character: ["character", "characters"],
  location: ["location", "locations"],
  scene: ["scene", "scenes", "still", "stills"],
  inspiration: ["inspiration", "inspirations"],
};

// lib/medium.ts: tagged "animation" = Animation; everything else = Live action.
export const ANIMATION_TAG_KEY = "animation";
