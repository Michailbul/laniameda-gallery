// A Midjourney queue thread as a conversation and a series of runs
// (23 Nov 2026, Michael: "the thread is rerunnable and I can iterate on it in
// a chat with the agent").
//
// Runs: every prompt of a thread belongs to a run (`run`, 1 when unset). A
// rerun copies chosen prompts into the next run with a new recipe (moodboards
// and profile codes, --sref, --stylize, --chaos, --ar, --raw, --hd, the
// keyword opening); the earlier runs keep their sent commands, job ids and
// filed frames. Nothing is ever sent to Midjourney: every job stays
// Michael's own click.
//
// Chat: Michael writes to the agent in the thread; the writer (This Mac,
// Cloud · fal or Cloud · Pika, the same routes as Grow and quick edit)
// answers with a reply and a list of operations on the thread, which the
// gallery checks and applies. Agents on MCP read and answer the same chat.

export const MJ_THREAD_LIMITS = {
  message: 4000,
  reply: 4000,
  changes: 40,
  change: 300,
  messagesRead: 120,
  // What the chat writer is shown of the thread.
  writerItems: 200,
  writerPrompt: 1600,
  writerHistory: 24,
  opening: 200,
  ops: 60,
  runLabel: 160,
  note: 1000,
} as const;

export type MjRecipe = {
  /** Replaces the whole --profile list (moodboard and profile codes, m<id>). */
  profileCodes?: string[];
  /** Codes added to / removed from each prompt's own list. */
  addProfileCodes?: string[];
  removeProfileCodes?: string[];
  /** Replaces the --sref list: numeric codes or public image URLs. */
  srefs?: string[];
  /** Replaces the whole params line; the fields below apply on top. */
  params?: string;
  stylize?: number | null;
  chaos?: number | null;
  weird?: number | null;
  ar?: string | null;
  raw?: boolean;
  hd?: boolean;
  /** The keyword opening every prompt starts with ("Painted storybook animation frame."). "" removes it. */
  opening?: string;
};

export const MJ_RECIPE_KEYS = [
  "profileCodes", "addProfileCodes", "removeProfileCodes", "srefs", "params",
  "stylize", "chaos", "weird", "ar", "raw", "hd", "opening",
] as const;

const tidy = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();

// ── Params: one flag at a time (the extension's mj-queue.js has the same rules) ──

const FLAGS = {
  stylize: ["stylize", "s"],
  chaos: ["chaos", "c"],
  weird: ["weird", "w"],
  ar: ["ar", "aspect"],
} as const;
type FlagKey = keyof typeof FLAGS;
const RAW_RE = /(^|\s)(?:--raw|--style\s+raw)(?=\s|$)/gi;
const HD_RE = /(^|\s)--hd(?=\s|$)/gi;

export function paramOf(params: string | undefined, key: FlagKey) {
  const pattern = new RegExp(`(^|\\s)--(?:${FLAGS[key].join("|")})\\s+(\\S+)(?=\\s|$)`, "gi");
  const found = [...String(params ?? "").matchAll(pattern)];
  return found.length ? found[found.length - 1]![2]! : null;
}

/** The params with that flag set to value (where it already was), or removed for null / "". */
export function withParam(params: string | undefined, key: FlagKey, value: string | number | null | undefined) {
  const v = value == null ? "" : String(value).trim();
  let placed = false;
  const pattern = new RegExp(`(^|\\s)--(${FLAGS[key].join("|")})\\s+(\\S+)(?=\\s|$)`, "gi");
  const text = tidy(String(params ?? "").replace(pattern, (_all, lead: string) => {
    if (!v || placed) return lead;
    placed = true;
    return `${lead}--${key === "ar" ? "ar" : key} ${v}`;
  }));
  return v && !placed ? tidy(`${text} --${key} ${v}`) : text;
}

export const isRaw = (params: string | undefined) => new RegExp(RAW_RE.source, "i").test(String(params ?? ""));
export const isHd = (params: string | undefined) => new RegExp(HD_RE.source, "i").test(String(params ?? ""));
export const withRaw = (params: string | undefined, on: boolean) => {
  const text = tidy(String(params ?? "").replace(RAW_RE, "$1"));
  return on ? tidy(`${text} --raw`) : text;
};
export const withHd = (params: string | undefined, on: boolean) => {
  const text = tidy(String(params ?? "").replace(HD_RE, "$1"));
  return on ? tidy(`${text} --hd`) : text;
};

