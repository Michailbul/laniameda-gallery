"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img> with srcset, never next/image. */

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  SECTION_LABEL, mediaUrl, shortDate,
  type FeedbackFilter, type GridSize, type ReviewFolder, type ReviewSection, type ReviewStyle, type ReviewVersion,
} from "@/lib/review-client";
import { Check, ChevronDown, Menu } from "./icons";
import { AllFoldersIcon, FolderIcon } from "./folder-icons";

// The page chrome: the folder nav on the left and the bar on top (styles,
// feedback filter, round, size). Plain words only; no recipes or codes.

/** Open/close state for a small menu that closes on outside click and Esc. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return [open, setOpen, ref] as const;
}

// ------------------------------------------------------------ sidebar

export type AreaGroup = { area: string; folders: ReviewFolder[] };

type SidebarProps = {
  title: string;
  subtitle?: string;
  sections: ReviewSection[];
  section: ReviewSection;
  sectionCounts: Record<ReviewSection, number>;
  areas: AreaGroup[];
  folder: ReviewFolder | null;
  folderCounts: Map<string, number>;
  freshFolders: Set<string>;
  onSection: (section: ReviewSection) => void;
  onFolder: (slug: string) => void;
  footer: ReactNode;
};

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const { title, subtitle, sections, section, sectionCounts, areas, folder, folderCounts, freshFolders, onSection, onFolder, footer } = props;
  const sectionTotal = sectionCounts[section] ?? 0;
  return (
    <aside className="rv-side" aria-label="Folders">
      <div className="rv-brand">
        <h1>{title}</h1>
        <p>{subtitle?.trim() || "Art direction review"}</p>
      </div>

      {sections.length > 1 ? (
        <div className="rv-seg" role="group" aria-label="Section">
          {sections.map((value) => (
            <button key={value} type="button" aria-pressed={value === section} onClick={() => onSection(value)}>
              {SECTION_LABEL[value]}
              <b>{sectionCounts[value] ?? 0}</b>
            </button>
          ))}
        </div>
      ) : null}

      <nav className="rv-nav">
        <button
          type="button"
          className="rv-folder rv-folder-all"
          aria-current={folder === null}
          data-empty={sectionTotal === 0 ? "" : undefined}
          onClick={() => onFolder("")}
        >
          <AllFoldersIcon />
          All {SECTION_LABEL[section].toLowerCase()}
          <span className="n">{sectionTotal}</span>
        </button>
        {areas.map((group) => (
          <div key={group.area || "-"} role="group" aria-label={group.area || SECTION_LABEL[section]}>
            {group.area ? <div className="rv-area">{group.area}</div> : null}
            {group.folders.map((row) => {
              const count = folderCounts.get(row.id) ?? 0;
              const current = folder?.id === row.id;
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    className="rv-folder"
                    aria-current={current}
                    data-empty={count === 0 ? "" : undefined}
                    onClick={() => onFolder(row.slug)}
                  >
                    <FolderIcon name={row.icon} section={row.section} />
                    <span className="nm">{row.name}</span>
                    {freshFolders.has(row.id) ? <span className="dot" title="New feedback" /> : null}
                    <span className="n">{count}</span>
                  </button>
                  {current && (row.note || row.scenes?.length) ? (
                    <div className="rv-folder-note">
                      {row.note}
                      {row.scenes?.length ? <span className="sc">Scenes {row.scenes.join(" · ")}</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="rv-side-foot">{footer}</div>
    </aside>
  );
});

// ------------------------------------------------------------ top bar

const FILTERS_DIRECTOR: Array<[FeedbackFilter, string]> = [
  ["all", "All frames"],
  ["liked", "Liked"],
  ["disliked", "Disliked"],
  ["commented", "With comments"],
  ["todo", "Not reviewed yet"],
];

const FILTERS_OWNER: Array<[FeedbackFilter, string]> = [
  ["all", "All frames"],
  ["liked", "Approved"],
  ["disliked", "Disliked"],
  ["commented", "Commented"],
  ["todo", "Unreviewed"],
  ["new", "New feedback"],
];

export const FILTER_SHORT: Record<FeedbackFilter, string> = {
  all: "All",
  liked: "Liked",
  disliked: "Disliked",
  commented: "Comments",
  todo: "To review",
  new: "New",
};

type StyleChip = ReviewStyle & { count: number; slug: string };

type TopBarProps = {
  mediaBase: string;
  styles: StyleChip[];
  style: string;
  allCount: number;
  onStyle: (slug: string) => void;
  filter: FeedbackFilter;
  filterCounts: Record<FeedbackFilter, number>;
  onFilter: (filter: FeedbackFilter) => void;
  isOwner: boolean;
  versions: ReviewVersion[];
  versionId?: string;
  loadingRound: boolean;
  onRound: (version: ReviewVersion) => void;
  size: GridSize;
  onSize: (size: GridSize) => void;
  onMenu: () => void;
  menuLabel: string;
};

export const TopBar = memo(function TopBar(props: TopBarProps) {
  const {
    mediaBase, styles, style, allCount, onStyle, filter, filterCounts, onFilter, isOwner,
    versions, versionId, loadingRound, onRound, size, onSize, onMenu, menuLabel,
  } = props;
  const [filterOpen, setFilterOpen, filterRef] = usePopover();
  const [roundOpen, setRoundOpen, roundRef] = usePopover();
  const shown = versions.find((row) => row.id === versionId);
  const newestFirst = [...versions].sort((a, b) => b.number - a.number);
  const filters = isOwner ? FILTERS_OWNER : FILTERS_DIRECTOR;
  const covers = styles.filter((row) => row.cover).slice(0, 4);

  return (
    <header className="rv-top">
      <button type="button" className="rv-btn rv-menu-btn" onClick={onMenu} aria-label="Folders">
        <Menu size={13} />
        {menuLabel}
      </button>

      {styles.length > 0 ? (
        <div className="rv-styles" role="group" aria-label="Styles">
          {styles.length > 1 ? (
            <button type="button" className="rv-style" aria-pressed={style === ""} onClick={() => onStyle("")}>
              <span className="cv mosaic">
                {covers.map((row) => (
                  <img key={row.id} src={mediaUrl(mediaBase, row.cover)} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                ))}
              </span>
              <span className="lb">
                <b>All styles</b>
                <span>{allCount} frames</span>
              </span>
            </button>
          ) : null}
          {styles.map((row) => (
            <button
              key={row.id}
              type="button"
              className="rv-style"
              aria-pressed={style === row.slug}
              data-empty={row.count === 0 ? "" : undefined}
              onClick={() => onStyle(style === row.slug ? "" : row.slug)}
            >
              <span className="cv">
                {row.cover ? <img src={mediaUrl(mediaBase, row.cover)} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : null}
              </span>
              <span className="lb">
                <b>{row.label}</b>
                <span>{row.count} {row.count === 1 ? "frame" : "frames"}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rv-styles" />
      )}

      <div className="rv-tools">
        <div style={{ position: "relative" }} ref={filterRef}>
          <button
            type="button"
            className="rv-btn"
            data-on={filter !== "all" ? "" : undefined}
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <span className="sub">Show</span> {FILTER_SHORT[filter]}
            {isOwner && filterCounts.new > 0 ? <span className="rv-badge">{filterCounts.new}</span> : null}
            <ChevronDown size={11} />
          </button>
          {filterOpen ? (
            <div className="rv-pop rv-pop-right" role="menu">
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === value}
                  className="rv-opt"
                  onClick={() => {
                    onFilter(value);
                    setFilterOpen(false);
                  }}
                >
                  <span className="ck">{filter === value ? <Check size={13} /> : null}</span>
                  {label}
                  <span className="r">{filterCounts[value]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {versions.length > 0 ? (
          <div style={{ position: "relative" }} ref={roundRef}>
            <button
              type="button"
              className="rv-btn"
              data-on={shown && !shown.isCurrent ? "" : undefined}
              aria-haspopup="menu"
              aria-expanded={roundOpen}
              onClick={() => setRoundOpen(!roundOpen)}
            >
              {loadingRound ? <span className="rv-loading" /> : null}
              {shown?.label ?? "Round"}
              {shown?.isDraft ? <span className="sub">Draft</span> : shown?.publishedAt ? <span className="sub">{shortDate(shown.publishedAt)}</span> : null}
              <ChevronDown size={11} />
            </button>
            {roundOpen ? (
              <div className="rv-pop rv-pop-right" role="menu" style={{ minWidth: 280 }}>
                <div className="rv-pop-h">Rounds</div>
                {newestFirst.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={row.id === versionId}
                    className="rv-opt"
                    onClick={() => {
                      onRound(row);
                      setRoundOpen(false);
                    }}
                  >
                    <span className="ck">{row.id === versionId ? <Check size={13} /> : null}</span>
                    <span>
                      <b>{row.label}</b>
                      {row.title ? <span className="note">{row.title}</span> : null}
                    </span>
                    <span className="r">
                      {row.isDraft ? <span className="tag draft">Draft</span> : row.isCurrent ? <span className="tag cur">Current</span> : null}{" "}
                      {row.publishedAt ? shortDate(row.publishedAt) : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rv-size" role="group" aria-label="Frame size">
          {(["s", "m", "l"] as GridSize[]).map((value) => (
            <button key={value} type="button" aria-pressed={size === value} onClick={() => onSize(value)} title={`${value.toUpperCase()} frames`}>
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
});
