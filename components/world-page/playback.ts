// How many films decode at once on the world page. Clips play muted while in
// view; past the limit the oldest one pauses (it plays again when it comes
// back into view). Phones decode two, desktops eight.

type Entry = { stop: () => void; priority: boolean };
const playing: Entry[] = [];

const limit = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 760px), (hover: none)").matches
    ? 2
    : 8;

/**
 * Register a playing film; returns the release to call when it stops. Past
 * the limit the oldest wall clip is stopped; a hero insert (priority) is
 * never stopped for a wall clip.
 */
export const claimPlayback = (stop: () => void, priority = false) => {
  const entry = { stop, priority };
  playing.push(entry);
  while (playing.length > limit()) {
    const at = playing.findIndex((other) => !other.priority && other !== entry);
    if (at < 0) break;
    playing.splice(at, 1)[0].stop();
  }
  return () => {
    const at = playing.indexOf(entry);
    if (at >= 0) playing.splice(at, 1);
  };
};

/** Save-Data or a 2g/3g link: posters only, no films. */
export const lowData = () => {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return Boolean(connection?.saveData || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? ""));
};
