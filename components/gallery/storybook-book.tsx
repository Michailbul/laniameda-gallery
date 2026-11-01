"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Copy } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buildGridImageAttrs } from "@/lib/grid-image";
import { storybookStatusLabel } from "@/lib/storybook-meta";
import { parseStorybookRecord, placeFrames, type ReaderModel } from "@/lib/storybook-reader";
import { StorybookText, type ReaderAsset } from "./storybook-reader";
import type { ShelfEntry } from "./storybook-shelf";

// One open storybook, below the cover strip. Board (default): the book's
// frames as bare masonry, one section per beat in story order. Story: the
// record read as text. Agent's text: the record as the agents wrote it, where
// it is edited. A frame opens the gallery's own detail panel.

type StorybookData = NonNullable<FunctionReturnType<typeof api.storybooks.getStorybook>>;
type StorybookAsset = StorybookData["assets"][number];

type BookFrame = {
  id: string;
  kind: "image" | "video";
  /** The still: the card thumb (the poster of a video). */
  src: string | null;
  srcSet?: string;
  /** The clip itself, for a video. */
  videoSrc: string | null;
  width?: number;
  height?: number;
  /** The agent's description, the owner's and the file name: "beat 3" in it ties the frame to a beat. */
  notes: string;
  tagNames: string[];
  caption: string | null;
};

type Section = {
  key: string;
  /** The beat number; null for the frames no beat names. */
  number: number | null;
  text: string;
  time: string | null;
  missing: string | null;
  frames: BookFrame[];
};

type Size = "s" | "m" | "l";
const SIZE_KEY = "lm.storybook.frameSize";
const SIZE_WIDTH: Record<Size, string> = { s: "320px", m: "520px", l: "800px" };
// What each column width asks the browser for (lib/grid-image.ts srcset).
const SIZE_SIZES: Record<Size, string> = {
  s: "(max-width: 767px) 100vw, 340px",
  m: "(max-width: 767px) 100vw, (max-width: 1500px) 50vw, 640px",
  l: "(max-width: 1100px) 100vw, 900px",
};
const AUTOSAVE_DELAY_MS = 900;
// Pieces the record cites that are not on the shelf, fetched for the Story tab.
const LOOKUP_LIMIT = 24;
const EAGER_FRAMES = 4;
const NO_TAGS: string[] = [];

const readSize = (): Size => {
  if (typeof window === "undefined") return "m";
  try {
    const stored = window.localStorage.getItem(SIZE_KEY);
    return stored === "s" || stored === "l" ? stored : "m";
  } catch {
    return "m";
  }
};

const REF = /\b(?:asset|story):[a-z0-9]{20,40}\b/g;
const CODE = /\b[A-Z]{2,4}-CH-\d{3}(?:-C\d{2})?\b/g;
/** Text with its asset/story references and character codes taken out: what Michael reads. */
const plain = (text: string) =>
  text
    .replace(REF, "")
    .replace(CODE, "")
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

const GENERIC_LABEL = /^(characters?|cast|wardrobe|costumes?|locations?|places?|plates?|sets?|props?|sheets?|notes?|style)$/i;
/** A cast/location label as a chip name, or null when it is not a name. */
const chipName = (label: string | null): string | null => {
  if (!label) return null;
  const clean = plain(label).replace(/[()[\]]/g, "").trim();
  if (!clean || clean.length > 26 || GENERIC_LABEL.test(clean)) return null;
  return clean;
};
/** A look token as words; slugs like "da-film" are codes. */
const isSlug = (token: string) => /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(token);

const toFrame = (asset: StorybookAsset): BookFrame => {
  const still = asset.thumbUrl ?? (asset.kind === "image" ? asset.url : undefined) ?? null;
  // The original never goes in the srcset: the thumb is sharp enough for the
  // widest column, and an original can be a 7 MB PNG.
  const attrs = still
    ? buildGridImageAttrs({ src: still, variants: asset.thumbVariants, thumbSrc: asset.thumbUrl, thumbWidth: asset.thumbWidth })
    : null;
  return {
    id: asset._id,
    kind: asset.kind,
    src: attrs?.src ?? null,
    srcSet: attrs?.srcSet,
    videoSrc: asset.kind === "video" ? (asset.url ?? null) : null,
    width: asset.width ?? asset.thumbWidth,
    height: asset.height ?? asset.thumbHeight,
    notes: [asset.agentDescription, asset.description, asset.fileName].filter(Boolean).join("\n"),
    tagNames: asset.tagNames,
    caption: asset.agentDescription ?? asset.description ?? asset.promptText ?? null,
  };
};

