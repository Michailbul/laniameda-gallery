"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ago } from "@/lib/review-client";
import { Floating, usePopover } from "./Floating";
import { Avatar, personOf, type Person } from "./people";

// Comments on a whole style, next to "Like style · Dislike style" (Michael,
// 17 Nov 2026: "make sure they can add comment to whole style"). The button
// says how many there are; it opens the style's conversation with a reply
// box, the same look as a frame's conversation.

export type StyleTalkInfo = {
  slug: string;
  canComment: boolean;
  isOwner: boolean;
  people: Map<string, Person>;
  counts: Map<string, { count: number; open: number }>;
  onToast: (text: string, error?: boolean) => void;
};

export const StyleTalkContext = createContext<StyleTalkInfo | null>(null);

const message = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^[\s\S]*ConvexError: /, "").replace(/\s+at [\s\S]*$/, "") : "That did not work.";

export function StyleTalk({ styleId, label, tourTarget }: { styleId: string; label: string; tourTarget?: boolean }) {
  const info = useContext(StyleTalkContext);
  const [open, setOpen, anchorRef, popRef] = usePopover();
  if (!info) return null;
  const count = info.counts.get(styleId)?.count ?? 0;
  if (!info.canComment && count === 0) return null;
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="talk"
        data-tour={tourTarget ? "style-talk" : undefined}
        aria-expanded={open}
        title={`Comment on ${label} as a whole`}
        onClick={(event) => { event.stopPropagation(); setOpen(!open); }}
      >
        {count ? `Comments ${count}` : "Comment"}
      </button>
      {open ? (
        <Floating anchorRef={anchorRef} popRef={popRef} placement="bottom-start" className="rv-stalk" label={`${label}: comments on the style`}>
          <Thread info={info} styleId={styleId as Id<"worldStyles">} label={label} />
        </Floating>
      ) : null}
    </>
  );
}

function Thread({ info, styleId, label }: { info: StyleTalkInfo; styleId: Id<"worldStyles">; label: string }) {
  const thread = useQuery(api.review.styleComments, { slug: info.slug, styleId });
  const add = useMutation(api.review.addStyleComment);
  const remove = useMutation(api.review.deleteStyleComment);
  const resolve = useMutation(api.review.resolveStyleComment);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [thread?.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await add({ slug: info.slug, styleId, body: text });
      setBody("");
    } catch (error) {
      info.onToast(message(error), true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rv-chat">
      <div className="rv-lb-h">
        {label} · the style as a whole {thread?.length ? <b>{thread.length}</b> : null}
      </div>
      <div ref={log} className="rv-chat-log" role="log" aria-live="polite">
        {thread === undefined ? <div className="rv-cm-empty">Loading…</div> : null}
        {thread?.length === 0 ? <div className="rv-cm-empty">No comments on this style yet. Say what works in the look, or what doesn&apos;t.</div> : null}
        {thread?.map((row) => {
          const person = personOf(info.people, row.who);
          const name = row.mine ? "You" : person?.name ?? row.authorName;
          return (
            <div key={row.id} className="rv-msg" data-mine={row.mine ? "" : undefined} data-resolved={row.resolvedAt ? "" : undefined}>
              <Avatar
                person={person ?? { who: row.who ?? row.authorName, name: row.authorName, initials: row.authorName.slice(0, 1).toUpperCase(), role: row.authorRole, isYou: row.mine }}
                large
              />
              <div className="col">
                <div className="who">
                  <b>{name}</b>
                  {person?.title ? <span className="ttl">{person.title}</span> : null}
                  <span className="tm" suppressHydrationWarning>{ago(row.createdAt)}</span>
                  {row.versionLabel ? <span className="rd">{row.versionLabel}</span> : null}
                  {row.resolvedAt ? <span className="rd">done</span> : null}
                </div>
                <p className="bubble">{row.body}</p>
                {info.isOwner || row.mine ? (
                  <div className="tools">
                    {info.isOwner ? (
                      <button type="button" onClick={() => void resolve({ slug: info.slug, commentId: row.id, resolved: !row.resolvedAt }).catch((error) => info.onToast(message(error), true))}>
                        {row.resolvedAt ? "Reopen" : "Mark done"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void remove({ slug: info.slug, commentId: row.id }).catch((error) => info.onToast(message(error), true))}>Delete</button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {info.canComment ? (
        <div className="rv-chat-reply">
          <textarea
            ref={area}
            className="rv-textarea"
            value={body}
            rows={2}
            placeholder={thread?.length ? "Reply…" : `A note on ${label} as a whole…`}
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
  );
}
