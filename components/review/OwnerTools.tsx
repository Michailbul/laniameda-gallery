"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LIST_COLORS, LIST_KEYS, SECTION_LABEL, ago, copyText, plural, reviewBase, shortDate,
  type ListKey, type Lists, type ReviewFeedback, type ReviewFolder, type ReviewStyle, type ReviewVersion,
} from "@/lib/review-client";
import { Floating, usePopover } from "./Floating";
import { Avatar, type Person } from "./people";

// Michael's tools, loaded only for the owner and never in "view as
// director": what the shown round is and what can be done with it, the
// director's feedback in plain words, the people who can open the review,
// moving and removing selected frames, and his lists (keys 3–9).

const message = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^[\s\S]*ConvexError: /, "").replace(/\s+at [\s\S]*$/, "") : "That did not work.";

export type Audience = { name: string; plural: boolean };
const sees = (audience: Audience) => `${audience.name} ${audience.plural ? "see" : "sees"}`;

// ------------------------------------------------------------ round strip

type StripProps = {
  slug: string;
  shown?: ReviewVersion;
  current?: ReviewVersion;
  audience: Audience;
  itemCount: number;
  onShowRound: (version: ReviewVersion | null) => void;
  onToast: (text: string, error?: boolean) => void;
};

export function OwnerStrip({ slug, shown, current, audience, itemCount, onShowRound, onToast }: StripProps) {
  const publish = useMutation(api.review.publishDraft);
  const discard = useMutation(api.review.discardDraft);
  const makeCurrent = useMutation(api.review.setCurrentVersion);
  const [dialog, setDialog] = useState<"send" | "discard" | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!shown || (shown.isCurrent && !shown.isDraft)) return null;

  const run = async (work: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    try {
      await work();
      done();
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setBusy(false);
    }
  };

  const changes = shown.isDraft
    ? shown.added || shown.removed
      ? [shown.added ? plural(shown.added, "new frame") : "", shown.removed ? `${shown.removed} taken out` : ""].filter(Boolean).join(", ")
      : "Frames moved or restyled"
    : "";

  return (
    <>
      {shown.isDraft ? (
        <div className="rv-strip">
          <span className="k">Next round · {shown.label}</span>
          <span>
            <b>{changes}.</b> {sees(audience)} {current ? current.label : "nothing yet"} until you send it.
          </span>
          <span className="acts">
            <button type="button" className="rv-btn ghost" disabled={busy} onClick={() => setDialog("discard")}>Throw away</button>
            <button
              type="button"
              className="rv-btn accent"
              disabled={busy || itemCount === 0}
              onClick={() => {
                setTitle(shown.title ?? "");
                setNote(shown.note ?? "");
                setDialog("send");
              }}
            >
              Send to {audience.plural ? "reviewers" : audience.name}
            </button>
          </span>
        </div>
      ) : (
        <div className="rv-strip">
          <span className="k">Earlier round · {shown.label}</span>
          <span>
            From {shown.publishedAt ? shortDate(shown.publishedAt) : "before"}. {sees(audience)} {current?.label ?? "another round"} now.
          </span>
          <span className="acts">
            <button
              type="button"
              className="rv-btn"
              disabled={busy}
              onClick={() => void run(() => makeCurrent({ slug, version: shown.id }), () => onToast(`${sees(audience)} ${shown.label} again.`))}
            >
              Show this round to {audience.plural ? "them" : "the director"} again
            </button>
          </span>
        </div>
      )}

      {dialog ? (
        <div className="rv-dialog-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="rv-pop rv-dialog" role="dialog" aria-modal="true" style={{ position: "static" }}>
            {dialog === "send" ? (
              <>
                <h4>Send {shown.label} to {audience.name}</h4>
                <p>{changes}. {plural(itemCount, "frame")} in all. {audience.plural ? "They see" : "He sees"} it as soon as you send it.</p>
                <label>
                  Title, optional
                  <input className="rv-input" value={title} placeholder={`Round ${shown.number}`} onChange={(event) => setTitle(event.target.value)} autoFocus />
                </label>
                <label>
                  A note for {audience.name}, optional
                  <textarea className="rv-textarea" value={note} placeholder="What changed, what to look at" onChange={(event) => setNote(event.target.value)} />
                </label>
                <div className="row">
                  <button type="button" className="rv-btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                  <button
                    type="button"
                    className="rv-btn accent"
                    disabled={busy}
                    onClick={() => void run(() => publish({ slug, title, note }), () => {
                      setDialog(null);
                      onToast(`Sent. ${sees(audience)} ${shown.label} now.`);
                      onShowRound(null);
                    })}
                  >
                    {busy ? "Sending…" : `Send ${shown.label}`}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h4>Throw away the next round?</h4>
                <p>{changes}. They leave the round; the frames stay in the gallery. {sees(audience)} {current?.label ?? "nothing"} as before.</p>
                <div className="row">
                  <button type="button" className="rv-btn ghost" onClick={() => setDialog(null)}>Keep it</button>
                  <button
                    type="button"
                    className="rv-btn accent"
                    disabled={busy}
                    onClick={() => void run(() => discard({ slug }), () => {
                      setDialog(null);
                      onToast("The next round is thrown away.");
                      onShowRound(null);
                    })}
                  >
                    Throw away
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------ feedback panel

type PanelProps = {
  slug: string;
  people: Person[];
  reviewers: ReviewFeedback["reviewers"];
  audience: Audience;
  stats: { likes: number; dislikes: number; commented: number; fresh: number; styleLikes: number; styleDislikes: number };
  onlyTheirs: boolean;
  onOnlyTheirs: () => void;
  onMarkRead: () => void;
  onToast: (text: string, error?: boolean) => void;
  /** Anyone with the link may sign in with Google (owner setting). */
  openSignIn: boolean;
};

export function FeedbackPanel({ slug, people, reviewers, audience, stats, onlyTheirs, onOnlyTheirs, onMarkRead, onToast, openSignIn }: PanelProps) {
  const setOpenSignIn = useMutation(api.review.setOpenSignIn);
  const setRole = useMutation(api.review.setReviewerRole);
  const mergeGuest = useMutation(api.review.mergeGuest);
  const [merging, setMerging] = useState<string | null>(null);
  const others = people.filter((row) => row.role !== "owner" && row.role !== "agent");
  const lead = others.find((row) => row.role === "director") ?? others[0];
  // feedback.people lists the owner first, then the reviewers in the same order as feedback.reviewers.
  const reviewerOf = (person: Person) => reviewers[people.filter((row) => row.who !== "owner").indexOf(person)];
  const seenOf = (person: Person) => reviewerOf(person)?.lastSeenAt;
  const invited = others.filter((person) => !reviewerOf(person)?.guest);

  const toggleOpen = async () => {
    try {
      await setOpenSignIn({ slug, open: !openSignIn });
      onToast(openSignIn ? "Only invited people can sign in now." : "Anyone with the link can sign in as a guest now.");
    } catch (error) {
      onToast(message(error), true);
    }
  };

  const makeDirector = async (person: Person) => {
    const email = reviewerOf(person)?.email;
    if (!email) return;
    try {
      await setRole({ slug, email, role: "director" });
      onToast(`${person.name} can like and comment now.`);
    } catch (error) {
      onToast(message(error), true);
    }
  };

  const merge = async (guest: Person, into: Person) => {
    const guestEmail = reviewerOf(guest)?.email;
    const intoEmail = reviewerOf(into)?.email;
    if (!guestEmail || !intoEmail) return;
    if (!window.confirm(`${guest.name} (${guestEmail}) is ${into.name}? Their likes and comments move to ${into.name}, and that Google account signs in as ${into.name} from now on.`)) return;
    setMerging(guest.who);
    try {
      const moved = await mergeGuest({ slug, guestEmail, intoEmail });
      onToast(`${guest.name} is now ${into.name}: ${moved.verdicts} likes, ${moved.comments} comments moved.`);
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setMerging(null);
    }
  };
  const lastSeen = others.map(seenOf).filter((at): at is number => typeof at === "number").sort((a, b) => b - a)[0];
  const [open, setOpen, anchorRef, popRef] = usePopover();
  const [copying, setCopying] = useState<string | null>(null);

  const copyInvite = async (person: Person) => {
    const email = reviewers[people.filter((row) => row.who !== "owner").indexOf(person)]?.email;
    if (!email) return;
    setCopying(person.who);
    try {
      const base = reviewBase();
      const response = await fetch(`${base}/api/auth/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, name: person.name, base: `${window.location.origin}${base}` }),
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error ?? "Could not make the link.");
      if (await copyText(data.url)) onToast(`Invite link for ${person.name} copied. It works for 30 days.`);
      else onToast(data.url);
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setCopying(null);
    }
  };

  const viewAsDirector = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "director");
    url.searchParams.delete("r");
    window.location.assign(url.toString());
  };

  const nothing = stats.likes + stats.dislikes + stats.commented + stats.styleLikes + stats.styleDislikes === 0;
  const styleVotes = stats.styleLikes + stats.styleDislikes > 0;

  return (
    <div className="rv-fbk">
      {lead ? (
        <div className="who">
          <Avatar person={lead} large />
          <span className="tx">
            <b>{audience.name}</b>
            <span>{lastSeen ? `Looked ${ago(lastSeen)}` : `${audience.plural ? "Haven't" : "Hasn't"} opened it yet`}</span>
          </span>
        </div>
      ) : (
        <div className="nums">Nobody can open this review yet.</div>
      )}
      {lead ? (
        <div className="nums">
          {nothing ? (
            "No likes or comments yet."
          ) : (
            <>
              <b>{stats.likes}</b> {stats.likes === 1 ? "like" : "likes"} · <b>{stats.dislikes}</b> {stats.dislikes === 1 ? "dislike" : "dislikes"} · comments on <b>{stats.commented}</b> {stats.commented === 1 ? "frame" : "frames"}
              {styleVotes ? (
                <span className="sty">
                  Styles: <b>{stats.styleLikes}</b> liked · <b>{stats.styleDislikes}</b> disliked
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <div className="acts">
        {stats.fresh > 0 ? <span className="new">{stats.fresh} new</span> : null}
        {!nothing ? (
          <button type="button" className="rv-link" aria-pressed={onlyTheirs} onClick={onOnlyTheirs}>
            Only {audience.plural ? "their" : `${audience.name}'s`} feedback
          </button>
        ) : null}
        {stats.fresh > 0 ? <button type="button" className="rv-link" onClick={onMarkRead}>Mark as read</button> : null}
      </div>
      <div className="acts">
        <button type="button" ref={anchorRef} className="rv-link" onClick={() => setOpen(!open)} aria-expanded={open}>
          Who can open it · {others.length}
        </button>
        <button type="button" className="rv-link" onClick={viewAsDirector}>View as {audience.plural ? "reviewer" : "director"}</button>
      </div>
      {open ? (
        <Floating anchorRef={anchorRef} popRef={popRef} placement="right-end" label="Who can open this review">
          <div style={{ width: 360 }}>
            <div className="rv-pop-h">Who can open this review</div>
            <button type="button" className="rv-open-signin" aria-pressed={openSignIn} onClick={() => void toggleOpen()}>
              <span className="sw" aria-hidden="true" />
              <span className="tx">
                <b>{openSignIn ? "Guests can sign in" : "Invited people only"}</b>
                <span>{openSignIn ? "Anyone with the link can sign in with any Google account as a guest, who looks only. Directors like and comment." : "Only the people below can sign in. Invite links still work."}</span>
              </span>
            </button>
            {others.length === 0 ? <div className="rv-person"><span className="rv-cm-empty">Nobody yet.</span></div> : null}
            {others.map((person) => {
              const seen = seenOf(person);
              return (
                <div key={person.who} className="rv-person">
                  <Avatar person={person} large />
                  <div className="who">
                    <b>{person.name}</b>
                    <span>{reviewerOf(person)?.guest ? `${reviewerOf(person)?.wantsDirector ? "Asks to be director" : "Guest, looks only"} · ${reviewerOf(person)?.email ?? ""}` : person.title ?? (person.role === "viewer" ? "Looks only" : "Director")}</span>
                    <span>{seen ? `Looked ${ago(seen)}` : "Hasn't opened it yet"}</span>
                  </div>
                  {reviewerOf(person)?.guest ? (
                    <span className="rv-guest-acts">
                    <button
                      type="button"
                      className={reviewerOf(person)?.wantsDirector ? "rv-btn accent" : "rv-btn"}
                      title={reviewerOf(person)?.wantsDirector ? "Asked to be a director at sign-in" : undefined}
                      onClick={() => void makeDirector(person)}
                    >
                      Make director
                    </button>
                    <select
                      className="rv-same"
                      value=""
                      disabled={merging === person.who || invited.length === 0}
                      aria-label={`${person.name} is the same person as`}
                      onChange={(event) => {
                        const into = invited.find((row) => row.who === event.target.value);
                        if (into) void merge(person, into);
                      }}
                    >
                      <option value="">{merging === person.who ? "Merging…" : "Same person as…"}</option>
                      {invited.map((row) => <option key={row.who} value={row.who}>{row.name}</option>)}
                    </select>
                    </span>
                  ) : (
                    <button type="button" className="rv-btn" disabled={copying === person.who} onClick={() => void copyInvite(person)}>
                      {copying === person.who ? "…" : "Copy invite link"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Floating>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ selection tools

type BulkProps = {
  slug: string;
  itemIds: Id<"reviewItems">[];
  codes: string[];
  folders: ReviewFolder[];
  styles: ReviewStyle[];
  shown?: ReviewVersion;
  current?: ReviewVersion;
  audience: Audience;
  onDone: () => void;
  onToast: (text: string, error?: boolean) => void;
};

export function BulkOwnerTools({ slug, itemIds, codes, folders, styles, shown, current, audience, onDone, onToast }: BulkProps) {
  const update = useMutation(api.review.updateItems);
  const remove = useMutation(api.review.removeItems);
  const [folderOpen, setFolderOpen, folderRef, folderPop] = usePopover();
  const [styleOpen, setStyleOpen, styleRef, stylePop] = usePopover();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inDraft = Boolean(shown?.isDraft);
  const later = inDraft ? "" : ` ${sees(audience)} ${current?.label ?? "the current round"} unchanged until you send the next round.`;

  const apply = async (patch: { folderId?: Id<"reviewFolders">; styleId?: Id<"worldStyles"> | null }, label: string) => {
    setBusy(true);
    try {
      const result = await update({ slug, itemIds, ...patch });
      onToast(`${plural(result.changed, "frame")} ${label} in the next round (${result.draftLabel}).${later}`);
      setFolderOpen(false);
      setStyleOpen(false);
      onDone();
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    setBusy(true);
    try {
      const result = await remove({ slug, itemIds });
      onToast(`Took ${plural(result.removed, "frame")} out of the next round (${result.draftLabel}).${later}`);
      setConfirm(false);
      onDone();
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setBusy(false);
    }
  };

  const sections = [...new Set(folders.map((row) => row.section))];

  return (
    <>
      <button type="button" ref={folderRef} className="rv-btn" onClick={() => setFolderOpen(!folderOpen)} aria-expanded={folderOpen}>
        Move to folder
      </button>
      {folderOpen ? (
        <Floating anchorRef={folderRef} popRef={folderPop} placement="top-center">
          <div style={{ width: 300, maxHeight: 420, overflowY: "auto" }}>
            {sections.map((section) => (
              <div key={section}>
                <div className="rv-pop-h">{SECTION_LABEL[section]}</div>
                {folders.filter((row) => row.section === section).map((row) => (
                  <button key={row.id} type="button" className="rv-opt" disabled={busy} onClick={() => void apply({ folderId: row.id }, `moved to ${row.name}`)}>
                    {row.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Floating>
      ) : null}
      <button type="button" ref={styleRef} className="rv-btn" onClick={() => setStyleOpen(!styleOpen)} aria-expanded={styleOpen}>
        Change style
      </button>
      {styleOpen ? (
        <Floating anchorRef={styleRef} popRef={stylePop} placement="top-center">
          <div style={{ width: 260 }}>
            <div className="rv-pop-h">Style</div>
            {styles.map((row) => (
              <button key={row.id} type="button" className="rv-opt" disabled={busy} onClick={() => void apply({ styleId: row.id }, `set to ${row.label}`)}>
                {row.label}
              </button>
            ))}
          </div>
        </Floating>
      ) : null}
      {confirm ? (
        <button type="button" className="rv-btn accent" disabled={busy} onClick={() => void drop()} onBlur={() => setConfirm(false)}>
          Take {itemIds.length} out?
        </button>
      ) : (
        <button type="button" className="rv-btn" onClick={() => setConfirm(true)}>
          Remove from round
        </button>
      )}
      <button
        type="button"
        className="rv-btn"
        onClick={() => void copyText(codes.join("\n")).then((ok) => onToast(ok ? `Copied ${plural(codes.length, "code")}.` : "Could not copy.", !ok))}
      >
        Copy IDs
      </button>
    </>
  );
}

// ------------------------------------------------------------ remove a style

type RemoveStyleProps = {
  slug: string;
  style: { id: Id<"worldStyles">; label: string; roundCount: number };
  shown?: ReviewVersion;
  current?: ReviewVersion;
  audience: Audience;
  onClose: () => void;
  onToast: (text: string, error?: boolean) => void;
};

/** Takes every frame of a style out of the next round and drops the style from the carousel. */
export function RemoveStyleDialog({ slug, style, shown, current, audience, onClose, onToast }: RemoveStyleProps) {
  const removeStyle = useMutation(api.review.removeStyle);
  const [busy, setBusy] = useState(false);
  const inDraft = Boolean(shown?.isDraft);
  const run = async () => {
    setBusy(true);
    try {
      const result = await removeStyle({ slug, styleId: style.id, dropFromCarousel: true });
      onToast(
        `Removed ${style.label}: ${plural(result.removed, "frame")} out of the next round (${result.round}).` +
          (inDraft ? "" : ` ${sees(audience)} ${current?.label ?? "the current round"} unchanged until you send it.`),
      );
      onClose();
    } catch (error) {
      onToast(message(error), true);
      setBusy(false);
    }
  };
  return (
    <div className="rv-dialog-back" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div
        className="rv-pop rv-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={`Remove ${style.label}`}
        style={{ position: "static" }}
        onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}
      >
        <h4>Remove {style.label}?</h4>
        <p>
          Takes {plural(style.roundCount, "frame")} in {style.label} out of the next round
          {inDraft ? ` (${shown?.label})` : ""} and drops the style from the carousel. The frames stay in the gallery.
          {inDraft ? "" : ` ${sees(audience)} ${current?.label ?? "the current round"} until you send the next one.`}
        </p>
        <div className="row">
          <button type="button" className="rv-btn ghost" disabled={busy} onClick={onClose} autoFocus>Cancel</button>
          <button type="button" className="rv-btn accent" disabled={busy} onClick={() => void run()}>
            {busy ? "Removing…" : `Remove ${style.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ lists dock

type DockProps = {
  lists: Lists;
  viewing: ListKey | null;
  codeOf: (assetId: string) => string;
  onRename: (key: ListKey, name: string) => void;
  onView: (key: ListKey | null) => void;
  onToast: (text: string, error?: boolean) => void;
};

export function ListsDock({ lists, viewing, codeOf, onRename, onView, onToast }: DockProps) {
  const [open, setOpen] = useState(false);
  const total = LIST_KEYS.reduce((sum, key) => sum + lists.items[key].length, 0);

  const copy = async (key: ListKey) => {
    const ids = lists.items[key];
    const text = `${lists.names[key]} (${ids.length}):\n${ids.map(codeOf).join("\n")}`;
    onToast((await copyText(text)) ? `Copied ${lists.names[key]}: ${plural(ids.length, "code")}.` : "Could not copy.");
  };

  return (
    <div className="rv-dock">
      {open ? (
        <div className="rv-dock-panel" role="dialog" aria-label="Lists">
          <div className="rv-pop-h">Your lists · keys 3–9 on a frame</div>
          {LIST_KEYS.map((key, index) => (
            <div key={key} className="rv-list" data-on={viewing === key ? "" : undefined} style={{ "--c": LIST_COLORS[key] } as React.CSSProperties}>
              <kbd>{index + 3}</kbd>
              <input value={lists.names[key]} aria-label={`Name of list ${key}`} onChange={(event) => onRename(key, event.target.value)} />
              <span className="n">{lists.items[key].length}</span>
              <button type="button" disabled={!lists.items[key].length} onClick={() => onView(viewing === key ? null : key)}>
                {viewing === key ? "All" : "View"}
              </button>
              <button type="button" disabled={!lists.items[key].length} onClick={() => void copy(key)}>Copy</button>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className="rv-btn" data-on={open || viewing ? "" : undefined} onClick={() => setOpen(!open)} aria-expanded={open}>
        Lists{total ? <span className="sub">{total}</span> : null}
      </button>
    </div>
  );
}