/* ── A frame ────────────────────────────────────────────────────────────── */

const startMuted = (video: HTMLVideoElement | null) => {
  if (!video) return;
  video.muted = true;
  void video.play().catch(() => {});
};

const Frame = memo(function Frame({
  frame,
  tags,
  sizes,
  eager,
  flash,
  onOpen,
  onHover,
}: {
  frame: BookFrame;
  tags: string[];
  sizes: string;
  eager: boolean;
  flash: string | null;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const [live, setLive] = useState(false);
  const stillVideoRef = useRef<HTMLVideoElement | null>(null);
  const isVideo = frame.kind === "video" && Boolean(frame.videoSrc);
  const enter = () => {
    onHover(frame.id);
    if (!isVideo) return;
    if (frame.src) setLive(true);
    else void stillVideoRef.current?.play().catch(() => {});
  };
  const leave = () => {
    onHover(null);
    if (!isVideo) return;
    setLive(false);
    const still = stillVideoRef.current;
    if (still) {
      still.pause();
      still.currentTime = 0;
    }
  };
  return (
    <button
      type="button"
      className="lm-sb-frame"
      onClick={() => onOpen(frame.id)}
      onPointerEnter={enter}
      onPointerLeave={leave}
      aria-label={frame.caption ? `Open frame: ${frame.caption.slice(0, 120)}` : "Open frame"}
    >
      {frame.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- srcset over R2 renditions, see lib/grid-image.ts
        <img
          src={frame.src}
          srcSet={frame.srcSet}
          sizes={frame.srcSet ? sizes : undefined}
          width={frame.width}
          height={frame.height}
          alt=""
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          decoding="async"
        />
      ) : frame.videoSrc ? (
        <video
          ref={stillVideoRef}
          className="still"
          src={frame.videoSrc}
          width={frame.width}
          height={frame.height}
          muted
          loop
          playsInline
          preload="metadata"
        />
      ) : (
        <span className="lm-sb-empty" style={{ display: "block", border: 0 }}>No preview</span>
      )}
      {live && frame.videoSrc ? (
        // Started from code: React sets `muted` as a property, and autoplay
        // alone is refused without the attribute.
        <video
          ref={startMuted}
          className="live"
          src={frame.videoSrc}
          poster={frame.src ?? undefined}
          muted
          loop
          playsInline
          onCanPlay={(event) => void event.currentTarget.play().catch(() => {})}
        />
      ) : null}
      {tags.length > 0 ? (
        <span className="lm-sb-tags">
          {tags.map((tag) => (
            <span key={tag} className="lm-sb-tag">{tag}</span>
          ))}
        </span>
      ) : null}
      {flash ? <span key={flash} className="lm-sb-flash">{flash.split("|")[0]}</span> : null}
    </button>
  );
});

/* ── The Story tab: cited pieces become chips ───────────────────────────── */

function StoryTab({
  ownerUserId,
  model,
  frames,
  onOpenAsset,
}: {
  ownerUserId: string;
  model: ReaderModel;
  frames: BookFrame[];
  onOpenAsset: (id: string) => void;
}) {
  const missingIds = useMemo(() => {
    const onShelf = new Set(frames.map((frame) => frame.id));
    return model.assetIds.filter((id) => !onShelf.has(id)).slice(0, LOOKUP_LIMIT);
  }, [frames, model]);
  const lookups = useQueries(
    useMemo(
      () =>
        Object.fromEntries(
          missingIds.map((id) => [
            id,
            { query: api.assets.getGalleryAsset, args: { id: id as Id<"assets">, ownerUserId } },
          ]),
        ),
      [missingIds, ownerUserId],
    ),
  );
  const lookup = useMemo(() => {
    const map = new Map<string, ReaderAsset>();
    for (const frame of frames) map.set(frame.id, { id: frame.id, thumbSrc: frame.src, caption: frame.caption });
    for (const id of missingIds) {
      const row = lookups[id] as { thumbUrl?: string; url?: string; agentDescription?: string; promptText?: string } | null | undefined | Error;
      if (row && !(row instanceof Error)) {
        map.set(id, { id, thumbSrc: row.thumbUrl ?? row.url ?? null, caption: row.agentDescription ?? row.promptText ?? null });
      }
    }
    return map;
  }, [frames, lookups, missingIds]);
  return <StorybookText model={model} lookup={lookup} onOpenAsset={onOpenAsset} />;
}

