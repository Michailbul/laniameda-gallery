"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Micro, RADIUS, mono } from "@/components/inbox/inbox-ui";
import { timeAgo } from "@/components/gallery/world-ui";
import { PLATFORM_LABEL, PRESERVATION_LABEL, PRIVATE_PROCESSORS, type PrivateProcessor } from "@/lib/inspiration";
import { Chip, DecisionButton, HAIR, plural, useIntent } from "./parts";

// The private side of a reference, for Michael only: which outside services
// may see his private files (none until he allows one), each file with its
// clean copy status, download and delete, and how the reference arrived.

type Detail = NonNullable<FunctionReturnType<typeof api.inspiration.getInspiration>>;
type PrivateFile = Detail["privateMedia"][number];

const PROCESSOR_LABEL: Record<PrivateProcessor, string> = {
  fal: "fal", magnific: "Magnific", pika: "Pika", openai: "OpenAI", google: "Google",
  midjourney: "Midjourney", elevenlabs: "ElevenLabs", anthropic: "Anthropic",
};

const size = (bytes: number) => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Processors({ ownerUserId, detail }: { ownerUserId: string; detail: Detail }) {
  const setProcessor = useMutation(api.inspirationPrivate.setPrivateProcessor);
  const [choice, setChoice] = useState<PrivateProcessor>("fal");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const cleared = [...new Set(detail.privateMedia.flatMap((file) => file.clearedProcessors))].sort() as PrivateProcessor[];
  const change = async (processor: PrivateProcessor, allow: boolean) => {
    setPending(processor);
    setError(undefined);
    try {
      await setProcessor({ ownerUserId, sourceId: detail.sourceId, processor, cleared: allow });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^.*ConvexError: /, "") : "That did not go through.");
    } finally {
      setPending(null);
    }
  };
  const open = PRIVATE_PROCESSORS.filter((name) => !cleared.includes(name));
  return <div className="mt-3">
    <Micro>Outside services</Micro>
    <p className="mt-1 text-[13px] leading-5">
      {cleared.length === 0
        ? "None. No outside service sees these files; agents keep and look at them here only."
        : `Allowed: ${cleared.map((name) => PROCESSOR_LABEL[name]).join(", ")}. Only these may receive these files for paid takes.`}
    </p>
    {cleared.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {cleared.map((name) => <DecisionButton key={name} busy={pending === name} onClick={() => void change(name, false)}
        title={`Stop ${PROCESSOR_LABEL[name]} from receiving these files`}>Withdraw {PROCESSOR_LABEL[name]}</DecisionButton>)}
    </div>}
    {open.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="processor-pick">Service to allow</label>
      <select id="processor-pick" value={choice} onChange={(event) => setChoice(event.target.value as PrivateProcessor)}
        className="min-h-[44px] px-3 text-[12px] font-bold uppercase tracking-[0.08em]"
        style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", background: "var(--lm-surface-1)", color: "var(--lm-text-primary)" }}>
        {open.map((name) => <option key={name} value={name}>{PROCESSOR_LABEL[name]}</option>)}
      </select>
      <DecisionButton busy={pending === choice} disabled={!open.includes(choice)} onClick={() => void change(open.includes(choice) ? choice : open[0]!, true)}
        title="Lets paid takes for this reference send these files to that service">Allow</DecisionButton>
    </div>}
    <p className="mt-1 text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>
      Applies to {plural(detail.privateMedia.length, "private file")} of this reference. Generation still needs your allowance.
    </p>
    {error && <p role="status" className="mt-1 text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
  </div>;
}

function FileRow({ ownerUserId, file }: { ownerUserId: string; file: PrivateFile }) {
  const remove = useMutation(api.inspirationPrivate.deletePrivateMedia);
  const [armed, setArmed] = useState(false);
  const del = useIntent(useCallback(() => remove({ ownerUserId, mediaId: file.mediaId }), [file.mediaId, ownerUserId, remove]));
  const kind = file.kind === "audio" ? "Voice note" : file.kind === "video" ? "Video" : "Photo";
  return <li className="flex flex-col gap-2 py-2.5" style={{ borderTop: HAIR }}>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] font-bold">{file.label ?? kind}</span>
      <Chip tone="quiet">{size(file.size)}</Chip>
      {file.derivatives === "ready"
        ? <Chip title="Shown here as a copy with the camera and location details removed">Clean copy · no location</Chip>
        : <Chip tone="coral" title={file.derivativesNote}>{file.kind === "image" ? "Original only" : "Kept as received"}</Chip>}
    </div>
    {file.derivatives !== "ready" && file.derivativesNote && <p className="text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>{file.derivativesNote}</p>}
    <div className="flex flex-wrap gap-2">
      <a href={`${file.url}?variant=original&download=1`} download
        className="inline-flex min-h-[44px] items-center gap-2 px-4 text-[11px] font-black uppercase tracking-[0.12em]"
        style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-primary)" }}>
        <Download size={13} aria-hidden /> Original
      </a>
      <DecisionButton tone={armed ? "coral" : "ghost"} busy={del.status === "pending"}
        onClick={() => { if (!armed) { setArmed(true); return; } void del.run(); }}
        title="Removes the file and its copies for good">
        <Trash2 size={13} aria-hidden /> {armed ? "Tap again to delete for good" : "Delete"}
      </DecisionButton>
      {armed && del.status !== "pending" && <DecisionButton onClick={() => setArmed(false)}>Keep it</DecisionButton>}
    </div>
    {del.error && <p role="status" className="text-[12px]" style={{ color: "var(--lm-status-error)" }}>{del.error}</p>}
  </li>;
}

export function PrivateFiles({ ownerUserId, detail }: { ownerUserId: string; detail: Detail }) {
  if (detail.privateMedia.length === 0) return null;
  return <section aria-label="Private files" className="mt-4 pt-4" style={{ borderTop: "1px solid var(--lm-border-strong)" }}>
    <div className="flex items-center justify-between gap-2">
      <Micro color="var(--lm-coral)">Private files · only you</Micro>
      <a href="/api/inspiration/export" className="text-[11px] font-bold uppercase tracking-[0.1em] underline underline-offset-4"
        style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Export list</a>
    </div>
    <ul className="mt-2">{detail.privateMedia.map((file) => <FileRow key={file.mediaId} ownerUserId={ownerUserId} file={file} />)}</ul>
    <Processors ownerUserId={ownerUserId} detail={detail} />
  </section>;
}

/** How the reference reached the gallery: every arrival kept on its own. */
export function Arrivals({ detail }: { detail: Detail }) {
  if (detail.captures.length === 0) return null;
  return <ul className="flex flex-col gap-1.5">{detail.captures.map((capture) => {
    const via = capture.channel === "telegram"
      ? `Telegram, your private chat${capture.forwardedFrom ? ` · forwarded from ${capture.forwardedFrom}` : ""}`
      : capture.channel === "share_sheet" ? "Shared from your phone"
        : capture.channel === "browser" ? "Saved from the browser"
          : capture.channel === "import" ? "Imported" : "Saved by an agent";
    return <li key={capture.captureId} className="text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
      <span className="font-bold" style={{ color: "var(--lm-text-primary)" }}>{PLATFORM_LABEL[capture.platform]}</span>
      {capture.creator && <> · {capture.creator}</>} · {PRESERVATION_LABEL[capture.representation]}
      {capture.captureRevision > 1 && <> · edited ({capture.captureRevision})</>}
      <span style={{ color: "var(--lm-text-tertiary)" }}> · {via} · {timeAgo(capture.createdAt)}</span>
    </li>;
  })}</ul>;
}
