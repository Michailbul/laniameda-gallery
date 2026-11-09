"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { moodboardAgentRequest } from "@/lib/moodboards";

// Where a board stands against Midjourney, and "Send to Midjourney": a task
// for an agent to make or update the Midjourney moodboard under the same
// name and record its code (set_moodboard_midjourney). Shared by the project
// page's board cards and the moodboard studio.

export type SyncBoard = {
  _id: string; name: string; itemCount: number; revision: number; updatedAt: number;
  mjCode?: string; mjMoodboardId?: string; mjSyncedAt?: number; mjSyncedItemCount?: number;
};

export type Sync = { tone: "none" | "ok" | "drift"; label: string; action?: string };

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const syncOf = (board: SyncBoard): Sync => {
  const inMidjourney = Boolean(board.mjCode || board.mjMoodboardId);
  if (!inMidjourney && !board.mjSyncedAt) return { tone: "none", label: "Not in Midjourney yet", action: "Send to Midjourney" };
  const changed =
    board.mjSyncedAt === undefined ||
    (board.mjSyncedItemCount !== undefined && board.mjSyncedItemCount !== board.itemCount) ||
    board.updatedAt > board.mjSyncedAt + 60_000;
  if (changed) return { tone: "drift", label: "Changed since Midjourney last got it", action: "Sync again" };
  return { tone: "ok", label: `In Midjourney · ${day(board.mjSyncedAt!)}` };
};

/** Per board: "busy", "done", or the error text. */
export type SendState = Record<string, string>;

export function useSendToMidjourney(ownerUserId: string, worldId: Id<"folders">) {
  const createTask = useMutation(api.tasks.createTask);
  const [state, setState] = useState<SendState>({});
  const send = useCallback(async (board: SyncBoard) => {
    setState((current) => ({ ...current, [board._id]: "busy" }));
    const images = `${board.itemCount} ${board.itemCount === 1 ? "image" : "images"}`;
    try {
      await createTask({
        ownerUserId,
        worldFolderId: worldId,
        title: `Put the ${board.name} moodboard in Midjourney`,
        summary: `${images}, under the same name. Record its code in the gallery when done.`,
        brief: [
          moodboardAgentRequest({ id: board._id, name: board.name, itemCount: board.itemCount, mjCode: board.mjCode, mjMoodboardId: board.mjMoodboardId }),
          "Name the Midjourney moodboard exactly like the gallery board. If the board's style has a Midjourney profile (open_world / get_style recipes), pair them on the style recipe.",
          "Keep to the Midjourney pacing rules (one runner, human pace, stop on the first warning). Edit the Midjourney moodboard only to match this gallery board.",
        ].join("\n\n"),
        links: [{ kind: "moodboard", id: board._id, label: board.name }],
        source: "manual",
        // One task per board state: a second click on the same board finds the first.
        ingestKey: `moodboard-sync:${board._id}:${board.revision}`,
      });
      setState((current) => ({ ...current, [board._id]: "done" }));
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^.*ConvexError: /, "") : "Not sent.";
      setState((current) => ({ ...current, [board._id]: text }));
    }
  }, [createTask, ownerUserId, worldId]);
  return { state, send };
}
