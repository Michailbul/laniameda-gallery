"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, InboxGate } from "@/components/inbox/inbox-ui";
import type { EditCompare } from "@/components/gallery/before-after-wipe";
import type { MadeWith } from "@/convex/styleFrames";
import { buildGridImageAttrs } from "@/lib/grid-image";
import { galleryRoutePath, worldStylesPath } from "@/lib/gallery-routes";
import { MOSAIC_COVERS, MOSAIC_CSS, StyleCaption, StyleMosaic, framesLabel, orderMedia } from "./style-mosaic";

// The styles page of a world's universe (/w/<world>/styles): every style as a
// carousel of mosaic covers across the top, then the chosen style's frames as
// big bare masonry over the full width. Prompt, recipe and frame details live
// only in the open view, beside the full-resolution frame. Keys act on the
// hovered frame or the open one (board-building-blocks key map): 1 like,
// ⇧1 super like, 2 off this style, S style, M collection, B storybook,
// E edit in place, C comment, O open, I copy id.

const EditInPlace = dynamic(() => import("@/components/gallery/edit-in-place").then((m) => m.EditInPlace), { ssr: false });
const BeforeAfterWipe = dynamic(() => import("@/components/gallery/before-after-wipe").then((m) => m.BeforeAfterWipe), { ssr: false });
const AssetComments = dynamic(() => import("@/components/gallery/asset-comments").then((m) => m.AssetComments), { ssr: false });

type Listing = FunctionReturnType<typeof api.worldStyles.listStyles>;
type Card = Listing["styles"][number];
type Story = FunctionReturnType<typeof api.worldStyles.listStyleStories>[number];
type Frame = Card["covers"][number];
type Level = "none" | "like" | "super";
type Gone = { frame: Frame; index: number; label: string; back?: boolean };
type Flash = { id: string; text: string; tone: Tone; at: number };
type Tone = "coral" | "ember" | "teal" | "crimson" | "ink";
type PaletteKind = "style" | "collection" | "storybook";

const PAGE = 24;
const GAP = 8;
const SESSION = "styles-page";
const AMBER = "#E8A838";
const EMBER = "#FF8C42";
const TEAL = "#79B791";
const CRIMSON = "#E05A5A";
const TONE: Record<Tone, string> = { coral: "var(--lm-coral)", ember: EMBER, teal: TEAL, crimson: CRIMSON, ink: "var(--lm-text-primary)" };

const SANS: CSSProperties = { fontFamily: "var(--font-geist-sans), system-ui, sans-serif" };

const aspectOf = (frame: Frame) => (frame.width && frame.height ? frame.width / frame.height : 4 / 5);
const shortId = (id: string) => id.slice(-7);
const levelOf = (frame: { liked?: boolean; superLiked?: boolean }): Level => (frame.superLiked ? "super" : frame.liked ? "like" : "none");
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const errorLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[\s\S]*?ConvexError: /, "").replace(/\n[\s\S]*$/, "").slice(0, 90);

const imageAttrs = (frame: Frame, width: number) => buildGridImageAttrs({
  src: frame.thumbUrl ?? frame.url ?? "",
  variants: frame.variants,
  thumbSrc: frame.thumbUrl, thumbWidth: frame.thumbWidth,
  fullSrc: frame.url, fullWidth: frame.width,
}, width, frame.kind);

export function WorldStylesPage({ world, styleRef }: { world: string; styleRef?: string }) {
  return (
    <InboxGate title="Styles" prompt="Sign in to see the styles">
      {(ownerUserId) => <StylesScreen ownerUserId={ownerUserId} world={world} styleRef={styleRef} />}
    </InboxGate>
  );
}

