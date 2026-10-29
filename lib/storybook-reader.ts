// Turns a storybook record (the folder description, the script Story attached
// to it and the frames filed on its shelf) into the blocks the reader draws.
//
// Three formats are in use and all three must read:
//   10 Oct  "TITLE · about 30 seconds · da-film · overcast look (live action)"
//           then "NOT READY: 1 blocking gaps" and upper-case sections
//           (STORY, CAST, LOCATIONS, PROPS, BEATS TO REFERENCES, STYLE, GAPS…)
//   13 Oct  "Revised story draft · 30–45 seconds" / "WORLD · style-tag",
//           a logline, bare numbered beats, "Key: text" paragraphs and a
//           readiness audit with a GAPS list
//   27 Oct  free prose: a title line, then paragraphs; no beats
// Nothing here throws on an unexpected shape: unknown text stays as prose.

import { splitStorybookName } from "./storybook-meta";

export type ReaderRef =
  | { kind: "asset"; id: string }
  | { kind: "story"; id: string }
  | { kind: "url"; url: string; label: string }
  | { kind: "text"; text: string };

export type ReaderBeat = {
  number: number;
  /** "0–6 s" when the beat names its time range. */
  time: string | null;
  text: string;
  /** Asset ids the record ties to this beat (BEATS TO REFERENCES). */
  assetIds: string[];
  /** What the record says is still missing for the beat. */
  missing: string | null;
};

export type ReaderItem = {
  /** The part before the first colon when it reads as a name, else null. */
  label: string | null;
  text: string;
  assetIds: string[];
  /** Character codes cited in the item (DA-CH-001, DA-CH-001-C02). */
  codes: string[];
};

export type ReaderGap = {
  /** "NO PLATE", "NO SHEET", "ACTION UNPROVEN"… lower-cased for the chip. */
  kind: string | null;
  /** The first sentence: what is missing. */
  summary: string;
  /** The rest: the cheapest fix, the beats it blocks. */
  detail: string | null;
};

export type ReaderSection = {
  title: string;
  items: ReaderItem[];
  paragraphs: string[];
};

export type ReaderModel = {
  title: string;
  world: string | null;
  status: "ready" | "not-ready" | "unreviewed" | "archived";
  blockingGaps: number | null;
  /** "about 30 seconds", "30–45 seconds", shortened to "30 s" / "30–45 s". */
  duration: string | null;
  medium: "animated" | "live-action" | null;
  /** The look or style tokens from the header line, cleaned of the medium. */
  look: string[];
  /** The draft kind when the header names one ("Revised story draft"). */
  draftKind: string | null;
  logline: string | null;
  hook: string | null;
  beats: ReaderBeat[];
  cast: ReaderItem[];
  locations: ReaderItem[];
  props: ReaderItem[];
  gaps: ReaderGap[];
  /** Lines under GAPS that are not gaps: batch totals, quotes, caveats. */
  gapNotes: string[];
  /** Everything else, by section: STYLE, SOURCE NOTES, "Key: text" paragraphs… */
  sections: ReaderSection[];
  /** Prose paragraphs that belong to no section (the 27 Oct format). */
  prose: string[];
  sources: Array<{ url: string; label: string }>;
  storyRefs: string[];
  /** Every asset id the record cites, in order of first mention. */
  assetIds: string[];
};

