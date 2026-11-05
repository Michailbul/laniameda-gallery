import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  WORLD_PAGE_SIZE,
  type WorldPageData,
  type WorldSection,
  type WorldTile,
} from "@/components/world-page/types";

export type WorldFirstScreen = {
  world: WorldPageData;
  page: WorldTile[];
};

/**
 * A world page's first screen, fetched with the HTML: the reel's poster and
 * the first frames render before the client connects to Convex. Cached for a
 * minute per view; the page subscribes live after hydration anyway. Returns
 * null for a world that is not published; a failed read throws, so it is
 * never cached.
 */
export const loadWorldFirstScreen = unstable_cache(
  async (
    slug: string,
    side: string | undefined,
    section: WorldSection | undefined,
  ): Promise<WorldFirstScreen | null> => {
    const [world, first] = await Promise.all([
      fetchQuery(api.worldPage.getWorldPage, { slug, side }),
      fetchQuery(api.worldPage.listWorldPage, {
        slug,
        side,
        section,
        paginationOpts: { numItems: WORLD_PAGE_SIZE, cursor: null },
      }),
    ]);
    if (!world) return null;
    return { world, page: first.page };
  },
  ["world-first-screen-v1"],
  { revalidate: 60 },
);
