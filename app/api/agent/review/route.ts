import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { originFromRequest } from "@/lib/server/mcp-oauth";
import { reviewInviteUrl } from "@/lib/server/review-auth";
import { GALLERY_ORIGIN } from "@/lib/gallery-routes";
import {
  REVIEW_SECTIONS, reviewCommentSchema, reviewDeleteFolderSchema, reviewFeedbackSchema, reviewFoldersSchema, reviewInviteSchema,
  reviewItemsSchema, reviewOpenSchema, reviewOrganizeSchema, reviewProjectSchema, reviewPromoteSchema, reviewReorderFoldersSchema,
  reviewRoundSchema,
} from "@/lib/review-contract";

// Director review for agents: everything the review page and its owner can
// do, as one action route behind the review_* MCP tools. Reads (open, items,
// feedback, targets) need gallery:read; changes and invite links
// gallery:write; deleting a draft round, an empty folder or a comment
// gallery:delete. Handles go out as asset:<id>
// and style:<id> with the frame's short code (CA-XXXXXX) beside them.

const actions = [
  "open", "items", "feedback", "targets",
  "project", "folder", "reorder_folders", "delete_folder", "invite",
  "promote", "move", "remove", "reorder", "replace",
  "draft", "publish", "set_current", "discard_draft",
  "comment", "resolve_comment", "delete_comment", "mark_seen",
] as const;
type Action = (typeof actions)[number];

const READS: Action[] = ["open", "items", "feedback", "targets"];
const DELETES: Action[] = ["discard_draft", "delete_comment", "delete_folder"];

const scopeFor = (action: Action, body: Record<string, unknown>): AgentTokenScope => {
  if (READS.includes(action)) return "gallery:read";
  if (action === "promote" && body.dryRun === true) return "gallery:read";
  if (DELETES.includes(action)) return "gallery:delete";
  return "gallery:write";
};

const PROMOTE_CHUNK = 100;

type Section = (typeof REVIEW_SECTIONS)[number];
type Reviewer = { email: string; name?: string; pictureUrl?: string; role: "director" | "viewer"; title?: string; addedAt: number; lastSeenAt?: number };
type Overview = {
  project: {
    id: string; slug: string; title: string; subtitle?: string; worldFolderId?: string; publicUrl?: string;
    reviewers: Reviewer[]; ownerEmails: string[]; currentVersion?: string; draftVersion?: string;
  };
  styles: Array<{ styleId: string; label?: string; hidden?: boolean; name?: string; line?: string; status?: string; recipes?: unknown[]; missing?: boolean }>;
  folders: Array<{
    id: string; section: Section; area?: string; name: string; slug: string; note?: string; scenes?: number[];
    order: number; archived: boolean; currentCount: number; draftCount?: number;
  }>;
  versions: Array<{
    id: string; number: number; label: string; title?: string; note?: string; status: "draft" | "published";
    publishedAt?: number; createdAt: number; itemCount: number; isCurrent: boolean; isDraft: boolean;
  }>;
};
type Folder = Overview["folders"][number];
type Style = Overview["styles"][number];
type ItemRow = {
  itemId: string; asset: string; code: string; folder?: string; folderId: string; style?: string; styleId?: string;
  order: number; note?: string; previousAssetIds?: string[];
};
type ItemList = { version: { id: string; label: string; status: string } | null; items: ItemRow[] };
type Suggestion = { assetId: string; folderId?: string; styleId?: string; inCurrent: boolean; inDraft: boolean };
type Target = {
  slug: string; title: string; worldFolderId?: string; hasDraft: boolean;
  folders: Array<{ id: string; section: Section; area?: string; name: string; slug: string }>;
  styles: Array<{ id: string; label: string; name: string }>;
  suggestions: Suggestion[];
};
type FeedEvent = {
  type: "verdict" | "comment"; asset: string; code: string; verdict?: "like" | "dislike"; commentId?: string; body?: string;
  by: string; role: string; at: number; resolved?: boolean; version?: string; folder?: string; styleId?: string;
};
type Feed = { feedbackSeenAt?: number; counts: { likes: number; dislikes: number; comments: number }; events: FeedEvent[] };

class ReviewInputError extends Error {}
const fail = (message: string): never => {
  throw new ReviewInputError(message);
};