const RANGES: Record<Exclude<FlagKey, "ar">, [number, number]> = { stylize: [0, 1000], chaos: [0, 100], weird: [0, 3000] };

/** A recipe with its values checked; throws a plain-words Error on a bad one. */
export function cleanRecipe(input: MjRecipe): MjRecipe {
  const out: MjRecipe = {};
  const codes = (list: unknown, label: string) => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) throw new Error(`${label} is a list of codes.`);
    const clean = [...new Set(list.map((code) => tidy(code).replace(/^--?p(?:rofile)?\s+/, "")).filter(Boolean))];
    for (const code of clean) if (!/^[A-Za-z0-9]{1,40}$/.test(code)) throw new Error(`"${code}" is not a Midjourney profile or moodboard code.`);
    if (clean.length > 10) throw new Error("At most 10 profile codes.");
    return clean;
  };
  out.profileCodes = codes(input.profileCodes, "profileCodes");
  out.addProfileCodes = codes(input.addProfileCodes, "addProfileCodes");
  out.removeProfileCodes = codes(input.removeProfileCodes, "removeProfileCodes");
  if (input.srefs !== undefined) {
    const list = [...new Set((input.srefs ?? []).map(tidy).filter(Boolean))];
    for (const ref of list) {
      if (!/^[A-Za-z0-9-]{1,40}(::-?\d+(\.\d+)?)?$/.test(ref) && !/^https?:\/\/\S+$/.test(ref)) throw new Error(`"${ref.slice(0, 60)}" is not an sref code or image URL.`);
    }
    if (list.length > 10) throw new Error("At most 10 style references.");
    out.srefs = list;
  }
  if (input.params !== undefined) {
    const params = tidy(input.params);
    if (params.length > 600) throw new Error("Params are limited to 600 characters.");
    out.params = params;
  }
  for (const key of ["stylize", "chaos", "weird"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null) { out[key] = null; continue; }
    const n = Number(value);
    const [lo, hi] = RANGES[key];
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${key} is ${lo} to ${hi}.`);
    out[key] = Math.round(n);
  }
  if (input.ar !== undefined) {
    if (input.ar === null || tidy(input.ar) === "") out.ar = null;
    else if (/^\d{1,3}:\d{1,3}$/.test(tidy(input.ar))) out.ar = tidy(input.ar);
    else throw new Error("Aspect is two numbers like 16:9.");
  }
  if (typeof input.raw === "boolean") out.raw = input.raw;
  if (typeof input.hd === "boolean") out.hd = input.hd;
  if (input.opening !== undefined) {
    const opening = tidy(input.opening);
    if (opening.length > MJ_THREAD_LIMITS.opening) throw new Error(`The opening is limited to ${MJ_THREAD_LIMITS.opening} characters.`);
    out.opening = opening;
  }
  for (const key of MJ_RECIPE_KEYS) if (out[key] === undefined) delete out[key];
  return out;
}

export const recipeIsEmpty = (recipe: MjRecipe) => MJ_RECIPE_KEYS.every((key) => recipe[key] === undefined);

// ── The keyword opening ──

/** The first sentence of a prompt ("Painted storybook animation frame."), when short enough to be an opening. */
export function firstSentence(prompt: string) {
  const text = tidy(prompt);
  const match = /^(.{3,200}?[.!?])(?=\s|$)/.exec(text);
  return match ? match[1]! : "";
}

/** The opening most prompts of a thread share ("" when fewer than half do). */
export function threadOpening(prompts: string[]) {
  const tally = new Map<string, number>();
  for (const prompt of prompts) {
    const first = firstSentence(prompt);
    if (first) tally.set(first, (tally.get(first) ?? 0) + 1);
  }
  let best = "";
  let count = 0;
  for (const [sentence, n] of tally) if (n > count) { best = sentence; count = n; }
  return count >= Math.max(1, Math.ceil(prompts.length / 2)) ? best : "";
}

/** The prompt with its opening swapped (or added in front, or removed for ""). */
export function withOpening(prompt: string, from: string, to: string) {
  const text = tidy(prompt);
  const next = tidy(to);
  const old = tidy(from);
  let body = text;
  if (old && text.toLowerCase().startsWith(old.toLowerCase())) body = tidy(text.slice(old.length));
  else if (!old && next) {
    // No shared opening: a prompt that already starts with the new one keeps it once.
    if (text.toLowerCase().startsWith(next.toLowerCase())) return text;
  }
  if (!next) return body;
  const sentence = /[.!?]$/.test(next) ? next : `${next}.`;
  return tidy(`${sentence} ${body}`);
}

// ── A recipe applied to one prompt ──

export type RecipeTarget = { prompt: string; profileCodes: string[]; params?: string; srefs?: string[] };

export function applyRecipe(item: RecipeTarget, recipe: MjRecipe, threadOpeningText = "") {
  let params = tidy(item.params);
  if (recipe.params !== undefined) params = tidy(recipe.params);
  if (recipe.stylize !== undefined) params = withParam(params, "stylize", recipe.stylize);
  if (recipe.chaos !== undefined) params = withParam(params, "chaos", recipe.chaos);
  if (recipe.weird !== undefined) params = withParam(params, "weird", recipe.weird);
  if (recipe.ar !== undefined) params = withParam(params, "ar", recipe.ar);
  if (recipe.raw !== undefined) params = withRaw(params, recipe.raw);
  if (recipe.hd !== undefined) params = withHd(params, recipe.hd);
  let codes = recipe.profileCodes ? [...recipe.profileCodes] : [...item.profileCodes];
  for (const code of recipe.addProfileCodes ?? []) if (!codes.includes(code)) codes.push(code);
  if (recipe.removeProfileCodes?.length) codes = codes.filter((code) => !recipe.removeProfileCodes!.includes(code));
  const prompt = recipe.opening !== undefined ? withOpening(item.prompt, threadOpeningText, recipe.opening) : item.prompt;
  return { prompt, profileCodes: codes.slice(0, 10), params: params || undefined, srefs: recipe.srefs };
}

/** "stylize 750 · profiles e6pj8eo ejo6q4d · raw": the recipe in a few words, for the run's label. */
export function recipeLabel(recipe: MjRecipe) {
  const parts: string[] = [];
  if (recipe.profileCodes) parts.push(recipe.profileCodes.length ? `profiles ${recipe.profileCodes.join(" ")}` : "no profiles");
  if (recipe.addProfileCodes?.length) parts.push(`+ ${recipe.addProfileCodes.join(" ")}`);
  if (recipe.removeProfileCodes?.length) parts.push(`− ${recipe.removeProfileCodes.join(" ")}`);
  if (recipe.srefs) parts.push(recipe.srefs.length ? `sref ${recipe.srefs.map((ref) => (ref.startsWith("http") ? "image" : ref)).join(" ")}` : "no sref");
  if (recipe.params !== undefined) parts.push(`params ${recipe.params || "cleared"}`);
  if (recipe.stylize !== undefined) parts.push(recipe.stylize === null ? "no stylize" : `stylize ${recipe.stylize}`);
  if (recipe.chaos !== undefined) parts.push(recipe.chaos === null ? "no chaos" : `chaos ${recipe.chaos}`);
  if (recipe.weird !== undefined) parts.push(recipe.weird === null ? "no weird" : `weird ${recipe.weird}`);
  if (recipe.ar !== undefined) parts.push(recipe.ar === null ? "default aspect" : `ar ${recipe.ar}`);
  if (recipe.raw !== undefined) parts.push(recipe.raw ? "raw" : "standard");
  if (recipe.hd !== undefined) parts.push(recipe.hd ? "hd" : "no hd");
  if (recipe.opening !== undefined) parts.push(recipe.opening ? `opening "${recipe.opening.slice(0, 40)}"` : "no opening");
  return parts.join(" · ").slice(0, MJ_THREAD_LIMITS.runLabel) || "same settings";
}

// ── A run's settings, read from its prompts ──

export type RunSettings = {
  profileCodes: string[];
  srefs: string[];
  stylize: string | null;
  chaos: string | null;
  ar: string | null;
  raw: boolean;
  hd: boolean;
  opening: string;
  mixed: string[];
};

type RunItem = { prompt: string; profileCodes: string[]; params?: string; styleRefs?: Array<{ code?: string; url?: string }> };

/** What most prompts of a run carry, and which settings differ between them. */
export function runSettings(items: RunItem[]): RunSettings {
  const most = <T>(values: T[], key: (value: T) => string) => {
    const tally = new Map<string, { value: T; n: number }>();
    for (const value of values) {
      const k = key(value);
      const entry = tally.get(k);
      if (entry) entry.n += 1;
      else tally.set(k, { value, n: 1 });
    }
    let best: { value: T; n: number } | undefined;
    for (const entry of tally.values()) if (!best || entry.n > best.n) best = entry;
    return { value: best?.value, mixed: tally.size > 1 };
  };
  const mixed: string[] = [];
  const pick = <T>(label: string, values: T[], key: (value: T) => string) => {
    const result = most(values, key);
    if (result.mixed) mixed.push(label);
    return result.value;
  };
  const codes = pick("profiles", items.map((item) => item.profileCodes ?? []), (list) => list.join(" ")) ?? [];
  const srefs = pick("sref", items.map((item) => (item.styleRefs ?? []).map((ref) => ref.code || ref.url || "").filter(Boolean)), (list) => list.join(" ")) ?? [];
  const flag = (label: string, key: FlagKey) => pick(label, items.map((item) => paramOf(item.params, key)), (value) => String(value)) ?? null;
  return {
    profileCodes: codes,
    srefs,
    stylize: flag("stylize", "stylize"),
    chaos: flag("chaos", "chaos"),
    ar: flag("aspect", "ar"),
    raw: pick("raw", items.map((item) => isRaw(item.params)), String) ?? false,
    hd: pick("hd", items.map((item) => isHd(item.params)), String) ?? false,
    opening: threadOpening(items.map((item) => item.prompt)),
    mixed,
  };
}

/** "stylize 300 · chaos 25 · 16:9 · hd · e6pj8eo ejo6q4d". */
export function settingsLabel(settings: RunSettings) {
  const parts: string[] = [];
  if (settings.profileCodes.length) parts.push(settings.profileCodes.join(" "));
  if (settings.srefs.length) parts.push(`sref ${settings.srefs.map((ref) => (ref.startsWith("http") ? "image" : ref)).join(" ")}`);
  if (settings.stylize) parts.push(`stylize ${settings.stylize}`);
  if (settings.chaos) parts.push(`chaos ${settings.chaos}`);
  if (settings.ar) parts.push(settings.ar);
  if (settings.raw) parts.push("raw");
  if (settings.hd) parts.push("hd");
  return parts.join(" · ");
}

// ── The chat writer ──

export const MJ_CHAT_OPS = ["edit", "add", "skip", "restore", "move", "recipe", "rerun"] as const;
export type MjChatOp =
  | { op: "edit"; item: number; prompt?: string; title?: string; note?: string; profileCodes?: string[]; params?: string }
  | { op: "add"; after?: number; title?: string; prompt: string; note?: string; profileCodes?: string[]; params?: string }
  | { op: "skip" | "restore"; items: number[] }
  | { op: "move"; item: number; to: number }
  | { op: "recipe"; items?: number[]; recipe: MjRecipe }
  | { op: "rerun"; items?: number[]; fromRun?: number; recipe?: MjRecipe; prompts?: Array<{ item: number; prompt: string }>; note?: string };

export const MJ_CHAT_SYSTEM = `You are the art director's assistant on one Midjourney prompt thread in the laniameda gallery. He writes to you in the thread's chat; you change the thread's prompts for him. You never send anything to Midjourney: he sends every job himself, one click each.

Answer with ONE JSON object and nothing else:
{"reply": "<one to three short plain sentences to him: what you changed, or your question>", "ops": [<operations>]}

Prompts are numbered as in the thread (#1, #2 …). Each has a status: queued or in the bar (still to send), sent (history: never edit a sent prompt), skipped. Each belongs to a run (run 1, run 2 …); a rerun makes the next run.

Operations:
- {"op":"edit","item":3,"prompt":"<the whole new prose>","title":"<a few words>","note":"…","profileCodes":["code"],"params":"--ar 16:9 --stylize 300"}  (only prompts still to send; give only the fields that change; prompt is prose only, no URLs and no -- flags)
- {"op":"add","after":3,"title":"…","prompt":"<prose>","profileCodes":[…],"params":"…"}  (a new prompt; leave profileCodes and params out to copy them from the prompt it follows)
- {"op":"skip","items":[4,5]} and {"op":"restore","items":[4]}
- {"op":"move","item":7,"to":2}
- {"op":"recipe","items":[…],"recipe":{…}}  (changes prompts still to send in place; leave items out for all of them)
- {"op":"rerun","items":[…],"fromRun":1,"recipe":{…},"prompts":[{"item":3,"prompt":"<new prose>"}],"note":"…"}  (copies prompts, usually sent ones, into a NEW run with the new settings; the old run stays as it was. Leave items out for every prompt of fromRun (default: the latest run), skipped ones left out. Use it whenever he wants to redo, rerun or try again with other styles, profiles or settings.)

A recipe holds only what changes: {"profileCodes":["e6pj8eo"]} replaces the profile list, {"addProfileCodes":[…]} / {"removeProfileCodes":[…]} add or drop codes, {"srefs":["123456"]} replaces the --sref list, {"stylize":750}, {"chaos":25}, {"weird":0}, {"ar":"16:9"}, {"raw":true}, {"hd":true}, {"opening":"Painted storybook animation frame."} swaps the keyword opening every prompt starts with ("" removes it), {"params":"…"} replaces the whole params line. null clears a number or the aspect.

Profiles and moodboards are named by Michael ("CAS Main 1", "storybook board"): use the codes listed under PROFILES AND MOODBOARDS. Never invent a code; if a name is not listed, ask in the reply and send no ops. Never use the AndromedaCartoon profile (n9iqix8). Every job is Midjourney V8.2: never write --v 8.1, --v 7 or --niji.

Prompts follow the house rules: describe what the camera sees in plain visual words (style words, materials, light, the land, people by their look); never names of characters, places or coined terms, which Midjourney does not know. Keep each prompt's camera distance; add only details big enough to read at that distance. Change only what he asks; keep everything else word for word. Every prompt is its own picture: Midjourney never sees the other prompts, so never write "reverse", "looking back", "the same", "again" or "this frame"; describe what the camera sees.

When he asks a question, answer it in reply with "ops": []. When the ask is unclear, ask one short question with "ops": [].`;

export type ChatThreadItem = {
  n: number;
  status: string;
  run: number;
  title?: string;
  prompt: string;
  profileCodes: string[];
  params?: string;
  srefs: string[];
};
export type ChatHistoryEntry = { role: "michael" | "agent"; text: string; changes?: string[] };

export function buildChatMessages({ batch, worldName, items, runs, history, message, profiles, worldBrief, rules }: {
  batch: string;
  worldName?: string;
  items: ChatThreadItem[];
  runs: Array<{ run: number; label: string; count: number }>;
  history: ChatHistoryEntry[];
  message: string;
  profiles: Array<{ name: string; code: string; kind: string }>;
  worldBrief?: string;
  rules?: string;
}) {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
  const itemLines = items.slice(0, MJ_THREAD_LIMITS.writerItems).map((item) => {
    const flags = [
      item.profileCodes.length ? `--profile ${item.profileCodes.join(" ")}` : "",
      item.srefs.length ? `--sref ${item.srefs.join(" ")}` : "",
      tidy(item.params),
    ].filter(Boolean).join(" ");
    return `#${item.n} · run ${item.run} · ${item.status}${item.title ? ` · ${item.title}` : ""}\n${clip(tidy(item.prompt), MJ_THREAD_LIMITS.writerPrompt)}${flags ? `\n${flags}` : ""}`;
  });
  const profileLines = profiles.slice(0, 80).map((entry) => `${entry.name} (${entry.kind}): ${entry.code}`);
  const historyLines = history.slice(-MJ_THREAD_LIMITS.writerHistory).map((entry) =>
    `${entry.role === "michael" ? "MICHAEL" : "YOU"}: ${clip(entry.text, 1200)}${entry.changes?.length ? `\n  (changed: ${entry.changes.slice(0, 8).join("; ")})` : ""}`);
  const system = [
    rules?.trim() || MJ_CHAT_SYSTEM,
    worldBrief?.trim() ? `${worldBrief.trim()}\n\nEvery prompt stays inside this world.` : "",
  ].filter(Boolean).join("\n\n");
  const user = [
    `THREAD: ${batch}${worldName ? ` (world: ${worldName})` : ""}`,
    `RUNS:\n${runs.map((run) => `run ${run.run}: ${run.count} prompts · ${run.label}`).join("\n") || "run 1"}`,
    `PROMPTS:\n${itemLines.join("\n\n") || "(none yet)"}`,
    `PROFILES AND MOODBOARDS:\n${profileLines.join("\n") || "(none listed: use only codes already in the prompts)"}`,
    historyLines.length ? `CHAT SO FAR:\n${historyLines.join("\n")}` : "",
    `MICHAEL NOW: ${message.trim()}`,
  ].filter(Boolean).join("\n\n");
  return [{ role: "system" as const, content: system }, { role: "user" as const, content: user }];
}

