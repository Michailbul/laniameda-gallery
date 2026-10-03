"use client";

/* eslint-disable @next/next/no-img-element -- R2 thumbnails, sized by CSS */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowUpRight, Clapperboard, Copy, Heart, Play, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  MOTION_FACETS,
  MOTION_FACET_KEYS,
  MOTION_TAG,
  canonicalTag,
  matchesMotionFilters,
  motionSearchText,
  type MotionFacetKey,
} from "@/lib/motion";

type MotionAsset = {
  _id: string;
  kind: "image" | "video";
  name?: string;
  fileName?: string;
  description?: string;
  agentDescription?: string;
  promptText?: string;
  sourceUrl?: string;
  tagNames: string[];
  isLiked?: boolean;
  createdAt: number;
  url?: string;
  thumbUrl?: string;
};

type MotionViewProps = { ownerUserId: string };

const CHIP_LIMIT = 14;

const titleOf = (asset: MotionAsset) =>
  asset.name?.trim() || asset.fileName?.replace(/\.[a-z0-9]+$/i, "") || "Untitled";

const prettyTag = (tag: string) => tag.replace(/-/g, " ");

const handleOf = (url?: string) => {
  const match = url?.match(/(?:x|twitter)\.com\/([^/]+)\/status/i);
  return match ? `@${match[1]}` : null;
};

