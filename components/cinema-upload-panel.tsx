"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useAction } from "convex/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";

type FileEntry = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "error";
  errorMessage?: string;
  scene?: string;
};

type Props = {
  ownerUserId: string;
  onDataChanged?: () => void;
  onClose?: () => void;
};

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read error."));
    reader.readAsDataURL(file);
  });

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cinema-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function CinemaUploadPanel({ ownerUserId, onDataChanged, onClose }: Props) {
  const ingestCinemaFrame = useAction(api.cinemaInspiration.ingestCinemaFrame);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [movieTitle, setMovieTitle] = useState("");
  const [director, setDirector] = useState("");
  const [year, setYear] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const movieInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus the movie title input on mount — keeps the flow keyboard-first.
    movieInputRef.current?.focus();
    return () => {
      entries.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIncomingFiles = useCallback((files: FileList | File[]) => {
    const accepted: File[] = Array.from(files).filter(
      (file): file is File => file instanceof File && file.type.startsWith("image/"),
    );
    if (accepted.length === 0) return;
    setEntries((previous) => [
      ...previous,
      ...accepted.map((file) => ({
        id: newId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending" as const,
      })),
    ]);
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    if (event.dataTransfer?.files?.length) {
      handleIncomingFiles(event.dataTransfer.files);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragActive(false);
    }
  };

  const removeEntry = (id: string) => {
    setEntries((previous) => {
      const removed = previous.find((entry) => entry.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return previous.filter((entry) => entry.id !== id);
    });
  };

  const updateEntry = (id: string, patch: Partial<FileEntry>) => {
    setEntries((previous) =>
      previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };

  const pendingCount = useMemo(
    () => entries.filter((entry) => entry.status === "pending").length,
    [entries],
  );

  const doneCount = useMemo(
    () => entries.filter((entry) => entry.status === "done").length,
    [entries],
  );

  const commit = useCallback(async () => {
    if (isUploading) return;
    const titleTrimmed = movieTitle.trim();
    if (!titleTrimmed) {
      setStatusMessage("Add a movie title before committing.");
      movieInputRef.current?.focus();
      return;
    }
    if (entries.length === 0) {
      setStatusMessage("Drop at least one frame first.");
      return;
    }
    setIsUploading(true);
    setStatusMessage(null);

    const yearNumber = (() => {
      const trimmed = year.trim();
      if (!trimmed) return undefined;
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    })();
    const directorTrimmed = director.trim() || undefined;

    const pending = entries.filter((entry) => entry.status !== "done");

    await Promise.all(
      pending.map(async (entry) => {
        updateEntry(entry.id, { status: "uploading", errorMessage: undefined });
        try {
          const base64 = await readAsBase64(entry.file);
          await ingestCinemaFrame({
            ownerUserId,
            base64,
            mimeType: entry.file.type || "image/jpeg",
            fileName: entry.file.name,
            ingestSource: "manual",
            cinemaMetadata: {
              movieTitle: titleTrimmed,
              director: directorTrimmed,
              year: yearNumber,
              scene: entry.scene?.trim() || undefined,
            },
          });
          updateEntry(entry.id, { status: "done" });
        } catch (error) {
          updateEntry(entry.id, {
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }),
    );

    setIsUploading(false);
    setStatusMessage(`${pending.length} frame${pending.length === 1 ? "" : "s"} saved.`);
    onDataChanged?.();
  }, [
    director,
    entries,
    ingestCinemaFrame,
    isUploading,
    movieTitle,
    onDataChanged,
    ownerUserId,
    year,
  ]);

  // Cmd/Ctrl + Enter to commit
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void commit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const hasEntries = entries.length > 0;

  return (
    <div
      data-pillar="cinema-inspiration"
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        handleDragEnter(event);
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className="relative flex h-full w-full flex-col"
      style={{
        backgroundColor: "var(--surface-0)",
        color: "var(--text-primary)",
      }}
    >
      {/* Full-bleed drop tint overlay — kiwi wash when dragging */}
      {isDragActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30"
          style={{
            backgroundColor: "rgba(164, 214, 94, 0.08)",
            boxShadow: "inset 0 0 0 2px var(--pillar-cinema-inspiration)",
          }}
        />
      )}

      {/* Close — bare X, no chrome */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-6 top-6 z-20 flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-100"
          style={{ color: "var(--text-secondary)", opacity: 0.7 }}
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* Header: eyebrow + huge editorial movie title input — no borders, just baseline underline */}
      <header className="px-10 pt-10 pb-8 md:px-16 md:pt-14">
        <span
          className="text-[10px] font-mono uppercase tracking-[0.28em]"
          style={{ color: "var(--pillar-cinema-inspiration)" }}
        >
          Cinema · Add frames
        </span>
        <div className="mt-3 flex flex-col gap-2">
          <input
            ref={movieInputRef}
            type="text"
            value={movieTitle}
            onChange={(event) => setMovieTitle(event.target.value)}
            placeholder="Movie title"
            aria-label="Movie title"
            className="w-full bg-transparent font-display italic text-[44px] md:text-[64px] leading-[1.02] focus:outline-none placeholder:opacity-40"
            style={{ color: "var(--text-primary)" }}
          />
          <div
            className="h-px w-full"
            style={{ backgroundColor: "var(--border-default)" }}
          />
          {/* Secondary line: director and year, inline, no borders */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <input
              type="text"
              value={director}
              onChange={(event) => setDirector(event.target.value)}
              placeholder="Director"
              aria-label="Director"
              className="bg-transparent text-[14px] font-mono uppercase tracking-[0.14em] focus:outline-none placeholder:opacity-40"
              style={{
                color: "var(--text-secondary)",
                width: "min(280px, 60%)",
              }}
            />
            <span style={{ color: "var(--text-ghost)" }} aria-hidden>·</span>
            <input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Year"
              aria-label="Year"
              className="bg-transparent text-[14px] font-mono uppercase tracking-[0.14em] focus:outline-none placeholder:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              style={{
                color: "var(--text-secondary)",
                width: "5ch",
              }}
            />
          </div>
        </div>
      </header>

      {/* Body — drop the whole workspace; empty state is type, frames replace it */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop frames anywhere in this panel or click to browse"
        onClick={(event) => {
          // Don't intercept clicks on inputs or buttons
          const target = event.target as HTMLElement;
          if (target.closest("input, button, textarea")) return;
          fileInputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className="relative flex-1 cursor-pointer px-10 pb-12 md:px-16"
      >
        {!hasEntries ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <p
              className="font-display italic text-[36px] md:text-[52px] leading-[1.0]"
              style={{
                color: "var(--text-tertiary)",
                opacity: 0.55,
              }}
            >
              drop frames anywhere
            </p>
            <p
              className="text-[10px] font-mono uppercase tracking-[0.32em]"
              style={{ color: "var(--text-ghost)" }}
            >
              or click · png · jpg · webp · batch
            </p>
          </div>
        ) : (
          // Frame grid — no card around them, just images and a thin caption row
          <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {entries.map((entry) => (
              <li key={entry.id} className="group relative flex flex-col gap-2">
                <div
                  className="relative w-full overflow-hidden"
                  style={{
                    aspectRatio: "16 / 10",
                    backgroundColor: "#0a0805",
                  }}
                >
                  <Image
                    src={entry.previewUrl}
                    alt={entry.file.name}
                    fill
                    unoptimized
                    className="object-cover transition-opacity duration-200"
                    style={{
                      opacity:
                        entry.status === "uploading"
                          ? 0.6
                          : entry.status === "error"
                          ? 0.5
                          : 1,
                    }}
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  />
                  {entry.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2
                        className="h-5 w-5 animate-spin"
                        style={{ color: "var(--pillar-cinema-inspiration)" }}
                      />
                    </div>
                  )}
                  {entry.status === "done" && (
                    <div
                      className="absolute left-2 top-2 h-1.5 w-1.5"
                      style={{
                        backgroundColor: "var(--pillar-cinema-inspiration)",
                      }}
                      aria-label="saved"
                      title="saved"
                    />
                  )}
                  {entry.status === "error" && (
                    <div
                      className="absolute left-2 top-2 text-[9px] font-mono uppercase tracking-[0.18em]"
                      style={{ color: "var(--status-error)" }}
                      title={entry.errorMessage}
                    >
                      error
                    </div>
                  )}
                  {/* Hover: minimal remove affordance */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeEntry(entry.id);
                    }}
                    aria-label="Remove from queue"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      color: "var(--image-card-overlay-text)",
                      textShadow: "var(--image-card-text-shadow)",
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={entry.scene ?? ""}
                    onChange={(event) =>
                      updateEntry(entry.id, { scene: event.target.value })
                    }
                    placeholder="Scene · optional"
                    aria-label="Scene"
                    className="bg-transparent text-[11px] font-mono uppercase tracking-[0.14em] focus:outline-none placeholder:opacity-40"
                    style={{ color: "var(--text-secondary)" }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) handleIncomingFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {/* Footer strip — no border, just typography and the single solid commit accent */}
      <footer
        className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-10 pb-10 pt-4 md:px-16"
      >
        <div className="flex items-baseline gap-4 text-[10px] font-mono uppercase tracking-[0.22em]">
          <span style={{ color: "var(--text-tertiary)" }}>
            {hasEntries
              ? `${entries.length} queued${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}${doneCount > 0 ? ` · ${doneCount} saved` : ""}`
              : ""}
          </span>
          {statusMessage && (
            <span style={{ color: "var(--pillar-cinema-inspiration)" }}>
              {statusMessage}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-6">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.22em]"
            style={{ color: "var(--text-ghost)" }}
          >
            ⌘ + Enter
          </span>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={isUploading || entries.length === 0 || movieTitle.trim().length === 0}
            className="inline-flex items-baseline gap-2 px-4 py-2 text-[11px] font-mono uppercase tracking-[0.22em] transition-opacity disabled:opacity-30"
            style={{
              backgroundColor: "var(--pillar-cinema-inspiration)",
              color: "#0a1a00",
              fontWeight: 700,
            }}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                committing
              </>
            ) : (
              <>commit</>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
