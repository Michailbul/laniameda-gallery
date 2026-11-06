"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SECTION_LABEL, ago, copyText, plural, reviewBase,
  type ReviewFeedback, type ReviewFolder, type ReviewStyle, type ReviewVersion,
} from "@/lib/review-client";
import { usePopover } from "./Chrome";
import { Copy } from "./icons";

// Michael's tools, loaded only for the owner: the round (draft, publish,
// make current, discard), the director's new feedback, reviewers with
// invite links, and moving or removing selected frames in the draft.

const message = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^[\s\S]*ConvexError: /, "").replace(/\s+at [\s\S]*$/, "") : "That did not work.";

type RoundPanelProps = {
  slug: string;
  versions: ReviewVersion[];
  shown?: ReviewVersion;
  newCount: number;
  itemCount: number;
  freshCount: number;
  showingFresh: boolean;
  reviewers: ReviewFeedback["reviewers"];
  onShowRound: (version: ReviewVersion | null) => void;
  onShowFresh: () => void;
  onMarkRead: () => void;
  onToast: (text: string, error?: boolean) => void;
};

export function RoundPanel(props: RoundPanelProps) {
  const { slug, versions, shown, newCount, itemCount, freshCount, showingFresh, reviewers, onShowRound, onShowFresh, onMarkRead, onToast } = props;
  const publish = useMutation(api.review.publishDraft);
  const discard = useMutation(api.review.discardDraft);
  const makeCurrent = useMutation(api.review.setCurrentVersion);
  const createDraft = useMutation(api.review.createDraft);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"publish" | "discard" | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const draft = versions.find((row) => row.isDraft);
  const current = versions.find((row) => row.isCurrent);

  const run = async <T,>(work: () => Promise<T>, done: (value: T) => void) => {
    setBusy(true);
    try {
      done(await work());
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rv-owner">
        <div className="h">
          Round <b>{shown?.label ?? "—"}</b>
          {shown?.isDraft ? <span className="rv-opt"><span className="tag draft">Draft</span></span> : null}
          {shown?.isCurrent ? <span className="rv-opt"><span className="tag cur">Current</span></span> : null}
        </div>
        {shown?.isDraft ? (
          <>
            <div className="line">
              Draft <b>{shown.label}</b> · {plural(itemCount, "frame")}{newCount ? ` · ${newCount} new` : ""}. The director sees {current ? current.label : "nothing yet"}.
            </div>
            <div className="acts">
              <button type="button" className="rv-btn coral" disabled={busy} onClick={() => { setTitle(shown.title ?? ""); setNote(shown.note ?? ""); setDialog("publish"); }}>
                Publish
              </button>
              <button type="button" className="rv-btn" disabled={busy} onClick={() => setDialog("discard")}>Discard</button>
              {current ? <button type="button" className="rv-btn ghost" onClick={() => onShowRound(null)}>See {current.label}</button> : null}
            </div>
          </>
        ) : (
          <>
            <div className="line">
              {shown?.isCurrent ? <>The director sees this round.</> : <>An earlier round. The director sees {current?.label ?? "another round"}.</>}
            </div>
            <div className="acts">
              {shown && !shown.isCurrent && shown.status === "published" ? (
                <button
                  type="button"
                  className="rv-btn coral"
                  disabled={busy}
                  onClick={() => void run(() => makeCurrent({ slug, version: shown.id }), (result) => onToast(`${result.label} is the current round again.`))}
                >
                  Make current
                </button>
              ) : null}
              {draft ? (
                <button type="button" className="rv-btn" onClick={() => onShowRound(draft)}>Open draft {draft.label}</button>
              ) : (
                <button
                  type="button"
                  className="rv-btn"
                  disabled={busy}
                  onClick={() => void run(() => createDraft({ slug }), (result) => {
                    onToast(`Draft ${result.draftLabel} started from ${current?.label ?? "scratch"}.`);
                    onShowRound({ ...(current ?? versions[0]!), id: result.draftVersionId, label: result.draftLabel, isDraft: true, isCurrent: false, status: "draft" });
                  })}
                >
                  Start a draft
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rv-owner">
        <div className="h">
          Feedback {freshCount > 0 ? <span className="rv-badge">{freshCount}</span> : <b>up to date</b>}
        </div>
        <div className="acts">
          {freshCount > 0 ? (
            <button type="button" className="rv-btn" data-on={showingFresh ? "" : undefined} onClick={onShowFresh}>
              {showingFresh ? "Showing new" : "Show new"}
            </button>
          ) : null}
          {freshCount > 0 ? <button type="button" className="rv-btn ghost" onClick={onMarkRead}>Mark read</button> : null}
          <Reviewers reviewers={reviewers} onToast={onToast} />
        </div>
      </div>

      {dialog ? (
        <div className="rv-dialog-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="rv-pop rv-dialog" role="dialog" aria-modal="true">
            {dialog === "publish" && shown ? (
              <>
                <h4>Publish {shown.label}</h4>
                <p>The director sees this round ({plural(itemCount, "frame")}{newCount ? `, ${newCount} new` : ""}) as soon as you publish.</p>
                <label>
                  Title
                  <input className="rv-input" value={title} placeholder="Round 2: night and day" onChange={(event) => setTitle(event.target.value)} autoFocus />
                </label>
                <label>
                  Note for the director
                  <textarea className="rv-textarea" value={note} placeholder="What changed, what to look at" onChange={(event) => setNote(event.target.value)} />
                </label>
                <div className="row">
                  <button type="button" className="rv-btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                  <button
                    type="button"
                    className="rv-btn coral"
                    disabled={busy}
                    onClick={() => void run(() => publish({ slug, title, note }), (result) => {
                      setDialog(null);
                      onToast(`Published ${result.label} · ${plural(result.items, "frame")}.`);
                      onShowRound(null);
                    })}
                  >
                    {busy ? "Publishing…" : `Publish ${shown.label}`}
                  </button>
                </div>
              </>
            ) : null}
            {dialog === "discard" && shown ? (
              <>
                <h4>Discard draft {shown.label}?</h4>
                <p>Its frames leave the draft. Published rounds and the gallery stay as they are.</p>
                <div className="row">
                  <button type="button" className="rv-btn ghost" onClick={() => setDialog(null)}>Keep it</button>
                  <button
                    type="button"
                    className="rv-btn coral"
                    disabled={busy}
                    onClick={() => void run(() => discard({ slug }), () => {
                      setDialog(null);
                      onToast(`Draft ${shown.label} discarded.`);
                      onShowRound(null);
                    })}
                  >
                    Discard
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Reviewers({ reviewers, onToast }: { reviewers: ReviewFeedback["reviewers"]; onToast: (text: string, error?: boolean) => void }) {
  const [open, setOpen, popoverRef] = usePopover();
  const [copying, setCopying] = useState<string | null>(null);

  const copyInvite = async (email: string, name?: string) => {
    setCopying(email);
    const base = reviewBase();
    try {
      const response = await fetch(`${base}/api/auth/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, name, base: `${window.location.origin}${base}` }),
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error ?? "Could not make the link.");
      if (await copyText(data.url)) onToast(`Invite link for ${name ?? email} copied. It works for 30 days.`);
      else onToast(data.url);
    } catch (error) {
      onToast(message(error), true);
    } finally {
      setCopying(null);
    }
  };

  return (
    <div className="rel" ref={popoverRef}>
      <button type="button" className="rv-btn ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        Reviewers {reviewers.length}
      </button>
      {open ? (
        <div className="rv-pop" style={{ left: 0, bottom: "calc(100% + 8px)", width: 330 }}>
          <div className="rv-pop-h">Who can open this review</div>
          {reviewers.length === 0 ? <div className="rv-reviewer"><span className="rv-cm-empty">Nobody yet. Add reviewers through the agent.</span></div> : null}
          {reviewers.map((row) => (
            <div key={row.email} className="rv-reviewer">
              <div className="who">
                <b>{row.name ?? row.email.split("@")[0]}</b>
                <span>{row.email}</span>
                <span>{row.role === "viewer" ? "Looks only" : "Director"} · {row.lastSeenAt ? `seen ${ago(row.lastSeenAt)}` : "not opened yet"}</span>
              </div>
              <button type="button" className="rv-btn" disabled={copying === row.email} onClick={() => void copyInvite(row.email, row.name)}>
                <Copy size={12} /> {copying === row.email ? "…" : "Invite link"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ selection tools

type MoveToolsProps = {
  slug: string;
  itemIds: Id<"reviewItems">[];
  folders: ReviewFolder[];
  styles: ReviewStyle[];
  isDraft: boolean;
  draftLabel?: string;
  onDone: () => void;
  onToast: (text: string, error?: boolean) => void;
};

export function MoveTools({ slug, itemIds, folders, styles, isDraft, draftLabel, onDone, onToast }: MoveToolsProps) {
  const update = useMutation(api.review.updateItems);
  const remove = useMutation(api.review.removeItems);
  const [open, setOpen, popoverRef] = usePopover();
  const [folderId, setFolderId] = useState("");
  const [styleId, setStyleId] = useState("keep");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const where = isDraft ? "the draft" : draftLabel ? `draft ${draftLabel}` : "a new draft";

  const apply = async () => {
    setBusy(true);
    try {
      const result = await update({
        slug,
        itemIds,
        ...(folderId ? { folderId: folderId as Id<"reviewFolders"> } : {}),
        ...(styleId === "none" ? { styleId: null } : styleId !== "keep" ? { styleId: styleId as Id<"worldStyles"> } : {}),
      });
      onToast(`Moved ${plural(result.changed, "frame")} in draft ${result.draftLabel}.`);
      setOpen(false);
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
      onToast(`Took ${plural(result.removed, "frame")} out of draft ${result.draftLabel}.`);
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
      <div style={{ position: "relative" }} ref={popoverRef}>
        <button type="button" className="rv-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          Move
        </button>
        {open ? (
          <div className="rv-pop rv-pop-up rv-composer">
            <p>Move {plural(itemIds.length, "frame")} in {where}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select className="rv-input rv-select" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                <option value="">Same folder</option>
                {sections.map((section) => (
                  <optgroup key={section} label={SECTION_LABEL[section]}>
                    {folders.filter((row) => row.section === section).map((row) => (
                      <option key={row.id} value={row.id}>{row.area ? `${row.area} · ` : ""}{row.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select className="rv-input rv-select" value={styleId} onChange={(event) => setStyleId(event.target.value)}>
                <option value="keep">Same style</option>
                {styles.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
                <option value="none">No style</option>
              </select>
            </div>
            <div className="row">
              <button type="button" className="rv-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="rv-btn coral" disabled={busy || (!folderId && styleId === "keep")} onClick={() => void apply()}>
                {busy ? "Moving…" : "Move"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {confirm ? (
        <button type="button" className="rv-btn coral" disabled={busy} onClick={() => void drop()} onBlur={() => setConfirm(false)}>
          Remove {itemIds.length} from {isDraft ? "draft" : where}?
        </button>
      ) : (
        <button type="button" className="rv-btn" onClick={() => setConfirm(true)} title={`Take them out of ${where}; earlier rounds keep them`}>
          Remove
        </button>
      )}
    </>
  );
}
