"use node";

import { ConvexError, v } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { api, internal } from "./_generated/api";
import { resolveProviderKey } from "./providerVault";
import {
  QUICK_EDIT_LIMITS, QUICK_EDIT_ROUTES, buildQuickEditMessages, cleanModelText, restoreUrls, type QuickEditModel,
} from "../lib/mj-quick-edit";
import {
  DESCRIBE_LIMITS, aspectOf, buildDescribeMessages, describeParams, parseDescribeAnswer, type DescribeStyle,
} from "../lib/mj-describe";
import {
  EXPAND_LIMITS, buildExpandMessages, composeExpanded, expandPreset, imageWeightOf, lookNoteOf, parseExpandAnswer, splitCommand,
} from "../lib/mj-expand";
import { LOCAL_WRITER_LIMITS, localAnswer } from "../lib/local-writer";

// Quick edit of a Midjourney prompt from the extension (select text in the
// Imagine bar, ⌥E, a few words). One short chat call on a fast model: fal
// first (its OpenRouter route), Pika when fal is blocked or out of credit.
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

async function chat(provider: "fal" | "pika", key: string, model: string, messages: Message[], maxTokens = 1500) {
  const response = await fetch(provider === "fal" ? FAL_CHAT : PIKA_CHAT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider === "fal" ? { authorization: `Key ${key}` } : { "x-api-key": key }),
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.4 }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(plainError(provider === "fal" ? "fal" : "Pika", response.status, body));
  const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${provider === "fal" ? "fal" : "Pika"} returned nothing`);
  return text;
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
type LocalArg = { stage: "messages" | "finish"; raw?: string; model?: string; ms?: number } | undefined;
type LocalMessages = { local: { messages: Message[]; maxTokens: number } };
const finishLocally = (local: LocalArg) => {
  if (local?.stage !== "finish") return null;
  if ((local.raw ?? "").length > LOCAL_WRITER_LIMITS.raw) throw new ConvexError("The local answer is too long.");
  try { return localAnswer(local); } catch (error) { throw new ConvexError(error instanceof Error ? error.message : "The local writer returned nothing."); }
};

export const rewrite = ownerAction({
  args: {
    ownerUserId: v.string(),
    prompt: v.string(),
    selection: v.optional(v.string()),
    instruction: v.string(),
    system: v.optional(v.string()),
    model: v.union(v.literal("haiku"), v.literal("deepseek")),
    local: localArg,
  },
  returns: v.union(v.object({
    text: v.string(),
    model: v.string(),
    provider: v.string(),
    ms: v.number(),
    notes: v.array(v.string()),
  }), localMessages),
  handler: async (ctx, args): Promise<{ text: string; model: string; provider: string; ms: number; notes: string[] } | LocalMessages> => {
    const prompt = args.prompt.trim();
    const instruction = args.instruction.trim();
    const selection = args.selection?.trim() || undefined;
    if (!prompt) throw new ConvexError("There is no prompt to edit.");
    if (!instruction) throw new ConvexError("Say what to change.");
    if (prompt.length > QUICK_EDIT_LIMITS.prompt) throw new ConvexError(`Prompts up to ${QUICK_EDIT_LIMITS.prompt} characters.`);
    if (instruction.length > QUICK_EDIT_LIMITS.instruction) throw new ConvexError("Keep the instruction short.");
    const system = args.system?.slice(0, QUICK_EDIT_LIMITS.system);

    const { messages, urls } = buildQuickEditMessages({ prompt, selection, instruction, system });
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 1500 } };
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, args.model as QuickEditModel, messages, "Could not edit");
    const { raw, ...meta } = answer;
    return { ...meta, text: restoreUrls(cleanModelText(raw), urls) };
  },
});

/** One chat call over the model's routes: fal first, Pika when fal is blocked. */
async function runRoutes(ctx: Parameters<typeof resolveProviderKey>[0], owner: string, model: QuickEditModel, messages: Message[], failure: string, maxTokens?: number) {
  const keys = new Map<"fal" | "pika", string | undefined>();
  const blocked = new Set<"fal" | "pika">();
  const notes: string[] = [];
  const started = Date.now();
  for (const route of QUICK_EDIT_ROUTES[model]) {
    if (blocked.has(route.provider)) continue;
    if (!keys.has(route.provider)) keys.set(route.provider, await resolveProviderKey(ctx, owner, route.provider));
    const key = keys.get(route.provider);
    if (!key) {
      if (!notes.includes(`no ${route.provider} key`)) notes.push(`no ${route.provider} key`);
      continue;
    }
    try {
      const raw = await chat(route.provider, key, route.model, messages, maxTokens);
      return { raw, model: route.label, provider: route.provider, ms: Date.now() - started, notes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!notes.includes(message)) notes.push(message);
      // A provider that needs a top-up or refuses the key fails every model: skip its other routes.
      if (/top-up|key refused/.test(message)) blocked.add(route.provider);
    }
  }
  throw new ConvexError(`${failure}: ${notes.join(" · ") || "no provider answered"}.`);
}

const describeFields = {
  prompt: v.string(), words: v.string(), params: v.string(),
  rest: v.string(), profiles: v.array(v.string()), srefs: v.array(v.string()),
};
type Made = { prompt: string; words: string; params: string; rest: string; profiles: string[]; srefs: string[] };
type DescribeResult = {
  title?: string;
  keep?: Made;
  ours?: Made & { style: string };
  model: string; provider: string; ms: number; notes: string[];
};

/**
 * A picture into our Midjourney prompt: the quick-edit agent with the image
 * (Haiku sees it), Midjourney's Describe lines when the extension caught them,
 * the world's system prompt and, for "ours", a world style from the gallery.
 * Returns the prompt(s) with their parameter line. Nothing goes to Midjourney.
 */
export const describe = ownerAction({
  args: {
    ownerUserId: v.string(),
    image: v.string(),
    descriptions: v.optional(v.array(v.string())),
    aspect: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    mode: v.union(v.literal("keep"), v.literal("ours"), v.literal("both")),
    style: v.optional(v.string()),
    system: v.optional(v.string()),
    note: v.optional(v.string()),
    local: localArg,
  },
  returns: v.union(v.object({
    title: v.optional(v.string()),
    keep: v.optional(v.object(describeFields)),
    ours: v.optional(v.object({ ...describeFields, style: v.string() })),
    model: v.string(),
    provider: v.string(),
    ms: v.number(),
    notes: v.array(v.string()),
  }), localMessages),
  handler: async (ctx, args): Promise<DescribeResult | LocalMessages> => {
    const image = args.image.trim();
    if (!/^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(image)) throw new ConvexError("Send the picture as an https link or a data URL.");
    if (image.length > DESCRIBE_LIMITS.image) throw new ConvexError("The picture is too large: send it at 1024 px.");
    const descriptions = (args.descriptions ?? []).map((line) => line.trim().slice(0, DESCRIBE_LIMITS.description)).filter(Boolean).slice(0, DESCRIBE_LIMITS.descriptions);
    let style: DescribeStyle | undefined;
    if (args.mode !== "keep") {
      if (!args.style?.trim()) throw new ConvexError("Pick a style for \"in our style\".");
      const found: DescribeStyle | null = await ctx.runQuery(internal.styleRecipes.describeStyleOf, { ownerUserId: args.ownerUserId, style: args.style });
      if (!found) throw new ConvexError("That style is not in the gallery any more. Pick another.");
      style = found;
    }
    const messages = buildDescribeMessages({
      image, descriptions, style, mode: args.mode,
      system: args.system?.slice(0, DESCRIBE_LIMITS.system), note: args.note?.slice(0, DESCRIBE_LIMITS.note),
    }) as Message[];
    // Haiku reads images; DeepSeek does not, so the describer always runs on Haiku.
    if (args.local?.stage === "messages") return { local: { messages, maxTokens: 2000 } };
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, "haiku", messages, "Could not describe", 2000);
    const parsed = parseDescribeAnswer(answer.raw);
    const aspect = aspectOf(args.aspect, args.width, args.height);
    const finish = (words: string, mode: "keep" | "ours"): Made => {
      const line = describeParams(mode, aspect, style);
      return { words, ...line, prompt: [words, line.params].filter(Boolean).join(" ") };
    };
    const keep = args.mode !== "ours" && parsed.keep ? finish(parsed.keep, "keep") : undefined;
    const ours = args.mode !== "keep" && parsed.ours && style ? { ...finish(parsed.ours, "ours"), style: style.name } : undefined;
    if (!keep && !ours) throw new ConvexError(`${answer.model} answered without a prompt. Try again.`);
    return { title: parsed.title, keep, ours, model: answer.model, provider: answer.provider, ms: answer.ms, notes: answer.notes };
  },
});

const expandRef = v.object({ code: v.optional(v.string()), url: v.optional(v.string()), weight: v.optional(v.number()) });
type ExpandResult = {
  set?: string; logline?: string;
  items: Array<{ title: string; words: string; prompt: string; rest: string; profiles: string[]; srefs: Array<{ code?: string; url?: string; weight?: number }>; images: string[] }>;
  source: { words: string; params: string; hadImages: number };
  world?: string;
  model: string; provider: string; ms: number; notes: string[];
};

/**
 * Grow one Midjourney frame into more prompts (extension: ⌥X on an image).
 * The writer (Haiku) sees the picture and the words that made it, plus the
 * world's own rule file when a world is chosen. It writes words only: the
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
    system: v.optional(v.string()),
    keepImages: v.optional(v.boolean()),
    srefUrl: v.optional(v.string()),
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
      profiles: v.array(v.string()), srefs: v.array(expandRef), images: v.array(v.string()),
    })),
    source: v.object({ words: v.string(), params: v.string(), hadImages: v.number() }),
    world: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    ms: v.number(),
    notes: v.array(v.string()),
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
    const count = Math.min(EXPAND_LIMITS.maxCount, Math.max(1, Math.round(args.count ?? preset?.count ?? 3)));
    if (args.srefUrl && !/^https:\/\/\S+$/.test(args.srefUrl)) throw new ConvexError("The style reference must be an https link.");

    // The world's own rule file and learnings, when a world is chosen.
    let worldName: string | undefined;
    let worldDoc: string | undefined;
    let learnings: string | undefined;
    const worldKey = args.world?.trim();
    if (worldKey && worldKey !== "none") {
      const read = async (path: string): Promise<{ world: string; body: string } | null> => {
        try { return await ctx.runQuery(api.worlds.readWorldDoc, { ownerUserId: args.ownerUserId, world: worldKey, path }); } catch { return null; }
      };
      const [main, learned] = await Promise.all([read("WORLD.md"), read("LEARNINGS.md")]);
      worldName = main?.world ?? learned?.world;
      worldDoc = main?.body;
      learnings = learned?.body;
    }

    const source = splitCommand(command);
    const messages = buildExpandMessages({
      image, sourceWords: source.words, lookNote: lookNoteOf(source), preset, idea, count,
      system: args.system?.slice(0, EXPAND_LIMITS.system), worldName, worldDoc, learnings,
    }) as Message[];
    const maxTokens = 600 + count * 520;
    if (args.local?.stage === "messages") return { local: { messages, maxTokens } };
    const answer = finishLocally(args.local) ?? await runRoutes(ctx, args.ownerUserId, "haiku", messages, "Could not write the prompts", maxTokens);
    const parsed = parseExpandAnswer(answer.raw);
    if (!parsed.items.length) throw new ConvexError(`${answer.model} answered without a prompt. Try again.`);
    const options = {
      keepImages: Boolean(args.keepImages), srefUrl: args.srefUrl || undefined,
      fallbackAspect: aspectOf(args.aspect, args.width, args.height), iw: imageWeightOf(command),
    };
    return {
      set: parsed.set, logline: parsed.logline,
      items: parsed.items.slice(0, EXPAND_LIMITS.maxCount).map((item) => composeExpanded(item.title, item.words, source, options)),
      source: { words: source.words, params: composeExpanded("", "", source, options).prompt, hadImages: source.images.length },
      world: worldName,
      model: answer.model, provider: answer.provider, ms: answer.ms, notes: answer.notes,
    };
  },
});
