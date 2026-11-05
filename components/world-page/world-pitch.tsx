"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/use-current-user";
import { publicModePath } from "@/lib/public-modes";
import { ASSET_HOTKEYS, assetHotkeyOf } from "@/lib/asset-hotkeys";
import { WorldMasonry, type MasonryOwnerState } from "./world-masonry";
import { WorldWordmark, hasWordmark } from "./world-wordmark";
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
};

/**
 * One world as a pitch: the reel full-bleed, the mark, then nothing but the
 * world's frames. Live action / 3D and the section filter switch in place;
 * the URL follows with replaceState so a copied link opens the same view.
 */
export function WorldPitch({
  slug,
  initialSide,
  initialSection,
  initialWorld,
  initialPage,
}: WorldPitchProps) {
  const [side, setSide] = useState(initialSide);
  const [section, setSection] = useState<WorldSection | undefined>(initialSection);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
  const worlds = useWorldsBySide(slug, liveKeys);
  const world = worlds[side] ?? (side === initialWorld.side ? initialWorld : null) ?? initialWorld;

  const allPages = usePagesBySide(slug, liveKeys);
  const sectionPages = usePaginatedQuery(
    api.worldPage.listWorldPage,
    section ? { slug, side, section } : "skip",
    { initialNumItems: WORLD_PAGE_SIZE },
  );

  // The rest of the grid: a section's own pages once they arrive; until
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

  const tilesRef = useRef<WorldTile[]>(initialPage);
  const openRef = useRef<number | null>(null);
  const owner = useOwnerControls(tilesRef, openRef);

  // Stable order while the owner curates: a frame keeps its slot when F moves
  // it into the featured list on the server, and an archived frame stays in
  // place, greyed. A reload or a new view re-sorts.
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
    for (const id of owner.archivedIds) {
      const ghost = view.ghosts.get(id);
      if (ghost && !seen.has(id)) merged.push(ghost);
    }
    const heroId = initialWorld.hero?.id;
    const rank = (tile: WorldTile, index: number) =>
      view.order.get(tile.id) ?? 1e9 + spread[index];
    // Takes of one job never sit side by side: a repeat waits a few frames.
    const spread = spreadGroups(merged);
    return merged
      .map((tile, index) => ({ tile, rank: rank(tile, index) }))
      .filter((entry) => entry.tile.id !== heroId)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.tile);
  }, [world.featured, world.lead, restTiles, section, owner.archivedIds, view, initialWorld.hero?.id]);
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

  useEffect(() => {
    tilesRef.current = tiles;
    openRef.current = openIndex;
  }, [tiles, openIndex]);

  const intent = useCallback(() => void loadLightbox(), []);
  const gridTop = useRef<HTMLDivElement>(null);
  const switchView = (next: { side?: string; section?: WorldSection | undefined }) => {
    if (next.side !== undefined) setSide(next.side);
    if ("section" in next) setSection(next.section);
    const top = gridTop.current;
    if (top && top.getBoundingClientRect().top < 0) {
      window.scrollTo({ top: top.offsetTop, behavior: "instant" as ScrollBehavior });
    }
  };

  const done = status === "Exhausted" || (status === undefined && !sideAll);

  return (
    <main className="wp">
      <Hero slug={slug} world={initialWorld} />

      <div ref={gridTop} />
      <nav className="wp-bar" aria-label="World view">
        {hasWordmark(slug) ? (
          <a href="#top" aria-label={`${world.name}, back to the reel`} onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <WorldWordmark slug={slug} name={world.name} className="wp-bar-mark" as="div" small />
          </a>
        ) : (
          <span className="wp-bar-mark-text wp-mono">{world.name}</span>
        )}
        <div className="wp-tabs" role="tablist" aria-label="Show">
          {[{ key: undefined, label: "All" }, ...WORLD_SECTIONS].map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="tab"
              className="wp-tab wp-mono"
              aria-selected={section === entry.key}
              onClick={() => switchView({ section: entry.key })}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {world.sides.length > 1 ? (
          <div
            className="wp-switch wp-mono"
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
        ) : (
          <span />
        )}
      </nav>

      <section className="wp-grid-wrap" aria-label={`${world.name} frames`}>
        {tiles.length === 0 ? (
          <p className="wp-empty wp-mono" role="status">
            {done ? "Nothing here yet" : <span className="wp-lozenge wp-pulse" aria-label="Loading" />}
          </p>
        ) : (
          <WorldMasonry
            key={viewKey}
            tiles={tiles}
            onOpen={setOpenIndex}
            onNearEnd={onNearEnd}
            onIntent={intent}
            owner={owner.active ? owner.masonryState : undefined}
            onRestore={owner.active ? owner.restore : undefined}
          />
        )}
      </section>

      {done && (
        <footer className="wp-end wp-mono">
          {hasWordmark(slug) && <WorldWordmark slug={slug} name={world.name} as="div" />}
          <Link href={publicModePath("worlds")}>All worlds</Link>
        </footer>
      )}

      {openIndex !== null && (
        <WorldLightbox
          tiles={tiles}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}

      {owner.active && (
        <div className="wp-owner wp-mono" aria-label="Owner keys">
          <span><kbd>F</kbd>Feature</span>
          <span><kbd>D</kbd>Archive</span>
          <Link href={`/w/${slug}`}>Vault</Link>
        </div>
      )}
      {owner.notice && <div className="wp-toast wp-mono" role="status">{owner.notice}</div>}
    </main>
  );
}

// ------------------------------------------------------------------- hero

function Hero({ slug, world }: { slug: string; world: WorldPageData }) {
  const hero = world.hero;
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | undefined>();
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);

  // The poster is the first paint; the film is fetched once the page has
  // settled, so it never competes with the poster or with hydration. Phones
  // wait longer (the reel is a large original and decoding it on a slow CPU
  // blocks input), and Save-Data keeps the poster only.
  useEffect(() => {
    if (hero?.kind !== "video") return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? "")) return;
    const phone = window.matchMedia("(max-width: 760px), (hover: none)").matches;
    let timer = 0;
    let idleHandle = 0;
    const w = window as IdleWindow;
    const start = () => setSrc(hero.full);
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (typeof w.requestIdleCallback === "function") {
          idleHandle = w.requestIdleCallback(start, { timeout: 2000 });
        } else start();
      }, phone ? 3500 : 200);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      window.clearTimeout(timer);
      if (idleHandle) w.cancelIdleCallback?.(idleHandle);
    };
  }, [hero]);

  // Plays only while the hero is on screen; scrolling the grid costs no decode.
  const [onScreen, setOnScreen] = useState(true);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = header.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = video.current;
    if (!node || !src) return;
    node.muted = !sound;
    if (onScreen) void node.play().catch(() => {});
    else node.pause();
  }, [src, sound, onScreen]);

  return (
    <header className="wp-hero" id="top" ref={header} data-offscreen={!onScreen || undefined}>
      <div className="wp-hero-media" aria-hidden>
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element -- the LCP poster, preloaded by the server with its srcset
          <img
            src={hero.src}
            srcSet={hero.srcSet}
            sizes="100vw"
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        )}
        {hero?.kind === "video" && (
          <video
            ref={video}
            src={src}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            data-playing={playing || undefined}
            onPlaying={() => setPlaying(true)}
          />
        )}
      </div>
      <div className="wp-hero-shade" />
      <div className="wp-grain" aria-hidden />

      <div className="wp-topline wp-mono">
        <Link href={publicModePath("worlds")}>Laniameda · Worlds</Link>
        {hero?.kind === "video" && (
          <button
            type="button"
            className="wp-sound wp-mono"
            aria-pressed={sound}
            onClick={() => setSound((value) => !value)}
          >
            <span className="wp-bars" aria-hidden><i /><i /><i /><i /></span>
            {sound ? "Sound on" : "Sound off"}
          </button>
        )}
      </div>

      <div className="wp-title">
        <div className="wp-rise">
          <WorldWordmark
            slug={slug}
            name={world.name}
            className="wp-wordmark"
            textClassName="wp-wordmark-text"
          />
        </div>
        <div className="wp-rule wp-rise-2" aria-hidden>
          <span className="wp-lozenge" />
        </div>
        <p className="wp-credit wp-mono wp-rise-3" style={{ margin: 0 }}>
          A world by <b>Misha Buloichyk</b>
        </p>
      </div>
      <a
        className="wp-enter wp-mono"
        href="#frames"
        onClick={(event) => {
          event.preventDefault();
          window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
        }}
      >
        Enter
      </a>
    </header>
  );
}

