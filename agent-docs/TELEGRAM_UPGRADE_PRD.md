# PRD: Telegram Integration Upgrade

**Status:** Ready for implementation
**Scope:** `agent-worker/`, `lib/telegram/`, `app/api/telegram/`
**Runtime:** Bun on Railway (worker) + Vercel (Next.js)
**Related repos:** This repo + [openclaw-main](../../_external/openclaw-main) as reference

---

## Overview

This document specifies three concrete upgrades to the Telegram integration in this repo. Each is independent and can be shipped separately.

| # | Upgrade | Value |
|---|---------|-------|
| 1 | Replace raw HTTP bot calls with **grammy** | Sequentialization, throttling, media group batching, typed context |
| 2 | **Entity-based link extraction** (replaces regex) | Captures "text link" entities that regex misses |
| 3 | **URL content fetching** before agent run | Agent receives page content, not just a bare URL string |

Inline vision blocks (small images sent directly to Claude) are already partially implemented in [`agent-worker/telegram.ts`](../agent-worker/telegram.ts) — no changes needed there.

---

## Upgrade 1 — Replace raw HTTP with grammy

### Problem

The current Telegram integration uses raw HTTP calls throughout:

- [`app/api/telegram/webhook/route.ts`](../app/api/telegram/webhook/route.ts) — manual webhook body parsing, manual secret verification
- [`agent-worker/telegram.ts`](../agent-worker/telegram.ts) — `sendTelegramRunReply()` at line 919 sends messages via raw `fetch()` calls to `https://api.telegram.org/bot${token}/sendMessage`

**What this costs you:**
- No per-chat message ordering (two concurrent messages to same chat → race condition)
- No automatic rate-limit throttling (Telegram has per-bot + per-chat limits)
- Multi-photo messages (media groups) each trigger a separate run instead of being batched into one
- Long text replies require manual chunking (currently done in `sendTelegramRunReply()` at lines 919–956)
- No inline button / callback query support without building it from scratch

### Solution

Add `grammy` as the bot framework **for the worker's outbound calls and the inbound webhook handler**. Keep the Next.js webhook route for the initial HTTP ingress (Vercel requires this), but feed the update into a grammy Bot instance for handling.

### Dependencies to add

```jsonc
// package.json — add to dependencies
"grammy": "^1.34.0",
"@grammyjs/transformer-throttler": "^1.3.2",
"@grammyjs/runner": "^2.0.2"
```

### Implementation steps

#### Step 1 — Create a grammy bot factory

Create a new file: [`agent-worker/telegram-bot.ts`](../agent-worker/telegram-bot.ts)

```typescript
import { Bot } from "grammy"
import { apiThrottler } from "@grammyjs/transformer-throttler"

let _bot: Bot | null = null

/**
 * Returns (and lazily creates) a singleton grammy Bot instance.
 * Used only for outbound API calls (sendMessage, editMessageText, etc.)
 * Inbound updates still come via the Next.js webhook, not polling.
 */
export function getTelegramBot(token: string): Bot {
  if (!_bot) {
    _bot = new Bot(token)
    // Auto-throttle to respect Telegram rate limits
    _bot.api.config.use(apiThrottler())
  }
  return _bot
}
```

#### Step 2 — Replace `sendTelegramRunReply()` to use grammy

In [`agent-worker/telegram.ts`](../agent-worker/telegram.ts), `sendTelegramRunReply()` starts at line **919**. It currently does:

```typescript
// Current: raw fetch
const url = `https://api.telegram.org/bot${token}/sendMessage`
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text: chunk, ... }),
})
```

Replace with grammy API calls:

```typescript
import { getTelegramBot } from "./telegram-bot.js"

export async function sendTelegramRunReply(
  token: string,
  routing: TelegramRunRouting,
  text: string,
): Promise<void> {
  const bot = getTelegramBot(token)
  const chunks = splitTelegramText(text)           // keep existing chunker
  for (const chunk of chunks) {
    await bot.api.sendMessage(routing.chatId, chunk, {
      message_thread_id: routing.threadId ? Number(routing.threadId) : undefined,
      parse_mode: "Markdown",
    })
  }
}
```

For streaming edits (currently in [`agent-worker/telegram-stream.ts`](../agent-worker/telegram-stream.ts)):

```typescript
// Edit existing message
await bot.api.editMessageText(chatId, messageId, newText, {
  parse_mode: "Markdown",
})

