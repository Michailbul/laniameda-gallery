"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Mic, Pause, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDuration, shortAssetId } from "@/lib/inbox";
import { ActionButton, Micro, RADIUS, errorText, mono } from "./inbox-ui";

export type ImageNote = {
  commentId: Id<"assetComments">;
  author: "owner" | "agent";
  body: string;
  audioUrl?: string;
  audioDurationMs?: number;
  createdAt: number;
};

export type CardComment = { commentText?: string; audioUrl?: string; audioDurationMs?: number };

// MediaRecorder picks its own container: webm/opus in Chrome and Firefox,
// mp4/aac in Safari. Ask for the first one this browser can write.
const pickMimeType = () => {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
};

type RecorderPhase = { phase: "idle" } | { phase: "recording"; startedAt: number } | { phase: "uploading" };

function useVoiceRecorder(onRecorded: (blob: Blob, durationMs: number, contentType: string) => Promise<void>) {
  const [state, setState] = useState<RecorderPhase>({ phase: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (state.phase !== "recording") return;
    const timer = setInterval(() => setElapsed(Date.now() - state.startedAt), 200);
    return () => clearInterval(timer);
  }, [state]);

  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  };
  useEffect(() => () => { cancelled.current = true; recorder.current?.stop(); release(); }, []);

  const start = async () => {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio.");
      return;
    }
    try {
      cancelled.current = false;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const next = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      next.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      next.onstop = async () => {
        const durationMs = Date.now() - startedAt;
        const contentType = next.mimeType || mimeType || "audio/webm";
        release();
        if (cancelled.current || chunks.length === 0) { setState({ phase: "idle" }); return; }
        setState({ phase: "uploading" });
        try {
          await onRecorded(new Blob(chunks, { type: contentType }), durationMs, contentType);
        } catch (failure) {
          setError(errorText(failure, "The recording could not be saved."));
        }
        setState({ phase: "idle" });
      };
      recorder.current = next;
      next.start(250);
      setElapsed(0);
      setState({ phase: "recording", startedAt });
    } catch {
      release();
      setError("Microphone access was refused.");
      setState({ phase: "idle" });
    }
  };

  const stop = () => recorder.current?.stop();
  const cancel = () => { cancelled.current = true; recorder.current?.stop(); };
  return { state, elapsed, error, start, stop, cancel };
}

export function VoiceNote({ url, durationMs, compact }: { url: string; durationMs?: number; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = durationMs ?? 0;
  return <div className="flex min-w-0 flex-1 items-center gap-2.5">
    <audio ref={audio} src={url} preload="metadata"
      onTimeUpdate={(event) => setAt(event.currentTarget.currentTime * 1000)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0); }} />
    <button type="button" aria-label={playing ? "Pause voice note" : "Play voice note"}
      onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
      className={`grid shrink-0 place-items-center ${compact ? "h-7 w-7" : "h-9 w-9"}`} style={{ borderRadius: RADIUS, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>
      {playing ? <Pause size={compact ? 11 : 14} fill="currentColor" aria-hidden /> : <Play size={compact ? 11 : 14} fill="currentColor" aria-hidden />}
    </button>
    <div className="relative h-[3px] min-w-0 flex-1" style={{ background: "var(--lm-border-strong)" }}>
      <div className="absolute inset-y-0 left-0" style={{ width: `${total ? Math.min(100, (at / total) * 100) : 0}%`, background: "var(--lm-coral)" }} />
    </div>
    <Micro color="var(--lm-text-secondary)">{formatDuration(playing || at ? at : total)}</Micro>
  </div>;
}

const uploadAudio = async (url: string, blob: Blob, contentType: string) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: blob });
  if (!response.ok) throw new Error("The recording upload failed.");
  return ((await response.json()) as { storageId: Id<"_storage"> }).storageId;
};

type Target =
  // A note on one image: saved on the asset, so it shows wherever the image does.
  | { kind: "image"; assetId: Id<"assets">; notes: ImageNote[] }
  // A comment on the card as a whole (rule cards and multi-image decisions).
  | { kind: "card"; cardId: Id<"inboxCards">; comment?: CardComment };

/**
 * Text plus a voice recorder. No presets, no suggestions: Michael's words only.
 * Text saves on close or ⌘↵; a recording saves as soon as it stops.
 */
