"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/lib/use-current-user";
import { publicModePath } from "@/lib/public-modes";
import { WorldMasonry } from "./world-masonry";
import { WorldWordmark, hasWordmark } from "./world-wordmark";
import { WorldHero } from "./world-hero";
import { useWorldOwner } from "./world-owner";
import { worldUiFont } from "./world-brand";
import {
  WORLD_PAGE_SIZE,
  WORLD_SECTIONS,
  type WorldPageData,
  type WorldSection,
  type WorldTile,
} from "./types";
import "./world-pitch.css";

const loadLightbox = () => import("./world-lightbox");
const WorldLightbox = dynamic(loadLightbox, { ssr: false });

type ViewMemory = {
  key: string;
  order: ReadonlyMap<string, number>;
  ghosts: ReadonlyMap<string, WorldTile>;
};
const emptyMemory = (key: string): ViewMemory => ({ key, order: new Map(), ghosts: new Map() });

/** Position of each tile after pushing a repeat of a recent group 8 slots on (two rows at four columns). */
const spreadGroups = (tiles: WorldTile[]) => {
  const out: WorldTile[] = [];
  const waiting: WorldTile[] = [];
  const clash = (tile: WorldTile) =>
    Boolean(tile.group) && out.slice(-8).some((placed) => placed.group === tile.group);
  for (const tile of tiles) {
    for (let i = 0; i < waiting.length; i++) {
      if (!clash(waiting[i])) out.push(...waiting.splice(i--, 1));
    }
    if (clash(tile)) waiting.push(tile);
    else out.push(tile);
  }
  out.push(...waiting);
  const position = new Map(out.map((tile, index) => [tile.id, index]));
  return tiles.map((tile) => position.get(tile.id) ?? 0);
};

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export type WorldPitchProps = {
  slug: string;
  initialSide: string;
  initialSection?: WorldSection;
  initialWorld: WorldPageData;
  initialPage: WorldTile[];
  /** admin: the owner's /w/<slug>/admin, every member with its off-page reason. */
  mode?: "public" | "admin";
};

/**
 * One world as a pitch: a full-screen opening hero with the mark, then one
 * scroll: a sticky filter bar over a wall of the world's frames, a
 * full-screen hero insert every ~18 frames. Live action / 3D and the section
 * filter switch in place; the URL follows with replaceState.
 */