const bare = (value: string) => value.trim().replace(/^[a-z]+:/i, "");
const asset = (id: string) => `asset:${bare(id)}`;
const styleHandle = (id: string) => `style:${id}`;
const isCode = (value: string) => /^CA-[A-Z0-9]{6}$/i.test(value.trim());
const slugOf = (value: string) =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const reviewUrl = (slug: string) => `${GALLERY_ORIGIN}/review/${slug}`;
const iso = (at?: number) => (at ? new Date(at).toISOString() : undefined);
// "v0.2", "0.2", 2 and "draft"/"current" all name a round.
const roundArg = (round?: string | number) => {
  if (round === undefined) return undefined;
  const text = String(round).trim();
  return /^0\.\d+$/.test(text) ? `v${text}` : text;
};
const unique = <T,>(values: T[]) => [...new Set(values)];
const chunks = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const listOf = (values: string[], max = 30) =>
  values.length ? `${values.slice(0, max).join(", ")}${values.length > max ? ` and ${values.length - max} more` : ""}` : "none yet";

const styleLabel = (style: Style) => style.label?.trim() || style.name || style.styleId;

const findFolder = (overview: Overview, ref: string, section?: Section): Folder => {
  const id = bare(ref);
  const byId = overview.folders.find((row) => row.id === id);
  if (byId) return byId;
  const key = slugOf(id);
  let matches = overview.folders.filter((row) => row.slug === key || slugOf(row.name) === key);
  if (section) matches = matches.filter((row) => row.section === section);
  if (matches.length > 1) matches = matches.filter((row) => !row.archived);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    return fail(`"${ref}" is a folder in ${listOf(unique(matches.map((row) => row.section)))}: add section.`);
  }
  return fail(`No folder "${ref}" in ${overview.project.slug}. Folders: ${listOf(overview.folders.filter((row) => !row.archived).map((row) => row.slug))}.`);
};

const findProjectStyle = (overview: Overview, ref: string): Style | undefined => {
  const id = bare(ref);
  const lower = ref.trim().toLowerCase();
  const key = slugOf(ref);
  return overview.styles.find((row) => row.styleId === id)
    ?? overview.styles.find((row) => row.label?.trim().toLowerCase() === lower || row.name?.toLowerCase() === lower)
    ?? overview.styles.find((row) => (row.label && slugOf(row.label) === key) || (row.name && slugOf(row.name) === key));
};

const findStyle = (overview: Overview, ref: string): Style =>
  findProjectStyle(overview, ref)
  ?? fail(`"${ref}" is not a style of this review. Its styles: ${listOf(overview.styles.map(styleLabel))}. Add one with review_setup {op: "project", styles}.`);

