// Reading helpers for world docs (WORLD.md, LEARNINGS.md, docs/*.md): the
// headings a table of contents is built from, the `story:` / `asset:` /
// `moodboard:` references that become chips, and LEARNINGS lines split into
// id, date, text and source. Pure, so the reader, the editor preview and the
// tests share one reading of the text.

export type DocHeading = {
  level: number;
  /** Heading text with markdown punctuation removed. */
  text: string;
  /** Unique within the doc: the anchor the reader and the TOC agree on. */
  id: string;
  /** 0-based source line, for the editor preview to follow the caret. */
  line: number;
};

const FENCE = /^\s{0,3}(```|~~~)/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Inline markdown reduced to the words a reader sees. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();

export const slugify = (text: string) =>
  plainText(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";

/** Every ATX heading outside code fences, in order, with unique ids. */
export function extractHeadings(body: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  body.split("\n").forEach((line, index) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = ATX.exec(line);
    if (!match) return;
    const text = plainText(match[2]);
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push({ level: match[1].length, text, id: count === 0 ? base : `${base}-${count + 1}`, line: index });
  });
  return headings;
}

/* ── References ─────────────────────────────────────────────────────────── */

export type WorldRefKind = "story" | "asset" | "moodboard";
export type WorldRef = { kind: WorldRefKind; id: string };

/** story:<convex id>, asset:<id>, moodboard:<id>, as agents write them. */
export const WORLD_REF = /\b(story|asset|moodboard):([a-z0-9]{24,40})\b/g;

/** The text cut into plain runs and references. */
export function splitRefs(text: string): Array<string | WorldRef> {
  const parts: Array<string | WorldRef> = [];
  let last = 0;
  for (const match of text.matchAll(WORLD_REF)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ kind: match[1] as WorldRefKind, id: match[2] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A reference written alone, as inline code or a whole token. */
export const parseRef = (text: string): WorldRef | null => {
  const parts = splitRefs(text.trim());
  return parts.length === 1 && typeof parts[0] !== "string" ? parts[0] : null;
};

/** "px73012f…8gkqhj": enough of an id to tell two apart at a glance. */
export const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

/* ── LEARNINGS.md ───────────────────────────────────────────────────────── */

export type Learning = {
  /** L-014 */
  id: string;
  /** 2026-10-27, as written. */
  date: string;
  text: string;
  source: string | null;
  line: number;
};

export type LearningsBlock = { kind: "prose"; text: string } | { kind: "learnings"; items: Learning[] };

const LEARNING = /^\s*[-*]\s+(L-\d+)\s*·\s*(\d{4}-\d{2}-\d{2})\s*·\s*(.+)$/;
// The last " · src:" starts the source; text may itself contain " · ".
const SOURCE = /\s*·\s*src:\s*/g;

export const parseLearningLine = (line: string, index = 0): Learning | null => {
  const match = LEARNING.exec(line);
  if (!match) return null;
  const rest = match[3].trim();
  let cut = -1;
  let cutEnd = -1;
  for (const found of rest.matchAll(SOURCE)) {
    cut = found.index ?? -1;
    cutEnd = cut + found[0].length;
  }
  return {
    id: match[1],
    date: match[2],
    text: cut >= 0 ? rest.slice(0, cut).trim() : rest,
    source: cut >= 0 ? rest.slice(cutEnd).trim() || null : null,
    line: index,
  };
};

/**
 * LEARNINGS.md as alternating prose and runs of learning lines, so the intro
 * and any headings stay markdown and each learning becomes a row.
 */
export function parseLearnings(body: string): LearningsBlock[] {
  const blocks: LearningsBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.join("").trim()) blocks.push({ kind: "prose", text: prose.join("\n") });
    prose = [];
  };
  body.split("\n").forEach((line, index) => {
    const learning = parseLearningLine(line, index);
    if (!learning) {
      prose.push(line);
      return;
    }
    flush();
    const previous = blocks[blocks.length - 1];
    if (previous?.kind === "learnings") previous.items.push(learning);
    else blocks.push({ kind: "learnings", items: [learning] });
  });
  flush();
  return blocks;
}

/** Minutes to read, at a steady 220 words a minute. */
export const readingMinutes = (body: string) =>
  Math.max(1, Math.round(plainText(body).split(/\s+/).filter(Boolean).length / 220));
