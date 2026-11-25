"use client";

/* eslint-disable @next/next/no-img-element */
import { memo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type ShelfCollection = {
  id: string;
  name: string;
  count: number;
  /** Cover candidates, best first: a broken one falls through to the next. */
  covers: string[];
  /** Up to two more frames, shown small on world covers. */
  peeks: string[];
};

const COLLAPSE_KEY = "lm.worldsShelf.collapsed";

const readCollapsed = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The top of the home page: every world, then the collections that are not
 * worlds, each as a cover you can open. Replaced the storybook shelf on
 * 25 Nov 2026 (Michael: "the hero page should show collections or worlds
 * thumbnails, not storybooks"). Storybooks keep their own tab.
 */
export function WorldsShelf({
  worlds,
  collections,
  onOpen,
  onSeeAll,
}: {
  worlds: ShelfCollection[];
  collections: ShelfCollection[];
  onOpen: (collectionId: string) => void;
  onSeeAll?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
      return next;
    });
  };

  return (
    <section
      aria-label="Worlds and collections"
      className="px-4 pb-4 pt-1"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div className="flex items-center gap-3 pb-3 pt-2">
        <h2 style={headingStyle}>Worlds</h2>
        <span style={countStyle}>{worlds.length}</span>
        <div className="ml-auto flex items-center gap-2">
          {onSeeAll ? <PillButton onClick={onSeeAll}>All collections →</PillButton> : null}
          <PillButton
            onClick={toggleCollapsed}
            label={collapsed ? "Show worlds and collections" : "Hide worlds and collections"}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            )}
          </PillButton>
        </div>
      </div>
      {collapsed ? null : (
        <>
          <Row items={worlds} onOpen={onOpen} large />
          {collections.length > 0 ? (
            <>
              <div className="flex items-center gap-3 pb-3 pt-5">
                <h2 style={headingStyle}>Collections</h2>
                <span style={countStyle}>{collections.length}</span>
              </div>
              <Row items={collections} onOpen={onOpen} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function Row({
  items,
  onOpen,
  large = false,
}: {
  items: ShelfCollection[];
  onOpen: (collectionId: string) => void;
  large?: boolean;
}) {
  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1"
      style={{ scrollbarWidth: "none", scrollSnapType: "x proximity" }}
    >
      {items.map((item, index) => (
        <Tile key={item.id} item={item} onOpen={onOpen} large={large} eager={large && index < 6} />
      ))}
    </div>
  );
}

const Tile = memo(function Tile({
  item,
  onOpen,
  large,
  eager,
}: {
  item: ShelfCollection;
  onOpen: (collectionId: string) => void;
  large: boolean;
  eager: boolean;
}) {
  const width = large ? 220 : 150;
  // A cover that fails to load (a deleted file, a video URL) gives way to the
  // next candidate instead of leaving a broken-image icon on the shelf.
  const [coverIndex, setCoverIndex] = useState(0);
  const cover = item.covers[coverIndex];
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="group shrink-0 text-left outline-none"
      style={{ width, scrollSnapAlign: "start" }}
      aria-label={`${item.name}, ${item.count} pieces`}
    >
      <div
        className="relative overflow-hidden transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-[var(--lm-coral)]"
        style={{
          aspectRatio: large ? "4 / 5" : "1 / 1",
          borderRadius: "6px",
          background: "var(--lm-surface-1)",
        }}
      >
        {cover ? (
          <img
            key={cover}
            src={cover}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onError={() => setCoverIndex((index) => index + 1)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : null}
        {large && item.peeks.length > 0 ? (
          <div className="absolute bottom-2 right-2 flex gap-1">
            {item.peeks.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-9 w-9 object-cover"
                style={{ borderRadius: "3px", boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2 pt-2">
        <span
          className="min-w-0 truncate"
          style={{
            fontSize: large ? "12px" : "11px",
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--lm-text-primary)",
          }}
        >
          {item.name}
        </span>
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
            fontSize: "10px",
            color: "var(--lm-text-tertiary)",
          }}
        >
          {item.count.toLocaleString("en-US")}
        </span>
      </div>
    </button>
  );
});

const headingStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--lm-text-primary)",
};

const countStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.1em",
  color: "var(--lm-text-tertiary)",
};

function PillButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-1 px-3 py-1.5 transition-colors"
      style={{
        fontSize: "9px",
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: "var(--lm-text-secondary)",
        border: "2px solid var(--lm-border-strong)",
        borderRadius: "999px",
        background: "transparent",
      }}
    >
      {children}
    </button>
  );
}