// Send initial placeholder
const msg = await bot.api.sendMessage(chatId, "⏳ Working…")
const messageId = msg.message_id
```

#### Step 3 — Sequentialize inbound updates (optional but recommended)

If you later move to polling or want per-chat ordering in the webhook route, add:

```typescript
import { sequentialize } from "@grammyjs/runner"

// Key function — routes same chatId through same queue
const getKey = (ctx: Context) =>
  ctx.chat?.id !== undefined ? String(ctx.chat.id) : undefined

bot.use(sequentialize(getKey))
```

#### Step 4 — Media group batching (optional, ship later)

Telegram sends multi-photo messages as separate updates with the same `media_group_id`. To batch them:

```typescript
import { hydrateMediaGroup } from "@grammyjs/media-group"  // npm install @grammyjs/media-group

bot.use(hydrateMediaGroup())

bot.on("message:media_group", async (ctx) => {
  const photos = ctx.mediaGroup  // All photos in the group
  // Build single envelope with all photos
})
```

Reference implementation: OpenClaw batches in [`src/telegram/bot-handlers.ts`](../../_external/openclaw-main/src/telegram/bot-handlers.ts).

### Files changed

| File | Change |
|------|--------|
| `package.json` | Add grammy + plugins |
| `agent-worker/telegram-bot.ts` | **New** — singleton Bot factory |
| `agent-worker/telegram.ts` | `sendTelegramRunReply()` line 919 — use grammy API |
| `agent-worker/telegram-stream.ts` | Replace raw fetch with grammy API |

### Acceptance criteria

- [ ] `sendMessage` calls go through grammy (no more raw `fetch` to telegram API)
- [ ] apiThrottler middleware is active (no 429 errors under load)
- [ ] Existing test suite passes
- [ ] `sendTelegramRunReply()` still correctly chunks text > 4096 chars

---

## Upgrade 2 — Entity-based link extraction

### Problem

In [`lib/telegram/inbound.ts`](../lib/telegram/inbound.ts) at line **88**, links are extracted with:

```typescript
const LINK_REGEX = /https?:\/\/[^\s<>"']+/gi
const parseLinks = (text?: string): string[] | undefined => {
  if (!text) return undefined
  const matches = text.match(LINK_REGEX)
  ...
}
```

This regex **misses Telegram "text link" entities** — hyperlinks where the visible text differs from the URL (e.g., "Click here" that links to `https://example.com`). These are common in forwarded articles, newsletters, and link previews.

Telegram sends these in the `entities` or `caption_entities` array as:

```json
{
  "type": "text_link",
  "offset": 6,
  "length": 10,
  "url": "https://example.com"
}
```

The regex only sees the message text, not the entity metadata — so these URLs are silently dropped.

### Solution

Extract links from **two sources** and merge them:
1. Regex match on bare `http://...` URLs in text (keep existing)
2. `text_link` entities from `msg.entities` / `msg.caption_entities`

Reference: OpenClaw's `expandTextLinks()` in [`src/telegram/bot/helpers.ts`](../../_external/openclaw-main/src/telegram/bot/helpers.ts).

### Implementation steps

#### Step 1 — Add entity types

In [`lib/telegram/inbound.ts`](../lib/telegram/inbound.ts), add a type for the raw Telegram update structure you're already parsing:

```typescript
// Add near the top of the file
type TelegramEntity = {
  type: string
  offset: number
  length: number
  url?: string  // present when type === "text_link"
}
```

#### Step 2 — Add `extractLinksFromEntities()`

Add this function in [`lib/telegram/inbound.ts`](../lib/telegram/inbound.ts) alongside the existing `parseLinks()`:

```typescript
/**
 * Extracts URLs from Telegram entity metadata.
 * Handles "text_link" entities where the visible text differs from the URL.
 * Example: "read the article" (type=text_link, url=https://example.com)
 */
function extractLinksFromEntities(entities?: TelegramEntity[]): string[] {
  if (!entities) return []
  return entities
    .filter((e): e is TelegramEntity & { url: string } =>
      e.type === "text_link" && typeof e.url === "string" && e.url.length > 0
    )
    .map(e => e.url)
}
```

#### Step 3 — Merge both sources in `normalizeTelegramUpdate()`

In [`lib/telegram/inbound.ts`](../lib/telegram/inbound.ts), the `normalizeTelegramUpdate()` function builds the envelope at line **159**. Find where `links` is set (currently uses `parseLinks(text)`) and replace:

```typescript
// Before (line ~159 area):
links: parseLinks(rawText),

// After — merge regex links + entity links, deduplicate:
links: (() => {
  const regexLinks = parseLinks(rawText) ?? []
  const entityLinks = extractLinksFromEntities(
    msg.entities ?? msg.caption_entities
  )
  const all = [...regexLinks, ...entityLinks]
  const unique = Array.from(new Set(all))
  return unique.length > 0 ? unique : undefined
})(),
```

#### Step 4 — Update dev simulator

In [`lib/dev-telegram-sim.ts`](../lib/dev-telegram-sim.ts), `parseLinksField()` at line **26** parses comma/newline-separated URLs entered in the dev form. The simulator doesn't need entity extraction (it has no entities), so no change needed there.

### Files changed

| File | Change |
|------|--------|
| `lib/telegram/inbound.ts` | Add `extractLinksFromEntities()`, merge with `parseLinks()` in `normalizeTelegramUpdate()` |

### Acceptance criteria

- [ ] Forwarded article with "text_link" entities — links appear in `envelope.links[]`
- [ ] Bare URL in text — still captured as before
- [ ] Both sources merged, deduplicated
- [ ] Empty envelope.links remains `undefined` (not empty array)
- [ ] Dev simulator unchanged

---

## Upgrade 3 — URL content fetching before agent run

### Problem

When a user sends a link (e.g., a reference image URL, a product page, an article), the agent in [`agent-worker/orchestrator.ts`](../agent-worker/orchestrator.ts) currently only sees the raw URL string in its prompt context. It cannot read the page.

The agent's `allowedTools` in [`agent-worker/agent-runtime.ts`](../agent-worker/agent-runtime.ts) line **69** are:
```
Read, Write, Edit, Bash, Glob, Grep, LS, Skill
```

There is no web-fetch tool. The agent could technically use `Bash` to `curl` a URL, but this is unreliable inside the Daytona sandbox and wasteful (uses a tool turn).

### Solution

**Fetch URL content server-side** in the orchestrator before building the agent's prompt. Inject the fetched content as additional context in the messages array passed to the agent. This requires zero agent turns and no new tools.

For image URLs (`.jpg`, `.png`, `.webp`, `.gif`), download the image and pass it as an inline vision block — same pattern already used for Telegram media in [`agent-worker/streaming-message-builder.ts`](../agent-worker/streaming-message-builder.ts) line **89**.

### Architecture

```
orchestrator.ts: executeRun()
  ↓
[NEW] fetchUrlContents(links[])
  → For each link:
      - HTML page → fetch + Readability → markdown string
      - Image URL → download → base64 vision block
      - PDF       → download → pass as file to sandbox (future)
  ↓
streaming-message-builder.ts: buildTelegramStreamingMessages()
  → Add fetched content as additional message blocks
  ↓
Agent receives page content in context, no tool turns needed
```

### Implementation steps

#### Step 1 — Create `agent-worker/url-fetch.ts`

```typescript
/**
 * Fetches URL content for injection into agent context.
 * - HTML pages → Readability → markdown text
 * - Image URLs → base64 data URI for vision
 */

import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
const MAX_CONTENT_CHARS = 12_000      // ~3k tokens
const MAX_FETCH_BYTES = 2 * 1024 * 1024  // 2MB cap
const FETCH_TIMEOUT_MS = 15_000

export type FetchedUrlContent =
  | { kind: "text"; url: string; title?: string; content: string }
  | { kind: "image"; url: string; mimeType: string; base64: string }
  | { kind: "error"; url: string; reason: string }

/**
 * Fetch content for a list of URLs.
 * Skips URLs that fail — never throws.
 */
export async function fetchUrlContents(
  urls: string[],
): Promise<FetchedUrlContent[]> {
  const results = await Promise.allSettled(urls.map(fetchSingleUrl))
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value
    return { kind: "error", url: urls[i], reason: String(r.reason) }
  })
}

async function fetchSingleUrl(url: string): Promise<FetchedUrlContent> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    // Detect image URLs by extension
    const pathname = new URL(url).pathname.toLowerCase()
    const isImageUrl = IMAGE_EXTENSIONS.some(ext => pathname.endsWith(ext))

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; prompt-storager/1.0; +https://laniameda.com)",
        Accept: isImageUrl
          ? "image/*"
          : "text/html,application/xhtml+xml,*/*",
      },
    })

    if (!res.ok) {
      return { kind: "error", url, reason: `HTTP ${res.status}` }
    }

    const contentType = res.headers.get("content-type") ?? ""

    // --- Image response ---
    if (contentType.startsWith("image/") || isImageUrl) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_FETCH_BYTES) {
        return { kind: "error", url, reason: "image too large" }
      }
      const mimeType = contentType.split(";")[0].trim() || "image/jpeg"
      const base64 = Buffer.from(buf).toString("base64")
      return { kind: "image", url, mimeType, base64 }
    }

    // --- HTML/text response ---
    const raw = await res.text()
    const dom = new JSDOM(raw, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    const title = article?.title ?? dom.window.document.title ?? undefined
    const content = article?.textContent ?? raw
    const trimmed =
      content.slice(0, MAX_CONTENT_CHARS) +
      (content.length > MAX_CONTENT_CHARS ? "\n\n[…truncated]" : "")

    return { kind: "text", url, title, content: trimmed }
  } finally {
    clearTimeout(timer)
  }
}
```

**New dependencies required:**

```jsonc
// package.json
"@mozilla/readability": "^0.6.0",
"jsdom": "^26.0.0"
```

```jsonc
// devDependencies
"@types/jsdom": "^21.1.7"
```

#### Step 2 — Call in `orchestrator.ts: executeRun()`

In [`agent-worker/orchestrator.ts`](../agent-worker/orchestrator.ts), the `executeRun()` function at line **756** orchestrates the full run. After media staging and before `runAgent()`, add the URL fetch step:

```typescript
// In executeRun(), after prepareTelegramMedia() and before runAgent()

import { fetchUrlContents, type FetchedUrlContent } from "./url-fetch.js"

// --- Fetch URL contents ---
let fetchedUrls: FetchedUrlContent[] = []
const links = telegramCtx?.envelope?.links ?? []
if (links.length > 0) {
  logger.info({ runId, linkCount: links.length }, "fetching url contents")
  fetchedUrls = await fetchUrlContents(links)
  // Log failures without blocking the run
  const errors = fetchedUrls.filter(r => r.kind === "error")
  if (errors.length > 0) {
    logger.warn({ runId, errors }, "some urls failed to fetch")
  }
}
```

Then pass `fetchedUrls` into `runAgent()` (add it to the call signature).

#### Step 3 — Thread through `runAgent()` and `buildTelegramStreamingMessages()`

In [`agent-worker/orchestrator.ts`](../agent-worker/orchestrator.ts), `runAgent()` at line **451** calls `buildTelegramStreamingMessages()`. Extend the signature to accept fetched URL content:

```typescript
// In runAgent() signature — add fetchedUrls param
async function runAgent(
  opts: RunAgentOpts & { fetchedUrls?: FetchedUrlContent[] }
): Promise<RunAgentResult>
```

In [`agent-worker/streaming-message-builder.ts`](../agent-worker/streaming-message-builder.ts), `buildTelegramStreamingMessages()` at line **89** builds the message array. Add a section for fetched URLs after the existing media blocks:

```typescript
import type { FetchedUrlContent } from "./url-fetch.js"

// Add to function signature:
// fetchedUrls?: FetchedUrlContent[]

// Add after staged media blocks (before the final return):
if (fetchedUrls && fetchedUrls.length > 0) {
  for (const fetched of fetchedUrls) {
    if (fetched.kind === "error") continue

    if (fetched.kind === "image") {
      // Inline vision block — same pattern as small Telegram images
      userContentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: fetched.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: fetched.base64,
        },
      })
      userContentBlocks.push({
        type: "text",
        text: `[Image fetched from URL: ${fetched.url}]`,
      })
    } else if (fetched.kind === "text") {
      userContentBlocks.push({
        type: "text",
        text: [
          `--- Content from: ${fetched.url} ---`,
          fetched.title ? `Title: ${fetched.title}` : null,
          fetched.content,
          `--- End of ${fetched.url} ---`,
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }
  }
}
```

#### Step 4 — Add config toggle

In [`agent-worker/config.ts`](../agent-worker/config.ts), add:

```typescript
// In WorkerConfig type:
urlFetchEnabled: boolean
urlFetchMaxPerRun: number

// In buildWorkerConfig():
urlFetchEnabled: parseBoolean(env.AGENT_URL_FETCH_ENABLED, true),
urlFetchMaxPerRun: parsePositiveInt(env.AGENT_URL_FETCH_MAX_PER_RUN, 3),
```

In [`agent-worker/orchestrator.ts`](../agent-worker/orchestrator.ts), guard the fetch with config:

```typescript
const links = (telegramCtx?.envelope?.links ?? [])
  .slice(0, workerConfig.urlFetchMaxPerRun)  // cap per run

if (workerConfig.urlFetchEnabled && links.length > 0) {
  fetchedUrls = await fetchUrlContents(links)
}
```

In `.env.example`, add:

```bash
# URL fetching in agent runs
AGENT_URL_FETCH_ENABLED=true        # Fetch URL contents before agent run
AGENT_URL_FETCH_MAX_PER_RUN=3       # Max URLs to fetch per run (cost/latency control)
```

### Files changed

| File | Change |
|------|--------|
| `package.json` | Add `@mozilla/readability`, `jsdom`, `@types/jsdom` |
| `agent-worker/url-fetch.ts` | **New** — `fetchUrlContents()` with HTML + image support |
| `agent-worker/config.ts` | Add `urlFetchEnabled`, `urlFetchMaxPerRun` |
| `agent-worker/orchestrator.ts` | Call `fetchUrlContents()` in `executeRun()`, thread through `runAgent()` |
| `agent-worker/streaming-message-builder.ts` | Accept `fetchedUrls`, inject as message blocks |
| `.env.example` | Document new env vars |

### Acceptance criteria

- [ ] User sends message with a bare URL → agent receives page text in context
- [ ] User sends message with a `text_link` entity URL → fetched and injected (requires Upgrade 2 first)
- [ ] User sends image URL (`.jpg` etc.) → agent receives it as vision block
- [ ] Fetch fails (timeout, 404, etc.) → run continues, warning logged, no crash
- [ ] `AGENT_URL_FETCH_ENABLED=false` → no fetch attempted
- [ ] `AGENT_URL_FETCH_MAX_PER_RUN=1` → only first URL fetched when multiple present
- [ ] Content truncated at `MAX_CONTENT_CHARS` (12k chars) to control token budget

---

## Implementation order

These three upgrades are **independent**. Recommended shipping order:

1. **Upgrade 2** (entity links) — smallest change, highest signal-to-noise ratio. 2 functions, 1 file.
2. **Upgrade 3** (URL fetching) — adds clear agent capability. New file + 3 file edits.
3. **Upgrade 1** (grammy) — largest surface area, requires new dependency. Ship last.

---

## Reference files

**This repo:**
- [`lib/telegram/inbound.ts`](../lib/telegram/inbound.ts) — envelope normalization
- [`agent-worker/telegram.ts`](../agent-worker/telegram.ts) — media download/staging, outbound sends
- [`agent-worker/telegram-stream.ts`](../agent-worker/telegram-stream.ts) — streaming message sender
- [`agent-worker/streaming-message-builder.ts`](../agent-worker/streaming-message-builder.ts) — message array construction
- [`agent-worker/agent-runtime.ts`](../agent-worker/agent-runtime.ts) — Claude Agent SDK execution
- [`agent-worker/orchestrator.ts`](../agent-worker/orchestrator.ts) — run lifecycle
- [`agent-worker/config.ts`](../agent-worker/config.ts) — worker config
- [`app/api/telegram/webhook/route.ts`](../app/api/telegram/webhook/route.ts) — webhook handler
- [`.env.example`](../.env.example) — env var documentation

**OpenClaw reference (do not modify):**
- [`src/telegram/bot.ts`](../../../_external/openclaw-main/src/telegram/bot.ts) — grammy bot setup
- [`src/telegram/bot-handlers.ts`](../../../_external/openclaw-main/src/telegram/bot-handlers.ts) — message handlers, sequentialize
- [`src/telegram/bot/helpers.ts`](../../../_external/openclaw-main/src/telegram/bot/helpers.ts) — `expandTextLinks()` entity extraction
- [`src/telegram/bot/delivery.ts`](../../../_external/openclaw-main/src/telegram/bot/delivery.ts) — media resolution
- [`src/agents/tools/web-fetch.ts` (if exists)](../../../_external/openclaw-main/src/agents/tools/) — web-fetch tool reference
