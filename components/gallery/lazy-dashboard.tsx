"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";

// Everything the dashboard opens on a tap (modals, panels, secondary tabs)
// loads as its own chunk, so the first load of / and /w/<world> carries the
// shell and the grid only. The chunks are preloaded once the page is idle,
// so a tap still opens without waiting on the network.

const loaders = {
  detailPanel: () => import("./detail-panel").then((m) => m.GalleryDetailPanel),
  uploadModal: () => import("@/components/upload-modal").then((m) => m.UploadModal),
  cinemaModal: () => import("./cinema-modal").then((m) => m.CinemaModal),
  skillModal: () => import("./skill-modal").then((m) => m.SkillModal),
  storybookModal: () => import("./storybook-modal").then((m) => m.StorybookModal),
  featuredPanel: () => import("./featured-panel").then((m) => m.FeaturedPanel),
  moodboardPicker: () => import("./moodboard-picker").then((m) => m.MoodboardPicker),
  addToPanel: () => import("./add-to-panel").then((m) => m.AddToPanel),
  publishAllDialog: () => import("./publish-all-dialog").then((m) => m.PublishAllDialog),
  skillsView: () => import("./skills-view").then((m) => m.SkillsView),
  storiesView: () => import("./stories-view").then((m) => m.StoriesView),
  motionView: () => import("./motion-view").then((m) => m.MotionView),
  bookmarksView: () => import("./bookmarks-view").then((m) => m.BookmarksView),
  srefsView: () => import("./midjourney-srefs-view").then((m) => m.MidjourneySrefsView),
  moodboardsTab: () => import("./moodboards-tab").then((m) => m.MoodboardsTab),
  worldInstructions: () => import("./world-instructions").then((m) => m.WorldInstructionsPanel),
  worldJournal: () => import("./world-journal-tab").then((m) => m.WorldJournalTab),
  worldTasks: () => import("./world-tasks-tab").then((m) => m.WorldTasksTab),
};

/** Holds the space of a tab view while its chunk arrives, so nothing below jumps. */
function ViewSkeleton() {
  return <div className="min-h-[60vh]" aria-busy="true" />;
}

// next/dynamic needs its options as a literal and the import() inline.
export const GalleryDetailPanel = dynamic(() => import("./detail-panel").then((m) => m.GalleryDetailPanel), { ssr: false });
export const UploadModal = dynamic(() => import("@/components/upload-modal").then((m) => m.UploadModal), { ssr: false });
export const CinemaModal = dynamic(() => import("./cinema-modal").then((m) => m.CinemaModal), { ssr: false });
export const SkillModal = dynamic(() => import("./skill-modal").then((m) => m.SkillModal), { ssr: false });
export const StorybookModal = dynamic(() => import("./storybook-modal").then((m) => m.StorybookModal), { ssr: false });
export const FeaturedPanel = dynamic(() => import("./featured-panel").then((m) => m.FeaturedPanel), { ssr: false });
export const MoodboardPicker = dynamic(() => import("./moodboard-picker").then((m) => m.MoodboardPicker), { ssr: false });
export const AddToPanel = dynamic(() => import("./add-to-panel").then((m) => m.AddToPanel), { ssr: false });
export const PublishAllDialog = dynamic(() => import("./publish-all-dialog").then((m) => m.PublishAllDialog), { ssr: false });
export const SkillsView = dynamic(() => import("./skills-view").then((m) => m.SkillsView), { ssr: false, loading: ViewSkeleton });
export const StoriesView = dynamic(() => import("./stories-view").then((m) => m.StoriesView), { ssr: false, loading: ViewSkeleton });
export const MotionView = dynamic(() => import("./motion-view").then((m) => m.MotionView), { ssr: false, loading: ViewSkeleton });
export const BookmarksView = dynamic(() => import("./bookmarks-view").then((m) => m.BookmarksView), { ssr: false, loading: ViewSkeleton });
export const MidjourneySrefsView = dynamic(() => import("./midjourney-srefs-view").then((m) => m.MidjourneySrefsView), { ssr: false, loading: ViewSkeleton });
export const MoodboardsTab = dynamic(() => import("./moodboards-tab").then((m) => m.MoodboardsTab), { ssr: false, loading: ViewSkeleton });
export const WorldInstructionsPanel = dynamic(() => import("./world-instructions").then((m) => m.WorldInstructionsPanel), { ssr: false, loading: ViewSkeleton });
export const WorldJournalTab = dynamic(() => import("./world-journal-tab").then((m) => m.WorldJournalTab), { ssr: false, loading: ViewSkeleton });
export const WorldTasksTab = dynamic(() => import("./world-tasks-tab").then((m) => m.WorldTasksTab), { ssr: false, loading: ViewSkeleton });

/**
 * Mounts its children from the first time `open` is true and keeps them
 * mounted after, so a closed modal costs no chunk until it is first opened
 * and behaves exactly as before once it has been (exit animations, state).
 */
export function MountOnceOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open ? <>{children}</> : null;
}

type Loader = () => Promise<unknown>;

function onIdle(run: () => void, timeout: number): () => void {
  if (typeof window === "undefined") return () => {};
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(run, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1);
  return () => clearTimeout(id);
}

/** Loads the given chunks one at a time, each in an idle slot. */
function preloadInIdle(list: Loader[], startDelay: number): () => void {
  let cancelIdle = () => {};
  let stopped = false;
  const next = (index: number) => {
    if (stopped || index >= list.length) return;
    cancelIdle = onIdle(() => {
      if (stopped) return;
      list[index]!().catch(() => {}).finally(() => next(index + 1));
    }, 4000);
  };
  const timer = setTimeout(() => next(0), startDelay);
  return () => {
    stopped = true;
    clearTimeout(timer);
    cancelIdle();
  };
}

/**
 * After the first paint, fetch what the next tap needs: the detail panel and
 * cinema modal for everyone, then the owner's tools and tabs.
 */
export function usePreloadDashboardChunks(owner: boolean) {
  useEffect(() => {
    const first: Loader[] = [loaders.detailPanel, loaders.cinemaModal];
    if (owner) first.push(loaders.uploadModal);
    const stopFirst = preloadInIdle(first, 1500);
    const rest: Loader[] = owner
      ? Object.entries(loaders)
          .filter(([key]) => key !== "detailPanel" && key !== "cinemaModal" && key !== "uploadModal")
          .map(([, load]) => load)
      : [loaders.skillModal, loaders.storybookModal];
    const stopRest = preloadInIdle(rest, 6000);
    return () => {
      stopFirst();
      stopRest();
    };
  }, [owner]);
}
