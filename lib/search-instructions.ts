// Reads a search the way it is typed: "dear annete world, interiors / city
// street", then "no cars", then "dark". A search is a thread of steps. Each
// step is one instruction, and together they say where to look, what to look
// for and what to leave out. Pure: the gallery page, tests and agents share it.
import { galleryWordMatcher } from "./gallery-search";

export type SearchFolder = { id: string; name: string; parentId?: string };

export type SearchStepKind = "words" | "place" | "filter" | "exclude";
export type SearchStepReading = {
  kind: SearchStepKind;
  // What the chip says: the step as it was understood.
  label: string;
};

export type SearchPieceType = "character" | "location" | "scene" | "inspiration";

export type SearchInstructions = {
  // Up to three ways to say what is wanted; a piece matching any is found.
  phrasings: string[];
  // Things to leave out.
  exclude: string[];
  // The world or collection the search stays inside: itself and its shelves.
  folderIds?: string[];
  folderName?: string;
  kind?: "image" | "video";
  pieceType?: SearchPieceType;
  medium?: "animation" | "live-action";
  onlyLiked?: boolean;
  // Tags that rule a piece out. "interiors" rules out what the tagger marked
  // exterior; a piece it could not judge stays in and ranks by its words.
  excludeTags?: string[];
  // One reading per step, in order.
  steps: SearchStepReading[];
};

export const MAX_SEARCH_PHRASINGS = 3;
export const MAX_SEARCH_EXCLUDED = 6;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const tokensOf = (text: string) => text.toLowerCase().split(WORD_SPLIT).filter(Boolean);

const NEGATION = /^(?:and\s+|but\s+)?(?:no|not|without|exclude|excluding|except|minus|remove|hide|skip|drop)\s+(.+)$/i;
const DASH_NEGATION = /^[-−–]\s*(\S.*)$/;
const INLINE_NEGATION = /\s+(?:without|except|excluding|but\s+not|but\s+no|minus)\s+/i;
const ALTERNATIVES = /\s*\/\s*|\s+or\s+/i;
const FILLER = new Set(["only", "just", "show", "me", "the", "all", "my", "ones", "pieces"]);
const PLACE_BEFORE = new Set(["in", "from", "inside", "within", "only", "just", "world", "collection", "project", "folder", "shelf", "universe"]);
const PLACE_AFTER = new Set(["world", "universe", "project", "collection", "shelf", "folder", "only"]);

type Filter = Pick<SearchInstructions, "kind" | "pieceType" | "medium" | "onlyLiked">;
const FILTER_PHRASES: Array<{ phrases: string[]; filter: Filter; label: string }> = [
  { phrases: ["video", "videos", "clip", "clips", "footage"], filter: { kind: "video" }, label: "Videos" },
  { phrases: ["image", "images", "picture", "pictures"], filter: { kind: "image" }, label: "Images" },
  { phrases: ["liked", "likes", "favorites", "favourites", "favorite", "favourite"], filter: { onlyLiked: true }, label: "Liked" },
  { phrases: ["character", "characters"], filter: { pieceType: "character" }, label: "Characters" },
  { phrases: ["location", "locations", "places"], filter: { pieceType: "location" }, label: "Locations" },
  { phrases: ["scene", "scenes"], filter: { pieceType: "scene" }, label: "Scenes" },
  { phrases: ["inspiration", "inspirations", "references", "refs"], filter: { pieceType: "inspiration" }, label: "Inspiration" },
  { phrases: ["animation", "animated"], filter: { medium: "animation" }, label: "Animation" },
  { phrases: ["live action"], filter: { medium: "live-action" }, label: "Live action" },
];
// "no videos" is a filter too: the other kind.
const NEGATED_FILTERS: Array<{ phrases: string[]; filter: Filter; label: string }> = [
  { phrases: ["video", "videos", "clip", "clips"], filter: { kind: "image" }, label: "Images" },
  { phrases: ["image", "images", "picture", "pictures"], filter: { kind: "video" }, label: "Videos" },
  { phrases: ["animation", "animated"], filter: { medium: "live-action" }, label: "Live action" },
  { phrases: ["live action"], filter: { medium: "animation" }, label: "Animation" },
];

