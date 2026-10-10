"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Film,
  Plus,
  X,
} from "lucide-react";
import { hasAssetDragPayload, readAssetDragPayload } from "@/lib/asset-drag";
import {
  parseStorybookMeta,
  type StorybookMedium,
  type StorybookMeta,
  type StorybookStatus,
} from "@/lib/storybook-meta";

export type ShelfBook = {
  id: string;
  name: string;
  story?: string;
  count: number;
  previews: Array<{ src: string; kind?: "image" | "video" }>;
};

type StatusFilter = "active" | StorybookStatus;

const COLLAPSE_KEY = "lm.storybookShelf.collapsed";
const READY = "#79B791";

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: "active", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "not-ready", label: "Not ready" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "archived", label: "Archived" },
];

const MEDIUM_OPTIONS: Array<{ id: StorybookMedium; label: string }> = [
  { id: "animated", label: "Animated" },
  { id: "live-action", label: "Live action" },
];

type Entry = { book: ShelfBook; meta: StorybookMeta };

export function StorybookShelf({
  books,
  mode,
  onOpen,
  onCreate,
  onSeeAll,
  onDropAssets,
}: {
  books: ShelfBook[];
  mode: "shelf" | "grid";
  onOpen: (storybookId: string) => void;
  onCreate?: (name: string) => Promise<string | null>;
  onSeeAll?: () => void;
  onDropAssets?: (storybookId: string, assetIds: string[]) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [world, setWorld] = useState<string | null>(null);
  const [medium, setMedium] = useState<StorybookMedium | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage can be blocked; the shelf just starts open */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const entries = useMemo<Entry[]>(
    () =>
      books.map((book) => ({
        book,
        meta: parseStorybookMeta(book.name, book.story),
      })),
    [books],
  );

  const worlds = useMemo(() => {
    const tally = new Map<string, number>();
    for (const { meta } of entries) {
      if (meta.status === "archived") continue;
      tally.set(meta.world, (tally.get(meta.world) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const statusCount = (id: StatusFilter) =>
    entries.filter(({ meta }) =>
      id === "active" ? meta.status !== "archived" : meta.status === id,
    ).length;

  const visible = entries.filter(({ meta }) => {
    if (status === "active" ? meta.status === "archived" : meta.status !== status)
      return false;
    if (world && meta.world !== world) return false;
    if (medium && meta.medium !== medium) return false;
    return true;
  });

  const filtering = status !== "active" || world !== null || medium !== null;
  const clear = () => {
    setStatus("active");
    setWorld(null);
    setMedium(null);
  };

  const submit = async () => {
    const name = draft.trim();
    if (!name || !onCreate || busy) return;
    setBusy(true);
    try {
      const id = await onCreate(name);
      if (id) {
        setCreating(false);
        setDraft("");
        onOpen(id);
      }
    } finally {
      setBusy(false);
    }
  };

  const isShelf = mode === "shelf";

  return (
    <section
      aria-label="Storybooks"
      className="px-4 pb-4 pt-1"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div
        className="mx-auto"
        style={{ maxWidth: isShelf ? "1180px" : "1480px" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 pb-3 pt-2">
          <BookOpen
            className="h-4 w-4"
            style={{ color: "var(--lm-coral)" }}
            aria-hidden
          />
          <h2
            style={{
              fontSize: "13px",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--lm-text-primary)",
            }}
          >
            Storybooks
          </h2>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--lm-text-tertiary)",
            }}
          >
            {filtering ? `${visible.length} / ${statusCount("active")}` : statusCount("active")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {onCreate ? (
              <HeaderButton onClick={() => setCreating((v) => !v)} active={creating}>
                <Plus className="h-3 w-3" aria-hidden />
                New
              </HeaderButton>
            ) : null}
            {isShelf && onSeeAll ? (
              <HeaderButton onClick={onSeeAll}>See all →</HeaderButton>
            ) : null}
            {isShelf ? (
              <HeaderButton
                onClick={toggleCollapsed}
                label={collapsed ? "Show storybooks" : "Hide storybooks"}
              >
                {collapsed ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                )}
              </HeaderButton>
            ) : null}
          </div>
        </div>

        {creating && onCreate ? (
          <form
            className="mb-3 flex items-center gap-2"
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
              placeholder="WORLD · Storybook title"
              aria-label="New storybook name"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--lm-text-primary)",
                border: "2px solid var(--lm-coral)",
                borderRadius: "12px",
                caretColor: "var(--lm-coral)",
                opacity: busy ? 0.5 : 1,
              }}
            />
          </form>
        ) : null}

        {!collapsed || !isShelf ? (
          <>
            {/* Filters: three separate groups */}
            <div
              className="lm-island mb-4 flex flex-col gap-2 px-3 py-2.5 md:flex-row md:flex-wrap md:items-center md:gap-x-4"
              style={{ borderRadius: "16px" }}
            >
              <FilterGroup label="Status">
                {STATUS_OPTIONS.map((option) => {
                  const count = statusCount(option.id);
                  if (count === 0 && option.id !== "active") return null;
                  return (
                    <Pill
                      key={option.id}
                      active={status === option.id}
                      onClick={() => setStatus(option.id)}
                      count={count}
                    >
                      {option.label}
                    </Pill>
                  );
                })}
              </FilterGroup>
              {worlds.length > 1 ? (
                <>
                  <Divider />
                  <FilterGroup label="World">
                    {worlds.map(([name, count]) => (
                      <Pill
                        key={name}
                        active={world === name}
                        onClick={() => setWorld(world === name ? null : name)}
                        count={count}
                      >
                        {name}
                      </Pill>
                    ))}
                  </FilterGroup>
                </>
              ) : null}
              <Divider />
              <FilterGroup label="Medium">
                {MEDIUM_OPTIONS.map((option) => (
                  <Pill
                    key={option.id}
                    active={medium === option.id}
                    onClick={() => setMedium(medium === option.id ? null : option.id)}
                  >
                    {option.label}
                  </Pill>
                ))}
              </FilterGroup>
              {filtering ? (
                <button
                  type="button"
                  onClick={clear}
                  className="ml-auto flex shrink-0 items-center gap-1 px-2.5 py-1"
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#fff",
                    background:
                      "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
                    borderRadius: "999px",
                  }}
                >
                  <X className="h-2.5 w-2.5" aria-hidden />
                  Clear
                </button>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <p
                className="px-1 py-10 text-center"
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-tertiary)",
                }}
              >
                {books.length === 0
                  ? "No storybooks yet. Press New to start one."
                  : "No storybook matches these filters."}
              </p>
            ) : (
              <div
                className={isShelf ? "flex gap-4 overflow-x-auto pb-3" : "grid gap-4"}
                style={
                  isShelf
                    ? {
                        scrollSnapType: "x proximity",
                        scrollbarWidth: "thin",
                      }
                    : {
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(260px, 1fr))",
                      }
                }
              >
                {visible.map(({ book, meta }) => (
                  <Tile
                    key={book.id}
                    book={book}
                    meta={meta}
                    fixedWidth={isShelf}
                    onOpen={onOpen}
                    onDropAssets={onDropAssets}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function HeaderButton({
  children,
  onClick,
  active = false,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1 px-3 py-1.5 transition-colors"
      style={{
        fontSize: "9px",
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: active ? "var(--lm-text-primary)" : "var(--lm-text-secondary)",
        border: active
          ? "2px solid var(--lm-coral)"
          : "2px solid var(--lm-border-strong)",
        borderRadius: "999px",
        background: active ? "var(--lm-surface-1)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="shrink-0"
        style={{
          fontSize: "8px",
          fontWeight: 800,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        {label}
      </span>
      <div
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="hidden md:block"
      style={{
        width: "1px",
        height: "20px",
        backgroundColor: "var(--lm-border-strong)",
      }}
    />
  );
}

// Same pill language as the gallery's menu filters: two-pixel outline, tracked
// uppercase, coral gradient when on.
function Pill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
      style={{
        padding: "4px 11px",
        fontSize: "10px",
        fontWeight: active ? 700 : 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        borderRadius: "999px",
        border: active
          ? "2px solid var(--gradient-3)"
          : "2px solid var(--lm-border)",
        color: active ? "#fff" : "var(--lm-text-secondary)",
        background: active
          ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
          : "var(--lm-surface-1)",
        boxShadow: active ? "0 0 10px rgba(255, 122, 100, 0.2)" : "none",
        transition: "all var(--lm-duration-fast)",
      }}
    >
      {children}
      {count !== undefined ? (
        <span style={{ opacity: 0.5, fontSize: "8px", fontWeight: 800 }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function StatusBadge({ meta }: { meta: StorybookMeta }) {
  const base: React.CSSProperties = {
    fontSize: "9px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    padding: "3px 8px",
    backgroundColor: "var(--image-card-badge-bg)",
    whiteSpace: "nowrap",
  };
  if (meta.status === "ready") {
    return (
      <span
        style={{
          ...base,
          color: READY,
          border: `1px solid color-mix(in srgb, ${READY} 55%, transparent)`,
        }}
      >
        Ready
      </span>
    );
  }
  if (meta.status === "not-ready") {
    return (
      <span
        style={{
          ...base,
          color: "var(--coral)",
          border: "1px solid color-mix(in srgb, var(--coral) 50%, transparent)",
        }}
      >
        Not ready{meta.gaps !== null ? ` · ${meta.gaps}` : ""}
      </span>
    );
  }
  return (
    <span
      style={{
        ...base,
        color: "var(--lm-text-tertiary)",
        border: "1px dashed var(--lm-border-strong)",
      }}
    >
      {meta.status === "archived" ? "Archived" : "Unreviewed"}
    </span>
  );
}

function Tile({
  book,
  meta,
  fixedWidth,
  onOpen,
  onDropAssets,
}: {
  book: ShelfBook;
  meta: StorybookMeta;
  fixedWidth: boolean;
  onOpen: (storybookId: string) => void;
  onDropAssets?: (storybookId: string, assetIds: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const cover = book.previews[0];
  const strip = book.previews.slice(1, 4);
  const facts = [
    meta.runtimeSeconds !== null ? `${meta.runtimeSeconds}s` : null,
    `${book.count} ${book.count === 1 ? "img" : "imgs"}`,
    meta.medium === "animated"
      ? "Animated"
      : meta.medium === "live-action"
        ? "Live action"
        : null,
  ].filter(Boolean) as string[];

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Storybook: ${meta.title}, ${meta.world}`}
      onClick={() => onOpen(book.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(book.id);
        }
      }}
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
      className="group flex cursor-pointer flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]"
      style={{
        width: fixedWidth ? "clamp(240px, 24vw, 292px)" : undefined,
        flex: fixedWidth ? "0 0 auto" : undefined,
        scrollSnapAlign: "start",
        borderRadius: "16px",
        border: over
          ? "2px solid var(--lm-coral)"
          : "2px solid var(--lm-border)",
        backgroundColor: "var(--lm-surface-1)",
        transition: "border-color var(--lm-duration-fast), transform 200ms ease",
        opacity: meta.status === "archived" ? 0.7 : 1,
      }}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "16 / 10", backgroundColor: "var(--surface-3)" }}
      >
        {cover ? (
          <Image
            src={cover.src}
            alt=""
            fill
            unoptimized
            sizes="300px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <BookOpen
              className="h-6 w-6"
              style={{ color: "var(--text-ghost)" }}
              aria-hidden
            />
            <span
              style={{
                fontSize: "9px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-ghost)",
              }}
            >
              Drop images to begin
            </span>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(10,8,5,0.7) 0%, rgba(10,8,5,0) 55%)",
          }}
        />
        <div className="absolute left-2 top-2">
          <StatusBadge meta={meta} />
        </div>
        {strip.length > 0 ? (
          <div className="absolute bottom-2 right-2 flex gap-1">
            {strip.map((frame, index) => (
              <div
                key={`${frame.src}-${index}`}
                className="relative overflow-hidden"
                style={{
                  width: "30px",
                  height: "38px",
                  borderRadius: "5px",
                  border: "1px solid rgba(255,244,234,0.55)",
                }}
              >
                <Image
                  src={frame.src}
                  alt=""
                  fill
                  unoptimized
                  sizes="30px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pb-3 pt-3">
        <span
          className="truncate"
          style={{
            fontSize: "8.5px",
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--lm-coral)",
          }}
        >
          {meta.world}
        </span>
        <h3
          style={{
            fontSize: "13px",
            fontWeight: 900,
            lineHeight: 1.2,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--lm-text-primary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {meta.title}
        </h3>
        {meta.hook ? (
          <p
            style={{
              fontFamily: "var(--font-sans, inherit)",
              fontSize: "12px",
              lineHeight: 1.45,
              color: "var(--lm-text-secondary)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {meta.hook}
          </p>
        ) : null}
        <div
          className="mt-auto flex items-center gap-1.5 pt-1.5"
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--lm-text-tertiary)",
          }}
        >
          <Film className="h-3 w-3" aria-hidden />
          {facts.join(" · ")}
        </div>
      </div>
    </article>
  );
}
