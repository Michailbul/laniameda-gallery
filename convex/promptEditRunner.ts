"use node";

import { ConvexError, v } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { resolveProviderKey } from "./providerVault";
import {
  QUICK_EDIT_LIMITS, buildQuickEditMessages, cleanModelText, restoreUrls, type QuickEditModel,
} from "../lib/mj-quick-edit";
import {
  DESCRIBE_LIMITS, aspectOf, buildDescribeMessages, describeParams, parseDescribeAnswer,
} from "../lib/mj-describe";
import {
  EXPAND_ATTACH, EXPAND_LIMITS, buildExpandMessages, cleanPrevious, composeExpanded, expandPreset, imageWeightOf, lookNoteOf, parseExpandAnswer, splitCommand,
  type ExpandAttach,
} from "../lib/mj-expand";
import { MJ_BANNED_PROFILE_WARNING, withoutBannedCodes } from "../lib/mj-queue";
import { LOCAL_WRITER_LIMITS, localAnswer } from "../lib/local-writer";
import { WRITER_PROVIDER_NAMES, WRITER_RULES_LIMIT, pickWriterModel, writerRoutes, type WriterProvider } from "../lib/writer-models";
import { enforceMjVersion, mjVersionWarning } from "../lib/mj-version";
import type { BriefTier } from "../lib/writer-brief";
import { CINEMATIC_SHOTS_SHELF, asksForShots, shotModeOf, type ShotSettings } from "../lib/cinematic-shots";

// Quick edit of a Midjourney prompt from the extension (select text in the
// Imagine bar, ⌥E, a few words). One short chat call on the chosen provider
// (fal or Pika, `provider`); with none chosen (an older extension), fal first
// (its OpenRouter route), Pika when fal is blocked or out of credit.
// Keys come from Settings (providerVault), else the deployment's.

const FAL_CHAT = "https://fal.run/openrouter/router/openai/v1/chat/completions";
const PIKA_CHAT = "https://api.dev.pika.art/v1/chat/completions";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user"; content: string | Part[] };

const plainError = (provider: string, status: number, body: string) => {
  const text = body.slice(0, 300);
  if (/top_up|locked|insufficient|balance|credit|payment/i.test(text) || status === 402) return `${provider} needs a top-up`;
  if (status === 401) return `${provider} key refused`;
  if (status === 429) return `${provider} is rate limited`;
  return `${provider} answered ${status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
};

async function chat(provider: WriterProvider, key: string, model: string, messages: Message[], maxTokens = 1500) {
  const response = await fetch(provider === "fal" ? FAL_CHAT : PIKA_CHAT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider === "fal" ? { authorization: `Key ${key}` } : { "x-api-key": key }),
    },
    // No temperature: newer models refuse it (Pika answered 400 "temperature is
    // deprecated for this model" on 20 Nov 2026); the others do fine on their default.
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    // Opus and Fable on a whole world bible take longer than Haiku.
    signal: AbortSignal.timeout(110_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(plainError(provider === "fal" ? "fal" : "Pika", response.status, body));
  const data = JSON.parse(body) as { id?: string; choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${provider === "fal" ? "fal" : "Pika"} returned nothing`);
  // The provider's own id for the call, so a write can be traced on fal or Pika.
  const requestId = (typeof data.id === "string" && data.id) || response.headers.get("x-fal-request-id") || response.headers.get("x-request-id") || undefined;
  return { text, requestId: requestId ? requestId.slice(0, 120) : undefined };
}