const ASSET_REF = /\basset:([a-z0-9]{20,40})\b/g;
const STORY_REF = /\bstory:([a-z0-9]{20,40})\b/g;
const URL_REF = /https?:\/\/[^\s)\]>"']+/g;
const CODE_REF = /\b[A-Z]{2,4}-CH-\d{3}(?:-C\d{2})?\b/g;
const STATUS_LINE = /^\s*(NOT READY|READY)\b(?:\s*[:·—-]?\s*(\d+)\s+blocking\s+gaps?)?/im;
const DURATION = /\b(?:about\s+|~\s*)?(\d+)(?:\s*[–-]\s*(\d+))?\s*(seconds?|secs?|s|min(?:utes?)?)\b/i;
const MEDIUM = /\((animation|animated|live[ -]action)\)/i;
const BEAT_LINE = /^\s*(\d{1,2})[.)]\s+(.+)$/;
const TIME_PREFIX = /^(\d+)\s*[–-]\s*(\d+)\s*(?:seconds?|secs?|s)\b\.?\s*/i;
const SECTION_HEADING = /^[A-Z][A-Z0-9 &/()\-]{1,44}$/;
const KEY_PARAGRAPH = /^([A-Z][A-Za-z0-9 /&'’-]{1,40}):\s+([\s\S]+)$/;
const GAP_LINE = /^(?:[-•]\s*)?([A-Z][A-Z /]{2,30}):\s*([\s\S]+)$/;

export const shortenUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    if (!last) return host;
    const tail = last.length > 22 ? `${last.slice(0, 10)}…${last.slice(-8)}` : last;
    return parts.length > 1 ? `${host}/…/${tail}` : `${host}/${tail}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 28)}…${url.slice(-8)}` : url;
  }
};

/** Splits a run of text into plain text and the refs it cites, in order. */
export function splitRefs(text: string): ReaderRef[] {
  const out: ReaderRef[] = [];
  const pattern = new RegExp(
    `${ASSET_REF.source}|${STORY_REF.source}|${URL_REF.source}`,
    "g",
  );
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const raw = match[0];
    if (match[1]) out.push({ kind: "asset", id: match[1] });
    else if (match[2]) out.push({ kind: "story", id: match[2] });
    else {
      // A sentence-ending period is not part of the link.
      const url = raw.replace(/[.,;:]+$/, "");
      out.push({ kind: "url", url, label: shortenUrl(url) });
      if (url.length < raw.length) out.push({ kind: "text", text: raw.slice(url.length) });
    }
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const uniq = <T,>(values: T[]): T[] => [...new Set(values)];
const assetIdsIn = (text: string) => uniq([...text.matchAll(ASSET_REF)].map((m) => m[1]));
const codesIn = (text: string) => uniq([...text.matchAll(CODE_REF)].map((m) => m[0]));

/** "crimson valley (dari-red-valley)" → ["crimson valley", "dari-red-valley"]. */
const splitParenthesised = (token: string): string[] => {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(token.trim());
  if (!match) return token.trim() ? [token.trim()] : [];
  return [match[1].trim(), match[2].trim()].filter(Boolean);
};

const shortDuration = (text: string): string | null => {
  const match = DURATION.exec(text);
  if (!match) return null;
  const unit = /^min/i.test(match[3]) ? "min" : "s";
  return match[2] ? `${match[1]}–${match[2]} ${unit}` : `${match[1]} ${unit}`;
};

const normalizeLines = (text: string) =>
  text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""));

const isHeading = (line: string) =>
  SECTION_HEADING.test(line.trim()) && !/^(NOT READY|READY)\b/.test(line.trim());

/** "- The heroine: text. Sheet: asset:…" → a cast or location item. */
const toItem = (raw: string): ReaderItem => {
  const text = raw.replace(/^\s*[-•*]\s*/, "").trim();
  const colon = text.indexOf(":");
  // A label is short, carries no reference and is not a sentence of its own.
  const head = colon > 0 ? text.slice(0, colon).trim() : "";
  const label =
    head && head.length <= 48 && !/asset:|story:|https?:/.test(head) && !/[.!?]/.test(head)
      ? head
      : null;
  return {
    label,
    text: label ? text.slice(colon + 1).trim() : text,
    assetIds: assetIdsIn(text),
    codes: codesIn(text),
  };
};

const toGap = (raw: string): ReaderGap => {
  const text = raw.replace(/^\s*[-•*]\s*/, "").trim();
  const match = GAP_LINE.exec(text);
  const kind = match ? match[1].trim().toLowerCase() : null;
  const body = match ? match[2].trim() : text;
  // The first sentence says what is missing; the rest is the fix.
  const cut = body.search(/(?<=[.;])\s+(?=[A-Z])/);
  return {
    kind,
    summary: cut > 0 ? body.slice(0, cut).replace(/[.;]$/, "") : body.replace(/\.$/, ""),
    detail: cut > 0 ? body.slice(cut).trim() : null,
  };
};

