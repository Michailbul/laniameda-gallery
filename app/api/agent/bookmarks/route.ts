import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  requireAgentAuth,
  AgentAuthError,
  type AgentTokenScope,
} from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";

// Saved posts (X bookmarks) for agents: save a post from its link, list the
// saved posts as text, set the owner's note. One route so the read and write
// sides stay next to each other; the scope a token needs depends on the action.

const SCOPE_BY_ACTION: Record<string, AgentTokenScope> = {
  list: "gallery:read",
  save: "gallery:write",
  note: "gallery:write",
};

const MAX_ITEMS = 12;

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringArrayValue = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

const timeValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const typedId = (value: unknown, prefix: RegExp) => stringValue(value)?.replace(prefix, "");

const mediaValue = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const media = value
    .map((raw) => {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const url = stringValue(item?.url);
      const kind = stringValue(item?.kind);
      if (!item || !url || (kind !== "image" && kind !== "video" && kind !== "gif")) return null;
      return {
        kind: kind as "image" | "video" | "gif",
        url,
        width: numberValue(item.width),
        height: numberValue(item.height),
        alt: stringValue(item.alt),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return media.length > 0 ? media : undefined;
};

// Post fields the caller already has. The gallery reads the post itself, so
// these only fill gaps or stand in when the post cannot be read publicly.
const postValue = (data: Record<string, unknown>) => {
  const quoted =
    data.quotedPost && typeof data.quotedPost === "object"
      ? (data.quotedPost as Record<string, unknown>)
      : null;
  const metrics =
    data.metrics && typeof data.metrics === "object"
      ? (data.metrics as Record<string, unknown>)
      : null;
  const post = {
    authorName: stringValue(data.authorName),
    authorHandle: stringValue(data.authorHandle),
    authorAvatarUrl: stringValue(data.authorAvatarUrl),
    text: stringValue(data.text),
    lang: stringValue(data.lang),
    postedAt: timeValue(data.postedAt),
    media: mediaValue(data.media),
    quotedPost: quoted
      ? {
          url: stringValue(quoted.url),
          authorName: stringValue(quoted.authorName),
          authorHandle: stringValue(quoted.authorHandle),
          text: stringValue(quoted.text),
        }
      : undefined,
    metrics: metrics
      ? {
          replies: numberValue(metrics.replies),
          reposts: numberValue(metrics.reposts),
          likes: numberValue(metrics.likes),
          bookmarks: numberValue(metrics.bookmarks),
          views: numberValue(metrics.views),
        }
      : undefined,
  };
  return Object.values(post).some((value) => value !== undefined) ? post : undefined;
};

const itemFromInput = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const url = stringValue(data.url);
  if (!url) return null;
  return {
    url,
    post: postValue(data),
    folderIds: stringArrayValue(data.folderIds) as Id<"folders">[] | undefined,
    tagNames: stringArrayValue(data.tagNames),
    userNote: stringValue(data.userNote),
    agentDescription: stringValue(data.agentDescription),
    assetIds: stringArrayValue(data.assetIds)?.map(
      (id) => id.replace(/^asset:/i, "") as Id<"assets">,
    ),
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }
    const action = stringValue(body.action) ?? "";
    const scope = SCOPE_BY_ACTION[action];
    if (!scope) {
      return NextResponse.json(
        { error: "action must be one of list, save, note." },
        { status: 400 },
      );
    }
    const agent = await requireAgentAuth(request, scope);
    const client = getServerConvexClient(agent.ownerUserId);
    const ownerUserId = agent.ownerUserId;

    if (action === "list") {
      const posts = await client.query(api.bookmarks.listBookmarkPosts, {
        ownerUserId,
        search: stringValue(body.search),
        authorHandle: stringValue(body.authorHandle),
        folderId: typedId(body.folderId, /^(folder|collection):/i) as Id<"folders"> | undefined,
        limit: numberValue(body.limit),
      });
      return NextResponse.json({ count: posts.length, posts });
    }

    if (action === "save") {
      const rawItems = Array.isArray(body.items) ? body.items : [body];
      const items = rawItems.map(itemFromInput);
      if (items.length === 0 || items.length > MAX_ITEMS || items.some((item) => item === null)) {
        return NextResponse.json(
          { error: `Send 1 to ${MAX_ITEMS} items, each with the post's url.` },
          { status: 400 },
        );
      }
      // One post at a time: each save reads the post and may store a preview.
      const results = [];
      for (const item of items as NonNullable<(typeof items)[number]>[]) {
        try {
          const saved = await client.action(api.bookmarkSaves.saveXPostFromAgent, {
            ownerUserId,
            ...item,
          });
          results.push({
            url: saved.url,
            bookmarkId: `bookmark:${saved.bookmarkId}`,
            assetId: `asset:${saved.assetId}`,
            linkedAssetIds: saved.linkedAssetIds.map((id) => `asset:${id}`),
            created: saved.created,
            fetched: saved.fetched,
            authorHandle: saved.authorHandle,
            text: saved.text,
          });
        } catch (error) {
          results.push({
            url: item.url,
            error: clientErrorMessage(error, "Failed to save the post."),
          });
        }
      }
      const failed = results.filter((result) => "error" in result).length;
      return NextResponse.json({ ok: failed === 0, saved: results.length - failed, failed, results });
    }

    const bookmarkId = typedId(body.id, /^bookmark:/i) as Id<"bookmarks"> | undefined;
    if (!bookmarkId) return NextResponse.json({ error: "id is required." }, { status: 400 });
    await client.mutation(api.bookmarks.updateBookmarkNote, {
      ownerUserId,
      bookmarkId,
      userNote: typeof body.userNote === "string" ? body.userNote : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: clientErrorMessage(error, "Bookmark request failed.") },
      { status: 400 },
    );
  }
}