const numList = (value: unknown) => (Array.isArray(value) ? value : value === undefined ? [] : [value])
  .map((entry) => Number(entry)).filter((n) => Number.isInteger(n) && n > 0);

const str = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const codesOf = (value: unknown) => (Array.isArray(value) ? value.map((code) => tidy(code)).filter(Boolean).slice(0, 10) : undefined);

/** The writer's answer as a reply and checked operations. Throws when there is no JSON object in it. */
export function parseChatAnswer(raw: string): { reply: string; ops: MjChatOp[]; dropped: string[] } {
  const text = String(raw ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    // A plain sentence is a reply with no changes.
    if (text) return { reply: text.slice(0, MJ_THREAD_LIMITS.reply), ops: [], dropped: [] };
    throw new Error("The writer returned nothing.");
  }
  let data: { reply?: unknown; ops?: unknown };
  try {
    data = JSON.parse(text.slice(start, end + 1)) as typeof data;
  } catch {
    throw new Error("The writer's answer was not readable JSON.");
  }
  const reply = str(data.reply, MJ_THREAD_LIMITS.reply) ?? "";
  const ops: MjChatOp[] = [];
  const dropped: string[] = [];
  for (const entry of Array.isArray(data.ops) ? data.ops.slice(0, MJ_THREAD_LIMITS.ops) : []) {
    const op = entry as Record<string, unknown>;
    try {
      switch (op?.op) {
        case "edit": {
          const item = numList(op.item)[0];
          if (!item) throw new Error("edit without an item");
          ops.push({ op: "edit", item, prompt: str(op.prompt, 6000), title: str(op.title, 120), note: str(op.note, 1000), profileCodes: codesOf(op.profileCodes), params: typeof op.params === "string" ? op.params.slice(0, 600) : undefined });
          break;
        }
        case "add": {
          const prompt = str(op.prompt, 6000);
          if (!prompt) throw new Error("add without a prompt");
          ops.push({ op: "add", after: numList(op.after)[0], prompt, title: str(op.title, 120), note: str(op.note, 1000), profileCodes: codesOf(op.profileCodes), params: typeof op.params === "string" ? op.params.slice(0, 600) : undefined });
          break;
        }
        case "skip":
        case "restore": {
          const items = numList(op.items ?? op.item);
          if (!items.length) throw new Error(`${op.op} without items`);
          ops.push({ op: op.op, items });
          break;
        }
        case "move": {
          const item = numList(op.item)[0];
          const to = numList(op.to)[0];
          if (!item || !to) throw new Error("move needs item and to");
          ops.push({ op: "move", item, to });
          break;
        }
        case "recipe": {
          const recipe = cleanRecipe((op.recipe ?? {}) as MjRecipe);
          if (recipeIsEmpty(recipe)) throw new Error("recipe with nothing to change");
          ops.push({ op: "recipe", items: op.items === undefined ? undefined : numList(op.items), recipe });
          break;
        }
        case "rerun": {
          const prompts = Array.isArray(op.prompts)
            ? (op.prompts as Array<Record<string, unknown>>).map((entry) => ({ item: numList(entry?.item)[0]!, prompt: str(entry?.prompt, 6000)! }))
              .filter((entry) => entry.item && entry.prompt)
            : undefined;
          ops.push({
            op: "rerun",
            items: op.items === undefined ? undefined : numList(op.items),
            fromRun: numList(op.fromRun)[0],
            recipe: op.recipe ? cleanRecipe(op.recipe as MjRecipe) : undefined,
            prompts,
            note: str(op.note, 1000),
          });
          break;
        }
        default:
          throw new Error(`unknown operation ${String(op?.op ?? "").slice(0, 20)}`);
      }
    } catch (error) {
      dropped.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { reply: reply || (ops.length ? "Done." : ""), ops, dropped };
}
