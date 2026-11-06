"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img> with srcset, never next/image. */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LIST_COLORS, LIST_KEYS, ago, copyText, isTyping, mediaUrl, srcSetOf, thumbAtLeast,
  type ListKey, type Lists, type ReviewItem, type Verdict,
} from "@/lib/review-client";
import { ChevronLeft, ChevronRight, Close, Copy } from "./icons";
import { Avatar, personOf, type Person } from "./people";

// The open view: the frame as large as the screen allows (the 1440 rendition
// at once, the original once it has loaded or on zoom), arrows through the
// frames on screen, and a side panel: like / dislike / comment as quiet text
// actions with their keys, who liked it, the comment thread with faces and,
// for Michael only, his lists and how the frame was made.

export type LightboxVerdict = { person?: Person; verdict: Verdict; at: number };

type Props = {
  slug: string;
  item: ReviewItem;
  position: number;
  total: number;
  prev?: ReviewItem;
  next?: ReviewItem;
  mediaBase: string;
  folderName: string;
  styleLabel?: string;
  sectionLabel: string;
  roundLabel?: string;
  mine?: Verdict;
  verdicts: LightboxVerdict[];
  people: Map<string, Person>;
  canVote: boolean;
  isOwner: boolean;
  viewerName: string;
  viewerWho?: string;
  lists?: Lists;
  onList?: (key: ListKey) => void;
  focusComment: number;
  onVerdict: (verdict: Verdict) => void;
  onNav: (delta: number) => void;
  onClose: () => void;
  onDownload: () => void;
  onToast: (text: string, error?: boolean) => void;
};

const ORIGINAL_DELAY = 350;
const STAGE_SIZES = "(max-width: 900px) 100vw, calc(100vw - 440px)";

// Fetch the multi-megabyte original on its own only on a fast connection;
// on a slow or data-saving one it loads when the viewer zooms.
const fastConnection = () => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!connection) return true;
  return !connection.saveData && (connection.effectiveType === undefined || connection.effectiveType === "4g");
};

