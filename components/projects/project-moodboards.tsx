"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Check, Loader2, Plus, Send, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardCard, CreateMoodboard, type MoodboardCollectionOption, type MoodboardRow } from "@/components/gallery/moodboards-view";
import { queueMoodboardPick } from "@/lib/moodboard-pick-handoff";
import { moodboardAgentRequest } from "@/lib/moodboards";

// Moodboards on the project page: every board of the world in one place,
// a new one in two clicks (name, then its frames in the gallery picker), and
// "Send to Midjourney", which hands the sync to an agent as a task. The agent
// makes or updates the Midjourney moodboard under the same name and records
// its code (set_moodboard_midjourney). Michael, 9 Nov 2026: moodboards are
// the most important thing to build, so they live right in the project.

type Shelf = { id: string; name: string; group?: string };

type Sync = { tone: "none" | "ok" | "drift"; label: string; action?: string };

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Where a board stands against Midjourney, from what the board row knows.
const syncOf = (row: MoodboardRow): Sync => {
  const inMidjourney = Boolean(row.mjCode || row.mjMoodboardId);
  if (!inMidjourney && !row.mjSyncedAt) return { tone: "none", label: "Not in Midjourney yet", action: "Send to Midjourney" };
  const changed =
    row.mjSyncedAt === undefined ||
    (row.mjSyncedItemCount !== undefined && row.mjSyncedItemCount !== row.itemCount) ||
    row.updatedAt > row.mjSyncedAt + 60_000;
  if (changed) return { tone: "drift", label: "Changed since Midjourney last got it", action: "Sync again" };
  return { tone: "ok", label: `In Midjourney · ${day(row.mjSyncedAt!)}` };
};

export function ProjectMoodboards({ ownerUserId, worldId, worldKey, worldName, shelves }: {
  ownerUserId: string; worldId: Id<"folders">; worldKey: string; worldName: string; shelves: Shelf[];
}) {
  const router = useRouter();
  const rows = useQuery(api.moodboards.listMoodboards, { ownerUserId, folderId: worldId, includeChildren: true, previewLimit: 6 });
  const createTask = useMutation(api.tasks.createTask);
  const [creating, setCreating] = useState(false);
  const [asked, setAsked] = useState<Record<string, "busy" | "done" | string>>({});

  const owners: MoodboardCollectionOption[] = [
    { _id: worldId, name: worldName },
    ...shelves.map((shelf) => ({ _id: shelf.id, name: shelf.name, parentFolderId: worldId as string, group: shelf.group })),
  ];

  const open = (id: string) => router.push(`/moodboards/${encodeURIComponent(id)}`);

  const send = async (row: MoodboardRow) => {
    setAsked((current) => ({ ...current, [row._id]: "busy" }));
    const images = `${row.itemCount} ${row.itemCount === 1 ? "image" : "images"}`;
    try {
      await createTask({
        ownerUserId,
        worldFolderId: worldId,
        title: `Put the ${row.name} moodboard in Midjourney`,
        summary: `${images}, under the same name. Record its code in the gallery when done.`,
        brief: [
          moodboardAgentRequest({ id: row._id, name: row.name, itemCount: row.itemCount, mjCode: row.mjCode, mjMoodboardId: row.mjMoodboardId }),
          "Name the Midjourney moodboard exactly like the gallery board. If the board's style has a Midjourney profile (open_world / get_style recipes), pair them on the style recipe.",
          "Keep to the Midjourney pacing rules (one runner, human pace, stop on the first warning). Edit the Midjourney moodboard only to match this gallery board.",
        ].join("\n\n"),
        links: [{ kind: "moodboard", id: row._id, label: row.name }],
        source: "manual",
        // One task per board state: a second click on the same board finds the first.
        ingestKey: `moodboard-sync:${row._id}:${row.revision}`,
      });
      setAsked((current) => ({ ...current, [row._id]: "done" }));
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^.*ConvexError: /, "") : "Not sent.";
      setAsked((current) => ({ ...current, [row._id]: text }));
    }
  };

  return (
    <div className="lmp-boards">
      <div className="lmp-boards-bar">
        <button type="button" className="lmp-btn" data-on={creating ? "" : undefined} onClick={() => setCreating(!creating)}>
          {creating ? <X size={13} aria-hidden /> : <Plus size={13} aria-hidden />}{creating ? "Close" : "New moodboard"}
        </button>
        <a href={`/w/${encodeURIComponent(worldKey)}/moodboards`} className="lmp-btn ghost">All in the gallery<ArrowUpRight size={12} aria-hidden /></a>
      </div>
      {creating ? (
        <CreateMoodboard
          ownerUserId={ownerUserId}
          owners={owners}
          defaultFolderId={worldId}
          onCreated={(id, board) => {
            queueMoodboardPick({ id, name: board.name, folderId: board.folderId });
            open(id);
          }}
        />
      ) : null}
      {rows === undefined ? (
        <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading moodboards" />
      ) : rows.length === 0 ? (
        <p className="lmp-empty">No moodboard yet. Make one, pick its frames, and an agent puts it in Midjourney.</p>
      ) : (
        <div className="lmp-board-grid">
          {rows.map((row) => {
            const sync = syncOf(row);
            const state = asked[row._id];
            return (
              <div key={row._id} className="lmp-board">
                <BoardCard row={row} onOpen={() => open(row._id)} place={row.folderId === worldId ? undefined : row.folderName} />
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
    </div>
  );
}
