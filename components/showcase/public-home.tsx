"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PublicNav } from "./public-nav";
import { PUBLIC_MODES, type PublicMode } from "@/lib/public-modes";
import { ShowcaseMasonry } from "./showcase-masonry";
import { ShowcaseLightbox } from "./showcase-lightbox";
import { SHARED_ASSET_PARAM, sharedAssetHref } from "@/lib/shared-asset-link";
import { BrowseBand, TileSizeSlider, useZoomPreference } from "./browse-band";
import { WorldsMasonry, type WorldSummary } from "./worlds-masonry";
import type { ShowcaseAsset } from "./types";
import { ADMIN_PATH, OWNER_HANDLE, OWNER_SITE_URL } from "@/lib/routes";

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
        {copy.blurb && (
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
        )}
      </header>

      {mode === "featured" && (
        <FeaturedMode
          assets={featuredReel}
          labels={featuredWorldLabels}
          loading={loading}
        />
      )}
      {mode === "worlds" && <WorldsMode worlds={worlds} loading={loading} />}
      {/* The signed-in owner gets the Browse-scope control; visitors never
          see it. The setting itself lives on the backend. */}
      {mode === "browse" && <BrowseBand ownerControls={previewAuthed} />}

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
        <span>● MISHA BULOICHYK</span>
        <span style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* Points at /admin rather than straight out to the Telegram deep
              link: that page renders the auth panel, which reports what went
              wrong when a login fails, and it still works for someone without
              Telegram installed. */}
          {!previewAuthed && (
            <a
              href={ADMIN_PATH}
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
  // Same preference the Browse view and the vault write, so a size picked in
  // one place holds in the others.
  const [zoom, setZoom] = useZoomPreference();
  return (
    <section style={{ padding: "0 clamp(16px, 3vw, 32px) clamp(40px, 8vh, 80px)" }}>
      <div>
        {assets.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingBottom: 16,
            }}
          >
            <TileSizeSlider value={zoom} onChange={setZoom} />
          </div>
        )}
        {!loading && assets.length === 0 ? (
          <EmptyNote>
            No featured work yet — mark a few pieces featured in the vault.
          </EmptyNote>
        ) : (
          <ShowcaseMasonry
            assets={assets}
            labels={labels}
            loading={loading}
            zoom={zoom}
            // The lead pieces run half again as large as the Browse grid.
            baseScale={1.5}
            compact={false}
            // Mostly motion: keep the video elements mounted so a hover plays
            // at once instead of after a mount and a fetch.
            preloadVideos
          />
        )}
      </div>
    </section>
  );
}

// Mode 2 — the worlds, in the same justified masonry as Featured and Browse.
// One wide card each: cover, name, logline, and the section counts that say
// how much is behind it.
function WorldsMode({
  worlds,
  loading,
}: {
  worlds: WorldSummary[];
  loading: boolean;
}) {
  // Same stored size as the other two views and the vault.
  const [zoom, setZoom] = useZoomPreference();
  return (
    <section style={{ padding: "0 clamp(16px, 3vw, 32px) clamp(40px, 8vh, 80px)" }}>
      <div>
        {worlds.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingBottom: 16,
            }}
          >
            <TileSizeSlider value={zoom} onChange={setZoom} />
          </div>
        )}
        {loading ? (
          <div
            aria-hidden
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))",
              gap: 12,
            }}
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  aspectRatio: "3 / 2",
                  background: "var(--lm-surface-1)",
                  borderRadius: 8,
                }}
              />
            ))}
          </div>
        ) : worlds.length === 0 ? (
          <EmptyNote>
            No worlds published yet — publish a collection from the vault.
          </EmptyNote>
        ) : (
          // Worlds run at the Featured size: they are the destination, not
          // thumbnails of it.
          <WorldsMasonry worlds={worlds} zoom={zoom} baseScale={1.5} />
        )}
      </div>
    </section>
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
