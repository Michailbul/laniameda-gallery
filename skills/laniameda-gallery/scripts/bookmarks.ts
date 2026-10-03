#!/usr/bin/env bun
// Saved posts (X bookmarks) from a shell, straight to Convex (Michael's
// machine only: needs the repo's .env.local). On other machines use the MCP
// tools save_bookmarks / list_bookmarks through gallery.mjs.
//
//   bun run bookmarks.ts '{"action":"save","items":[{"url":"https://x.com/<handle>/status/<id>"}]}'
//   bun run bookmarks.ts '{"action":"save","url":"https://x.com/…","userNote":"…","folderIds":["<id>"]}'
//   bun run bookmarks.ts '{"action":"list","search":"alpha matte","limit":20}'
//   bun run bookmarks.ts '{"action":"note","id":"bookmark:<id>","userNote":"…"}'
//   bun run bookmarks.ts @items.json          # arguments from a file

import { readFileSync } from "node:fs";
import { convexAuthHeaders } from "./convex-auth";
import { resolveConvexUrl, resolveOwnerUserId } from "./query";

type Input = Record<string, unknown> & { action?: string };

const POST_FIELDS = [
  "authorName",
  "authorHandle",
  "authorAvatarUrl",
  "text",
  "lang",
  "postedAt",
  "media",
  "quotedPost",
  "metrics",
];

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

const bareId = (value: unknown, prefix: RegExp) => String(value ?? "").replace(prefix, "");

const toTime = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

// Splits one item into the action's args: post fields go under `post`.
const toSaveArgs = (item: Record<string, unknown>) => {
  const post: Record<string, unknown> = {};
  for (const field of POST_FIELDS) {
    if (item[field] !== undefined) post[field] = field === "postedAt" ? toTime(item[field]) : item[field];
  }
  return {
    url: item.url,
    ...(Object.keys(post).length > 0 ? { post } : {}),
    ...(item.folderIds ? { folderIds: item.folderIds } : {}),
    ...(item.tagNames ? { tagNames: item.tagNames } : {}),
    ...(item.userNote ? { userNote: item.userNote } : {}),
    ...(item.agentDescription ? { agentDescription: item.agentDescription } : {}),
    ...(Array.isArray(item.assetIds)
      ? { assetIds: item.assetIds.map((id) => bareId(id, /^asset:/i)) }
      : {}),
  };
};

export async function runBookmarks(input: Input) {
  const ownerUserId = resolveOwnerUserId();
  const { action, ...rest } = input;

  if (action === "list") {
    const posts = (await call("query", "bookmarks:listBookmarkPosts", {
      ...rest,
      ...(rest.folderId ? { folderId: bareId(rest.folderId, /^(folder|collection):/i) } : {}),
      ownerUserId,
    })) as unknown[];
    return { count: posts.length, posts };
  }
  if (action === "save") {
    const items = (Array.isArray(rest.items) ? rest.items : [rest]) as Record<string, unknown>[];
    if (items.length === 0 || items.some((item) => typeof item.url !== "string")) {
      throw new Error("save needs items: [{ url }] (or a single url).");
    }
    const results: Record<string, unknown>[] = [];
    for (const [index, item] of items.entries()) {
      try {
        const saved = (await call("action", "bookmarkSaves:saveXPostFromAgent", {
          ownerUserId,
          ...toSaveArgs(item),
        })) as Record<string, unknown> & { linkedAssetIds: string[] };
        results.push({
          ...saved,
          bookmarkId: `bookmark:${saved.bookmarkId}`,
          assetId: `asset:${saved.assetId}`,
          linkedAssetIds: saved.linkedAssetIds.map((id) => `asset:${id}`),
        });
      } catch (error) {
        results.push({ url: item.url, error: error instanceof Error ? error.message : String(error) });
      }
      console.error(`saved ${index + 1}/${items.length}`);
    }
    const failed = results.filter((result) => result.error);
    return { saved: results.length - failed.length, failed: failed.length, results };
  }
  if (action === "note") {
    await call("mutation", "bookmarks:updateBookmarkNote", {
      ownerUserId,
      bookmarkId: bareId(rest.id, /^bookmark:/i),
      ...(typeof rest.userNote === "string" ? { userNote: rest.userNote } : {}),
    });
    return { ok: true };
  }
  throw new Error("action must be one of list, save, note.");
}

if (import.meta.main) {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: bun run bookmarks.ts '<json>' | @file.json");
    process.exit(1);
  }
  try {
    const input = JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw) as Input;
    console.log(JSON.stringify(await runBookmarks(input), null, 2));
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