export function WorldPitch({
  slug,
  initialSide,
  initialSection,
  initialWorld,
  initialPage,
  mode = "public",
}: WorldPitchProps) {
  const admin = mode === "admin";
  const [side, setSide] = useState(initialSide);
  const [section, setSection] = useState<WorldSection | undefined>(initialSection);
  const [openId, setOpenId] = useState<string | null>(null);
  const { user } = useCurrentUser();
  const ownerUserId = admin ? user?.ownerUserId : undefined;

  // The other sides subscribe once the page is idle (or the pointer reaches
  // the switch), so the switch is instant without competing with first paint.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const start = () => setWarm(true);
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(start, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(start, 2500);
    return () => window.clearTimeout(handle);
  }, []);
  const sideKeys = initialWorld.sides.map((entry) => entry.key);
  const liveKeys = sideKeys.map((key) => (warm || key === side ? key : undefined));
  const source = { slug, admin, ownerUserId };
  const worlds = useWorldsBySide(source, liveKeys);
  const world = worlds[side] ?? initialWorld;

  const allPages = usePagesBySide(source, liveKeys);
  const sectionPages = usePages(source, section ? side : undefined, section);

  // The rest of the wall: a section's own pages once they arrive; until
  // then the side's loaded frames filtered here, so a tab reacts at once.
  const sideAll = allPages[side];
  const allTiles = useMemo(() => {
    if (sideAll && sideAll.status !== "LoadingFirstPage") return sideAll.results;
    return side === initialSide && !initialSection ? initialPage : [];
  }, [sideAll, side, initialSide, initialSection, initialPage]);
  const restTiles = useMemo(() => {
    if (!section) return allTiles;
    if (sectionPages.status !== "LoadingFirstPage") return sectionPages.results;
    if (side === initialSide && section === initialSection && initialPage.length) return initialPage;
    return allTiles.filter((tile) => tile.section === section);
  }, [section, sectionPages, allTiles, side, initialSide, initialSection, initialPage]);

  // Hero inserts are the world's, not the side's: the opening one stays put.
  const inserts = useMemo(() => world.inserts ?? [], [world.inserts]);
  const opening = useMemo(
    () => inserts[0] ?? (world.hero ? { tiles: [world.hero] } : null),
    [inserts, world.hero],
  );
  const cuts = useMemo(() => inserts.slice(1), [inserts]);
  // On the public page a hero frame plays as a hero only; the owner views
  // keep it in the wall too, marked HERO.
  const insertIds = useMemo(() => {
    const ids = new Set<string>();
    for (const insert of inserts) for (const tile of insert.tiles) ids.add(tile.id);
    if (!inserts.length && world.hero) ids.add(world.hero.id);
    return ids;
  }, [inserts, world.hero]);

  const tilesRef = useRef<WorldTile[]>(initialPage);
  const insertTilesRef = useRef<WorldTile[]>([]);
  const findTile = useCallback(
    (id: string) =>
      tilesRef.current.find((tile) => tile.id === id) ??
      insertTilesRef.current.find((tile) => tile.id === id),
    [],
  );
  const openIdRef = useRef<string | null>(null);
  const owner = useWorldOwner({
    slug,
    folderId: world.folderId,
    admin,
    findTile,
    openId: useCallback(() => openIdRef.current ?? undefined, []),
    onOpenId: setOpenId,
  });
  const ownerView = owner.active;

  // Stable order while the owner curates: a frame keeps its slot when F moves
  // it into the featured list on the server, and a deleted or dropped frame
  // stays in place, greyed. A reload or a new view re-sorts.
  const viewKey = `${side}|${section ?? "all"}`;
  const [memory, setMemory] = useState<ViewMemory>(() => emptyMemory(viewKey));
  const view = memory.key === viewKey ? memory : emptyMemory(viewKey);
  const tiles = useMemo(() => {
    const featured = [...world.featured, ...world.lead].filter(
      (tile) => !section || tile.section === section,
    );
    const merged: WorldTile[] = [];
    const seen = new Set<string>();
    for (const tile of [...featured, ...restTiles]) {
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      merged.push(tile);
    }
    for (const id of [...owner.archivedIds, ...owner.droppedIds]) {
      const ghost = view.ghosts.get(id);
      if (ghost && !seen.has(id)) merged.push(ghost);
    }
    const rank = (tile: WorldTile, index: number) =>
      view.order.get(tile.id) ?? 1e9 + spread[index];
    // Takes of one job never sit side by side: a repeat waits a few frames.
    const spread = spreadGroups(merged);
    return merged
      .map((tile, index) => ({ tile, rank: rank(tile, index) }))
      .filter((entry) => ownerView || !insertIds.has(entry.tile.id))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.tile);
  }, [world.featured, world.lead, restTiles, section, owner.archivedIds, owner.droppedIds, view, insertIds, ownerView]);
  // Remember new frames' slots (React's adjust-state-while-rendering pattern:
  // it settles on the next pass, once every frame has a slot).
  if (memory.key !== viewKey || !tiles.every((tile) => view.order.has(tile.id))) {
    const order = new Map(view.order);
    const ghosts = new Map(view.ghosts);
    for (const tile of tiles) {
      if (!order.has(tile.id)) order.set(tile.id, order.size);
      ghosts.set(tile.id, tile);
    }
    setMemory({ key: viewKey, order, ghosts });
  }

  const status = section ? sectionPages.status : sideAll?.status;
  const loadMore = section ? sectionPages.loadMore : sideAll?.loadMore;
  const onNearEnd = useCallback(() => {
    if (status === "CanLoadMore") loadMore?.(WORLD_PAGE_SIZE);
  }, [status, loadMore]);

  // A filtered view can come back sparse; pull a few more pages to fill the
  // screen, then leave the rest to scrolling.
  const autoLoads = useRef({ key: "", count: 0 });
  useEffect(() => {
    if (!section || status !== "CanLoadMore" || restTiles.length >= WORLD_PAGE_SIZE / 2) return;
    const key = `${side}|${section}`;
    if (autoLoads.current.key !== key) autoLoads.current = { key, count: 0 };
    if (autoLoads.current.count >= 20) return;
    autoLoads.current.count += 1;
    loadMore?.(WORLD_PAGE_SIZE);
  }, [side, section, status, restTiles.length, loadMore]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (side === initialWorld.sides[0]?.key) url.searchParams.delete("side");
    else url.searchParams.set("side", side);
    if (section) url.searchParams.set("view", section);
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  }, [side, section, initialWorld.sides]);

  // The lightbox walks the wall, then the hero frames.
  const lightboxTiles = useMemo(() => {
    const seen = new Set(tiles.map((tile) => tile.id));
    const extra = inserts.flatMap((insert) => insert.tiles).filter((tile) => !seen.has(tile.id));
    return [...tiles, ...extra];
  }, [tiles, inserts]);
  const openIndex = openId ? lightboxTiles.findIndex((tile) => tile.id === openId) : -1;

  useEffect(() => {
    tilesRef.current = tiles;
    insertTilesRef.current = inserts.flatMap((insert) => insert.tiles);
    openIdRef.current = openId;
  }, [tiles, inserts, openId]);

  const intent = useCallback(() => void loadLightbox(), []);
  const onOpen = useCallback((index: number) => setOpenId(tilesRef.current[index]?.id ?? null), []);
  const wallTop = useRef<HTMLElement>(null);
  const switchView = (next: { side?: string; section?: WorldSection | undefined }) => {
    if (next.side !== undefined) setSide(next.side);
    if ("section" in next) setSection(next.section);
    const top = wallTop.current;
    if (top && top.getBoundingClientRect().top < 0) {
      window.scrollTo({ top: top.offsetTop, behavior: "instant" as ScrollBehavior });
    }
  };

  const done = status === "Exhausted" || (status === undefined && !sideAll);
  const past = usePastHero();

  return (
    <main className={`wp ${worldUiFont.variable}`} data-past={past || undefined} data-admin={admin || undefined}>
      <div className="wp-grain" aria-hidden />
      <header className="wp-top">
        <a
          className="wp-top-mark"
          href="#top"
          aria-label={`${world.name}, back to the top`}
          tabIndex={past ? 0 : -1}
          onClick={(event) => {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <WorldWordmark slug={slug} name={world.name} variant="line" />
        </a>
        <a
          className="wp-top-link"
          href="#wall"
          tabIndex={past ? -1 : 0}
          onClick={(event) => {
            event.preventDefault();
            const top = wallTop.current;
            if (top) window.scrollTo({ top: top.offsetTop, behavior: "smooth" });
          }}
        >
          <ArchiveGlyph />
          <span>The archive</span>
        </a>
      </header>

      <WorldHero slug={slug} name={world.name} opening={opening} owner={ownerView ? owner.state : undefined} />

      <section className="wp-wall" id="wall" ref={wallTop} aria-label={`${world.name} frames`}>
        <nav className="wp-bar" aria-label="World view">
          <div className="wp-bar-group" role="tablist" aria-label="Show">
            {[{ key: undefined, label: "All" }, ...WORLD_SECTIONS].map((entry) => (
              <button
                key={entry.label}
                type="button"
                role="tab"
                aria-selected={section === entry.key}
                onClick={() => switchView({ section: entry.key })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {world.sides.length > 1 && (
            <>
              <span className="wp-bar-sep" aria-hidden />
              <div
                className="wp-bar-group"
                role="group"
                aria-label="Medium"
                onPointerEnter={() => setWarm(true)}
                onFocus={() => setWarm(true)}
              >
                {world.sides.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    aria-pressed={entry.key === side}
                    onClick={() => switchView({ side: entry.key })}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </nav>

        {tiles.length === 0 ? (
          <p className="wp-empty" role="status">
            {done ? "Nothing here yet" : <span className="wp-pulse" aria-label="Loading" />}
          </p>
        ) : (
          <WorldMasonry
            key={viewKey}
            tiles={tiles}
            inserts={cuts}
            complete={done}
            onOpen={onOpen}
            onNearEnd={onNearEnd}
            onIntent={intent}
            owner={ownerView ? owner.state : undefined}
            onRestore={ownerView ? owner.restore : undefined}
          />
        )}
      </section>

      {done && (
        <footer className="wp-end">
          {hasWordmark(slug) && <WorldWordmark slug={slug} name={world.name} variant="line" className="wp-end-mark" />}
          <Link href={publicModePath("worlds")}>All worlds</Link>
        </footer>
      )}

      {openIndex >= 0 && (
        <WorldLightbox
          tiles={lightboxTiles}
          index={openIndex}
          onIndex={(index) => setOpenId(lightboxTiles[index]?.id ?? null)}
          onClose={() => setOpenId(null)}
        />
      )}

      {owner.layer}
    </main>
  );
}

/** A hairline index glyph: four small frames, the archive's wall in miniature. */
function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden width="13" height="13">
      <rect x="0.5" y="0.5" width="5" height="7" />
      <rect x="8.5" y="0.5" width="5" height="4" />
      <rect x="0.5" y="10.5" width="5" height="3" />
      <rect x="8.5" y="7.5" width="5" height="6" />
    </svg>
  );
}

/** True once the opening hero has mostly scrolled away: the small mark takes over. */
function usePastHero() {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setPast(window.scrollY > window.innerHeight * 0.9);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return past;
}

// ------------------------------------------------------------------- data

type Source = { slug: string; admin: boolean; ownerUserId?: string };

/** One side's page head: the public read, or the owner's admin read. One of the two is skipped. */
function useWorld(source: Source, side: string | undefined) {
  const { slug, admin, ownerUserId } = source;
  const pub = useQuery(api.worldPage.getWorldPage, side && !admin ? { slug, side } : "skip");
  const own = useQuery(
    api.worldPage.getWorldPageAdmin,
    side && admin && ownerUserId ? { ownerUserId, slug, side } : "skip",
  );
  return admin ? own : pub;
}

function useWorldsBySide(source: Source, sides: Array<string | undefined>) {
  // Three sides at most in practice; hooks run in a fixed order per side list.
  const a = useWorld(source, sides[0]);
  const b = useWorld(source, sides[1]);
  const c = useWorld(source, sides[2]);
  return useMemo(() => {
    const out: Record<string, WorldPageData> = {};
    [a, b, c].forEach((entry, i) => {
      const key = sides[i];
      if (entry && key) out[key] = entry;
    });
    return out;
  }, [a, b, c, sides]);
}

function usePages(source: Source, side: string | undefined, section?: WorldSection) {
  const { slug, admin, ownerUserId } = source;
  const opts = { initialNumItems: WORLD_PAGE_SIZE };
  const pub = usePaginatedQuery(
    api.worldPage.listWorldPage,
    side && !admin ? { slug, side, ...(section ? { section } : {}) } : "skip",
    opts,
  );
  const own = usePaginatedQuery(
    api.worldPage.listWorldPageAdmin,
    side && admin && ownerUserId ? { ownerUserId, slug, side, ...(section ? { section } : {}) } : "skip",
    opts,
  );
  return admin ? own : pub;
}

function usePagesBySide(source: Source, sides: Array<string | undefined>) {
  const a = usePages(source, sides[0]);
  const b = usePages(source, sides[1]);
  const c = usePages(source, sides[2]);
  return useMemo(() => {
    const out: Record<string, typeof a> = {};
    [a, b, c].forEach((entry, i) => {
      const key = sides[i];
      if (key) out[key] = entry;
    });
    return out;
  }, [a, b, c, sides]);
}
