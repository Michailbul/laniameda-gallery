"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, InboxGate, Micro, display, mono } from "@/components/inbox/inbox-ui";
import { buildGridImageAttrs } from "@/lib/grid-image";
import { galleryRoutePath, worldStylesPath } from "@/lib/gallery-routes";

// The styles page of a world's universe: every style across the top as a
// carousel of covers, the chosen style's frames in a wide masonry and its
// recipe beside them. HUMAN shows names (moodboards, profiles); AGENT adds the
// codes and ids an agent pastes. Its own page: no sidebar, all width.

type Listing = FunctionReturnType<typeof api.worldStyles.listStyles>;
type Card = Listing["styles"][number];
type Detail = FunctionReturnType<typeof api.worldStyles.getStyle>;
type Frame = Card["covers"][number];
type View = "human" | "agent";
type Size = "s" | "m" | "l";

const COLUMN_WIDTH: Record<Size, number> = { s: 220, m: 320, l: 460 };
const PAGE = 36;
const TEAL = "#79B791";
const CORAL = "var(--lm-coral)";
const GAP = 6;

const imageAttrs = (frame: Frame, width: number) => buildGridImageAttrs({
  src: frame.thumbUrl ?? frame.url ?? "",
  variants: frame.variants,
  thumbSrc: frame.thumbUrl, thumbWidth: frame.thumbWidth,
  fullSrc: frame.url, fullWidth: frame.width,
}, width, frame.kind);

const aspectOf = (frame: Frame) => (frame.width && frame.height ? frame.width / frame.height : 4 / 5);
const shortId = (id: string) => id.slice(-7);

export function WorldStylesPage({ world, styleRef }: { world: string; styleRef?: string }) {
  return (
    <InboxGate title="Styles" prompt="Sign in to see the styles">
      {(ownerUserId) => <StylesScreen ownerUserId={ownerUserId} world={world} styleRef={styleRef} />}
    </InboxGate>
  );
}

