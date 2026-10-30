"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQueries, useQuery } from "convex/react";
import { BookOpen, Check, Copy, Play, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseStorybookRecord, type ReaderModel } from "@/lib/storybook-reader";
import { ReaderChips, StorybookReader, type ReaderAsset } from "./storybook-reader";

type StorybookModalProps = {
  ownerUserId: string;
  /** Folder id of the open storybook, or null when closed. */
  storybookId: string | null;
  /** The world this storybook is a child of: the eyebrow reads World › Storybook. */
  worldName?: string;
  /** Opens the detail panel on a piece (the address gains ?asset=<id>). */
  onOpenAsset?: (assetId: string) => void;
  /** True while another layer (the detail panel) owns Escape. */
  suspended?: boolean;
  onClose: () => void;
};

type LightboxItem = {
  id: string;
  src: string;
  kind?: "image" | "video";
};

const AUTOSAVE_DELAY_MS = 900;
// Pieces the record cites that are not on the shelf, fetched for their thumbs.
const LOOKUP_LIMIT = 24;

type ShelfAsset = {
  _id: string;
  kind: "image" | "video";
  url?: string;
  thumbUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  fileName?: string;
  promptText?: string;
  agentDescription?: string;
  description?: string;
  tagNames?: string[];
};

const toReaderAsset = (asset: ShelfAsset): ReaderAsset => ({
  id: asset._id,
  thumbSrc: asset.thumbUrl ?? asset.url ?? asset.sourceUrl ?? null,
  fullSrc: asset.url ?? asset.sourceUrl ?? asset.thumbUrl ?? null,
  kind: asset.kind,
  width: asset.width,
  height: asset.height,
  notes: [asset.agentDescription, asset.description, asset.fileName].filter(Boolean).join("\n"),
  tagNames: asset.tagNames,
  caption: asset.agentDescription ?? asset.description ?? asset.promptText ?? null,
});

/**
 * Expanded storybook view. The record (folder description + script Story)
 * is read as blocks: status, gaps, beats with their frames, cast, locations,
 * props, sources. "Raw" shows the verbatim text and is where it is edited;
 * the title is edited in place either way (autosaved to the folder).
 */