// ------------------------------------------------------------------- data

function useWorldsBySide(slug: string, sides: Array<string | undefined>) {
  // Two sides at most in practice; hooks run in a fixed order per side list.
  const a = useQuery(api.worldPage.getWorldPage, sides[0] ? { slug, side: sides[0] } : "skip");
  const b = useQuery(api.worldPage.getWorldPage, sides[1] ? { slug, side: sides[1] } : "skip");
  const c = useQuery(api.worldPage.getWorldPage, sides[2] ? { slug, side: sides[2] } : "skip");
  return useMemo(() => {
    const out: Record<string, WorldPageData> = {};
    [a, b, c].forEach((entry, i) => {
      const key = sides[i];
      if (entry && key) out[key] = entry;
    });
    return out;
  }, [a, b, c, sides]);
}

function usePagesBySide(slug: string, sides: Array<string | undefined>) {
  const opts = { initialNumItems: WORLD_PAGE_SIZE };
  const a = usePaginatedQuery(api.worldPage.listWorldPage, sides[0] ? { slug, side: sides[0] } : "skip", opts);
  const b = usePaginatedQuery(api.worldPage.listWorldPage, sides[1] ? { slug, side: sides[1] } : "skip", opts);
  const c = usePaginatedQuery(api.worldPage.listWorldPage, sides[2] ? { slug, side: sides[2] } : "skip", opts);
  return useMemo(() => {
    const out: Record<string, typeof a> = {};
    [a, b, c].forEach((entry, i) => {
      const key = sides[i];
      if (key) out[key] = entry;
    });
    return out;
  }, [a, b, c, sides]);
}

