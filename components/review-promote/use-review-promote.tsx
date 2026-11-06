"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useConvex, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  framesWord,
  lastDestination,
  readMemory,
  rememberDestination,
  reviewHref,
  type PromoteChoice,
  type PromoteFrame,
  type PromoteOutcome,
  type PromoteProject,
} from "./promote-model";
import "./review-promote.css";

// PROMOTE TO DIRECTOR REVIEW. R on a frame (or the selection) opens the
// palette; Shift+R sends it to the last destination of its review project.
// Frames land in the project's draft round (made from the current round when
// there is none); Michael publishes the round from the review page.

const PromotePalette = dynamic(() => import("./promote-palette").then((m) => m.PromotePalette), {
  ssr: false,
});

type Toast = ({ kind: "done" } & PromoteOutcome) | { kind: "error"; text: string };

const errorLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^[\s\S]*?ConvexError: /, "")
    .replace(/\n[\s\S]*$/, "")
    .slice(0, 120);

const unique = (frames: PromoteFrame[]) => {
  const seen = new Set<string>();
  return frames.filter((frame) => frame.id && !seen.has(frame.id) && seen.add(frame.id));
};

export function useReviewPromote({ ownerUserId, active }: { ownerUserId?: string; active: boolean }) {
  const convex = useConvex();
  const promoteMutation = useMutation(api.review.promote);
  const [frames, setFrames] = useState<PromoteFrame[] | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const sending = useRef(false);

  const promote = useCallback(
    async (targets: PromoteFrame[], choice: PromoteChoice) => {
      const assetIds = targets.map((frame) => frame.id as Id<"assets">);
      const result = await promoteMutation({
        ...(ownerUserId ? { ownerUserId } : {}),
        slug: choice.project.slug,
        assetIds,
        folderId: choice.folder.id as Id<"reviewFolders">,
        ...(choice.style ? { styleId: choice.style.id as Id<"worldStyles"> } : {}),
        ...(choice.note?.trim() ? { note: choice.note.trim() } : {}),
      });
      rememberDestination(choice.project.slug, choice.folder.id, choice.style?.id ?? null);
      const thumbOf = new Map(choice.project.suggestions.map((row) => [row.assetId, row.thumb]));
      setToast({
        kind: "done",
        slug: choice.project.slug,
        count: targets.length,
        added: result.added,
        updated: result.updated,
        folderName: choice.folder.name,
        styleLabel: choice.style?.label,
        draftLabel: result.draftLabel,
        thumbs: targets
          .map((frame) => thumbOf.get(frame.id) ?? frame.thumb)
          .filter((src): src is string => Boolean(src))
          .slice(0, 3),
      });
    },
    [ownerUserId, promoteMutation],
  );

  const open = useCallback(
    (targets: PromoteFrame[]) => {
      const list = unique(targets);
      if (!active || !list.length) return;
      setToast(null);
      setFrames(list);
    },
    [active],
  );

  const sendToLast = useCallback(
    async (targets: PromoteFrame[]) => {
      const list = unique(targets);
      if (!active || !list.length || sending.current) return;
      sending.current = true;
      try {
        const projects = (await convex.query(api.review.promoteTargets, {
          ...(ownerUserId ? { ownerUserId } : {}),
          assetIds: list.map((frame) => frame.id as Id<"assets">),
        })) as PromoteProject[];
        const choice = lastDestination(projects, readMemory());
        // Nothing remembered for this frame's review yet: choose it once.
        if (!choice) {
          setFrames(list);
          return;
        }
        await promote(list, choice);
      } catch (error) {
        setToast({ kind: "error", text: errorLine(error) || "Could not promote" });
      } finally {
        sending.current = false;
      }
    },
    [active, convex, ownerUserId, promote],
  );

  const close = useCallback(() => setFrames(null), []);
  const confirm = useCallback(
    async (choice: PromoteChoice) => {
      if (!frames) return;
      await promote(frames, choice);
      setFrames(null);
    },
    [frames, promote],
  );

  const element: ReactNode = (
    <>
      {active && frames && (
        <PromotePalette frames={frames} ownerUserId={ownerUserId} onClose={close} onConfirm={confirm} />
      )}
      {toast && <PromoteToast toast={toast} onDone={() => setToast(null)} />}
    </>
  );

  return { open, sendToLast, isOpen: frames !== null, element };
}

function PromoteToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  // The parent re-renders freely; only a new toast or a hover restarts the timer.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => done.current(), toast.kind === "done" ? 7000 : 5000);
    return () => window.clearTimeout(timer);
  }, [held, toast]);
  return createPortal(
    <div
      className="rvp-toast"
      role="status"
      aria-live="polite"
      data-tone={toast.kind}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      {toast.kind === "error" ? (
        <span className="rvp-toast-line">{toast.text}</span>
      ) : (
        <>
          {toast.thumbs.length > 0 && (
            <span className="rvp-toast-thumbs" aria-hidden>
              {toast.thumbs.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" />
              ))}
            </span>
          )}
          <span className="rvp-toast-line">
            <strong>{framesWord(toast.count)}</strong>
            <span className="rvp-toast-arrow">→</span>
            {toast.folderName}
            {toast.styleLabel ? ` · ${toast.styleLabel}` : ""}
            <span className="rvp-toast-dim">
              {" · draft "}
              <span className="rvp-code">{toast.draftLabel}</span>
              {toast.updated > 0 && toast.added === 0
                ? " · already there"
                : toast.updated > 0
                  ? ` · ${toast.updated} already there`
                  : ""}
            </span>
          </span>
          <a className="rvp-toast-link" href={reviewHref(toast.slug)} target="_blank" rel="noopener noreferrer">
            Open review ↗
          </a>
        </>
      )}
    </div>,
    document.body,
  );
}