// The local writer (lib/local-writer.ts): stage "messages" returns what the
// writer would be sent, and stage "finish" takes the raw answer of a run on the
// user's own Mac in place of a provider call.
const localArg = v.optional(v.object({
  stage: v.union(v.literal("messages"), v.literal("finish")),
  raw: v.optional(v.string()),
  model: v.optional(v.string()),
  ms: v.optional(v.number()),
}));
const localMessages = v.object({ local: v.object({ messages: v.any(), maxTokens: v.number() }) });
// The writer's model (lib/writer-models.ts) and the art director's own system
// prompt for the tool (extension: MJ settings → Writer). Every answer carries
// the system prompt it was written with, so the extension can show it.
// An unknown model name falls back to Haiku (pickWriterModel).
const modelArg = v.optional(v.string());
// Where a cloud call runs: only fal, or only Pika. Left out, fal then Pika.
const providerArg = v.optional(v.union(v.literal("fal"), v.literal("pika")));
const rulesArg = v.optional(v.string());
const cleanRules = (rules?: string) => {
  const text = rules?.trim();
  if (!text) return undefined;
  if (text.length > WRITER_RULES_LIMIT) throw new ConvexError(`Your system prompt is too long: keep it under ${WRITER_RULES_LIMIT} characters.`);
  return text;
};
const systemOf = (messages: Message[]) => {
  const content = messages.find((message) => message.role === "system")?.content;
  return typeof content === "string" ? content : "";
};
type LocalArg = { stage: "messages" | "finish"; raw?: string; model?: string; ms?: number } | undefined;
type LocalMessages = { local: { messages: Message[]; maxTokens: number } };
const finishLocally = (local: LocalArg) => {
  if (local?.stage !== "finish") return null;
  if ((local.raw ?? "").length > LOCAL_WRITER_LIMITS.raw) throw new ConvexError("The local answer is too long.");
  try { return localAnswer(local); } catch (error) { throw new ConvexError(error instanceof Error ? error.message : "The local writer returned nothing."); }
};

// The world's own files for the writer (convex/writerBrief.ts): the rule
// file, learnings, cast, bible and stories of the world the work belongs to.
// A world that cannot be read costs the brief, never the prompt.
type WorldBrief = { world: { key: string; name: string } | null; auto: boolean; by?: "frame" | "codes"; tie: string[]; style?: string; read: string[]; chars: number; text: string };
const briefFields = {
  world: v.optional(v.string()),
  worldKey: v.optional(v.string()),
  worldAuto: v.optional(v.boolean()),
  worldBy: v.optional(v.string()),
  worldTie: v.optional(v.array(v.string())),
  worldStyle: v.optional(v.string()),
  read: v.optional(v.array(v.string())),
};
type BriefMeta = { world?: string; worldKey?: string; worldAuto?: boolean; worldBy?: string; worldTie?: string[]; worldStyle?: string; read?: string[] };
const briefMeta = (brief: WorldBrief | null): BriefMeta => (brief?.world
  ? { world: brief.world.name, worldKey: brief.world.key, worldAuto: brief.auto, worldBy: brief.by, worldStyle: brief.style, read: brief.read }
  : brief?.tie.length ? { worldTie: brief.tie } : {});
async function worldBriefOf(
  ctx: Pick<ActionCtx, "runQuery">,
  args: { ownerUserId: string; world?: string; fallbackWorld?: string; command?: string; frame?: string; tier: BriefTier },
): Promise<WorldBrief | null> {
  if (!args.world?.trim() || args.world.trim() === "none") return null;
  try { return await ctx.runQuery(internal.writerBrief.forWriter, args); } catch { return null; }
}

