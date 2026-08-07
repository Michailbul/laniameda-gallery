"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PublicNav } from "./public-nav";
import { PUBLIC_MODES, type PublicMode } from "@/lib/public-modes";
import { ShowcaseMasonry } from "./showcase-masonry";
import { ShowcaseLightbox } from "./showcase-lightbox";
import { SHARED_ASSET_PARAM, sharedAssetHref } from "@/lib/shared-asset-link";
import { BrowseBand } from "./browse-band";
import { assetThumb } from "./types";
import type { ShowcaseAsset } from "./types";
import { OWNER_HANDLE, OWNER_SITE_URL } from "@/lib/routes";

const OWNER_LOGIN_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(
  /^@+/,
  "",
);
const OWNER_LOGIN_LINK = OWNER_LOGIN_BOT
  ? `https://t.me/${OWNER_LOGIN_BOT}?start=login`
  : null;

// `mode` comes from the URL segment, not from state — each view is its own
// page, so switching views is a navigation and survives refresh and sharing.
export function PublicHome({
  mode = "featured",
  previewAuthed = false,
}: {
  mode?: PublicMode;
  previewAuthed?: boolean;
}) {
  const data = useQuery(api.showcase.getShowcaseHome, {});

  // ── Shared deep link ────────────────────────────────────────────────────
  // `?asset=<id>` opens that one piece over whatever mode is showing. Resolved
  // by its own query rather than by searching the loaded grid, so a link still
  // works when the piece sits past the visitor's first page — or isn't in the
  // active mode at all.
  const [sharedAssetId, setSharedAssetId] = useState<string | null>(null);
  useEffect(() => {
    const read = () =>
      setSharedAssetId(
        new URLSearchParams(window.location.search).get(SHARED_ASSET_PARAM),
      );
    read();
    // Back/forward should close or reopen the shared piece.
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const sharedAsset = useQuery(
    api.showcase.getPublicAsset,
    sharedAssetId ? { assetId: sharedAssetId } : "skip",
  );

  const closeSharedAsset = useCallback(() => {
    setSharedAssetId(null);
    // Drop the param so a refresh doesn't reopen it, without adding history.
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARED_ASSET_PARAM);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const worlds = data?.worlds ?? [];
  const loading = data === undefined;

  // The reel arrives as (asset, world?) pairs; split it into what the grid
  // renders and the hover captions that say where each piece comes from.
  const featuredReel = useMemo(
    () => (data?.featuredReel ?? []).map((entry) => entry.asset as ShowcaseAsset),
    [data],
  );
  const featuredWorldLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entry of data?.featuredReel ?? []) {
      // A piece titled from the featured shelf speaks for itself; only an
      // untitled one falls back to naming the world it came from.
      const title = entry.asset.name?.trim();
      const label = title || entry.world?.name;
      if (label) labels.set(entry.asset._id as string, label);
    }
    return labels;
  }, [data]);

  // The shared piece leads; the rest of the reel follows so the filmstrip has
  // somewhere to go. Deduped — the shared asset is usually in the reel already.
  const sharedReelAssets = useMemo(() => {
    if (!sharedAsset) return [];
    const lead = sharedAsset as ShowcaseAsset;
    const rest = featuredReel.filter((asset) => asset._id !== lead._id);
    return [lead, ...rest];
  }, [sharedAsset, featuredReel]);
  // Derived, not reset-by-effect: the position is stored against the link it
  // belongs to, so a NEW shared link falls back to 0 (its own piece leads)
  // without an effect racing the render that already shows the new reel.
  const [reelPos, setReelPos] = useState<{ id: string; index: number } | null>(
    null,
  );
  const sharedReelIndex =
    reelPos && reelPos.id === sharedAssetId ? reelPos.index : 0;
  const setSharedReelIndex = useCallback(
    (next: number) => {
      if (!sharedAssetId) return;
      setReelPos({ id: sharedAssetId, index: next });
    },
    [sharedAssetId],
  );
  const copy = PUBLIC_MODES.find((entry) => entry.id === mode)!;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--lm-paper)",
        color: "var(--lm-text-primary)",
      }}
    >
      {previewAuthed && <PreviewBanner />}
      <PublicNav mode={mode} />

      {/* One heading, driven by the active mode. Switching modes rewrites the
          statement instead of scrolling the visitor somewhere new. */}
      <header
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding:
            "clamp(40px, 9vh, 96px) clamp(16px, 4vw, 40px) clamp(28px, 5vh, 52px)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--lm-coral)",
            margin: 0,
          }}
        >
          {copy.label}
        </p>
        <h1
          key={mode}
          className="lm-mode-title"
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: "clamp(34px, 6.4vw, 76px)",
            lineHeight: 1,
            letterSpacing: "-0.032em",
            margin: "16px 0 0",
            maxWidth: 940,
          }}
        >
          {copy.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "clamp(13px, 1.5vw, 15.5px)",
            lineHeight: 1.65,
            color: "var(--lm-text-secondary)",
            maxWidth: 560,
            margin: "18px 0 0",
          }}
        >
          {copy.blurb}
        </p>
      </header>

      {mode === "featured" && (
        <FeaturedMode
          assets={featuredReel}
          labels={featuredWorldLabels}
          loading={loading}
        />
      )}
      {mode === "worlds" && <WorldsMode worlds={worlds} loading={loading} />}
      {mode === "browse" && <BrowseBand />}

      <footer
        style={{
          maxWidth: 1400,
          margin: "60px auto 0",
          padding: "40px clamp(16px, 4vw, 40px) 80px",
          borderTop: "1px solid var(--lm-border)",
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
        <span style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {!previewAuthed && OWNER_LOGIN_LINK && (
            <a
              href={OWNER_LOGIN_LINK}
              style={{ color: "var(--lm-text-ghost)", textDecoration: "none" }}
            >
              Owner sign-in
            </a>
          )}
          <a
            href={OWNER_SITE_URL}
            target="_blank"
            rel="noopener noreferrer me"
            title="mishabuloichyk.com"
            className="lm-owner-handle-link"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            @{OWNER_HANDLE}
          </a>
        </span>
      </footer>
      {/* A shared link opens over the page, whatever mode is showing. The
          shared piece leads, then the rest of the featured reel — so the
          filmstrip gives the visitor somewhere to go instead of a dead end. */}
      {sharedAssetId && sharedAsset && (
        <ShowcaseLightbox
          assets={sharedReelAssets}
          index={sharedReelIndex}
          onIndexChange={setSharedReelIndex}
          onClose={closeSharedAsset}
          shareHrefFor={(asset) => sharedAssetHref(asset._id as string)}
        />
      )}
    </main>
  );
}

