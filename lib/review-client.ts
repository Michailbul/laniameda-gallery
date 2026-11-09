import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

// Client helpers for the director review page (app/review/[slug]). The page is
// also served at another address (www.mishabuloichyk.com/cassandra) through a
// rewrite, so nothing here hard-codes "/review/…": every fetch goes to
// `${base}/api/…`, where base is the address the page was opened at.

type PageResult = FunctionReturnType<typeof api.review.page>;
export type ReviewPage = Exclude<PageResult, null | { denied: true }>;
export type ReviewFeedback = NonNullable<FunctionReturnType<typeof api.review.feedback>>;
export type ReviewItem = ReviewPage["items"][number];
export type ReviewFolder = ReviewPage["folders"][number];
export type ReviewStyle = ReviewPage["styles"][number];
export type ReviewVersion = ReviewPage["versions"][number];
export type ReviewSection = ReviewFolder["section"];
export type Verdict = "like" | "dislike";
export type Thumb = { src: string; w: number };

/** The page's own address without a trailing slash ("/cassandra", "/review/cassandra-test"). */
export const reviewBase = () =>
  typeof window === "undefined" ? "" : window.location.pathname.replace(/\/+$/, "") || "";

export const mediaUrl = (mediaBase: string, src?: string) =>
  !src ? "" : /^https?:\/\//.test(src) ? src : `${mediaBase}/${src}`;

/** Thumbs sorted small → large, one per width. */
export const uniqueThumbs = (thumbs: Thumb[]) => {
  const out: Thumb[] = [];
  for (const thumb of thumbs) if (!out.some((row) => row.w === thumb.w)) out.push(thumb);
  return out.sort((a, b) => a.w - b.w);
};

export const srcSetOf = (mediaBase: string, thumbs: Thumb[]) =>
  uniqueThumbs(thumbs).map((thumb) => `${mediaUrl(mediaBase, thumb.src)} ${thumb.w}w`).join(", ");

/** The smallest thumb at least `min` wide (else the largest). */
export const thumbAtLeast = (thumbs: Thumb[], min: number) => {
  const sorted = uniqueThumbs(thumbs);
  return sorted.find((thumb) => thumb.w >= min) ?? sorted[sorted.length - 1];
};

export const SECTION_LABEL: Record<ReviewSection, string> = {
  locations: "Locations",
  characters: "Characters",
  scenes: "Scenes",
};

export const SECTION_SINGULAR: Record<ReviewSection, string> = {
  locations: "Location",
  characters: "Character",
  scenes: "Scene",
};

export const slugOf = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ------------------------------------------------------------- view state

export type FeedbackFilter = "all" | "liked" | "disliked" | "commented" | "todo" | "new" | "feedback" | "archived";
export type GridSize = "s" | "m" | "l";

export type ViewState = {
  section: ReviewSection;
  folder: string; // folder slug, "" = all folders of the section
  style: string; // style slug, "" = all styles
  filter: FeedbackFilter;
  size: GridSize;
  round: string; // round label ("v0.1"), "" = the default round
  open: string; // frame code when the open view shows a frame
};

const FILTERS: FeedbackFilter[] = ["all", "liked", "disliked", "commented", "todo", "new", "feedback", "archived"];
const SIZES: GridSize[] = ["s", "m", "l"];
const SECTIONS: ReviewSection[] = ["locations", "characters", "scenes"];

export const readViewState = (search: string, fallbackSize: GridSize): Partial<ViewState> & { size: GridSize } => {
  const params = new URLSearchParams(search);
  const section = params.get("s") as ReviewSection | null;
  const filter = params.get("show") as FeedbackFilter | null;
  const size = params.get("size") as GridSize | null;
  return {
    section: section && SECTIONS.includes(section) ? section : undefined,
    folder: params.has("f") ? (params.get("f") === "all" ? "" : params.get("f") ?? "") : undefined,
    style: params.get("style") ?? undefined,
    filter: filter && FILTERS.includes(filter) ? filter : undefined,
    size: size && SIZES.includes(size) ? size : fallbackSize,
    round: params.get("r") ?? undefined,
    open: params.get("open") ?? undefined,
  };
};

/** Writes the view into the address bar without a navigation. */
export const writeViewState = (state: ViewState, mode: "replace" | "push" = "replace") => {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const set = (key: string, value: string, empty: string) => {
    if (!value || value === empty) params.delete(key);
    else params.set(key, value);
  };
  set("s", state.section, "");
  params.set("f", state.folder || "all");
  set("style", state.style, "");
  set("show", state.filter, "all");
  set("size", state.size, "");
  set("r", state.round, "");
  set("open", state.open, "");
  params.delete("draft");
  params.delete("invite");
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (mode === "push") window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
};

// ------------------------------------------------------------- formatting

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// UTC, so the server render and the browser agree on the day.
export const shortDate = (ms?: number) => {
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

export const ago = (ms?: number, now = Date.now()) => {
  if (!ms) return "";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return shortDate(ms);
};

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
};

