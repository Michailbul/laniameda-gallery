"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img>, never next/image. */

import { memo, useState, type ReactNode } from "react";
import {
  SECTION_LABEL, mediaUrl,
  type FeedbackFilter, type GridSize, type ReviewFolder, type ReviewSection, type ReviewStyle, type ReviewVersion, type Verdict,
} from "@/lib/review-client";
import { Faces, type Person } from "./people";
import type { StyleMark } from "./Grid";
import { Check, ChevronDown, Menu } from "./icons";
import { AllFoldersIcon, FolderIcon } from "./folder-icons";
import { Floating, usePopover } from "./Floating";

// The page chrome: the folder nav on the left and the bar on top (rounds as
// milestones in the middle, then styles, the feedback filter and frame
// size). Plain words only; no recipes or codes.

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

export const FILTER_SHORT: Record<FeedbackFilter, string> = {
  all: "All",
  liked: "Liked",
  disliked: "Disliked",
  commented: "Comments",
  todo: "To review",
  new: "New",
  feedback: "His feedback",
};

const filterOptions = (isOwner: boolean, director: string): Array<[FeedbackFilter, string]> =>
  isOwner
    ? [
        ["all", "All frames"],
        ["feedback", `Only ${director}'s feedback`],
        ["new", "New feedback"],
        ["liked", `Liked by ${director}`],
        ["disliked", `Disliked by ${director}`],
        ["commented", "With comments"],
        ["todo", "Nobody has looked yet"],
      ]
    : [
        ["all", "All frames"],
        ["liked", "Liked"],
        ["disliked", "Disliked"],
        ["commented", "With comments"],
        ["todo", "Not reviewed yet"],
      ];

export type StyleChip = ReviewStyle & { count: number; slug: string; roundCount: number };

/** Michael's rule: a style holds at least this many frames in a round. */
export const STYLE_MIN_FRAMES = 8;

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
  directorName: string;
  versions: ReviewVersion[];
  versionId?: string;
  onRound: (version: ReviewVersion) => void;
  roundMessage?: { key: string; title: string; note?: string } | null;
  size: GridSize;
  onSize: (size: GridSize) => void;
  onMenu: () => void;
  menuLabel: string;
  /** Owner only: the style menu (remove from the next round). */
  onRemoveStyle?: (style: StyleChip) => void;
  /** Style likes: your own verdict and everyone's faces, per style id. */
  styleMarks: Map<string, StyleMark>;
  people: Map<string, Person>;
  /** Anyone who may vote: like or dislike a whole style (again = clear). */
  onStyleVerdict?: (styleId: string, verdict: Verdict) => void;
  // The notification bell (top right corner).
  bell?: ReactNode;
};

