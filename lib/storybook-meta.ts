// Reads the structured header every production storybook carries
// (skills/laniameda-gallery/references/storybooks.md) so the gallery can
// filter and badge books without a schema change. Books written before that
// format have no status line and show as "unreviewed".

export type StorybookStatus = "ready" | "not-ready" | "unreviewed" | "archived";
export type StorybookMedium = "animated" | "live-action";

export type StorybookMeta = {
  world: string;
  title: string;
  status: StorybookStatus;
  /** Blocking gaps, when the status line states them. */
  gaps: number | null;
  runtimeSeconds: number | null;
  medium: StorybookMedium | null;
  /** First story beat, used as the one-line hook on a tile. */
  hook: string | null;
};

const ARCHIVED_PREFIX = /^archived\s*[·:\-—]\s*/i;

export function splitStorybookName(rawName: string): {
  world: string;
  title: string;
  archived: boolean;
} {
  const archived = ARCHIVED_PREFIX.test(rawName.trim());
  const name = rawName.trim().replace(ARCHIVED_PREFIX, "");
  const dot = name.lastIndexOf(" · ");
  if (dot > 0) {
    return {
      world: name.slice(0, dot).trim(),
      title: name.slice(dot + 3).trim(),
      archived,
    };
  }
  const dash = name.indexOf(" — ");
  if (dash > 0) {
    return {
      world: name.slice(0, dash).trim(),
      title: name.slice(dash + 3).trim(),
      archived,
    };
  }
  return { world: name, title: name, archived };
}

export function parseStorybookMeta(
  rawName: string,
  story: string | undefined,
): StorybookMeta {
  const { world, title, archived } = splitStorybookName(rawName);
  const text = story ?? "";
  const head = text.slice(0, 600);

  const statusLine = /^\s*(NOT READY|READY)\b[^\n]*/im.exec(head);
  let status: StorybookStatus = "unreviewed";
  let gaps: number | null = null;
  if (statusLine) {
    status = statusLine[1].toUpperCase() === "READY" ? "ready" : "not-ready";
    const count = /(\d+)\s+blocking\s+gaps?/i.exec(statusLine[0]);
    if (count) gaps = Number(count[1]);
  }
  if (archived) status = "archived";

  const runtime = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:seconds?|secs?|s)\b/i.exec(head);
  const runtimeSeconds = runtime
    ? Number(runtime[2] ?? runtime[1])
    : null;

  let medium: StorybookMedium | null = null;
  const lane = /\((animation|animated|live[ -]action)\)/i.exec(head);
  if (lane) {
    medium = /animat/i.test(lane[1]) ? "animated" : "live-action";
  }

  const beat = /^STORY\s*\n+\s*1\.\s*(.+)$/im.exec(text);
  const hook = beat ? beat[1].trim() : null;

  return { world, title, status, gaps, runtimeSeconds, medium, hook };
}