function StylesScreen({ ownerUserId, world, styleRef }: { ownerUserId: string; world: string; styleRef?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const listing = useQuery(api.worldStyles.listStyles, isAuthenticated ? { ownerUserId, world, coverLimit: 3 } : "skip");
  const [family, setFamily] = useState<string | null>(null);
  const [chosenId, setActiveId] = useState<Id<"worldStyles"> | null>(null);
  const [view, setView] = useState<View>("human");
  const [size, setSize] = useState<Size>("m");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const hovered = useRef<number | null>(null);

  const families = useMemo(() => {
    const seen: string[] = [];
    for (const style of listing?.styles ?? []) if (!seen.includes(style.family)) seen.push(style.family);
    return seen;
  }, [listing]);
  const shown = useMemo(
    () => (listing?.styles ?? []).filter((style) => !family || style.family === family),
    [listing, family],
  );

  // Before a pick: the style the address names, else the first of the
  // world that was asked for, else the first of the universe.
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

  const detail = useQuery(api.worldStyles.getStyle, isAuthenticated && activeId ? { ownerUserId, style: activeId } : "skip");
  const frames = usePaginatedQuery(
    api.worldStyles.listStyleFramesPage,
    isAuthenticated && activeId ? { ownerUserId, styleId: activeId } : "skip",
    { initialNumItems: PAGE },
  );

  const choose = useCallback((id: Id<"worldStyles">) => {
    setActiveId(id);
    setOpenIndex(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const step = useCallback((delta: number) => {
    if (!shown.length) return;
    const index = shown.findIndex((style) => style.id === activeId);
    const next = shown[(Math.max(index, 0) + delta + shown.length) % shown.length]!;
    choose(next.id);
  }, [shown, activeId, choose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (openIndex !== null) {
        if (event.key === "Escape" || event.key.toLowerCase() === "o") { setOpenIndex(null); event.preventDefault(); }
        else if (event.key === "ArrowRight") { setOpenIndex((index) => Math.min((index ?? 0) + 1, frames.results.length - 1)); event.preventDefault(); }
        else if (event.key === "ArrowLeft") { setOpenIndex((index) => Math.max((index ?? 0) - 1, 0)); event.preventDefault(); }
        return;
      }
      if (event.key === "ArrowRight" || event.key === "]") { step(1); event.preventDefault(); }
      else if (event.key === "ArrowLeft" || event.key === "[") { step(-1); event.preventDefault(); }
      else if (event.key.toLowerCase() === "o" && hovered.current !== null) { setOpenIndex(hovered.current); event.preventDefault(); }
      else if (event.key.toLowerCase() === "a") setView((mode) => (mode === "human" ? "agent" : "human"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, frames.results.length, step]);

  if (listing === undefined) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}>
      <Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading styles" />
    </main>;
  }

  return (
    <main className="min-h-dvh pb-16" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <style>{PAGE_CSS}</style>
      <TopBar listing={listing} world={world} families={families} family={family} onFamily={setFamily}
        view={view} onView={setView} size={size} onSize={setSize} />
      <Carousel styles={shown} activeId={activeId} onChoose={choose} view={view} grouped={!family} />
      {listing.styles.length === 0 ? (
        <EmptyUniverse listing={listing} view={view} />
      ) : active ? (
        <section className="lms-body px-3 pt-6 md:px-6">
          <div className="min-w-0">
            <StyleHeader card={active} detail={detail} view={view} />
            <FrameGrid frames={frames.results} size={size} covers={detail?.coverAssetIds ?? []} loading={frames.status === "LoadingFirstPage"}
              canLoadMore={frames.status === "CanLoadMore"} onLoadMore={() => frames.loadMore(PAGE)}
              onOpen={setOpenIndex} onHover={(index) => { hovered.current = index; }} view={view} />
          </div>
          <RecipeRail detail={detail} view={view} />
        </section>
      ) : null}
      {openIndex !== null && frames.results[openIndex] ? (
        <Lightbox ownerUserId={ownerUserId} frames={frames.results} index={openIndex} onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)} galleryHref={active ? galleryRoutePath({ kind: "world", world: active.world.key, shelf: active.shelfId }, frames.results[openIndex]!.assetId) : undefined} />
      ) : null}
      <KeyHint open={openIndex !== null} />
    </main>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────────────── */

function TopBar({ listing, world, families, family, onFamily, view, onView, size, onSize }: {
  listing: Listing; world: string; families: string[]; family: string | null; onFamily: (family: string | null) => void;
  view: View; onView: (view: View) => void; size: Size; onSize: (size: Size) => void;
}) {
  const count = (name: string | null) => listing.styles.filter((style) => !name || style.family === name).length;
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-3 md:px-6"
      style={{ background: "color-mix(in srgb, var(--lm-paper) 88%, transparent)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--lm-border-subtle)" }}>
      <Link href={`/w/${encodeURIComponent(world)}`} className="inline-flex items-center gap-2 hover:opacity-80" style={{ color: "var(--lm-text-secondary)" }}>
        <ArrowLeft size={14} aria-hidden />
        <Micro color="var(--lm-text-secondary)">{listing.universe.name}</Micro>
      </Link>
      <h1 className="text-[22px] font-black uppercase leading-none tracking-tight md:text-[26px]" style={display}>Styles</h1>
      <nav aria-label="Families" className="flex flex-wrap items-center gap-1">
        {[null, ...families].map((name) => {
          const on = name === family;
          return <button key={name ?? "all"} type="button" onClick={() => onFamily(name)} className="lms-pill" data-on={on || undefined}>
            {name ?? "All"}<span className="lms-pill-n">{count(name)}</span>
          </button>;
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <div role="radiogroup" aria-label="Frame size" className="flex items-center gap-0.5">
          {(["s", "m", "l"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={size === value} onClick={() => onSize(value)} className="lms-seg" data-on={size === value || undefined}>{value}</button>
          ))}
        </div>
        <div role="radiogroup" aria-label="View" className="flex items-center gap-0.5">
          {(["human", "agent"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => onView(value)} className="lms-seg" data-on={view === value || undefined}>{value}</button>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ── Carousel ─────────────────────────────────────────────────────────────── */

const CARD_HEIGHT = 168;

function Carousel({ styles, activeId, onChoose, view, grouped }: {
  styles: Card[]; activeId: string | null; onChoose: (id: Id<"worldStyles">) => void; view: View; grouped: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = rail.current?.querySelector<HTMLElement>(`[data-style="${activeId}"]`);
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId]);
  const scrollBy = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * 0.8, behavior: "smooth" });
  if (styles.length === 0) return null;
  return (
    <div className="relative" style={{ borderBottom: "1px solid var(--lm-border-subtle)" }}>
      <div ref={rail} className="lms-rail flex items-end gap-3 overflow-x-auto px-3 pb-4 pt-4 md:px-6" style={{ scrollbarWidth: "none" }}>
        {styles.map((style, index) => (
          <div key={style.id} className="flex shrink-0 items-end gap-3">
            {grouped && (index === 0 || styles[index - 1]!.family !== style.family) ? (
              <div className="lms-family" aria-hidden><span>{style.family}</span></div>
            ) : null}
            <StyleCard style={style} active={style.id === activeId} onChoose={onChoose} view={view} />
          </div>
        ))}
      </div>
      <button type="button" aria-label="Earlier styles" onClick={() => scrollBy(-1)} className="lms-railbtn left-1"><ChevronLeft size={16} /></button>
      <button type="button" aria-label="More styles" onClick={() => scrollBy(1)} className="lms-railbtn right-1"><ChevronRight size={16} /></button>
    </div>
  );
}

// One style in the carousel: its cover at its own shape, the pointer skims
// through its other covers, the name and frame count under it.
function StyleCard({ style, active, onChoose, view }: { style: Card; active: boolean; onChoose: (id: Id<"worldStyles">) => void; view: View }) {
  const [cover, setCover] = useState(0);
  const frame = style.covers[cover] ?? style.covers[0];
  const width = Math.round(Math.min(Math.max((frame ? aspectOf(frame) : 0.8) * CARD_HEIGHT, 120), 300));
  const onMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (style.covers.length < 2) return;
    const box = event.currentTarget.getBoundingClientRect();
    setCover(Math.min(style.covers.length - 1, Math.floor(((event.clientX - box.left) / box.width) * style.covers.length)));
  };
  return (
    <button type="button" data-style={style.id} onClick={() => onChoose(style.id)} onPointerMove={onMove} onPointerLeave={() => setCover(0)}
      className="lms-card group text-left" data-on={active || undefined} style={{ width }} aria-pressed={active}>
      <span className="lms-card-img" style={{ height: CARD_HEIGHT }}>
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img {...imageAttrs(frame, width)} alt="" loading="lazy" decoding="async" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : <span className="grid h-full place-items-center"><Micro>No frames yet</Micro></span>}
        {style.covers.length > 1 ? (
          <span className="lms-dots" aria-hidden>{style.covers.map((c, i) => <i key={c.assetId} data-on={i === cover || undefined} />)}</span>
        ) : null}
        {style.status === "ready" ? <span className="lms-chip lms-chip-teal absolute right-1.5 top-1.5">Ready</span> : null}
      </span>
      <span className="mt-2 block truncate text-[13px] font-extrabold uppercase leading-tight tracking-tight" style={display}>{style.name}</span>
      <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        {style.frameCount} frames{view === "agent" ? ` · ${style.slug}` : ""}
      </span>
    </button>
  );
}

/* ── The chosen style ─────────────────────────────────────────────────────── */

function StyleHeader({ card, detail, view }: { card: Card; detail: Detail | undefined; view: View }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="lms-chip">{card.world.short}</span>
        <span className="lms-chip" data-tone={card.status}>{card.status === "ready" ? "Ready" : card.status === "draft" ? "Draft" : card.status}</span>
        <span className="lms-chip">{card.frameCount} frames</span>
        {view === "agent" ? <CopyChip value={`style:${card.id}`} title="Copy the style id for an agent" /> : null}
      </div>
      <h2 className="mt-3 text-[34px] font-black uppercase leading-[0.92] tracking-tight md:text-[56px]" style={display}>{card.name}</h2>
      {card.line ? <p className="mt-3 max-w-3xl text-[15px] leading-relaxed" style={{ color: "var(--lm-text-secondary)" }}>{card.line}</p> : null}
      {detail?.mergedFrom.length ? (
        <p className="mt-2 text-[11px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          Holds {detail.mergedFrom.map((row) => row.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FrameGrid({ frames, size, covers, loading, canLoadMore, onLoadMore, onOpen, onHover, view }: {
  frames: Frame[]; size: Size; covers: string[]; loading: boolean; canLoadMore: boolean; onLoadMore: () => void;
  onOpen: (index: number) => void; onHover: (index: number | null) => void; view: View;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !canLoadMore) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoadMore(); }, { rootMargin: "1200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);
  const columnWidth = COLUMN_WIDTH[size];
  if (loading) return <div className="lms-skeleton" style={{ columnWidth }}>{Array.from({ length: 12 }, (_, i) => <span key={i} style={{ height: 160 + ((i * 53) % 140) }} />)}</div>;
  if (frames.length === 0) return <p className="py-16 text-center"><Micro>No frames filed in this style yet</Micro></p>;
  return (
    <>
      <div className="lms-masonry" style={{ columnWidth, columnGap: GAP }} onPointerLeave={() => onHover(null)}>
        {frames.map((frame, index) => (
          <figure key={frame.assetId} className="lms-tile group" style={{ marginBottom: GAP }} onPointerEnter={() => onHover(index)}>
            <button type="button" className="block w-full" onClick={() => onOpen(index)} aria-label="Open frame">
              <FrameMedia frame={frame} width={columnWidth} eager={index < 6} />
            </button>
            {covers.includes(frame.assetId) ? <span className="lms-chip absolute left-1.5 top-1.5">Cover</span> : null}
            <span className={`absolute bottom-1.5 left-1.5 transition-opacity ${view === "agent" ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <CopyChip value={`asset:${frame.assetId}`} label={shortId(frame.assetId)} />
            </span>
          </figure>
        ))}
      </div>
      <div ref={sentinel} className="py-6 text-center">{canLoadMore ? <Loader2 className="inline animate-spin" size={16} style={{ color: "var(--lm-text-ghost)" }} /> : null}</div>
    </>
  );
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

/* ── Recipe ───────────────────────────────────────────────────────────────── */

function RecipeRail({ detail, view }: { detail: Detail | undefined; view: View }) {
  if (!detail) return <aside className="lms-rail-side"><Loader2 className="animate-spin" size={16} style={{ color: "var(--lm-text-ghost)" }} /></aside>;
  const agent = view === "agent";
  return (
    <aside className="lms-rail-side">
      <Block title="Made with">
        {detail.recipes.length === 0 ? <p className="lms-dim">No recipe written yet.</p> : detail.recipes.map((recipe, index) => (
          <div key={index} className="lms-recipe" data-main={index === 0 || undefined}>
            {recipe.name || detail.recipes.length > 1 ? <Micro>{recipe.name ?? (index === 0 ? "Main recipe" : `Recipe ${index + 1}`)}</Micro> : null}
            <div className="mt-2 flex flex-col gap-1.5">
              {recipe.moodboards.map((board) => (
                <Link key={board.id} href={`/moodboards/${board.id}`} className="lms-stack-row group">
                  <span className="lms-stack-thumbs">
                    {board.previews.map((preview) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={preview.assetId} src={preview.thumbUrl} alt="" loading="lazy" />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold uppercase tracking-tight" style={display}>{board.name}</span>
                    <span className="block truncate text-[10px] uppercase tracking-[0.1em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
                      Moodboard · {board.itemCount} images{board.otherWorld ? ` · from ${board.otherWorld}` : ""}
                      {agent && board.mjCode ? <> · <span style={{ textTransform: "none" }}>{board.mjCode}</span></> : null}
                    </span>
                  </span>
                </Link>
              ))}
              {recipe.profiles.map((profile) => (
                <div key={profile.id} className="lms-stack-row" title={profile.role}>
                  <span className="lms-profile-mark" aria-hidden>P</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold uppercase tracking-tight" style={display}>{profile.name}</span>
                    <span className="block truncate text-[10px] uppercase tracking-[0.1em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
                      Taste profile{agent ? <> · <span style={{ textTransform: "none" }}>{profile.code}</span></> : null}
                    </span>
                  </span>
                </div>
              ))}
              {recipe.unknownCodes.map((code) => (
                <div key={code} className="lms-stack-row">
                  <span className="lms-profile-mark" aria-hidden>?</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold uppercase tracking-tight" style={{ ...display, color: "var(--lm-text-tertiary)" }}>Unnamed profile</span>
                    {agent ? <span className="block text-[10px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{code}</span> : null}
                  </span>
                </div>
              ))}
            </div>
            {recipe.frames !== undefined ? <p className="mt-2 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Made {recipe.frames} saved frames</p> : null}
            {agent ? <AgentRecipe recipe={recipe} /> : null}
            {recipe.template ? <Template recipe={recipe} agent={agent} /> : null}
            {recipe.note ? <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--lm-text-secondary)" }}>{recipe.note}</p> : null}
          </div>
        ))}
      </Block>
      {detail.raises.length || detail.lowers.length ? (
        <Block title="What moves it">
          <ul className="flex flex-col gap-1.5">
            {detail.raises.map((line) => <li key={`+${line}`} className="lms-move"><b style={{ color: TEAL }}>+</b>{line}</li>)}
            {detail.lowers.map((line) => <li key={`-${line}`} className="lms-move"><b style={{ color: CORAL }}>−</b>{line}</li>)}
          </ul>
        </Block>
      ) : null}
      {detail.notes ? <Block title="Notes"><p className="whitespace-pre-line text-[12px] leading-relaxed" style={{ color: "var(--lm-text-secondary)" }}>{detail.notes}</p></Block> : null}
      <Block title="Where it lives">
        <div className="flex flex-wrap gap-1.5">
          {detail.shelf ? <Link className="lms-chip lms-chip-link" href={galleryRoutePath({ kind: "world", world: detail.world.key, shelf: detail.shelf.id })}>Shelf · {detail.shelf.name}</Link> : null}
          {detail.lock ? <Link className="lms-chip lms-chip-link" href={`/stories/${detail.lock.id}`}>Full recipe · {detail.lock.status}</Link> : null}
          <span className="lms-chip">{detail.world.name}</span>
        </div>
        {agent ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <CopyChip value={`style:${detail.id}`} />
            {detail.shelf ? <CopyChip value={detail.shelf.id} label={`shelf ${shortId(detail.shelf.id)}`} /> : null}
            {detail.lock ? <CopyChip value={`story:${detail.lock.id}`} label={`lock ${shortId(detail.lock.id)}`} /> : null}
            <CopyChip value={agentBrief(detail)} label="Copy for agent" title="The style with its ids and codes, for an agent" />
          </div>
        ) : null}
      </Block>
    </aside>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="lms-block"><h3 className="mb-2.5"><Micro>{title}</Micro></h3>{children}</section>;
}

type RecipeView = Detail["recipes"][number];

const profileLine = (recipe: RecipeView) => {
  const codes = [...recipe.moodboards.map((board) => board.mjCode).filter(Boolean), ...recipe.profiles.map((profile) => profile.code), ...recipe.unknownCodes];
  return codes.length ? `--profile ${codes.join(" ")}` : "";
};

function AgentRecipe({ recipe }: { recipe: RecipeView }) {
  const line = [profileLine(recipe), recipe.parameters].filter(Boolean).join(" ");
  if (!line) return null;
  return <div className="mt-2 flex items-start justify-between gap-2">
    <code className="lms-code">{line}</code>
    <CopyChip value={line} label="Copy" />
  </div>;
}

// The template as Michael reads it: codes shown as the board or profile name.
// COPY gives the runnable text, codes and all.
function Template({ recipe, agent }: { recipe: RecipeView; agent: boolean }) {
  const names = new Map<string, string>();
  for (const board of recipe.moodboards) if (board.mjCode) names.set(board.mjCode, board.name);
  for (const profile of recipe.profiles) names.set(profile.code, profile.name);
  for (const code of recipe.unknownCodes) names.set(code, "unnamed profile");
  const text = recipe.template!;
  const codes = [...names.keys()].sort((a, b) => b.length - a.length).map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = !agent && codes.length ? text.split(new RegExp(`(${codes.join("|")})`)) : [text];
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between"><Micro>Prompt</Micro><CopyChip value={text} label="Copy prompt" /></div>
      <p className="lms-template">
        {parts.map((part, index) => names.has(part) && !agent ? <span key={index} className="lms-token">{names.get(part)}</span> : <span key={index}>{part}</span>)}
      </p>
    </div>
  );
}

const agentBrief = (detail: Detail) => [
  `Style: ${detail.name} (style:${detail.id}) · ${detail.world.name} (${detail.world.key})`,
  detail.line ? `Look: ${detail.line}` : "",
  detail.shelf ? `Shelf: ${detail.shelf.name} (${detail.shelf.id}), ${detail.shelf.count} frames` : "Shelf: none",
  ...detail.recipes.map((recipe, index) => `Recipe ${index + 1}: ${recipe.label || "no stack"}${profileLine(recipe) ? ` · ${profileLine(recipe)}` : ""}${recipe.parameters ? ` ${recipe.parameters}` : ""}${recipe.moodboards.length ? ` · boards ${recipe.moodboards.map((board) => `moodboard:${board.id}`).join(", ")}` : ""}`),
  detail.lock ? `Style lock: story:${detail.lock.id}` : "",
  detail.covers.length ? `Covers: ${detail.coverAssetIds.map((id) => `asset:${id}`).join(", ")}` : "",
].filter(Boolean).join("\n");

/* ── Empty ────────────────────────────────────────────────────────────────── */

function EmptyUniverse({ listing, view }: { listing: Listing; view: View }) {
  return (
    <section className="mx-auto max-w-xl px-6 py-20 text-center">
      <h2 className="text-2xl font-black uppercase tracking-tight" style={display}>No styles yet</h2>
      <p className="mt-3 text-[14px]" style={{ color: "var(--lm-text-secondary)" }}>
        {listing.universe.name} has no named styles recorded. An agent makes them from the style shelves and their recipes.
      </p>
      {view === "agent" && listing.unrecordedShelves.length ? (
        <p className="mt-4 text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {listing.unrecordedShelves.length} shelves in the group Styles have no record: save_style {"{world, name, shelf}"} adopts one.
        </p>
      ) : null}
    </section>
  );
}

/* ── Open view ────────────────────────────────────────────────────────────── */

function Lightbox({ ownerUserId, frames, index, onIndex, onClose, galleryHref }: {
  ownerUserId: string; frames: Frame[]; index: number; onIndex: (index: number) => void; onClose: () => void; galleryHref?: string;
}) {
  const frame = frames[index]!;
  const { isAuthenticated } = useConvexAuth();
  const info = useQuery(api.worldStyles.getFrameDetail, isAuthenticated ? { ownerUserId, assetId: frame.assetId } : "skip");
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div role="dialog" aria-modal="true" aria-label="Frame" className="fixed inset-0 z-50 flex flex-col md:flex-row"
      style={{ background: "var(--lm-overlay-canvas)" }} onClick={onClose}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 md:p-8" onClick={(event) => event.stopPropagation()}>
        {frame.kind === "video" && frame.url ? (
          <video key={frame.assetId} src={frame.url} poster={frame.thumbUrl} controls autoPlay muted loop playsInline className="max-h-full max-w-full" />
        ) : (
          <span className="relative grid max-h-full max-w-full place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {loaded !== frame.assetId ? <img src={frame.thumbUrl} alt="" className="max-h-[calc(100dvh-64px)] max-w-full object-contain" style={{ filter: "blur(0.4px)" }} /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={frame.assetId} src={frame.url} alt="" onLoad={() => setLoaded(frame.assetId)}
              className={`max-h-[calc(100dvh-64px)] max-w-full object-contain ${loaded === frame.assetId ? "" : "absolute inset-0 opacity-0"}`} />
          </span>
        )}
        <button type="button" aria-label="Previous" disabled={index === 0} onClick={() => onIndex(index - 1)} className="lms-railbtn left-2"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next" disabled={index >= frames.length - 1} onClick={() => onIndex(index + 1)} className="lms-railbtn right-2"><ChevronRight size={18} /></button>
      </div>
      <aside className="max-h-[38dvh] w-full shrink-0 overflow-y-auto p-4 md:max-h-none md:w-[380px] md:p-6" onClick={(event) => event.stopPropagation()}
        style={{ background: "var(--lm-panel-bg)", borderLeft: "1px solid var(--lm-border-subtle)" }}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <CopyChip value={`asset:${frame.assetId}`} label={shortId(frame.assetId)} />
          <div className="flex items-center gap-2">
            {galleryHref ? <Link href={galleryHref} className="lms-chip lms-chip-link inline-flex items-center gap-1">Gallery <ExternalLink size={10} /></Link> : null}
            <button type="button" aria-label="Close" onClick={onClose} className="lms-seg"><X size={12} /></button>
          </div>
        </div>
        <Micro>{index + 1} / {frames.length}</Micro>
        {info?.prompt ? (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between"><Micro>Prompt</Micro><CopyChip value={info.prompt} label="Copy prompt" /></div>
            <p className="lms-template">{info.prompt}</p>
          </div>
        ) : info === undefined ? <Loader2 className="mt-3 animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /> : <p className="lms-dim mt-3">No prompt saved with this frame.</p>}
        {info?.agentDescription ? <p className="mt-4 text-[12px] leading-relaxed" style={{ color: "var(--lm-text-secondary)" }}>{info.agentDescription}</p> : null}
        {info?.modelName ? <p className="mt-3 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{info.modelName}</p> : null}
      </aside>
    </div>
  );
}

function KeyHint({ open }: { open: boolean }) {
  const keys = open
    ? [["← →", "Frame"], ["O / Esc", "Close"]]
    : [["← →", "Style"], ["O", "Open frame"], ["A", "Agent view"]];
  return (
    <div className="lms-keys" aria-hidden>
      {keys.map(([key, label]) => <span key={key}><kbd>{key}</kbd>{label}</span>)}
    </div>
  );
}

const PAGE_CSS = `
.lms-pill{font-family:var(--lm-font);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-border);color:var(--lm-text-secondary);background:transparent;display:inline-flex;gap:6px;align-items:center;transition:background-color .12s,color .12s}
.lms-pill:hover{color:var(--lm-text-primary);background:var(--lm-surface-2)}
.lms-pill[data-on]{background:var(--lm-ink);color:var(--lm-paper);border-color:var(--lm-ink)}
.lms-pill-n{font-weight:600;opacity:.6;letter-spacing:.04em}
.lms-seg{font-family:var(--lm-font);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;min-width:26px;height:26px;padding:0 8px;border-radius:var(--lm-radius);border:1px solid var(--lm-border);color:var(--lm-text-tertiary);display:inline-grid;place-items:center}
.lms-seg[data-on]{color:var(--lm-paper);background:var(--lm-ink);border-color:var(--lm-ink)}
.lms-rail{scroll-snap-type:x proximity}
.lms-card{scroll-snap-align:center;flex-shrink:0;opacity:.62;transition:opacity .15s}
.lms-card:hover,.lms-card[data-on]{opacity:1}
.lms-card-img{position:relative;display:block;overflow:hidden;border-radius:var(--lm-radius);background:var(--lm-surface-2);outline:2px solid transparent;outline-offset:2px;transition:outline-color .15s,box-shadow .15s}
.lms-card[data-on] .lms-card-img{outline-color:var(--lm-coral);box-shadow:0 0 0 6px rgba(255,122,100,.12),0 8px 30px -10px rgba(255,122,100,.55)}
.lms-dots{position:absolute;left:6px;right:6px;bottom:6px;display:flex;gap:3px}
.lms-dots i{flex:1;height:2px;background:rgba(240,232,224,.28);border-radius:2px}
.lms-dots i[data-on]{background:var(--lm-ink)}
.lms-family{align-self:stretch;display:flex;align-items:flex-end;padding:0 2px 34px 6px;border-left:1px solid var(--lm-border)}
.lms-family span{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--lm-font);font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--lm-text-tertiary);white-space:nowrap}
.lms-railbtn{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;display:grid;place-items:center;border-radius:999px;background:color-mix(in srgb,var(--lm-paper) 78%,transparent);border:1px solid var(--lm-border-strong);color:var(--lm-text-primary);backdrop-filter:blur(8px);z-index:5}
.lms-railbtn:disabled{opacity:.25}
.lms-chip{font-family:var(--lm-font);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 7px;border-radius:var(--lm-radius);background:color-mix(in srgb,var(--lm-paper) 74%,transparent);border:1px solid var(--lm-border-strong);color:var(--lm-text-secondary);backdrop-filter:blur(6px);line-height:1;white-space:nowrap}
.lms-chip[data-tone=ready],.lms-chip-teal{color:${TEAL};border-color:color-mix(in srgb,${TEAL} 55%,transparent)}
.lms-chip-link:hover{color:var(--lm-text-primary);border-color:var(--lm-text-tertiary)}
.lms-body{display:grid;grid-template-columns:minmax(0,1fr);gap:28px}
@media (min-width:1100px){.lms-body{grid-template-columns:minmax(0,1fr) 360px}}
.lms-rail-side{display:flex;flex-direction:column;gap:22px;align-self:start}
@media (min-width:1100px){.lms-rail-side{position:sticky;top:76px;max-height:calc(100dvh - 96px);overflow-y:auto;scrollbar-width:none}}
.lms-block{border-top:1px solid var(--lm-border);padding-top:12px}
.lms-recipe+.lms-recipe{margin-top:16px;padding-top:14px;border-top:1px dashed var(--lm-border)}
.lms-stack-row{display:flex;align-items:center;gap:10px;padding:6px;border-radius:var(--lm-radius);background:var(--lm-surface-1);border:1px solid var(--lm-border-subtle)}
a.lms-stack-row:hover{border-color:var(--lm-border-strong)}
.lms-stack-thumbs{display:flex;flex-shrink:0;width:66px;height:36px;gap:2px;overflow:hidden;border-radius:var(--lm-radius)}
.lms-stack-thumbs img{flex:1;min-width:0;height:100%;object-fit:cover;background:var(--lm-surface-3)}
.lms-profile-mark{flex-shrink:0;width:36px;height:36px;display:grid;place-items:center;border-radius:999px;font-family:var(--lm-font);font-weight:800;font-size:12px;color:var(--lm-coral);border:1px solid color-mix(in srgb,var(--lm-coral) 50%,transparent)}
.lms-template{font-family:var(--lm-font);font-size:11.5px;line-height:1.65;color:var(--lm-text-secondary);background:var(--lm-surface-1);border:1px solid var(--lm-border-subtle);border-radius:var(--lm-radius);padding:10px 12px;white-space:pre-wrap;word-break:break-word}
.lms-token{color:var(--lm-coral);font-weight:700}
.lms-code{font-family:var(--lm-font);font-size:11px;color:var(--lm-text-secondary);word-break:break-all;text-transform:none}
.lms-move{display:flex;gap:8px;font-size:12.5px;line-height:1.5;color:var(--lm-text-secondary)}
.lms-move b{font-family:var(--lm-font);width:10px;flex-shrink:0}
.lms-dim{font-size:12px;color:var(--lm-text-tertiary)}
.lms-masonry{column-fill:balance}
.lms-tile{position:relative;break-inside:avoid;overflow:hidden;border-radius:var(--lm-radius);content-visibility:auto;contain-intrinsic-size:auto 300px}
.lms-tile img,.lms-tile video{transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.lms-tile:hover img{transform:scale(1.015)}
.lms-skeleton{column-gap:${GAP}px}
.lms-skeleton span{display:block;margin-bottom:${GAP}px;break-inside:avoid;background:var(--lm-surface-1);border-radius:var(--lm-radius);animation:lms-pulse 1.4s ease-in-out infinite}
@keyframes lms-pulse{50%{opacity:.5}}
.lms-keys{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:40;display:flex;gap:14px;padding:7px 12px;border-radius:999px;background:color-mix(in srgb,var(--lm-paper) 82%,transparent);border:1px solid var(--lm-border);backdrop-filter:blur(10px);font-family:var(--lm-font);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-tertiary);white-space:nowrap}
.lms-keys kbd{font-family:inherit;font-weight:800;color:var(--lm-text-primary);margin-right:6px}
@media (max-width:640px){.lms-keys{display:none}}
`;