const toBeat = (number: number, raw: string): ReaderBeat => {
  let text = raw.trim();
  let time: string | null = null;
  const timed = TIME_PREFIX.exec(text);
  if (timed) {
    time = `${timed[1]}–${timed[2]} s`;
    text = text.slice(timed[0].length);
  }
  return { number, time, text, assetIds: assetIdsIn(text), missing: null };
};

/** "1. Canal quay; heroine; asset:…; plate missing; 6 seconds." → refs for beat 1. */
const applyBeatReference = (beats: ReaderBeat[], number: number, raw: string) => {
  const beat = beats.find((entry) => entry.number === number);
  if (!beat) return;
  beat.assetIds = uniq([...beat.assetIds, ...assetIdsIn(raw)]);
  const missing = raw
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter((part) => /\b(missing|unproven|needed|lacks?)\b/i.test(part) && !/^asset:/.test(part));
  if (missing.length > 0) beat.missing = missing.join("; ").replace(/\.$/, "");
};

type Block = { heading: string | null; lines: string[] };

/** Cuts the text at upper-case headings; the lead block has no heading. */
const toBlocks = (lines: string[]): Block[] => {
  const blocks: Block[] = [{ heading: null, lines: [] }];
  for (const line of lines) {
    if (isHeading(line) && line.trim().length >= 3) {
      blocks.push({ heading: line.trim(), lines: [] });
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
};

/** Groups lines into paragraphs; a "- " line is a paragraph of its own. */
const toParagraphs = (lines: string[]): string[] => {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(current.join(" ").trim());
    current = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^[-•*]\s+/.test(trimmed) || BEAT_LINE.test(trimmed) || KEY_PARAGRAPH.test(trimmed)) flush();
    current.push(trimmed);
  }
  flush();
  return out;
};

const sectionKind = (heading: string): "story" | "cast" | "locations" | "props" | "refs" | "gaps" | "links" | "other" => {
  const key = heading.toUpperCase();
  if (/^(STORY|BEATS|SHOTS?|SEQUENCE)\b/.test(key) && !/REFERENCE/.test(key)) return "story";
  if (/^(CAST|CHARACTERS?)\b/.test(key)) return "cast";
  if (/^(LOCATIONS?|PLACES?|SETS?)\b/.test(key)) return "locations";
  if (/^PROPS?\b/.test(key)) return "props";
  if (/REFERENCES?$/.test(key)) return "refs";
  if (/^GAPS?\b/.test(key)) return "gaps";
  if (/^ASSET LINKS?\b/.test(key)) return "links";
  return "other";
};

const titleCase = (heading: string) => {
  const inner = heading.replace(/\s*\(.*\)$/, "").toLowerCase();
  return inner.charAt(0).toUpperCase() + inner.slice(1);
};

type Parsed = Omit<ReaderModel, "title" | "world" | "status" | "blockingGaps" | "sources" | "storyRefs" | "assetIds" | "medium" | "duration" | "look" | "draftKind"> & {
  header: string | null;
  worldLine: string | null;
  statusLine: string | null;
};