// Words the gallery's tagger answers for every picture (lib/facet-tags.ts):
// inside or out, the light, how close the camera is. About half the pictures
// carry a tag in each of these slots, so the word stays a search word and the
// tags only rule out pieces known to be something else.
const FACET_WORDS: Array<{ phrases: string[]; tag: string; ruledOut: string[] }> = [
  { phrases: ["interior", "interiors", "indoor", "indoors"], tag: "interior", ruledOut: ["exterior"] },
  { phrases: ["exterior", "exteriors", "outdoor", "outdoors", "outside"], tag: "exterior", ruledOut: ["interior"] },
  { phrases: ["night", "nighttime", "at night"], tag: "night", ruledOut: ["day", "golden-hour"] },
  { phrases: ["daytime", "daylight"], tag: "day", ruledOut: ["night", "dusk"] },
  { phrases: ["dusk", "twilight", "blue hour"], tag: "dusk", ruledOut: ["day"] },
  { phrases: ["golden hour", "sunset", "sunrise"], tag: "golden-hour", ruledOut: ["night"] },
  { phrases: ["close up", "closeup", "closeups", "close ups"], tag: "close-up", ruledOut: ["wide-shot"] },
  { phrases: ["wide shot", "wide shots", "establishing shot"], tag: "wide-shot", ruledOut: ["close-up", "macro"] },
  { phrases: ["macro"], tag: "macro", ruledOut: ["wide-shot"] },
];
const facetsIn = (tokens: string[]) => {
  const text = ` ${tokens.join(" ")} `;
  return FACET_WORDS.filter((facet) => facet.phrases.some((phrase) => text.includes(` ${phrase} `)));
};

const findFilter = (table: typeof FILTER_PHRASES, tokens: string[]) => {
  const phrase = tokens.filter((token) => !FILLER.has(token)).join(" ");
  return phrase ? table.find((entry) => entry.phrases.includes(phrase)) : undefined;
};

type FolderAlias = { folder: SearchFolder; tokens: string[]; whole: boolean };

// A folder answers to its whole name, and to the part before a dash
// ("ANDROMEDA — ANYA" answers to "andromeda") unless another folder is called
// exactly that. Longest names first, so "dear annete art deco" is its own world.
const folderAliases = (folders: SearchFolder[]) => {
  const whole = new Set(folders.map((folder) => tokensOf(folder.name).join(" ")));
  const aliases: FolderAlias[] = [];
  for (const folder of folders) {
    const tokens = tokensOf(folder.name);
    if (tokens.length === 0) continue;
    aliases.push({ folder, tokens, whole: true });
    const head = tokensOf(folder.name.split(/\s+[—–\-·:|]\s+/)[0] ?? "");
    if (head.length > 0 && head.length < tokens.length && !whole.has(head.join(" "))) {
      aliases.push({ folder, tokens: head, whole: false });
    }
  }
  return aliases.sort((left, right) =>
    right.tokens.length - left.tokens.length ||
    Number(right.whole) - Number(left.whole) ||
    Number(Boolean(left.folder.parentId)) - Number(Boolean(right.folder.parentId)));
};

// A named world or collection with a cue next to it: "dear annete world",
// "in cassandra", "from the cars collection". A bare name stays a search
// word, so "cars" still searches the whole gallery for cars.
const findPlace = (tokens: string[], aliases: FolderAlias[]) => {
  for (const alias of aliases) {
    const size = alias.tokens.length;
    for (let start = 0; start + size <= tokens.length; start += 1) {
      if (!alias.tokens.every((token, offset) => tokens[start + offset] === token)) continue;
      let from = start;
      let to = start + size;
      if (tokens[from - 1] === "the") from -= 1;
      const before = PLACE_BEFORE.has(tokens[from - 1] ?? "");
      const after = PLACE_AFTER.has(tokens[to] ?? "");
      if (!before && !after) continue;
      if (before) from -= 1;
      if (after) to += 1;
      // "in the dear annete world only"
      if (PLACE_AFTER.has(tokens[to] ?? "")) to += 1;
      return { folder: alias.folder, rest: [...tokens.slice(0, from), ...tokens.slice(to)] };
    }
  }
  return null;
};

const stripArticle = (phrase: string) => phrase.trim().replace(/^(?:any|the|a|an)\s+/i, "").trim();

/**
 * One typed line into steps, one instruction each: "dear annete world,
 * interiors without cars" becomes "dear annete world", "interiors", "no cars".
 */
