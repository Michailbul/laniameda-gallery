"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConvex } from "convex/react";
import { FolderX, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { findEmptiedFolders, folderLoads } from "@/lib/empty-folders";

type PromptFolder = {
  _id: string;
  name: string;
  parentFolderId?: string | null;
  kind?: string | null;
};

/**
 * Asks to delete a collection the moment its last piece leaves (Michael,
 * 19 Oct: "so we don't have empty elements"). A folder qualifies only when it
 * also holds no moodboard, story or Skill, since deleting a folder takes those
 * with it or drops them. Keep remembers the answer for this visit.
 */
export function EmptyFolderPrompt({
  ownerUserId,
  folders,
  assetCountById,
  ready,
  onDelete,
}: {
  ownerUserId: string;
  folders: readonly PromptFolder[] | undefined;
  assetCountById: ReadonlyMap<string, number>;
  /** False until the counts query has loaded. */
  ready: boolean;
  onDelete: (folderId: string) => Promise<void>;
}) {
  const convex = useConvex();
  const previousLoads = useRef<Map<string, number> | null>(null);
  const dismissed = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loads = useMemo(
    () => (folders && ready ? folderLoads(folders, assetCountById) : null),
    [assetCountById, folders, ready],
  );

  useEffect(() => {
    if (!loads) return;
    const emptied = findEmptiedFolders(previousLoads.current, loads).filter(
      (id) => !dismissed.current.has(id),
    );
    previousLoads.current = loads;
    if (emptied.length === 0 || !ownerUserId) return;
    let cancelled = false;
    void (async () => {
      const confirmed: string[] = [];
      for (const id of emptied) {
        const folderId = id as Id<"folders">;
        try {
          const [boards, stories, skills] = await Promise.all([
            convex.query(api.moodboards.listMoodboards, {
              ownerUserId,
              folderId,
              includeArchived: true,
              previewLimit: 0,
            }),
            convex.query(api.stories.listStories, { ownerUserId, folderId, limit: 1 }),
            convex.query(api.skills.listSkills, { ownerUserId, folderId, limit: 1, previewLimit: 0 }),
          ]);
          if (boards.length === 0 && stories.length === 0 && skills.length === 0) {
            confirmed.push(id);
          }
        } catch {
          // Unknown contents: never offer a delete we cannot vouch for.
        }
      }
      if (!cancelled && confirmed.length > 0) {
        setPending((current) => [...new Set([...current, ...confirmed])]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convex, loads, ownerUserId]);

  // A folder that filled up again, or was deleted elsewhere, drops out.
  const shown = pending.filter((id) => loads?.get(id) === 0);
  if (shown.length === 0 || typeof document === "undefined") return null;

  const nameOf = (id: string) => {
    const folder = folders?.find((entry) => String(entry._id) === id);
    if (!folder) return "Collection";
    const parent = folder.parentFolderId
      ? folders?.find((entry) => String(entry._id) === String(folder.parentFolderId))
      : undefined;
    return parent ? `${parent.name} › ${folder.name}` : folder.name;
  };
  const keep = () => {
    for (const id of shown) dismissed.current.add(id);
    setPending([]);
  };
  const remove = async () => {
    setBusy(true);
    try {
      for (const id of shown) {
        dismissed.current.add(id);
        await onDelete(id);
      }
      setPending([]);
    } finally {
      setBusy(false);
    }
  };

  // Portaled: the dashboard's content layers would otherwise paint over it.
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label="Empty collections"
      className="fixed bottom-24 left-1/2 z-[80] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 animate-fade-in"
      style={{
        background: "var(--lm-surface-1)",
        border: "1px solid var(--lm-border-strong)",
        borderRadius: "14px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        fontFamily: "var(--lm-font)",
      }}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <FolderX className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--lm-coral)" }} aria-hidden />
        <div className="min-w-0">
          <p
            className="m-0"
            style={{
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--lm-text-secondary)",
            }}
          >
            {shown.length === 1 ? "This collection is empty now" : `${shown.length} collections are empty now`}
          </p>
          <ul className="m-0 mt-2 list-none p-0">
            {shown.map((id) => (
              <li
                key={id}
                className="truncate"
                style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--lm-text-primary)" }}
              >
                {nameOf(id)}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1.5" style={{ fontSize: "11.5px", color: "var(--lm-text-tertiary)" }}>
            No pieces, folders, moodboards, stories or Skills left in {shown.length === 1 ? "it" : "them"}.
          </p>
        </div>
      </div>
      <div
        className="flex items-center justify-end gap-2 px-4 pb-4"
      >
        <button
          type="button"
          onClick={keep}
          disabled={busy}
          className="lm-quiet-action border-none bg-transparent px-3 py-1.5"
          style={{
            fontSize: "10px",
            fontWeight: 750,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--lm-text-tertiary)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          Keep
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "6px 12px",
            borderRadius: "12px",
            border: "2px solid var(--gradient-1)",
            background: "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
            color: "#fff",
            fontSize: "10px",
            fontWeight: 750,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {shown.length === 1 ? "Delete collection" : `Delete ${shown.length}`}
        </button>
      </div>
    </div>,
    document.body,
  );
}
