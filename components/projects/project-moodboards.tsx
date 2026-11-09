"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { ArrowUpRight, Check, Loader2, Plus, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardCard } from "@/components/gallery/moodboards-view";
import { syncOf, useSendToMidjourney } from "./moodboard-sync";
import type { StudioShelf } from "./moodboard-studio";

const MoodboardStudio = dynamic(() => import("./moodboard-studio").then((m) => m.MoodboardStudio), { ssr: false });

// Moodboards on the project page: every board of the world in one place.
// A card or "New moodboard" opens the moodboard studio over the page: the
// project's images on the left, the board on the right, drag across. "Send
// to Midjourney" hands the sync to an agent as a task. Michael, 9 Nov 2026:
// moodboards are the most important thing to build, so they live right in
// the project, built without leaving the images. The open board rides in the
// address (?board=<id> or ?board=new), so a reload keeps it open.

const BOARD_PARAM = "board";

const writeBoardParam = (value: string | null) => {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(BOARD_PARAM, value);
  else url.searchParams.delete(BOARD_PARAM);
  window.history.replaceState(window.history.state, "", url);
};

export function ProjectMoodboards({ ownerUserId, worldId, worldKey, worldName, shelves }: {
  ownerUserId: string; worldId: Id<"folders">; worldKey: string; worldName: string; shelves: StudioShelf[];
}) {
  const rows = useQuery(api.moodboards.listMoodboards, { ownerUserId, folderId: worldId, includeChildren: true, previewLimit: 6 });
  const { state: asked, send } = useSendToMidjourney(ownerUserId, worldId);

  const [studio, setStudio] = useState<string | null>(null);
  // Read after the first paint, so the server render and the browser agree.
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => setStudio(new URL(window.location.href).searchParams.get(BOARD_PARAM)));
    return () => window.cancelAnimationFrame(handle);
  }, []);
  const openStudio = useCallback((board: string | null) => {
    setStudio(board);
    writeBoardParam(board);
  }, []);

  return (
    <div className="lmp-boards">
      <div className="lmp-boards-bar">
        <button type="button" className="lmp-btn" onClick={() => openStudio("new")}>
          <Plus size={13} aria-hidden />New moodboard
        </button>
        <a href={`/w/${encodeURIComponent(worldKey)}/moodboards`} className="lmp-btn ghost">All in the gallery<ArrowUpRight size={12} aria-hidden /></a>
      </div>
      {rows === undefined ? (
        <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading moodboards" />
      ) : rows.length === 0 ? (
        <p className="lmp-empty">No moodboard yet. Make one, drag its frames in, and an agent puts it in Midjourney.</p>
      ) : (
        <div className="lmp-board-grid">
          {rows.map((row) => {
            const sync = syncOf(row);
            const state = asked[row._id];
            return (
              <div key={row._id} className="lmp-board">
                <BoardCard row={row} onOpen={() => openStudio(row._id)} place={row.folderId === worldId ? undefined : row.folderName} />
                <div className="lmp-board-sync" data-tone={sync.tone}>
                  <span className="lmp-mono">{sync.label}</span>
                  {sync.action && row.itemCount > 0 ? (
                    state === "done" ? (
                      <span className="lmp-mono lmp-asked"><Check size={11} aria-hidden />Asked an agent · Tasks</span>
                    ) : (
                      <button type="button" className="lmp-btn small" disabled={state === "busy"} onClick={() => void send(row)}>
                        {state === "busy" ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Send size={11} aria-hidden />}{sync.action}
                      </button>
                    )
                  ) : null}
                </div>
                {state && state !== "busy" && state !== "done" ? <p className="lmp-err" role="alert">{state}</p> : null}
              </div>
            );
          })}
        </div>
      )}
      {studio ? (
        <MoodboardStudio
          ownerUserId={ownerUserId}
          world={{ id: worldId, key: worldKey, name: worldName }}
          shelves={shelves}
          boardId={studio}
          onBoard={(board) => openStudio(board)}
          onClose={() => openStudio(null)}
        />
      ) : null}
    </div>
  );
}
