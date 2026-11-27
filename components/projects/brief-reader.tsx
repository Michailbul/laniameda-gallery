"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Download, Loader2, X } from "lucide-react";
import {
  BRIEF_KIND_LABELS, SANDBOX_FLAGS, briefDownloadUrl, defaultReaderFile, briefFileLabel, briefReaderMode, type BriefKind,
} from "@/lib/brief-documents";

// The project room's reader (/w/<world>/project): a brief's script, scene
// breakdown or document read in place. HTML runs in a sandboxed frame with
// no gallery origin (the file route also sends a CSP sandbox), Markdown is
// rendered here without raw HTML, PDFs use the browser's viewer, text is
// monospace, anything else downloads. Owner only: every byte comes through
// /api/briefs/<briefId>/files/<key>. Loaded on demand (dynamic import).

export type ReaderFile = { key: string; name: string; contentType: string; size: number; pages?: number; url: string };
export type ReaderBrief = { id: string; title: string; kind: BriefKind; from?: string; receivedAt?: number; files: ReaderFile[] };

const day = (at?: number) => at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : undefined;
const size = (bytes: number) => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

export function BriefReader({ brief, initialKey, onClose }: { brief: ReaderBrief; initialKey?: string; onClose: () => void }) {
  const [key, setKey] = useState(() => initialKey ?? defaultReaderFile(brief.files)?.key);
  const file = brief.files.find((row) => row.key === key) ?? brief.files[0];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const meta = [brief.from ? `From ${brief.from}` : null, day(brief.receivedAt)].filter(Boolean).join(" · ");
  return (
    <div className="lmr" role="dialog" aria-modal="true" aria-label={brief.title}>
      <style>{CSS}</style>
      <header className="lmr-bar">
        <div className="lmr-title">
          <span className="lmr-badge">{BRIEF_KIND_LABELS[brief.kind]}</span>
          <h2>{brief.title}</h2>
          {meta ? <span className="lmr-mono lmr-meta">{meta}</span> : null}
        </div>
        <div className="lmr-actions">
          {file ? (
            <>
              <a className="lmr-btn ghost" href={file.url} target="_blank" rel="noreferrer">Open in new tab <ArrowUpRight size={12} aria-hidden /></a>
              <a className="lmr-btn ghost" href={briefDownloadUrl(file.url)}>Download <Download size={12} aria-hidden /></a>
            </>
          ) : null}
        </div>
        <button ref={closeRef} type="button" className="lmr-close" onClick={onClose} aria-label="Close the reader (Esc)"><X size={16} aria-hidden /></button>
        {brief.files.length > 1 ? (
          <nav className="lmr-files" aria-label="Files">
            {brief.files.map((row) => (
              <button key={row.key} type="button" className="lmr-file" data-on={row.key === file?.key ? "" : undefined} onClick={() => setKey(row.key)}>
                <span className="lmr-mono">{briefFileLabel(row.contentType, row.name)}</span>{row.name}
              </button>
            ))}
          </nav>
        ) : null}
      </header>
      <div className="lmr-body">
        {file ? <FileView key={file.key} file={file} /> : <p className="lmr-empty">This has no file yet.</p>}
      </div>
    </div>
  );
}

function FileView({ file }: { file: ReaderFile }) {
  const mode = briefReaderMode(file.contentType, file.name);
  if (mode === "html") {
    // No allow-same-origin: the document can never reach the gallery's session.
    return <iframe className="lmr-frame lmr-frame-page" src={file.url} title={file.name} sandbox={SANDBOX_FLAGS} referrerPolicy="no-referrer" />;
  }
  if (mode === "pdf") return <iframe className="lmr-frame" src={file.url} title={file.name} />;
  if (mode === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <div className="lmr-picture"><img src={file.url} alt={file.name} /></div>;
  }
  if (mode === "markdown" || mode === "text") return <TextView file={file} markdown={mode === "markdown"} />;
  return (
    <div className="lmr-download">
      <span className="lmr-mono">{briefFileLabel(file.contentType, file.name)} · {size(file.size)}</span>
      <b>{file.name}</b>
      <p>This kind of file opens in its own app. Save it to read it.</p>
      <a className="lmr-btn" href={briefDownloadUrl(file.url)}>Download <Download size={12} aria-hidden /></a>
    </div>
  );
}

const MD: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children }) => <div className="lmr-table"><table>{children}</table></div>,
};

function TextView({ file, markdown }: { file: ReaderFile; markdown: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(file.url, { credentials: "same-origin", cache: "no-store", signal: abort.signal })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(String(response.status))))
      .then(setText)
      .catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [file.url]);
  if (failed) return <p className="lmr-empty">Could not read this file. Try Open in new tab.</p>;
  if (text === null) return <div className="lmr-loading"><Loader2 className="animate-spin" size={16} aria-label="Loading the file" /></div>;
  if (!markdown) return <pre className="lmr-pre">{text}</pre>;
  return (
    <article className="lmr-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{text}</ReactMarkdown>
    </article>
  );
}

