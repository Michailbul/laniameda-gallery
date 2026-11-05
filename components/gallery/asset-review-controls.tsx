"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import "./asset-review.css";

type Target = { id: string; src: string; name: string };
type ArchiveItem = {
  assetId: string;
  deleteAt: number;
  name: string;
  thumb: string | null;
};
const EMPTY_ARCHIVE: ArchiveItem[] = [];
const ReviewContext = createContext<{
  archived: ArchiveItem[];
  restore: (id: string) => void;
}>({ archived: [], restore: () => {} });
export const useAssetReview = () => useContext(ReviewContext);

export function AssetReviewControls({
  ownerUserId,
  enabled,
  children,
}: {
  ownerUserId?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const active = Boolean(enabled && ownerUserId && isAuthenticated);
  const archived =
    useQuery(
      api.assetReview.list,
      active ? { ownerUserId: ownerUserId! } : "skip",
    ) ?? EMPTY_ARCHIVE;
  const archive = useMutation(api.assetReview.archive);
  const restoreMutation = useMutation(api.assetReview.restore);
  const saveStory = useMutation(api.stories.saveStory);
  const [trayOpen, setTrayOpen] = useState(false);
  const [editor, setEditor] = useState<{
    target: Target;
    kind: "comment" | "scene";
    key: string;
  } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(new Set<string>());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const restore = useCallback(
    async (id: string) => {
      if (!active || inFlight.current.has(id)) return;
      inFlight.current.add(id);
      try {
        await restoreMutation({
          ownerUserId: ownerUserId!,
          assetId: id as Id<"assets">,
        });
        setNotice("Restored to gallery");
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Could not restore asset",
        );
      } finally {
        inFlight.current.delete(id);
      }
    },
    [active, ownerUserId, restoreMutation],
  );

  const contextValue = useMemo(
    () => ({
      archived: active ? archived : EMPTY_ARCHIVE,
      restore: (id: string) => {
        void restore(id);
      },
    }),
    [active, archived, restore],
  );

  useEffect(() => {
    if (!active || !trayOpen) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, trayOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!editor) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    textarea.current?.focus();
    return () => previousFocus.current?.focus();
  }, [editor]);

  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        editor
      )
        return;
      const eventTarget = event.target as HTMLElement | null;
      if (
        eventTarget?.isContentEditable ||
        eventTarget?.closest("input, textarea, select, [role=textbox]")
      )
        return;
      const key = event.key.toLowerCase();
      if (!["d", "c", "v"].includes(key)) return;
      // Other open dialogs own their keys. The gallery detail view is allowed.
      const visible = (node: HTMLElement) => node.getClientRects().length > 0;
      if (
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"]:not([data-asset-detail])',
          ),
        ).some(visible) ||
        document.querySelector('[data-state="open"][role="menu"]')
      )
        return;
      const detail = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-review-detail][data-review-id]",
        ),
      ).find(visible);
      const pointed = pointer.current
        ? document
            .elementFromPoint(pointer.current.x, pointer.current.y)
            ?.closest<HTMLElement>("[data-review-id]")
        : null;
      const focused =
        document.activeElement?.closest<HTMLElement>("[data-review-id]");
      const frame = detail ?? pointed ?? focused;
      if (!frame?.dataset.reviewId || frame.dataset.reviewDisabled === "true")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = {
        id: frame.dataset.reviewId,
        src: frame.dataset.reviewSrc ?? "",
        name: frame.dataset.reviewName ?? "Scene",
      };
      if (key === "d") {
        if (
          archived.some((item) => item.assetId === target.id) ||
          inFlight.current.has(target.id)
        )
          return;
        inFlight.current.add(target.id);
        void archive({
          ownerUserId: ownerUserId!,
          assetId: target.id as Id<"assets">,
        })
          .then(() =>
            setNotice(
              "Archived · deletes in 10 minutes · double-click to restore",
            ),
          )
          .catch((error) =>
            setNotice(
              error instanceof Error
                ? error.message
                : "Could not archive asset",
            ),
          )
          .finally(() => inFlight.current.delete(target.id));
      } else {
        setText("");
        setEditor({
          target,
          kind: key === "c" ? "comment" : "scene",
          key: `asset-note:${crypto.randomUUID()}`,
        });
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [active, ownerUserId, archive, archived, editor]);

  async function save() {
    if (!editor || !text.trim() || busy) return;
    setBusy(true);
    try {
      await saveStory({
        ownerUserId: ownerUserId!,
        ingestKey: editor.key,
        title: text.trim().split("\n")[0].slice(0, 200),
        body: text.trim(),
        kind: "idea",
        status: "idea",
        tagNames: [
          editor.kind === "comment" ? "asset-comment" : "scene-note",
          "agent-review",
        ],
        assetIds: [editor.target.id as Id<"assets">],
      });
      setEditor(null);
      setNotice("Saved in Stories / Scripts · ready for agent review");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save note");
    } finally {
      setBusy(false);
    }
  }

  const remaining = (deleteAt: number) => {
    const seconds = Math.min(
      600,
      Math.max(0, Math.ceil((deleteAt - now) / 1000)),
    );
    return seconds
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "Deleting…";
  };

  return (
    <ReviewContext.Provider value={contextValue}>
      {children}
      {active && (
        <>
          <div className="asset-review-keybar">
            <span>
              <kbd>D</kbd> Archive
            </span>
            <span>
              <kbd>C</kbd> Comment
            </span>
            <span>
              <kbd>V</kbd> Scene idea
            </span>
            <button
              onClick={() => setTrayOpen(!trayOpen)}
              aria-expanded={trayOpen}
            >
              Archive · {archived.length}
            </button>
          </div>
          {trayOpen && (
            <aside className="asset-review-tray" aria-label="Archived assets">
              <header>
                <strong>ARCHIVE</strong>
                <button
                  onClick={() => setTrayOpen(false)}
                  aria-label="Close archive"
                >
                  ×
                </button>
              </header>
              <p>Double-click a frame to restore it before the timer ends.</p>
              <div className="asset-review-archive-grid">
                {archived.map((item) => (
                  <div key={item.assetId} className="asset-review-archive-item">
                    <button
                      className="asset-review-archive-image"
                      onDoubleClick={() => {
                        void restore(item.assetId);
                      }}
                      aria-label={`Restore ${item.name} with a double-click`}
                    >
                      {item.thumb && (
                        <Image
                          src={item.thumb}
                          alt={item.name}
                          width={200}
                          height={130}
                          unoptimized
                        />
                      )}
                    </button>
                    <span>{remaining(item.deleteAt)}</span>
                    <button
                      className="asset-review-restore"
                      onClick={(event) => {
                        event.stopPropagation();
                        void restore(item.assetId);
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
                {!archived.length && <p>Archive is empty.</p>}
              </div>
            </aside>
          )}
          {notice && (
            <div className="asset-review-notice" role="status">
              {notice}
            </div>
          )}
          {editor &&
            createPortal(
              <div
                className="asset-review-backdrop"
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  ref={dialog}
                  className="asset-review-editor"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="asset-note-title"
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape" && !busy) {
                      event.preventDefault();
                      setEditor(null);
                    }
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      void save();
                    }
                    if (event.key === "Tab") {
                      const nodes =
                        dialog.current?.querySelectorAll<HTMLElement>(
                          "textarea, button:not(:disabled)",
                        );
                      if (!nodes?.length) return;
                      const first = nodes[0],
                        last = nodes[nodes.length - 1];
                      if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                      }
                      if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                      }
                    }
                  }}
                >
                  {editor.target.src && (
                    <Image
                      className="asset-review-note-image"
                      src={editor.target.src}
                      alt="Source scene"
                      width={440}
                      height={620}
                      unoptimized
                    />
                  )}
                  <div className="asset-review-note-body">
                    <header>
                      <h2 id="asset-note-title">
                        {editor.kind === "comment"
                          ? "ASSET COMMENT"
                          : "SCENE / BEAT IDEA"}
                      </h2>
                      <button
                        onClick={() => setEditor(null)}
                        disabled={busy}
                        aria-label="Close note"
                      >
                        ×
                      </button>
                    </header>
                    <p>
                      Saved with this frame. Your agent can pick it up on the
                      next routine.
                    </p>
                    <textarea
                      ref={textarea}
                      aria-label={
                        editor.kind === "comment"
                          ? "Asset comment"
                          : "Scene or beat idea"
                      }
                      placeholder={
                        editor.kind === "comment"
                          ? "What should the agent know?"
                          : "What happens in this scene?"
                      }
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      disabled={busy}
                      maxLength={200000}
                    />
                    <footer>
                      <span>⌘ / Ctrl + Enter to save</span>
                      <button
                        disabled={busy || !text.trim()}
                        onClick={() => {
                          void save();
                        }}
                      >
                        {busy ? "Saving…" : "Save note"}
                      </button>
                    </footer>
                  </div>
                </div>
              </div>,
              document.body,
            )}
        </>
      )}
    </ReviewContext.Provider>
  );
}
