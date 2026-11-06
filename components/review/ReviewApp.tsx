"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LIST_COLORS, LIST_KEYS, SECTION_LABEL, SECTION_SINGULAR, downloadFrames, copyText, emptyLists, isTyping, plural, readLists, readViewState,
  reviewBase, slugOf, writeLists, writeViewState,
  type FeedbackFilter, type GridSize, type ListKey, type Lists, type ReviewFeedback, type ReviewFolder, type ReviewItem, type ReviewPage,
  type ReviewSection, type ReviewVersion, type Verdict, type ViewState,
} from "@/lib/review-client";
import { reviewTheme } from "@/lib/review-theme";
import { Grid, type GridGroup, type TileAction, type TileMark } from "./Grid";
import { Sidebar, TopBar, type AreaGroup, type StyleChip } from "./Chrome";
import { Milestones } from "./Milestones";
import { BulkBar } from "./BulkBar";
import type { Person } from "./people";
import type { LightboxVerdict } from "./Lightbox";
import type { Audience } from "./OwnerTools";

// The review page's client app. The server hands it the first round and the
// feedback (so the first paint has every frame); from then on it subscribes
// live through its own Convex client, whose identity comes from
// `${base}/api/auth/token`. Folder, style and filter changes are local and
// instant: every index is built once per round.

const Lightbox = lazy(() => import("./Lightbox"));
// Michael's tools load only for him (never for a director, never in "view as director").
const OwnerStrip = lazy(() => import("./OwnerTools").then((module) => ({ default: module.OwnerStrip })));
const FeedbackPanel = lazy(() => import("./OwnerTools").then((module) => ({ default: module.FeedbackPanel })));
const BulkOwnerTools = lazy(() => import("./OwnerTools").then((module) => ({ default: module.BulkOwnerTools })));
const RemoveStyleDialog = lazy(() => import("./OwnerTools").then((module) => ({ default: module.RemoveStyleDialog })));
const ListsDock = lazy(() => import("./OwnerTools").then((module) => ({ default: module.ListsDock })));

type Args = { versionId?: Id<"reviewVersions">; draft?: boolean; asDirector?: boolean };

type Props = {
  slug: string;
  initialPage: ReviewPage;
  initialArgs: Args;
  initialFeedback: ReviewFeedback | null;
  initialToken: string | null;
  initialSearch: string;
  convexUrl: string;
  isDev: boolean;
};

export function ReviewApp(props: Props) {
  const [client] = useState(() => {
    const instance = new ConvexReactClient(props.convexUrl, { unsavedChangesWarning: false });
    if (typeof window !== "undefined") {
      let first = props.initialToken;
      instance.setAuth(async ({ forceRefreshToken }) => {
        if (first && !forceRefreshToken) {
          const token = first;
          first = null;
          return token;
        }
        first = null;
        try {
          const response = await fetch(`${reviewBase()}/api/auth/token`, { cache: "no-store", credentials: "same-origin" });
          if (!response.ok) return null;
          const data = (await response.json()) as { token?: string | null };
          return data.token ?? null;
        } catch {
          return null;
        }
      });
    }
    return instance;
  });
  return (
    <ConvexProvider client={client}>
      <Review {...props} />
    </ConvexProvider>
  );
}

// ------------------------------------------------------------ helpers

const SECTIONS: ReviewSection[] = ["locations", "characters", "scenes"];
const SECTION_ORDER: Record<ReviewSection, number> = { locations: 0, characters: 1, scenes: 2 };
const EMPTY_FEEDBACK: ReviewFeedback = { people: [], verdicts: [], comments: [], reviewers: [] };
const FILTER_KEYS: FeedbackFilter[] = ["all", "liked", "disliked", "commented", "todo", "new", "feedback"];

const errorText = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^[\s\S]*ConvexError: /, "").replace(/\s+at [\s\S]*$/, "") : "That did not work.";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function buildIndex(page: ReviewPage) {
  const styleOrder = new Map(page.styles.map((row, position) => [row.id as string, position]));
  const styleBySlug = new Map(page.styles.map((row) => [slugOf(row.label), row]));
  const folders = [...page.folders].sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.order - b.order);
  const folderById = new Map(folders.map((row) => [row.id as string, row]));
  const itemsByFolder = new Map<string, ReviewItem[]>();
  for (const item of page.items) {
    const list = itemsByFolder.get(item.folderId) ?? [];
    list.push(item);
    itemsByFolder.set(item.folderId, list);
  }
  const rank = (item: ReviewItem) => styleOrder.get(item.styleId ?? "") ?? 999;
  for (const list of itemsByFolder.values()) list.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  const sectionCounts: Record<ReviewSection, number> = { locations: 0, characters: 0, scenes: 0 };
  const folderCounts = new Map<string, number>();
  const areas: Record<ReviewSection, AreaGroup[]> = { locations: [], characters: [], scenes: [] };
  for (const folder of folders) {
    const count = itemsByFolder.get(folder.id)?.length ?? 0;
    folderCounts.set(folder.id, count);
    sectionCounts[folder.section] += count;
    const groups = areas[folder.section];
    // Locations read as one list in script order; characters keep their groups.
    const area = folder.section === "locations" ? "" : folder.area ?? "";
    let group = groups.find((row) => row.area === area);
    if (!group) {
      group = { area, folders: [] };
      groups.push(group);
    }
    group.folders.push(folder);
  }
  const sections = SECTIONS.filter((section) => folders.some((row) => row.section === section));
  if (sections.length === 0) sections.push("locations");
  const byCode = new Map(page.items.map((item) => [item.code, item]));
  const byAsset = new Map(page.items.map((item) => [item.assetId as string, item]));
  // Styles with frames in this round, so empty ones stay out of the carousel.
  const roundStyleCounts = new Map<string, number>();
  for (const item of page.items) if (item.styleId) roundStyleCounts.set(item.styleId, (roundStyleCounts.get(item.styleId) ?? 0) + 1);
  const roundStyles = new Set(roundStyleCounts.keys());
  return { styleOrder, styleBySlug, folders, folderById, itemsByFolder, sectionCounts, folderCounts, areas, sections, byCode, byAsset, roundStyles, roundStyleCounts };
}

