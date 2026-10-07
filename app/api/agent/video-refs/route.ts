import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  requireAgentAuth,
  AgentAuthError,
  type AgentTokenScope,
} from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { videoRefsPageInputSchema } from "@/lib/video-ref-contract";

// Video references for agents: list, get, save, update, delete. One route so
// the read and write sides of the type stay next to each other; the scope a
// token needs depends on the action.

const SCOPE_BY_ACTION: Record<string, AgentTokenScope> = {
  list: "gallery:read",
  list_page: "gallery:read",
  get: "gallery:read",
  save: "gallery:write",
  update: "gallery:write",
  delete: "gallery:delete",
};

const SORTS = new Set(["views", "recent", "saved"]);

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const stringArrayValue = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

// Dates arrive as epoch milliseconds or as anything Date can parse.
const timeValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const refId = (value: unknown) => {
  const text = stringValue(value);
  if (!text) return undefined;
  return text.replace(/^(video|videoRef):/i, "") as Id<"videoRefs">;
};

const itemFromInput = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const url = stringValue(data.url);
  const title = stringValue(data.title);
  if (!url || !title) return null;
  return {
    url,
    title,
    channelName: stringValue(data.channelName),
    channelHandle: stringValue(data.channelHandle),
    channelUrl: stringValue(data.channelUrl),
    subscribers: numberValue(data.subscribers),
    medianViews: numberValue(data.medianViews),
    views: numberValue(data.views),
    publishedAt: timeValue(data.publishedAt),
    durationSeconds: numberValue(data.durationSeconds),
    isChannelBest: booleanValue(data.isChannelBest),
    channelLastUploadAt: timeValue(data.channelLastUploadAt),
    checkedAt: timeValue(data.checkedAt),
    topic: stringValue(data.topic),
    styleFamily: stringValue(data.styleFamily),
    productionStyle: stringValue(data.productionStyle),
    language: stringValue(data.language),
    styleDescription: stringValue(data.styleDescription),
    format: stringValue(data.format),
    whyItWorks: stringValue(data.whyItWorks),
    hook: stringValue(data.hook),
    titlePattern: stringValue(data.titlePattern),
    thumbnailPattern: stringValue(data.thumbnailPattern),
    audience: stringValue(data.audience),
    bendIdea: stringValue(data.bendIdea),
    agentDescription: stringValue(data.agentDescription),
    userNote: stringValue(data.userNote),
    collections: stringArrayValue(data.collections),
    tagNames: stringArrayValue(data.tagNames),
    thumbnailUrl: stringValue(data.thumbnailUrl),
    frameUrls: stringArrayValue(data.frameUrls),
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
        { error: "action must be one of list, list_page, get, save, update, delete." },
        { status: 400 },
      );
    }
    const agent = await requireAgentAuth(request, scope);
    const client = getServerConvexClient(agent.ownerUserId);
    const ownerUserId = agent.ownerUserId;

    if (action === "list_page") {
      const { action: _action, ...input } = body;
      void _action;
      return NextResponse.json(await client.query(api.videoRefs.listVideoRefsPage, { ...videoRefsPageInputSchema.parse(input), ownerUserId }));
    }
    if (action === "list") {
      const sort = stringValue(body.sort);
      const filters = {
        ownerUserId,
        collection: stringValue(body.collection),
        topic: stringValue(body.topic),
        styleFamily: stringValue(body.styleFamily),
        productionStyle: stringValue(body.productionStyle),
        language: stringValue(body.language),
        tagNames: stringArrayValue(body.tagNames),
        channelHandle: stringValue(body.channelHandle),
        search: stringValue(body.search),
        onlyLiked: body.onlyLiked === true ? true : undefined,
        onlyChannelBest: body.onlyChannelBest === true ? true : undefined,
        minViews: numberValue(body.minViews),
        publishedAfter: timeValue(body.publishedAfter),
      };
      const videos = await client.query(api.videoRefs.listVideoRefs, { ...filters, sort: sort && SORTS.has(sort) ? (sort as "views" | "recent" | "saved") : undefined, limit: numberValue(body.limit) });
      return NextResponse.json({ count: videos.length, videos });
    }

    if (action === "get") {
      const id = refId(body.id);
      if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const video = await client.query(api.videoRefs.getVideoRef, { ownerUserId, id });
      return NextResponse.json({ video });
    }

    if (action === "save") {
      const rawItems = Array.isArray(body.items) ? body.items : [body];
      const items = rawItems.map(itemFromInput);
      if (items.length === 0 || items.some((item) => item === null)) {
        return NextResponse.json(
          { error: "Every item needs a url (YouTube link or id) and a title." },
          { status: 400 },
        );
      }
      const results = await client.action(api.videoRefs.saveVideoRefs, {
        ownerUserId,
        items: items as NonNullable<(typeof items)[number]>[],
        refreshMedia: body.refreshMedia === true ? true : undefined,
      });
      return NextResponse.json({ ok: true, results });
    }

    const id = refId(body.id);
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    if (action === "update") {
      await client.mutation(api.videoRefs.updateVideoRef, {
        ownerUserId,
        id,
        userNote: typeof body.userNote === "string" ? body.userNote : undefined,
        isLiked: booleanValue(body.isLiked),
        collections: stringArrayValue(body.collections),
      });
      return NextResponse.json({ ok: true });
    }

    await client.mutation(api.videoRefs.deleteVideoRef, { ownerUserId, id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
