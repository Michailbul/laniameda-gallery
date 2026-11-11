"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { pictureRect } from "@/lib/frame-flash";

// The note box that opens on a frame (C comment, V scene idea), in the vault
// grid, the open view and the world page. It sits on the picture it is about:
// no backdrop, nothing behind it stops scrolling. Enter saves a comment
// (Shift+Enter breaks the line), ⌘/Ctrl+Enter saves either kind, Esc closes.

export type FrameComposerKind = "comment" | "scene";

const COPY = {
  comment: {
    label: "Comment",
    placeholder: "What should change?",
    hint: "Enter saves · Shift+Enter new line",
    max: 4000,
  },
  scene: {
    label: "Scene idea",
    placeholder: "What happens in this scene?",
    hint: "⌘ / Ctrl + Enter saves",
    max: 200000,
  },
} as const;

/** How many of the frame's earlier comments show above the field. */
const THREAD_SHOWN = 3;
const EDGE = 8;

const ago = (at: number) => {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export function FrameComposer({
  frame,
  assetId,
  ownerUserId,
  kind = "comment",
  skin = "vault",
  portal = true,
  onSave,
  onClose,
}: {
  /** The frame the note is about, looked up fresh: a tile can remount while he types. */
  frame: () => HTMLElement | null;
  assetId: string;
  ownerUserId: string;
  kind?: FrameComposerKind;
  skin?: "vault" | "world";
  /** Render on the body (the vault) or where it is mounted (the world page, for its tokens). */
  portal?: boolean;
  /** Saves the note; true closes the composer, false keeps the text. */
  onSave: (body: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const copy = COPY[kind];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const thread = useQuery(
    api.assetComments.listAssetComments,
    kind === "comment" ? { ownerUserId, assetId: assetId as Id<"assets"> } : "skip",
  );

  // The handlers below are bound once; they read the latest values here.
  const live = useRef({ text, busy, frame, onSave, onClose });
  useEffect(() => {
    live.current = { text, busy, frame, onSave, onClose };
  });

  const submit = async () => {
    const body = live.current.text.trim();
    if (!body || live.current.busy) return;
    live.current.busy = true;
    setBusy(true);
    if (!(await live.current.onSave(body))) setBusy(false);
  };
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  // Follow the frame: over its lower edge, kept on screen while the frame is.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    let marked: HTMLElement | null = null;
    let last = "";
    const place = () => {
      raf = requestAnimationFrame(place);
      const node = live.current.frame();
      if (marked !== node) {
        marked?.removeAttribute("data-fc-frame");
        node?.setAttribute("data-fc-frame", "");
        marked = node;
      }
      if (!node) {
        if (last !== "gone") el.style.visibility = "hidden";
        last = "gone";
        return;
      }
      const box = pictureRect(node);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.round(Math.min(Math.max(box.width - EDGE * 2, 300), 430, vw - EDGE * 2));
      const height = el.offsetHeight;
      const left = Math.min(Math.max(box.left + EDGE, EDGE), vw - width - EDGE);
      // On the frame's lower edge; a frame shorter than the box lets it run past.
      let top = Math.max(box.bottom - EDGE - height, box.top + EDGE);
      if (box.bottom > 0 && box.top < vh) top = Math.min(Math.max(top, EDGE), vh - height - EDGE);
      const next = `${width}|${Math.round(left)}|${Math.round(top)}`;
      if (next === last) return;
      last = next;
      el.style.width = `${width}px`;
      el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      el.style.visibility = "visible";
    };
    place();
    return () => {
      cancelAnimationFrame(raf);
      marked?.removeAttribute("data-fc-frame");
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    field.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = root.current;
      if (!el) return;
      if (event.key === "Escape") {
        // Esc closes the note first; the view under it stays open.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!live.current.busy) live.current.onClose();
        return;
      }
      if (!el.contains(event.target as Node)) return;
      // Typing stays here: no frame key, arrow or page shortcut fires under it.
      event.stopPropagation();
      if (event.key !== "Enter" || event.isComposing) return;
      const chord = event.metaKey || event.ctrlKey;
      if (chord || (kind === "comment" && !event.shiftKey && !event.altKey)) {
        event.preventDefault();
        void submitRef.current();
      }
    };
    // A click elsewhere puts an empty note away; words are never dropped.
    const onDown = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (!live.current.text.trim() && !live.current.busy) live.current.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [kind]);

  const earlier = thread ?? [];
  const shown = earlier.slice(-THREAD_SHOWN);
  const hidden = earlier.length - shown.length;

  const panel = (
    <div
      ref={root}
      className="fc"
      data-skin={skin}
      data-kind={kind}
      role="group"
      aria-label={kind === "comment" ? "Comment on this frame" : "Scene idea for this frame"}
      style={{ visibility: "hidden" }}
    >
      <div className="fc-panel">
        <div className="fc-head">
          <span className="fc-label">{copy.label}</span>
          {earlier.length > 0 && (
            <span className="fc-count">
              {earlier.length} on this frame
            </span>
          )}
          <kbd>Esc</kbd>
        </div>
        {shown.length > 0 && (
          <ol className="fc-thread" aria-label="Earlier comments">
            {hidden > 0 && <li className="fc-more">+{hidden} earlier in the open view</li>}
            {shown.map((comment) => (
              <li key={comment._id} data-author={comment.author}>
                <span className="fc-who">
                  {comment.author === "agent" ? "Agent" : "You"} · {ago(comment.createdAt)}
                </span>
                <span className="fc-said">{comment.body || "Voice note"}</span>
              </li>
            ))}
          </ol>
        )}
        <textarea
          ref={field}
          className="fc-field"
          value={text}
          rows={2}
          maxLength={copy.max}
          placeholder={copy.placeholder}
          aria-label={copy.label}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            const area = event.target;
            area.style.height = "auto";
            area.style.height = `${Math.min(area.scrollHeight, 180)}px`;
          }}
        />
        <div className="fc-foot">
          <span>{copy.hint}</span>
          <button
            type="button"
            className="fc-save"
            disabled={busy || !text.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
  return portal ? createPortal(panel, document.body) : panel;
}