function initialView(search: string, page: ReviewPage): ViewState {
  const index = buildIndex(page);
  const parsed = readViewState(search, "m");
  const section =
    parsed.section && index.sections.includes(parsed.section)
      ? parsed.section
      : index.sections.find((value) => index.sectionCounts[value] > 0) ?? index.sections[0]!;
  const inSection = index.folders.filter((row) => row.section === section);
  const firstFull = inSection.find((row) => (index.folderCounts.get(row.id) ?? 0) > 0);
  let folder = parsed.folder;
  if (folder === undefined || (folder && !inSection.some((row) => row.slug === folder))) folder = firstFull?.slug ?? "";
  const style = parsed.style && index.styleBySlug.has(parsed.style) ? parsed.style : "";
  return {
    section,
    folder,
    style,
    filter: parsed.filter ?? "all",
    size: parsed.size,
    round: parsed.round ?? "",
    open: parsed.open && index.byCode.has(parsed.open) ? parsed.open : "",
  };
}

type Flash = { key: string; x: number; y: number; label: string; tone: "like" | "dislike" | "list" | "plain"; color?: string };
type Toast = { key: number; text: string; error?: boolean };
type Pending = Map<string, { verdict: Verdict | null; seq: number }>;
type FeedbackRow = ReviewFeedback["verdicts"][number];

// ------------------------------------------------------------ the page