/** Starts a download through the page's own route (a form post, so the browser streams it to disk). */
export const downloadFrames = (base: string, assetIds: string[]) => {
  if (assetIds.length === 0) return;
  if (assetIds.length === 1) {
    const link = document.createElement("a");
    link.href = `${base}/api/download?id=${encodeURIComponent(assetIds[0]!)}`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${base}/api/download`;
  form.style.display = "none";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "ids";
  input.value = assetIds.join(",");
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
};

// ------------------------------------------------------------- owner lists

export const LIST_KEYS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export const LIST_COLORS: Record<ListKey, string> = {
  A: "#E8A838", B: "#79B791", C: "#7FA7E0", D: "#C58BE0", E: "#FF8C42", F: "#E07FA7", G: "#B9C77A",
};
export type Lists = { names: Record<ListKey, string>; items: Record<ListKey, string[]> };

export const emptyLists = (): Lists => ({
  names: Object.fromEntries(LIST_KEYS.map((key) => [key, `List ${key}`])) as Record<ListKey, string>,
  items: Object.fromEntries(LIST_KEYS.map((key) => [key, []])) as unknown as Record<ListKey, string[]>,
});

export const readLists = (slug: string): Lists => {
  const base = emptyLists();
  try {
    const raw = JSON.parse(window.localStorage.getItem(`rv-lists:${slug}`) ?? "null") as Partial<Lists> | null;
    if (!raw) return base;
    for (const key of LIST_KEYS) {
      if (typeof raw.names?.[key] === "string" && raw.names[key]) base.names[key] = raw.names[key];
      if (Array.isArray(raw.items?.[key])) base.items[key] = raw.items[key].filter((id): id is string => typeof id === "string");
    }
  } catch {
    // A broken entry starts the lists fresh.
  }
  return base;
};

export const writeLists = (slug: string, lists: Lists) => {
  try {
    window.localStorage.setItem(`rv-lists:${slug}`, JSON.stringify(lists));
  } catch {
    // Private mode or a full store: lists live for this visit only.
  }
};

// ------------------------------------------------------------- making of

export type MadeWithKind = "moodboard" | "profile" | "sref";
export type MadeWithChip = { kind: MadeWithKind; code: string; name: string };

type NamedCode = { name: string; code?: string };
type MadeWithInput = {
  prompt?: string;
  midjourney?: {
    personalization?: Array<{ code: string; type?: string; name?: string }>;
    otherFlags?: string[];
  } | null;
  style?: { recipes?: Array<{ moodboards?: NamedCode[]; profiles?: NamedCode[] }> } | null;
  /** Gallery moodboards and Midjourney profiles that carry these codes. */
  codeNames?: Array<{ code: string; name: string; type: "moodboard" | "profile" }>;
};

// Values after a flag up to the next "--flag" ("--profile a b --sref 1 2 --ar 16:9").
const flagValues = (text: string, flag: string) => {
  const out: string[] = [];
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== `--${flag}`) continue;
    for (index += 1; index < tokens.length && !tokens[index]!.startsWith("--"); index += 1) out.push(tokens[index]!);
    index -= 1;
  }
  return out;
};

const unique = (values: string[]) => [...new Set(values)];

/**
 * What made a frame, as chips: every --profile code (moodboards and taste
 * profiles, named from the frame's metadata or else the style's recipes) and
 * every --sref. Names show; codes copy.
 */
export const madeWith = (detail: MadeWithInput | null | undefined): MadeWithChip[] => {
  if (!detail) return [];
  const prompt = detail.prompt ?? "";
  const flags = (detail.midjourney?.otherFlags ?? []).join(" ");
  const known = new Map<string, { name: string; kind: "moodboard" | "profile" }>();
  for (const row of detail.codeNames ?? []) known.set(row.code, { name: row.name, kind: row.type });
  for (const recipe of detail.style?.recipes ?? []) {
    for (const row of recipe.moodboards ?? []) if (row.code) known.set(row.code, { name: row.name, kind: "moodboard" });
    for (const row of recipe.profiles ?? []) if (row.code) known.set(row.code, { name: row.name, kind: "profile" });
  }
  const personalization = detail.midjourney?.personalization ?? [];
  const codes = unique([...personalization.map((row) => row.code), ...flagValues(prompt, "profile"), ...flagValues(prompt, "p")]);
  const chips: MadeWithChip[] = codes.map((code) => {
    const meta = personalization.find((row) => row.code === code);
    const recipe = known.get(code);
    const kind = meta?.type === "moodboard" || meta?.type === "profile" ? meta.type : recipe?.kind ?? "profile";
    return { kind, code, name: meta?.name?.trim() || recipe?.name || code };
  });
  for (const code of unique([...flagValues(flags, "sref"), ...flagValues(prompt, "sref")])) {
    chips.push({ kind: "sref", code, name: "Style ref" });
  }
  return chips;
};

/** The flags ready to paste into Midjourney: "--profile a b --sref 1". */
export const madeWithFlags = (chips: MadeWithChip[]) => {
  const profiles = chips.filter((row) => row.kind !== "sref").map((row) => row.code);
  const srefs = chips.filter((row) => row.kind === "sref").map((row) => row.code);
  return [profiles.length ? `--profile ${profiles.join(" ")}` : "", srefs.length ? `--sref ${srefs.join(" ")}` : ""].filter(Boolean).join(" ");
};

/** A short hint of a long code ("2116…5797"). */
export const codeHint = (code: string) => (code.length > 10 ? `${code.slice(0, 4)}…${code.slice(-4)}` : code);
