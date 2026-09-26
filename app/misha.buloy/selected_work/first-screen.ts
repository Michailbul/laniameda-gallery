import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { PublicMode } from "@/lib/public-modes";
import {
  assetThumb,
  type FirstScreenData,
  type ShowcaseAsset,
} from "@/components/showcase/types";

// How many card thumbnails to start downloading with the HTML, per mode:
// Featured and Worlds lay out two or three large cards a row, Browse four or
// five small ones.
const HINTED_THUMBS: Record<PublicMode, number> = {
  featured: 6,
  worlds: 6,
  browse: 10,
};

// Browse's live query pages 72 at a time; the server hands over enough for
// the first screens and the live page takes over in the same order.
const BROWSE_FIRST_ITEMS = 16;

/**
 * The first screen of a public view, fetched on the server with the HTML: the
 * data the grid renders at hydration, and the card thumbnails the page hints
 * into <head> so they download alongside the HTML. Without it, tiles wait for
 * the client to boot, connect to Convex and run the same query. Returns
 * nothing on failure: a missing first screen costs speed, never the page.
 */
export async function loadFirstScreen(
  mode: PublicMode,
): Promise<{ data: FirstScreenData; thumbs: string[] }> {
  try {
    if (mode === "browse") {
      const firstPage = await fetchQuery(api.assets.listPublicGalleryAssetsPage, {
        paginationOpts: { numItems: BROWSE_FIRST_ITEMS, cursor: null },
      });
      const browseAssets = firstPage.page as ShowcaseAsset[];
      return {
        data: { browseAssets },
        thumbs: hintedThumbs(mode, browseAssets),
      };
    }
    const home = await fetchQuery(api.showcase.getShowcaseHome, {});
    if (mode === "worlds") {
      return {
        data: { worlds: home.worlds },
        thumbs: hintedThumbs(
          mode,
          home.worlds.map((world) => world.cover),
        ),
      };
    }
    return {
      data: { featuredReel: home.featuredReel },
      thumbs: hintedThumbs(
        mode,
        home.featuredReel.map((entry) => entry.asset),
      ),
    };
  } catch (error) {
    console.warn("First screen skipped:", error);
    return { data: {}, thumbs: [] };
  }
}

const hintedThumbs = (
  mode: PublicMode,
  assets: Array<{ url?: string; thumbUrl?: string } | undefined>,
) =>
  assets
    .slice(0, HINTED_THUMBS[mode])
    .map((asset) => (asset ? assetThumb(asset) : undefined))
    .filter((url): url is string => Boolean(url));