export default function Lightbox(props: Props) {
  const {
    slug, item, position, total, prev, next, mediaBase, folderName, styleLabel, sectionLabel, roundLabel,
    mine, verdicts, people, canVote, isOwner, viewerName, viewerWho, lists, onList, focusComment, onVerdict, onNav, onClose, onDownload, onToast,
  } = props;
  const assetId = item.assetId as Id<"assets">;
  const large = mediaUrl(mediaBase, thumbAtLeast(item.thumbs, 1400)?.src);
  const original = item.kind === "image" ? mediaUrl(mediaBase, item.original) : "";

  // ----------------------------------------------------------- stage
  const [take, setTake] = useState<string | null>(null); // an earlier take shown instead
  const [loaded, setLoaded] = useState<{ id: string; src: string } | null>(null);
  const [zoom, setZoom] = useState(0); // 0 = fit, else the scale
  const [wantOriginal, setWantOriginal] = useState<string | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [stateKey, setStateKey] = useState(item.assetId);
  if (stateKey !== item.assetId) {
    setStateKey(item.assetId);
    setTake(null);
    setZoom(0);
  }

  // The preview (srcset, sized to the stage) comes first; only once it is on
  // screen do the original and the neighbours start, so they never compete.
  const [previewReady, setPreviewReady] = useState<string | null>(null);
  const ready = previewReady === item.assetId;

  // Ask for the original after a short look (not while arrowing past), or at once on zoom.
  useEffect(() => {
    if (!original || !ready || !fastConnection()) return;
    const timer = window.setTimeout(() => setWantOriginal(item.assetId), ORIGINAL_DELAY);
    return () => window.clearTimeout(timer);
  }, [item.assetId, original, ready]);

  useEffect(() => {
    if (!original || wantOriginal !== item.assetId) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.src = original;
    image
      .decode()
      .then(() => { if (!cancelled) setLoaded({ id: item.assetId, src: original }); })
      .catch(() => null);
    return () => {
      cancelled = true;
      // Leaving the frame stops its original download.
      if (!image.complete) image.src = "";
    };
  }, [wantOriginal, item.assetId, original]);

  // Neighbours' previews, so the arrows feel instant.
  useEffect(() => {
    if (!ready) return;
    for (const neighbour of [next, prev]) {
      if (!neighbour || neighbour.kind !== "image") continue;
      const image = new Image();
      image.decoding = "async";
      image.sizes = STAGE_SIZES;
      image.srcset = srcSetOf(mediaBase, neighbour.thumbs);
      image.src = mediaUrl(mediaBase, thumbAtLeast(neighbour.thumbs, 1400)?.src);
    }
  }, [ready, next, prev, mediaBase]);

  const hasOriginal = loaded?.id === item.assetId;
  const stageSrc = take ?? (hasOriginal ? loaded!.src : large);
  const stageSrcSet = take || hasOriginal ? undefined : srcSetOf(mediaBase, item.thumbs);

  const setOrigin = (event: React.PointerEvent) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    img.style.transformOrigin = `${x}% ${y}%`;
  };

  const zoomScale = () => {
    const img = imgRef.current;
    if (!img) return 2;
    const rect = img.getBoundingClientRect();
    const fit = Math.min(rect.width / item.width, rect.height / item.height);
    return Math.max(2, Math.min(4, 1 / Math.max(0.05, fit)));
  };

  const toggleZoom = (event?: React.PointerEvent | React.MouseEvent) => {
    if (item.kind !== "image") return;
    if (event) setOrigin(event as React.PointerEvent);
    if (zoom) {
      setZoom(0);
      return;
    }
    setWantOriginal(item.assetId);
    setZoom(zoomScale());
  };

  // ----------------------------------------------------------- comments
  const thread = useQuery(api.review.comments, { slug, assetId });
  const detail = useQuery(api.review.itemDetail, isOwner ? { slug, assetId, ...(item.styleId ? { styleId: item.styleId } : {}) } : "skip");
  const addComment = useMutation(api.review.addComment).withOptimisticUpdate((store, args) => {
    for (const id of args.assetIds) {
      const current = store.getQuery(api.review.comments, { slug: args.slug, assetId: id });
      if (!current) continue;
      store.setQuery(api.review.comments, { slug: args.slug, assetId: id }, [
        ...current,
        {
          id: `pending-${Date.now()}` as Id<"reviewComments">,
          assetId: id,
          who: viewerWho,
          authorName: viewerName,
          authorEmail: undefined,
          authorRole: isOwner ? "owner" : "director",
          body: args.body.trim(),
          versionLabel: undefined,
          resolvedAt: undefined,
          createdAt: Date.now(),
          mine: true,
        },
      ]);
    }
    const feedback = store.getQuery(api.review.feedback, { slug: args.slug });
    if (feedback) {
      const comments = [...feedback.comments];
      for (const id of args.assetIds) {
        const index = comments.findIndex((row) => row.assetId === id);
        const now = Date.now();
        if (index >= 0) comments[index] = { ...comments[index]!, count: comments[index]!.count + 1, open: comments[index]!.open + 1, lastAt: now, lastByOwner: isOwner };
        else comments.push({ assetId: id, count: 1, open: 1, lastAt: now, lastByOwner: isOwner });
      }
      store.setQuery(api.review.feedback, { slug: args.slug }, { ...feedback, comments });
    }
  });
  const deleteComment = useMutation(api.review.deleteComment);
  const resolveComment = useMutation(api.review.resolveComment);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusComment > 0) areaRef.current?.focus();
  }, [focusComment]);
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setBody("");
    try {
      await addComment({ slug, assetIds: [assetId], body: text });
    } catch (error) {
      setBody(text);
      onToast(error instanceof Error ? error.message.replace(/^.*ConvexError: /, "") : "The comment was not saved.", true);
    } finally {
      setSending(false);
    }
  };

  // ----------------------------------------------------------- keys
  const keyState = useRef({ onNav, onClose, onVerdict, onList, toggle: () => {} });
  useEffect(() => {
    keyState.current = { onNav, onClose, onVerdict, onList, toggle: () => toggleZoom() };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const keys = keyState.current;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "escape" || key === "o" || key === "enter") {
        event.preventDefault();
        keys.onClose();
      } else if (key === "arrowleft") {
        event.preventDefault();
        keys.onNav(-1);
      } else if (key === "arrowright") {
        event.preventDefault();
        keys.onNav(1);
      } else if (key === "1" && canVote) {
        keys.onVerdict("like");
      } else if (key === "2" && canVote) {
        keys.onVerdict("dislike");
      } else if (key === "c" && canVote) {
        event.preventDefault();
        areaRef.current?.focus();
      } else if (key === "z") {
        keys.toggle();
      } else if (keys.onList && key >= "3" && key <= "9") {
        keys.onList(LIST_KEYS[Number(key) - 3]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canVote]);

  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    if (await copyText(item.code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  const previous = item.previous ?? [];

  return (
    <div className="rv-lb" role="dialog" aria-modal="true" aria-label={`${folderName} ${item.code}`}>
      <div className="rv-lb-stage">
        <span className="rv-lb-count">{position + 1} / {total}</span>
        {item.kind === "image" ? (
          <span className="rv-lb-res">{hasOriginal && !take ? `Original · ${item.width} × ${item.height}` : "Preview"}</span>
        ) : null}
        <div
          ref={mediaRef}
          className="rv-lb-media"
          data-zoom={zoom ? "" : undefined}
          onPointerMove={zoom ? setOrigin : undefined}
          onClick={(event) => {
            if (event.target === mediaRef.current) onClose();
          }}
        >
          {item.kind === "video" && item.original && !take ? (
            <video
              key={item.assetId}
              src={mediaUrl(mediaBase, item.original)}
              poster={large || undefined}
              autoPlay
              muted
              loop
              playsInline
              onClick={(event) => {
                const video = event.currentTarget;
                if (video.paused) void video.play();
                else video.pause();
              }}
            />
          ) : (
                        <img
              ref={imgRef}
              key={item.assetId}
              src={stageSrc}
              srcSet={stageSrcSet}
              sizes={stageSrcSet ? STAGE_SIZES : undefined}
              alt={`${folderName} ${styleLabel ?? ""} ${item.code}`}
              onLoad={() => setPreviewReady(item.assetId)}
              decoding="async"
              fetchPriority="high"
              draggable={false}
              style={{ transform: zoom ? `scale(${zoom})` : undefined }}
              onClick={(event) => toggleZoom(event)}
            />
          )}
        </div>
        {prev ? (
          <button type="button" className="rv-lb-nav prev" onClick={() => onNav(-1)} aria-label="Previous frame">
            <ChevronLeft />
          </button>
        ) : null}
        {next ? (
          <button type="button" className="rv-lb-nav next" onClick={() => onNav(1)} aria-label="Next frame">
            <ChevronRight />
          </button>
        ) : null}
      </div>

      <aside className="rv-lb-side">
        <div className="rv-lb-bar">
          <button type="button" className={`rv-chip${copied ? " ok" : ""}`} onClick={() => void copyCode()} title="Copy this frame's code">
            <Copy size={11} /> {copied ? "Copied" : item.code}
          </button>
          {item.isNew ? <span className="rv-chip new">New</span> : null}
          <button type="button" className="close" onClick={onClose} aria-label="Close (Esc)">
            <Close size={16} />
          </button>
        </div>

        <div className="rv-lb-title">
          <div className="kick">{sectionLabel}{roundLabel ? ` · ${roundLabel}` : ""}</div>
          <h3>{folderName}</h3>
          {styleLabel ? <div className="style">{styleLabel}</div> : null}
          {item.note ? <div className="cap">{item.note}</div> : null}
        </div>

        <div className="rv-lb-acts">
          {canVote ? (
            <>
              <button type="button" className="rv-act like" aria-pressed={mine === "like"} onClick={() => onVerdict("like")}>
                <kbd>1</kbd>
                <span>{mine === "like" ? "Liked" : "Like"}</span>
              </button>
              <button type="button" className="rv-act dislike" aria-pressed={mine === "dislike"} onClick={() => onVerdict("dislike")}>
                <kbd>2</kbd>
                <span>{mine === "dislike" ? "Disliked" : "Dislike"}</span>
              </button>
              <button type="button" className="rv-act" onClick={() => areaRef.current?.focus()}>
                <kbd>C</kbd>
                <span>Comment</span>
              </button>
            </>
          ) : null}
          <button type="button" className="rv-act" onClick={onDownload}>
            <span>Download original</span>
          </button>
        </div>

        {verdicts.length > 0 ? (
          <div>
            <div className="rv-lb-h">Who liked it</div>
            <div className="rv-verdicts">
              {verdicts.map((row, index) => (
                <div key={`${row.person?.who ?? index}-${row.verdict}`} className="rv-verdict">
                  <Avatar person={row.person} verdict={row.verdict} />
                  <span style={{ minWidth: 0 }}>
                    <b>{row.person?.isYou ? "You" : row.person?.name ?? "Someone"}</b>
                    {row.person?.title ? <span> · {row.person.title}</span> : null}
                  </span>
                  <span className={`v ${row.verdict}`}>{row.verdict === "like" ? "Liked" : "Disliked"}</span>
                  <span className="t" suppressHydrationWarning>{ago(row.at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isOwner && lists && onList ? (
          <div>
            <div className="rv-lb-h">Your lists</div>
            <div className="rv-lb-lists">
              {LIST_KEYS.map((key, index) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={lists.items[key].includes(item.assetId)}
                  style={{ "--c": LIST_COLORS[key] } as React.CSSProperties}
                  onClick={() => onList(key)}
                >
                  <kbd>{index + 3}</kbd>
                  {lists.names[key]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {previous.length > 0 ? (
          <div>
            <div className="rv-lb-h">Earlier takes <b>{previous.length}</b></div>
            <div className="rv-takes">
              <button type="button" aria-pressed={take === null} onClick={() => setTake(null)}>
                <img src={mediaUrl(mediaBase, thumbAtLeast(item.thumbs, 400)?.src)} alt="" />
                <span>Now</span>
              </button>
              {[...previous].reverse().map((row, index) => (
                <button
                  key={row.assetId}
                  type="button"
                  aria-pressed={take === mediaUrl(mediaBase, row.thumb)}
                  onClick={() => setTake(row.thumb ? mediaUrl(mediaBase, row.thumb) : null)}
                >
                  {row.thumb ? <img src={mediaUrl(mediaBase, row.thumb)} alt="" loading="lazy" /> : null}
                  <span>Take {previous.length - index}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="rv-lb-h">
            Comments {thread?.length ? <b>{thread.length}</b> : null}
          </div>
          <div className="rv-thread">
            {thread === undefined ? <div className="rv-cm-empty">Loading…</div> : null}
            {thread?.length === 0 ? <div className="rv-cm-empty">No comments on this frame yet.</div> : null}
            {thread?.map((row) => {
              const person = personOf(people, row.who);
              const pending = String(row.id).startsWith("pending");
              return (
                <div key={row.id} className="rv-cm" data-resolved={row.resolvedAt ? "" : undefined}>
                  <Avatar person={person ?? { who: row.who ?? row.authorName, name: row.authorName, initials: row.authorName.slice(0, 1).toUpperCase(), role: row.authorRole, isYou: row.mine }} large />
                  <div style={{ minWidth: 0 }}>
                    <div className="who">
                      <b>{row.mine ? "You" : person?.name ?? row.authorName}</b>
                      {person?.title ? <span className="ttl">{person.title}</span> : null}
                      <span className="tm" suppressHydrationWarning>{ago(row.createdAt)}{row.versionLabel ? ` · ${row.versionLabel}` : ""}{row.resolvedAt ? " · done" : ""}</span>
                    </div>
                    <p>{row.body}</p>
                    {!pending && (isOwner || row.mine) ? (
                      <div className="tools">
                        {isOwner ? (
                          <button type="button" onClick={() => void resolveComment({ slug, commentId: row.id, resolved: !row.resolvedAt }).catch(() => onToast("Could not update the comment.", true))}>
                            {row.resolvedAt ? "Reopen" : "Mark done"}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void deleteComment({ slug, commentId: row.id }).catch(() => onToast("Could not delete the comment.", true))}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div ref={threadEnd} />
          </div>
          {canVote ? (
            <div style={{ marginTop: 14 }}>
              <textarea
                ref={areaRef}
                className="rv-textarea"
                value={body}
                placeholder="Write a note on this frame…"
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="rv-send">
                <span>⌘ Enter to send</span>
                <button type="button" className="rv-btn accent" disabled={!body.trim() || sending} onClick={() => void send()}>
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {isOwner ? <MakingOf detail={detail} /> : null}
      </aside>
    </div>
  );
}

type Detail = {
  prompt?: string;
  modelName?: string;
  fileName?: string;
  galleryUrl?: string;
  midjourney?: { jobId?: string; profileCodes?: string[]; moodboardCodes?: string[]; parameters?: string } & Record<string, unknown>;
  style?: {
    name: string;
    line?: string;
    recipes: Array<{
      name?: string;
      moodboards: Array<{ name: string; code?: string }>;
      profiles: Array<{ name: string; code?: string }>;
      unknownCodes?: string[];
      parameters?: string;
      template?: string;
    }>;
  } | null;
} | null | undefined;

// Owner only: how the frame was made (prompt, Midjourney codes by name, the style's recipe).
function MakingOf({ detail }: { detail: Detail }) {
  if (detail === undefined) return <div className="rv-cm-empty">Loading how it was made…</div>;
  if (!detail) return null;
  const recipes = detail.style?.recipes ?? [];
  return (
    <details className="rv-making" open>
      <summary>How it was made · only you see this</summary>
      <div className="body">
        {detail.prompt ? (
          <div>
            <div className="k">Prompt</div>
            <pre>{detail.prompt}</pre>
          </div>
        ) : null}
        {detail.style ? (
          <div>
            <div className="k">Style · {detail.style.name}</div>
            {recipes.map((recipe, index) => (
              <div key={index} style={{ marginTop: index ? 10 : 0 }}>
                {recipe.name ? <div className="k" style={{ textTransform: "none", letterSpacing: 0 }}>{recipe.name}</div> : null}
                <div className="codes">
                  {recipe.moodboards.map((row) => (
                    <span key={`m${row.name}`} className="mb">{row.name}{row.code ? <i>{row.code}</i> : null}</span>
                  ))}
                  {recipe.profiles.map((row) => (
                    <span key={`p${row.name}`}>{row.name}{row.code ? <i>{row.code}</i> : null}</span>
                  ))}
                  {(recipe.unknownCodes ?? []).map((code) => <span key={`u${code}`}>unnamed<i>{code}</i></span>)}
                </div>
                {recipe.parameters ? <pre style={{ marginTop: 6 }}>{recipe.parameters}</pre> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {detail.modelName ? <span className="k" style={{ margin: 0 }}>{detail.modelName}</span> : null}
          {detail.galleryUrl ? <a href={detail.galleryUrl} target="_blank" rel="noreferrer">Open in gallery ↗</a> : null}
        </div>
      </div>
    </details>
  );
}