/** Parses one text (the description or a script body) into its parts. */
function parseText(text: string, knownTitle: string): Parsed {
  const lines = normalizeLines(text);
  const parsed: Parsed = {
    header: null, worldLine: null, statusLine: null,
    logline: null, hook: null, beats: [], cast: [], locations: [], props: [],
    gaps: [], gapNotes: [], sections: [], prose: [],
  };
  const status = STATUS_LINE.exec(text);
  if (status) parsed.statusLine = status[0].trim();

  const blocks = toBlocks(lines);
  const lead = blocks[0];

  // The header is the first line when it reads as one: dots, a duration or
  // the title itself. A plain sentence is prose instead.
  const leadLines = lead.lines.filter((line) => line.trim());
  const first = leadLines[0]?.trim() ?? "";
  const startsWithTitle =
    knownTitle.length > 0 && first.toUpperCase().startsWith(`${knownTitle.toUpperCase()} · `);
  const looksLikeHeader =
    first.length > 0 &&
    (startsWithTitle ||
      ((first.includes(" · ") || DURATION.test(first) || first.toUpperCase() === knownTitle.toUpperCase()) &&
        !/[.!?]$/.test(first.replace(/\)$/, ""))));
  let rest = lead.lines;
  if (looksLikeHeader) {
    parsed.header = first;
    rest = rest.slice(rest.indexOf(leadLines[0]) + 1);
    const second = rest.find((line) => line.trim())?.trim() ?? "";
    if (second && (second.includes(" · ") || second.includes(" › ")) && second.length <= 90 && !/[.!?]$/.test(second)) {
      parsed.worldLine = second;
      rest = rest.slice(rest.indexOf(second.length ? rest.find((line) => line.trim() === second)! : "") + 1);
    }
  }

  // Bare numbered beats and "Key: text" paragraphs live in the lead (13 Oct).
  const leadParagraphs = toParagraphs(rest).filter((paragraph) => !STATUS_LINE.test(paragraph) || paragraph.length > 60);
  const keyed: ReaderSection = { title: "Notes", items: [], paragraphs: [] };
  for (const [index, paragraph] of leadParagraphs.entries()) {
    if (STATUS_LINE.test(paragraph) && paragraph.length <= 60) continue;
    const beat = BEAT_LINE.exec(paragraph);
    if (beat) {
      parsed.beats.push(toBeat(Number(beat[1]), beat[2]));
      continue;
    }
    const key = KEY_PARAGRAPH.exec(paragraph);
    if (key) {
      const item = { label: key[1].trim(), text: key[2].trim(), assetIds: assetIdsIn(paragraph), codes: codesIn(paragraph) };
      const label = item.label.toLowerCase();
      if (/character|cast|wardrobe|costume/.test(label)) parsed.cast.push(item);
      else if (/location|plate|set\b/.test(label)) parsed.locations.push(item);
      else if (/^props?\b/.test(label)) parsed.props.push(item);
      else keyed.items.push(item);
      continue;
    }
    // The logline is the first paragraph under the header, nothing later.
    if (index === 0 && parsed.header && paragraph.length <= 320) {
      parsed.logline = paragraph;
      continue;
    }
    parsed.prose.push(paragraph);
  }
  if (keyed.items.length > 0) parsed.sections.push(keyed);

  for (const block of blocks.slice(1)) {
    const heading = block.heading!;
    const kind = sectionKind(heading);
    const paragraphs = toParagraphs(block.lines);
    switch (kind) {
      case "story":
        for (const paragraph of paragraphs) {
          const beat = BEAT_LINE.exec(paragraph);
          if (beat) parsed.beats.push(toBeat(Number(beat[1]), beat[2]));
          else parsed.prose.push(paragraph);
        }
        break;
      case "cast":
        parsed.cast.push(...paragraphs.map(toItem));
        break;
      case "locations":
        parsed.locations.push(...paragraphs.map(toItem));
        break;
      case "props":
        parsed.props.push(...paragraphs.map(toItem));
        break;
      case "refs":
        for (const paragraph of paragraphs) {
          const beat = BEAT_LINE.exec(paragraph);
          if (beat) applyBeatReference(parsed.beats, Number(beat[1]), beat[2]);
        }
        break;
      case "gaps":
        for (const paragraph of paragraphs) {
          if (GAP_LINE.test(paragraph.replace(/^\s*[-•*]\s*/, ""))) parsed.gaps.push(toGap(paragraph));
          else parsed.gapNotes.push(paragraph);
        }
        break;
      case "links":
        // Asset ids only; they are collected from the whole text below.
        break;
      default: {
        const section: ReaderSection = { title: titleCase(heading), items: [], paragraphs: [] };
        for (const paragraph of paragraphs) {
          if (/^[-•*]\s+/.test(paragraph) || KEY_PARAGRAPH.test(paragraph)) section.items.push(toItem(paragraph));
          else section.paragraphs.push(paragraph);
        }
        parsed.sections.push(section);
      }
    }
  }
  return parsed;
}

export type ReaderScript = {
  title?: string;
  logline?: string;
  hook?: string;
  body: string;
  assetIds?: string[];
  styleTag?: string;
};

export type ReaderInput = {
  /** The folder name, "WORLD · Title" or the bare title. */
  name: string;
  /** The folder description: the record agents write. */
  description?: string;
  /** The script Story attached to the book, when one exists. */
  script?: ReaderScript | null;
  /** The world the book is filed under, when the folder tree knows it. */
  worldName?: string | null;
};

