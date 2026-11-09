// A board made on the project page opens straight into "choose its frames":
// the project page leaves the board here and goes to /moodboards/<id>; the
// gallery takes it on arrival and starts the frame pick (no URL flag left to
// replay on a reload). Session storage only; without it the board just opens.

const KEY = "lm-moodboard-pick";
// A handoff older than this is stale (the tab went somewhere else first).
const FRESH_MS = 60_000;

export type MoodboardPickHandoff = { id: string; name: string; folderId: string };

export function queueMoodboardPick(board: MoodboardPickHandoff) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...board, at: Date.now() }));
  } catch {
    /* storage refused: the board opens without the pick */
  }
}

/** The board to start picking for, once; null when none waits for this page. */
export function takeMoodboardPick(pathname: string): MoodboardPickHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const value = JSON.parse(raw) as Partial<MoodboardPickHandoff> & { at?: number };
    if (!value.id || !value.name || !value.folderId) return null;
    if (!value.at || Date.now() - value.at > FRESH_MS) return null;
    if (decodeURIComponent(pathname) !== `/moodboards/${value.id}`) return null;
    return { id: value.id, name: value.name, folderId: value.folderId };
  } catch {
    return null;
  }
}