export function StorybookModal({
  ownerUserId,
  storybookId,
  worldName,
  onOpenAsset,
  suspended = false,
  onClose,
}: StorybookModalProps) {
  const storybook = useQuery(
    api.storybooks.getStorybook,
    storybookId
      ? { ownerUserId, folderId: storybookId as Id<"folders"> }
      : "skip",
  );
  // The script Story attached to this book. listStories has no storybook
  // filter, so the scripts are read once per open and matched here.
  const scripts = useQuery(
    api.stories.listStories,
    storybookId ? { ownerUserId, kind: "script", limit: 500 } : "skip",
  );
  const updateFolderMutation = useMutation(api.folders.updateFolder);

  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [mode, setMode] = useState<"read" | "raw">("read");
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  // Seed the editors once per opened storybook — later query re-emits (e.g.
  // from our own saves) must not clobber in-progress typing.
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!storybookId) {
      seededForRef.current = null;
      setSaveState("idle");
      setLightbox(null);
      setMode("read");
      return;
    }
    if (!storybook || seededForRef.current === storybookId) return;
    seededForRef.current = storybookId;
    setTitle(storybook.folder.name);
    setStory(storybook.folder.story ?? "");
    // An empty record has nothing to read: open on the editor.
    setMode(storybook.folder.story?.trim() ? "read" : "raw");
  }, [storybook, storybookId]);

  const latestDraftRef = useRef({ title: "", story: "" });
  latestDraftRef.current = { title, story };
  const savedRef = useRef({ title: "", story: "" });
  useEffect(() => {
    if (storybook && seededForRef.current === storybookId) {
      savedRef.current = {
        title: storybook.folder.name,
        story: storybook.folder.story ?? "",
      };
    }
    // Only re-anchor when a storybook loads; keystrokes shouldn't touch this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storybook?.folder._id]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async () => {
    if (!storybookId) return;
    const draft = latestDraftRef.current;
    const nextName = draft.title.trim();
    // An empty name would fail the backend guard — keep typing state local
    // and retry on the next edit instead of surfacing a hard error.
    if (!nextName) return;
    if (
      nextName === savedRef.current.title.trim() &&
      draft.story === savedRef.current.story
    ) {
      return;
    }
    setSaveState("saving");
    try {
      await updateFolderMutation({
        ownerUserId,
        folderId: storybookId as Id<"folders">,
        name: nextName,
        description: draft.story,
      });
      savedRef.current = { title: nextName, story: draft.story };
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [ownerUserId, storybookId, updateFolderMutation]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);
  }, [persist]);

  // Flush pending edits when the modal closes or unmounts.
  const closeAndFlush = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void persist();
    onClose();
  }, [onClose, persist]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Lock body scroll + Escape handling (lightbox closes first).
  useEffect(() => {
    if (!storybookId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [storybookId]);

  useEffect(() => {
    if (!storybookId || suspended) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (lightbox) {
        setLightbox(null);
      } else {
        closeAndFlush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [storybookId, suspended, lightbox, closeAndFlush]);

  // Auto-grow the story textarea to its content (and re-fit on resize —
  // wrap width changes invalidate the measured scrollHeight).
  const storyRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const fit = () => {
      const el = storyRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [story, storybook, mode]);

  const assets = useMemo(() => storybook?.assets ?? [], [storybook]);

  const script = useMemo(() => {
    if (!storybookId || !scripts) return null;
    return (
      scripts.find((row) => row.storybookId === storybookId) ??
      scripts.find((row) => row.folderId === storybookId) ??
      null
    );
  }, [scripts, storybookId]);

  // The reader reads the saved record, not the draft being typed: a half
  // edit in Raw must not reflow the blocks under the cursor.
  const savedStory = storybook?.folder.story ?? "";
  const model = useMemo<ReaderModel | null>(() => {
    if (!storybook) return null;
    return parseStorybookRecord({
      name: storybook.folder.name,
      description: savedStory,
      worldName: worldName ?? null,
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
  }, [savedStory, script, storybook, worldName]);

  const frames = useMemo<ReaderAsset[]>(
    () => assets.map((asset) => toReaderAsset(asset as ShelfAsset)),
    [assets],
  );

  // Pieces named in the text that are not on the shelf (a character sheet,
  // a plate in its own shelf): fetched for their thumbnails.
  const missingIds = useMemo(() => {
    if (!model) return [] as string[];
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
    for (const frame of frames) map.set(frame.id, frame);
    for (const id of missingIds) {
      const row = lookups[id];
      if (row && !(row instanceof Error)) map.set(id, toReaderAsset(row as ShelfAsset));
    }
    return map;
  }, [frames, lookups, missingIds]);

  const openAsset = useCallback(
    (assetId: string) => {
      if (onOpenAsset) {
        onOpenAsset(assetId);
        return;
      }
      const piece = lookup.get(assetId);
      if (piece?.fullSrc) setLightbox({ id: assetId, src: piece.fullSrc, kind: piece.kind });
    },
    [lookup, onOpenAsset],
  );

  const copyRaw = useCallback(async () => {
    const text = [savedStory, script ? `\n\n--- script story:${script._id} ---\n${script.body}` : ""].join("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard can be blocked; the text stays on screen */
    }
  }, [savedStory, script]);

  const cover = frames[0] ?? null;

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed — edit to retry"
          : "";

  if (!storybookId) return null;

  const modeButton = (value: "read" | "raw", label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-[0.16em] transition-colors"
      style={{
        color: mode === value ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)",
        backgroundColor: mode === value ? "var(--lm-surface-2)" : "transparent",
        borderRadius: "999px",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain"
      onClick={closeAndFlush}
      aria-modal="true"
      role="dialog"
      aria-label={storybook?.folder.name ?? "Storybook"}
      style={{
        backgroundColor: "var(--lm-overlay-canvas)",
        // Pure-opacity fade only: a lingering transform (e.g. a
        // fill-mode:forwards translateY) would turn this scrolling
        // backdrop into the containing block for the fixed close button.
        animation: "fade-in var(--duration-fast) ease-out",
      }}
    >
      <div
        className="mx-auto min-h-full w-full max-w-6xl px-4 pb-24 pt-12 md:px-10 md:pt-14"
        onClick={(event) => event.stopPropagation()}
        style={{
          animation: "fade-in-up var(--duration-normal) ease-out",
        }}
      >
        {/* Cover — the shelf's first frame, kept in view at the top. */}
        {cover?.thumbSrc && (
          <button
            type="button"
            onClick={() => openAsset(cover.id)}
            className="relative mb-6 block w-full overflow-hidden text-left"
            style={{
              borderRadius: "14px",
              border: "1px solid var(--lm-border)",
              backgroundColor: "var(--lm-surface-2)",
              maxHeight: "48vh",
            }}
            aria-label="Open the cover frame"
          >
            {/* The thumb (1440 px) paints at once; the full PNG can be 7 MB. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.thumbSrc}
              alt={cover.caption ?? ""}
              className="block w-full object-cover"
              style={{
                aspectRatio: cover.width && cover.height ? `${Math.max(cover.width / cover.height, 1.2)} / 1` : "16 / 9",
                maxHeight: "48vh",
              }}
            />
            {cover.kind === "video" && (
              <span className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center" style={{ borderRadius: "8px", backgroundColor: "rgba(0,0,0,0.65)", color: "#FFF4EA" }}>
                <Play className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        )}

        {/* Header — eyebrow, editable title, status chips. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span
            className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.2em]"
            style={{ color: "var(--coral)" }}
          >
            <BookOpen className="h-3 w-3" />
            {(worldName || model?.world) && (
              <span style={{ color: "var(--text-secondary)" }}>
                {worldName ?? model?.world} ›
              </span>
            )}
            Storybook
            {storybook && (
              <span style={{ color: "var(--text-tertiary)" }}>
                · {assets.length} {assets.length === 1 ? "frame" : "frames"}
              </span>
            )}
          </span>
          <div className="flex items-center gap-3">
            <span
              className="text-[9px] font-mono uppercase tracking-[0.14em]"
              style={{
                color:
                  saveState === "error"
                    ? "var(--coral)"
                    : "var(--text-ghost)",
              }}
              aria-live="polite"
            >
              {saveLabel}
            </span>
            <div
              className="flex items-center gap-0.5 p-0.5"
              role="group"
              aria-label="Reader mode"
              style={{ borderRadius: "999px", border: "1px solid var(--lm-border)" }}
            >
              {modeButton("read", "Read")}
              {modeButton("raw", "Raw")}
            </div>
          </div>
        </div>

        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSaveState("idle");
            scheduleSave();
          }}
          onBlur={() => void persist()}
          placeholder="Storybook title"
          aria-label="Storybook title"
          className="mt-3 w-full bg-transparent font-black uppercase leading-tight outline-none"
          style={{
            fontSize: "clamp(26px, 4vw, 42px)",
            letterSpacing: "0.04em",
            color: "var(--lm-text-primary)",
            caretColor: "var(--coral)",
          }}
        />

        {model && (
          <div className="mt-3">
            <ReaderChips model={model} />
          </div>
        )}

        <div
          className="mb-8 mt-6"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        />

        {storybook === undefined ? (
          <p
            className="py-16 text-center text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Loading storybook…
          </p>
        ) : mode === "raw" || !model ? (
          <div className="flex flex-col gap-8">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: "var(--lm-text-tertiary)" }}>
                  Record · folder description
                </span>
                <button
                  type="button"
                  onClick={() => void copyRaw()}
                  className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-[0.16em] transition-colors hover:text-[var(--lm-text-primary)]"
                  style={{ color: copied ? "#79B791" : "var(--lm-text-tertiary)" }}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                ref={storyRef}
                value={story}
                onChange={(event) => {
                  setStory(event.target.value);
                  setSaveState("idle");
                  scheduleSave();
                }}
                onBlur={() => void persist()}
                placeholder="Write the story — the logline, the beats, what unites these images."
                aria-label="Storybook story"
                rows={4}
                className="w-full resize-none bg-transparent font-mono text-[13px] leading-[1.7] outline-none"
                style={{
                  color: "var(--lm-text-secondary)",
                  caretColor: "var(--coral)",
                  minHeight: "96px",
                }}
              />
            </div>
            {script && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: "var(--lm-text-tertiary)" }}>
                    Script · story:{script._id}
                  </span>
                  <a href={`/stories/${script._id}`} className="text-[9px] font-mono font-bold uppercase tracking-[0.16em] hover:text-[var(--lm-text-primary)]" style={{ color: "var(--coral)" }}>
                    Open
                  </a>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-[1.7]" style={{ color: "var(--lm-text-secondary)" }}>
                  {[script.logline ? `Logline: ${script.logline}` : null, script.hook ? `Hook: ${script.hook}` : null, "", script.body].filter((line) => line !== null).join("\n")}
                </pre>
              </div>
            )}
            {assets.length > 0 && (
              <div>
                <span className="mb-2 block text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: "var(--lm-text-tertiary)" }}>
                  Shelf · {assets.length} {assets.length === 1 ? "frame" : "frames"}
                </span>
                <div className="columns-2 gap-3 md:columns-3 lg:columns-4 [&>*]:mb-3">
                  {frames.map((frame) =>
                    frame.thumbSrc ? (
                      <button
                        key={frame.id}
                        type="button"
                        onClick={() => openAsset(frame.id)}
                        className="block w-full overflow-hidden text-left transition-opacity hover:opacity-95"
                        style={{ breakInside: "avoid", borderRadius: "10px", border: "1px solid var(--lm-border)", backgroundColor: "var(--lm-surface-2)" }}
                        aria-label={frame.caption ?? "Storybook frame"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={frame.thumbSrc} alt="" className="block w-full" loading="lazy" style={{ aspectRatio: frame.width && frame.height ? `${frame.width} / ${frame.height}` : undefined }} />
                        <span className="block px-2 py-1 text-[9px] font-mono" style={{ color: "var(--lm-text-tertiary)" }}>
                          asset:{frame.id}
                        </span>
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <StorybookReader model={model} frames={frames} lookup={lookup} onOpenAsset={openAsset} />
            {assets.length === 0 && (
              <p
                className="py-16 text-center text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                No frames yet — drag images onto this storybook in the sidebar,
                or use a card&apos;s collection menu.
              </p>
            )}
          </>
        )}
      </div>

      {/* Close — sticky top-right. */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          closeAndFlush();
        }}
        aria-label="Close storybook"
        className="fixed right-4 top-4 z-20 flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-100 md:right-5 md:top-5"
        style={{ color: "var(--lm-text-tertiary)", opacity: 0.85, borderRadius: "999px", backgroundColor: "var(--lm-overlay-canvas)" }}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Lightbox — used when no detail panel is wired in. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(8, 6, 4, 0.92)" }}
          onClick={(event) => {
            event.stopPropagation();
            setLightbox(null);
          }}
          role="presentation"
        >
          {lightbox.kind === "video" ? (
            <video
              src={lightbox.src}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full"
              style={{ borderRadius: "8px" }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.src}
              alt=""
              className="max-h-full max-w-full object-contain"
              style={{ borderRadius: "8px" }}
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
