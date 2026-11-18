import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { WorldTile } from "@/components/world-page/types";

const MAX_PAGES = 60;

/**
 * Every frame of a world side's public wall, read page by page and cached for
 * five minutes, so the public page can show them in a new random order on
 * every visit without each visitor paging through Convex. The lead frames
 * (kept off the stream by the backend) are added from the page head.
 */
export const loadWorldWall = unstable_cache(
  async (slug: string, side: string | undefined): Promise<WorldTile[]> => {
    const head = await fetchQuery(api.worldPage.getWorldPage, { slug, side });
    if (!head) return [];
    const out: WorldTile[] = [];
    const seen = new Set<string>();
    const add = (tile: WorldTile) => {
      if (seen.has(tile.id)) return;
      seen.add(tile.id);
      out.push(tile);
    };
    head.lead.forEach(add);
    head.featured.forEach(add);
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page: { page: WorldTile[]; isDone: boolean; continueCursor: string } = await fetchQuery(api.worldPage.listWorldPage, {
        slug,
        side,
        paginationOpts: { numItems: 96, cursor },
      });
      page.page.forEach(add);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return out;
  },
  ["world-wall-v1"],
  { revalidate: 300 },
);

/** Fisher–Yates, a fresh order per call. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
