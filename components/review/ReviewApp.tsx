"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SECTION_LABEL, SECTION_SINGULAR, downloadFrames, copyText, isTyping, plural, readViewState, reviewBase, shortDate, slugOf, writeViewState,
  type FeedbackFilter, type GridSize, type ReviewFeedback, type ReviewFolder, type ReviewItem, type ReviewPage, type ReviewSection,
  type ReviewVersion, type Verdict, type ViewState,
} from "@/lib/review-client";
import { Grid, type GridGroup, type TileAction, type TileMark } from "./Grid";
import { Sidebar, TopBar, type AreaGroup } from "./Chrome";
import { BulkBar } from "./BulkBar";
import { Check, ThumbDown, ThumbUp } from "./icons";

// The review page's client app. The server hands it the first round and the
// feedback (so the first paint has every frame); from then on it subscribes
// live through its own Convex client, whose identity comes from
// `${base}/api/auth/token`. Folder, style and filter changes are local and
// instant: every index is built once per round.

const Lightbox = lazy(() => import("./Lightbox"));
const RoundPanel = lazy(() => import("./OwnerTools").then((module) => ({ default: module.RoundPanel })));
const MoveTools = lazy(() => import("./OwnerTools").then((module) => ({ default: module.MoveTools })));

type Args = { versionId?: Id<"reviewVersions">; draft?: boolean };

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
const EMPTY_FEEDBACK: ReviewFeedback = { verdicts: [], comments: [], reviewers: [] };
const FILTER_KEYS: FeedbackFilter[] = ["all", "liked", "disliked", "commented", "todo", "new"];

const errorText = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^[\s\S]*ConvexError: /, "").replace(/\s+at [\s\S]*$/, "") : "That did not work.";