// The Motion tab: every asset tagged `motion-design`, filtered on its own
// facets (technique, format, built with, feel) plus a text search. AND across
// facets, OR inside one. Owner-only.
export function MotionView({ ownerUserId }: MotionViewProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Partial<Record<MotionFacetKey, string[]>>>({});
  const [expanded, setExpanded] = useState<Partial<Record<MotionFacetKey, boolean>>>({});
  const [onlyLiked, setOnlyLiked] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useQuery(api.assets.listGalleryAssets, {
    ownerUserId,
    tagNames: [MOTION_TAG],
    limit: 2000,
  }) as MotionAsset[] | undefined;
  const allTags = useQuery(api.tags.listTags, {});

  // tag name (canonical) -> facet. Tags with no motion category still search
  // and show in the modal, they just have no filter row.
  const facetOfTag = useMemo(() => {
    const map = new Map<string, MotionFacetKey>();
    for (const tag of allTags ?? []) {
      if (tag.category && (MOTION_FACET_KEYS as string[]).includes(tag.category)) {
        map.set(canonicalTag(tag.name), tag.category as MotionFacetKey);
      }
    }
    return map;
  }, [allTags]);

  const indexed = useMemo(
    () => (rows ?? []).map((asset) => ({ ...asset, searchText: motionSearchText(asset) })),
    [rows],
  );

  // Counts per facet follow the other facets' selections, so a chip never
  // promises a result the current filter would hide.
  const facetCounts = useMemo(() => {
    const out = {} as Record<MotionFacetKey, { tag: string; count: number }[]>;
    for (const facet of MOTION_FACETS) {
      const others = { ...selected, [facet.key]: [] };
      const counts = new Map<string, number>();
      for (const asset of indexed) {
        if (!matchesMotionFilters(asset.tagNames, others)) continue;
        for (const name of asset.tagNames) {
          const tag = canonicalTag(name);
          if (facetOfTag.get(tag) === facet.key) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      out[facet.key] = [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    }
    return out;
  }, [facetOfTag, indexed, selected]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      indexed
        .filter(
          (asset) =>
            matchesMotionFilters(asset.tagNames, selected) &&
            (!onlyLiked || asset.isLiked) &&
            (!needle || asset.searchText.includes(needle)),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [indexed, needle, onlyLiked, selected],
  );

  const selectedCount = MOTION_FACET_KEYS.reduce((n, key) => n + (selected[key]?.length ?? 0), 0);
  const filtering = Boolean(needle || selectedCount || onlyLiked);
  const open = openId ? indexed.find((asset) => asset._id === openId) ?? null : null;
  const openIndex = open ? visible.findIndex((asset) => asset._id === open._id) : -1;

  const toggle = (key: MotionFacetKey, tag: string) =>
    setSelected((current) => {
      const picks = current[key] ?? [];
      return {
        ...current,
        [key]: picks.includes(tag) ? picks.filter((entry) => entry !== tag) : [...picks, tag],
      };
    });

  return (
    <div className="vref-root motion-root w-full">
      <div className="skills-toolbar">
        <div className="skills-toolbar-head">
          <div className="skills-toolbar-title">
            <Clapperboard className="h-3.5 w-3.5" style={{ color: "var(--coral)" }} />
            <span>Motion</span>
            <span className="skills-toolbar-count">
              {filtering && rows ? `${visible.length} / ` : ""}
              {rows?.length ?? "—"}
            </span>
          </div>
          <label className="skills-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search motion references, prompts, sources"
              aria-label="Search motion references"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
          <button
            type="button"
            className="skills-chip"
            data-active={onlyLiked}
            onClick={() => setOnlyLiked((value) => !value)}
          >
            <Heart className="h-2.5 w-2.5" aria-hidden /> Liked
          </button>
          {selectedCount > 0 && (
            <button type="button" className="skills-chip" onClick={() => setSelected({})}>
              Clear {selectedCount}
            </button>
          )}
        </div>

        {MOTION_FACETS.map((facet) => {
          const entries = facetCounts[facet.key] ?? [];
          if (entries.length === 0 && !(selected[facet.key]?.length ?? 0)) return null;
          const open = expanded[facet.key];
          const shown = open ? entries : entries.slice(0, CHIP_LIMIT);
          return (
            <div key={facet.key} className="skills-chip-row motion-facet-row" data-expanded="true">
              <span className="motion-facet-label" title={facet.hint}>
                {facet.label}
              </span>
              {shown.map((entry) => (
                <button
                  key={entry.tag}
                  type="button"
                  className="skills-chip vref-style-chip"
                  data-active={(selected[facet.key] ?? []).includes(entry.tag)}
                  onClick={() => toggle(facet.key, entry.tag)}
                >
                  {prettyTag(entry.tag)}
                  <span className="skills-chip-count">{entry.count}</span>
                </button>
              ))}
              {entries.length > CHIP_LIMIT && (
                <button
                  type="button"
                  className="skills-chip skills-chip-more"
                  onClick={() => setExpanded((current) => ({ ...current, [facet.key]: !open }))}
                >
                  {open ? "Fewer" : `+${entries.length - CHIP_LIMIT} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {rows === undefined ? (
        <div className="vref-grid" aria-busy>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="vref-card vref-card-skeleton" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center px-8 py-12 text-center lm-animate-fade-in">
          <Clapperboard className="mb-4 h-7 w-7" style={{ color: "var(--coral)" }} />
          <h2 className="skills-empty-title">{filtering ? "No motion matches" : "No motion references yet"}</h2>
          <p className="skills-empty-copy">
            {filtering
              ? "Loosen a filter or search in other words."
              : `Ask an agent to save a motion piece. Anything tagged ${MOTION_TAG} lands here, filtered by technique, format, tool and feel.`}
          </p>
        </div>
      ) : (
        <div className="vref-grid motion-grid">
          {visible.map((asset) => (
            <MotionCard key={asset._id} asset={asset} onOpen={() => setOpenId(asset._id)} facetOfTag={facetOfTag} />
          ))}
        </div>
      )}

      {open && (
        <MotionModal
          key={open._id}
          asset={open}
          facetOfTag={facetOfTag}
          onClose={() => setOpenId(null)}
          onStep={(delta) => {
            const next = visible[openIndex + delta];
            if (next) setOpenId(next._id);
          }}
          hasPrevious={openIndex > 0}
          hasNext={openIndex >= 0 && openIndex < visible.length - 1}
        />
      )}
    </div>
  );
}

type FacetMap = Map<string, MotionFacetKey>;

function MotionCard({
  asset,
  onOpen,
  facetOfTag,
}: {
  asset: MotionAsset;
  onOpen: () => void;
  facetOfTag: FacetMap;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const techniques = asset.tagNames
    .map(canonicalTag)
    .filter((tag) => facetOfTag.get(tag) === "motion_technique")
    .slice(0, 3);
  const handle = handleOf(asset.sourceUrl);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hover) void video.play().catch(() => undefined);
    else {
      video.pause();
      video.currentTime = 0;
    }
  }, [hover]);

  return (
    <button
      type="button"
      className="vref-card"
      data-liked={asset.isLiked ? "true" : undefined}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <span className="vref-thumb motion-thumb">
        {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" loading="lazy" /> : null}
        {asset.kind === "video" && asset.url && hover ? (
          <video ref={videoRef} src={asset.url} muted loop playsInline preload="none" />
        ) : null}
        {asset.isLiked && (
          <span className="vref-badge vref-badge-liked">
            <Heart className="h-2.5 w-2.5" fill="currentColor" />
          </span>
        )}
        {asset.kind === "video" && (
          <span className="vref-play" aria-hidden>
            <Play className="h-4 w-4" fill="currentColor" />
          </span>
        )}
      </span>
      <span className="vref-body">
        <span className="vref-title">{titleOf(asset)}</span>
        {asset.agentDescription && <span className="vref-channel motion-desc">{asset.agentDescription}</span>}
        <span className="motion-tags">
          {techniques.map((tag) => (
            <span key={tag} className="vref-style">
              {prettyTag(tag)}
            </span>
          ))}
          {handle && <span className="vref-meta">{handle}</span>}
        </span>
      </span>
    </button>
  );
}

function MotionModal({
  asset,
  facetOfTag,
  onClose,
  onStep,
  hasPrevious,
  hasNext,
}: {
  asset: MotionAsset;
  facetOfTag: FacetMap;
  onClose: () => void;
  onStep: (delta: number) => void;
  hasPrevious: boolean;
  hasNext: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrevious) onStep(-1);
      if (event.key === "ArrowRight" && hasNext) onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNext, hasPrevious, onClose, onStep]);

  const tags = asset.tagNames.map(canonicalTag);
  const grouped = MOTION_FACETS.map((facet) => ({
    facet,
    tags: tags.filter((tag) => facetOfTag.get(tag) === facet.key),
  })).filter((group) => group.tags.length > 0);
  const handle = handleOf(asset.sourceUrl);

  return (
    <div className="vref-modal" role="dialog" aria-modal="true" aria-label={titleOf(asset)}>
      <div className="vref-modal-scrim" onClick={onClose} />
      <div className="vref-modal-panel">
        <div className="vref-modal-stage">
          <div className="vref-player motion-player">
            {asset.kind === "video" && asset.url ? (
              <video src={asset.url} poster={asset.thumbUrl} controls autoPlay loop playsInline />
            ) : asset.url || asset.thumbUrl ? (
              <img src={asset.url ?? asset.thumbUrl} alt={titleOf(asset)} />
            ) : null}
          </div>
        </div>
        <div className="motion-side">
          <button type="button" className="motion-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
          <h2 className="skills-empty-title">{titleOf(asset)}</h2>
          {handle && <p className="vref-meta">{handle}</p>}
          {asset.agentDescription && <p className="motion-copy">{asset.agentDescription}</p>}
          {grouped.map(({ facet, tags: facetTags }) => (
            <div key={facet.key} className="motion-modal-facet">
              <span className="motion-facet-label">{facet.label}</span>
              <span className="motion-tags">
                {facetTags.map((tag) => (
                  <span key={tag} className="vref-style">
                    {prettyTag(tag)}
                  </span>
                ))}
              </span>
            </div>
          ))}
          {asset.promptText && (
            <div className="motion-prompt">
              <div className="motion-prompt-head">
                <span className="motion-facet-label">Prompt / template</span>
                <button
                  type="button"
                  className="skills-chip"
                  onClick={() => {
                    void navigator.clipboard.writeText(asset.promptText ?? "").then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    });
                  }}
                >
                  <Copy className="h-2.5 w-2.5" aria-hidden /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre>{asset.promptText}</pre>
            </div>
          )}
          {asset.sourceUrl && (
            <a className="skills-chip" href={asset.sourceUrl} target="_blank" rel="noreferrer">
              Source <ArrowUpRight className="h-2.5 w-2.5" aria-hidden />
            </a>
          )}
          <p className="motion-id">asset:{asset._id}</p>
        </div>
      </div>
    </div>
  );
}