function Review({ slug, initialPage, initialArgs, initialFeedback, initialSearch, isDev }: Props) {
  // ---------------------------------------------------------- data
  const [args, setArgs] = useState<Args>(initialArgs);
  const argsKey = `${args.versionId ?? ""}|${args.draft ? 1 : 0}|${args.asDirector ? 1 : 0}`;
  const queryArgs = useMemo(
    () => ({
      slug,
      ...(args.versionId ? { versionId: args.versionId } : {}),
      ...(args.draft ? { draft: true } : {}),
      ...(args.asDirector ? { asDirector: true } : {}),
    }),
    [slug, args.versionId, args.draft, args.asDirector],
  );
  const live = useQuery(api.review.page, queryArgs);
  const livePage = live && !("denied" in live) ? live : undefined;
  const [held, setHeld] = useState(() => ({ page: initialPage, key: argsKey }));
  if (livePage && (livePage !== held.page || held.key !== argsKey)) setHeld({ page: livePage, key: argsKey });
  const page = livePage ?? held.page;
  const loadingRound = !livePage && held.key !== argsKey;
  const lostAccess = live === null || (live !== undefined && "denied" in live);

  const liveFeedback = useQuery(api.review.feedback, { slug });
  const feedback = (liveFeedback === undefined ? initialFeedback : liveFeedback) ?? EMPTY_FEEDBACK;

  const viewer = page.viewer;
  const isOwner = viewer.role === "owner";
  const isPreview = Boolean(viewer.preview);
  const canVote = viewer.role !== "viewer";
  const myKey = viewer.key ?? viewer.email ?? "owner";
  const viewerName = viewer.name ?? viewer.email?.split("@")[0] ?? "You";

  const index = useMemo(() => buildIndex(page), [page]);
  const shownVersion = page.versions.find((row) => row.id === page.versionId);
  const currentVersion = page.versions.find((row) => row.isCurrent);

  // ---------------------------------------------------------- people
  const people = useMemo(() => new Map<string, Person>(feedback.people.map((row) => [row.who, row])), [feedback.people]);
  const me = feedback.people.find((row) => row.isYou);
  // Who the review is for, in plain words ("Alejandro").
  const audience = useMemo<Audience>(() => {
    const reviewers = feedback.people.filter((row) => row.role !== "owner" && row.role !== "agent");
    const lead = reviewers.find((row) => row.role === "director") ?? reviewers[0];
    return { name: lead ? firstName(lead.name) : "the director", plural: false };
  }, [feedback.people]);

  // ---------------------------------------------------------- feedback
  const seenAt = page.project.feedbackSeenAt ?? 0;
  const fb = useMemo(() => {
    const mine = new Map<string, Verdict>();
    // Reviewers' verdicts (director / viewer roles only): what the owner's filters count.
    const theirs = new Map<string, FeedbackRow[]>();
    // Everyone whose face shows on the frame: reviewers, plus your own.
    const faces = new Map<string, FeedbackRow[]>();
    const fresh = new Set<string>();
    for (const row of feedback.verdicts) {
      const own = row.email === myKey;
      if (own) mine.set(row.assetId, row.verdict);
      const reviewer = row.role !== "owner";
      if (reviewer && !own) {
        const list = theirs.get(row.assetId) ?? [];
        list.push(row);
        theirs.set(row.assetId, list);
        if (isOwner && row.updatedAt > seenAt) fresh.add(row.assetId);
      }
      if (reviewer || own) {
        const list = faces.get(row.assetId) ?? [];
        list.push(row);
        faces.set(row.assetId, list);
      }
    }
    const comments = new Map(feedback.comments.map((row) => [row.assetId as string, row]));
    if (isOwner) for (const row of feedback.comments) if (!row.lastByOwner && row.lastAt > seenAt) fresh.add(row.assetId);
    return { mine, theirs, faces, comments, fresh };
  }, [feedback, myKey, isOwner, seenAt]);

  const [pending, setPending] = useState<Pending>(() => new Map());
  const mineOf = useCallback(
    (assetId: string) => {
      const override = pending.get(assetId);
      return override ? override.verdict ?? undefined : fb.mine.get(assetId);
    },
    [pending, fb],
  );

  // ---------------------------------------------------------- owner lists (keys 3–9)
  const [lists, setLists] = useState<Lists>(emptyLists);
  const [viewingList, setViewingList] = useState<ListKey | null>(null);
  useEffect(() => {
    if (!isOwner) return;
    // Read after the first paint, so the server render and the browser agree.
    const handle = window.requestAnimationFrame(() => setLists(readLists(slug)));
    return () => window.cancelAnimationFrame(handle);
  }, [isOwner, slug]);
  const listsOf = useMemo(() => {
    const map = new Map<string, string>();
    if (!isOwner) return map;
    for (const key of LIST_KEYS) for (const id of lists.items[key]) map.set(id, (map.get(id) ?? "") + key);
    return map;
  }, [lists, isOwner]);

  const marks = useMemo(() => {
    const map = new Map<string, TileMark>();
    for (const item of page.items) {
      const id = item.assetId as string;
      const mine = mineOf(id);
      let verdict: Verdict | undefined = mine;
      if (isOwner) {
        const rows = fb.theirs.get(id) ?? [];
        const likes = rows.filter((row) => row.verdict === "like").length;
        const dislikes = rows.length - likes;
        verdict = rows.length === 0 ? undefined : likes >= dislikes ? "like" : "dislike";
      }
      // Your own face follows your click at once; everyone else's comes from the server.
      const faceRows = (fb.faces.get(id) ?? []).filter((row) => row.email !== myKey);
      const faces = faceRows.map((row) => `${row.who ?? row.email}:${row.verdict}`);
      if (mine && me) faces.unshift(`${me.who}:${mine}`);
      map.set(id, {
        verdict,
        mine,
        faces: faces.join(","),
        comments: fb.comments.get(id)?.count ?? 0,
        fresh: fb.fresh.has(id),
        lists: listsOf.get(id) ?? "",
      });
    }
    return map;
  }, [page.items, mineOf, fb, isOwner, myKey, me, listsOf]);

  // ---------------------------------------------------------- view
  const [view, setView] = useState<ViewState>(() => initialView(initialSearch, initialPage));
  const pushNext = useRef(false);
  const pushedOpen = useRef(false);
  // The address names a round only when it is not the current one.
  const roundInUrl = page.versions.find((row) => row.id === page.versionId && !row.isCurrent)?.label ?? "";
  useEffect(() => {
    const mode = pushNext.current ? "push" : "replace";
    pushNext.current = false;
    writeViewState({ ...view, round: roundInUrl }, mode);
  }, [view, roundInUrl]);
  useEffect(() => {
    const onPop = () => {
      pushedOpen.current = false;
      const parsed = readViewState(window.location.search, "m");
      setView((current) => ({ ...current, open: parsed.open ?? "" }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const folder: ReviewFolder | null = view.folder
    ? index.folders.find((row) => row.section === view.section && row.slug === view.folder) ?? null
    : null;
  // A style with no frames left in the shown round (all removed) is not a filter any more.
  const styleRow = view.style ? index.styleBySlug.get(view.style) ?? null : null;
  const style = styleRow && index.roundStyles.has(styleRow.id) ? styleRow : null;
  const listView = isOwner && viewingList && lists.items[viewingList].length ? viewingList : null;
  const listSet = useMemo(() => new Set(listView ? lists.items[listView] : []), [listView, lists]);

  const scope = useMemo(() => {
    if (listView) return page.items.filter((item) => listSet.has(item.assetId));
    if (folder) return index.itemsByFolder.get(folder.id) ?? [];
    return index.folders.filter((row) => row.section === view.section).flatMap((row) => index.itemsByFolder.get(row.id) ?? []);
  }, [index, folder, view.section, listView, listSet, page.items]);

  const styleChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scope) if (item.styleId) counts.set(item.styleId, (counts.get(item.styleId) ?? 0) + 1);
    return page.styles
      .filter((row) => index.roundStyles.has(row.id))
      .map((row) => ({ ...row, slug: slugOf(row.label), count: counts.get(row.id) ?? 0, roundCount: index.roundStyleCounts.get(row.id) ?? 0 }));
  }, [scope, page.styles, index]);

  const styled = useMemo(() => (style ? scope.filter((item) => item.styleId === style.id) : scope), [scope, style]);

  const passes = useCallback((item: ReviewItem, filter: FeedbackFilter) => {
    if (filter === "all") return true;
    const mark = marks.get(item.assetId);
    if (!mark) return false;
    if (filter === "liked") return mark.verdict === "like";
    if (filter === "disliked") return mark.verdict === "dislike";
    if (filter === "commented") return mark.comments > 0;
    if (filter === "todo") return !mark.verdict && mark.comments === 0;
    if (filter === "feedback") {
      const comment = fb.comments.get(item.assetId);
      return (fb.theirs.get(item.assetId)?.length ?? 0) > 0 || Boolean(comment && !comment.lastByOwner);
    }
    return mark.fresh;
  }, [marks, fb]);

  const filterCounts = useMemo(() => {
    const counts = Object.fromEntries(FILTER_KEYS.map((key) => [key, 0])) as Record<FeedbackFilter, number>;
    for (const item of styled) for (const key of FILTER_KEYS) if (passes(item, key)) counts[key] += 1;
    return counts;
  }, [styled, passes]);

  const visible = useMemo(() => styled.filter((item) => passes(item, view.filter)), [styled, passes, view.filter]);

  const groups = useMemo<GridGroup[]>(() => {
    if (listView) {
      return index.folders
        .map((row) => ({ key: row.id as string, title: row.name, kicker: SECTION_SINGULAR[row.section], items: visible.filter((item) => item.folderId === row.id) }))
        .filter((group) => group.items.length > 0);
    }
    if (folder && !style) {
      // "All styles": one section per style, in carousel order.
      const out: GridGroup[] = page.styles
        .map((row) => ({ key: row.id as string, title: row.label, items: visible.filter((item) => item.styleId === row.id) }))
        .filter((group) => group.items.length > 0);
      const loose = visible.filter((item) => !item.styleId || !index.styleOrder.has(item.styleId));
      if (loose.length) out.push({ key: "none", title: page.styles.length ? "Other" : undefined, items: loose });
      return out;
    }
    if (!folder) {
      return index.folders
        .filter((row) => row.section === view.section)
        .map((row) => ({ key: row.id as string, title: row.name, kicker: row.area, items: visible.filter((item) => item.folderId === row.id) }))
        .filter((group) => group.items.length > 0);
    }
    return [{ key: "frames", items: visible }];
  }, [listView, folder, style, visible, page.styles, index, view.section]);

  const flatIds = useMemo(() => groups.flatMap((group) => group.items.map((item) => item.assetId as string)), [groups]);

  // ---------------------------------------------------------- feedback UI
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, error = false) => {
    seq.current += 1;
    const key = seq.current;
    setToasts((current) => [...current.slice(-2), { key, text, error }]);
    window.setTimeout(() => setToasts((current) => current.filter((row) => row.key !== key)), 3500);
  }, []);

  const flash = useCallback((ids: string[], label: string, tone: Flash["tone"], color?: string) => {
    seq.current += 1;
    const batch = `f${seq.current}`;
    const points: Array<{ x: number; y: number }> = [];
    const stage = document.querySelector(".rv-lb-stage");
    if (stage) {
      const rect = stage.getBoundingClientRect();
      points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      for (const id of ids.slice(0, 40)) {
        const rect = document.querySelector(`.rv-t[data-id="${id}"]`)?.getBoundingClientRect();
        if (rect && rect.bottom > 0 && rect.top < window.innerHeight) points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
    }
    if (points.length === 0) return;
    setFlashes((current) => [...current, ...points.map((point, offset) => ({ ...point, key: `${batch}-${offset}`, label, tone, color }))]);
    window.setTimeout(() => setFlashes((current) => current.filter((row) => !row.key.startsWith(`${batch}-`))), 1000);
  }, []);

  const setVerdictMutation = useMutation(api.review.setVerdict);
  const applyVerdict = useCallback((ids: string[], verdict: Verdict) => {
    if (!canVote || ids.length === 0) return;
    const next = ids.every((id) => mineOf(id) === verdict) ? null : verdict;
    seq.current += 1;
    const mySeq = seq.current;
    setPending((current) => {
      const map = new Map(current);
      for (const id of ids) map.set(id, { verdict: next, seq: mySeq });
      return map;
    });
    if (next === null) flash(ids, "Cleared", "plain");
    else flash(ids, next === "like" ? (ids.length > 1 ? `Liked ${ids.length}` : "Liked") : ids.length > 1 ? `Disliked ${ids.length}` : "Disliked", next);
    setVerdictMutation({ slug, assetIds: ids as Id<"assets">[], verdict: next })
      .catch((error) => toast(errorText(error), true))
      .finally(() =>
        setPending((current) => {
          const map = new Map(current);
          for (const id of ids) if (map.get(id)?.seq === mySeq) map.delete(id);
          return map;
        }),
      );
  }, [canVote, mineOf, flash, setVerdictMutation, slug, toast]);

  const addComment = useMutation(api.review.addComment).withOptimisticUpdate((store, mutationArgs) => {
    const current = store.getQuery(api.review.feedback, { slug: mutationArgs.slug });
    if (!current) return;
    const comments = [...current.comments];
    const now = Date.now();
    for (const id of mutationArgs.assetIds) {
      const at = comments.findIndex((row) => row.assetId === id);
      if (at >= 0) comments[at] = { ...comments[at]!, count: comments[at]!.count + 1, open: comments[at]!.open + 1, lastAt: now, lastByOwner: isOwner };
      else comments.push({ assetId: id, count: 1, open: 1, lastAt: now, lastByOwner: isOwner });
    }
    store.setQuery(api.review.feedback, { slug: mutationArgs.slug }, { ...current, comments });
  });

  const toggleList = useCallback((key: ListKey, ids: string[]) => {
    if (!isOwner || ids.length === 0) return;
    const has = ids.every((id) => lists.items[key].includes(id));
    const items = has ? lists.items[key].filter((id) => !ids.includes(id)) : [...lists.items[key], ...ids.filter((id) => !lists.items[key].includes(id))];
    const next: Lists = { names: lists.names, items: { ...lists.items, [key]: items } };
    setLists(next);
    writeLists(slug, next);
    const count = ids.length > 1 ? ` · ${ids.length}` : "";
    flash(ids, `${has ? "Out of" : "In"} ${lists.names[key]}${count}`, "list", LIST_COLORS[key]);
  }, [isOwner, lists, slug, flash]);

  const renameList = useCallback((key: ListKey, name: string) => {
    setLists((current) => {
      const next: Lists = { names: { ...current.names, [key]: name }, items: current.items };
      writeLists(slug, next);
      return next;
    });
  }, [slug]);

  // ---------------------------------------------------------- selection
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const flatRef = useRef(flatIds);
  useEffect(() => {
    flatRef.current = flatIds;
  }, [flatIds]);
  const targetRef = useRef<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelected((current) => (current.size ? new Set() : current));
    anchor.current = null;
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);
  const rangeSelect = useCallback((id: string) => {
    const ids = flatRef.current;
    const from = anchor.current ? ids.indexOf(anchor.current) : -1;
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) {
      toggleSelect(id);
      return;
    }
    const [low, high] = from < to ? [from, to] : [to, from];
    setSelected((current) => new Set([...current, ...ids.slice(low, high + 1)]));
  }, [toggleSelect]);
  const boxSelect = useCallback((ids: Set<string>) => {
    setSelected((current) => (current.size === ids.size && [...ids].every((id) => current.has(id)) ? current : ids));
  }, []);
  const selectMany = useCallback((ids: string[]) => {
    setSelected((current) => new Set([...current, ...ids]));
  }, []);

  // ---------------------------------------------------------- view changes
  const [navOpen, setNavOpen] = useState(false);
  const [removingStyle, setRemovingStyle] = useState<StyleChip | null>(null);
  const changeView = useCallback((patch: Partial<ViewState>, opts: { clear?: boolean } = {}) => {
    setView((current) => ({ ...current, ...patch }));
    if (opts.clear) clearSelection();
  }, [clearSelection]);

  const onSection = useCallback((section: ReviewSection) => {
    const first = index.folders.find((row) => row.section === section && (index.folderCounts.get(row.id) ?? 0) > 0);
    setViewingList(null);
    changeView({ section, folder: first?.slug ?? "" }, { clear: true });
    window.scrollTo({ top: 0 });
  }, [index, changeView]);
  const onFolder = useCallback((slugValue: string) => {
    setViewingList(null);
    changeView({ folder: slugValue }, { clear: true });
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [changeView]);
  const onStyle = useCallback((slugValue: string) => {
    changeView({ style: slugValue });
    window.scrollTo({ top: 0 });
  }, [changeView]);
  const onFilter = useCallback((filter: FeedbackFilter) => changeView({ filter }), [changeView]);
  const onSize = useCallback((size: GridSize) => changeView({ size }), [changeView]);
  const onViewList = useCallback((key: ListKey | null) => {
    setViewingList(key);
    clearSelection();
    window.scrollTo({ top: 0 });
  }, [clearSelection]);

  // Rounds: switching shows the round's title and note under the bar for a moment.
  const [roundMessage, setRoundMessage] = useState<{ key: string; title: string; note?: string } | null>(null);
  const messageTimer = useRef(0);
  const onRound = useCallback((version: ReviewVersion | null) => {
    const isDefault = !version || (version.isCurrent && !version.isDraft);
    setArgs((current) => (isDefault ? { asDirector: current.asDirector } : { versionId: version!.id, asDirector: current.asDirector }));
    changeView({ round: isDefault ? "" : version!.label, open: "" }, { clear: true });
    // The next round explains itself in the owner strip; published rounds get their note here.
    if (version && !version.isDraft && (version.title || version.note)) {
      const title = `${version.label}${version.title ? ` · ${version.title}` : ""}`;
      setRoundMessage({ key: `${version.id}-${Date.now()}`, title, note: version.note });
      window.clearTimeout(messageTimer.current);
      messageTimer.current = window.setTimeout(() => setRoundMessage(null), 6000);
    }
  }, [changeView]);
  const onPickRound = useCallback((version: ReviewVersion) => {
    if (version.id === page.versionId) return;
    onRound(version);
  }, [onRound, page.versionId]);
  useEffect(() => () => window.clearTimeout(messageTimer.current), []);

  const roundOrder = useMemo(() => {
    const published = page.versions.filter((row) => row.status === "published").sort((a, b) => a.number - b.number);
    const draft = isOwner ? page.versions.find((row) => row.isDraft) : undefined;
    return draft ? [...published, draft] : published;
  }, [page.versions, isOwner]);
  const stepRound = useCallback((delta: number) => {
    const at = roundOrder.findIndex((row) => row.id === page.versionId);
    const next = roundOrder[Math.max(0, Math.min(roundOrder.length - 1, (at < 0 ? roundOrder.length - 1 : at) + delta))];
    if (next && next.id !== page.versionId) onRound(next);
  }, [roundOrder, page.versionId, onRound]);

  // ---------------------------------------------------------- open view
  const [lightbox, setLightbox] = useState<{ ids: string[]; focus: number }>({ ids: [], focus: 0 });
  const openFrame = useCallback((assetId: string, focusComment = false) => {
    const item = index.byAsset.get(assetId);
    if (!item) return;
    setLightbox((current) => ({ ids: flatRef.current, focus: focusComment ? current.focus + 1 : current.focus }));
    setView((current) => {
      if (!current.open) {
        pushNext.current = true;
        pushedOpen.current = true;
      }
      return { ...current, open: item.code };
    });
  }, [index]);

  const openItem = view.open ? index.byCode.get(view.open) : undefined;
  const lightboxIds = lightbox.ids.length && openItem && lightbox.ids.includes(openItem.assetId) ? lightbox.ids : flatIds;
  const openPosition = openItem ? Math.max(0, lightboxIds.indexOf(openItem.assetId)) : 0;

  const closeFrame = useCallback(() => {
    const code = view.open;
    if (pushedOpen.current) {
      pushedOpen.current = false;
      window.history.back();
    } else {
      setView((current) => ({ ...current, open: "" }));
    }
    const item = index.byCode.get(code);
    if (item) {
      window.requestAnimationFrame(() => {
        const tile = document.querySelector<HTMLElement>(`.rv-t[data-id="${item.assetId}"]`);
        if (!tile) return;
        document.querySelector(".rv-t[data-active]")?.removeAttribute("data-active");
        tile.setAttribute("data-active", "");
        targetRef.current = item.assetId;
        tile.scrollIntoView({ block: "nearest" });
      });
    }
  }, [view.open, index]);

  const navFrame = useCallback((delta: number) => {
    const ids = lightboxIds;
    if (!openItem || ids.length === 0) return;
    const nextId = ids[Math.min(ids.length - 1, Math.max(0, openPosition + delta))];
    const nextItem = nextId ? index.byAsset.get(nextId) : undefined;
    if (nextItem && nextItem.code !== view.open) setView((current) => ({ ...current, open: nextItem.code }));
  }, [lightboxIds, openItem, openPosition, index, view.open]);

  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
    const run = () => void import("./Lightbox");
    if (idle) idle(run);
    else window.setTimeout(run, 1500);
  }, []);

  // ---------------------------------------------------------- actions
  const targets = useCallback(() => {
    const hovered = targetRef.current;
    if (selected.size > 0 && (!hovered || selected.has(hovered))) return [...selected];
    return hovered ? [hovered] : [];
  }, [selected]);

  const commentAll = useCallback(async (body: string) => {
    const ids = [...selected];
    if (!ids.length) return false;
    try {
      const result = await addComment({ slug, assetIds: ids as Id<"assets">[], body });
      toast(`Comment posted on ${plural(result.added, "frame")}.`);
      flash(ids, "Comment posted", "plain");
      return true;
    } catch (error) {
      toast(errorText(error), true);
      return false;
    }
  }, [selected, addComment, slug, toast, flash]);

  const [composeSignal, setComposeSignal] = useState(0);

  const onAct = useCallback((action: TileAction, assetId: string, tile: HTMLElement) => {
    if (action === "copy") {
      const item = index.byAsset.get(assetId);
      if (!item) return;
      void copyText(item.code).then((ok) => {
        if (!ok) return;
        const chip = tile.querySelector(".rv-code");
        chip?.classList.add("ok");
        window.setTimeout(() => chip?.classList.remove("ok"), 900);
        flash([assetId], `Copied ${item.code}`, "plain");
      });
      return;
    }
    const ids = selected.has(assetId) && selected.size > 1 ? [...selected] : [assetId];
    if (action === "like" || action === "dislike") applyVerdict(ids, action);
    else if (action === "comment") {
      if (ids.length > 1) setComposeSignal((value) => value + 1);
      else openFrame(assetId, true);
    }
  }, [index, selected, applyVerdict, openFrame, flash]);

  const moveActive = useCallback((key: string) => {
    const ids = flatRef.current;
    if (ids.length === 0) return;
    const current = targetRef.current;
    let nextId: string | undefined;
    if (!current || !ids.includes(current)) nextId = ids[0];
    else if (key === "arrowleft" || key === "arrowright") {
      const at = ids.indexOf(current) + (key === "arrowright" ? 1 : -1);
      nextId = ids[Math.max(0, Math.min(ids.length - 1, at))];
    } else {
      const from = document.querySelector(`.rv-t[data-id="${current}"]`)?.getBoundingClientRect();
      if (!from) nextId = ids[0];
      else {
        const centre = from.left + from.width / 2;
        let best: { id: string; row: number; dx: number } | null = null;
        for (const element of document.querySelectorAll<HTMLElement>(".rv-t[data-id]")) {
          const rect = element.getBoundingClientRect();
          const up = key === "arrowup";
          if (up ? rect.bottom > from.top + 2 : rect.top < from.bottom - 2) continue;
          const row = up ? from.top - rect.bottom : rect.top - from.bottom;
          const dx = Math.abs(rect.left + rect.width / 2 - centre);
          if (!best || row < best.row - 4 || (Math.abs(row - best.row) <= 4 && dx < best.dx)) best = { id: element.dataset.id!, row, dx };
        }
        nextId = best?.id ?? current;
      }
    }
    if (!nextId) return;
    document.querySelector(".rv-t[data-active]")?.removeAttribute("data-active");
    const tile = document.querySelector<HTMLElement>(`.rv-t[data-id="${nextId}"]`);
    tile?.setAttribute("data-active", "");
    tile?.scrollIntoView({ block: "nearest" });
    targetRef.current = nextId;
  }, []);

  // Keys on the hovered frame (the open view handles its own keys).
  const keys = useRef({
    open: false, isOwner: false, targets, applyVerdict, openFrame, clearSelection, moveActive, toggleList, stepRound,
    selectedSize: 0, selectAll: () => {}, compose: () => {},
  });
  useEffect(() => {
    keys.current = {
      open: Boolean(view.open),
      isOwner,
      targets,
      applyVerdict,
      openFrame,
      clearSelection,
      moveActive,
      toggleList,
      stepRound,
      selectedSize: selected.size,
      selectAll: () => setSelected(new Set(flatRef.current)),
      compose: () => setComposeSignal((value) => value + 1),
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keys.current;
      if (state.open || isTyping(event.target)) return;
      if (document.querySelector(".rv-dialog-back")) return;
      const key = event.key.toLowerCase();
      if (event.altKey && (key === "arrowleft" || key === "arrowright")) {
        event.preventDefault();
        state.stepRound(key === "arrowright" ? 1 : -1);
        return;
      }
      if (event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && key === "a") {
        event.preventDefault();
        state.selectAll();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (key === "[" || key === "]") {
        state.stepRound(key === "]" ? 1 : -1);
      } else if (key === "?") {
        document.querySelector<HTMLButtonElement>(".rv-bar-r .rv-btn.round")?.click();
      } else if (key === "1" || key === "2") {
        const ids = state.targets();
        if (ids.length) state.applyVerdict(ids, key === "1" ? "like" : "dislike");
      } else if (state.isOwner && key >= "3" && key <= "9" && key.length === 1) {
        const ids = state.targets();
        if (ids.length) state.toggleList(LIST_KEYS[Number(key) - 3]!, ids);
      } else if (key === "c") {
        const ids = state.targets();
        if (ids.length > 1) state.compose();
        else if (ids.length === 1) {
          event.preventDefault();
          state.openFrame(ids[0]!, true);
        }
      } else if (key === "o" || key === "enter" || key === " ") {
        const ids = state.targets();
        if (ids.length === 1) {
          event.preventDefault();
          state.openFrame(ids[0]!);
        }
      } else if (key === "escape") {
        if (state.selectedSize) state.clearSelection();
        else document.querySelector(".rv-t[data-active]")?.removeAttribute("data-active");
      } else if (key.startsWith("arrow")) {
        event.preventDefault();
        state.moveActive(key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------------- owner
  const markSeen = useMutation(api.review.markFeedbackSeen);
  const freshFolders = useMemo(() => {
    const set = new Set<string>();
    if (!isOwner) return set;
    for (const item of page.items) if (fb.fresh.has(item.assetId)) set.add(item.folderId);
    return set;
  }, [isOwner, page.items, fb.fresh]);

  // The reviewers' feedback on the shown round, in numbers.
  const stats = useMemo(() => {
    let likes = 0;
    let dislikes = 0;
    let commented = 0;
    let fresh = 0;
    for (const item of page.items) {
      for (const row of fb.theirs.get(item.assetId) ?? []) {
        if (row.verdict === "like") likes += 1;
        else dislikes += 1;
      }
      const comment = fb.comments.get(item.assetId);
      if (comment && comment.count > 0) commented += 1;
      if (fb.fresh.has(item.assetId)) fresh += 1;
    }
    return { likes, dislikes, commented, fresh };
  }, [page.items, fb]);

  const signOut = async () => {
    await fetch(`${reviewBase()}/api/auth/logout`, { method: "POST", credentials: "same-origin" }).catch(() => null);
    window.location.reload();
  };
  const devAs = async (as: "director" | "producer" | "owner") => {
    if (as === "owner") await fetch("/api/auth/dev-login", { method: "POST" }).catch(() => null);
    await fetch(`${reviewBase()}/api/dev-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) }).catch(() => null);
    window.location.reload();
  };
  const exitPreview = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    url.searchParams.delete("r");
    url.searchParams.delete("open");
    window.location.assign(url.toString());
  };

  // ---------------------------------------------------------- render
  const selectedIds = [...selected];
  const selectedItemIds = selectedIds.map((id) => index.byAsset.get(id)?.id).filter(Boolean) as Id<"reviewItems">[];
  const selectedCodes = selectedIds.map((id) => index.byAsset.get(id)?.code).filter(Boolean) as string[];
  const sectionLabel = SECTION_LABEL[view.section];
  const scopeEmpty = styled.length === 0;
  const codeOf = useCallback((assetId: string) => index.byAsset.get(assetId)?.code ?? assetId, [index]);

  const openVerdicts = useMemo<LightboxVerdict[]>(() => {
    if (!openItem) return [];
    return (fb.faces.get(openItem.assetId) ?? []).map((row) => ({
      person: people.get(row.who ?? "") ?? (row.email === myKey ? me : undefined),
      verdict: row.verdict,
      at: row.updatedAt,
    }));
  }, [openItem, fb, people, myKey, me]);

  const footer = (
    <>
      {isOwner ? (
        <Suspense fallback={null}>
          <FeedbackPanel
            people={feedback.people}
            reviewers={feedback.reviewers}
            audience={audience}
            stats={stats}
            onlyTheirs={view.filter === "feedback"}
            onOnlyTheirs={() => changeView({ filter: view.filter === "feedback" ? "all" : "feedback" })}
            onMarkRead={() => void markSeen({ slug }).then(() => toast("Feedback marked as read.")).catch((error) => toast(errorText(error), true))}
            onToast={toast}
          />
        </Suspense>
      ) : null}
      <div className="rv-who">
        <span>{isOwner || isPreview ? `${viewerName} · owner` : viewer.email ?? viewerName}</span>
        {isPreview ? (
          <button type="button" onClick={exitPreview}>Exit preview</button>
        ) : !isOwner || viewer.email ? (
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        ) : null}
      </div>
      {isDev && !isPreview ? (
        <div className="rv-who" style={{ borderTop: 0, paddingTop: 0 }}>
          <span>Dev</span>
          {isOwner ? (
            <>
              <button type="button" onClick={() => void devAs("director")}>Test director</button>
              <button type="button" style={{ marginLeft: 10 }} onClick={() => void devAs("producer")}>Producer</button>
            </>
          ) : (
            <button type="button" onClick={() => void devAs("owner")}>Back to owner</button>
          )}
        </div>
      ) : null}
    </>
  );

  const headKick = listView
    ? "Your list"
    : folder
      ? `${folder.area ? `${folder.area} · ` : ""}${SECTION_SINGULAR[view.section]}`
      : sectionLabel;
  const headTitle = listView ? lists.names[listView] : folder ? folder.name : `All ${sectionLabel.toLowerCase()}`;

  return (
    <div className="rv" data-theme={reviewTheme(slug)} data-size={view.size} data-nav={navOpen ? "" : undefined}>
      <Sidebar
        title={page.project.title}
        subtitle={page.project.subtitle}
        sections={index.sections}
        section={view.section}
        sectionCounts={index.sectionCounts}
        areas={index.areas[view.section]}
        folder={listView ? null : folder}
        folderCounts={index.folderCounts}
        freshFolders={freshFolders}
        onSection={onSection}
        onFolder={onFolder}
        footer={footer}
      />
      {navOpen ? <div className="rv-scrim" onClick={() => setNavOpen(false)} /> : null}

      <div className="rv-main">
        <TopBar
          mediaBase={page.mediaBase}
          styles={styleChips}
          style={style ? view.style : ""}
          allCount={scope.length}
          onStyle={onStyle}
          filter={view.filter}
          filterCounts={filterCounts}
          onFilter={onFilter}
          isOwner={isOwner}
          directorName={audience.name}
          versions={page.versions}
          versionId={page.versionId}
          onRound={onPickRound}
          roundMessage={roundMessage}
          size={view.size}
          onSize={onSize}
          onMenu={() => setNavOpen(true)}
          menuLabel={headTitle}
          onRemoveStyle={isOwner ? setRemovingStyle : undefined}
        />

        <main className="rv-content" data-loading={loadingRound ? "" : undefined}>
          {isOwner && shownVersion ? (
            <Suspense fallback={null}>
              <OwnerStrip
                slug={slug}
                shown={shownVersion}
                current={currentVersion}
                audience={audience}
                itemCount={page.items.length}
                onShowRound={onRound}
                onToast={toast}
              />
            </Suspense>
          ) : null}
          <div key={page.versionId ?? "none"} className="rv-fadein">
            <div className="rv-head">
              <div>
                <div className="kick">{headKick}</div>
                <h2>{headTitle}</h2>
              </div>
              <Milestones
                versions={page.versions}
                shownId={page.versionId}
                isOwner={isOwner}
                directorName={audience.name}
                onPick={onPickRound}
              />
              {listView ? (
                <button type="button" className="x" onClick={() => onViewList(null)}>Back to folders</button>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <div className="rv-empty">
                <b>{scopeEmpty ? "No frames here yet" : "Nothing to show"}</b>
                {scopeEmpty
                  ? `${headTitle}${style ? ` · ${style.label}` : ""} · ${shownVersion?.label ?? ""}`
                  : "No frame matches this filter"}
                {!scopeEmpty ? (
                  <div style={{ marginTop: 16 }}>
                    <button type="button" className="rv-btn" onClick={() => onFilter("all")}>Show all frames</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Grid
                groups={groups}
                marks={marks}
                people={people}
                selected={selected}
                mediaBase={page.mediaBase}
                canVote={canVote}
                isOwner={isOwner}
                size={view.size}
                targetRef={targetRef}
                onAct={onAct}
                onOpen={openFrame}
                onToggle={toggleSelect}
                onRange={rangeSelect}
                onBox={boxSelect}
                onClear={clearSelection}
                onSelectGroup={groups.length > 1 ? selectMany : undefined}
              />
            )}
          </div>
        </main>
      </div>

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          canVote={canVote}
          onLike={() => applyVerdict(selectedIds, "like")}
          onDislike={() => applyVerdict(selectedIds, "dislike")}
          onComment={commentAll}
          onDownload={() => downloadFrames(reviewBase(), selectedIds)}
          onClear={clearSelection}
          composeSignal={composeSignal}
          ownerTools={
            isOwner ? (
              <Suspense fallback={null}>
                <BulkOwnerTools
                  slug={slug}
                  itemIds={selectedItemIds}
                  codes={selectedCodes}
                  folders={index.folders}
                  styles={page.styles}
                  shown={shownVersion}
                  current={currentVersion}
                  audience={audience}
                  onDone={clearSelection}
                  onToast={toast}
                />
              </Suspense>
            ) : undefined
          }
        />
      ) : null}

      {isOwner && !openItem ? (
        <Suspense fallback={null}>
          <ListsDock lists={lists} viewing={listView} codeOf={codeOf} onRename={renameList} onView={onViewList} onToast={toast} />
        </Suspense>
      ) : null}

      {isOwner && removingStyle ? (
        <Suspense fallback={null}>
          <RemoveStyleDialog
            slug={slug}
            style={removingStyle}
            shown={shownVersion}
            current={currentVersion}
            audience={audience}
            onClose={() => setRemovingStyle(null)}
            onToast={toast}
          />
        </Suspense>
      ) : null}

      {isPreview && !openItem ? (
        <div className="rv-preview" role="status">
          <span>You&apos;re seeing what {audience.name} sees</span>
          <button type="button" className="rv-btn" onClick={exitPreview}>Exit</button>
        </div>
      ) : null}

      {openItem ? (
        <Suspense fallback={null}>
          <Lightbox
            slug={slug}
            item={openItem}
            position={openPosition}
            total={lightboxIds.length}
            prev={openPosition > 0 ? index.byAsset.get(lightboxIds[openPosition - 1]!) : undefined}
            next={openPosition < lightboxIds.length - 1 ? index.byAsset.get(lightboxIds[openPosition + 1]!) : undefined}
            mediaBase={page.mediaBase}
            folderName={index.folderById.get(openItem.folderId)?.name ?? ""}
            styleLabel={page.styles.find((row) => row.id === openItem.styleId)?.label}
            sectionLabel={SECTION_SINGULAR[index.folderById.get(openItem.folderId)?.section ?? view.section]}
            roundLabel={shownVersion?.label}
            mine={mineOf(openItem.assetId)}
            verdicts={openVerdicts}
            people={people}
            canVote={canVote}
            isOwner={isOwner}
            viewerName={viewerName}
            viewerWho={me?.who}
            lists={isOwner ? lists : undefined}
            onList={isOwner ? (key) => toggleList(key, [openItem.assetId]) : undefined}
            focusComment={lightbox.focus}
            onVerdict={(verdict) => applyVerdict([openItem.assetId], verdict)}
            onNav={navFrame}
            onClose={closeFrame}
            onDownload={() => downloadFrames(reviewBase(), [openItem.assetId])}
            onToast={toast}
          />
        </Suspense>
      ) : null}

      {flashes.map((row) => (
        <div
          key={row.key}
          className={`rv-flash ${row.tone === "plain" ? "" : row.tone}`}
          style={{ left: row.x, top: row.y, ...(row.color ? { "--c": row.color } : {}) } as React.CSSProperties}
        >
          {row.label}
        </div>
      ))}
      {toasts.length ? (
        <div className="rv-toasts" role="status">
          {toasts.map((row) => (
            <div key={row.key} className={`rv-toast${row.error ? " err" : ""}`}>{row.text}</div>
          ))}
        </div>
      ) : null}

      {lostAccess ? (
        <div className="rv-dialog-back">
          <div className="rv-pop rv-dialog">
            <h4>Signed out</h4>
            <p>This account cannot open the review any more. Sign in again to keep looking.</p>
            <div className="row">
              <button type="button" className="rv-btn solid" onClick={() => window.location.reload()}>Sign in again</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
