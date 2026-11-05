"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Plus, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SrefCopyButton } from "./sref-copy-button";

export function MidjourneySrefsView({ ownerUserId, folderId }: { ownerUserId: string; folderId: Id<"folders"> }) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [parameters, setParameters] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const rows = useQuery(api.midjourneySrefs.list, { ownerUserId, folderId, search });
  const save = useMutation(api.midjourneySrefs.save);
  const inputStyle = { background: "var(--lm-surface-0)", borderColor: "var(--lm-border-subtle)", color: "var(--lm-text-primary)" };
  const inputClass = "w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <section className="px-4 pb-8 pt-4" style={{ fontFamily: "var(--lm-font)", color: "var(--lm-text-primary)" }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Midjourney srefs</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--lm-text-secondary)" }}>Styles you kept, ready for another prompt.</p>
        </div>
        <button type="button" onClick={() => { setAdding(!adding); setFeedback(null); }}
          aria-expanded={adding} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" style={inputStyle}>
          <Plus size={14} />{adding ? "Close" : "Save sref"}
        </button>
      </div>
      {adding ? (
        <form className="mb-5 grid gap-3 rounded-lg border p-4 sm:grid-cols-2" style={inputStyle}
          onSubmit={async event => {
            event.preventDefault();
            if (busy) return;
            setBusy(true); setFeedback(null);
            try {
              const result = await save({ ownerUserId, folderId, parameters,
                title: title.trim() || undefined, note: note.trim() || undefined, sourceUrl: sourceUrl.trim() || undefined });
              setFeedback({ text: result.created ? "Sref saved." : "This recipe is already saved." });
              setParameters(""); setTitle(""); setNote(""); setSourceUrl("");
            } catch (error) { setFeedback({ text: error instanceof Error ? error.message : "Could not save the sref.", error: true }); }
            finally { setBusy(false); }
          }}>
          <label className="grid gap-1 text-xs sm:col-span-2">Sref code or parameters
            <input required maxLength={2000} value={parameters} onChange={event => setParameters(event.target.value)}
              placeholder="--sref 3534013297 --sw 500 --v 8.2" className={`${inputClass} font-mono`} style={inputStyle} />
          </label>
          <label className="grid gap-1 text-xs">Name, optional
            <input maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="A name for this style" className={inputClass} style={inputStyle} />
          </label>
          <label className="grid gap-1 text-xs">Source link, optional
            <input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" className={inputClass} style={inputStyle} />
          </label>
          <label className="grid gap-1 text-xs sm:col-span-2">Note, optional
            <textarea maxLength={2000} value={note} onChange={event => setNote(event.target.value)} rows={2}
              placeholder="What you like about it, or where to use it" className={inputClass} style={inputStyle} />
          </label>
          <div className="sm:col-span-2">
            <button disabled={busy} type="submit" className="rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{ background: "var(--lm-ink)", color: "var(--lm-paper)" }}>{busy ? "Saving…" : "Save sref"}</button>
          </div>
        </form>
      ) : null}
      {feedback ? <p role={feedback.error ? "alert" : "status"} className="mb-3 text-sm"
        style={{ color: feedback.error ? "var(--lm-status-error-text)" : "var(--lm-text-secondary)" }}>{feedback.text}</p> : null}
      <label className="mb-5 flex max-w-lg items-center gap-2 rounded-md border px-3 py-2" style={inputStyle}>
        <Search size={14} aria-hidden="true" />
        <input aria-label="Search saved srefs" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Search codes, prompts or notes" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      {rows === undefined ? <p role="status" className="py-8 text-sm">Loading saved styles…</p> : rows.length === 0 ?
        <p className="py-8 text-sm" style={{ color: "var(--lm-text-secondary)" }}>{search ? "No saved srefs match." : "Save a code here, or add examples with --sref in their prompts to this collection."}</p> :
        <div className="grid gap-5 xl:grid-cols-2">
          {rows.map(row => (
            <article key={row.parameters} className="overflow-hidden rounded-lg border" style={inputStyle}>
              {row.examples.length ? <div className="grid grid-cols-2 gap-0.5">
                {row.examples.slice(0, 4).map(example => (
                  <a key={example.assetId} href={example.url} target="_blank" rel="noopener noreferrer" className="block aspect-video overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- saved gallery thumbnails */}
                    <img src={example.thumbUrl} alt={example.promptText ?? `Example for sref ${row.value}`} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div> : null}
              <div className="grid gap-3 p-4">
                <h3 className="break-words text-sm font-semibold">{row.title ?? `Sref ${row.value}`}</h3>
                <code className="select-text break-all text-xs leading-6">{row.parameters}</code>
                <div className="flex flex-wrap gap-2">
                  <SrefCopyButton text={`--sref ${row.value}`} />
                  {row.parameters !== `--sref ${row.value}` ? <SrefCopyButton text={row.parameters} label="Copy with settings" /> : null}
                </div>
                {row.note ? <p className="whitespace-pre-line text-xs leading-5" style={{ color: "var(--lm-text-secondary)" }}>{row.note}</p> : null}
                {row.sourceUrls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-xs" style={{ color: "var(--lm-coral)" }}><ExternalLink size={12} />{new URL(url).hostname} source</a>)}
                {row.examples.some(example => example.promptText) ? <details className="text-xs">
                  <summary className="cursor-pointer py-1">Example prompts ({row.examples.filter(example => example.promptText).length})</summary>
                  <div className="mt-2 grid gap-3">{row.examples.filter(example => example.promptText).map(example =>
                    <div key={example.assetId} className="grid gap-2 border-t pt-3" style={{ borderColor: "var(--lm-border-subtle)" }}>
                      <p className="select-text whitespace-pre-wrap leading-5">{example.promptText}</p>
                      <div><SrefCopyButton text={example.promptText!} label="Copy prompt" /></div>
                    </div>)}</div>
                </details> : null}
              </div>
            </article>
          ))}
        </div>}
    </section>
  );
}
