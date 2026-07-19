"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ShowcaseLightbox } from "./showcase-lightbox";
import { ShowcaseSetModal } from "./showcase-set-modal";
import { SetContent } from "./set-content";
import { assetThumb, assetRatio } from "./types";
import type { ShowcaseAsset, ShowcaseSetSummary } from "./types";

// Editable studio intro. Phase 1 keeps it inline; a proper editable profile
// lands in Phase 2.
const INTRO = {
  kicker: "TASTE PROFILE · AI CREATIVE WORK",
  title: "Taste, and the work it makes.",
  blurb:
    "I'm Misha — AI filmmaker and image-maker. This is my working vault: story sets, stills, and locations I generated and filed by hand. Featured sets lead, stacks hold the rest, Inspiration is what I haven't placed yet. Open anything.",
  handle: "@misha.buloy",
};

type OpenSet = { folderId: Id<"folders">; kind: "collection" | "storybook" };
type SetsView = "stacks" | "expanded";

export function ShowcaseHome({ previewAuthed = false }: { previewAuthed?: boolean }) {
  const data = useQuery(api.showcase.getShowcaseHome, {});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [openSet, setOpenSet] = useState<OpenSet | null>(null);
  const [setsView, setSetsView] = useState<SetsView>("stacks");

  const featured = data?.featured ?? [];
  const collections = data?.collections ?? [];
  const storybooks = data?.storybooks ?? [];
  const inspiration = data?.inspiration ?? [];
  const isEmpty =
    data !== undefined &&
    featured.length === 0 &&
    collections.length === 0 &&
    storybooks.length === 0 &&
    inspiration.length === 0;

  const hasSets =
    featured.length > 0 || collections.length > 0 || storybooks.length > 0;
  // EXPAND ALL walks every showcased set in home order: featured first.
  const allSets = [...featured, ...storybooks, ...collections];

  const openSetFor = (set: ShowcaseSetSummary) =>
    setOpenSet({ folderId: set.folderId, kind: set.kind });

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--lm-paper)",
        color: "var(--lm-text-primary)",
      }}
    >
      {previewAuthed && <PreviewBanner />}

      {/* Hero */}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "clamp(56px, 12vh, 140px) 24px clamp(40px, 8vh, 80px)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--lm-coral)",
            margin: 0,
          }}
        >
          {INTRO.kicker}
        </p>
        <h1
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: "clamp(40px, 9vw, 92px)",
            lineHeight: 0.98,
            letterSpacing: "-0.03em",
            margin: "18px 0 0",
            maxWidth: 900,
          }}
        >
          {INTRO.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "clamp(14px, 2vw, 17px)",
            lineHeight: 1.65,
            color: "var(--lm-text-secondary)",
            maxWidth: 560,
            margin: "26px 0 0",
          }}
        >
          {INTRO.blurb}
        </p>
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 12,
            letterSpacing: "0.06em",
            color: "var(--lm-text-ghost)",
            margin: "22px 0 0",
          }}
        >
          {INTRO.handle}
        </p>
      </section>

      {isEmpty && <EmptyState previewAuthed={previewAuthed} />}

      {/* Featured sets — hero treatment */}
      {setsView === "stacks" && featured.length > 0 && (
        <Section title="Featured" count={featured.length}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                featured.length > 1
                  ? "repeat(auto-fit, minmax(min(100%, 420px), 1fr))"
                  : "1fr",
              gap: 20,
            }}
          >
            {featured.map((set) => (
              <FeaturedCard
                key={set.folderId}
                set={set}
                onClick={() => openSetFor(set)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Sets: stacks <-> expand-all toggle */}
      {hasSets && (
        <section
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 8px" }}
        >
          <ViewToggle view={setsView} onChange={setSetsView} />
        </section>
      )}

      {setsView === "stacks" ? (
        <>
          {/* Storybooks */}
          {storybooks.length > 0 && (
            <Section title="Storybooks" count={storybooks.length}>
              <div className="lm-showcase-grid">
                {storybooks.map((set) => (
                  <StackCard
                    key={set.folderId}
                    set={set}
                    onClick={() => openSetFor(set)}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Collections */}
          {collections.length > 0 && (
            <Section title="Collections" count={collections.length}>
              <div className="lm-showcase-grid">
                {collections.map((set) => (
                  <StackCard
                    key={set.folderId}
                    set={set}
                    onClick={() => openSetFor(set)}
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      ) : (
        allSets.map((set) => (
          <ExpandedSet key={set.folderId} folderId={set.folderId} kind={set.kind} />
        ))
      )}

      {/* Inspiration — public works not filed into any showcased set */}
      {inspiration.length > 0 && (
        <Section title="Inspiration" count={inspiration.length}>
          <div className="lm-showcase-columns">
            {inspiration.map((asset, i) => (
              <WorkTile
                key={asset._id}
                asset={asset}
                onClick={() => setLightboxIndex(i)}
              />
            ))}
          </div>
        </Section>
      )}

      <footer
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "60px 24px 80px",
          borderTop: "1px solid var(--lm-border)",
          marginTop: 60,
          fontFamily: "var(--lm-font)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>● LANIAMEDA</span>
        <span>{INTRO.handle}</span>
      </footer>

      {lightboxIndex !== null && (
        <ShowcaseLightbox
          assets={inspiration}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {openSet && (
        <ShowcaseSetModal
          folderId={openSet.folderId}
          kind={openSet.kind}
          onClose={() => setOpenSet(null)}
        />
      )}
    </main>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: SetsView;
  onChange: (view: SetsView) => void;
}) {
  const options: { value: SetsView; label: string }[] = [
    { value: "stacks", label: "Stacks" },
    { value: "expanded", label: "Expand all" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Sets view"
      style={{
        display: "inline-flex",
        gap: 18,
        paddingBottom: 18,
        fontFamily: "var(--lm-font)",
      }}
    >
      {options.map((option) => {
        const active = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            style={{
              background: "none",
              border: "none",
              padding: "2px 0",
              cursor: "pointer",
              fontFamily: "var(--lm-font)",
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)",
              borderBottom: active
                ? "2px solid var(--lm-coral)"
                : "2px solid transparent",
              transition: "color 150ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// A showcased set expanded inline on the home page (EXPAND ALL view): title,
// story, own works, chapters — the same body the set modal renders.
function ExpandedSet({
  folderId,
  kind,
}: {
  folderId: Id<"folders">;
  kind: "collection" | "storybook";
}) {
  const collection = useQuery(
    api.showcase.getShowcaseCollection,
    kind === "collection" ? { folderId } : "skip",
  );
  const storybook = useQuery(
    api.showcase.getShowcaseStorybook,
    kind === "storybook" ? { folderId } : "skip",
  );
  const data = kind === "collection" ? collection : storybook;
  if (!data) return null;

  return (
    <section
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 24px 24px",
        borderTop: "1px solid var(--lm-border)",
        paddingTop: 36,
        marginBottom: 24,
      }}
    >
      <SetContent data={data} variant="inline" />
    </section>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 56px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 22,
          paddingBottom: 12,
          borderBottom: "1px solid var(--lm-border)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--lm-text-primary)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <span
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 11,
            color: "var(--lm-text-ghost)",
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function WorkTile({
  asset,
  onClick,
}: {
  asset: ShowcaseAsset;
  onClick: () => void;
}) {
  const src = assetThumb(asset);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        marginBottom: 14,
        breakInside: "avoid",
        border: "none",
        padding: 0,
        background: "var(--lm-surface-1)",
        borderRadius: 4,
        overflow: "hidden",
        cursor: "zoom-in",
      }}
    >
      {/* aspectRatio reserves the tile's height before media loads, so the
          masonry columns never reflow mid-scroll. Grid videos stay poster-only
          (preload none) — the lightbox is where playback happens. */}
      {asset.kind === "video" ? (
        <video
          src={asset.url}
          poster={asset.thumbUrl}
          muted
          loop
          playsInline
          preload={asset.thumbUrl ? "none" : "metadata"}
          style={{
            width: "100%",
            display: "block",
            aspectRatio: String(assetRatio(asset)),
            objectFit: "cover",
          }}
        />
      ) : (
        <img
          src={src}
          alt={asset.description ?? asset.fileName ?? "Work"}
          loading="lazy"
          decoding="async"
          style={{
            width: "100%",
            display: "block",
            aspectRatio: String(assetRatio(asset)),
            objectFit: "cover",
          }}
        />
      )}
    </button>
  );
}

// Chapter names ("Characters · Locations") shown on set cards.
function ChaptersLine({ set }: { set: ShowcaseSetSummary }) {
  if (set.chapters.length === 0) return null;
  return (
    <span
      style={{
        display: "block",
        marginTop: 8,
        fontFamily: "var(--lm-font)",
        fontSize: 10.5,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--lm-text-tertiary)",
      }}
    >
      {set.chapters.map((c) => c.name).join(" · ")}
    </span>
  );
}

// Featured set: full-bleed cover, name over a bottom gradient — the hero
// treatment above the regular stacks.
function FeaturedCard({
  set,
  onClick,
}: {
  set: ShowcaseSetSummary;
  onClick: () => void;
}) {
  const cover = set.previewAssets[0];
  const coverSrc = cover ? assetThumb(cover) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        textAlign: "left",
        border: "none",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--lm-surface-2)",
        cursor: "pointer",
        padding: 0,
        position: "relative",
        aspectRatio: "16 / 9",
        width: "100%",
      }}
    >
      {coverSrc &&
        (cover?.kind === "video" ? (
          <video
            src={cover.url}
            poster={cover.thumbUrl}
            muted
            loop
            playsInline
            autoPlay
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <img
            src={coverSrc}
            alt={set.name}
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ))}
      {/* Contrast gradient so the title always reads. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(10, 8, 5, 0.82) 0%, rgba(10, 8, 5, 0.32) 38%, transparent 65%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "18px 22px 20px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--lm-coral)",
          }}
        >
          {set.kind === "storybook" ? "Storybook" : "Collection"}
        </span>
        <h3
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: "clamp(22px, 3.4vw, 34px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "#FFF4EA",
            margin: "6px 0 0",
            textShadow: "0 2px 18px rgba(0,0,0,0.5)",
          }}
        >
          {set.name}
        </h3>
        <span
          style={{
            display: "block",
            marginTop: 8,
            fontFamily: "var(--lm-font)",
            fontSize: 10.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255, 244, 234, 0.75)",
          }}
        >
          {set.count} {set.count === 1 ? "piece" : "pieces"}
          {set.chapters.length > 0 &&
            ` · ${set.chapters.map((c) => c.name).join(" · ")}`}
        </span>
      </div>
    </button>
  );
}

// A stack of prints: two offset sheets peeking behind the cover, then the
// set's name, chapters, and count.
function StackCard({
  set,
  onClick,
}: {
  set: ShowcaseSetSummary;
  onClick: () => void;
}) {
  const [cover, ...rest] = set.previewAssets;
  const coverSrc = cover ? assetThumb(cover) : undefined;
  const layers = rest.slice(0, 2);
  return (
    <button
      type="button"
      onClick={onClick}
      className="lm-stack-card"
      style={{
        display: "block",
        textAlign: "left",
        border: "none",
        background: "none",
        cursor: "pointer",
        padding: 0,
        width: "100%",
      }}
    >
      <div style={{ position: "relative", paddingTop: 10 }}>
        {/* Peeking sheets behind the cover. */}
        {layers.map((layer, i) => {
          const src = assetThumb(layer);
          return (
            <div
              key={layer.assetId}
              aria-hidden
              style={{
                position: "absolute",
                inset: "10px 0 0",
                borderRadius: 6,
                overflow: "hidden",
                transform: `rotate(${i === 0 ? -2.2 : 1.8}deg) translateY(${i === 0 ? -6 : -3}px) scale(${i === 0 ? 0.94 : 0.97})`,
                transformOrigin: "50% 100%",
                opacity: 0.55,
                background: "var(--lm-surface-2)",
              }}
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              )}
            </div>
          );
        })}
        <div
          style={{
            position: "relative",
            aspectRatio: "4 / 3",
            borderRadius: 6,
            overflow: "hidden",
            background: "var(--lm-surface-2)",
            border: "1px solid var(--lm-border)",
          }}
        >
          {coverSrc &&
            (cover?.kind === "video" ? (
              <video
                src={cover.url}
                poster={cover.thumbUrl}
                muted
                loop
                playsInline
                preload={cover.thumbUrl ? "none" : "metadata"}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <img
                src={coverSrc}
                alt={set.name}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ))}
          {/* Count badge */}
          <span
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              fontFamily: "var(--lm-font)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#FFF4EA",
              background: "rgba(10, 8, 5, 0.55)",
              borderRadius: 4,
              padding: "3px 8px",
              backdropFilter: "blur(4px)",
            }}
          >
            {set.count}
          </span>
        </div>
      </div>
      <div style={{ padding: "12px 2px 0" }}>
        <h3
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 700,
            fontSize: 17,
            lineHeight: 1.2,
            color: "var(--lm-text-primary)",
            margin: 0,
          }}
        >
          {set.name}
        </h3>
        <ChaptersLine set={set} />
        {set.story && (
          <p
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--lm-text-secondary)",
              margin: "8px 0 0",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {set.story}
          </p>
        )}
      </div>
    </button>
  );
}

function PreviewBanner() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--lm-coral)",
        color: "#1a1008",
        fontFamily: "var(--lm-font)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        textAlign: "center",
        padding: "8px 16px",
      }}
    >
      Preview — this is what visitors see ·{" "}
      <Link href="/" style={{ color: "#1a1008", textDecoration: "underline" }}>
        Back to vault
      </Link>
    </div>
  );
}

function EmptyState({ previewAuthed }: { previewAuthed: boolean }) {
  return (
    <section
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "20px 24px 100px",
        fontFamily: "var(--lm-font)",
        color: "var(--lm-text-tertiary)",
      }}
    >
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Nothing published yet.
        {previewAuthed
          ? " Mark assets public and showcase collections or storybooks to fill this page."
          : " Check back soon."}
      </p>
    </section>
  );
}
