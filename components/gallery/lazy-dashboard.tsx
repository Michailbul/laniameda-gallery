"use client";

import { lazyComponent } from "@/components/lazy-component";
import { useEffect, useState, type ReactNode } from "react";

// Everything the dashboard opens on a tap (modals, panels, secondary tabs)
// loads as its own chunk, so the first load of / and /w/<world> carries the
// shell and the grid only. The chunks are preloaded once the page is idle,
// and lazyComponent renders a loaded chunk without suspending, so a tap opens
// at once.

/** Holds the space of a tab view while its chunk arrives, so nothing below jumps. */
function ViewSkeleton() {
  return <div className="min-h-[60vh]" aria-busy="true" />;
}

export const GalleryDetailPanel = lazyComponent(() => import("./detail-panel").then((m) => m.GalleryDetailPanel));
export const UploadModal = lazyComponent(() => import("@/components/upload-modal").then((m) => m.UploadModal));
export const CinemaModal = lazyComponent(() => import("./cinema-modal").then((m) => m.CinemaModal));
export const SkillModal = lazyComponent(() => import("./skill-modal").then((m) => m.SkillModal));
export const StorybookModal = lazyComponent(() => import("./storybook-modal").then((m) => m.StorybookModal));
export const FeaturedPanel = lazyComponent(() => import("./featured-panel").then((m) => m.FeaturedPanel));
export const MoodboardPicker = lazyComponent(() => import("./moodboard-picker").then((m) => m.MoodboardPicker));
export const AddToPanel = lazyComponent(() => import("./add-to-panel").then((m) => m.AddToPanel));
export const PublishAllDialog = lazyComponent(() => import("./publish-all-dialog").then((m) => m.PublishAllDialog));
export const SkillsView = lazyComponent(() => import("./skills-view").then((m) => m.SkillsView), ViewSkeleton);
export const StoriesView = lazyComponent(() => import("./stories-view").then((m) => m.StoriesView), ViewSkeleton);
export const MotionView = lazyComponent(() => import("./motion-view").then((m) => m.MotionView), ViewSkeleton);
export const BookmarksView = lazyComponent(() => import("./bookmarks-view").then((m) => m.BookmarksView), ViewSkeleton);
export const MidjourneySrefsView = lazyComponent(() => import("./midjourney-srefs-view").then((m) => m.MidjourneySrefsView), ViewSkeleton);
export const MoodboardsTab = lazyComponent(() => import("./moodboards-tab").then((m) => m.MoodboardsTab), ViewSkeleton);
export const WorldInstructionsPanel = lazyComponent(() => import("./world-instructions").then((m) => m.WorldInstructionsPanel), ViewSkeleton);
export const WorldJournalTab = lazyComponent(() => import("./world-journal-tab").then((m) => m.WorldJournalTab), ViewSkeleton);
export const WorldTasksTab = lazyComponent(() => import("./world-tasks-tab").then((m) => m.WorldTasksTab), ViewSkeleton);

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
    const first: Loader[] = [GalleryDetailPanel.preload, CinemaModal.preload];
    if (owner) first.push(UploadModal.preload);
    const stopFirst = preloadInIdle(first, 1500);
    const rest: Loader[] = owner
      ? [
          SkillModal, StorybookModal, FeaturedPanel, MoodboardPicker, AddToPanel, PublishAllDialog,
          SkillsView, StoriesView, MotionView, BookmarksView, MidjourneySrefsView, MoodboardsTab,
          WorldInstructionsPanel, WorldJournalTab, WorldTasksTab,
        ].map((component) => component.preload)
      : [SkillModal.preload, StorybookModal.preload];
    const stopRest = preloadInIdle(rest, 6000);
    return () => {
      stopFirst();
      stopRest();
    };
  }, [owner]);
}
