"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { plural } from "@/lib/review-client";
import { Bubble, Close, Download, ThumbDown, ThumbUp } from "./icons";
import { usePopover } from "./Chrome";

// The bar that appears when frames are selected: like, dislike or comment on
// all of them at once, download them as a ZIP, or clear the selection.

type BulkBarProps = {
  count: number;
  canVote: boolean;
  onLike: () => void;
  onDislike: () => void;
  onComment: (body: string) => Promise<boolean>;
  onDownload: () => void;
  onClear: () => void;
  composeSignal: number;
  ownerTools?: ReactNode;
};

export function BulkBar(props: BulkBarProps) {
  const { count, canVote, onLike, onDislike, onComment, onDownload, onClear, composeSignal, ownerTools } = props;
  const [composerOpen, setOpen, composerRef] = usePopover();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // C with a selection opens the composer.
  useEffect(() => {
    if (composeSignal > 0) setOpen(true);
  }, [composeSignal, setOpen]);
  useEffect(() => {
    if (composerOpen) areaRef.current?.focus();
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
          <button type="button" className="rv-btn" onClick={onLike} title="Like all (1)">
            <ThumbUp /> Like all
          </button>
          <button type="button" className="rv-btn" onClick={onDislike} title="Dislike all (2)">
            <ThumbDown /> Dislike all
          </button>
          <div style={{ position: "relative" }} ref={composerRef}>
            <button type="button" className="rv-btn" onClick={() => setOpen(!composerOpen)} aria-expanded={composerOpen} title="Comment on all (C)">
              <Bubble /> Comment on all
            </button>
            {composerOpen ? (
              <div className="rv-pop rv-pop-up rv-composer">
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
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setOpen(false);
                    }
                  }}
                />
                <div className="row">
                  <button type="button" className="rv-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="button" className="rv-btn coral" disabled={!body.trim() || sending} onClick={() => void send()}>
                    {sending ? "Posting…" : `Post on ${count}`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      <button type="button" className="rv-btn" onClick={onDownload} title={count > 1 ? "Download the originals as a ZIP" : "Download the original"}>
        <Download /> Download
      </button>
      {ownerTools ? (
        <>
          <span className="sep" />
          {ownerTools}
        </>
      ) : null}
      <span className="sep" />
      <button type="button" className="rv-btn ghost" onClick={onClear} title="Clear selection (Esc)">
        <Close size={12} /> Clear
      </button>
    </div>
  );
}