// Mode 1 — the lead, in the same justified masonry the vault uses.
function FeaturedMode({
  assets,
  labels,
  loading,
}: {
  assets: ShowcaseAsset[];
  labels: Map<string, string>;
  loading: boolean;
}) {
  return (
    <section style={{ padding: "0 clamp(16px, 3vw, 32px) clamp(40px, 8vh, 80px)" }}>
      <div>
        {!loading && assets.length === 0 ? (
          <EmptyNote>
            No featured work yet — mark a few pieces featured in the vault.
          </EmptyNote>
        ) : (
          <ShowcaseMasonry assets={assets} labels={labels} loading={loading} />
        )}
      </div>
    </section>
  );
}

type WorldSummary = NonNullable<
  ReturnType<typeof useQuery<typeof api.showcase.getShowcaseHome>>
>["worlds"][number];

// Mode 2 — the worlds. One wide card each: cover, name, logline, and the
// section counts that say how much is behind it.
function WorldsMode({
  worlds,
  loading,
}: {
  worlds: WorldSummary[];
  loading: boolean;
}) {
  return (
    <section style={{ padding: "0 clamp(16px, 3vw, 32px) clamp(40px, 8vh, 80px)" }}>
      <div>
        {loading ? (
          <div className="lm-worlds-masonry" aria-hidden>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  breakInside: "avoid",
                  marginBottom: 22,
                  aspectRatio: "3 / 2",
                  background: "var(--lm-surface-1)",
                  borderRadius: 8,
                }}
              />
            ))}
          </div>
        ) : worlds.length === 0 ? (
          <EmptyNote>
            No worlds published yet — showcase a project in the vault.
          </EmptyNote>
        ) : (
          // Masonry of cover tiles: each world keeps its cover's own aspect
          // instead of being forced into one banner shape.
          <div className="lm-worlds-masonry">
            {worlds.map((world) => (
              <div
                key={world.folderId}
                style={{ breakInside: "avoid", marginBottom: 22 }}
              >
                <WorldCard world={world} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function WorldCard({ world }: { world: WorldSummary }) {
  const coverSrc = world.cover ? assetThumb(world.cover) : undefined;
  // The cover's own shape, clamped so a very tall or very wide frame can't
  // wreck the column rhythm.
  const coverRatio = world.cover?.width && world.cover?.height
    ? Math.min(2.2, Math.max(0.75, world.cover.width / world.cover.height))
    : 3 / 2;
  return (
    <Link
      href={`/w/${world.slug ?? world.folderId}`}
      className="lm-world-card"
      style={{
        display: "block",
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--lm-surface-2)",
        aspectRatio: String(coverRatio),
        textDecoration: "none",
        // Card text always sits over the cover's dark gradient, never over the
        // page background — so it stays light regardless of theme.
        color: "#f5ede4",
      }}
    >
      {coverSrc &&
        (world.cover?.kind === "video" ? (
          <video
            src={world.cover.url}
            poster={world.cover.thumbUrl}
            muted
            loop
            playsInline
            autoPlay
            style={coverStyle}
          />
        ) : (
          <img src={coverSrc} alt="" loading="lazy" style={coverStyle} />
        ))}
      {/* Keeps the title legible over any cover. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.1) 100%)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: "clamp(18px, 3vw, 38px)",
          right: "clamp(18px, 3vw, 38px)",
          bottom: "clamp(18px, 3vw, 34px)",
          display: "block",
        }}
      >
        <span
          style={{
            display: "block",
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: "clamp(26px, 4.2vw, 56px)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: "#f5ede4",
            textShadow: "0 2px 24px rgba(0,0,0,0.6)",
          }}
        >
          {world.name}
        </span>
        {world.logline && (
          <span
            className="lm-clamp-2"
            style={{
              marginTop: 10,
              maxWidth: 560,
              fontFamily: "var(--lm-font)",
              fontSize: 13,
              lineHeight: 1.55,
              color: "rgba(240, 232, 224, 0.86)",
              textShadow: "0 1px 12px rgba(0,0,0,0.6)",
            }}
          >
            {world.logline}
          </span>
        )}
        <span
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 18px",
            marginTop: 14,
            fontFamily: "var(--lm-font)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(240, 232, 224, 0.72)",
          }}
        >
          {world.sections.map((section) => (
            <span key={section.key}>
              {section.count} {section.label}
            </span>
          ))}
          <span style={{ color: "var(--lm-coral)" }}>Enter →</span>
        </span>
      </span>
    </Link>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--lm-font)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--lm-text-ghost)",
        padding: "40px 0",
      }}
    >
      {children}
    </p>
  );
}

const coverStyle = {
  position: "absolute" as const,
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover" as const,
};

function PreviewBanner() {
  return (
    <div
      style={{
        background: "var(--lm-coral)",
        color: "#1a1008",
        fontFamily: "var(--lm-font)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        textAlign: "center",
        padding: "8px 16px",
      }}
    >
      Visitor preview — this is what an anonymous visitor sees
    </div>
  );
}