function buildIndex(page: ReviewPage) {
  const styleOrder = new Map(page.styles.map((row, position) => [row.id as string, position]));
  const styleBySlug = new Map(page.styles.map((row) => [slugOf(row.label), row]));
  const styleSlugById = new Map(page.styles.map((row) => [row.id as string, slugOf(row.label)]));
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
  return { styleOrder, styleBySlug, styleSlugById, folders, folderById, itemsByFolder, sectionCounts, folderCounts, areas, sections, byCode, byAsset };
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

type Flash = { key: string; x: number; y: number; label: string; tone: "teal" | "coral" | "plain"; icon?: "up" | "down" | "check" };
type Toast = { key: number; text: string; error?: boolean };
type Pending = Map<string, { verdict: Verdict | null; seq: number }>;

// ------------------------------------------------------------ the page

function Review({ slug, initialPage, initialArgs, initialFeedback, initialSearch, isDev }: Props) {
  // ---------------------------------------------------------- data
  const [args, setArgs] = useState<Args>(initialArgs);
  const argsKey = `${args.versionId ?? ""}|${args.draft ? 1 : 0}`;
  const queryArgs = useMemo(
    () => ({ slug, ...(args.versionId ? { versionId: args.versionId } : {}), ...(args.draft ? { draft: true } : {}) }),
    [slug, args.versionId, args.draft],
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
  const canVote = viewer.role !== "viewer";
  const myKey = viewer.email ?? "owner";
  const viewerName = viewer.name ?? viewer.email?.split("@")[0] ?? "You";

  const index = useMemo(() => buildIndex(page), [page]);
  const shownVersion = page.versions.find((row) => row.id === page.versionId);

  // ---------------------------------------------------------- feedback
  const seenAt = page.project.feedbackSeenAt ?? 0;
  const fb = useMemo(() => {
    const names = new Map(feedback.reviewers.map((row) => [row.email, row.name ?? row.email.split("@")[0]!]));
    const mine = new Map<string, Verdict>();
    const others = new Map<string, Array<{ name: string; verdict: Verdict; at: number }>>();
    const fresh = new Set<string>();
    for (const row of feedback.verdicts) {
      if (row.email === myKey) mine.set(row.assetId, row.verdict);
      else if (row.role !== "owner") {
        const list = others.get(row.assetId) ?? [];
        list.push({ name: names.get(row.email) ?? row.email.split("@")[0]!, verdict: row.verdict, at: row.updatedAt });
        others.set(row.assetId, list);
        if (isOwner && row.updatedAt > seenAt) fresh.add(row.assetId);
      }
    }
    const comments = new Map(feedback.comments.map((row) => [row.assetId as string, row]));
    if (isOwner) for (const row of feedback.comments) if (!row.lastByOwner && row.lastAt > seenAt) fresh.add(row.assetId);
    return { mine, others, comments, fresh };
  }, [feedback, myKey, isOwner, seenAt]);

  const [pending, setPending] = useState<Pending>(() => new Map());
  const mineOf = useCallback(
    (assetId: string) => {
      const override = pending.get(assetId);
      return override ? override.verdict ?? undefined : fb.mine.get(assetId);
    },
    [pending, fb],
  );

  const marks = useMemo(() => {
    const map = new Map<string, TileMark>();
    for (const item of page.items) {
      const id = item.assetId as string;
      const mine = mineOf(id);
      let verdict: Verdict | undefined = mine;
      let by: string | undefined;
      if (isOwner) {
        const others = fb.others.get(id) ?? [];
        const likes = others.filter((row) => row.verdict === "like");
        const dislikes = others.filter((row) => row.verdict === "dislike");
        verdict = likes.length === 0 && dislikes.length === 0 ? undefined : likes.length >= dislikes.length ? "like" : "dislike";
        const group = verdict === "like" ? likes : dislikes;
        by = group.length === 1 ? group[0]!.name : group.length > 1 ? `${group.length} reviewers` : undefined;
      }
      map.set(id, { verdict, mine, by, comments: fb.comments.get(id)?.count ?? 0, fresh: fb.fresh.has(id) });
    }
    return map;
  }, [page.items, mineOf, fb, isOwner]);

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
  const style = view.style ? index.styleBySlug.get(view.style) ?? null : null;

  const scope = useMemo(() => {
    if (folder) return index.itemsByFolder.get(folder.id) ?? [];
    return index.folders.filter((row) => row.section === view.section).flatMap((row) => index.itemsByFolder.get(row.id) ?? []);
  }, [index, folder, view.section]);

  const styleChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scope) if (item.styleId) counts.set(item.styleId, (counts.get(item.styleId) ?? 0) + 1);
    return page.styles.map((row) => ({ ...row, slug: slugOf(row.label), count: counts.get(row.id) ?? 0 }));
  }, [scope, page.styles]);

  const styled = useMemo(() => (style ? scope.filter((item) => item.styleId === style.id) : scope), [scope, style]);

  const passes = useCallback((item: ReviewItem, filter: FeedbackFilter) => {
    if (filter === "all") return true;
    const mark = marks.get(item.assetId);
    if (!mark) return false;
    if (filter === "liked") return mark.verdict === "like";
    if (filter === "disliked") return mark.verdict === "dislike";
    if (filter === "commented") return mark.comments > 0;
    if (filter === "todo") return !mark.verdict && mark.comments === 0;
    return mark.fresh;
  }, [marks]);

  const filterCounts = useMemo(() => {
    const counts = Object.fromEntries(FILTER_KEYS.map((key) => [key, 0])) as Record<FeedbackFilter, number>;
    for (const item of styled) for (const key of FILTER_KEYS) if (passes(item, key)) counts[key] += 1;
    return counts;
  }, [styled, passes]);

  // While the filter hides frames you just acted on, they stay until the view changes.
  const visible = useMemo(() => styled.filter((item) => passes(item, view.filter)), [styled, passes, view.filter]);

  const groups = useMemo<GridGroup[]>(() => {
    if (folder && !style) {
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
  }, [folder, style, visible, page.styles, index, view.section]);

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

  const flash = useCallback((ids: string[], label: string, tone: Flash["tone"], icon?: Flash["icon"]) => {
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
    setFlashes((current) => [...current, ...points.map((point, offset) => ({ ...point, key: `${batch}-${offset}`, label, tone, icon }))]);
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
    else flash(ids, next === "like" ? (ids.length > 1 ? `Liked ${ids.length}` : "Liked") : ids.length > 1 ? `Disliked ${ids.length}` : "Disliked", next === "like" ? "teal" : "coral", next === "like" ? "up" : "down");
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
  const changeView = useCallback((patch: Partial<ViewState>, opts: { clear?: boolean } = {}) => {
    setView((current) => ({ ...current, ...patch }));
    if (opts.clear) clearSelection();
  }, [clearSelection]);

  const onSection = useCallback((section: ReviewSection) => {
    const first = index.folders.find((row) => row.section === section && (index.folderCounts.get(row.id) ?? 0) > 0);
    changeView({ section, folder: first?.slug ?? "" }, { clear: true });
    window.scrollTo({ top: 0 });
  }, [index, changeView]);
  const onFolder = useCallback((slugValue: string) => {
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
  const onRound = useCallback((version: ReviewVersion | null) => {
    if (!version || (version.isCurrent && !version.isDraft)) {
      setArgs({});
      changeView({ round: "", open: "" }, { clear: true });
    } else {
      setArgs({ versionId: version.id });
      changeView({ round: version.label, open: "" }, { clear: true });
    }
  }, [changeView]);

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
      flash(ids, "Comment posted", "plain", "check");
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
        flash([assetId], `Copied ${item.code}`, "plain", "check");
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
  const keys = useRef({ open: false, targets, applyVerdict, openFrame, clearSelection, moveActive, selectedSize: 0, selectAll: () => {}, compose: () => {} });
  useEffect(() => {
    keys.current = {
      open: Boolean(view.open),
      targets,
      applyVerdict,
      openFrame,
      clearSelection,
      moveActive,
      selectedSize: selected.size,
      selectAll: () => setSelected(new Set(flatRef.current)),
      compose: () => setComposeSignal((value) => value + 1),
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keys.current;
      if (state.open || event.altKey || isTyping(event.target)) return;
      if (document.querySelector(".rv-dialog-back")) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "a") {
        event.preventDefault();
        state.selectAll();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (key === "1" || key === "2") {
        const ids = state.targets();
        if (ids.length) state.applyVerdict(ids, key === "1" ? "like" : "dislike");
      } else if (key === "c") {
        const ids = state.targets();
        if (ids.length > 1) state.compose();
        else if (ids.length === 1) {
          event.preventDefault();
          state.openFrame(ids[0]!, true);
        }
      } else if (key === "o" || key === "enter" || key === " ") {
        const id = state.targets().length === 1 ? state.targets()[0] : null;
        const hovered = id ?? null;
        if (hovered) {
          event.preventDefault();
          state.openFrame(hovered);
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
  const newInRound = useMemo(() => page.items.filter((item) => item.isNew).length, [page.items]);

  const signOut = async () => {
    await fetch(`${reviewBase()}/api/auth/logout`, { method: "POST", credentials: "same-origin" }).catch(() => null);
    window.location.reload();
  };
  const devAs = async (as: "director" | "owner") => {
    if (as === "owner") await fetch("/api/auth/dev-login", { method: "POST" }).catch(() => null);
    await fetch(`${reviewBase()}/api/dev-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) }).catch(() => null);
    window.location.reload();
  };

  // ---------------------------------------------------------- render
  const selectedIds = [...selected];
  const selectedItemIds = selectedIds.map((id) => index.byAsset.get(id)?.id).filter(Boolean) as Id<"reviewItems">[];
  const draftVersion = page.versions.find((row) => row.isDraft);
  const sectionLabel = SECTION_LABEL[view.section];
  const scopeEmpty = styled.length === 0;
  const roundNote = shownVersion && (shownVersion.title || shownVersion.note) && view.folder !== undefined ? shownVersion : null;

  const footer = (
    <>
      {isOwner ? (
        <Suspense fallback={null}>
          <RoundPanel
            slug={slug}
            versions={page.versions}
            shown={shownVersion}
            newCount={newInRound}
            itemCount={page.items.length}
            freshCount={fb.fresh.size}
            showingFresh={view.filter === "new"}
            reviewers={feedback.reviewers}
            onShowRound={onRound}
            onShowFresh={() => changeView({ filter: view.filter === "new" ? "all" : "new", folder: view.filter === "new" ? view.folder : "" })}
            onMarkRead={() => void markSeen({ slug }).then(() => toast("Feedback marked as read.")).catch((error) => toast(errorText(error), true))}
            onToast={toast}
          />
        </Suspense>
      ) : null}
      <div className="rv-who">
        <span>{isOwner ? `${viewerName} · owner` : viewer.email ?? viewerName}</span>
        {!isOwner || viewer.email ? <button type="button" onClick={() => void signOut()}>Sign out</button> : null}
      </div>
      {isDev ? (
        <div className="rv-who" style={{ borderTop: 0, paddingTop: 0 }}>
          <span>Dev</span>
          <button type="button" onClick={() => void devAs(isOwner ? "director" : "owner")}>{isOwner ? "View as test director" : "Back to owner"}</button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="rv" data-size={view.size} data-nav={navOpen ? "" : undefined}>
      <Sidebar
        title={page.project.title}
        subtitle={page.project.subtitle}
        sections={index.sections}
        section={view.section}
        sectionCounts={index.sectionCounts}
        areas={index.areas[view.section]}
        folder={folder}
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
          versions={page.versions}
          versionId={page.versionId}
          loadingRound={loadingRound}
          onRound={onRound}
          size={view.size}
          onSize={onSize}
          onMenu={() => setNavOpen(true)}
          menuLabel={folder?.name ?? `All ${sectionLabel.toLowerCase()}`}
        />

        <main className="rv-content">
          {roundNote ? (
            <div className="rv-round-note">
              <b>{roundNote.label}{roundNote.title ? ` · ${roundNote.title}` : ""}</b>
              {roundNote.note ? <span>{roundNote.note}</span> : null}
            </div>
          ) : null}
          <div className="rv-head">
            <div>
              <div className="kick">
                {folder ? `${folder.area ? `${folder.area} · ` : ""}${SECTION_SINGULAR[view.section]}` : sectionLabel}
              </div>
              <h2>{folder ? folder.name : `All ${sectionLabel.toLowerCase()}`}</h2>
            </div>
            <div className="meta">
              <b>{visible.length}</b> {visible.length === 1 ? "frame" : "frames"}
              {style ? ` · ${style.label}` : ""}
              <br />
              {shownVersion ? `${shownVersion.label}${shownVersion.isDraft ? " · draft" : shownVersion.publishedAt ? ` · ${shortDate(shownVersion.publishedAt)}` : ""}` : ""}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rv-empty">
              <b>{scopeEmpty ? "No frames here yet" : "Nothing to show"}</b>
              {scopeEmpty
                ? `${folder ? folder.name : sectionLabel}${style ? ` · ${style.label}` : ""} · ${shownVersion?.label ?? ""}`
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
        </main>
      </div>

      {selected.size === 0 ? (
        <div className="rv-keys" aria-hidden="true">
          {canVote ? (
            <>
              <span className="k-like"><kbd>1</kbd>Like</span>
              <span className="k-dis"><kbd>2</kbd>Dislike</span>
              <span><kbd>C</kbd>Comment</span>
            </>
          ) : null}
          <span><kbd>O</kbd>Open</span>
          <span><kbd>⌘</kbd>Click to select</span>
          <span><kbd>⇧</kbd>Drag a box</span>
        </div>
      ) : (
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
                <MoveTools
                  slug={slug}
                  itemIds={selectedItemIds}
                  folders={index.folders}
                  styles={page.styles}
                  isDraft={Boolean(shownVersion?.isDraft)}
                  draftLabel={draftVersion?.label}
                  onDone={clearSelection}
                  onToast={toast}
                />
              </Suspense>
            ) : undefined
          }
        />
      )}

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
            mark={{ mine: mineOf(openItem.assetId), reviewers: fb.others.get(openItem.assetId) ?? [] }}
            canVote={canVote}
            isOwner={isOwner}
            viewerName={viewerName}
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
        <div key={row.key} className={`rv-flash ${row.tone === "plain" ? "" : row.tone}`} style={{ left: row.x, top: row.y }}>
          {row.icon === "up" ? <ThumbUp /> : row.icon === "down" ? <ThumbDown /> : row.icon === "check" ? <Check /> : null}
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