// Items of a round matching item ids, asset handles, bare asset ids or codes.
const matchItems = (rows: ItemRow[], refs: string[]) => {
  const found: ItemRow[][] = [];
  const missing: string[] = [];
  const shared: string[] = [];
  for (const ref of refs) {
    const id = bare(ref);
    const code = ref.trim().toUpperCase();
    const hits = rows.filter((row) => row.itemId === id || row.asset === `asset:${id}` || row.code === code);
    if (!hits.length) missing.push(ref);
    else if (unique(hits.map((row) => row.asset)).length > 1) shared.push(ref);
    else found.push(hits);
  }
  if (shared.length) fail(`${listOf(shared)} names more than one frame: use the item id or asset:<id> from review_items.`);
  return { found, missing };
};

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action, body));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);

    const overviewOf = async (slug: string) => (await client.query(api.review.overview, { ownerUserId, slug })) as Overview;
    const itemsOf = async (slug: string, version?: string, folderId?: string) =>
      (await client.query(api.review.listItems, {
        ownerUserId, slug, version, folderId: folderId as Id<"reviewFolders"> | undefined,
      })) as ItemList;
    const targetsFor = async (assetIds?: string[]) =>
      (await client.query(api.review.promoteTargets, { ownerUserId, assetIds: assetIds as Id<"assets">[] | undefined })) as Target[];

    // Frames named by code (CA-XXXXXX) resolve inside the project's rounds,
    // newest first; asset:<id> and bare ids pass through.
    const resolveFrames = async (slug: string, overview: Overview, refs: string[]) => {
      const codes = unique(refs.filter(isCode).map((ref) => ref.trim().toUpperCase()));
      const byCode = new Map<string, Set<string>>();
      const rounds = [undefined, ...[...overview.versions].reverse().map((row) => row.label)];
      for (const round of rounds) {
        if (codes.every((code) => byCode.has(code))) break;
        const list = await itemsOf(slug, round);
        for (const row of list.items) byCode.set(row.code, (byCode.get(row.code) ?? new Set()).add(bare(row.asset)));
      }
      const missing = codes.filter((code) => !byCode.has(code));
      if (missing.length) fail(`No frame ${listOf(missing)} in any round of ${slug}.`);
      const shared = codes.filter((code) => byCode.get(code)!.size > 1);
      if (shared.length) fail(`${listOf(shared)} names more than one frame: use asset:<id> (review_items lists both).`);
      return unique(refs.map((ref) => (isCode(ref) ? [...byCode.get(ref.trim().toUpperCase())!][0]! : bare(ref))));
    };

    const folderView = (row: Folder) => ({
      id: row.id, section: row.section, area: row.area, name: row.name, slug: row.slug, note: row.note, scenes: row.scenes,
      order: row.order, archived: row.archived || undefined, current: row.currentCount, draft: row.draftCount,
    });
    const styleView = (row: Style) => ({
      style: styleHandle(row.styleId), label: styleLabel(row), name: row.name, line: row.line, status: row.status,
      hidden: row.hidden || undefined, missing: row.missing || undefined, recipes: row.recipes,
    });
    const roundView = (row: Overview["versions"][number]) => ({
      id: row.id, label: row.label, number: row.number, status: row.status, title: row.title, note: row.note,
      frames: row.itemCount, current: row.isCurrent || undefined, draft: row.isDraft || undefined,
      publishedAt: iso(row.publishedAt), createdAt: iso(row.createdAt),
    });
    const projectSummary = (overview: Overview) => {
      const current = overview.versions.find((row) => row.isCurrent);
      const draft = overview.versions.find((row) => row.isDraft);
      return {
        project: overview.project.slug, title: overview.project.title, subtitle: overview.project.subtitle,
        current: current ? { round: current.label, frames: current.itemCount } : null,
        draft: draft ? { round: draft.label, frames: draft.itemCount } : null,
        folders: overview.folders.filter((row) => !row.archived).length,
        styles: overview.styles.length,
        reviewers: overview.project.reviewers.length,
        url: reviewUrl(overview.project.slug), publicUrl: overview.project.publicUrl,
      };
    };

    if (action === "open") {
      const input = reviewOpenSchema.parse(body);
      if (!input.project) {
        const projects = await targetsFor();
        const rows = [];
        for (const row of projects) rows.push(projectSummary(await overviewOf(row.slug)));
        return NextResponse.json({
          count: rows.length, projects: rows,
          next: rows.length ? "review_open {project} for one project's folders, styles and rounds." : "No review project yet: review_setup {op: \"project\"} creates one.",
        });
      }
      const overview = await overviewOf(input.project);
      const draft = overview.versions.find((row) => row.isDraft);
      return NextResponse.json({
        ...projectSummary(overview),
        world: overview.project.worldFolderId,
        reviewers: overview.project.reviewers.map((row) => ({
          email: row.email, name: row.name, role: row.role, title: row.title, addedAt: iso(row.addedAt), lastSeenAt: iso(row.lastSeenAt),
        })),
        ownerEmails: overview.project.ownerEmails,
        styles: overview.styles.map(styleView),
        folders: overview.folders.map(folderView),
        rounds: overview.versions.map(roundView),
        next: draft
          ? `Draft ${draft.label} holds ${draft.itemCount} frames. review_items {round: "draft"} lists them; review_promote adds frames; publish only on Michael's go.`
          : "No draft round. review_promote starts one from the current round; review_round {op: \"draft\"} starts an empty copy now.",
      });
    }

    if (action === "items") {
      const input = reviewItemsSchema.parse(body);
      const overview = await overviewOf(input.project);
      const folder = input.folder ? findFolder(overview, input.folder, input.section) : undefined;
      const style = input.style ? findStyle(overview, input.style) : undefined;
      const list = await itemsOf(input.project, roundArg(input.round), folder?.id);
      if (input.round !== undefined && !list.version) fail(`No round "${input.round}" in ${input.project}.`);
      const folders = new Map(overview.folders.map((row) => [row.id, row]));
      const sectionRank = (section?: Section) => (section ? REVIEW_SECTIONS.indexOf(section) : 9);
      const items = list.items
        .filter((row) => !input.section || folders.get(row.folderId)?.section === input.section)
        .filter((row) => !style || row.styleId === style.styleId)
        .map((row) => {
          const home = folders.get(row.folderId);
          const shownIn = row.styleId ? overview.styles.find((entry) => entry.styleId === row.styleId) : undefined;
          return {
            item: row.itemId, asset: row.asset, code: row.code,
            folder: home?.slug, folderName: home?.name, section: home?.section,
            style: shownIn ? styleLabel(shownIn) : row.style, styleId: row.styleId ? styleHandle(row.styleId) : undefined,
            order: row.order, note: row.note, previous: row.previousAssetIds?.map(asset),
            rank: [sectionRank(home?.section), home?.order ?? 0, row.order] as const,
          };
        })
        .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
        .map(({ rank: _rank, ...row }) => row);
      let detail: unknown;
      if (input.frame) {
        const [assetId] = await resolveFrames(input.project, overview, [input.frame]);
        const found = (await client.query(api.review.itemDetail, { slug: input.project, assetId: assetId as Id<"assets"> })) as
          | ({ assetId: string } & Record<string, unknown>)
          | null;
        if (!found) fail(`Frame ${input.frame} is not one of Michael's gallery assets.`);
        const { assetId: detailId, ...rest } = found!;
        detail = { asset: asset(detailId), ...rest };
      }
      return NextResponse.json({
        project: input.project,
        round: list.version ? { label: list.version.label, status: list.version.status, id: list.version.id } : null,
        count: items.length, items, detail,
        next: list.version
          ? "preview_assets with these asset ids shows the pictures; review_organize moves, removes, reorders or replaces draft items."
          : "No round yet: review_promote starts the draft.",
      });
    }

    if (action === "feedback") {
      const input = reviewFeedbackSchema.parse(body);
      const overview = await overviewOf(input.project);
      const styles = new Map(overview.styles.map((row) => [row.styleId, styleLabel(row)]));
      const reviewerOnly = input.who === "reviewers";
      const fromReviewer = (role: string) => role === "director" || role === "viewer";

      if (input.frame) {
        const [assetId] = await resolveFrames(input.project, overview, [input.frame]);
        const thread = await client.query(api.review.comments, { slug: input.project, assetId: assetId as Id<"assets"> });
        const live = await client.query(api.review.feedback, { slug: input.project });
        return NextResponse.json({
          project: input.project, asset: asset(assetId!), code: `CA-${assetId!.slice(-6).toUpperCase()}`,
          verdicts: (live?.verdicts ?? [])
            .filter((row) => row.assetId === assetId && (!reviewerOnly || fromReviewer(row.role)))
            .map((row) => ({ verdict: row.verdict, by: row.email, role: row.role, at: row.updatedAt, when: iso(row.updatedAt) })),
          comments: thread
            .filter((row) => !reviewerOnly || fromReviewer(row.authorRole))
            .map((row) => ({
              commentId: row.id, body: row.body, by: row.authorEmail ?? row.authorName, name: row.authorName, role: row.authorRole,
              round: row.versionLabel, resolved: Boolean(row.resolvedAt), at: row.createdAt, when: iso(row.createdAt),
            })),
        });
      }

      let since = input.since;
      let seenAt: number | undefined;
      if (since === undefined && input.onlyNew) {
        seenAt = ((await client.query(api.review.feedbackFeed, { ownerUserId, slug: input.project, limit: 1 })) as Feed).feedbackSeenAt;
        since = seenAt ?? 0;
      }
      const feed = (await client.query(api.review.feedbackFeed, {
        ownerUserId, slug: input.project, since, limit: input.limit,
      })) as Feed;
      const events = feed.events
        .filter((row) => !reviewerOnly || fromReviewer(row.role))
        .map((row) => ({
          type: row.type, code: row.code, asset: row.asset, folder: row.folder,
          style: row.styleId ? styles.get(row.styleId) ?? styleHandle(row.styleId) : undefined,
          verdict: row.verdict, body: row.body, commentId: row.commentId, resolved: row.type === "comment" ? row.resolved : undefined,
          by: row.by, role: row.role, round: row.version, at: row.at, when: iso(row.at),
        }));
      const frames = new Map<string, {
        code: string; asset: string; folder?: string; style?: string; likes: string[]; dislikes: string[];
        comments: number; open: number; lastAt: number;
      }>();
      for (const event of events) {
        const row = frames.get(event.asset) ?? {
          code: event.code, asset: event.asset, folder: event.folder, style: event.style, likes: [], dislikes: [], comments: 0, open: 0, lastAt: 0,
        };
        if (event.verdict === "like") row.likes.push(event.by);
        if (event.verdict === "dislike") row.dislikes.push(event.by);
        if (event.type === "comment") {
          row.comments += 1;
          if (!event.resolved) row.open += 1;
        }
        row.lastAt = Math.max(row.lastAt, event.at);
        frames.set(event.asset, row);
      }
      const latest = events.reduce((max, row) => Math.max(max, row.at), 0);
      return NextResponse.json({
        project: input.project,
        feedbackSeenAt: iso(feed.feedbackSeenAt ?? seenAt),
        since: since ? iso(since) : undefined,
        cursor: latest ? latest + 1 : since,
        counts: {
          likes: events.filter((row) => row.verdict === "like").length,
          dislikes: events.filter((row) => row.verdict === "dislike").length,
          comments: events.filter((row) => row.type === "comment").length,
          openComments: events.filter((row) => row.type === "comment" && !row.resolved).length,
        },
        frames: [...frames.values()].sort((a, b) => b.lastAt - a.lastAt).map(({ lastAt: _lastAt, ...row }) => row),
        events,
        next: events.length
          ? "Act on what the director said, reply with review_comment {op: \"add\"} saying what was done, and resolve the comment once handled. Pass cursor as since next time to read only what is new."
          : "Nothing new.",
      });
    }

    if (action === "targets") {
      const input = z.object({ frames: z.array(z.string().trim().min(1)).max(500).optional() }).parse(body);
      const assetIds = input.frames ? unique(input.frames.map(bare)) : undefined;
      const projects = await targetsFor(assetIds);
      return NextResponse.json({
        projects: projects.map((project) => {
          const folders = new Map(project.folders.map((row) => [row.id, row]));
          const styles = new Map(project.styles.map((row) => [row.id, row]));
          return {
            project: project.slug, title: project.title, hasDraft: project.hasDraft,
            folders: project.folders.map((row) => ({ id: row.id, section: row.section, area: row.area, name: row.name, slug: row.slug })),
            styles: project.styles.map((row) => ({ style: styleHandle(row.id), label: row.label, name: row.name })),
            suggestions: project.suggestions.map((row) => ({
              asset: asset(row.assetId),
              folder: row.folderId ? folders.get(row.folderId)?.slug : undefined,
              style: row.styleId ? styles.get(row.styleId)?.label : undefined,
              inCurrent: row.inCurrent, inDraft: row.inDraft,
            })),
          };
        }),
      });
    }

    if (action === "project") {
      const input = reviewProjectSchema.parse(body);
      const slug = slugOf(input.project) || fail("Give the project a slug of letters and digits.");
      let existing: Overview | null = null;
      try {
        existing = await overviewOf(slug);
      } catch (error) {
        if (!clientErrorMessage(error, "").startsWith("No review project")) throw error;
      }
      let worldFolderId = existing?.project.worldFolderId;
      let worldKey: string | undefined = worldFolderId;
      if (input.world) {
        const world = await client.query(api.worldStyles.listStyles, { ownerUserId, world: input.world, universe: false, coverLimit: 0 });
        worldFolderId = world.world.id;
        worldKey = world.world.key;
      }
      let styles: Array<{ styleId: Id<"worldStyles">; label?: string; hidden?: boolean }> | undefined;
      if (input.styles) {
        styles = [];
        for (const entry of input.styles) {
          const known = existing ? findProjectStyle(existing, entry.style) : undefined;
          let styleId = known?.styleId;
          if (!styleId) {
            const ref = entry.style.trim().replace(/^style:/i, "");
            const style = await client.query(api.worldStyles.getStyle, { ownerUserId, style: ref, world: worldKey }).catch(() => null);
            if (!style) {
              fail(`No style "${entry.style}"${worldKey ? " in this world" : ""}. list_styles {world} lists them${worldKey ? "" : "; or give world"}.`);
            }
            styleId = style!.id;
          }
          if (styles.some((row) => row.styleId === styleId)) continue;
          const label = entry.label !== undefined ? entry.label.trim() || undefined : known?.label;
          const hidden = entry.hidden ?? known?.hidden;
          styles.push({ styleId: styleId as Id<"worldStyles">, ...(label ? { label } : {}), ...(hidden ? { hidden } : {}) });
        }
      }
      let reviewers: Array<{ email: string; name?: string; role?: "director" | "viewer"; title?: string }> | undefined;
      if (input.reviewers || input.addReviewers || input.removeReviewers) {
        const base = input.reviewers
          ?? (existing?.project.reviewers ?? []).map((row) => ({ email: row.email, name: row.name, role: row.role, title: row.title }));
        const byEmail = new Map(base.map((row) => [row.email.trim().toLowerCase(), row]));
        for (const row of input.addReviewers ?? []) {
          const email = row.email.trim().toLowerCase();
          const before = byEmail.get(email);
          byEmail.set(email, { email, name: row.name ?? before?.name, role: row.role ?? before?.role, title: row.title ?? before?.title });
        }
        for (const email of input.removeReviewers ?? []) byEmail.delete(email.trim().toLowerCase());
        reviewers = [...byEmail.values()];
      }
      const result = await client.mutation(api.review.upsertProject, {
        ownerUserId, slug,
        title: input.title, subtitle: input.subtitle, publicUrl: input.publicUrl,
        worldFolderId: input.world ? (worldFolderId as Id<"folders">) : undefined,
        reviewers, ownerEmails: input.ownerEmails, styles,
      });
      const overview = await overviewOf(slug);
      return NextResponse.json({
        ok: true, created: result.created, ...projectSummary(overview),
        reviewers: overview.project.reviewers.map((row) => ({ email: row.email, name: row.name, role: row.role, title: row.title })),
        ownerEmails: overview.project.ownerEmails,
        styles: overview.styles.map(styleView).map(({ recipes: _recipes, ...row }) => row),
      });
    }

    if (action === "folder") {
      const input = reviewFoldersSchema.parse(body);
      const overview = await overviewOf(input.project);
      const results = [];
      for (const entry of input.folders) {
        const existing = entry.folder ? findFolder(overview, entry.folder, entry.section) : undefined;
        if (!existing && (!entry.section || !entry.name)) fail("A new folder needs a section and a name (or give folder to change one).");
        const result = await client.mutation(api.review.upsertFolder, {
          ownerUserId, slug: input.project,
          folderId: existing?.id as Id<"reviewFolders"> | undefined,
          // A create names its slug, so repeating it updates that folder.
          folderSlug: existing ? undefined : entry.slug || entry.name,
          section: entry.section, area: entry.area, name: entry.name, note: entry.note,
          scenes: entry.scenes, order: entry.order, archived: entry.archived,
        });
        results.push({ id: result.folderId, created: result.created, name: entry.name ?? existing?.name });
      }
      const after = await overviewOf(input.project);
      const byId = new Map(after.folders.map((row) => [row.id, row]));
      return NextResponse.json({
        ok: true,
        results: results.map((row) => {
          const folder = byId.get(row.id);
          return { ...row, slug: folder?.slug, section: folder?.section, archived: folder?.archived || undefined };
        }),
        folders: after.folders.map(folderView),
      });
    }

    if (action === "reorder_folders") {
      const input = reviewReorderFoldersSchema.parse(body);
      const overview = await overviewOf(input.project);
      const ids = unique(input.order.map((ref) => findFolder(overview, ref, input.section).id));
      await client.mutation(api.review.reorderFolders, { ownerUserId, slug: input.project, folderIds: ids as Id<"reviewFolders">[] });
      const after = await overviewOf(input.project);
      return NextResponse.json({ ok: true, folders: after.folders.map(folderView) });
    }

    if (action === "delete_folder") {
      const input = reviewDeleteFolderSchema.parse(body);
      const overview = await overviewOf(input.project);
      const folder = findFolder(overview, input.folder, input.section);
      await client.mutation(api.review.deleteFolder, { ownerUserId, slug: input.project, folderId: folder.id as Id<"reviewFolders"> });
      return NextResponse.json({ ok: true, project: input.project, deleted: { id: folder.id, slug: folder.slug, section: folder.section, name: folder.name } });
    }

    if (action === "invite") {
      const input = reviewInviteSchema.parse(body);
      const overview = await overviewOf(input.project);
      const email = input.email.trim().toLowerCase();
      const reviewer = overview.project.reviewers.find((row) => row.email === email);
      if (!reviewer) {
        fail(`${email} is not a reviewer of ${input.project}. Add them first with review_setup {op: "project", addReviewers}. Reviewers: ${listOf(overview.project.reviewers.map((row) => row.email))}.`);
      }
      const base = overview.project.publicUrl || `${originFromRequest(request)}/review/${overview.project.slug}`;
      const url = await reviewInviteUrl(base, overview.project.slug, email, reviewer!.name);
      return NextResponse.json({
        project: input.project, email, url, expiresInDays: 30,
        next: "A private sign-in link for a reviewer without a Google account. Give it to Michael; he sends it himself. Never email or post it.",
      });
    }

    if (action === "promote") {
      const input = reviewPromoteSchema.parse(body);
      const overview = await overviewOf(input.project);
      const folder = input.folder ? findFolder(overview, input.folder, input.section) : undefined;
      const style = input.style ? findStyle(overview, input.style) : undefined;
      const assetIds = unique(input.frames.map(bare));
      const folders = new Map(overview.folders.map((row) => [row.id, row]));
      const labels = new Map(overview.styles.map((row) => [row.styleId, styleLabel(row)]));
      let suggestions: Suggestion[] = [];
      if (input.dryRun || !folder) {
        const target = (await targetsFor(assetIds)).find((row) => row.slug === overview.project.slug);
        suggestions = target?.suggestions ?? [];
        const missing = assetIds.filter((id) => !suggestions.some((row) => row.assetId === id));
        if (missing.length) fail(`Not Michael's gallery assets: ${listOf(missing.map(asset))}.`);
      }
      if (input.dryRun) {
        return NextResponse.json({
          dryRun: true, project: input.project, draft: overview.project.draftVersion ?? null,
          into: folder?.slug, style: style ? styleLabel(style) : undefined,
          frames: suggestions.map((row) => ({
            asset: asset(row.assetId), code: `CA-${row.assetId.slice(-6).toUpperCase()}`,
            suggestedFolder: row.folderId ? folders.get(row.folderId)?.slug : undefined,
            suggestedStyle: row.styleId ? labels.get(row.styleId) : undefined,
            inCurrent: row.inCurrent, inDraft: row.inDraft,
          })),
          next: "Nothing was changed. Call review_promote again without dryRun.",
        });
      }
      const groups = new Map<string, string[]>();
      const unplaced: string[] = [];
      if (folder) groups.set(folder.id, assetIds);
      else {
        for (const row of suggestions) {
          if (!row.folderId) unplaced.push(row.assetId);
          else groups.set(row.folderId, [...(groups.get(row.folderId) ?? []), row.assetId]);
        }
      }
      let added = 0;
      let updated = 0;
      let draftLabel = overview.project.draftVersion;
      const placed = [];
      for (const [folderId, ids] of groups) {
        for (const batch of chunks(ids, PROMOTE_CHUNK)) {
          const result = await client.mutation(api.review.promote, {
            ownerUserId, slug: input.project, assetIds: batch as Id<"assets">[],
            folderId: folderId as Id<"reviewFolders">, styleId: style?.styleId as Id<"worldStyles"> | undefined, note: input.note,
          });
          added += result.added;
          updated += result.updated;
          draftLabel = result.draftLabel;
        }
        placed.push({ folder: folders.get(folderId)?.slug, frames: ids.length });
      }
      return NextResponse.json({
        ok: unplaced.length === 0, project: input.project, draft: draftLabel ?? null, added, updated, placed,
        unplaced: unplaced.length ? unplaced.map(asset) : undefined,
        next: [
          unplaced.length ? "Unplaced frames have no folder named like their shelves: promote them again with folder." : "",
          "review_items {round: \"draft\"} checks the draft. Publish only on Michael's go.",
        ].filter(Boolean).join(" "),
      });
    }

    if (action === "move" || action === "remove" || action === "reorder" || action === "replace") {
      const input = reviewOrganizeSchema.omit({ op: true }).parse(body);
      const overview = await overviewOf(input.project);
      const list = await itemsOf(input.project);
      if (!list.version) fail(`${input.project} has no rounds yet. review_promote starts the draft.`);
      const folders = new Map(overview.folders.map((row) => [row.id, row]));
      const inFolder = input.inFolder ? findFolder(overview, input.inFolder, input.section) : undefined;
      const rows = list.items.filter((row) => (!inFolder || row.folderId === inFolder.id)
        && (!input.section || inFolder || folders.get(row.folderId)?.section === input.section));
      const { found, missing } = matchItems(rows, input.items);
      if (missing.length) {
        fail(`Not in round ${list.version!.label}${inFolder ? ` folder ${inFolder.slug}` : ""}: ${listOf(missing)}. review_items lists what is there.`);
      }
      if (action === "move" || action === "replace") {
        const twice = found.find((hits) => hits.length > 1);
        if (twice) {
          const homes = unique(twice.map((row) => folders.get(row.folderId)?.slug ?? row.folderId));
          fail(homes.length > 1
            ? `${twice[0]!.code} is in ${listOf(homes)}: add inFolder.`
            : `${twice[0]!.code} is in ${homes[0]} twice: name the item by its item id (review_items).`);
        }
      }
      const matched = unique(found.flat());
      const itemIds = matched.map((row) => row.itemId) as Id<"reviewItems">[];
      let result: { draftLabel: string; changed?: number; removed?: number };
      let movedTo: string | undefined;
      if (action === "move") {
        if (!input.folder && input.style === undefined && input.note === undefined) fail("move needs folder, style or note.");
        const target = input.folder ? findFolder(overview, input.folder, input.section) : undefined;
        movedTo = target?.slug;
        const styleId = input.style === null ? null : input.style ? findStyle(overview, input.style).styleId : undefined;
        result = await client.mutation(api.review.updateItems, {
          ownerUserId, slug: input.project, itemIds,
          folderId: target?.id as Id<"reviewFolders"> | undefined,
          styleId: styleId as Id<"worldStyles"> | null | undefined, note: input.note,
        });
      } else if (action === "remove") {
        result = await client.mutation(api.review.removeItems, { ownerUserId, slug: input.project, itemIds });
      } else if (action === "reorder") {
        result = await client.mutation(api.review.reorderItems, { ownerUserId, slug: input.project, itemIds });
      } else {
        if (itemIds.length !== 1) fail("replace takes exactly one item.");
        if (!input.with) fail("replace needs with: the new take (asset:<id>).");
        result = await client.mutation(api.review.replaceItemAsset, {
          ownerUserId, slug: input.project, itemId: itemIds[0]!, assetId: bare(input.with!) as Id<"assets">,
        });
      }
      return NextResponse.json({
        ok: true, project: input.project, draft: result.draftLabel,
        changed: result.changed ?? result.removed ?? matched.length,
        items: matched.map((row) => ({ code: row.code, asset: row.asset, folder: movedTo ?? folders.get(row.folderId)?.slug })),
        replacedWith: action === "replace" ? asset(input.with!) : undefined,
        next: list.version!.status === "published" && !overview.project.draftVersion
          ? `There was no draft: ${result.draftLabel} was started as a copy of the current round and changed. The director sees nothing until it is published.`
          : undefined,
      });
    }

    if (action === "draft") {
      const input = reviewRoundSchema.omit({ op: true }).parse(body);
      const before = await overviewOf(input.project);
      if (input.round !== undefined && before.project.draftVersion) {
        fail(`Draft ${before.project.draftVersion} exists already. Publish or discard it first.`);
      }
      const result = await client.mutation(api.review.createDraft, { ownerUserId, slug: input.project, fromVersion: roundArg(input.round) });
      const after = await overviewOf(input.project);
      return NextResponse.json({
        ok: true, project: input.project, draft: result.draftLabel, created: !before.project.draftVersion,
        frames: after.versions.find((row) => row.isDraft)?.itemCount ?? 0,
      });
    }

    if (action === "publish" || action === "set_current" || action === "discard_draft") {
      const input = reviewRoundSchema.omit({ op: true }).parse(body);
      if (input.confirmed !== true) {
        fail(`${action === "discard_draft" ? "discard_draft throws the draft round away" : `${action} changes what the director sees`}. Do it only on Michael's word, then pass confirmed: true.`);
      }
      if (action === "publish") {
        const result = await client.mutation(api.review.publishDraft, {
          ownerUserId, slug: input.project, title: input.title, note: input.note, label: input.label,
        });
        const overview = await overviewOf(input.project);
        return NextResponse.json({
          ok: true, project: input.project, current: result.label, frames: result.items,
          url: reviewUrl(input.project), publicUrl: overview.project.publicUrl,
          next: "The director now sees this round. review_round {op: \"set_current\", round} rolls back.",
        });
      }
      if (action === "set_current") {
        if (input.round === undefined) fail("set_current needs round: the published round to show (\"v0.1\" or 1).");
        const result = await client.mutation(api.review.setCurrentVersion, { ownerUserId, slug: input.project, version: roundArg(input.round)! });
        return NextResponse.json({ ok: true, project: input.project, current: result.label });
      }
      const before = await overviewOf(input.project);
      const result = await client.mutation(api.review.discardDraft, { ownerUserId, slug: input.project });
      return NextResponse.json({ ok: true, project: input.project, discarded: before.project.draftVersion ?? null, removed: result.removed });
    }

    const input = reviewCommentSchema.omit({ op: true }).extend({ resolved: z.boolean().optional() }).parse(body);
    if (action === "comment") {
      if (!input.frames?.length) fail("comment needs frames.");
      if (!input.body) fail("comment needs a body.");
      const overview = await overviewOf(input.project);
      const assetIds = await resolveFrames(input.project, overview, input.frames!);
      const result = await client.mutation(api.review.ownerComment, {
        ownerUserId, slug: input.project, assetIds: assetIds as Id<"assets">[], body: input.body!, author: "agent",
      });
      return NextResponse.json({ ok: true, project: input.project, added: result.added, frames: assetIds.map(asset) });
    }
    if (action === "mark_seen") {
      await client.mutation(api.review.markFeedbackSeen, { slug: input.project });
      return NextResponse.json({ ok: true, project: input.project, markedSeen: true });
    }
    if (!input.commentId) fail(`${action} needs commentId (from review_feedback).`);
    const commentId = bare(input.commentId!) as Id<"reviewComments">;
    if (action === "resolve_comment") {
      const resolved = input.resolved ?? true;
      await client.mutation(api.review.ownerResolveComment, { ownerUserId, slug: input.project, commentId, resolved });
      return NextResponse.json({ ok: true, project: input.project, commentId, resolved });
    }
    await client.mutation(api.review.deleteComment, { slug: input.project, commentId });
    return NextResponse.json({ ok: true, project: input.project, commentId, deleted: true });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    if (error instanceof ReviewInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "The review request failed.") }, { status: 400 });
  }
}