export const splitSearchSteps = (text: string, folders: SearchFolder[] = []): string[] => {
  const aliases = folderAliases(folders);
  const steps: string[] = [];
  for (const raw of text.split(/[,;\n]+|\s+but\s+(?=no\s|not\s|without\s)/i)) {
    const clause = raw.trim().replace(/\s+/g, " ");
    if (!clause) continue;
    if (NEGATION.test(clause) || DASH_NEGATION.test(clause)) {
      steps.push(clause);
      continue;
    }
    const [wanted, ...unwanted] = clause.split(INLINE_NEGATION);
    const place = findPlace(tokensOf(wanted ?? ""), aliases);
    if (place && place.rest.length > 0) {
      // "interiors in dear annete": where to look, then what to look for.
      steps.push(`in ${place.folder.name}`, place.rest.join(" "));
    } else if (wanted?.trim()) {
      steps.push(wanted.trim());
    }
    for (const phrase of unwanted) {
      if (phrase.trim()) steps.push(`no ${phrase.trim()}`);
    }
  }
  return steps;
};

/** What a thread of steps asks for. */
export const readSearchInstructions = (
  steps: string[],
  folders: SearchFolder[] = [],
): SearchInstructions => {
  const aliases = folderAliases(folders);
  const readings: SearchStepReading[] = [];
  const exclude: string[] = [];
  const excludeTags = new Set<string>();
  const filter: Filter = {};
  // Plain words every phrasing carries, and the newest "a / b" choice.
  const words: Array<{ text: string } | { choice: string[] }> = [];
  let place: SearchFolder | undefined;

  for (const step of steps) {
    const clause = step.trim().replace(/\s+/g, " ");
    if (!clause) continue;

    const negated = clause.match(NEGATION)?.[1] ?? clause.match(DASH_NEGATION)?.[1];
    if (negated) {
      const phrases = negated.split(/\s*\/\s*|\s+or\s+|\s+and\s+|\s*&\s*/i).map(stripArticle).filter(Boolean);
      const labels: string[] = [];
      for (const phrase of phrases) {
        const other = findFilter(NEGATED_FILTERS, tokensOf(phrase));
        if (other) {
          Object.assign(filter, other.filter);
          labels.push(other.label);
        } else {
          exclude.push(phrase.toLowerCase());
          labels.push(`no ${phrase.toLowerCase()}`);
          // "no interiors": the tag itself is out, not only the word.
          for (const facet of facetsIn(tokensOf(phrase))) excludeTags.add(facet.tag);
        }
      }
      readings.push({
        kind: labels.every((label) => label.startsWith("no ")) ? "exclude" : "filter",
        label: labels.join(", "),
      });
      continue;
    }

    const tokens = tokensOf(clause);
    const named = findPlace(tokens, aliases);
    if (named && named.rest.length === 0) {
      place = named.folder;
      readings.push({ kind: "place", label: named.folder.name });
      continue;
    }

    const typed = findFilter(FILTER_PHRASES, tokens);
    if (typed) {
      Object.assign(filter, typed.filter);
      readings.push({ kind: "filter", label: typed.label });
      continue;
    }

    const choice = clause.split(ALTERNATIVES).map((part) => part.trim()).filter(Boolean);
    // "interiors / city street" asks for either, so it rules nothing out.
    if (choice.length === 1) {
      for (const facet of facetsIn(tokens)) facet.ruledOut.forEach((tag) => excludeTags.add(tag));
    }
    words.push(choice.length > 1 ? { choice } : { text: clause });
    readings.push({ kind: "words", label: choice.length > 1 ? choice.join(" / ") : clause });
  }

  // Only the newest choice forks the search; an older one reads as its words.
  const lastChoice = words.reduce((last, entry, index) => ("choice" in entry ? index : last), -1);
  const options = lastChoice >= 0
    ? (words[lastChoice] as { choice: string[] }).choice.slice(0, MAX_SEARCH_PHRASINGS)
    : [undefined];
  let phrasings = options.map((option) =>
    words.map((entry, index) =>
      "text" in entry ? entry.text : index === lastChoice ? option! : entry.choice.join(" or "),
    ).join(", ")).filter(Boolean);
  // "dear annete world" alone still shows something: that world's pieces.
  if (phrasings.length === 0 && place) phrasings = [place.name];

  const folderIds = place
    ? [place.id, ...folders.filter((folder) => folder.parentId === place!.id).map((folder) => folder.id)]
    : undefined;
  return {
    phrasings,
    exclude: [...new Set(exclude)].slice(0, MAX_SEARCH_EXCLUDED),
    ...(folderIds ? { folderIds, folderName: place!.name } : {}),
    ...filter,
    ...(excludeTags.size > 0 ? { excludeTags: [...excludeTags] } : {}),
    steps: readings,
  };
};

