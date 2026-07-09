"use client";

/* eslint-disable @next/next/no-img-element -- review images render raw <img>/
   <video> at large size (like storybook-modal); next/image adds no value here
   and its optimizer is bypassed for R2 URLs anyway. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  Play,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const APPROVED_TAG = "approved";
const ALL_COLLECTIONS = "__all__";

type CollectionOption = { id: string; name: string; count?: number };

type ReviewModalProps = {
  ownerUserId: string;
  /** Folder id of the open project, or null when closed. */
  projectId: string | null;
  /** All of the owner's plain collections, for the "add collections" picker. */
  allCollections: CollectionOption[];
  onClose: () => void;
};

type ReviewAsset = {
  id: string;
  url?: string;
  thumbUrl?: string;
  kind: "image" | "video";
  contentType?: string;
  width?: number;
  height?: number;
  promptText?: string;
  modelName?: string;
  approvedByTag: boolean;
  collectionId: string;
  collectionName: string;
};

/**
 * Fullscreen project review workspace. Walks every asset across a project's
 * member collections at large size. Two modes: a big-tile masonry (default)
 * and a hero + horizontal filmstrip focus mode you reach by clicking a tile.
 * "Approve" toggles the global `approved` tag so the shortlist is filterable
 * everywhere (project + approved).
 */