const mergeItems = (primary: ReaderItem[], secondary: ReaderItem[]): ReaderItem[] => {
  const seen = new Set(primary.map((item) => item.text.slice(0, 80).toLowerCase()));
  const out = [...primary];
  for (const item of secondary) {
    const key = item.text.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

/** The reader model for one storybook. Never throws. */
export function parseStorybookRecord(input: ReaderInput): ReaderModel {
  const parts = splitStorybookName(input.name);
  const description = (input.description ?? "").trim();
  const scriptBody = (input.script?.body ?? "").trim();

  // The description leads; the script fills what it lacks. A description
  // that is a copy of the script adds nothing twice.
  const main = parseText(description, parts.title);
  const second = scriptBody && scriptBody !== description ? parseText(scriptBody, parts.title) : null;

  const headerText = main.header ?? second?.header ?? "";
  const headerTokens = headerText.split(" · ").map((token) => token.trim()).filter(Boolean);
  const title = parts.title;
  let draftKind: string | null = null;
  const look: string[] = [];
  let duration: string | null = null;
  let medium: ReaderModel["medium"] = null;
  for (const [index, token] of headerTokens.entries()) {
    const mediumMatch = MEDIUM.exec(token);
    if (mediumMatch) medium = /animat/i.test(mediumMatch[1]) ? "animated" : "live-action";
    const clean = token.replace(MEDIUM, "").trim();
    if (index === 0) {
      if (clean.toUpperCase() === title.toUpperCase()) continue;
      if (/draft|treatment|board|plan|outline/i.test(clean) && !DURATION.test(clean)) {
        draftKind = clean;
        continue;
      }
    }
    if (DURATION.test(clean) && clean.length <= 30) {
      duration = shortDuration(clean);
      continue;
    }
    if (clean && clean.length <= 48) look.push(clean);
    else if (clean) main.prose.unshift(clean);
  }
  if (!duration) duration = shortDuration(headerText) ?? (second ? shortDuration(second.header ?? "") : null);
  if (!medium) {
    const anywhere = MEDIUM.exec(headerText) ?? MEDIUM.exec(main.worldLine ?? "");
    if (anywhere) medium = /animat/i.test(anywhere[1]) ? "animated" : "live-action";
  }
  if (input.script?.styleTag && !look.some((entry) => entry.toLowerCase() === input.script!.styleTag!.toLowerCase())) {
    look.push(input.script.styleTag);
  }

  // "WORLD · style" or "WORLD › Film › Dari · crimson valley (tag)".
  let world: string | null = input.worldName ?? (parts.world !== parts.title ? parts.world : null);
  const worldLine = main.worldLine ?? second?.worldLine;
  if (worldLine) {
    const [head, ...tail] = worldLine.split(/\s[·›]\s/);
    if (!world) world = head.trim();
    for (const token of tail) {
      for (const clean of splitParenthesised(token.replace(MEDIUM, ""))) {
        if (clean.length <= 48 && !look.includes(clean)) look.push(clean);
      }
    }
  }

  const statusText = main.statusLine ?? second?.statusLine ?? null;
  let status: ReaderModel["status"] = "unreviewed";
  let blockingGaps: number | null = null;
  if (statusText) {
    const match = STATUS_LINE.exec(statusText);
    status = match?.[1].toUpperCase() === "READY" ? "ready" : "not-ready";
    if (match?.[2]) blockingGaps = Number(match[2]);
  }
  if (parts.archived) status = "archived";

  const beats = main.beats.length > 0 ? main.beats : second?.beats ?? [];
  const gaps = main.gaps.length > 0 ? main.gaps : second?.gaps ?? [];
  const gapNotes = main.gaps.length > 0 ? main.gapNotes : second?.gapNotes ?? [];
  if (blockingGaps === null && gaps.length > 0 && status === "not-ready") blockingGaps = gaps.length;

  const everything = `${description}\n${scriptBody}`;
  const sources = uniq(
    [...everything.matchAll(URL_REF)].map((match) => match[0].replace(/[.,;:]+$/, "")),
  ).map((url) => ({ url, label: shortenUrl(url) }));
  const storyRefs = uniq([...everything.matchAll(STORY_REF)].map((match) => match[1]));
  const assetIds = uniq([
    ...[...everything.matchAll(ASSET_REF)].map((match) => match[1]),
    ...(input.script?.assetIds ?? []),
  ]);

  return {
    title,
    world,
    status,
    blockingGaps,
    duration,
    medium,
    look: uniq(look),
    draftKind,
    logline: main.logline ?? input.script?.logline ?? second?.logline ?? null,
    hook: input.script?.hook ?? null,
    beats,
    cast: mergeItems(main.cast, second?.cast ?? []),
    locations: mergeItems(main.locations, second?.locations ?? []),
    props: mergeItems(main.props, second?.props ?? []),
    gaps,
    gapNotes,
    sections: [...main.sections, ...(second?.sections ?? [])],
    prose: [...main.prose, ...(second?.prose ?? [])],
    sources,
    storyRefs,
    assetIds,
  };
}

/* ── Frames ─────────────────────────────────────────────────────────────── */

export type ReaderFrame = {
  id: string;
  /** Free text the agent wrote about the frame; "beat 5" in it ties it to a beat. */
  notes?: string | null;
  tagNames?: string[];
};

export type FramePlacement<F extends ReaderFrame> = {
  /** Frames beside each beat, by beat number. */
  byBeat: Map<number, F[]>;
  /** Location plates not tied to a beat, when the Locations block names none. */
  plates: F[];
  /** Everything else, in shelf order. */
  strip: F[];
};

const BEAT_MENTION = /\bbeats?\s*(\d{1,2})\b/gi;

/**
 * Places the shelf's frames: a frame naming a beat number sits beside that
 * beat; when no frame names one, frames take the beats in shelf order, one
 * each. Location-tagged frames that no beat claimed become the plates of the
 * Locations block when its items name no asset. The rest form the strip.
 */
export function placeFrames<F extends ReaderFrame>(
  model: Pick<ReaderModel, "beats" | "locations">,
  frames: F[],
): FramePlacement<F> {
  const byBeat = new Map<number, F[]>();
  const claimed = new Set<string>();
  const beatNumbers = new Set(model.beats.map((beat) => beat.number));
  const explicit = new Map<string, number>();
  for (const beat of model.beats) {
    for (const id of beat.assetIds) explicit.set(id, beat.number);
  }

  for (const frame of frames) {
    const mentioned = uniq(
      [...(frame.notes ?? "").matchAll(BEAT_MENTION)].map((match) => Number(match[1])),
    ).filter((number) => beatNumbers.has(number));
    const target = mentioned.length > 0 ? mentioned : explicit.has(frame.id) ? [explicit.get(frame.id)!] : [];
    for (const number of target) {
      byBeat.set(number, [...(byBeat.get(number) ?? []), frame]);
      claimed.add(frame.id);
    }
  }

  const namedPlates = model.locations.some((item) => item.assetIds.length > 0);
  const unclaimed = frames.filter((frame) => !claimed.has(frame.id));
  const isPlate = (frame: F) => (frame.tagNames ?? []).some((tag) => /^location$/i.test(tag));
  const isSheet = (frame: F) => (frame.tagNames ?? []).some((tag) => /^character$/i.test(tag));

  // Nothing named a beat: the shelf order is the beat order.
  if (claimed.size === 0 && model.beats.length > 0) {
    const scenes = unclaimed.filter((frame) => !isPlate(frame) && !isSheet(frame));
    const pool = scenes.length > 0 ? scenes : unclaimed;
    model.beats.forEach((beat, index) => {
      const frame = pool[index];
      if (frame) {
        byBeat.set(beat.number, [frame]);
        claimed.add(frame.id);
      }
    });
  }

  const left = frames.filter((frame) => !claimed.has(frame.id));
  const plates = !namedPlates && model.locations.length > 0 ? left.filter(isPlate) : [];
  const plateIds = new Set(plates.map((frame) => frame.id));
  const strip = left.filter((frame) => !plateIds.has(frame.id));
  return { byBeat, plates, strip };
}