// ------------------------------------------------------------------- owner

declare global {
  interface Window {
    /** Keypress-to-paint times of owner hotkeys on this page, in ms. */
    __worldPageKeyMs?: number[];
  }
}

/**
 * F and D on the hovered frame (or the one open in the lightbox), for the
 * signed-in owner only. Both paint before the server answers: F drops the gold
 * corner on the frame, D greys it out in place; double-click restores.
 */
function useOwnerControls(
  tilesRef: React.RefObject<WorldTile[]>,
  openRef: React.RefObject<number | null>,
) {
  const { user } = useCurrentUser();
  const { isAuthenticated } = useConvexAuth();
  const ownerUserId = user?.ownerUserId;
  const active = Boolean(ownerUserId && isAuthenticated);

  const setStarred = useMutation(api.assets.setAssetStarred);
  const archive = useMutation(api.assetReview.archive);
  const restoreMutation = useMutation(api.assetReview.restore);

  const [featuredOverride, setFeaturedOverride] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const overrideRef = useRef(featuredOverride);
  const archivedRef = useRef(archivedIds);
  useEffect(() => {
    overrideRef.current = featuredOverride;
    archivedRef.current = archivedIds;
  }, [featuredOverride, archivedIds]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const restore = useCallback(
    (id: string) => {
      if (!ownerUserId) return;
      setArchivedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void restoreMutation({ ownerUserId, assetId: id as Id<"assets"> })
        .then(() => setNotice("Restored"))
        .catch(() => setNotice("Could not restore"));
    },
    [ownerUserId, restoreMutation],
  );

  const masonryState = useMemo<MasonryOwnerState>(
    () => ({
      featured: (id) =>
        featuredOverride.get(id) ??
        tilesRef.current?.find((tile) => tile.id === id)?.featured ??
        false,
      archived: (id) => archivedIds.has(id),
      flashId,
    }),
    [featuredOverride, archivedIds, flashId, tilesRef],
  );

  useEffect(() => {
    if (!active || !ownerUserId) return;
    let pointer: { x: number; y: number } | null = null;
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const markPaint = (startedAt: number) =>
      requestAnimationFrame(() => {
        const ms = performance.now() - startedAt;
        (window.__worldPageKeyMs ??= []).push(Math.round(ms * 10) / 10);
      });
    const keydown = (event: KeyboardEvent) => {
      const key = assetHotkeyOf(event);
      if (key !== ASSET_HOTKEYS.feature && key !== ASSET_HOTKEYS.archive) return;
      const startedAt = performance.now();
      const open = openRef.current;
      const tile =
        open !== null && open !== undefined
          ? tilesRef.current?.[open]
          : undefined;
      const id =
        tile?.id ??
        (pointer
          ? document
              .elementFromPoint(pointer.x, pointer.y)
              ?.closest<HTMLElement>("[data-wp-id]")?.dataset.wpId
          : undefined);
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setFlashId(id);
      window.setTimeout(() => setFlashId((current) => (current === id ? null : current)), 600);

      if (key === ASSET_HOTKEYS.feature) {
        const was =
          overrideRef.current.get(id) ??
          tilesRef.current?.find((entry) => entry.id === id)?.featured ??
          false;
        const next = !was;
        // The override stays: the frame keeps its slot this session.
        overrideRef.current = new Map(overrideRef.current).set(id, next);
        setFeaturedOverride(overrideRef.current);
        markPaint(startedAt);
        void setStarred({ ownerUserId, assetId: id as Id<"assets">, starred: next })
          .then(() => setNotice(next ? "Featured · leads the page" : "Unfeatured"))
          .catch(() => {
            overrideRef.current = new Map(overrideRef.current).set(id, was);
            setFeaturedOverride(overrideRef.current);
            setNotice("Could not feature");
          });
      } else {
        if (archivedRef.current.has(id)) return;
        archivedRef.current = new Set(archivedRef.current).add(id);
        setArchivedIds(archivedRef.current);
        markPaint(startedAt);
        void archive({ ownerUserId, assetId: id as Id<"assets"> })
          .then(() => setNotice("Archived · deletes in 10 min · double-click to restore"))
          .catch(() => {
            const copy = new Set(archivedRef.current);
            copy.delete(id);
            archivedRef.current = copy;
            setArchivedIds(copy);
            setNotice("Could not archive");
          });
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [active, ownerUserId, setStarred, archive, tilesRef, openRef]);

  return { active, masonryState, archivedIds, restore, notice };
}
