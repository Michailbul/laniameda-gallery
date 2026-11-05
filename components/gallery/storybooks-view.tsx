"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Plus, X } from "lucide-react";
import { hasAssetDragPayload, readAssetDragPayload } from "@/lib/asset-drag";
import { buildGridImageAttrs } from "@/lib/grid-image";
import { storybookStatusLabel } from "@/lib/storybook-meta";
import {
  MEDIUM_OPTIONS,
  STATUS_OPTIONS,
  useStorybookFilters,
  type ShelfBook,
  type ShelfEntry,
} from "./storybook-shelf";
import { StorybookBook } from "./storybook-book";

// The Storybooks view, shaped like Michael's HEEL board: one chip row of
// filters, a strip of covers (a 2×2 mosaic of each book's frames, its name
// under it), then the chosen book below as bare masonry by beat. A cover
// click selects the book in place; the address follows (/storybooks/<id>).

// A cover is clamp(136px, 13vw, 184px) wide; a mosaic cell is half of it.
const MOSAIC_SIZES = "(max-width: 767px) 72px, 96px";

function Cover({
  entry,
  selected,
  onSelect,
  onDropAssets,
}: {
  entry: ShelfEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  onDropAssets?: (storybookId: string, assetIds: string[]) => void;
}) {
  const { book, meta } = entry;
  const [over, setOver] = useState(false);
  const previews = book.previews.slice(0, 4);
  const status = storybookStatusLabel(meta);
  return (
    <button
      type="button"
      data-book={book.id}
      aria-pressed={selected}
      aria-label={`${meta.title}, ${meta.world}`}
      onClick={() => onSelect(book.id)}
      onDragOver={
        onDropAssets
          ? (event) => {
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setOver(true);
            }
          : undefined
      }
      onDragLeave={onDropAssets ? () => setOver(false) : undefined}
      onDrop={
        onDropAssets
          ? (event) => {
              setOver(false);
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              const ids = readAssetDragPayload(event.dataTransfer);
              if (ids.length > 0) onDropAssets(book.id, ids);
            }
          : undefined
      }
      className={`lm-sb-cover${selected ? " on" : ""}${over ? " drop" : ""}${meta.status === "archived" ? " archived" : ""}`}
    >
      <span className="lm-sb-mosaic" data-n={previews.length}>
        {previews.length === 0 ? (
          <span className="lm-sb-mosaic-empty">Drop images here</span>
        ) : (
          previews.map((preview, index) => {
            const attrs = buildGridImageAttrs(preview);
            return (
              // eslint-disable-next-line @next/next/no-img-element -- srcset over R2 renditions, see lib/grid-image.ts
              <img
                key={`${preview.src}-${index}`}
                src={attrs.src}
                srcSet={attrs.srcSet}
                sizes={attrs.srcSet ? MOSAIC_SIZES : undefined}
                alt=""
                loading="lazy"
                decoding="async"
              />
            );
          })
        )}
        <span className="lm-sb-tags">
          <span className={`lm-sb-tag ${status.tone}`}>{status.text}</span>
        </span>
      </span>
      <span className="lm-sb-cover-name">{meta.title}</span>
      {meta.world !== meta.title ? <span className="lm-sb-cover-world">{meta.world}</span> : null}
    </button>
  );
}

