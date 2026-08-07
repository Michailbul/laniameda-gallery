"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/use-current-user";
import { TASTE_PROFILE_PATH } from "@/lib/routes";
import { PublicNav } from "./public-nav";
import { ShowcaseMasonry } from "./showcase-masonry";
import type { ShowcaseAsset } from "./types";

// One world: the project's public content, grouped into the sections the
// vault already keeps it in — Scenes (beats), Characters, Locations, Stills.
// A section tab filters; "All" shows the whole world in narrative order.
export function WorldView({ slug }: { slug: string }) {
  const world = useQuery(api.showcase.getWorld, { slug });
  const [sectionKey, setSectionKey] = useState<string>("all");

  // The page itself is authless. A signed-in visitor gets the one owner
  // affordance that only makes sense here — picking the world's thumbnail from
  // the work on the page. The mutation re-checks ownership, so a signed-in
  // stranger clicking it just gets an error back.
  const { user } = useCurrentUser();
  const setFolderCover = useMutation(api.folders.setFolderCover);
  const ownerUserId = user?.ownerUserId;
  const worldFolderId = world?.folderId;
  const setCover = useCallback(
    async (asset: ShowcaseAsset) => {
      if (!ownerUserId || !worldFolderId) return;
      await setFolderCover({
        ownerUserId,
        folderId: worldFolderId,
        assetId: asset._id as Id<"assets">,
      });
    },
    [ownerUserId, setFolderCover, worldFolderId],
  );

  const sections = useMemo(() => world?.sections ?? [], [world]);
  const visible = useMemo<ShowcaseAsset[]>(() => {
    const chosen =
      sectionKey === "all"
        ? sections
        : sections.filter((section) => section.key === sectionKey);
    return chosen.flatMap((section) => section.assets) as ShowcaseAsset[];
  }, [sections, sectionKey]);

  if (world === null) {
    return (
      <Shell>
        <p style={noteStyle}>This world isn&apos;t published.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding:
            "clamp(40px, 9vh, 96px) clamp(16px, 4vw, 40px) clamp(24px, 4vh, 44px)",
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
          World
        </p>
        <h1
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: "clamp(36px, 7vw, 84px)",
            lineHeight: 0.98,
            letterSpacing: "-0.032em",
            margin: "14px 0 0",
          }}
        >
          {world?.name ?? "…"}
        </h1>
        {world?.logline && (
          <p
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: "clamp(13px, 1.5vw, 15.5px)",
              lineHeight: 1.7,
              color: "var(--lm-text-secondary)",
              maxWidth: 620,
              margin: "20px 0 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {world.logline}
          </p>
        )}
      </header>

      {/* One section means no choice to offer — a storybook-shaped world is
          just its story, so the tab row would be noise. */}
      {sections.length > 1 && (
        <div
          role="tablist"
          aria-label="World sections"
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0 clamp(16px, 4vw, 40px)",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 22px",
            paddingBottom: 16,
            borderBottom: "1px solid var(--lm-border)",
          }}
        >
          {[
            { key: "all", label: "All", count: sections.reduce((n, s) => n + s.assets.length, 0) },
            ...sections.map((section) => ({
              key: section.key,
              label: section.label,
              count: section.assets.length,
            })),
          ].map((tab) => {
            const active = tab.key === sectionKey;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSectionKey(tab.key)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "4px 0",
                  cursor: "pointer",
                  fontFamily: "var(--lm-font)",
                  fontSize: 11.5,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: active ? "var(--lm-coral)" : "var(--lm-text-tertiary)",
                  borderBottom: active
                    ? "2px solid var(--lm-coral)"
                    : "2px solid transparent",
                }}
              >
                {tab.label}{" "}
                <span style={{ color: "var(--lm-text-ghost)" }}>{tab.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Full-bleed grid: only the gutter is held back. */}
      <section
        style={{ padding: "28px clamp(16px, 3vw, 32px) clamp(48px, 9vh, 96px)" }}
      >
        {world !== undefined && visible.length === 0 ? (
          <p style={noteStyle}>Nothing public in this world yet.</p>
        ) : (
          // Remount per section so the masonry re-measures instead of
          // animating tiles between two unrelated sets.
          <ShowcaseMasonry
            key={sectionKey}
            assets={visible}
            loading={world === undefined}
            onSetCover={ownerUserId && worldFolderId ? setCover : undefined}
            coverAssetId={world?.coverAssetId as string | undefined}
          />
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--lm-paper)",
        color: "var(--lm-text-primary)",
      }}
    >
      <PublicNav backHref={TASTE_PROFILE_PATH} backLabel="All worlds" />
      {children}
    </main>
  );
}

const noteStyle = {
  fontFamily: "var(--lm-font)",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "var(--lm-text-ghost)",
  padding: "60px clamp(16px, 4vw, 40px)",
  maxWidth: 1400,
  margin: "0 auto",
};
