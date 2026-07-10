"use client";

/* eslint-disable @next/next/no-img-element -- review images render raw <img>/
   <video> at large size (like storybook-modal); next/image adds no value here
   and its optimizer is bypassed for R2 URLs anyway. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  FolderPlus,
  LayoutGrid,
  Link2,
  Play,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const APPROVED_TAG = "approved";

type CollectionOption = { id: string; name: string; count?: number };

/** The project's layers. Each layer holds "directions" — collections of
 * similar options with a master (cover) thumbnail. */
type ProjectSection = "characters" | "locations" | "beats";
type ReviewTab = "all" | ProjectSection | "unsorted";

const SECTION_TABS: { key: ProjectSection; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "beats", label: "Beats" },
];

const TAB_LABELS: Record<ReviewTab, string> = {
  all: "All",
  characters: "Characters",
  locations: "Locations",
  beats: "Beats",
  unsorted: "Unsorted",
};

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

type DirectionCardData = {
  id: string;
  name: string;
  count: number;
  section?: ProjectSection;
  cover: ReviewAsset | null;
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
  const setCollectionSection = useMutation(api.projects.setProjectCollectionSection);
  const setFolderCover = useMutation(api.folders.setFolderCover);
  const createFolder = useMutation(api.folders.createFolder);
  const enableShare = useMutation(api.directionBoard.enableShare);
  const disableShare = useMutation(api.directionBoard.disableShare);
  const shareState = useQuery(
    api.directionBoard.getShareState,
    projectId
      ? { ownerUserId, projectId: projectId as Id<"folders"> }
      : "skip",
  );

  const [activeTab, setActiveTab] = useState<ReviewTab>("all");
  // Direction currently drilled into (a member collection id), or null when
  // browsing a layer's direction cards / the flat All view.
  const [openDirectionId, setOpenDirectionId] = useState<string | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Optimistic approve overrides so toggling feels instant before the query
  // re-emits with updated tagNames.
  const [approveOverride, setApproveOverride] = useState<Record<string, boolean>>(
    {},
  );
  // Optimistic master (cover) override per collection id; null = cleared.
  const [coverOverride, setCoverOverride] = useState<
    Record<string, string | null>
  >({});

  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  // Per-open transient state resets via the `key={projectId}` remount in the
  // dashboard — no reset effect needed.

  const memberCollectionIds = useMemo(
    () => new Set((project?.collections ?? []).map((c) => c.folderId as string)),
    [project],
  );

  type ProjectCollection = NonNullable<typeof project>["collections"][number];

  const toReviewAsset = useCallback(
    (
      asset: ProjectCollection["assets"][number],
      collection: ProjectCollection,
    ): ReviewAsset => ({
      id: asset._id as string,
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
    }),
    [],
  );

  // Which tab a collection files under; no section = "unsorted".
  const tabOf = (section: string | undefined): ReviewTab =>
    (section as ProjectSection | undefined) ?? "unsorted";

  // Collections visible in the active tab.
  const tabCollections = useMemo<ProjectCollection[]>(() => {
    const collections = project?.collections ?? [];
    if (activeTab === "all") return collections;
    return collections.filter((c) => tabOf(c.section) === activeTab);
  }, [project, activeTab]);

  // The drilled-into direction, if it still exists in the project.
  const openDirection = useMemo<ProjectCollection | null>(
    () =>
      (openDirectionId &&
        (project?.collections ?? []).find(
          (c) => (c.folderId as string) === openDirectionId,
        )) ||
      null,
    [project, openDirectionId],
  );

  const resolveCoverId = useCallback(
    (collection: ProjectCollection): string | null => {
      const collectionId = collection.folderId as string;
      if (collectionId in coverOverride) return coverOverride[collectionId]!;
      return (collection.coverAssetId as string | undefined) ?? null;
    },
    [coverOverride],
  );

  // Direction cards for a layer tab: one card per collection, thumbed by its
  // MASTER option (cover asset) with first-asset fallback.
  const directions = useMemo<DirectionCardData[]>(
    () =>
      tabCollections.map((collection) => {
        const coverId = resolveCoverId(collection);
        const coverAsset =
          (coverId &&
            collection.assets.find((a) => (a._id as string) === coverId)) ||
          collection.assets[0] ||
          null;
        return {
          id: collection.folderId as string,
          name: collection.name,
          count: collection.count,
          section: collection.section as ProjectSection | undefined,
          cover: coverAsset ? toReviewAsset(coverAsset, collection) : null,
        };
      }),
    [tabCollections, resolveCoverId, toReviewAsset],
  );

  // Flatten the current scope → assets. Drilled direction wins; otherwise the
  // active tab's collections, deduped by asset id (first collection wins).
  const assets = useMemo<ReviewAsset[]>(() => {
    const source = openDirection ? [openDirection] : tabCollections;
    const out: ReviewAsset[] = [];
    const seen = new Set<string>();
    for (const collection of source) {
      for (const asset of collection.assets) {
        const id = asset._id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(toReviewAsset(asset, collection));
      }
    }
    return out;
  }, [openDirection, tabCollections, toReviewAsset]);

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

  // Set (or clear, when assetId is null) a direction's MASTER option.
  const setMaster = useCallback(
    (collectionId: string, assetId: string | null) => {
      setCoverOverride((prev) => ({ ...prev, [collectionId]: assetId }));
      void setFolderCover({
        ownerUserId,
        folderId: collectionId as Id<"folders">,
        assetId: assetId as Id<"assets"> | null,
      }).catch(() => {
        // Roll back to server truth on failure.
        setCoverOverride((prev) => {
          const next = { ...prev };
          delete next[collectionId];
          return next;
        });
      });
    },
    [ownerUserId, setFolderCover],
  );

  // Refile a direction under another layer (null = unsorted).
  const refileDirection = useCallback(
    (collectionId: string, section: ProjectSection | null) => {
      if (!projectId) return;
      void setCollectionSection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: collectionId as Id<"folders">,
        section,
      });
    },
    [ownerUserId, projectId, setCollectionSection],
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
        if (shareOpen) setShareOpen(false);
        else if (pickerOpen) setPickerOpen(false);
        else if (focusId) setFocusId(null);
        else if (openDirectionId) setOpenDirectionId(null);
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
  }, [projectId, pickerOpen, shareOpen, focusId, focusAsset, openDirectionId, goFocus, toggleApprove, onClose]);

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

  const isLoading = project === undefined;
  const projectName = project?.project.name ?? "Project";
  const hasCollections = (project?.collections.length ?? 0) > 0;

  // Layer tabs: All + the three layers (+ Unsorted only when needed).
  const allCollections2 = project?.collections ?? [];
  const directionCountBy = (tab: ReviewTab) =>
    allCollections2.filter((c) => tabOf(c.section) === tab).length;
  const unsortedCount = directionCountBy("unsorted");
  const tabs: { key: ReviewTab; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    ...SECTION_TABS.map(({ key, label }) => ({
      key: key as ReviewTab,
      label,
      count: directionCountBy(key),
    })),
    ...(unsortedCount > 0
      ? [{ key: "unsorted" as ReviewTab, label: "Unsorted", count: unsortedCount }]
      : []),
  ];

  // Direction-cards browsing mode: a layer tab with nothing drilled into.
  const showDirectionCards = activeTab !== "all" && !openDirection;
  const openDirectionMasterId = openDirection
    ? resolveCoverId(openDirection)
    : null;

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
            {showDirectionCards
              ? `${directions.length} ${
                  directions.length === 1 ? "direction" : "directions"
                }`
              : `${visibleAssets.length} shown · ${approvedCount} approved`}
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
            onClick={() => setShareOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: shareState?.enabled
                ? "var(--lm-coral)"
                : "var(--lm-border-strong)",
              color: shareState?.enabled
                ? "var(--lm-coral)"
                : "var(--lm-text-secondary)",
            }}
            title="Share a read-only direction board link"
          >
            <Link2 className="h-3.5 w-3.5" />
            Share
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

      {/* ── Layer tabs ── */}
      {hasCollections && !inFocus && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setOpenDirectionId(null);
                }}
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
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span style={{ opacity: 0.6 }}> {tab.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Drilled direction breadcrumb ── */}
      {openDirection && !inFocus && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 md:px-6">
          <button
            type="button"
            onClick={() => setOpenDirectionId(null)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            title="Back to directions (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {TAB_LABELS[activeTab]}
          </button>
          <span
            className="truncate text-[14px] font-semibold"
            style={{ color: "var(--lm-text-primary)" }}
          >
            {openDirection.name}
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {openDirection.count}{" "}
            {openDirection.count === 1 ? "option" : "options"}
          </span>

          {/* Refile this direction under another layer */}
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              Layer
            </span>
            {SECTION_TABS.map(({ key, label }) => {
              const current = tabOf(openDirection.section) === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    refileDirection(
                      openDirection.folderId as string,
                      current ? null : key,
                    )
                  }
                  className="rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    borderColor: current
                      ? "var(--lm-coral)"
                      : "var(--lm-border-strong)",
                    color: current
                      ? "var(--lm-coral)"
                      : "var(--lm-text-tertiary)",
                  }}
                  aria-pressed={current}
                  title={
                    current
                      ? `Filed under ${label} — click to unfile`
                      : `File under ${label}`
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
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
        ) : showDirectionCards ? (
          directions.length === 0 ? (
            <EmptyState
              title={`No directions in ${TAB_LABELS[activeTab]} yet`}
              hint="A direction is a collection of similar options with a master thumbnail. Add or create one for this layer."
              actionLabel="Add direction"
              onAction={() => setPickerOpen(true)}
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
              <div
                className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4"
                style={{ columnGap: "14px" }}
              >
                {directions.map((direction) => (
                  <DirectionCard
                    key={direction.id}
                    direction={direction}
                    onOpen={() => setOpenDirectionId(direction.id)}
                  />
                ))}
              </div>
            </div>
          )
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
            isMaster={
              openDirection ? openDirectionMasterId === focusAsset.id : undefined
            }
            onMaster={
              openDirection
                ? () =>
                    setMaster(
                      openDirection.folderId as string,
                      openDirectionMasterId === focusAsset.id
                        ? null
                        : focusAsset.id,
                    )
                : undefined
            }
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
                  showCollectionLabel={activeTab === "all"}
                  isMaster={
                    openDirection ? openDirectionMasterId === asset.id : undefined
                  }
                  onMaster={
                    openDirection
                      ? () =>
                          setMaster(
                            openDirection.folderId as string,
                            openDirectionMasterId === asset.id
                              ? null
                              : asset.id,
                          )
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Share panel ── */}
      {shareOpen && (
        <SharePanel
          token={shareState?.token}
          onEnable={async () => {
            if (!projectId) return "";
            const { token } = await enableShare({
              ownerUserId,
              projectId: projectId as Id<"folders">,
            });
            return token;
          }}
          onDisable={async () => {
            if (!projectId) return;
            await disableShare({
              ownerUserId,
              projectId: projectId as Id<"folders">,
            });
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* ── Add-collections picker ── */}
      {pickerOpen && (
        <CollectionPicker
          allCollections={allCollections}
          memberIds={memberCollectionIds}
          // Adding from a layer tab files the collection into that layer.
          section={
            activeTab !== "all" && activeTab !== "unsorted" ? activeTab : null
          }
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
                section:
                  activeTab !== "all" && activeTab !== "unsorted"
                    ? activeTab
                    : undefined,
              });
            }
          }}
          onCreate={(name) => {
            if (!projectId) return;
            void (async () => {
              const { folderId } = await createFolder({ ownerUserId, name });
              await addCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId,
                section:
                  activeTab !== "all" && activeTab !== "unsorted"
                    ? activeTab
                    : undefined,
              });
            })();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Direction card: a collection of similar options, thumbed by its master ── */
function DirectionCard({
  direction,
  onOpen,
}: {
  direction: DirectionCardData;
  onOpen: () => void;
}) {
  const cover = direction.cover;
  return (
    <div
      className="group relative mb-3.5 block break-inside-avoid cursor-pointer overflow-hidden rounded-xl"
      style={{
        border: "1px solid var(--lm-border-strong)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      onClick={onOpen}
      role="button"
      aria-label={`Open direction: ${direction.name}`}
    >
      <div
        className="relative w-full"
        style={{
          aspectRatio:
            cover?.width && cover?.height
              ? `${cover.width} / ${cover.height}`
              : "4 / 5",
        }}
      >
        {cover ? (
          <Media asset={cover} variant="tile" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-[11px] font-mono uppercase tracking-wider"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              color: "var(--lm-text-ghost)",
            }}
          >
            Empty
          </div>
        )}

        {/* Bottom label over a gradient so any master image stays readable */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.74), rgba(0,0,0,0.28) 60%, transparent)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <div className="min-w-0">
            <p
              className="truncate text-[14px] font-semibold"
              style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
            >
              {direction.name}
            </p>
            <p
              className="text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{ color: "rgba(255,255,255,0.68)" }}
            >
              {direction.count} {direction.count === 1 ? "option" : "options"}
            </p>
          </div>
          <span
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
          >
            Explore
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
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
  isMaster,
  onMaster,
}: {
  asset: ReviewAsset;
  approved: boolean;
  onOpen: () => void;
  onApprove: () => void;
  showCollectionLabel: boolean;
  /** Only defined inside a drilled direction, where "master" is unambiguous. */
  isMaster?: boolean;
  onMaster?: () => void;
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

      {/* Master (direction thumbnail) toggle */}
      {onMaster && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMaster();
          }}
          className={`absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
            isMaster ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{
            backgroundColor: isMaster ? "var(--lm-ink)" : "rgba(0,0,0,0.62)",
            color: isMaster ? "var(--lm-paper)" : "#fff",
            borderColor: isMaster
              ? "var(--lm-ink)"
              : "rgba(255,255,255,0.25)",
          }}
          aria-pressed={Boolean(isMaster)}
          title={
            isMaster
              ? "Master option — click to unset"
              : "Make master (direction thumbnail)"
          }
        >
          <Crown className="h-3 w-3" strokeWidth={2.5} />
          Master
        </button>
      )}

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
  isMaster,
  onMaster,
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
  /** Only defined inside a drilled direction, where "master" is unambiguous. */
  isMaster?: boolean;
  onMaster?: () => void;
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
            {onMaster && (
              <button
                type="button"
                onClick={onMaster}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
                style={{
                  backgroundColor: isMaster
                    ? "var(--lm-ink)"
                    : "rgba(0,0,0,0.62)",
                  color: isMaster ? "var(--lm-paper)" : "#fff",
                  borderColor: isMaster
                    ? "var(--lm-ink)"
                    : "rgba(255,255,255,0.25)",
                }}
                aria-pressed={Boolean(isMaster)}
                title={
                  isMaster
                    ? "Master option — click to unset"
                    : "Make master (direction thumbnail)"
                }
              >
                <Crown className="h-4 w-4" strokeWidth={2.5} />
                Master
              </button>
            )}
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

/* ── Share direction board panel ── */
function SharePanel({
  token,
  onEnable,
  onDisable,
  onClose,
}: {
  token: string | undefined;
  onEnable: () => Promise<string>;
  onDisable: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const boardUrl = token ? `${window.location.origin}/b/${token}` : null;

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — the URL stays visible for manual copy.
    }
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const newToken = await onEnable();
      if (newToken) {
        await copyLink(`${window.location.origin}/b/${newToken}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await onDisable();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-end p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="mt-14 w-[340px] overflow-hidden rounded-xl"
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
            Direction board link
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

        <div className="px-3.5 py-3">
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--lm-text-secondary)" }}
          >
            Anyone with the link can view and download this project’s assets —
            no account needed.
          </p>

          {boardUrl ? (
            <>
              <div
                className="mt-3 truncate rounded-lg px-2.5 py-2 text-[11px] font-mono"
                style={{
                  backgroundColor: "var(--lm-surface-2)",
                  color: "var(--lm-text-secondary)",
                  border: "1px solid var(--lm-border)",
                }}
                title={boardUrl}
              >
                {boardUrl}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink(boardUrl)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a
                  href={boardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                  style={{
                    borderColor: "var(--lm-border-strong)",
                    color: "var(--lm-text-secondary)",
                  }}
                  title="Open board"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
              <button
                type="button"
                onClick={() => void handleDisable()}
                disabled={busy}
                className="mt-2.5 w-full rounded-lg border px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  borderColor: "var(--lm-border-strong)",
                  color: "var(--lm-text-tertiary)",
                }}
              >
                Disable link
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleEnable()}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
            >
              <Link2 className="h-3.5 w-3.5" />
              {busy ? "Creating…" : "Create share link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Add/remove collections picker ── */
function CollectionPicker({
  allCollections,
  memberIds,
  section,
  onToggle,
  onCreate,
  onClose,
}: {
  allCollections: CollectionOption[];
  memberIds: Set<string>;
  /** Layer the picker files additions into (from the active tab), if any. */
  section: ProjectSection | null;
  onToggle: (folderId: string, isMember: boolean) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
  };

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
            {section
              ? `Add directions — ${TAB_LABELS[section]}`
              : "Collections in project"}
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

        {/* Inline create: new collection → added straight into this layer */}
        <div
          className="flex items-center gap-2 px-3.5 py-2.5"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCreate();
              }
              e.stopPropagation();
            }}
            placeholder={
              section
                ? `New ${TAB_LABELS[section].toLowerCase()} direction…`
                : "New collection…"
            }
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              border: "1px solid var(--lm-border)",
              color: "var(--lm-text-primary)",
            }}
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={!newName.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
            aria-label="Create and add"
            title="Create and add to this layer"
          >
            <Plus className="h-4 w-4" strokeWidth={3} />
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