export function NoteSheet({ ownerUserId, target, onClose }: { ownerUserId: string; target: Target; onClose: () => void }) {
  const addNote = useMutation(api.assetComments.addAssetComment);
  const deleteNote = useMutation(api.assetComments.deleteAssetComment);
  const uploadUrl = useMutation(api.assetComments.generateCommentAudioUploadUrl);
  const setCardComment = useMutation(api.inbox.setInboxCardComment);
  const initial = target.kind === "card" ? target.comment?.commentText ?? "" : "";
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { field.current?.focus(); }, []);

  const recorder = useVoiceRecorder(async (blob, durationMs, contentType) => {
    const storageId = await uploadAudio(await uploadUrl({ ownerUserId }), blob, contentType);
    const audio = { storageId, durationMs, contentType };
    if (target.kind === "image") await addNote({ ownerUserId, assetId: target.assetId, body: "", audio, source: "inbox" });
    else await setCardComment({ ownerUserId, cardId: target.cardId, audio });
  });

  const close = useCallback(async () => {
    if (recorder.state.phase === "recording") recorder.stop();
    const text = draft.trim();
    if (text !== initial.trim()) {
      setSaving(true);
      try {
        if (target.kind === "image") await addNote({ ownerUserId, assetId: target.assetId, body: text, source: "inbox" });
        else await setCardComment({ ownerUserId, cardId: target.cardId, text: text || null });
      } catch (failure) {
        setError(errorText(failure, "The note could not be saved."));
        setSaving(false);
        return;
      }
    }
    onClose();
  }, [addNote, draft, initial, onClose, ownerUserId, recorder, setCardComment, target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const recording = recorder.state.phase === "recording";
  const cardAudio = target.kind === "card" ? target.comment?.audioUrl : undefined;
  return <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={target.kind === "image" ? "Note on this image" : "Comment on this card"}>
    <div className="absolute inset-0 animate-fade-in" style={{ background: "var(--lm-scrim)" }} onClick={() => void close()} aria-hidden />
    <div className="animate-sheet-slide-up absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t p-4 md:inset-x-auto md:bottom-6 md:right-6 md:w-[440px] md:border"
      style={{ background: "var(--lm-surface-1)", borderColor: "var(--lm-border-strong)", borderRadius: RADIUS, boxShadow: "var(--lm-modal-shadow)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Micro color="var(--lm-text-primary)">{target.kind === "image" ? `Note · ${shortAssetId(target.assetId)}` : "Comment on this card"}</Micro>
          <Micro color="var(--lm-text-ghost)" className="mt-0.5 block normal-case tracking-[0.06em]">
            {target.kind === "image" ? "Saved on the image: it shows wherever the image does." : "Saved with your answer for the agent."}
          </Micro>
        </div>
        <button type="button" onClick={() => void close()} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center" style={{ color: "var(--lm-text-tertiary)" }}>
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <X size={16} aria-hidden />}
        </button>
      </div>

      {target.kind === "image" && target.notes.length > 0 && <ol className="mb-3 flex list-none flex-col gap-2 p-0">
        {[...target.notes].reverse().map((note) => <li key={note.commentId} className="group relative flex flex-col gap-1.5 pl-2.5"
          style={{ borderLeft: `2px solid ${note.author === "agent" ? "var(--lm-border-strong)" : "var(--lm-coral)"}` }}>
          <div className="flex items-center gap-2">
            <Micro color={note.author === "agent" ? "var(--lm-text-tertiary)" : "var(--lm-coral)"}>{note.author === "agent" ? "Agent" : "You"}</Micro>
            <Micro color="var(--lm-text-ghost)">{new Date(note.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Micro>
            {note.author === "owner" && <button type="button" aria-label="Delete note" onClick={() => void deleteNote({ ownerUserId, commentId: note.commentId })}
              className="ml-auto opacity-60 hover:opacity-100" style={{ color: "var(--lm-text-tertiary)" }}><Trash2 size={12} aria-hidden /></button>}
          </div>
          {note.body && <p className="m-0 whitespace-pre-wrap text-[13px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>{note.body}</p>}
          {note.audioUrl && <VoiceNote url={note.audioUrl} durationMs={note.audioDurationMs} compact />}
        </li>)}
      </ol>}

      <textarea ref={field} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={4000}
        placeholder={target.kind === "image" ? "A note on this image." : "What you think."}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void close(); } }}
        className="lm-field w-full resize-none border px-3 py-2.5 text-[15px] leading-6 outline-none md:text-[14px]"
        style={{ background: "var(--lm-surface-0)", borderColor: "var(--lm-border)", color: "var(--lm-text-primary)", borderRadius: RADIUS }} />

      <div className="mt-3 flex min-h-[44px] items-center gap-2.5">
        {recording ? <>
          <button type="button" onClick={recorder.stop} aria-label="Stop recording"
            className="grid h-11 w-11 shrink-0 place-items-center" style={{ borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>
            <Square size={14} fill="currentColor" aria-hidden />
          </button>
          <span aria-hidden className="h-2 w-2 animate-pulse" style={{ borderRadius: 999, background: "var(--lm-coral)" }} />
          <Micro color="var(--lm-coral)" className="flex-1">Recording {formatDuration(recorder.elapsed)}</Micro>
          <ActionButton onClick={recorder.cancel}>Discard</ActionButton>
        </> : recorder.state.phase === "uploading" ? <>
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />
          <Micro>Saving voice note…</Micro>
        </> : cardAudio ? <>
          <VoiceNote key={cardAudio} url={cardAudio} durationMs={target.kind === "card" ? target.comment?.audioDurationMs : undefined} />
          <button type="button" onClick={() => void recorder.start()} aria-label="Record again" title="Record again"
            className="grid h-9 w-9 shrink-0 place-items-center border" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
            <RotateCcw size={14} aria-hidden />
          </button>
          <button type="button" aria-label="Delete voice comment" title="Delete voice comment"
            onClick={() => target.kind === "card" && void setCardComment({ ownerUserId, cardId: target.cardId, audio: null }).catch((failure) => setError(errorText(failure, "Could not delete.")))}
            className="grid h-9 w-9 shrink-0 place-items-center border" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
            <Trash2 size={14} aria-hidden />
          </button>
        </> : <>
          <button type="button" onClick={() => void recorder.start()}
            className="inline-flex h-11 items-center gap-2 px-4 text-[11px] font-bold uppercase tracking-[0.12em]"
            style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>
            <Mic size={15} aria-hidden /> Record
          </button>
          <Micro color="var(--lm-text-ghost)" className="hidden md:inline">⌘↵ saves · Esc closes</Micro>
        </>}
      </div>
      {(error || recorder.error) && <p className="mt-2 text-[12px]" style={{ color: "var(--lm-coral)" }}>{error ?? recorder.error}</p>}
    </div>
  </div>;
}
