"use client";

import type { MouseEvent, PointerEvent } from "react";
import type { ZoneActions, ZoneKind } from "@/lib/inbox-zones";

/**
 * Keep / Archive / Comment zones laid over an image (styles: `.izones` in
 * globals.css). Only a pointer that can hover gets them; on a touch screen
 * they are not there and a tap does what it always did. `passive` draws the
 * zones without handling clicks, for a parent that hit-tests the tap itself
 * (the sort card, which also drags). They are a mouse shortcut: every action
 * also has its own button or key.
 */
export function HoverZones({ actions, kept, archived, noted, large, passive, onAction }: {
  actions: ZoneActions; kept?: boolean; archived?: boolean; noted?: boolean; large?: boolean; passive?: boolean;
  onAction?: (zone: ZoneKind) => void;
}) {
  const handlers = (zone: ZoneKind) => passive || !onAction ? {} : {
    // Keep the press from starting a drag, a pan or the parent's zoom.
    onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); onAction(zone); },
  };
  return <span className={`izones${large ? " izones-large" : ""}`} aria-hidden>
    {actions.keep && <span className="izone izone-keep" {...handlers("keep")}><b>{kept ? "Kept · undo" : "Keep"}</b></span>}
    {actions.archive && <span className="izone izone-archive" {...handlers("archive")}><b>{archived ? "Restore" : "Archive"}</b></span>}
    {actions.comment && <span className="izone izone-comment" {...handlers("comment")}><b>{noted ? "Edit note" : "Comment"}</b></span>}
  </span>;
}