// The art director's saved shot layouts (convex/cinematicShots.ts). The Shots
// switch decides: off never; auto, the closest shots when the request asks for
// cinematic shots or a camera layout; random, layouts drawn from the chosen
// collection, on every Grow run (one per prompt) and on edits that ask for a
// layout. A shelf that cannot be read costs the library, never the prompt.
type Shots = { text: string; total: number; picked: number; random: boolean; from?: string };
const shotsArg = v.optional(v.object({ mode: v.optional(v.string()), from: v.optional(v.string()) }));
async function shotsOf(
  ctx: Pick<ActionCtx, "runQuery">,
  ownerUserId: string,
  settings: ShotSettings | undefined,
  use: { always?: boolean; count?: number },
  ...asks: Array<string | undefined>
): Promise<Shots | null> {
  const mode = shotModeOf(settings?.mode);
  if (mode === "off") return null;
  const random = mode === "random";
  if (!(random && use.always) && !asksForShots(...asks)) return null;
  try {
    const shots = await ctx.runQuery(internal.cinematicShots.forWriter, {
      ownerUserId, request: asks.filter(Boolean).join("\n").slice(0, 2000),
      from: settings?.from?.trim() || undefined,
      ...(random ? { mode: "random", count: use.count ?? 1, seed: Math.floor(Math.random() * 2 ** 31) } : {}),
    });
    return shots.text ? { ...shots, random } : null;
  } catch { return null; }
}
const withShots = (worldText: string | undefined, shots: Shots | null) => [worldText?.trim(), shots?.text].filter(Boolean).join("\n\n") || undefined;
const metaOf = (brief: WorldBrief | null, shots: Shots | null): BriefMeta => {
  const meta = briefMeta(brief);
  if (!shots) return meta;
  const label = `cinematic shots (${shots.picked}${shots.random ? " random" : ""}${shots.from && shots.from !== CINEMATIC_SHOTS_SHELF ? ` · ${shots.from}` : ""})`;
  return { ...meta, read: [...(meta.read ?? []), label] };
};

export const rewrite = ownerAction({
  args: {
    ownerUserId: v.string(),
    prompt: v.string(),
    selection: v.optional(v.string()),
    instruction: v.string(),
    system: v.optional(v.string()),
    rules: rulesArg,
    model: modelArg,
    provider: providerArg,
    world: v.optional(v.string()),
    fallbackWorld: v.optional(v.string()),
    shots: shotsArg,
    local: localArg,
  },
  returns: v.union(v.object({
    text: v.string(),
    model: v.string(),
    provider: v.string(),
    requestId: v.optional(v.string()),
    ms: v.number(),
    notes: v.array(v.string()),
    systemPrompt: v.optional(v.string()),
    ...briefFields,
  }), localMessages),
  handler: async (ctx, args): Promise<({ text: string; model: string; provider: string; requestId?: string; ms: number; notes: string[]; systemPrompt?: string } & BriefMeta) | LocalMessages> => {
    const prompt = args.prompt.trim();
    const instruction = args.instruction.trim();
    const selection = args.selection?.trim() || undefined;
    if (!prompt) throw new ConvexError("There is no prompt to edit.");
    if (!instruction) throw new ConvexError("Say what to change.");
    if (prompt.length > QUICK_EDIT_LIMITS.prompt) throw new ConvexError(`Prompts up to ${QUICK_EDIT_LIMITS.prompt} characters.`);
    if (instruction.length > QUICK_EDIT_LIMITS.instruction) throw new ConvexError("Keep the instruction short.");
    const system = args.system?.slice(0, QUICK_EDIT_LIMITS.system);

    // The prompt in the bar carries the codes that say which world it is.
    const brief = await worldBriefOf(ctx, {
      ownerUserId: args.ownerUserId, world: args.world, fallbackWorld: args.fallbackWorld, command: prompt, tier: "short",
    });
    const shots = await shotsOf(ctx, args.ownerUserId, args.shots, { count: 1 }, instruction);
    const rules = cleanRules(args.rules);
    const { messages, urls } = buildQuickEditMessages({ prompt, selection, instruction, system, rules, worldBrief: withShots(brief?.text, shots), worldKey: brief?.world?.key });
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 1500 } };
    const picked = pickWriterModel(args.model, false);
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, picked.model as QuickEditModel, messages, "Could not edit", undefined, args.provider);
    const { raw, ...meta } = answer;
    // Every job is V8.2: an edit that still pins --v 8.1 or 7 comes back as --v 8.2.
    const versioned = enforceMjVersion(restoreUrls(cleanModelText(raw), urls));
    // AndromedaCartoon (n9iqix8) never survives an edit either.
    const unbanned = withoutBannedCodes(versioned.text);
    const notes = [...meta.notes];
    if (versioned.replaced.length) notes.push(mjVersionWarning(versioned.replaced[0]!));
    if (unbanned.removed) notes.push(MJ_BANNED_PROFILE_WARNING);
    return { ...meta, notes, text: unbanned.removed ? unbanned.text : versioned.text, systemPrompt: systemOf(messages), ...metaOf(brief, shots) };
  },
});