// What a search sends to the backend, without the per-step readings.
export type SearchRequest = Omit<SearchInstructions, "steps">;

/** Two threads that ask for the same thing share a key. */
export const searchInstructionsKey = (instructions: SearchInstructions) => {
  const request: Required<{ [K in keyof SearchRequest]: SearchRequest[K] | null }> = {
    phrasings: instructions.phrasings,
    exclude: instructions.exclude,
    folderIds: instructions.folderIds ?? null,
    folderName: instructions.folderName ?? null,
    kind: instructions.kind ?? null,
    pieceType: instructions.pieceType ?? null,
    medium: instructions.medium ?? null,
    onlyLiked: instructions.onlyLiked ?? null,
    excludeTags: instructions.excludeTags ?? null,
  };
  return JSON.stringify(request);
};

/** The request a key stands for. */
export const searchRequestFromKey = (key: string): SearchRequest => {
  const raw = JSON.parse(key) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== null),
  ) as SearchRequest;
};

/**
 * Keyword test for the pieces that follow the ranked results: the text holds
 * every word of one phrasing and names nothing the search leaves out. A
 * search with no words of its own ("only videos") lets every text through.
 */
export const searchWordsMatcher = (instructions: Pick<SearchInstructions, "phrasings" | "exclude">) => {
  const wanted = instructions.phrasings.map((phrasing) => galleryWordMatcher(phrasing));
  const unwanted = instructions.exclude.map((phrase) => galleryWordMatcher(phrase));
  return (text: string) =>
    (wanted.length === 0 || wanted.some((matches) => matches(text))) &&
    !unwanted.some((matches) => matches(text));
};

// The same folding the backend uses for tag names (convex/helpers.ts).
const tagKey = (name: string) =>
  name.trim().toLowerCase().replace(/^#+/, "").replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
// convex/tagFilters.ts: plural and "still" spellings count.
const PIECE_TYPE_TAGS: Record<SearchPieceType, string[]> = {
  character: ["character", "characters"],
  location: ["location", "locations"],
  scene: ["scene", "scenes", "still", "stills"],
  inspiration: ["inspiration", "inspirations"],
};

export type SearchablePiece = {
  kind: "image" | "video";
  isLiked?: boolean;
  folderIds?: string[];
  tagNames?: string[];
};

/**
 * The whole request as a test on one loaded piece and its searchable text:
 * the filters the backend applies, plus the keyword test. The grid uses it
 * for the pieces it reads past the ranked results, and for a search that only
 * filters.
 */
export const searchPieceFilter = (instructions: SearchRequest) => {
  const hasWords = searchWordsMatcher(instructions);
  const folders = instructions.folderIds ? new Set(instructions.folderIds) : null;
  const pieceTags = instructions.pieceType ? PIECE_TYPE_TAGS[instructions.pieceType] : null;
  const ruledOut = (instructions.excludeTags ?? []).map(tagKey);
  return (piece: SearchablePiece, text: string) => {
    if (instructions.kind && piece.kind !== instructions.kind) return false;
    if (instructions.onlyLiked && piece.isLiked !== true) return false;
    if (folders && !(piece.folderIds ?? []).some((id) => folders.has(String(id)))) return false;
    const tags = new Set((piece.tagNames ?? []).map(tagKey));
    if (pieceTags && !pieceTags.some((tag) => tags.has(tag))) return false;
    if (instructions.medium && (instructions.medium === "animation") !== tags.has("animation")) return false;
    if (ruledOut.some((tag) => tags.has(tag))) return false;
    return hasWords(text);
  };
};

/** True when the search only filters: nothing to rank, so the grid browses. */
export const searchOnlyFilters = (instructions: SearchRequest) =>
  instructions.phrasings.length === 0 &&
  Boolean(
    instructions.kind || instructions.pieceType || instructions.medium || instructions.onlyLiked ||
    instructions.exclude.length > 0 || instructions.excludeTags?.length,
  );
