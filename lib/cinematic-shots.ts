// The art director's library of shot layouts for the extension's writer.
//
// Frames saved on the gallery shelf CINEMATIC SHOTS (a child of CINEMATIC)
// each carry a shot card in their description: a plain title, the
// cinematography label, a breakdown and a style-neutral base prompt. When a
// quick edit or a Grow request asks for cinematic shots or a camera layout,
// the gallery hands the closest cards to the writer, which builds its prompts
// on them in the frame's own world and look (convex/cinematicShots.ts reads
// the shelf, this file is pure and client-safe).

export const CINEMATIC_SHOTS_SHELF = "CINEMATIC SHOTS";
/** The root collection the shelf sits under (a child's stored name carries its parent's id). */
export const CINEMATIC_SHOTS_PARENT = "CINEMATIC";

export const CINEMATIC_SHOT_LIMITS = {
  /** Cards scanned on the shelf. */
  scan: 300,
  /** Cards given whole to the writer. */
  picked: 8,
  /** Characters of one base prompt. */
  basePrompt: 900,
  /** The whole block, in characters. */
  block: 9000,
} as const;

/** A request that asks for shots, framing or a camera layout. */
export const CINEMATIC_SHOT_ASK = /\b(?:cinematic|cinematography|shots?|framing|framed|camera|angles?|composition|layouts?|over[- ]the[- ]shoulder|close[- ]?ups?|medium[- ](?:wide|close)|extreme[- ]wide|wides?|establishing|planimetric|symmetrical|top[- ]down|overhead|bird'?s[- ]eye|worm'?s[- ]eye|low[- ]angle|high[- ]angle|dutch|telephoto|long[- ]lens|wide[- ]lens|two[- ]shot|reverse|tableau|staging)\b/i;

export const asksForShots = (...texts: Array<string | undefined>) => texts.some((text) => Boolean(text && CINEMATIC_SHOT_ASK.test(text)));

export type ShotCard = {
  id: string;
  title: string;
  shotName: string;
  basePrompt: string;
  tags: string[];
};

const HEAD = /^\s*CINEMATIC SHOT\s*[·•\-–—:]\s*(.+)$/im;
const BASE = /Base prompt[^\n]*:\s*\n([\s\S]+?)(?:\n\s*\n|$)/i;

/** The shot card a frame's description carries, or null when it has none. */
export function parseShotCard(id: string, description: string | undefined, tags: string[] = []): ShotCard | null {
  const text = (description ?? "").replace(/\r/g, "");
  const head = HEAD.exec(text);
  const base = BASE.exec(text);
  if (!head || !base) return null;
  const after = text.slice((head.index ?? 0) + head[0].length).replace(/^\n+/, "");
  const shotName = (after.split("\n")[0] ?? "").trim();
  const basePrompt = base[1]!.replace(/\s+/g, " ").trim().slice(0, CINEMATIC_SHOT_LIMITS.basePrompt);
  if (!basePrompt) return null;
  return { id, title: head[1]!.trim(), shotName: /^size & lens:/i.test(shotName) ? "" : shotName, basePrompt, tags };
}

// Tags that only say where a frame came from; they never decide a match.
const SOURCE_TAGS = new Set(["inspiration", "cinematography", "film-still", "live-action", "cinematic-shot", "better-call-saul"]);
const STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "and", "or", "to", "for", "with", "from", "by", "is", "it", "this", "that", "me", "my", "some", "pls", "please", "make", "give", "write", "prompt", "prompts", "shot", "shots", "cinematic", "frame", "like", "more", "new", "one", "two"]);

const words = (text: string) => text.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9-]+/).flatMap((word) => word.includes("-") ? [word, ...word.split("-")] : [word])
  .filter((word) => word.length > 1 && !STOP.has(word));

/** How well a card answers the request: its shot tags and label count most, then its title and base prompt. */
export function shotScore(card: ShotCard, request: string) {
  const asked = new Set(words(request));
  const flat = request.toLowerCase().replace(/\s+/g, "-");
  let score = 0;
  for (const tag of card.tags) {
    if (SOURCE_TAGS.has(tag)) continue;
    if (flat.includes(tag) || asked.has(tag)) score += 6;
  }
  for (const word of new Set(words(card.shotName))) if (asked.has(word)) score += 3;
  for (const word of new Set(words(card.title))) if (asked.has(word)) score += 2;
  for (const word of new Set(words(card.basePrompt))) if (asked.has(word)) score += 1;
  return score;
}

/** The cards to hand over: the best matches first; with no match, a spread of different shot types. */
export function pickShots(cards: ShotCard[], request: string, limit: number = CINEMATIC_SHOT_LIMITS.picked) {
  const ranked = cards.map((card, index) => ({ card, index, score: shotScore(card, request) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked[0]?.score) return ranked.filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.card);
  // Nothing named: one card per leading shot type, so the writer sees range.
  const seen = new Set<string>();
  const spread: ShotCard[] = [];
  for (const { card } of ranked) {
    const kind = card.tags.find((tag) => !SOURCE_TAGS.has(tag)) ?? card.shotName;
    if (seen.has(kind)) continue;
    seen.add(kind);
    spread.push(card);
    if (spread.length >= limit) break;
  }
  return spread;
}

/** The block the writer reads: how to use the library, the picked cards whole and the other titles. */
export function shotsBlock(picked: ShotCard[], all: ShotCard[]) {
  if (!picked.length) return "";
  const lines = [
    `CINEMATIC SHOTS LIBRARY: the art director's saved shot layouts (${all.length} on the shelf). The request asks for cinematic shots or a camera layout, so build on these:`,
    "- Pick the saved shot that fits each prompt (or the one the request names) and keep its camera: shot size, lens feel, camera height and angle, where things sit in the frame, the staging in depth and the direction of the light.",
    "- Recast it in this frame's world, people and look: the source prompt's style words and the world's files decide what the people, places and materials are. The base prompts are layouts, never a look to copy.",
    "- Never write a card's title, the words \"cinematic shot\", a show name or an id into a prompt.",
    "",
    ...picked.map((card, index) => `${index + 1}. ${card.title}${card.shotName ? ` · ${card.shotName}` : ""}${card.tags.length ? ` [${card.tags.filter((tag) => !SOURCE_TAGS.has(tag)).join(", ")}]` : ""}\n   ${card.basePrompt}`),
  ];
  const others = all.filter((card) => !picked.includes(card)).map((card) => card.title);
  if (others.length) lines.push("", `Also on the shelf (ask for one by name): ${others.join(" · ")}.`);
  const text = lines.join("\n");
  return text.length > CINEMATIC_SHOT_LIMITS.block ? `${text.slice(0, CINEMATIC_SHOT_LIMITS.block - 30).trimEnd()}\n[… more on the shelf]` : text;
}