function StylesScreen({ ownerUserId, world, styleRef }: { ownerUserId: string; world: string; styleRef?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const listing = useQuery(api.worldStyles.listStyles, isAuthenticated ? { ownerUserId, world, coverLimit: MOSAIC_COVERS } : "skip");
  const [family, setFamily] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<Id<"worldStyles"> | null>(null);
  const [storyId, setStoryId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelFocus, setPanelFocus] = useState<{ what: "edit" | "comment"; n: number } | null>(null);
  const [palette, setPalette] = useState<{ kind: PaletteKind; frame: Frame } | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [gone, setGone] = useState<Record<string, Gone>>({});
  const hovered = useRef<string | null>(null);

  const setLevel = useMutation(api.assets.setAssetLikeLevel);
  const setFrameStyle = useMutation(api.styleFrames.setFrameStyle);
  const placeFrame = useMutation(api.styleFrames.placeFrame);

  const families = useMemo(() => orderMedia([...new Set((listing?.styles ?? []).map((style) => style.family))]), [listing]);
  const shown = useMemo(() => {
    const rank = new Map(families.map((name, index) => [name, index]));
    return (listing?.styles ?? [])
      .filter((style) => !family || style.family === family)
      .map((style, index) => ({ style, index }))
      .sort((a, b) => (rank.get(a.style.family) ?? 9) - (rank.get(b.style.family) ?? 9) || a.index - b.index)
      .map(({ style }) => style);
  }, [listing, family, families]);

  const firstId = useMemo(() => {
    if (!listing) return null;
    const ref = styleRef?.toLowerCase();
    const named = ref ? listing.styles.find((style) => style.slug === ref || style.id === styleRef) : undefined;
    return (named ?? listing.styles.find((style) => style.world.id === listing.world.id) ?? listing.styles[0])?.id ?? null;
  }, [listing, styleRef]);
  const activeId = chosenId ?? firstId;
  const active = listing?.styles.find((style) => style.id === activeId) ?? null;

  useEffect(() => {
    if (!active) return;
    const path = worldStylesPath(world, active.slug);
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path);
    document.title = `${active.name} · Styles · ${listing?.universe.name ?? ""} · Laniameda`;
  }, [active, world, listing]);

  const frames = usePaginatedQuery(
    api.worldStyles.listStyleFramesPage,
    isAuthenticated && activeId ? { ownerUserId, styleId: activeId } : "skip",
    { initialNumItems: PAGE },
  );
  // Support reads wait for the first page of frames (speed rule: the first
  // frame carries what the first screen draws).
  const ready = frames.status !== "LoadingFirstPage";
  const madeWith = useQuery(api.styleFrames.styleMadeWith, isAuthenticated && activeId && ready ? { ownerUserId, styleId: activeId } : "skip");
  const stories = useQuery(api.worldStyles.listStyleStories, isAuthenticated && activeId && ready ? { ownerUserId, styleId: activeId, perBook: 40 } : "skip");
  const story = storyId ? stories?.find((row) => row.id === storyId) ?? null : null;

  // What the masonry shows: the style's frames (or one storybook's), with the
  // frames moved off this style kept in place, grayed, until the style changes.
  const list = useMemo(() => {
    const base = story ? story.frames : frames.results;
    const ids = new Set(base.map((frame) => frame.assetId));
    const out = [...base];
    for (const entry of Object.values(gone).sort((a, b) => a.index - b.index)) {
      if (!ids.has(entry.frame.assetId)) out.splice(Math.min(entry.index, out.length), 0, entry.frame);
    }
    return out;
  }, [story, frames.results, gone]);
  const byId = useMemo(() => new Map<string, Frame>(list.map((frame) => [frame.assetId, frame])), [list]);

  const choose = useCallback((id: Id<"worldStyles">) => {
    setChosenId(id); setStoryId(null); setOpenId(null); setGone({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const step = useCallback((delta: number) => {
    if (!shown.length) return;
    const index = shown.findIndex((style) => style.id === activeId);
    choose(shown[(Math.max(index, 0) + delta + shown.length) % shown.length]!.id);
  }, [shown, activeId, choose]);

  const say = useCallback((id: string, text: string, tone: Tone) => setFlash({ id, text, tone, at: Date.now() }), []);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash((current) => (current?.at === flash.at ? null : current)), 1100);
    return () => clearTimeout(timer);
  }, [flash]);

  const levelFor = useCallback((frame: Frame) => levels[frame.assetId] ?? levelOf(frame), [levels]);

  const like = useCallback(async (frame: Frame, superLike: boolean) => {
    const current = levelFor(frame);
    const next: Level = superLike ? (current === "super" ? "like" : "super") : current === "none" ? "like" : "none";
    setLevels((all) => ({ ...all, [frame.assetId]: next }));
    say(frame.assetId, next === "super" ? "Super liked" : next === "like" ? (current === "super" ? "Super like off" : "Liked") : "Like off", next === "super" ? "ember" : next === "like" ? "coral" : "ink");
    try { await setLevel({ ownerUserId, assetId: frame.assetId, level: next }); }
    catch (error) {
      setLevels((all) => ({ ...all, [frame.assetId]: current }));
      say(frame.assetId, errorLine(error), "crimson");
    }
  }, [levelFor, ownerUserId, say, setLevel]);

  const markGone = useCallback((frame: Frame, label: string) => {
    const index = list.findIndex((row) => row.assetId === frame.assetId);
    setGone((all) => ({ ...all, [frame.assetId]: { frame, index: Math.max(index, 0), label } }));
  }, [list]);

  const drop = useCallback(async (frame: Frame) => {
    if (!active) return;
    const was = gone[frame.assetId];
    try {
      if (was) {
        if (was.back === false) return;
        await setFrameStyle({ ownerUserId, assetId: frame.assetId, to: active.id, session: SESSION });
        setGone((all) => { const next = { ...all }; delete next[frame.assetId]; return next; });
        say(frame.assetId, `Back in ${active.name}`, "teal");
      } else {
        markGone(frame, "Off this style");
        say(frame.assetId, "Off this style", "crimson");
        await setFrameStyle({ ownerUserId, assetId: frame.assetId, from: active.id, session: SESSION });
      }
    } catch (error) {
      if (!was) setGone((all) => { const next = { ...all }; delete next[frame.assetId]; return next; });
      say(frame.assetId, errorLine(error), "crimson");
    }
  }, [active, gone, markGone, ownerUserId, say, setFrameStyle]);

  const pick = useCallback(async (kind: PaletteKind, frame: Frame, target: { id: string; name: string; beat?: number }) => {
    setPalette(null);
    try {
      if (kind === "style") {
        const result = await setFrameStyle({ ownerUserId, assetId: frame.assetId, from: active?.id, to: target.id as Id<"worldStyles">, session: SESSION });
        if (target.id !== active?.id) {
          const index = list.findIndex((row) => row.assetId === frame.assetId);
          setGone((all) => ({ ...all, [frame.assetId]: { frame, index: Math.max(index, 0), label: `Now ${result.style}`, back: false } }));
        }
        say(frame.assetId, `Style · ${result.style}`, "teal");
      } else {
        const result = await placeFrame({ ownerUserId, assetId: frame.assetId, folderId: target.id as Id<"folders">, beat: target.beat, session: SESSION });
        if (result.moved) {
          const index = list.findIndex((row) => row.assetId === frame.assetId);
          setGone((all) => ({ ...all, [frame.assetId]: { frame, index: Math.max(index, 0), label: `Moved to ${result.world}`, back: false } }));
        }
        const beat = result.beat !== undefined ? (result.beatTied ? ` · beat ${result.beat}` : " · beat not set") : "";
        say(frame.assetId, `${result.changed || beat ? "Into" : "Already in"} ${result.name}${beat}`, "teal");
      }
    } catch (error) {
      say(frame.assetId, errorLine(error), "crimson");
    }
  }, [active, list, ownerUserId, placeFrame, say, setFrameStyle]);

  const openFrame = useCallback((assetId: string, focus?: "edit" | "comment") => {
    setOpenId(assetId);
    setPanelFocus(focus ? { what: focus, n: Date.now() } : null);
  }, []);

  // One key map for the hovered frame and the open one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (palette) return;
      if (isTyping(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const targetId = openId ?? hovered.current;
      const frame = targetId ? byId.get(targetId) : undefined;
      const handled = () => event.preventDefault();
      if (openId) {
        const index = list.findIndex((row) => row.assetId === openId);
        if (key === "Escape" || key === "o" || key === "Enter") { setOpenId(null); return handled(); }
        if (key === "ArrowRight" && index < list.length - 1) { setOpenId(list[index + 1]!.assetId); return handled(); }
        if (key === "ArrowLeft" && index > 0) { setOpenId(list[index - 1]!.assetId); return handled(); }
      } else {
        if (key === "ArrowRight" || key === "]") { step(1); return handled(); }
        if (key === "ArrowLeft" || key === "[") { step(-1); return handled(); }
        if ((key === "o" || key === "Enter") && frame) { openFrame(frame.assetId); return handled(); }
      }
      if (!frame) return;
      if (event.code === "Digit1" && event.shiftKey) { void like(frame, true); return handled(); }
      if (key === "1") { void like(frame, false); return handled(); }
      if (key === "2") { void drop(frame); return handled(); }
      if (key === "s") { setPalette({ kind: "style", frame }); return handled(); }
      if (key === "m") { setPalette({ kind: "collection", frame }); return handled(); }
      if (key === "b") { setPalette({ kind: "storybook", frame }); return handled(); }
      if (key === "e" && frame.kind === "image") { openFrame(frame.assetId, "edit"); return handled(); }
      if (key === "c") { openFrame(frame.assetId, "comment"); return handled(); }
      if (key === "i") {
        void navigator.clipboard?.writeText(`asset:${frame.assetId}`).then(() => say(frame.assetId, "ID copied", "ink"), () => undefined);
        return handled();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette, openId, byId, list, step, openFrame, like, drop, say]);

  if (listing === undefined) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}>
      <Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading styles" />
    </main>;
  }

  const opened = openId ? byId.get(openId) : undefined;
  const openIndex = opened ? list.indexOf(opened) : -1;

  return (
    <main className="lms min-h-dvh pb-20" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <style>{MOSAIC_CSS + PAGE_CSS}</style>
      <TopBar listing={listing} world={world} families={families} family={family} onFamily={setFamily} />
      <Carousel styles={shown} activeId={activeId} onChoose={choose} grouped={!family} />
      {listing.styles.length === 0 ? (
        <section className="mx-auto max-w-xl px-6 py-20 text-center">
          <h2 className="text-2xl font-black uppercase tracking-tight" style={SANS}>No styles yet</h2>
          <p className="mt-3 text-[14px]" style={{ color: "var(--lm-text-secondary)" }}>{listing.universe.name} has no named styles yet.</p>
        </section>
      ) : active ? (
        <section className="px-3 pt-5 md:px-6">
          <StyleHead card={active} madeWith={madeWith?.items} />
          <StoryChips total={active.frameCount} stories={stories} storyId={storyId} onStory={setStoryId} />
          <Masonry frames={list} loading={!story && frames.status === "LoadingFirstPage"}
            canLoadMore={!story && frames.status === "CanLoadMore"} onLoadMore={() => frames.loadMore(PAGE)}
            levelFor={levelFor} gone={gone} flash={flash} covers={active.covers}
            onOpen={(id) => openFrame(id)} onHover={(id) => { hovered.current = id; }} />
        </section>
      ) : null}
      {opened && active ? (
        <OpenView ownerUserId={ownerUserId} frame={opened} index={openIndex} count={list.length} style={active}
          story={story} level={levelFor(opened)} gone={gone[opened.assetId]} flash={flash?.id === opened.assetId ? flash : null}
          focus={panelFocus}
          onStep={(delta) => { const next = list[openIndex + delta]; if (next) setOpenId(next.assetId); }}
          onClose={() => setOpenId(null)}
          onLike={(superLike) => void like(opened, superLike)} onDrop={() => void drop(opened)}
          onPalette={(kind) => setPalette({ kind, frame: opened })} />
      ) : null}
      {palette && listing ? (
        <Palette ownerUserId={ownerUserId} kind={palette.kind} listing={listing} activeId={activeId} homeWorldId={active?.world.id ?? null}
          onPick={(target) => void pick(palette.kind, palette.frame, target)} onClose={() => setPalette(null)} />
      ) : null}
      <KeyHint open={Boolean(opened)} />
    </main>
  );
}