export const TopBar = memo(function TopBar(props: TopBarProps) {
  const {
    mediaBase, styles, style, allCount, onStyle, filter, filterCounts, onFilter, isOwner, directorName,
    roundMessage, size, onSize, onMenu, menuLabel, onRemoveStyle, styleMarks, people, onStyleVerdict, bell,
  } = props;
  const [styleMenu, setStyleMenu, styleMenuRef, styleMenuPop] = usePopover();
  const [menuStyle, setMenuStyle] = useState<StyleChip | null>(null);
  const openStyleMenu = (row: StyleChip, anchor: HTMLButtonElement | null) => {
    if (!anchor) return;
    styleMenuRef.current = anchor;
    setMenuStyle(row);
    setStyleMenu(true);
  };
  const [filterOpen, setFilterOpen, filterRef, filterPop] = usePopover();
  const [keysOpen, setKeysOpen, keysRef, keysPop] = usePopover();
  const options = filterOptions(isOwner, directorName);
  const covers = styles.filter((row) => row.cover).slice(0, 4);

  return (
    <header className="rv-top">
      <div className="rv-bar">
        <div className="rv-bar-l">
          <button type="button" className="rv-btn rv-menu-btn" onClick={onMenu} aria-label="Folders">
            <Menu size={13} />
            {menuLabel}
          </button>
        </div>
        <div />
        <div className="rv-bar-r">
          {bell}
          <button
            type="button"
            ref={keysRef}
            className="rv-btn round"
            aria-label="Keyboard keys"
            aria-expanded={keysOpen}
            onClick={() => setKeysOpen(!keysOpen)}
          >
            ?
          </button>
          {keysOpen ? (
            <Floating anchorRef={keysRef} popRef={keysPop} placement="bottom-end" className="rv-keysheet" label="Keys">
              <div className="rv-pop-h" style={{ padding: "4px 0 12px" }}>Keys on the frame under the pointer</div>
              <dl>
                <dt><kbd>1</kbd></dt><dd>Like</dd>
                <dt><kbd>2</kbd></dt><dd>Dislike</dd>
                <dt><kbd>C</kbd></dt><dd>Comment</dd>
                <dt><kbd>O</kbd><kbd>↵</kbd></dt><dd>Open large</dd>
                <dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Next and previous frame</dd>
                <dt><kbd>[</kbd><kbd>]</kbd></dt><dd>Earlier or later round</dd>
                <dt><kbd>⌘</kbd><kbd>click</kbd></dt><dd>Select frames</dd>
                <dt><kbd>⇧</kbd><kbd>drag</kbd></dt><dd>Select with a box</dd>
                <dt><kbd>⌘</kbd><kbd>A</kbd></dt><dd>Select all on screen</dd>
                {isOwner ? (<><dt><kbd>3</kbd>–<kbd>9</kbd></dt><dd>Put in list A–G</dd></>) : null}
                <dt><kbd>Esc</kbd></dt><dd>Close, clear the selection</dd>
              </dl>
            </Floating>
          ) : null}
        </div>
      </div>
      {roundMessage ? (
        <div key={roundMessage.key} className="rv-roundmsg" role="status">
          <b>{roundMessage.title}</b>
          {roundMessage.note}
        </div>
      ) : null}

      <div className="rv-stylebar">
        {styles.length > 0 ? (
          <div className="rv-styles" role="group" aria-label="Styles" data-vote={onStyleVerdict ? "" : undefined}>
            {styles.length > 1 ? (
              <button type="button" className="rv-style" aria-pressed={style === ""} onClick={() => onStyle("")}>
                <span className="cv mosaic">
                  {covers.map((row) => (
                    <img key={row.id} src={mediaUrl(mediaBase, row.cover)} alt="" decoding="async" fetchPriority="low" />
                  ))}
                </span>
                <span className="lb">
                  <b>All styles</b>
                  <span>{allCount} frames</span>
                </span>
              </button>
            ) : null}
            {styles.map((row) => {
              const short = onRemoveStyle && row.roundCount < STYLE_MIN_FRAMES;
              const mark = styleMarks.get(row.id);
              return (
                <div
                  key={row.id}
                  className="rv-style-wrap"
                  data-mine={mark?.mine}
                  data-menu={styleMenu && menuStyle?.id === row.id ? "" : undefined}
                  onContextMenu={onRemoveStyle ? (event) => {
                    event.preventDefault();
                    openStyleMenu(row, event.currentTarget.querySelector<HTMLButtonElement>(".rv-style-more"));
                  } : undefined}
                >
                  <button
                    type="button"
                    className="rv-style"
                    aria-pressed={style === row.slug}
                    data-empty={row.count === 0 ? "" : undefined}
                    onClick={() => onStyle(style === row.slug ? "" : row.slug)}
                  >
                    <span className="cv">
                      {row.cover ? <img src={mediaUrl(mediaBase, row.cover)} alt="" decoding="async" fetchPriority="low" /> : null}
                      {mark?.mine ? <span className="mk" title={mark.mine === "like" ? "You like this style" : "You dislike this style"} /> : null}
                    </span>
                    <span className="lb">
                      <span className="nm">
                        <b>{row.label}</b>
                        {mark?.faces ? <Faces people={people} faces={mark.faces} max={3} small /> : null}
                      </span>
                      <span className="ct">
                        {row.count} {row.count === 1 ? "frame" : "frames"}
                        {short ? <span className="need" title={`A style needs at least ${STYLE_MIN_FRAMES} frames; ${row.roundCount} in this round`}>needs {STYLE_MIN_FRAMES}</span> : null}
                      </span>
                    </span>
                  </button>
                  {onStyleVerdict ? (
                    <span className="rv-style-vote">
                      <button
                        type="button"
                        className="like"
                        aria-pressed={mark?.mine === "like"}
                        title={mark?.mine === "like" ? "Click again to clear" : `Like ${row.label} as a style`}
                        onClick={() => onStyleVerdict(row.id, "like")}
                      >
                        Like style
                      </button>
                      <button
                        type="button"
                        className="dislike"
                        aria-pressed={mark?.mine === "dislike"}
                        title={mark?.mine === "dislike" ? "Click again to clear" : `Dislike ${row.label} as a style`}
                        onClick={() => onStyleVerdict(row.id, "dislike")}
                      >
                        Dislike style
                      </button>
                    </span>
                  ) : null}
                  {onRemoveStyle ? (
                    <button
                      type="button"
                      className="rv-style-more"
                      aria-label={`${row.label}: style menu`}
                      aria-haspopup="menu"
                      onClick={(event) => openStyleMenu(row, event.currentTarget)}
                    >
                      ⋯
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rv-styles" />
        )}

        {styleMenu && menuStyle && onRemoveStyle ? (
          <Floating anchorRef={styleMenuRef} popRef={styleMenuPop} placement="bottom-start" role="menu" label={`${menuStyle.label} style`}>
            <div className="rv-pop-h">{menuStyle.label} · {menuStyle.roundCount} {menuStyle.roundCount === 1 ? "frame" : "frames"} in this round</div>
            <button
              type="button"
              role="menuitem"
              className="rv-opt"
              onClick={() => {
                setStyleMenu(false);
                onRemoveStyle(menuStyle);
              }}
            >
              <span className="ck" />
              Remove style from next round
            </button>
          </Floating>
        ) : null}

        <div className="rv-tools">
          <button
            type="button"
            ref={filterRef}
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
            <Floating anchorRef={filterRef} popRef={filterPop} placement="bottom-end" role="menu">
              {options.map(([value, label]) => (
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
            </Floating>
          ) : null}
          <div className="rv-size" role="group" aria-label="Frame size">
            {(["s", "m", "l"] as GridSize[]).map((value) => (
              <button key={value} type="button" aria-pressed={size === value} onClick={() => onSize(value)} title={`${value.toUpperCase()} frames`}>
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
});