/**
 * One chat call over the model's routes: only the chosen provider's when one
 * is given (it never switches to the other by itself: the extension offers
 * that), else fal first and Pika when fal is blocked.
 */
async function runRoutes(
  ctx: Parameters<typeof resolveProviderKey>[0], owner: string, model: QuickEditModel, messages: Message[], failure: string,
  maxTokens?: number, provider?: WriterProvider,
) {
  const keys = new Map<WriterProvider, string | undefined>();
  const blocked = new Set<WriterProvider>();
  const notes: string[] = [];
  const started = Date.now();
  const routes = writerRoutes(model, provider);
  for (const route of routes) {
    if (blocked.has(route.provider)) continue;
    if (!keys.has(route.provider)) keys.set(route.provider, await resolveProviderKey(ctx, owner, route.provider));
    const key = keys.get(route.provider);
    if (!key) {
      const missing = `no ${WRITER_PROVIDER_NAMES[route.provider]} key`;
      if (!notes.includes(missing)) notes.push(missing);
      continue;
    }
    try {
      const { text: raw, requestId } = await chat(route.provider, key, route.model, messages, maxTokens);
      return { raw, model: route.label, provider: route.provider, ms: Date.now() - started, notes, ...(requestId ? { requestId } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!notes.includes(message)) notes.push(message);
      // A provider that needs a top-up or refuses the key fails every model: skip its other routes.
      if (/top-up|key refused/.test(message)) blocked.add(route.provider);
    }
  }
  const where = provider ? ` on ${WRITER_PROVIDER_NAMES[provider]}` : "";
  throw new ConvexError(`${failure}${where}: ${notes.join(" · ") || (routes.length ? "no provider answered" : "this model does not run there")}.`);
}

const describeField = v.object({ key: v.string(), label: v.string(), text: v.string() });
type DescribeResult = {
  title?: string;
  fields: Array<{ key: string; label: string; text: string }>;
  prompt: string; words: string; params: string;
  model: string; provider: string; requestId?: string; ms: number; notes: string[]; systemPrompt?: string;
};

/**
 * A picture into a cinematographer's description and one Midjourney V8.2
 * prompt: the writer (Haiku sees the image) with Midjourney's Describe lines
 * when the extension caught them. Returns labelled lines (subject, shot, lens,
 * composition, light, palette, materials, setting, mood, medium) and the
 * prompt with its aspect. Nothing goes to Midjourney.
 */
export const describe = ownerAction({
  args: {
    ownerUserId: v.string(),
    image: v.string(),
    descriptions: v.optional(v.array(v.string())),
    aspect: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    system: v.optional(v.string()),
    rules: rulesArg,
    model: modelArg,
    provider: providerArg,
    note: v.optional(v.string()),
    local: localArg,
  },
  returns: v.union(v.object({
    title: v.optional(v.string()),
    fields: v.array(describeField),
    prompt: v.string(),
    words: v.string(),
    params: v.string(),
    model: v.string(),
    provider: v.string(),
    requestId: v.optional(v.string()),
    ms: v.number(),
    notes: v.array(v.string()),
    systemPrompt: v.optional(v.string()),
  }), localMessages),
  handler: async (ctx, args): Promise<DescribeResult | LocalMessages> => {
    const image = args.image.trim();
    if (!/^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(image)) throw new ConvexError("Send the picture as an https link or a data URL.");
    if (image.length > DESCRIBE_LIMITS.image) throw new ConvexError("The picture is too large: send it at 1024 px.");
    const descriptions = (args.descriptions ?? []).map((line) => line.trim().slice(0, DESCRIBE_LIMITS.description)).filter(Boolean).slice(0, DESCRIBE_LIMITS.descriptions);
    const messages = buildDescribeMessages({
      image, descriptions,
      system: args.system?.slice(0, DESCRIBE_LIMITS.system), rules: cleanRules(args.rules), note: args.note?.slice(0, DESCRIBE_LIMITS.note),
    }) as Message[];
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 2200 } };
    // The describer sends the picture: a text-only model (DeepSeek) hands it to Haiku.
    const picked = pickWriterModel(args.model, true);
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, picked.model, messages, "Could not describe", 2200, args.provider);
    if (picked.note && answer.provider !== "local") answer.notes = [picked.note, ...answer.notes];
    const parsed = parseDescribeAnswer(answer.raw);
    if (!parsed.prompt && !parsed.fields.length) throw new ConvexError(`${answer.model} answered without a description. Try again.`);
    const words = parsed.prompt ?? "";
    const params = describeParams(aspectOf(args.aspect, args.width, args.height));
    return {
      title: parsed.title, fields: parsed.fields, words, params, prompt: [words, params].filter(Boolean).join(" "),
      model: answer.model, provider: answer.provider, requestId: answer.requestId, ms: answer.ms, notes: answer.notes, systemPrompt: systemOf(messages),
    };
  },
});

