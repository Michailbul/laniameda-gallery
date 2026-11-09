"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img>, never next/image. */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { ago, mediaUrl } from "@/lib/review-client";
import { Avatar, personOf, type Person } from "./people";
import { BellIcon } from "./icons";
import { Floating, usePopover } from "./Floating";

// The bell in the top corner: what other people did lately (comments, likes,
// style votes, visits, new rounds), newest first, with a count of what you
// have not seen. Opening it marks everything read; the rows that were new
// stay lit until it closes. A row takes you to the frame, style or round.

type Note = NonNullable<FunctionReturnType<typeof api.review.notifications>>["items"][number];

type Props = {
  slug: string;
  mediaBase: string;
  people: Map<string, Person>;
  onFrame: (assetId: string, comment: boolean, version?: string) => void;
  onStyle: (styleId: string) => void;
  onRound: (versionId: string) => void;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const lineOf = (note: Note) => {
  switch (note.type) {
    case "comment":
      return "commented on a frame";
    case "verdict":
      return `${note.verdict === "like" ? "liked" : "disliked"} ${plural(note.count ?? note.frames.length, "frame")}`;
    case "style_verdict":
      return `${note.verdict === "like" ? "likes" : "dislikes"} the style`;
    case "visit":
      return "opened the review";
    case "round":
      return `put up round ${note.version ?? ""}`.trim();
  }
};

export function Bell({ slug, mediaBase, people, onFrame, onStyle, onRound }: Props) {
  const data = useQuery(api.review.notifications, { slug });
  const markSeen = useMutation(api.review.markNotificationsSeen);
  const [open, setOpen, anchorRef, popRef] = usePopover();
  // While the panel is open, rows newer than this stay marked as new.
  const [litSince, setLitSince] = useState(0);
  const marking = useRef(false);

  const seenAt = data?.seenAt ?? 0;
  const items = data?.items ?? [];
  const unseen = items.filter((note) => note.at > seenAt).length;

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setLitSince(seenAt);
    setOpen(true);
    if (unseen > 0 && !marking.current) {
      marking.current = true;
      void markSeen({ slug }).catch(() => null).finally(() => { marking.current = false; });
    }
  };

  // The tab title carries the count, so a new comment shows from another tab.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unseen > 0 ? `(${unseen}) ${base}` : base;
  }, [unseen]);

  const go = (note: Note) => {
    setOpen(false);
    if (note.type === "comment" || note.type === "verdict") {
      const first = note.frames[0];
      if (first) onFrame(first.assetId, note.type === "comment", note.version);
    } else if (note.type === "style_verdict" && note.styleId) {
      onStyle(note.styleId);
    } else if (note.type === "round" && note.versionId) {
      onRound(note.versionId);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="rv-btn round rv-bell"
        aria-label={unseen > 0 ? `Updates, ${unseen} new` : "Updates"}
        aria-expanded={open}
        data-new={unseen > 0 ? "" : undefined}
        onClick={toggle}
      >
        <BellIcon size={15} />
        {unseen > 0 ? <span className="rv-bell-n">{unseen > 99 ? "99+" : unseen}</span> : null}
      </button>
      {open ? (
        <Floating anchorRef={anchorRef} popRef={popRef} placement="bottom-end" className="rv-notes" label="Updates">
          <div className="rv-notes-h">
            <span>Updates</span>
            {items.length > 0 ? <span className="r">Last 30 days</span> : null}
          </div>
          {data === undefined ? <div className="rv-notes-empty">Loading…</div> : null}
          {data !== undefined && items.length === 0 ? (
            <div className="rv-notes-empty">Nothing yet. Comments, likes and new rounds show up here.</div>
          ) : null}
          {items.map((note) => {
            const person = personOf(people, note.who);
            const fresh = note.at > litSince;
            const clickable = note.type !== "visit";
            const Row = clickable ? "button" : "div";
            return (
              <Row
                key={note.key}
                {...(clickable ? { type: "button" as const, onClick: () => go(note) } : {})}
                className="rv-note"
                data-fresh={fresh ? "" : undefined}
                data-type={note.type}
                data-v={note.verdict}
              >
                <Avatar person={person ?? { who: note.who, name: note.name, initials: note.name.slice(0, 1).toUpperCase(), role: "", isYou: false }} />
                <span className="tx">
                  <span className="ln">
                    <b>{note.name}</b> {lineOf(note)}
                    {note.type === "style_verdict" && note.style ? <> <b className="sty">{note.style}</b></> : null}
                  </span>
                  {note.body ? <span className="q">{note.type === "comment" ? `“${note.body}”` : note.body}</span> : null}
                  <span className="mt">
                    {ago(note.at)}
                    {note.folder ? ` · ${note.folder}` : ""}
                    {note.type === "comment" && note.version ? ` · ${note.version}` : ""}
                  </span>
                </span>
                {note.frames.length > 0 ? (
                  <span className="th" data-n={Math.min(note.frames.length, 4)}>
                    {note.frames.slice(0, note.type === "verdict" ? 4 : 1).map((frame) => (
                      <img key={frame.assetId} src={mediaUrl(mediaBase, frame.thumb)} alt="" loading="lazy" decoding="async" />
                    ))}
                  </span>
                ) : null}
                {fresh ? <span className="dot" aria-label="New" /> : null}
              </Row>
            );
          })}
        </Floating>
      ) : null}
    </>
  );
}