/* ── The Agent's text tab: the record, edited in place ──────────────────── */

type Script = { _id: string; title: string; body: string; logline?: string; hook?: string };

function AgentText({
  ownerUserId,
  storybookId,
  savedName,
  savedStory,
  script,
}: {
  ownerUserId: string;
  storybookId: string;
  savedName: string;
  savedStory: string;
  script: Script | null;
}) {
  const updateFolder = useMutation(api.folders.updateFolder);
  const [title, setTitle] = useState(savedName);
  const [story, setStory] = useState(savedStory);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  // What is typed, for the save that runs after the component is gone.
  const draftRef = useRef({ title: savedName, story: savedStory });
  const savedRef = useRef({ title: savedName, story: savedStory });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async () => {
    const name = draftRef.current.title.trim();
    // An empty name would fail the backend guard: keep typing, save on the next edit.
    if (!name) return;
    if (name === savedRef.current.title.trim() && draftRef.current.story === savedRef.current.story) return;
    setSaveState("saving");
    try {
      await updateFolder({ ownerUserId, folderId: storybookId as Id<"folders">, name, description: draftRef.current.story });
      savedRef.current = { title: name, story: draftRef.current.story };
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [ownerUserId, storybookId, updateFolder]);

  const schedule = () => {
    setSaveState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
  };

  // Leaving the tab or the book saves what was typed.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void persist();
    },
    [persist],
  );

  // The textarea grows with its text.
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const fit = () => {
      const area = areaRef.current;
      if (!area) return;
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [story]);

  const copy = async () => {
    const text = [story, script ? `\n\n--- script story:${script._id} ---\n${script.body}` : ""].join("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard can be blocked; the text stays on screen */
    }
  };

  const label = "text-[9.5px] font-mono font-bold uppercase tracking-[0.18em]";
  return (
    <div className="flex max-w-[960px] flex-col gap-8">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className={label} style={{ color: "var(--lm-text-tertiary)" }}>
            What the agents wrote · edits save by themselves
          </span>
          <span className="flex items-center gap-3">
            <span
              className={label}
              aria-live="polite"
              style={{ color: saveState === "error" ? "var(--lm-coral)" : "var(--lm-text-ghost)" }}
            >
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed, edit to retry" : ""}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className={`${label} flex items-center gap-1 transition-colors hover:text-[var(--lm-text-primary)]`}
              style={{ color: copied ? "#79B791" : "var(--lm-text-tertiary)" }}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </div>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            draftRef.current = { ...draftRef.current, title: event.target.value };
            schedule();
          }}
          onBlur={() => void persist()}
          aria-label="Storybook name"
          placeholder="Storybook name"
          className="mb-3 w-full bg-transparent font-mono text-[13px] font-bold uppercase tracking-[0.08em] outline-none"
          style={{ color: "var(--lm-text-primary)", caretColor: "var(--lm-coral)", borderBottom: "1px solid var(--lm-border)", paddingBottom: 8 }}
        />
        <textarea
          ref={areaRef}
          value={story}
          onChange={(event) => {
            setStory(event.target.value);
            draftRef.current = { ...draftRef.current, story: event.target.value };
            schedule();
          }}
          onBlur={() => void persist()}
          placeholder="Write the story: the logline, the beats, what unites these images."
          aria-label="Storybook story"
          rows={4}
          className="w-full resize-none bg-transparent font-mono text-[13px] leading-[1.7] outline-none"
          style={{ color: "var(--lm-text-secondary)", caretColor: "var(--lm-coral)", minHeight: 96 }}
        />
      </div>
      {script ? (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className={label} style={{ color: "var(--lm-text-tertiary)" }}>
              Script · {script.title}
            </span>
            <a href={`/stories/${script._id}`} className={`${label} hover:text-[var(--lm-text-primary)]`} style={{ color: "var(--lm-coral)" }}>
              Open
            </a>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-[1.7]" style={{ color: "var(--lm-text-secondary)" }}>
            {[script.logline ? `Logline: ${script.logline}` : null, script.hook ? `Hook: ${script.hook}` : null, "", script.body]
              .filter((line) => line !== null)
              .join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/* ── The book ───────────────────────────────────────────────────────────── */

export function StorybookBook({
  ownerUserId,
  storybookId,
  entry,
  onOpenAsset,
  suspended,
}: {
  ownerUserId: string;
  storybookId: string;
  /** The book's row from the list: title and status before the book loads. */
  entry?: ShelfEntry;
  onOpenAsset: (assetId: string) => void;
  suspended: boolean;
}) {
  const storybook = useQuery(api.storybooks.getStorybook, {
    ownerUserId,
    folderId: storybookId as Id<"folders">,
  });
  // The script Story attached to this book. listStories has no storybook
  // filter, so the scripts are read once and matched here.
  const scripts = useQuery(api.stories.listStories, { ownerUserId, kind: "script", limit: 500 });

  const [mode, setMode] = useState<"board" | "story" | "agent">("board");
  const [section, setSection] = useState("all");
  const [size, setSize] = useState<Size>(readSize);
  const [idCopied, setIdCopied] = useState(false);
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);
  const hoveredRef = useRef<string | null>(null);

  const script = useMemo(() => {
    if (!scripts) return null;
    return scripts.find((row) => row.storybookId === storybookId) ?? scripts.find((row) => row.folderId === storybookId) ?? null;
  }, [scripts, storybookId]);

  const worldName = entry && entry.meta.world !== entry.meta.title ? entry.meta.world : null;
  const model = useMemo<ReaderModel | null>(() => {
    if (!storybook) return null;
    return parseStorybookRecord({
      name: storybook.folder.name,
      description: storybook.folder.story ?? "",
      worldName,
      script: script
        ? {
            title: script.title,
            logline: script.logline,
            hook: script.hook,
            body: script.body,
            assetIds: script.assetIds as string[],
            styleTag: script.styleTag,
          }
        : null,
    });
  }, [script, storybook, worldName]);

  const frames = useMemo(() => (storybook?.assets ?? []).map(toFrame), [storybook]);

  const sections = useMemo<Section[]>(() => {
    if (!model) return [];
    if (model.beats.length === 0) {
      return frames.length > 0
        ? [{ key: "frames", number: null, text: "", time: null, missing: null, frames }]
        : [];
    }
    const placement = placeFrames(model, frames);
    const out: Section[] = model.beats.map((beat) => ({
      key: `beat-${beat.number}`,
      number: beat.number,
      text: plain(beat.text),
      time: beat.time,
      missing: beat.missing ? plain(beat.missing) : null,
      frames: placement.byBeat.get(beat.number) ?? [],
    }));
    const rest = [...placement.plates, ...placement.strip];
    if (rest.length > 0) {
      out.push({ key: "other", number: null, text: "", time: null, missing: null, frames: rest });
    }
    return out;
  }, [frames, model]);

  // Chips on a frame: the cast or location name the record gives it.
  const tagsById = useMemo(() => {
    const names = new Map<string, string[]>();
    if (!model) return names;
    for (const item of [...model.cast, ...model.locations, ...model.props]) {
      const name = chipName(item.label);
      if (!name) continue;
      for (const id of item.assetIds) {
        const list = names.get(id) ?? [];
        if (!list.includes(name) && list.length < 2) list.push(name);
        names.set(id, list);
      }
    }
    const out = new Map<string, string[]>();
    for (const frame of frames) {
      const tags = [...(names.get(frame.id) ?? [])];
      if (tags.length === 0) {
        if (frame.tagNames.some((tag) => /^character$/i.test(tag))) tags.push("Sheet");
        else if (frame.tagNames.some((tag) => /^location$/i.test(tag))) tags.push("Plate");
      }
      if (frame.kind === "video") tags.push("Video");
      out.set(frame.id, tags);
    }
    return out;
  }, [frames, model]);

  const shown = useMemo(
    () => (section === "all" ? sections : sections.filter((entry) => entry.key === section)),
    [section, sections],
  );
  // The first frames on screen load at once; the rest when they come near.
  const eagerIds = useMemo(
    () => new Set(shown.flatMap((entry) => entry.frames.map((frame) => frame.id)).slice(0, EAGER_FRAMES)),
    [shown],
  );

  const changeSize = (next: Size) => {
    setSize(next);
    try {
      window.localStorage.setItem(SIZE_KEY, next);
    } catch {
      /* the choice just lasts this visit */
    }
  };

  const showFlash = useCallback((id: string, text: string) => {
    setFlash({ id, text: `${text}|${Date.now()}` });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 950);
    return () => clearTimeout(timer);
  }, [flash]);

  const onHover = useCallback((id: string | null) => {
    hoveredRef.current = id;
  }, []);

  // Keys on the hovered frame: O opens it, I copies its ID.
  useEffect(() => {
    if (mode !== "board" || suspended) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const id = hoveredRef.current;
      if (!id) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        onOpenAsset(id);
      } else if (key === "i") {
        event.preventDefault();
        navigator.clipboard.writeText(id).then(
          () => showFlash(id, "ID copied"),
          () => showFlash(id, "Copy blocked"),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onOpenAsset, showFlash, suspended]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(storybookId);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  if (storybook === null) {
    return (
      <div className="lm-sb-book">
        <p className="lm-sb-empty">This storybook is not in your gallery any more.</p>
      </div>
    );
  }

  const title = model?.title ?? entry?.meta.title ?? "";
  const status = model
    ? { status: model.status, gaps: model.blockingGaps ?? (model.gaps.length > 0 ? model.gaps.length : null) }
    : entry
      ? { status: entry.meta.status, gaps: entry.meta.gaps }
      : null;
  const statusChip = status ? storybookStatusLabel(status) : null;
  const frameCount = storybook ? frames.length : (entry?.book.count ?? null);
  const logline = model ? (model.logline ?? model.hook ?? model.beats[0]?.text ?? null) : (entry?.meta.hook ?? null);
  const duration = model?.duration ?? (entry?.meta.runtimeSeconds ? `${entry.meta.runtimeSeconds} s` : null);
  const medium = model?.medium ?? entry?.meta.medium ?? null;
  const world = model?.world ?? worldName;
  // Look names only: no slugs, no breadcrumbs, no long genre lines, nothing
  // that repeats the world or the title.
  const looks = (model?.look ?? []).filter((token) => {
    const lower = token.toLowerCase();
    return (
      !isSlug(token) &&
      token.length <= 28 &&
      !/[›()]/.test(token) &&
      lower !== world?.toLowerCase() &&
      lower !== title.toLowerCase()
    );
  });
  const beatCount = model?.beats.length ?? 0;

  return (
    <article className="lm-sb-book" aria-label={title}>
      <div className="lm-sb-book-top">
        <button type="button" className={`lm-sb-id${idCopied ? " done" : ""}`} onClick={() => void copyId()} title="Copy the storybook ID">
          {idCopied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {idCopied ? "Copied" : `book:…${storybookId.slice(-6)}`}
        </button>
        <div className="lm-sb-modes" role="group" aria-label="View">
          {(
            [
              ["board", "Board"],
              ["story", "Story"],
              ["agent", "Agent's text"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={`lm-sb-mode${mode === value ? " on" : ""}`}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <h1 className="lm-sb-h1">{title}</h1>
      {logline ? <p className="lm-sb-logline">{plain(logline)}</p> : null}
      <div className="lm-sb-meta">
        {frameCount !== null ? <span>{frameCount} {frameCount === 1 ? "frame" : "frames"}</span> : null}
        {beatCount > 0 ? <span>{beatCount} {beatCount === 1 ? "beat" : "beats"}</span> : null}
        {duration ? <span>{duration}</span> : null}
        {world ? <span>{world}</span> : null}
        {looks.map((look) => (
          <span key={look}>{look}</span>
        ))}
        {medium ? <span>{medium === "animated" ? "Animated" : "Live action"}</span> : null}
        {statusChip ? (
          <span className={statusChip.tone === "ghost" ? undefined : statusChip.tone}>
            {status?.status === "not-ready" && status.gaps !== null ? `Not ready · ${statusChip.text}` : statusChip.text}
          </span>
        ) : null}
      </div>
      {model && model.gaps.length > 0 ? (
        <div className="lm-sb-gaps" aria-label="What is missing">
          {model.gaps.map((gap, index) => (
            <span
              key={index}
              className="lm-sb-gap"
              title={plain([gap.summary, gap.detail].filter(Boolean).join(". "))}
            >
              {gap.kind ? <b>{gap.kind}</b> : null}
              <span>{plain(gap.summary)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {storybook === undefined ? (
        <p className="lm-sb-loading">Loading the book…</p>
      ) : mode === "story" && model ? (
        <div style={{ paddingTop: 28 }}>
          <StoryTab ownerUserId={ownerUserId} model={model} frames={frames} onOpenAsset={onOpenAsset} />
        </div>
      ) : mode === "agent" ? (
        <div style={{ paddingTop: 28 }}>
          <AgentText
            ownerUserId={ownerUserId}
            storybookId={storybookId}
            savedName={storybook.folder.name}
            savedStory={storybook.folder.story ?? ""}
            script={script ? { _id: script._id, title: script.title, body: script.body, logline: script.logline, hook: script.hook } : null}
          />
        </div>
      ) : (
        <>
          <div className="lm-sb-bar">
            <div className="lm-sb-chips" role="toolbar" aria-label="Show">
              <button
                type="button"
                aria-pressed={section === "all"}
                className={`lm-sb-chip${section === "all" ? " on" : ""}`}
                onClick={() => setSection("all")}
              >
                All <i>{frames.length}</i>
              </button>
              {sections.length > 1 || sections[0]?.number !== null
                ? sections.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      aria-pressed={section === entry.key}
                      className={`lm-sb-chip${section === entry.key ? " on" : ""}`}
                      onClick={() => setSection(section === entry.key ? "all" : entry.key)}
                    >
                      {entry.number !== null ? `Beat ${entry.number}` : "Not in a beat"} <i>{entry.frames.length}</i>
                    </button>
                  ))
                : null}
            </div>
            <span className="lm-sb-hint" aria-hidden>
              <kbd>O</kbd>open<kbd>I</kbd>copy ID
            </span>
            <div className="lm-sb-sizes" role="group" aria-label="Frame size">
              {(["s", "m", "l"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={size === value}
                  className={`lm-sb-size${size === value ? " on" : ""}`}
                  onClick={() => changeSize(value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {frames.length === 0 ? (
            <p className="lm-sb-empty" style={{ marginTop: 22 }}>
              No frames yet. Drag images onto this book&apos;s cover, or use a card&apos;s collection menu.
            </p>
          ) : null}

          {shown.map((entry) => (
            <section key={entry.key} className="lm-sb-section" aria-label={entry.number !== null ? `Beat ${entry.number}` : "Frames"}>
              {entry.key !== "frames" ? (
                <header className="lm-sb-beat-head">
                  <span className={`lm-sb-beat-n${entry.number === null ? " other" : ""}`}>
                    {entry.number ?? "Not in a beat"}
                  </span>
                  <span className="lm-sb-beat-text" title={entry.text}>
                    {entry.text}
                  </span>
                  <span className="lm-sb-beat-meta">
                    {entry.time ? `${entry.time} · ` : ""}
                    {entry.frames.length} {entry.frames.length === 1 ? "frame" : "frames"}
                    {entry.missing ? <span className="missing"> · {entry.missing}</span> : null}
                  </span>
                </header>
              ) : null}
              {entry.frames.length === 0 ? (
                <p className="lm-sb-empty">No frame for this beat yet</p>
              ) : (
                <div className="lm-sb-masonry" style={{ ["--sb-w" as string]: SIZE_WIDTH[size] }}>
                  {entry.frames.map((frame) => (
                    <Frame
                      key={`${entry.key}-${frame.id}`}
                      frame={frame}
                      tags={tagsById.get(frame.id) ?? NO_TAGS}
                      sizes={SIZE_SIZES[size]}
                      eager={eagerIds.has(frame.id)}
                      flash={flash?.id === frame.id ? flash.text : null}
                      onOpen={onOpenAsset}
                      onHover={onHover}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </article>
  );
}
