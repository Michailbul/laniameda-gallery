"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, Play, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type StorybookModalProps = {
  ownerUserId: string;
  /** Folder id of the open storybook, or null when closed. */
  storybookId: string | null;
  onClose: () => void;
};

type LightboxItem = {
  id: string;
  src: string;
  kind?: "image" | "video";
};

const AUTOSAVE_DELAY_MS = 900;

/**
 * Expanded storybook view: all member images laid out large, with the
 * storybook title and story text editable in place (autosaved to the
 * folder's name/description).
 */
export function StorybookModal({
  ownerUserId,
  storybookId,
  onClose,
}: StorybookModalProps) {
  const storybook = useQuery(
    api.storybooks.getStorybook,
    storybookId
      ? { ownerUserId, folderId: storybookId as Id<"folders"> }
      : "skip",
  );
  const updateFolderMutation = useMutation(api.folders.updateFolder);

  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
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
      return;
    }
    if (!storybook || seededForRef.current === storybookId) return;
    seededForRef.current = storybookId;
    setTitle(storybook.folder.name);
    setStory(storybook.folder.story ?? "");
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
    if (!storybookId) return;
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
  }, [storybookId, lightbox, closeAndFlush]);

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
  }, [story, storybook]);

  const assets = useMemo(() => storybook?.assets ?? [], [storybook]);

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed — edit to retry"
          : "";

  if (!storybookId) return null;

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain"
          onClick={closeAndFlush}
          aria-modal="true"
          role="dialog"
          aria-label={storybook?.folder.name ?? "Storybook"}
          style={{
            backgroundColor: "rgba(12, 10, 8, 0.97)",
            // Pure-opacity fade only: a lingering transform (e.g. a
            // fill-mode:forwards translateY) would turn this scrolling
            // backdrop into the containing block for the fixed close button.
            animation: "fade-in var(--duration-fast) ease-out",
          }}
        >
          <div
            className="mx-auto min-h-full w-full max-w-5xl px-5 pb-20 pt-14 md:px-10"
            onClick={(event) => event.stopPropagation()}
            style={{
              animation: "fade-in-up var(--duration-normal) ease-out",
            }}
          >
            {/* Header — eyebrow, editable title, editable story. Flat and
                boxless: typographic hierarchy + one hairline divider. */}
            <div className="flex items-baseline justify-between gap-4">
              <span
                className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.2em]"
                style={{ color: "var(--coral)" }}
              >
                <BookOpen className="h-3 w-3" />
                Storybook
                {storybook && (
                  <span style={{ color: "var(--text-tertiary)" }}>
                    · {assets.length} {assets.length === 1 ? "image" : "images"}
                  </span>
                )}
              </span>
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
                fontSize: "clamp(24px, 4vw, 40px)",
                letterSpacing: "0.04em",
                color: "#FFF4EA",
                caretColor: "var(--coral)",
              }}
            />

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
              rows={2}
              className="mt-4 w-full resize-none bg-transparent text-[15px] leading-[1.7] outline-none"
              style={{
                color: "rgba(240, 232, 224, 0.78)",
                caretColor: "var(--coral)",
                minHeight: "56px",
              }}
            />

            <div
              className="mb-8 mt-6"
              style={{
                borderBottom: "1px solid rgba(240, 232, 224, 0.14)",
              }}
            />

            {/* Images — expanded, simple column flow. */}
            {storybook === undefined ? (
              <p
                className="py-16 text-center text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                Loading storybook…
              </p>
            ) : assets.length === 0 ? (
              <p
                className="py-16 text-center text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                No images yet — drag images onto this storybook in the sidebar,
                or use a card&apos;s collection menu.
              </p>
            ) : (
              <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
                {assets.map((asset) => {
                  const thumb = asset.thumbUrl ?? asset.url ?? asset.sourceUrl;
                  const full = asset.url ?? asset.sourceUrl ?? thumb;
                  if (!thumb) return null;
                  const isVideo = asset.kind === "video";
                  return (
                    <button
                      key={asset._id}
                      type="button"
                      onClick={() =>
                        full &&
                        setLightbox({
                          id: asset._id,
                          src: full,
                          kind: asset.kind,
                        })
                      }
                      className="group/item relative block w-full overflow-hidden text-left transition-opacity hover:opacity-95"
                      style={{
                        breakInside: "avoid",
                        borderRadius: "12px",
                        border: "1px solid rgba(240, 232, 224, 0.12)",
                        backgroundColor: "rgba(240, 232, 224, 0.04)",
                      }}
                      aria-label={
                        asset.promptText ?? asset.fileName ?? "Storybook image"
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb}
                        alt={asset.promptText ?? asset.fileName ?? ""}
                        className="block w-full"
                        loading="lazy"
                        style={{
                          aspectRatio:
                            asset.width && asset.height
                              ? `${asset.width} / ${asset.height}`
                              : undefined,
                          objectFit: "cover",
                        }}
                      />
                      {isVideo && (
                        <span
                          className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center"
                          style={{
                            borderRadius: "8px",
                            backgroundColor: "rgba(0, 0, 0, 0.65)",
                            color: "#FFF4EA",
                          }}
                        >
                          <Play className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
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
            className="fixed right-5 top-5 z-20 flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-100"
            style={{ color: "rgba(240, 232, 224, 0.6)", opacity: 0.75 }}
          >
            <X className="h-5 w-5" />
          </button>

          {/* Lightbox — single asset enlarged inside the modal. */}
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
