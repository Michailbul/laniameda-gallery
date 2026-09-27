// The gallery card thumbnail contract, shared by the grid (which decides
// whether a tile can show the thumb) and the backend (which makes thumbs and
// backfills the ones that fall short).

/** Thumbs are fit inside this box, never upscaled. A 16:9 frame lands at
 *  1440×810, a square at 960×960, a 9:16 portrait at 540×960 — each tall
 *  enough for a justified row on a 2x screen. */
export const CARD_THUMB_MAX_WIDTH = 1440;
export const CARD_THUMB_MAX_HEIGHT = 960;
export const CARD_THUMB_WEBP_QUALITY = 78;

/** A thumb at least this wide, or this tall, reads sharp on a retina tile. */
const SHARP_MIN_WIDTH = 800;
const SHARP_MIN_HEIGHT = 720;

/** What the card encoder writes. A thumb of any other type predates it: the
 *  old quality-100 JPEG and PNG thumbs ran to a median of 500 KB, where a
 *  WebP card thumb is usually 20–150 KB. */
export const CARD_THUMB_CONTENT_TYPE = "image/webp";

type ThumbFields = {
  width?: number | null;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
};

/** True when the grid can show the thumb instead of the original. */
export const isCardThumbSharp = ({ width, thumbWidth, thumbHeight }: ThumbFields) => {
  if (!thumbWidth || !thumbHeight) return false;
  // The thumb already carries every pixel the original has.
  if (width && thumbWidth >= width) return true;
  return thumbWidth >= SHARP_MIN_WIDTH || thumbHeight >= SHARP_MIN_HEIGHT;
};

/** True when an image asset's card thumb is missing, too soft, or was not
 *  made by the card encoder. `thumbContentType` is the stored thumb's type. */
export const needsCardThumb = (
  asset: ThumbFields & {
    thumbR2Key?: string | null;
    thumbStorageId?: string | null;
  },
  thumbContentType: string | null | undefined,
) => {
  if (!asset.thumbR2Key && !asset.thumbStorageId) return true;
  if (!isCardThumbSharp(asset)) return true;
  return thumbContentType !== CARD_THUMB_CONTENT_TYPE;
};
