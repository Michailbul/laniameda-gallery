"use node";

import { ConvexError, v } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { resolveProviderKey } from "./providerVault";
import {
  QUICK_EDIT_LIMITS, QUICK_EDIT_ROUTES, buildQuickEditMessages, cleanModelText, restoreUrls, type QuickEditModel,
} from "../lib/mj-quick-edit";

// Quick edit of a Midjourney prompt from the extension (select text in the
// Imagine bar, ⌥E, a few words). One short chat call on a fast model: fal
// first (its OpenRouter route), Pika when fal is blocked or out of credit.
// Keys come from Settings (providerVault), else the deployment's.

const FAL_CHAT = "https://fal.run/openrouter/router/openai/v1/chat/completions";
const PIKA_CHAT = "https://api.dev.pika.art/v1/chat/completions";

type Message = { role: "system" | "user"; content: string };

const plainError = (provider: string, status: number, body: string) => {
  const text = body.slice(0, 300);
  if (/top_up|locked|insufficient|balance|credit|payment/i.test(text) || status === 402) return `${provider} needs a top-up`;
  if (status === 401) return `${provider} key refused`;
  if (status === 429) return `${provider} is rate limited`;
  return `${provider} answered ${status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
};

async function chat(provider: "fal" | "pika", key: string, model: string, messages: Message[]) {
  const response = await fetch(provider === "fal" ? FAL_CHAT : PIKA_CHAT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider === "fal" ? { authorization: `Key ${key}` } : { "x-api-key": key }),
    },
    body: JSON.stringify({ model, messages, max_tokens: 1500, temperature: 0.4 }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(plainError(provider === "fal" ? "fal" : "Pika", response.status, body));
  const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${provider === "fal" ? "fal" : "Pika"} returned nothing`);
  return text;
}

export const rewrite = ownerAction({
  args: {
    ownerUserId: v.string(),
    prompt: v.string(),
    selection: v.optional(v.string()),
    instruction: v.string(),
    system: v.optional(v.string()),
    model: v.union(v.literal("haiku"), v.literal("deepseek")),
  },
  returns: v.object({
    text: v.string(),
    model: v.string(),
    provider: v.string(),
    ms: v.number(),
    notes: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const prompt = args.prompt.trim();
    const instruction = args.instruction.trim();
    const selection = args.selection?.trim() || undefined;
    if (!prompt) throw new ConvexError("There is no prompt to edit.");
    if (!instruction) throw new ConvexError("Say what to change.");
    if (prompt.length > QUICK_EDIT_LIMITS.prompt) throw new ConvexError(`Prompts up to ${QUICK_EDIT_LIMITS.prompt} characters.`);
    if (instruction.length > QUICK_EDIT_LIMITS.instruction) throw new ConvexError("Keep the instruction short.");
    const system = args.system?.slice(0, QUICK_EDIT_LIMITS.system);

    const { messages, urls } = buildQuickEditMessages({ prompt, selection, instruction, system });
    const keys = new Map<"fal" | "pika", string | undefined>();
    const blocked = new Set<"fal" | "pika">();
    const notes: string[] = [];
    const started = Date.now();
    for (const route of QUICK_EDIT_ROUTES[args.model as QuickEditModel]) {
      if (blocked.has(route.provider)) continue;
      if (!keys.has(route.provider)) keys.set(route.provider, await resolveProviderKey(ctx, args.ownerUserId, route.provider));
      const key = keys.get(route.provider);
      if (!key) {
        if (!notes.includes(`no ${route.provider} key`)) notes.push(`no ${route.provider} key`);
        continue;
      }
      try {
        const raw = await chat(route.provider, key, route.model, messages);
        const text = restoreUrls(cleanModelText(raw), urls);
        return { text, model: route.label, provider: route.provider, ms: Date.now() - started, notes };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!notes.includes(message)) notes.push(message);
        // A provider that needs a top-up or refuses the key fails every model: skip its other routes.
        if (/top-up|key refused/.test(message)) blocked.add(route.provider);
      }
    }
    throw new ConvexError(`Could not edit: ${notes.join(" · ") || "no provider answered"}.`);
  },
});