const expandRef = v.object({ code: v.optional(v.string()), url: v.optional(v.string()), weight: v.optional(v.number()) });
type ExpandResult = {
  set?: string; logline?: string;
  items: Array<{ title: string; words: string; prompt: string; rest: string; profiles: string[]; srefs: Array<{ code?: string; url?: string; weight?: number }>; images: string[]; edits: string[] }>;
  source: { words: string; params: string; hadImages: number };
  model: string; provider: string; requestId?: string; ms: number; notes: string[]; systemPrompt?: string;
} & BriefMeta;

/**
 * Grow one Midjourney frame into more prompts (extension: ⌥X on an image).
 * The writer (Haiku) sees the picture and the words that made it, plus the
 * world's own files (rules, learnings, cast, bible) when a world is chosen or
 * the frame's codes name one. It writes words only: the
 * source command's codes and params are put back on every result here, so the
 * look that is working cannot drift. Nothing goes to Midjourney.
 */
export const expand = ownerAction({
  args: {
    ownerUserId: v.string(),
    image: v.string(),
    command: v.optional(v.string()),
    preset: v.optional(v.string()),
    idea: v.optional(v.string()),
    count: v.optional(v.number()),
    world: v.optional(v.string()),
    fallbackWorld: v.optional(v.string()),
    frame: v.optional(v.string()),
    system: v.optional(v.string()),
    rules: rulesArg,
    model: modelArg,
    provider: providerArg,
    keepImages: v.optional(v.boolean()),
    srefUrl: v.optional(v.string()),
    attach: v.optional(v.string()),
    attachUrl: v.optional(v.string()),
    previous: v.optional(v.array(v.string())),
    shots: shotsArg,
    aspect: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    local: localArg,
  },
  returns: v.union(v.object({
    set: v.optional(v.string()),
    logline: v.optional(v.string()),
    items: v.array(v.object({
      title: v.string(), words: v.string(), prompt: v.string(), rest: v.string(),
      profiles: v.array(v.string()), srefs: v.array(expandRef), images: v.array(v.string()), edits: v.array(v.string()),
    })),
    source: v.object({ words: v.string(), params: v.string(), hadImages: v.number() }),
    ...briefFields,
    model: v.string(),
    provider: v.string(),
    requestId: v.optional(v.string()),
    ms: v.number(),
    notes: v.array(v.string()),
    systemPrompt: v.optional(v.string()),
  }), localMessages),
  handler: async (ctx, args): Promise<ExpandResult | LocalMessages> => {
    const image = args.image.trim();
    if (!/^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(image)) throw new ConvexError("Send the picture as an https link or a data URL.");
    if (image.length > EXPAND_LIMITS.image) throw new ConvexError("The picture is too large: send it at 1024 px.");
    const command = (args.command ?? "").slice(0, EXPAND_LIMITS.command);
    const preset = expandPreset(args.preset);
    if (args.preset && !preset) throw new ConvexError("That move does not exist.");
    const idea = args.idea?.trim().slice(0, EXPAND_LIMITS.idea) || undefined;
    if (!preset && !idea) throw new ConvexError("Pick a move or say an idea.");
    const previous = cleanPrevious(args.previous);
    if (preset?.replay && !previous.length) throw new ConvexError("No previous prompts to replay. Make a few in Midjourney first.");
    const count = preset?.replay
      ? previous.length
      : Math.min(EXPAND_LIMITS.maxCount, Math.max(1, Math.round(args.count ?? preset?.count ?? 3)));
    if (args.srefUrl && !/^https:\/\/\S+$/.test(args.srefUrl)) throw new ConvexError("The style reference must be an https link.");
    const attach: ExpandAttach = (EXPAND_ATTACH as readonly string[]).includes(args.attach ?? "") ? args.attach as ExpandAttach : "none";
    if (attach !== "none" && !/^https:\/\/\S+$/.test(args.attachUrl ?? "")) throw new ConvexError("The picture to attach must be an https link.");

    // The world's own files, when a world is chosen or its codes name one.
    const brief = await worldBriefOf(ctx, {
      ownerUserId: args.ownerUserId, world: args.world, fallbackWorld: args.fallbackWorld, command, frame: args.frame, tier: "full",
    });

    const shots = await shotsOf(ctx, args.ownerUserId, args.shots, { always: true, count }, idea, preset?.label);
    const source = splitCommand(command);
    const messages = buildExpandMessages({
      image, sourceWords: source.words, lookNote: lookNoteOf(source), preset, idea, count,
      system: args.system?.slice(0, EXPAND_LIMITS.system), rules: cleanRules(args.rules), worldBrief: withShots(brief?.text, shots), worldKey: brief?.world?.key,
      attach, previous,
    }) as Message[];
    const maxTokens = 600 + count * 520;
    if (args.local?.stage === "messages") return { local: { messages, maxTokens } };
    // Grow sends the picture: a text-only model (DeepSeek) hands it to Haiku.
    const picked = pickWriterModel(args.model, true);
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, picked.model, messages, "Could not write the prompts", maxTokens, args.provider);
    if (picked.note && answer.provider !== "local") answer.notes = [picked.note, ...answer.notes];
    const parsed = parseExpandAnswer(answer.raw);
    if (!parsed.items.length) throw new ConvexError(`${answer.model} answered without a prompt. Try again.`);
    const options = {
      keepImages: Boolean(args.keepImages), srefUrl: args.srefUrl || undefined, attach, attachUrl: args.attachUrl || undefined,
      fallbackAspect: aspectOf(args.aspect, args.width, args.height), iw: imageWeightOf(command),
    };
    return {
      set: parsed.set, logline: parsed.logline,
      items: parsed.items.slice(0, EXPAND_LIMITS.maxCount).map((item) => composeExpanded(item.title, item.words, source, options)),
      source: { words: source.words, params: composeExpanded("", "", source, options).prompt, hadImages: source.images.length },
      ...metaOf(brief, shots),
      model: answer.model, provider: answer.provider, requestId: answer.requestId, ms: answer.ms, notes: answer.notes, systemPrompt: systemOf(messages),
    };
  },
});