export function StorybooksView({
  ownerUserId,
  books,
  selectedId,
  onSelect,
  onCreate,
  onDropAssets,
  onOpenAsset,
  suspended = false,
}: {
  ownerUserId: string;
  books: ShelfBook[];
  /** The book named in the address, or null for the first one. */
  selectedId: string | null;
  onSelect: (storybookId: string) => void;
  onCreate?: (name: string) => Promise<string | null>;
  onDropAssets?: (storybookId: string, assetIds: string[]) => void;
  /** Opens the gallery's asset detail panel on a frame of the given book. */
  onOpenAsset: (storybookId: string, assetId: string) => void;
  /** True while another layer (the detail panel) owns the keys. */
  suspended?: boolean;
}) {
  const filters = useStorybookFilters(books);
  const { entries, worlds, visible, statusCount, filtering, clear, status, setStatus, world, setWorld, medium, setMedium } = filters;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const currentId = selectedId ?? visible[0]?.book.id ?? null;
  const currentEntry = currentId ? entries.find((entry) => entry.book.id === currentId) : undefined;
  const openFrame = useCallback(
    (assetId: string) => {
      if (currentId) onOpenAsset(currentId, assetId);
    },
    [currentId, onOpenAsset],
  );

  // Keep the chosen cover in view inside the strip (a deep link to the
  // fifteenth book), without scrolling the page itself.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !currentId) return;
    const tile = strip.querySelector<HTMLElement>(`[data-book="${currentId}"]`);
    if (!tile) return;
    const left = tile.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + tile.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 24), behavior: "smooth" });
    }
  }, [currentId, visible.length]);

  const submit = async () => {
    const name = draft.trim();
    if (!name || !onCreate || busy) return;
    setBusy(true);
    try {
      const id = await onCreate(name);
      if (id) {
        setCreating(false);
        setDraft("");
        onSelect(id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Storybooks" className="lm-sb">
      <div className="lm-sb-head">
        <BookOpen className="h-4 w-4" style={{ color: "var(--lm-coral)" }} aria-hidden />
        <h2 className="lm-sb-title">Storybooks</h2>
        <span className="lm-sb-count">
          {filtering ? `${visible.length} / ${statusCount("active")}` : statusCount("active")}
        </span>
        {onCreate ? (
          <button type="button" className={`lm-sb-new${creating ? " on" : ""}`} onClick={() => setCreating((value) => !value)}>
            <Plus className="h-3 w-3" aria-hidden /> New
          </button>
        ) : null}
      </div>

      {creating && onCreate ? (
        <form
          className="lm-sb-create"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCreating(false);
                setDraft("");
              }
            }}
            placeholder="World · Storybook title"
            aria-label="New storybook name"
          />
        </form>
      ) : null}

      <div className="lm-sb-chips" role="toolbar" aria-label="Filter storybooks">
        {STATUS_OPTIONS.map((option) => {
          const count = statusCount(option.id);
          if (count === 0 && option.id !== "active") return null;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={status === option.id}
              className={`lm-sb-chip${status === option.id ? " on" : ""}`}
              onClick={() => setStatus(option.id)}
            >
              {option.label} <i>{count}</i>
            </button>
          );
        })}
        {worlds.length > 1 ? <span className="lm-sb-sep" aria-hidden /> : null}
        {worlds.length > 1
          ? worlds.map(([name, count]) => (
              <button
                key={name}
                type="button"
                aria-pressed={world === name}
                className={`lm-sb-chip${world === name ? " on" : ""}`}
                onClick={() => setWorld(world === name ? null : name)}
              >
                {name} <i>{count}</i>
              </button>
            ))
          : null}
        <span className="lm-sb-sep" aria-hidden />
        {MEDIUM_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={medium === option.id}
            className={`lm-sb-chip${medium === option.id ? " on" : ""}`}
            onClick={() => setMedium(medium === option.id ? null : option.id)}
          >
            {option.label}
          </button>
        ))}
        {filtering ? (
          <button type="button" className="lm-sb-chip clear" onClick={clear}>
            <X className="h-2.5 w-2.5" aria-hidden /> Clear
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="lm-sb-empty" style={{ marginTop: 14 }}>
          {books.length === 0 ? "No storybooks yet. Press New to start one." : "No storybook matches these filters."}
        </p>
      ) : (
        <div ref={stripRef} className="lm-sb-strip" aria-label="Storybook covers">
          {visible.map((entry) => (
            <Cover
              key={entry.book.id}
              entry={entry}
              selected={entry.book.id === currentId}
              onSelect={onSelect}
              onDropAssets={onDropAssets}
            />
          ))}
        </div>
      )}

      {currentId ? (
        <StorybookBook
          key={currentId}
          ownerUserId={ownerUserId}
          storybookId={currentId}
          entry={currentEntry}
          onOpenAsset={openFrame}
          suspended={suspended}
        />
      ) : null}
    </section>
  );
}
