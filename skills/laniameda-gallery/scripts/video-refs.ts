#!/usr/bin/env bun
// Video references from a shell, straight to Convex (Michael's machine only:
// needs the repo's .env.local). On other machines use the MCP tools
// list_video_refs / save_video_refs through gallery.mjs.
//
//   bun run video-refs.ts '{"action":"list","collection":"youtube-cars-competitors","sort":"views","limit":20}'
//   bun run video-refs.ts '{"action":"get","id":"video:<id>"}'
//   bun run video-refs.ts '{"action":"save","items":[{"url":"https://youtu.be/…","title":"…"}]}'
//   bun run video-refs.ts @items.json          # arguments from a file
//   bun run video-refs.ts '{"action":"update","id":"video:<id>","isLiked":true}'
//   bun run video-refs.ts '{"action":"delete","id":"video:<id>"}'

import { readFileSync } from "node:fs";
import { convexAuthHeaders } from "./convex-auth";
import { resolveConvexUrl, resolveOwnerUserId } from "./query";

type Input = Record<string, unknown> & { action?: string };

const SAVE_BATCH = 6;

const call = async (kind: "query" | "mutation" | "action", path: string, args: Input) => {
  const response = await fetch(`${resolveConvexUrl()}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...convexAuthHeaders() },
    body: JSON.stringify({ path, args }),
  });
  const text = await response.text();
  let body: { value?: unknown; status?: string; errorMessage?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Convex ${kind} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || body.status === "error" || body.errorMessage) {
    throw new Error(`Convex ${kind} ${path}: ${body.errorMessage ?? response.status}`);
  }
  return body.value;
};

const refId = (value: unknown) => String(value ?? "").replace(/^(video|videoRef):/i, "");

const toTime = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

export async function runVideoRefs(input: Input) {
  const ownerUserId = resolveOwnerUserId();
  const { action, ...rest } = input;

  if (action === "list") {
    const videos = (await call("query", "videoRefs:listVideoRefs", {
      ...rest,
      publishedAfter: toTime(rest.publishedAfter),
      ownerUserId,
    })) as Record<string, unknown>[];
    return {
      count: videos.length,
      videos: videos.map((video) => ({ ...video, id: `video:${String(video._id)}` })),
    };
  }
  if (action === "get") {
    const video = await call("query", "videoRefs:getVideoRef", { id: refId(rest.id), ownerUserId });
    return { video };
  }
  if (action === "save") {
    const items = (Array.isArray(rest.items) ? rest.items : []) as Record<string, unknown>[];
    if (items.length === 0) throw new Error("save needs items: [{ url, title, … }].");
    const results: unknown[] = [];
    for (let start = 0; start < items.length; start += SAVE_BATCH) {
      const batch = items.slice(start, start + SAVE_BATCH).map((item) => ({
        ...item,
        publishedAt: toTime(item.publishedAt),
        channelLastUploadAt: toTime(item.channelLastUploadAt),
        checkedAt: toTime(item.checkedAt),
      }));
      const saved = (await call("action", "videoRefs:saveVideoRefs", {
        ownerUserId,
        items: batch,
        ...(rest.refreshMedia === true ? { refreshMedia: true } : {}),
      })) as unknown[];
      results.push(...saved);
      console.error(`saved ${Math.min(start + SAVE_BATCH, items.length)}/${items.length}`);
    }
    const failed = results.filter((result) => (result as { error?: string }).error);
    return { saved: results.length - failed.length, failed, results };
  }
  if (action === "update") {
    await call("mutation", "videoRefs:updateVideoRef", { ...rest, id: refId(rest.id), ownerUserId });
    return { ok: true };
  }
  if (action === "delete") {
    await call("mutation", "videoRefs:deleteVideoRef", { id: refId(rest.id), ownerUserId });
    return { ok: true };
  }
  throw new Error("action must be one of list, get, save, update, delete.");
}

if (import.meta.main) {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: bun run video-refs.ts '<json>' | @file.json");
    process.exit(1);
  }
  try {
    const input = JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw) as Input;
    console.log(JSON.stringify(await runVideoRefs(input), null, 2));
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
