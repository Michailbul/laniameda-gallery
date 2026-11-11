// What the extension's writer (Grow, quick edit, Make it ours) is told about
// the world a frame belongs to. The gallery assembles it from the world's own
// files, the same ones open_world hands an agent: WORLD.md, LEARNINGS.md, the
// cast, the World Bible, the storybooks and the world's reference docs. The
// writer has no tools; it reads this text and writes words.
//
// Pure and client-safe: convex/writerBrief.ts gathers the rows, this file
// picks the world from a command's codes and lays the text out under a budget.

import { parseFlags } from "./mj-recipe";

export const WRITER_BRIEF_LIMITS = {
  command: 8000,
  rules: 12_000,
  style: 5000,
  learnings: 8000,
  cast: 14_000,
  bible: 36_000,
  stories: 3000,
  doc: 6000,
  docs: 14_000,
  // Whole brief, in characters. Full is Grow and Make it ours; short is the
  // quick edit, which has to stay fast.
  full: 84_000,
  short: 34_000,
} as const;

export type BriefTier = "full" | "short";
export type BriefPartKey = "rules" | "style" | "learnings" | "cast" | "bible" | "stories" | "docs";
export type BriefPart = {
  key: BriefPartKey;
  /** What the card shows: "rules", "bible", "cast". */
  label: string;
  /** The heading the writer reads. */
  title: string;
  text: string;
};

/** The parts each tier reads, in the order they are laid out and cut. */
const TIER_PARTS: Record<BriefTier, BriefPartKey[]> = {
  full: ["rules", "style", "learnings", "cast", "bible", "stories", "docs"],
  short: ["rules", "style", "learnings", "cast"],
};

const PART_CAP: Record<BriefPartKey, number> = {
  rules: WRITER_BRIEF_LIMITS.rules, style: WRITER_BRIEF_LIMITS.style, learnings: WRITER_BRIEF_LIMITS.learnings,
  cast: WRITER_BRIEF_LIMITS.cast, bible: WRITER_BRIEF_LIMITS.bible, stories: WRITER_BRIEF_LIMITS.stories,
  docs: WRITER_BRIEF_LIMITS.docs,
};

/** How the files bind the writer. The art director's own words still win. */
export const WRITER_BRIEF_RULES = [
  "- A never-rule or a lock in the rule file holds in every prompt you write. The art director's own words in this request outrank the files; nothing else does.",
  "- A character the files name is written with the look the files give them (hair, build, face, costume), in the same words each time. Never invent a new look for a named character.",
  "- People, wardrobe, vehicles, buildings and props come from this world's own materials and era as the files describe them. A trade, garment or object the files exclude stays out.",
  "- A story or a scene agrees with the bible's facts, relationships and tone.",
  "- The files name places, objects and machines of every size. Bring one in only at a size this shot can show (the scale rule): a far city takes skyline-size markers, a street takes building-size ones, only a near shot takes lamps, signs or jewellery. A frame with no room for a marker gets none.",
  "- When the files describe more than one city or country, a frame is in one of them. Never mix their architecture, technology or people.",
  "- The look stays the source prompt's own: its style words are kept exactly as your other rules say. A named style below is orientation; its name is never written into a prompt.",
  "- The files are reference only. Never copy a file name, an id, a code or a parameter from them into a prompt.",
  "- Before you answer, check each prompt against the never-rules and rewrite any that breaks one. Do not mention the check.",
].join("\n");

const CUT_NOTE = "\n[… cut here; the rest is in the gallery]";

const clip = (text: string, cap: number) => {
  const clean = text.replace(/\r/g, "").trim();
  if (clean.length <= cap) return clean;
  const room = Math.max(0, cap - CUT_NOTE.length);
  // Cut at a paragraph or a line when one is near, so a rule is not halved.
  const head = clean.slice(0, room);
  const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
  return `${(at > room * 0.7 ? head.slice(0, at) : head).trimEnd()}${CUT_NOTE}`;
};

export type ComposedBrief = { text: string; read: string[]; chars: number };

/**
 * The world block of the writer's system prompt. Parts come in priority
 * order; each has its own cap and the whole brief has the tier's cap, so the
 * rule file is never the part that gets cut.
 */
export function composeBrief(worldName: string, parts: BriefPart[], tier: BriefTier = "full"): ComposedBrief {
  const wanted = TIER_PARTS[tier];
  const budget = WRITER_BRIEF_LIMITS[tier];
  const sections: string[] = [];
  const read: string[] = [];
  let used = 0;
  for (const key of wanted) {
    for (const part of parts.filter((entry) => entry.key === key)) {
      if (!part.text.trim()) continue;
      const room = Math.min(PART_CAP[key], budget - used);
      if (room < 400) continue;
      const body = clip(part.text, room);
      sections.push(`=== ${part.title} ===\n${body}`);
      used += body.length;
      if (!read.includes(part.label)) read.push(part.label);
    }
  }
  if (sections.length === 0) return { text: "", read: [], chars: 0 };
  const text = [
    `THE WORLD THIS WORK BELONGS TO: ${worldName}. The gallery's own files for this world follow. They bind you:`,
    WRITER_BRIEF_RULES,
    ...sections,
  ].join("\n\n");
  return { text, read, chars: text.length };
}