/* ── Top bar and carousel ─────────────────────────────────────────────────── */

function TopBar({ listing, world, families, family, onFamily }: {
  listing: Listing; world: string; families: string[]; family: string | null; onFamily: (family: string | null) => void;
}) {
  const count = (name: string | null) => listing.styles.filter((style) => !name || style.family === name).length;
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5 md:px-6"
      style={{ background: "color-mix(in srgb, var(--lm-paper) 88%, transparent)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--lm-border-subtle)" }}>
      <Link href={`/w/${encodeURIComponent(world)}`} className="lms-mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] hover:opacity-80" style={{ color: "var(--lm-text-secondary)" }}>
        <ArrowLeft size={13} aria-hidden />{listing.universe.name}
      </Link>
      <h1 className="text-[20px] font-black uppercase leading-none tracking-tight" style={SANS}>Styles</h1>
      {families.length > 1 ? (
        <nav aria-label="Medium" className="flex flex-wrap items-center gap-1">
          {[null, ...families].map((name) => (
            <button key={name ?? "all"} type="button" onClick={() => onFamily(name)} className="lms-pill" data-on={name === family || undefined}>
              {name ?? "All"}<span className="lms-pill-n">{count(name)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

const CARD_WIDTH = 188;
const CARD_ROW = 86;

function Carousel({ styles, activeId, onChoose, grouped }: {
  styles: Card[]; activeId: string | null; onChoose: (id: Id<"worldStyles">) => void; grouped: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rail.current?.querySelector<HTMLElement>(`[data-style="${activeId}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId]);
  const scrollBy = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * 0.8, behavior: "smooth" });
  if (styles.length === 0) return null;
  return (
    <div className="relative" style={{ borderBottom: "1px solid var(--lm-border-subtle)" }}>
      <div ref={rail} className="lms-rail flex items-end gap-3 overflow-x-auto px-3 pb-3.5 pt-3.5 md:px-6" style={{ scrollbarWidth: "none" }}>
        {styles.map((style, index) => (
          <div key={style.id} className="flex shrink-0 items-end gap-3">
            {grouped && (index === 0 || styles[index - 1]!.family !== style.family) ? (
              <div className="lms-family" aria-hidden><span>{style.family}</span></div>
            ) : null}
            <button type="button" data-style={style.id} onClick={() => onChoose(style.id)}
              className="lms-card text-left" data-on={style.id === activeId || undefined} style={{ width: CARD_WIDTH }}
              aria-pressed={style.id === activeId} title={style.line ?? style.name}>
              <StyleMosaic style={style} width={CARD_WIDTH} rowHeight={CARD_ROW} active={style.id === activeId} eager={index < 8}>
                {style.status === "ready" ? <span className="lms-chip lms-chip-teal absolute right-1.5 top-1.5">Ready</span> : null}
              </StyleMosaic>
              <StyleCaption style={style} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" aria-label="Earlier styles" onClick={() => scrollBy(-1)} className="lms-railbtn left-1"><ChevronLeft size={16} /></button>
      <button type="button" aria-label="More styles" onClick={() => scrollBy(1)} className="lms-railbtn right-1"><ChevronRight size={16} /></button>
    </div>
  );
}

/* ── The chosen style ─────────────────────────────────────────────────────── */

// One band: the name, its line, and what it is made with by name.
function StyleHead({ card, madeWith }: { card: Card; madeWith: MadeWith[] | undefined }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        <h2 className="text-[30px] font-black uppercase leading-[0.95] tracking-tight md:text-[40px]" style={SANS}>{card.name}</h2>
        {card.line ? <p className="mt-2 text-[14px] leading-snug" style={{ color: "var(--lm-text-secondary)" }}>{card.line}</p> : null}
      </div>
      {madeWith?.length ? <MadeWithChips items={madeWith} label="Made with" /> : null}
    </div>
  );
}

function MadeWithChips({ items, label }: { items: MadeWith[]; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label ? <span className="lms-kicker mr-1">{label}</span> : null}
      {items.map((item, index) => {
        const body = (
          <>
            {item.kind === "moodboard" && item.previews.length ? (
              <span className="lms-mw-thumbs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {item.previews.map((preview) => <img key={preview.assetId} src={preview.thumbUrl} alt="" loading="lazy" />)}
              </span>
            ) : null}
            {item.kind !== "unknown" ? <span className="lms-mw-kind">{item.kind === "moodboard" ? "Moodboard" : "Profile"}</span> : null}
            <span className="lms-mw-name">{item.name ?? "Unnamed profile"}</span>
          </>
        );
        return item.kind === "moodboard" && item.moodboardId ? (
          <Link key={`${item.code}-${index}`} href={`/moodboards/${item.moodboardId}`} className="lms-mw" data-kind={item.kind} title={item.code}>{body}</Link>
        ) : (
          <span key={`${item.code}-${index}`} className="lms-mw" data-kind={item.kind} title={item.code}>{body}</span>
        );
      })}
    </div>
  );
}

// "All frames" or one storybook's frames: chips filter the masonry.
function StoryChips({ total, stories, storyId, onStory }: {
  total: number; stories: Story[] | undefined; storyId: string | null; onStory: (id: string | null) => void;
}) {
  if (!stories?.length) return <div className="mb-3" />;
  return (
    <nav aria-label="Frames" className="mb-3 flex flex-wrap items-center gap-1">
      <button type="button" className="lms-pill" data-on={!storyId || undefined} onClick={() => onStory(null)}>All frames<span className="lms-pill-n">{total}</span></button>
      <span className="lms-kicker mx-1.5">In the stories</span>
      {stories.map((row) => (
        <button key={row.id} type="button" className="lms-pill" data-on={storyId === row.id || undefined} onClick={() => onStory(storyId === row.id ? null : row.id)}>
          {row.name}<span className="lms-pill-n">{row.count}</span>
        </button>
      ))}
    </nav>
  );
}

/* ── Masonry ──────────────────────────────────────────────────────────────── */

const columnsFor = (width: number) => (width < 640 ? 1 : width < 2000 ? 2 : 3);

function Masonry({ frames, loading, canLoadMore, onLoadMore, levelFor, gone, flash, covers, onOpen, onHover }: {
  frames: Frame[]; loading: boolean; canLoadMore: boolean; onLoadMore: () => void;
  levelFor: (frame: Frame) => Level; gone: Record<string, Gone>; flash: Flash | null; covers: Frame[];
  onOpen: (id: string) => void; onHover: (id: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !canLoadMore) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoadMore(); }, { rootMargin: "1600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);

  const count = columnsFor(width || 1200);
  const columnWidth = Math.max(1, Math.floor(((width || 1200) - GAP * (count - 1)) / count));
  // Each frame drops into the shortest column, so pages load in at the bottom
  // and nothing above them moves.
  const columns = useMemo(() => {
    const cols: { frame: Frame; index: number }[][] = Array.from({ length: count }, () => []);
    const heights = new Array<number>(count).fill(0);
    frames.forEach((frame, index) => {
      const target = heights.indexOf(Math.min(...heights));
      cols[target]!.push({ frame, index });
      heights[target]! += 1 / Math.min(Math.max(aspectOf(frame), 0.35), 3) + 0.02;
    });
    return cols;
  }, [frames, count]);
  const coverIds = useMemo(() => new Set(covers.map((frame) => frame.assetId)), [covers]);

  let body: ReactNode;
  if (loading) {
    body = <div className="lms-grid" style={{ gap: GAP }}>{Array.from({ length: count }, (_, c) => (
      <div key={c} className="flex flex-1 flex-col" style={{ gap: GAP }}>{Array.from({ length: 3 }, (_, i) => <span key={i} className="lms-skel" style={{ height: 280 + ((i + c) * 97) % 220 }} />)}</div>
    ))}</div>;
  } else if (frames.length === 0) {
    body = <p className="lms-kicker py-16 text-center">No frames filed in this style yet</p>;
  } else {
    body = (
      <div className="lms-grid" style={{ gap: GAP }} onPointerLeave={() => onHover(null)}>
        {columns.map((column, c) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
            {column.map(({ frame, index }) => (
              <Tile key={frame.assetId} frame={frame} width={columnWidth} eager={index < 4} level={levelFor(frame)}
                gone={gone[frame.assetId]} cover={coverIds.has(frame.assetId)} flash={flash?.id === frame.assetId ? flash : null}
                onOpen={onOpen} onHover={onHover} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div ref={box}>
      {body}
      <div ref={sentinel} className="py-8 text-center">{canLoadMore ? <Loader2 className="inline animate-spin" size={16} style={{ color: "var(--lm-text-ghost)" }} /> : null}</div>
    </div>
  );
}

function Tile({ frame, width, eager, level, gone, cover, flash, onOpen, onHover }: {
  frame: Frame; width: number; eager: boolean; level: Level; gone?: Gone; cover: boolean; flash: Flash | null;
  onOpen: (id: string) => void; onHover: (id: string | null) => void;
}) {
  return (
    <figure className="lms-tile group" data-gone={gone ? true : undefined} onPointerEnter={() => onHover(frame.assetId)}>
      <button type="button" className="block w-full" onClick={() => onOpen(frame.assetId)} aria-label="Open frame">
        <FrameMedia frame={frame} width={width} eager={eager} />
      </button>
      <span className="lms-id"><CopyChip value={`asset:${frame.assetId}`} label={shortId(frame.assetId)} /></span>
      <span className="lms-chips">
        {level === "super" ? <span className="lms-chip" style={{ color: EMBER, borderColor: `color-mix(in srgb, ${EMBER} 60%, transparent)` }}>Super liked</span>
          : level === "like" ? <span className="lms-chip" style={{ color: "var(--lm-coral)", borderColor: "color-mix(in srgb, var(--lm-coral) 60%, transparent)" }}>Liked</span> : null}
        {cover ? <span className="lms-chip">Cover</span> : null}
        {gone ? <span className="lms-chip" style={{ color: CRIMSON, borderColor: `color-mix(in srgb, ${CRIMSON} 55%, transparent)` }}>{gone.label}</span> : null}
      </span>
      {flash ? <FlashPill flash={flash} /> : null}
    </figure>
  );
}

function FlashPill({ flash }: { flash: Flash }) {
  return <span key={flash.at} className="lms-flash" style={{ color: TONE[flash.tone], borderColor: `color-mix(in srgb, ${TONE[flash.tone]} 55%, transparent)` }}>{flash.text}</span>;
}

function FrameMedia({ frame, width, eager }: { frame: Frame; width: number; eager?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const style: CSSProperties = { width: "100%", height: "auto", aspectRatio: String(aspectOf(frame)), display: "block", background: "var(--lm-surface-2)" };
  if (frame.kind === "video" && frame.url) {
    return <video ref={video} src={frame.url} poster={frame.thumbUrl} muted loop playsInline preload="none" style={style}
      onPointerEnter={() => void video.current?.play().catch(() => undefined)} onPointerLeave={() => video.current?.pause()} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...imageAttrs(frame, width)} alt="" width={frame.width} height={frame.height} loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined} decoding="async" draggable={false} style={style} />
  );
}

/* ── Open view ────────────────────────────────────────────────────────────── */

function OpenView({ ownerUserId, frame, index, count, style, story, level, gone, flash, focus, onStep, onClose, onLike, onDrop, onPalette }: {
  ownerUserId: string; frame: Frame; index: number; count: number; style: Card; story: Story | null;
  level: Level; gone?: Gone; flash: Flash | null; focus: { what: "edit" | "comment"; n: number } | null;
  onStep: (delta: number) => void; onClose: () => void; onLike: (superLike: boolean) => void; onDrop: () => void;
  onPalette: (kind: PaletteKind) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(api.styleFrames.getFrameView, isAuthenticated ? { ownerUserId, assetId: frame.assetId } : "skip");
  const detail = useQuery(api.worldStyles.getStyle, isAuthenticated ? { ownerUserId, style: style.id } : "skip");
  const madeWith = useQuery(api.styleFrames.styleMadeWith, isAuthenticated ? { ownerUserId, styleId: style.id } : "skip");
  const [loaded, setLoaded] = useState<string | null>(null);
  // A wipe belongs to the frame it was opened on.
  const [wipe, setWipe] = useState<{ assetId: string; compare: EditCompare } | null>(null);
  const compare = wipe?.assetId === frame.assetId ? wipe.compare : null;
  const setCompare = useCallback((next: EditCompare | null) => setWipe(next ? { assetId: frame.assetId, compare: next } : null), [frame.assetId]);
  const editSignal = focus?.what === "edit" ? focus.n : 0;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus?.what !== "comment") return;
    // The thread loads on its own; wait for its box.
    let tries = 0;
    const timer = setInterval(() => {
      const box = panel.current?.querySelector<HTMLTextAreaElement>("[data-lms-comments] textarea");
      if (box || ++tries > 20) clearInterval(timer);
      box?.scrollIntoView({ block: "center", behavior: "smooth" }); box?.focus({ preventScroll: true });
    }, 120);
    return () => clearInterval(timer);
  }, [focus]);

  const galleryHref = galleryRoutePath({ kind: "world", world: style.world.key, shelf: style.shelfId }, frame.assetId);
  const recipe = detail?.recipes[0];

  return (
    <div role="dialog" aria-modal="true" aria-label="Frame" className="lms-open fixed inset-0 z-50 flex flex-col md:flex-row" style={{ background: "color-mix(in srgb, var(--lm-paper) 97%, transparent)", backdropFilter: "blur(6px)" }}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 md:p-6" onClick={onClose}>
        <div className="relative" onClick={(event) => event.stopPropagation()}
          style={{ aspectRatio: String(aspectOf(frame)), maxWidth: "100%", maxHeight: "calc(100dvh - 48px)", height: aspectOf(frame) < 1 ? "calc(100dvh - 48px)" : undefined, width: aspectOf(frame) >= 1 ? "100%" : undefined }}>
          {frame.kind === "video" && frame.url ? (
            <video key={frame.assetId} src={frame.url} poster={frame.thumbUrl} controls autoPlay muted loop playsInline className="h-full w-full object-contain" />
          ) : compare ? (
            <BeforeAfterWipe compare={compare} />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frame.thumbUrl ?? frame.url} alt="" className="absolute inset-0 h-full w-full object-contain" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={frame.assetId} src={frame.url} alt="" onLoad={() => setLoaded(frame.assetId)}
                className="absolute inset-0 h-full w-full object-contain transition-opacity duration-200" style={{ opacity: loaded === frame.assetId ? 1 : 0 }} />
            </>
          )}
          {gone ? <span className="lms-chips"><span className="lms-chip" style={{ color: CRIMSON }}>{gone.label}</span></span> : null}
          {flash ? <FlashPill flash={flash} /> : null}
        </div>
        <button type="button" aria-label="Previous frame" disabled={index <= 0} onClick={(event) => { event.stopPropagation(); onStep(-1); }} className="lms-railbtn left-2"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next frame" disabled={index >= count - 1} onClick={(event) => { event.stopPropagation(); onStep(1); }} className="lms-railbtn right-2"><ChevronRight size={18} /></button>
      </div>

      <aside ref={panel} className="lms-panel w-full shrink-0 overflow-y-auto" style={{ background: "var(--lm-panel-bg)", borderLeft: "1px solid var(--lm-border-subtle)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CopyChip value={`asset:${frame.assetId}`} label={shortId(frame.assetId)} />
            <span className="lms-kicker truncate">{story ? `${story.name} · ` : ""}{index + 1} / {count}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href={galleryHref} className="lms-chip lms-chip-link inline-flex items-center gap-1">Gallery <ExternalLink size={10} /></Link>
            <button type="button" aria-label="Close" onClick={onClose} className="lms-seg"><X size={12} /></button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <button type="button" className="lms-keep" data-on={level !== "none" || undefined} onClick={() => onLike(false)}>
            <kbd>1</kbd>{level !== "none" ? "Liked" : "Like"}
          </button>
          <button type="button" className="lms-keep" data-tone="ember" data-on={level === "super" || undefined} onClick={() => onLike(true)}>
            <kbd><span className="lms-shift">⇧</span>1</kbd>{level === "super" ? "Super liked" : "Super like"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ActionPill k="S" onClick={() => onPalette("style")}>Style</ActionPill>
          <ActionPill k="M" onClick={() => onPalette("collection")}>Collection</ActionPill>
          <ActionPill k="B" onClick={() => onPalette("storybook")}>Storybook</ActionPill>
          <ActionPill k="2" onClick={onDrop}>{gone && gone.back !== false ? "Back in style" : "Off this style"}</ActionPill>
        </div>

        {view?.places.length ? (
          <Section title="Where it is">
            <div className="flex flex-wrap gap-1.5">
              {view.places.map((place) => <span key={place.id} className="lms-chip" data-kind={place.kind}>{place.kind === "style" ? "Style · " : place.kind === "storybook" ? "Story · " : ""}{place.name}</span>)}
            </div>
          </Section>
        ) : null}

        {view === undefined ? <Loader2 className="mt-5 animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /> : view ? (
          <>
            {view.madeWith.length ? <Section title="Made with"><MadeWithChips items={view.madeWith} /></Section> : null}
            <Section title="Prompt" action={view.prompt ? <CopyChip value={view.prompt} label="Copy prompt" /> : null}>
              {view.prompt ? <NamedText text={view.prompt} items={view.madeWith} /> : <p className="lms-dim">No prompt saved with this frame.</p>}
            </Section>
          </>
        ) : null}

        <div className="mt-5">
          {frame.kind === "image" && frame.url ? (
            <EditInPlace assetId={frame.assetId} ownerUserId={ownerUserId} width={frame.width} height={frame.height} assetUrl={frame.url}
              compare={compare} onCompare={setCompare} focusSignal={editSignal} listenForE={false} showNote={false} />
          ) : null}
        </div>

        <Section title={`The style · ${style.name}`}>
          {madeWith?.items.length ? <MadeWithChips items={madeWith.items} /> : null}
          {recipe?.template ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between"><span className="lms-kicker">Its prompt</span><CopyChip value={recipe.template} label="Copy" /></div>
              <NamedText text={recipe.template} items={madeWith?.items ?? []} />
            </div>
          ) : null}
          {detail && (detail.raises.length || detail.lowers.length) ? (
            <ul className="mt-3 flex flex-col gap-1">
              {detail.raises.map((line) => <li key={`+${line}`} className="lms-move"><b style={{ color: TEAL }}>+</b>{line}</li>)}
              {detail.lowers.map((line) => <li key={`-${line}`} className="lms-move"><b style={{ color: CRIMSON }}>−</b>{line}</li>)}
            </ul>
          ) : null}
        </Section>

        <Section title="Comments"><div data-lms-comments><AssetComments assetId={frame.assetId} ownerUserId={ownerUserId} /></div></Section>

        {view ? (
          <p className="lms-kicker mt-5 flex flex-wrap gap-x-3 gap-y-1">
            {view.modelName ? <span>{view.modelName}</span> : null}
            <span>{new Date(view.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
            {view.sourceUrl ? <a href={view.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-80">Source</a> : null}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="lms-section">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="lms-kicker">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

function ActionPill({ k, onClick, children }: { k: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="lms-act" onClick={onClick}><kbd>{k}</kbd>{children}</button>;
}

// Text as Michael reads it: every Midjourney code shown as its moodboard or
// profile name. Copy gives the runnable text, codes and all.
function NamedText({ text, items }: { text: string; items: MadeWith[] }) {
  const names = new Map(items.map((item) => [item.code, item.name ?? "unnamed profile"]));
  const codes = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = codes.length ? text.split(new RegExp(`(?<![A-Za-z0-9])(${codes.join("|")})(?![A-Za-z0-9])`)) : [text];
  return (
    <p className="lms-prompt">
      {parts.map((part, index) => names.has(part)
        ? <span key={index} className="lms-token" title={part}>{names.get(part)}</span>
        : <span key={index}>{part}</span>)}
    </p>
  );
}

/* ── Move palette (S, M, B) ───────────────────────────────────────────────── */

type Option = { id: string; name: string; meta: string; beat?: number };

function Palette({ ownerUserId, kind, listing, activeId, homeWorldId, onPick, onClose }: {
  ownerUserId: string; kind: PaletteKind; listing: Listing; activeId: string | null; homeWorldId: string | null;
  onPick: (target: { id: string; name: string; beat?: number }) => void; onClose: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const worldIds = useMemo(() => listing.worlds.map((row) => row.id), [listing]);
  const targets = useQuery(api.styleFrames.frameTargets, isAuthenticated && kind !== "style" ? { ownerUserId, worldIds } : "skip");
  const [book, setBook] = useState<{ id: string; name: string } | null>(null);
  const beats = useQuery(api.styleFrames.storybookBeats, isAuthenticated && book ? { ownerUserId, storybookId: book.id as Id<"folders"> } : "skip");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [book]);

  const multiWorld = listing.worlds.length > 1;
  // A target in a sibling world moves the frame there: say so on the row.
  const where = useCallback((worldId: string, world: string, rest: string) =>
    worldId !== homeWorldId ? `moves it to ${world} · ${rest}` : multiWorld ? `${world} · ${rest}` : rest, [homeWorldId, multiWorld]);
  const options: Option[] | undefined = useMemo(() => {
    if (kind === "style") {
      return listing.styles.filter((style) => style.id !== activeId)
        .map((style) => ({ id: style.id, name: style.name, meta: where(style.world.id, style.world.short, framesLabel(style.frameCount)) }));
    }
    if (book) {
      if (!beats) return undefined;
      return [{ id: book.id, name: "No beat", meta: "add to the book" },
        ...beats.map((beat) => ({ id: book.id, name: `${beat.number}. ${beat.text || "Beat"}`, meta: beat.frames ? framesLabel(beat.frames) : "no frame yet", beat: beat.number }))];
    }
    if (!targets) return undefined;
    const rows = kind === "collection" ? targets.collections : targets.storybooks;
    return rows.map((row) => ({
      id: row.id, name: row.name,
      meta: where(row.worldId, row.world, "root" in row && row.root ? "the world itself" : framesLabel(row.count)),
    }));
  }, [kind, listing, activeId, where, targets, book, beats]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (options ?? []).filter((option) => !needle || `${option.name} ${option.meta}`.toLowerCase().includes(needle));
  }, [options, query]);

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (kind === "storybook" && !book) { setBook({ id: option.id, name: option.name }); setQuery(""); setCursor(0); return; }
    onPick({ id: option.id, name: option.name, beat: option.beat });
  };
  const title = kind === "style" ? "Change its style" : kind === "collection" ? "Add to a collection" : book ? `Which beat of ${book.name}?` : "Add to a storybook";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center pt-[14dvh]" style={{ background: "rgba(0,0,0,.45)" }} onClick={onClose}>
      <div className="lms-palette" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <span className="text-[13px] font-extrabold uppercase tracking-tight" style={SANS}>{title}</span>
          <span className="lms-kicker">↑↓ · Enter · Esc</span>
        </div>
        <input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); }} placeholder="Type to find"
          className="lms-palette-input" aria-label="Find"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (book) { setBook(null); setCursor(0); } else onClose(); }
            else if (event.key === "ArrowDown") { event.preventDefault(); setCursor((n) => Math.min(n + 1, filtered.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((n) => Math.max(n - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(filtered[cursor]); }
          }} />
        <ul className="lms-palette-list">
          {options === undefined ? <li className="px-3 py-3"><Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /></li>
            : filtered.length === 0 ? <li className="lms-dim px-3 py-3">Nothing matches.</li>
            : filtered.map((option, index) => (
              <li key={`${option.id}-${option.beat ?? "x"}`}>
                <button type="button" className="lms-palette-row" data-on={index === cursor || undefined}
                  onPointerEnter={() => setCursor(index)} onClick={() => choose(option)}>
                  <span className="truncate">{option.name}</span><span className="lms-kicker shrink-0">{option.meta}</span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Key hint ─────────────────────────────────────────────────────────────── */

function KeyHint({ open }: { open: boolean }) {
  const keys: [string, string, Tone][] = [
    ["1", "Like", "coral"], ["⇧1", "Super like", "ember"], ["2", "Off style", "crimson"], ["S", "Style", "teal"],
    ["M", "Collection", "teal"], ["B", "Storybook", "teal"], ["E", "Edit", "ink"], ["C", "Comment", "ink"],
    ...(open ? [["← →", "Frame", "ink"], ["Esc", "Close", "ink"]] as [string, string, Tone][] : [["O", "Open", "ink"], ["← →", "Style", "ink"]] as [string, string, Tone][]),
  ];
  return (
    <div className="lms-keys" aria-hidden>
      {keys.map(([key, label, tone]) => (
        <span key={key}><kbd style={{ color: TONE[tone] }}>{key.startsWith("⇧") ? <><span className="lms-shift">⇧</span>{key.slice(1)}</> : key}</kbd>{label}</span>
      ))}
    </div>
  );
}

const PAGE_CSS = `
.lms{font-family:var(--font-geist-sans),system-ui,sans-serif;--lm-font:var(--font-geist-mono),ui-monospace,monospace;--lm-font-display:var(--font-geist-sans),system-ui,sans-serif}
.lms-mono,.lms-kicker,.lms-pill,.lms-seg,.lms-chip,.lms-keys,.lms-act,.lms-keep,.lms-mw{font-family:var(--font-geist-mono),ui-monospace,monospace}
.lms-kicker{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lms-pill{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-border);color:var(--lm-text-secondary);background:transparent;display:inline-flex;gap:6px;align-items:center;transition:background-color .12s,color .12s}
.lms-pill:hover{color:var(--lm-text-primary);background:var(--lm-surface-2)}
.lms-pill[data-on]{background:var(--lm-ink);color:var(--lm-paper);border-color:var(--lm-ink)}
.lms-pill-n{font-weight:500;opacity:.6;letter-spacing:.04em}
.lms-seg{font-size:10px;font-weight:800;min-width:26px;height:26px;padding:0 8px;border-radius:var(--lm-radius);border:1px solid var(--lm-border);color:var(--lm-text-tertiary);display:inline-grid;place-items:center}
.lms-rail{scroll-snap-type:x proximity}
.lms-card{scroll-snap-align:center;flex-shrink:0;opacity:.6;transition:opacity .15s}
.lms-card:hover,.lms-card[data-on]{opacity:1}
.lms-card .lm-mosaic + span{font-family:var(--font-geist-sans),system-ui,sans-serif}
.lms-family{align-self:stretch;display:flex;align-items:flex-end;padding:0 2px 34px 6px;border-left:1px solid var(--lm-border)}
.lms-family span{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--font-geist-mono),monospace;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--lm-text-tertiary);white-space:nowrap}
.lms-railbtn{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;display:grid;place-items:center;border-radius:999px;background:color-mix(in srgb,var(--lm-paper) 78%,transparent);border:1px solid var(--lm-border-strong);color:var(--lm-text-primary);backdrop-filter:blur(8px);z-index:5}
.lms-railbtn:disabled{opacity:.2}
.lms-chip{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 7px;border-radius:var(--lm-radius);background:color-mix(in srgb,#0A0805 70%,transparent);border:1px solid rgba(255,244,234,.16);color:rgba(255,244,234,.82);backdrop-filter:blur(6px);line-height:1;white-space:nowrap}
.lms-chip-teal{color:${TEAL};border-color:color-mix(in srgb,${TEAL} 55%,transparent)}
.lms-chip-link:hover{color:var(--lm-text-primary);border-color:var(--lm-text-tertiary)}
.lms-panel .lms-chip{background:var(--lm-surface-1);border-color:var(--lm-border);color:var(--lm-text-secondary)}
.lms-panel .lms-chip[data-kind=style]{color:${TEAL};border-color:color-mix(in srgb,${TEAL} 45%,transparent)}
.lms-mw{display:inline-flex;align-items:center;gap:7px;padding:4px 8px 4px 4px;border-radius:var(--lm-radius);border:1px solid var(--lm-border);background:var(--lm-surface-1);font-size:10px;letter-spacing:.08em;text-transform:uppercase;line-height:1;white-space:nowrap;max-width:100%}
.lms-mw[data-kind=moodboard]{border-color:color-mix(in srgb,${AMBER} 45%,transparent)}
a.lms-mw:hover{border-color:${AMBER}}
.lms-mw[data-kind=profile],.lms-mw[data-kind=unknown]{padding-left:8px}
.lms-mw-thumbs{display:flex;gap:1px;height:26px;border-radius:2px;overflow:hidden}
.lms-mw-thumbs img{width:22px;height:26px;object-fit:cover;background:var(--lm-surface-3)}
.lms-mw-kind{color:var(--lm-text-tertiary);font-weight:600}
.lms-mw[data-kind=moodboard] .lms-mw-kind{color:${AMBER}}
.lms-mw-name{font-family:var(--font-geist-sans),system-ui,sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:var(--lm-text-primary);overflow:hidden;text-overflow:ellipsis}
.lms-mw[data-kind=unknown] .lms-mw-name{color:var(--lm-text-tertiary)}
.lms-grid{display:flex;align-items:flex-start}
.lms-skel{display:block;border-radius:var(--lm-radius);background:var(--lm-surface-1);animation:lms-pulse 1.4s ease-in-out infinite}
@keyframes lms-pulse{50%{opacity:.5}}
.lms-tile{position:relative;overflow:hidden;border-radius:var(--lm-radius);background:var(--lm-surface-2);margin:0}
.lms-tile img,.lms-tile video{transition:transform .4s cubic-bezier(.2,.7,.2,1),filter .25s,opacity .25s}
.lms-tile:hover img{transform:scale(1.01)}
.lms-tile[data-gone] img,.lms-tile[data-gone] video{opacity:.28;filter:grayscale(1)}
.lms-id{position:absolute;left:8px;top:8px;opacity:0;transition:opacity .15s}
.lms-tile:hover .lms-id{opacity:1}
.lms-chips{position:absolute;left:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px;pointer-events:none}
.lms-flash{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--font-geist-mono),monospace;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:9px 14px;border-radius:999px;background:rgba(10,8,5,.84);border:1px solid;backdrop-filter:blur(8px);pointer-events:none;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis;animation:lms-pop 1.1s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes lms-pop{0%{opacity:0;transform:translate(-50%,-50%) scale(.86)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.04)}24%{transform:translate(-50%,-50%) scale(1)}78%{opacity:1}100%{opacity:0}}
.lms-panel{padding:18px 20px 40px;max-height:45dvh}
@media (min-width:768px){.lms-panel{width:clamp(440px,36vw,620px);max-height:none}}
.lms-section{margin-top:18px;padding-top:12px;border-top:1px solid var(--lm-border-subtle)}
.lms-prompt{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:12.5px;line-height:1.65;color:var(--lm-text-secondary);white-space:pre-wrap;word-break:break-word;margin:0}
.lms-token{color:${AMBER};font-weight:700}
.lms-dim{font-size:12px;color:var(--lm-text-tertiary)}
.lms-move{display:flex;gap:8px;font-size:12.5px;line-height:1.5;color:var(--lm-text-secondary)}
.lms-move b{width:10px;flex-shrink:0}
.lms-keep{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 6px;border-radius:999px;border:1px solid var(--lm-border-strong);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-secondary);transition:all .12s}
.lms-keep kbd,.lms-act kbd{font-family:inherit;font-size:9.5px;font-weight:800;min-width:22px;height:22px;padding:0 6px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--lm-surface-2);color:var(--lm-text-primary)}
.lms-keep:hover{color:var(--lm-text-primary);border-color:var(--lm-text-tertiary)}
.lms-keep[data-on]{background:var(--lm-coral);border-color:var(--lm-coral);color:#191919;box-shadow:0 0 18px -4px rgba(255,122,100,.7)}
.lms-keep[data-tone=ember][data-on]{background:${EMBER};border-color:${EMBER};box-shadow:0 0 18px -4px rgba(255,140,66,.7)}
.lms-keep[data-on] kbd{background:rgba(25,25,25,.18);color:#191919}
.lms-act{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px 0 4px;border-radius:999px;border:1px solid var(--lm-border);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-secondary)}
.lms-act:hover{color:var(--lm-text-primary);border-color:var(--lm-border-strong);background:var(--lm-surface-1)}
.lms-palette{width:min(560px,calc(100vw - 24px));border-radius:10px;background:var(--lm-panel-bg);border:1px solid var(--lm-border-strong);box-shadow:0 30px 80px -20px rgba(0,0,0,.7);overflow:hidden}
.lms-palette-input{display:block;width:calc(100% - 24px);margin:10px 12px;height:38px;padding:0 12px;border-radius:var(--lm-radius);border:1px solid var(--lm-border);background:var(--lm-surface-1);color:var(--lm-text-primary);font-size:14px;outline:none}
.lms-palette-input:focus{border-color:var(--lm-coral)}
.lms-palette-list{max-height:min(52dvh,460px);overflow-y:auto;padding:0 6px 8px;margin:0;list-style:none}
.lms-palette-row{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border-radius:var(--lm-radius);font-size:13.5px;font-weight:700;text-align:left;color:var(--lm-text-primary)}
.lms-palette-row[data-on]{background:color-mix(in srgb,var(--lm-coral) 16%,transparent);box-shadow:inset 2px 0 0 var(--lm-coral)}
.lms-keys{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:70;display:flex;gap:13px;padding:8px 13px;border-radius:999px;background:color-mix(in srgb,var(--lm-paper) 84%,transparent);border:1px solid var(--lm-border);backdrop-filter:blur(10px);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--lm-text-tertiary);white-space:nowrap}
.lms-keys kbd{font-family:inherit;font-weight:800;margin-right:5px}
.lms kbd .lms-shift{font-family:system-ui,-apple-system,sans-serif;font-weight:700;margin-right:1px}
@media (max-width:900px){.lms-keys{display:none}}
`;
