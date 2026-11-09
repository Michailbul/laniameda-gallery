"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { plural } from "@/lib/review-client";
import { Floating, usePopover } from "./Floating";

// The bar that appears when frames are selected: like, dislike or comment on
// all of them at once, download them as a ZIP, or clear the selection.
// Michael gets his own tools in it as well (ownerTools).

type BulkBarProps = {
  count: number;
  canVote: boolean;
  onLike: () => void;
  onDislike: () => void;
  /** The art director: D archives instead of disliking. */
  onArchive?: () => void;
  onComment: (body: string) => Promise<boolean>;
  onDownload: () => void;
  onClear: () => void;
  composeSignal: number;
  ownerTools?: ReactNode;
};

export function BulkBar(props: BulkBarProps) {
  const { count, canVote, onLike, onDislike, onArchive, onComment, onDownload, onClear, composeSignal, ownerTools } = props;
  const [composerOpen, setOpen, composeRef, composePop] = usePopover();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // C with a selection opens the composer.
  useEffect(() => {
    if (composeSignal > 0) setOpen(true);
  }, [composeSignal, setOpen]);
  useEffect(() => {
    if (composerOpen) window.requestAnimationFrame(() => areaRef.current?.focus());
  }, [composerOpen]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    const ok = await onComment(body);
    setSending(false);
    if (ok) {
      setBody("");
      setOpen(false);
    }
  };

  return (
    <div className="rv-bulk" role="toolbar" aria-label="Selected frames" data-nodrag="">
      <span className="count">{plural(count, "frame")} selected</span>
      {canVote ? (
        <>
          <button type="button" className="rv-btn" onClick={onLike}>
            <kbd>1</kbd> Like all
          </button>
          {onArchive ? (
            <button type="button" className="rv-btn" onClick={onArchive}>
              <kbd>D</kbd> Archive all
            </button>
          ) : (
            <button type="button" className="rv-btn" onClick={onDislike}>
              <kbd>2</kbd> Dislike all
            </button>
          )}
          <button type="button" ref={composeRef} className="rv-btn" onClick={() => setOpen(!composerOpen)} aria-expanded={composerOpen}>
            <kbd>C</kbd> Comment on all
          </button>
          {composerOpen ? (
            <Floating anchorRef={composeRef} popRef={composePop} placement="top-center" className="rv-composer">
              <p>One comment, written on {plural(count, "frame")}</p>
              <textarea
                ref={areaRef}
                className="rv-textarea"
                value={body}
                placeholder="What should change on these frames?"
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="row">
                <button type="button" className="rv-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="rv-btn accent" disabled={!body.trim() || sending} onClick={() => void send()}>
                  {sending ? "Posting…" : `Post on ${count}`}
                </button>
              </div>
            </Floating>
          ) : null}
        </>
      ) : null}
      <button type="button" className="rv-btn" onClick={onDownload} title={count > 1 ? "Download the originals as a ZIP" : "Download the original"}>
        Download
      </button>
      {ownerTools ? (
        <>
          <span className="sep" />
          {ownerTools}
        </>
      ) : null}
      <span className="sep" />
      <button type="button" className="rv-btn ghost" onClick={onClear} title="Clear selection">
        <kbd>Esc</kbd> Clear
      </button>
    </div>
  );
}