const CSS = `
.lmr{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;background:var(--lm-paper);color:var(--lm-text-primary);font-family:var(--font-geist-sans),system-ui,sans-serif}
.lmr-mono,.lmr-badge{font-family:var(--font-geist-mono),ui-monospace,monospace}
.lmr-bar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"title actions close" "files files files";align-items:center;gap:10px 16px;padding:12px 16px;border-bottom:1px solid var(--lm-border-subtle);background:color-mix(in srgb,var(--lm-paper) 92%,transparent)}
.lmr-title{grid-area:title;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;min-width:0}
.lmr-title h2{font-size:clamp(17px,2.4vw,24px);font-weight:900;text-transform:uppercase;letter-spacing:-.01em;line-height:1.05;min-width:0;overflow-wrap:anywhere}
.lmr-badge{display:inline-flex;align-items:center;font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:var(--lm-surface-2);color:var(--lm-text-secondary)}
.lmr-meta{font-size:11px;color:var(--lm-text-tertiary)}
.lmr-actions{grid-area:actions;display:flex;align-items:center;gap:6px}
.lmr-btn{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:8px 14px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper);white-space:nowrap}
.lmr-btn:hover{opacity:.9}
.lmr-btn.ghost{background:transparent;color:var(--lm-text-secondary);box-shadow:inset 0 0 0 1px var(--lm-border-strong)}
.lmr-btn.ghost:hover{color:var(--lm-text-primary)}
.lmr-close{grid-area:close;display:grid;place-items:center;width:34px;height:34px;border-radius:999px;color:var(--lm-text-primary);box-shadow:inset 0 0 0 1px var(--lm-border-strong)}
.lmr-close:hover{background:var(--lm-surface-2)}
.lmr-files{grid-area:files;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.lmr-file{display:inline-flex;align-items:center;gap:8px;flex:none;max-width:320px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:999px;color:var(--lm-text-secondary);box-shadow:inset 0 0 0 1px var(--lm-border-subtle);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmr-file .lmr-mono{font-size:9.5px;letter-spacing:.1em;color:var(--lm-text-tertiary)}
.lmr-file:hover{color:var(--lm-text-primary)}
.lmr-file[data-on]{background:var(--lm-ink);color:var(--lm-paper);box-shadow:none}
.lmr-file[data-on] .lmr-mono{color:inherit;opacity:.7}
.lmr-body{position:relative;flex:1;min-height:0;overflow:auto}
.lmr-frame{display:block;width:100%;height:100%;border:0;background:var(--lm-surface-2)}
.lmr-frame-page{background:#fff4ea}
.lmr-picture{min-height:100%;display:grid;place-items:center;padding:16px}
.lmr-picture img{max-width:100%;max-height:calc(100dvh - 120px);object-fit:contain}
.lmr-loading,.lmr-empty{padding:48px 16px;text-align:center;color:var(--lm-text-tertiary);font-size:13px}
.lmr-pre{margin:0 auto;max-width:900px;padding:28px 16px 64px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--lm-text-primary)}
.lmr-download{display:flex;flex-direction:column;align-items:center;gap:10px;padding:72px 16px;text-align:center}
.lmr-download b{font-size:18px;font-weight:900;text-transform:uppercase;overflow-wrap:anywhere}
.lmr-download p{font-size:13px;color:var(--lm-text-tertiary)}
.lmr-download .lmr-mono{font-size:10.5px;letter-spacing:.1em;color:var(--lm-text-tertiary)}
.lmr-md{max-width:820px;margin:0 auto;padding:32px 16px 96px;font-size:16px;line-height:1.7;color:var(--lm-text-secondary)}
.lmr-md>*+*{margin-top:1em}
.lmr-md h1,.lmr-md h2,.lmr-md h3,.lmr-md h4{color:var(--lm-text-primary);font-weight:900;text-transform:uppercase;letter-spacing:-.01em;line-height:1.1;margin-top:1.8em}
.lmr-md h1{font-size:clamp(30px,5vw,46px);margin-top:0}
.lmr-md h2{font-size:24px}
.lmr-md h3{font-size:18px}
.lmr-md h4{font-size:14px;letter-spacing:.04em}
.lmr-md strong{color:var(--lm-text-primary);font-weight:700}
.lmr-md a{color:var(--lm-text-primary);text-decoration:underline;text-underline-offset:3px}
.lmr-md ul,.lmr-md ol{padding-left:1.3em}
.lmr-md ul{list-style:disc}
.lmr-md ol{list-style:decimal}
.lmr-md li+li{margin-top:.3em}
.lmr-md blockquote{padding:12px 16px;color:var(--lm-text-primary);background:var(--lm-surface-2);border-radius:6px}
.lmr-md hr{border:0;border-top:1px solid var(--lm-border-subtle);margin:2em 0}
.lmr-md code{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:.86em;padding:1px 5px;border-radius:4px;background:var(--lm-surface-2);color:var(--lm-text-primary)}
.lmr-md pre{padding:14px 16px;border-radius:8px;background:var(--lm-surface-2);overflow-x:auto}
.lmr-md pre code{padding:0;background:none}
.lmr-md img{max-width:100%;border-radius:6px}
.lmr-table{overflow-x:auto;border:1px solid var(--lm-border-subtle);border-radius:8px}
.lmr-md table{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.45}
.lmr-md th{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-align:left;color:var(--lm-text-tertiary);background:var(--lm-surface-2)}
.lmr-md th,.lmr-md td{padding:9px 12px;vertical-align:top;border-bottom:1px solid var(--lm-border-subtle)}
.lmr-md tr:last-child td{border-bottom:0}
.lmr-md td{color:var(--lm-text-primary)}
@media (max-width:640px){.lmr-bar{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title close" "actions actions" "files files"}.lmr-actions .lmr-btn.ghost{padding:6px 10px;font-size:10px}}
@media (min-width:768px){.lmr-bar{padding:14px 28px}}
`;
