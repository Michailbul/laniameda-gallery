// Key 1 on a frame: like, and super like on a double press. Owner only, so it
// ships in the owner kit (components/frame-composer/owner-kit.ts), never in a
// visitor's first load. The key itself and the levels are in asset-hotkeys.ts
// (types only from there: a value import would pull that module into a
// chunk shared with every page).
import type { LikeLevel } from "./asset-hotkeys";

/**
 * Where a press of 1 takes a frame. One press toggles the like (and takes a
 * super like off with it); the second press of a double always lands on super.
 */
export const likeAfterPress = (current: LikeLevel, double: boolean): LikeLevel =>
  double ? "super" : current === "none" ? "like" : "none";

/** What a press says on its frame, and in which colour (lib/frame-flash.ts). */
export const likeFlash = (next: LikeLevel): { label: string; tone: "coral" | "ember" | "ink" } =>
  next === "super"
    ? { label: "Super liked · ready", tone: "ember" }
    : next === "like"
      ? { label: "Liked", tone: "coral" }
      : { label: "Like off", tone: "ink" };

type LikeSave = (assetId: string, level: LikeLevel) => Promise<unknown>;

/**
 * The 1 key on a frame. The mark paints on the first press; the save waits
 * out the double-press window so a double writes once (super), never like
 * then super. `flush` sends whatever still waits (on leaving the page).
 */
export function createLikePresses(options: {
  /** LIKE_DOUBLE_MS: how long a second press still makes a double. */
  doubleMs: number;
  save: LikeSave;
  /** The save failed: put the mark back to what the server has. */
  onError: (assetId: string, message: string) => void;
}) {
  let last: { id: string; at: number } | null = null;
  const waiting = new Map<string, { level: LikeLevel; timer: ReturnType<typeof setTimeout> }>();
  const send = (id: string) => {
    const entry = waiting.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    waiting.delete(id);
    options.save(id, entry.level).catch((error: unknown) => {
      // A newer press for this frame is already on its way: let it speak.
      if (waiting.has(id)) return;
      options.onError(id, error instanceof Error ? error.message : "Could not save the like");
    });
  };
  return {
    /** The level the frame shows after this press; `current` is what it shows now. */
    press(id: string, current: LikeLevel, now = performance.now()): LikeLevel {
      const double = last?.id === id && now - last.at <= options.doubleMs;
      // After a double the next press starts fresh (it takes the super like off).
      last = double ? null : { id, at: now };
      const next = likeAfterPress(waiting.get(id)?.level ?? current, double);
      const pending = waiting.get(id);
      if (pending) clearTimeout(pending.timer);
      waiting.set(id, { level: next, timer: setTimeout(() => send(id), options.doubleMs) });
      return next;
    },
    flush() {
      for (const id of [...waiting.keys()]) send(id);
    },
  };
}