/* ── Which world a command belongs to ────────────────────────────────────── */

const CODE = /^[a-z0-9]{5,24}$/i;

/** The personalization and style codes of a Midjourney command, lowercased. */
export function commandCodes(command: string | undefined) {
  const text = (command ?? "").slice(0, WRITER_BRIEF_LIMITS.command);
  const at = text.search(/(^|\s)(--|[–—])[a-z]/i);
  const profiles: string[] = [];
  const srefs: string[] = [];
  for (const flag of parseFlags(at < 0 ? "" : text.slice(at))) {
    const into = flag.name === "profile" ? profiles : flag.name === "sref" ? srefs : null;
    if (!into) continue;
    for (const value of flag.values) {
      // "12345::2" is a weighted code; links are image references, not codes.
      const code = value.split("::")[0]!.trim().toLowerCase();
      if (CODE.test(code) && !into.includes(code)) into.push(code);
    }
  }
  return { profiles, srefs };
}

/** Every code a style recipe's own text carries (parameters, template, loose codes). */
export function recipeCodes(recipe: { parameters?: string; template?: string; unknownCodes?: ReadonlyArray<string> }) {
  const out = new Set<string>();
  for (const line of [recipe.parameters, recipe.template]) {
    const found = commandCodes(line);
    for (const code of [...found.profiles, ...found.srefs]) out.add(code);
  }
  for (const loose of recipe.unknownCodes ?? []) {
    for (const token of loose.split(/\s+/)) {
      const code = token.split("::")[0]!.trim().toLowerCase();
      if (CODE.test(code)) out.add(code);
    }
  }
  return out;
}

export type WorldVote = {
  /** The world's key. */
  world: string;
  /** The key of the universe it reads in (its own key when it stands alone). */
  universe: string;
  weight: number;
};

export const VOTE = { moodboard: 3, style: 2, ownProfile: 2, sharedProfile: 1 } as const;

export type WorldPick = { world?: string; tie: string[] };

/**
 * The world with the most evidence. Two worlds level on points are a tie, and
 * a tie is never guessed: unless they share a universe, where the universe's
 * own world is the answer (its bible and cast cover both).
 */
export function pickWorld(votes: WorldVote[]): WorldPick {
  const score = new Map<string, number>();
  const universeOf = new Map<string, string>();
  for (const vote of votes) {
    score.set(vote.world, (score.get(vote.world) ?? 0) + vote.weight);
    universeOf.set(vote.world, vote.universe);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return { tie: [] };
  const top = ranked.filter(([, points]) => points === ranked[0]![1]).map(([world]) => world);
  if (top.length === 1) return { world: top[0], tie: [] };
  const universes = new Set(top.map((world) => universeOf.get(world) ?? world));
  if (universes.size === 1) return { world: [...universes][0], tie: [] };
  return { tie: top };
}

/* ── Which stories and docs are world knowledge ──────────────────────────── */

export const isBibleTitle = (title: string) => /\b(world|story|series|show)\s+bible\b/i.test(title);
export const isCastTitle = (title: string) => /\b(character|cast)\s+(directory|list|bible)\b/i.test(title);

/**
 * A docs/<name>.md that describes the world (its people, places, vehicles,
 * wardrobe, lore), as opposed to one that tells agents how to work (tags,
 * workflow, Midjourney codes, prompting guides, research logs).
 */
export const isWorldKnowledgeDoc = (path: string) => {
  const name = path.replace(/^docs\//, "").replace(/\.md$/i, "");
  if (/(midjourney|prompt|tags?|workflow|research|pipeline|agent|tool|changelog|todo)/i.test(name)) return false;
  return /(character|cast|people|vehicle|skyline|location|place|city|street|wardrobe|costume|prop|story|bible|lore|timeline|creature|rule|canon|world|setting|history)/i.test(name);
};

export type CastRow = {
  code: string; name: string; alias?: string; otherNames: string[]; role?: string; lane?: string;
  status: string; notes?: string; costumes: Array<{ name: string; status: string; notes?: string }>;
};

/** The named cast as plain lines. Retired characters and costumes are left out. */
export function castLines(rows: CastRow[]) {
  const lines: string[] = [];
  for (const row of rows.filter((entry) => entry.status !== "retired")) {
    const names = [row.alias, ...row.otherNames].filter((name): name is string => Boolean(name?.trim()));
    const head = [
      `- ${row.name}${names.length ? ` (also: ${names.join(", ")})` : ""}`,
      row.role?.trim(),
      row.lane === "animation" ? "animation lane" : row.lane === "live-action" ? "live-action lane" : "",
      row.status === "concept" ? "still a concept, look not approved" : "",
    ].filter(Boolean).join(" · ");
    lines.push(row.notes?.trim() ? `${head}: ${row.notes.trim().replace(/\s+/g, " ")}` : head);
    for (const costume of row.costumes.filter((entry) => entry.status !== "retired")) {
      lines.push(`  - costume "${costume.name}"${costume.notes?.trim() ? `: ${costume.notes.trim().replace(/\s+/g, " ")}` : ""}`);
    }
  }
  return lines.join("\n");
}