export function ReviewModal({
  ownerUserId,
  projectId,
  allCollections,
  onClose,
}: ReviewModalProps) {
  const project = useQuery(
    api.projects.getProject,
    projectId
      ? { ownerUserId, projectId: projectId as Id<"folders"> }
      : "skip",
  );

  const setApproved = useMutation(api.assets.setAssetApproved);
  const addCollection = useMutation(api.projects.addCollectionToProject);
  const removeCollection = useMutation(api.projects.removeCollectionFromProject);

  const [activeCollection, setActiveCollection] = useState<string>(ALL_COLLECTIONS);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optimistic approve overrides so toggling feels instant before the query
  // re-emits with updated tagNames.
  const [approveOverride, setApproveOverride] = useState<Record<string, boolean>>(
    {},
  );

  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  // Per-open transient state resets via the `key={projectId}` remount in the
  // dashboard — no reset effect needed.

  const memberCollectionIds = useMemo(
    () => new Set((project?.collections ?? []).map((c) => c.folderId as string)),
    [project],
  );

  // Flatten collections → assets. "All" dedupes by asset id (first collection
  // wins the label); a specific collection keeps only its own.
  const assets = useMemo<ReviewAsset[]>(() => {
    if (!project) return [];
    const out: ReviewAsset[] = [];
    const seen = new Set<string>();
    for (const collection of project.collections) {
      for (const asset of collection.assets) {
        const id = asset._id as string;
        if (activeCollection === ALL_COLLECTIONS) {
          if (seen.has(id)) continue;
          seen.add(id);
        } else if ((collection.folderId as string) !== activeCollection) {
          continue;
        }
        out.push({
          id,
          url: asset.url ?? asset.thumbUrl,
          thumbUrl: asset.thumbUrl ?? asset.url,
          kind: asset.kind,
          contentType: asset.contentType,
          width: asset.width,
          height: asset.height,
          promptText: asset.promptText,
          modelName: asset.modelName,
          approvedByTag: (asset.tagNames ?? []).includes(APPROVED_TAG),
          collectionId: collection.folderId as string,
          collectionName: collection.name,
        });
      }
    }
    return out;
  }, [project, activeCollection]);

  const isApproved = useCallback(
    (asset: ReviewAsset) =>
      asset.id in approveOverride
        ? approveOverride[asset.id]
        : asset.approvedByTag,
    [approveOverride],
  );

  const visibleAssets = useMemo(
    () => (approvedOnly ? assets.filter(isApproved) : assets),
    [assets, approvedOnly, isApproved],
  );

  const approvedCount = useMemo(
    () => assets.filter(isApproved).length,
    [assets, isApproved],
  );

  const focusIndex = focusId
    ? visibleAssets.findIndex((a) => a.id === focusId)
    : -1;
  const focusAsset = focusIndex >= 0 ? visibleAssets[focusIndex] : null;
  // Drives the header/chip layout. Derived (not focusId) so a focus that fell
  // out of the visible set — e.g. after a filter change — cleanly reverts to
  // the grid without a state-syncing effect.
  const inFocus = Boolean(focusAsset);

  const toggleApprove = useCallback(
    (asset: ReviewAsset) => {
      const next = !isApproved(asset);
      setApproveOverride((prev) => ({ ...prev, [asset.id]: next }));
      void setApproved({
        ownerUserId,
        assetId: asset.id as Id<"assets">,
        approved: next,
      }).catch(() => {
        // Roll back on failure.
        setApproveOverride((prev) => ({ ...prev, [asset.id]: !next }));
      });
    },
    [isApproved, ownerUserId, setApproved],
  );

  const goFocus = useCallback((delta: number) => {
    setFocusId((current) => {
      if (!current) return current;
      const idx = visibleAssets.findIndex((a) => a.id === current);
      if (idx < 0) return current;
      const nextIdx = Math.min(
        visibleAssets.length - 1,
        Math.max(0, idx + delta),
      );
      return visibleAssets[nextIdx]?.id ?? current;
    });
  }, [visibleAssets]);

  // Keyboard: Esc backs out (focus → grid → close); arrows navigate in focus.
  useEffect(() => {
    if (!projectId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pickerOpen) setPickerOpen(false);
        else if (focusId) setFocusId(null);
        else onClose();
      } else if (focusId && e.key === "ArrowLeft") {
        e.preventDefault();
        goFocus(-1);
      } else if (focusId && e.key === "ArrowRight") {
        e.preventDefault();
        goFocus(1);
      } else if (focusId && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        if (focusAsset) toggleApprove(focusAsset);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId, pickerOpen, focusId, focusAsset, goFocus, toggleApprove, onClose]);

  // Keep the active filmstrip thumb centered as focus moves.
  useEffect(() => {
    if (!focusId) return;
    activeThumbRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [focusId]);

  if (!projectId) return null;

  const chips: CollectionOption[] = [
    { id: ALL_COLLECTIONS, name: "All", count: undefined },
    ...(project?.collections ?? []).map((c) => ({
      id: c.folderId as string,
      name: c.name,
      count: c.count,
    })),
  ];

  const isLoading = project === undefined;
  const projectName = project?.project.name ?? "Project";
  const hasCollections = (project?.collections.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col lm-animate-fade-in"
      style={{
        backgroundColor: "rgba(8,7,6,0.985)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        fontFamily: "var(--lm-font)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Review: ${projectName}`}
    >
      {/* ── Header ── */}
      <header
        className="flex items-center gap-3 px-4 py-3 md:px-6"
        style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--lm-coral)" }}
          >
            Review
          </span>
          <span
            className="truncate text-[15px] font-semibold"
            style={{ color: "var(--lm-text-primary)" }}
          >
            {projectName}
          </span>
          <span
            className="shrink-0 text-[11px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {visibleAssets.length} shown · {approvedCount} approved
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {inFocus && (
            <button
              type="button"
              onClick={() => setFocusId(null)}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{
                borderColor: "var(--lm-border-strong)",
                color: "var(--lm-text-secondary)",
              }}
              title="Back to grid (Esc)"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </button>
          )}
          <button
            type="button"
            onClick={() => setApprovedOnly((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
            style={{
              borderColor: approvedOnly
                ? "var(--lm-coral)"
                : "var(--lm-border-strong)",
              backgroundColor: approvedOnly ? "var(--lm-coral)" : "transparent",
              color: approvedOnly ? "#000" : "var(--lm-text-secondary)",
            }}
            aria-pressed={approvedOnly}
            title="Show only approved"
          >
            <Check className="h-3.5 w-3.5" />
            Approved
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            title="Add or remove collections"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Collections
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            aria-label="Close review"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Collection filter chips ── */}
      {hasCollections && !inFocus && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
          {chips.map((chip) => {
            const active = activeCollection === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setActiveCollection(chip.id)}
                className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: active
                    ? "var(--lm-coral)"
                    : "var(--lm-border-strong)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--lm-coral) 16%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--lm-coral)"
                    : "var(--lm-text-secondary)",
                }}
              >
                {chip.name}
                {chip.count !== undefined && (
                  <span style={{ opacity: 0.6 }}> {chip.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Body ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div
            className="flex h-full items-center justify-center text-[13px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            Loading project…
          </div>
        ) : !hasCollections ? (
          <EmptyState
            title="No collections in this project yet"
            hint="Add collections (Characters, Locations, Styles…) to review their options together."
            actionLabel="Add collections"
            onAction={() => setPickerOpen(true)}
          />
        ) : visibleAssets.length === 0 ? (
          <EmptyState
            title={approvedOnly ? "Nothing approved yet" : "No assets here"}
            hint={
              approvedOnly
                ? "Approve options to build the showcase shortlist."
                : "This collection has no assets."
            }
          />
        ) : focusAsset ? (
          <FocusView
            asset={focusAsset}
            index={focusIndex}
            total={visibleAssets.length}
            approved={isApproved(focusAsset)}
            onApprove={() => toggleApprove(focusAsset)}
            onPrev={() => goFocus(-1)}
            onNext={() => goFocus(1)}
            filmstrip={visibleAssets}
            filmstripRef={filmstripRef}
            activeThumbRef={activeThumbRef}
            isApproved={isApproved}
            onPick={(id) => setFocusId(id)}
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            <div
              className="columns-1 sm:columns-2 lg:columns-3"
              style={{ columnGap: "14px" }}
            >
              {visibleAssets.map((asset) => (
                <ReviewTile
                  key={asset.id}
                  asset={asset}
                  approved={isApproved(asset)}
                  onOpen={() => setFocusId(asset.id)}
                  onApprove={() => toggleApprove(asset)}
                  showCollectionLabel={activeCollection === ALL_COLLECTIONS}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Add-collections picker ── */}
      {pickerOpen && (
        <CollectionPicker
          allCollections={allCollections}
          memberIds={memberCollectionIds}
          onToggle={(folderId, isMember) => {
            if (!projectId) return;
            if (isMember) {
              void removeCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId: folderId as Id<"folders">,
              });
            } else {
              void addCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId: folderId as Id<"folders">,
              });
            }
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Large masonry tile ── */
function ReviewTile({
  asset,
  approved,
  onOpen,
  onApprove,
  showCollectionLabel,
}: {
  asset: ReviewAsset;
  approved: boolean;
  onOpen: () => void;
  onApprove: () => void;
  showCollectionLabel: boolean;
}) {
  return (
    <div
      className="group relative mb-3.5 block break-inside-avoid cursor-pointer overflow-hidden rounded-xl"
      style={{
        border: approved
          ? "2px solid var(--lm-coral)"
          : "1px solid var(--lm-border-subtle)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      onClick={onOpen}
    >
      <div
        className="relative w-full"
        style={{
          aspectRatio:
            asset.width && asset.height
              ? `${asset.width} / ${asset.height}`
              : "1 / 1",
        }}
      >
        <Media asset={asset} variant="tile" />
      </div>

      {/* Approve toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onApprove();
        }}
        className={`absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
          approved
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
        style={{
          backgroundColor: approved ? "var(--lm-coral)" : "rgba(0,0,0,0.62)",
          color: approved ? "#000" : "#fff",
          borderColor: approved ? "var(--lm-coral)" : "rgba(255,255,255,0.25)",
        }}
        aria-pressed={approved}
        title={approved ? "Approved — click to remove" : "Approve"}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
        {approved ? "Approved" : "Approve"}
      </button>

      {showCollectionLabel && (
        <div
          className="absolute bottom-2.5 left-2.5 z-10 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
        >
          {asset.collectionName}
        </div>
      )}
    </div>
  );
}

/* ── Focus view: hero + filmstrip ── */
function FocusView({
  asset,
  index,
  total,
  approved,
  onApprove,
  onPrev,
  onNext,
  filmstrip,
  filmstripRef,
  activeThumbRef,
  isApproved,
  onPick,
}: {
  asset: ReviewAsset;
  index: number;
  total: number;
  approved: boolean;
  onApprove: () => void;
  onPrev: () => void;
  onNext: () => void;
  filmstrip: ReviewAsset[];
  filmstripRef: React.RefObject<HTMLDivElement | null>;
  activeThumbRef: React.RefObject<HTMLButtonElement | null>;
  isApproved: (a: ReviewAsset) => boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center p-3 md:p-6">
          <Media asset={asset} variant="hero" />
        </div>

        {index > 0 && (
          <HeroArrow side="left" onClick={onPrev} />
        )}
        {index < total - 1 && (
          <HeroArrow side="right" onClick={onNext} />
        )}

        {/* Caption + approve */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 md:p-6">
          <div className="pointer-events-auto min-w-0">
            {asset.modelName && (
              <div
                className="mb-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: "rgba(0,0,0,0.55)",
                  color: "var(--lm-text-secondary)",
                }}
              >
                {asset.modelName} · {asset.collectionName}
              </div>
            )}
            {asset.promptText && (
              <p
                className="max-w-[62ch] text-[11px] leading-snug"
                style={{
                  color: "rgba(255,255,255,0.82)",
                  textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                }}
              >
                {asset.promptText.length > 220
                  ? `${asset.promptText.slice(0, 220)}…`
                  : asset.promptText}
              </p>
            )}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <span
              className="text-[11px] font-mono"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {index + 1}/{total}
            </span>
            <button
              type="button"
              onClick={onApprove}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
              style={{
                backgroundColor: approved ? "var(--lm-coral)" : "rgba(0,0,0,0.62)",
                color: approved ? "#000" : "#fff",
                borderColor: approved
                  ? "var(--lm-coral)"
                  : "rgba(255,255,255,0.25)",
              }}
              aria-pressed={approved}
              title="Approve (Space)"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
              {approved ? "Approved" : "Approve"}
            </button>
          </div>
        </div>
      </div>

      {/* Filmstrip — horizontal, trackpad-scrollable */}
      <div
        ref={filmstripRef}
        className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-3"
        style={{
          borderTop: "1px solid var(--lm-border-strong)",
          scrollbarWidth: "thin",
        }}
      >
        {filmstrip.map((item) => {
          const active = item.id === asset.id;
          const itemApproved = isApproved(item);
          return (
            <button
              key={item.id}
              ref={active ? activeThumbRef : undefined}
              type="button"
              onClick={() => onPick(item.id)}
              className="relative h-24 shrink-0 overflow-hidden rounded-lg transition-all md:h-28"
              style={{
                width: "auto",
                aspectRatio:
                  item.width && item.height
                    ? `${item.width} / ${item.height}`
                    : "1 / 1",
                outline: active
                  ? "2px solid var(--lm-coral)"
                  : "1px solid var(--lm-border-subtle)",
                outlineOffset: active ? "0px" : "0px",
                opacity: active ? 1 : 0.62,
              }}
              title={item.collectionName}
            >
              <Media asset={item} variant="thumb" />
              {itemApproved && (
                <span
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--lm-coral)" }}
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} color="#000" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HeroArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border transition-opacity hover:opacity-100 ${
        side === "left" ? "left-3" : "right-3"
      }`}
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        borderColor: "rgba(255,255,255,0.2)",
        color: "#fff",
        opacity: 0.7,
      }}
      aria-label={side === "left" ? "Previous" : "Next"}
    >
      {side === "left" ? (
        <ChevronLeft className="h-6 w-6" />
      ) : (
        <ChevronRight className="h-6 w-6" />
      )}
    </button>
  );
}

/* ── Media renderer (raw img/video, like storybook-modal) ── */
function Media({
  asset,
  variant,
}: {
  asset: ReviewAsset;
  variant: "tile" | "hero" | "thumb";
}) {
  const isVideo = asset.kind === "video";
  const src =
    variant === "hero" ? asset.url ?? asset.thumbUrl : asset.thumbUrl ?? asset.url;

  if (variant === "hero") {
    // Centered, fully visible; parent flex-centers it.
    if (isVideo) {
      return (
        <div className="relative flex max-h-full max-w-full items-center justify-center">
          <video
            src={asset.url}
            poster={asset.thumbUrl}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            className="max-h-full max-w-full object-contain"
            style={{ maxHeight: "78vh" }}
          />
        </div>
      );
    }
    return (
      <img
        src={src}
        alt={asset.promptText ?? asset.collectionName}
        className="max-h-full max-w-full object-contain"
        style={{ maxHeight: "82vh" }}
      />
    );
  }

  // tile / thumb: fill the boxed parent (absolute inset).
  if (isVideo) {
    return (
      <>
        <video
          poster={asset.thumbUrl}
          muted
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <Play className="ml-0.5 h-4 w-4" fill="#fff" color="#fff" />
        </span>
      </>
    );
  }
  return (
    <img
      src={src}
      alt={asset.promptText ?? asset.collectionName}
      loading="lazy"
      className={`absolute inset-0 h-full w-full object-cover ${
        variant === "tile"
          ? "transition-transform duration-200 group-hover:scale-[1.02]"
          : ""
      }`}
    />
  );
}

/* ── Add/remove collections picker ── */
function CollectionPicker({
  allCollections,
  memberIds,
  onToggle,
  onClose,
}: {
  allCollections: CollectionOption[];
  memberIds: Set<string>;
  onToggle: (folderId: string, isMember: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-end p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="mt-14 flex max-h-[70vh] w-[320px] flex-col overflow-hidden rounded-xl"
        style={{
          backgroundColor: "var(--lm-surface-1)",
          border: "2px solid var(--lm-ink)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-3.5 py-2.5"
          style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
        >
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            Collections in project
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70"
            style={{ color: "var(--lm-text-secondary)" }}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {allCollections.length === 0 && (
            <p
              className="px-3.5 py-3 text-[12px]"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              No collections yet. Create collections first, then add them here.
            </p>
          )}
          {allCollections.map((collection) => {
            const isMember = memberIds.has(collection.id);
            return (
              <button
                key={collection.id}
                type="button"
                onClick={() => onToggle(collection.id, isMember)}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left transition-opacity hover:opacity-75"
                style={{ color: "var(--lm-text-primary)" }}
              >
                <span className="flex items-center gap-2 truncate text-[13px] font-medium">
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{
                      backgroundColor: isMember
                        ? "var(--lm-coral)"
                        : "transparent",
                      border: isMember
                        ? "1px solid var(--lm-coral)"
                        : "1px solid var(--lm-border-strong)",
                    }}
                  >
                    {isMember ? (
                      <Check className="h-3 w-3" strokeWidth={3} color="#000" />
                    ) : (
                      <Plus className="h-3 w-3" color="var(--lm-text-tertiary)" />
                    )}
                  </span>
                  <span className="truncate">{collection.name}</span>
                </span>
                {collection.count !== undefined && (
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    {collection.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <p
        className="text-[15px] font-semibold"
        style={{ color: "var(--lm-text-primary)" }}
      >
        {title}
      </p>
      <p
        className="max-w-[42ch] text-[13px]"
        style={{ color: "var(--lm-text-tertiary)" }}
      >
        {hint}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-mono font-bold uppercase tracking-wider"
          style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
