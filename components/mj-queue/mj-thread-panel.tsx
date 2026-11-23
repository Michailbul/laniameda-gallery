"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, RotateCcw, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";

// A thread's runs and chat on the gallery's Queue page (23 Nov 2026), the
// same rows as the extension's MJ Queue tab: the runs as a timeline of dots
// (run 1, run 2 …), Rerun (a new run with other profiles, styles or
// settings; the earlier runs keep their jobs and frames) and the thread's
// chat with the agent. Here the writer runs in the cloud (fal or Pika); the
// extension can also run it on the Mac. Nothing is sent to Midjourney.

type State = FunctionReturnType<typeof api.mjThreads.threadState>;
type Run = State["runs"][number];
type Message = State["messages"][number];
type Queue = FunctionReturnType<typeof api.mjQueue.listQueue>;
type Item = Queue["items"][number];
type Recipe = NonNullable<Parameters<ReturnType<typeof useMutation<typeof api.mjThreads.rerunThread>>>[0]["recipe"]>;

const errorText = (caught: unknown, fallback: string) => {
  const data = (caught as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  const message = caught instanceof Error ? caught.message : "";
  return message.replace(/^[\s\S]*Uncaught ConvexError:\s*/, "").split("\n")[0] || fallback;
};

const ago = (at: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

export const runOf = (item: { run?: number }) => item.run ?? 1;

/** The runs as a timeline: All, Run 1, Run 2 … and Rerun. */
export function RunStrip({ state, total, shown, onShow, rerunOpen, onRerun }: {
  state: State | undefined; total: number; shown: number | null; onShow: (run: number | null) => void;
  rerunOpen: boolean; onRerun: () => void;
}) {
  const runs: Run[] = state?.runs ?? [];
  const focus = shown != null ? runs.find((run) => run.run === shown) : runs[runs.length - 1];
  return <div className="mjr">
    <div className="mjr-line" role="tablist" aria-label="Runs">
      <button type="button" role="tab" className="mjr-run" aria-selected={shown == null} onClick={() => onShow(null)}>All <span>{total}</span></button>
      {runs.map((run) => <button key={run.run} type="button" role="tab" className="mjr-run" aria-selected={shown === run.run} onClick={() => onShow(run.run)}
        title={[`Run ${run.run}: ${run.count} prompts`, run.settings && `Carries: ${run.settings}`, run.label && `Changed: ${run.label}`, run.note && `Why: ${run.note}`].filter(Boolean).join("\n")}>
        <i aria-hidden /><b>Run {run.run}</b><span>{run.count}</span>
      </button>)}
      <button type="button" className={`mjq-btn${rerunOpen ? "" : " primary"} mjr-go`} onClick={onRerun} disabled={!total}>
        <RotateCcw size={12} aria-hidden />{rerunOpen ? "Close" : "Rerun"}
      </button>
    </div>
    {focus && (focus.settings || focus.label) ? <p className="mjr-meta">
      <b>Run {focus.run}</b>{focus.settings && <span>{focus.settings}</span>}{focus.label && <span className="mjr-changed">changed: {focus.label}</span>}
    </p> : null}
  </div>;
}

const flag = (params: string | undefined, names: string) => (new RegExp(`(?:^|\\s)--(?:${names})\\s+(\\S+)`, "i").exec(params ?? "") ?? [])[1] ?? "";

type Draft = { profiles: string; srefs: string; opening: string; stylize: string; chaos: string; ar: string; raw: boolean; hd: boolean; note: string };

function baseOf(items: Item[], run: Run | undefined): Draft {
  const first = items[0];
  return {
    profiles: (first?.profileCodes ?? []).join(" "),
    srefs: (first?.styleRefs ?? []).map((ref) => ref.code || ref.url || "").filter(Boolean).join(" "),
    opening: run?.opening ?? "",
    stylize: flag(first?.params, "stylize|s"),
    chaos: flag(first?.params, "chaos|c"),
    ar: flag(first?.params, "ar|aspect"),
    raw: /(?:^|\s)(?:--raw|--style\s+raw)(?=\s|$)/i.test(first?.params ?? ""),
    hd: /(?:^|\s)--hd(?=\s|$)/i.test(first?.params ?? ""),
    note: "",
  };
}

const codes = (text: string) => text.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean);

/** The next run's recipe: starts from what the chosen run carries; only what changes is sent. */
export function RerunForm({ ownerUserId, batch, state, items, onDone, onClose }: {
  ownerUserId: string; batch: string; state: State | undefined; items: Item[];
  onDone: (run: number, text: string) => void; onClose: () => void;
}) {
  const rerun = useMutation(api.mjThreads.rerunThread);
  const edit = useMutation(api.mjThreads.editThread);
  const latest = state?.latestRun ?? 1;
  const [fromRun, setFromRun] = useState(latest);
  const own = useMemo(() => items.filter((item) => runOf(item) === fromRun && item.status !== "skipped"), [items, fromRun]);
  const base = useMemo(() => baseOf(own, state?.runs.find((run) => run.run === fromRun)), [own, state, fromRun]);
  const [values, setValues] = useState<Draft>(base);
  const [edited, setEdited] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = items.filter((item) => item.status === "queued" || item.status === "injected");

  const pickRun = (run: number) => {
    setFromRun(run);
    setEdited({});
    setValues(baseOf(items.filter((item) => runOf(item) === run && item.status !== "skipped"), state?.runs.find((entry) => entry.run === run)));
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setEdited((current) => ({ ...current, [key]: true }));
    setError(null);
  };

  const recipe = (): Recipe => {
    const out: Recipe = {};
    if (edited.profiles) out.profileCodes = codes(values.profiles);
    if (edited.srefs) out.srefs = codes(values.srefs);
    if (edited.opening) out.opening = values.opening.trim();
    for (const key of ["stylize", "chaos"] as const) {
      if (!edited[key]) continue;
      const text = values[key].trim();
      if (text && !/^\d+$/.test(text)) throw new Error(`${key[0]!.toUpperCase()}${key.slice(1)} is a number.`);
      out[key] = text ? Number(text) : null;
    }
    if (edited.ar) {
      const text = values.ar.trim();
      if (text && !/^\d{1,3}:\d{1,3}$/.test(text)) throw new Error("Aspect is two numbers like 16:9.");
      out.ar = text || null;
    }
    if (edited.raw) out.raw = values.raw;
    if (edited.hd) out.hd = values.hd;
    return out;
  };

  const submit = async (mode: "rerun" | "edit") => {
    let next: Recipe;
    try { next = recipe(); } catch (caught) { setError(errorText(caught, "Check the fields.")); return; }
    if (mode === "edit" && !Object.keys(next).length) { setError("Change a field first."); return; }
    setBusy(true);
    setError(null);
    try {
      if (mode === "rerun") {
        const result = await rerun({ ownerUserId, batch, fromRun, recipe: next, note: values.note.trim() || undefined, createdBy: "gallery · rerun" });
        onDone(result.run, `Run ${result.run} queued: ${result.items.length} prompts · ${result.label}. Run ${result.fromRun} stays as it was.`);
      } else {
        const result = await edit({ ownerUserId, batch, recipe: next });
        onDone(0, `${result.label} on ${result.changed} prompts to send${result.leftAlone ? `; ${result.leftAlone} sent or skipped keep theirs` : ""}.`);
      }
    } catch (caught) {
      setError(errorText(caught, "Not saved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "profiles" | "srefs" | "opening" | "stylize" | "chaos" | "ar", label: string, placeholder: string, wide = false) =>
    <label className={`mjr-field${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      <input value={values[key]} placeholder={placeholder} data-edited={edited[key] ? "true" : undefined}
        inputMode={key === "stylize" || key === "chaos" ? "numeric" : "text"} onChange={(event) => set(key, event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void submit("rerun"); }} />
    </label>;

  return <div className="mjr-form">
    <div className="mjr-form-head">
      <b>Run {Math.max(latest, ...(state?.runs ?? []).map((run) => run.run)) + 1}</b>
      <select value={fromRun} onChange={(event) => pickRun(Number(event.target.value))} aria-label="Rerun from which run">
        {(state?.runs.length ? state.runs : [{ run: 1 } as Run]).map((run) => <option key={run.run} value={run.run}>from run {run.run}</option>)}
      </select>
      <span className="mjr-hint">{own.length} prompts, same words</span>
    </div>
    <div className="mjr-fields">
      {field("profiles", "Profiles · moodboards", "codes, space between", true)}
      {field("srefs", "Sref", "codes or image URLs", true)}
      {field("opening", "Opening", "Painted storybook animation frame.", true)}
      {field("stylize", "Stylize", "—")}
      {field("chaos", "Chaos", "—")}
      {field("ar", "Aspect", "16:9")}
      <div className="mjq-seg" role="group" aria-label="Raw and HD">
        <button type="button" aria-pressed={values.raw} data-edited={edited.raw ? "true" : undefined} onClick={() => set("raw", !values.raw)}>{values.raw ? "Raw" : "Standard"}</button>
        <button type="button" aria-pressed={values.hd} data-edited={edited.hd ? "true" : undefined} onClick={() => set("hd", !values.hd)}>{values.hd ? "HD" : "No HD"}</button>
      </div>
    </div>
    <input className="mjr-note" value={values.note} placeholder="Why this run (shown with it)" onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} />
    <div className="mjr-actions">
      <button type="button" className="mjq-btn primary" disabled={busy || !own.length} onClick={() => void submit("rerun")}>
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}Queue run · {own.length}
      </button>
      <button type="button" className="mjq-btn" disabled={busy || !open.length} onClick={() => void submit("edit")}
        title="No new run: put these changes on the prompts still to send. Sent ones keep theirs.">Change {open.length} to send</button>
      <button type="button" className="mjq-ghost" onClick={onClose}>Cancel</button>
    </div>
    {error && <p className="mjq-warn">{error}</p>}
  </div>;
}

const WRITERS = [
  { key: "fal:haiku", provider: "fal", model: "haiku", label: "fal · Haiku 5.5" },
  { key: "fal:sonnet", provider: "fal", model: "sonnet", label: "fal · Sonnet 5.5" },
  { key: "pika:haiku", provider: "pika", model: "haiku", label: "Pika · Haiku 4.5" },
  { key: "pika:sonnet", provider: "pika", model: "sonnet", label: "Pika · Sonnet 5.5" },
] as const;
const WRITER_KEY = "lm-mjq-writer";
const readWriter = () => {
  try { return WRITERS.find((entry) => entry.key === localStorage.getItem(WRITER_KEY)) ?? WRITERS[0]; } catch { return WRITERS[0]; }
};

/** The thread's chat with the agent: Michael writes, the writer (or an agent on MCP) answers and changes the thread. */
export function ThreadChat({ ownerUserId, batch, state, onRun }: {
  ownerUserId: string; batch: string; state: State | undefined; onRun: (run: number) => void;
}) {
  const post = useMutation(api.mjThreads.postMessage);
  const answer = useAction(api.mjThreadChat.answer);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; messageId?: string } | null>(null);
  const [writer, setWriter] = useState<(typeof WRITERS)[number]>(WRITERS[0]);
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setWriter(readWriter()), []);
  const messages: Message[] = state?.messages ?? [];
  const shown = all ? messages : messages.slice(-6);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, busy]);

  const ask = async (messageId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await answer({ ownerUserId, batch, messageId, model: writer.model, provider: writer.provider });
      if ("run" in result && result.run) onRun(result.run);
    } catch (caught) {
      setError({ text: errorText(caught, "The writer could not answer."), messageId });
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    let id: string;
    try {
      id = (await post({ ownerUserId, batch, role: "michael", author: "Michael", text })).id;
      setDraft("");
    } catch (caught) {
      setBusy(false);
      setError({ text: errorText(caught, "Not saved. Try again.") });
      return;
    }
    await ask(id);
  };

  return <section className="mjc" aria-label="Chat with the agent">
    <div className="mjc-head">
      <b>Chat</b>
      {messages.length ? <span>{messages.length}</span> : null}
      {state?.waiting ? <span className="hot">{state.waiting} waiting</span> : null}
      <span className="mjc-sp" />
      <select value={writer.key} aria-label="Where the writer runs" onChange={(event) => {
        const next = WRITERS.find((entry) => entry.key === event.target.value) ?? WRITERS[0];
        setWriter(next);
        try { localStorage.setItem(WRITER_KEY, next.key); } catch { /* private window */ }
      }}>
        {WRITERS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
    </div>
    {messages.length > shown.length && <button type="button" className="mjq-ghost" onClick={() => setAll(true)}>Show {messages.length - shown.length} earlier</button>}
    <div className="mjc-list" ref={listRef}>
      {!messages.length && !busy && <p className="mjc-empty">Ask for a change: “make the next ten darker”, “add a reverse shot of the patio”, “swap the profile to CAS Main 1”, “rerun all at stylize 750”.</p>}
      {shown.map((message) => <div key={message.id} className={`mjc-msg is-${message.role}`}>
        <div className="mjc-who"><b>{message.role === "michael" ? "Michael" : message.author}</b><span>{ago(message.createdAt)}</span>{message.run ? <span className="mjr-changed">Run {message.run}</span> : null}</div>
        <p>{message.text}</p>
        {message.changes?.length ? <ul>{message.changes.map((change, at) => <li key={at} className={/^Not done/.test(change) ? "miss" : undefined}>{change}</li>)}</ul> : null}
        {message.role === "michael" && message.status === "waiting" && !busy && <div className="mjc-wait">
          <span>{message.error ? `No answer yet: ${message.error}` : "Waiting for an answer."}</span>
          <button type="button" className="mjq-btn" onClick={() => void ask(message.id)}>Ask the writer</button>
        </div>}
      </div>)}
      {busy && <div className="mjc-msg is-agent is-typing"><div className="mjc-who"><b>writer · {writer.label}</b></div><p>Writing…</p></div>}
    </div>
    <div className="mjc-form">
      <textarea rows={1} value={draft} placeholder="Write to the agent…" disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <button type="button" className="mjq-btn primary" disabled={busy || !draft.trim()} onClick={() => void send()} aria-label="Send to the agent">
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Send size={12} aria-hidden />}Send
      </button>
    </div>
    {error && <p className="mjq-warn">{error.text}{error.messageId && <> · <button type="button" className="mjq-ghost" onClick={() => void ask(error.messageId!)}>Retry</button></>}</p>}
  </section>;
}

export const THREAD_PANEL_CSS = `
.mjr{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.mjr-line{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.mjr-line::before{content:"";position:absolute;left:8px;right:8px;top:50%;height:1px;background:var(--lm-border);pointer-events:none}
.mjr-run{position:relative;display:inline-flex;align-items:center;gap:6px;padding:7px 10px;min-height:30px;border-radius:999px;cursor:pointer;
  background:var(--lm-paper);border:1px solid var(--lm-border-strong);color:var(--lm-text-tertiary);font:700 9.5px/1 var(--lm-font);letter-spacing:.1em;text-transform:uppercase}
.mjr-run b{font:800 10.5px/1 var(--lm-font-display);letter-spacing:.08em;color:var(--lm-text-primary)}
.mjr-run i{width:6px;height:6px;border-radius:50%;background:var(--lm-text-ghost)}
.mjr-run[aria-selected="true"]{background:var(--lm-surface-2);color:var(--lm-text-primary)}
.mjr-run[aria-selected="true"] i{background:var(--lm-coral);box-shadow:0 0 0 3px color-mix(in srgb,var(--lm-coral) 18%,transparent),0 0 10px color-mix(in srgb,var(--lm-coral) 55%,transparent)}
.mjr-go{margin-left:auto;position:relative}
.mjr-meta{display:flex;flex-wrap:wrap;gap:4px 10px;margin:0;font:600 10px/1.45 var(--lm-font);letter-spacing:.04em;color:var(--lm-text-ghost)}
.mjr-meta b{font:800 9.5px/1.45 var(--lm-font-display);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-secondary)}
.mjr-changed{color:var(--lm-amber,#e8a838)}
.mjr-form{display:flex;flex-direction:column;gap:10px;margin:10px 0 4px;padding:12px;border:1.5px solid var(--lm-border-strong);border-radius:var(--lm-radius);background:var(--lm-surface-1)}
.mjr-form-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.mjr-form-head b{font:900 14px/1 var(--lm-font-display);letter-spacing:.06em;text-transform:uppercase}
.mjr-form select,.mjc-head select{min-height:30px;padding:0 8px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary);font:700 10px/1 var(--lm-font);letter-spacing:.06em;text-transform:uppercase}
.mjr-hint{font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjr-fields{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
.mjr-field{display:flex;flex-direction:column;gap:4px;width:84px}
.mjr-field.is-wide{flex:1 1 180px;width:auto;min-width:160px}
.mjr-field span{font:700 8.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjr-field input,.mjr-note{min-height:34px;padding:0 10px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary);font:500 12px/1 var(--lm-font);width:100%;box-sizing:border-box}
.mjr-fields .mjq-seg button[aria-pressed="true"]{background:var(--lm-ink);color:var(--lm-paper)}
.mjr-field input[data-edited="true"],.mjq-seg button[data-edited="true"]{border-color:var(--lm-amber,#e8a838);box-shadow:inset 0 -2px 0 var(--lm-amber,#e8a838)}
.mjr-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.mjc{display:flex;flex-direction:column;gap:8px;margin:12px 0 6px;padding:12px;border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);background:var(--lm-surface-1)}
.mjc-head{display:flex;align-items:center;gap:10px;font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjc-head b{font:800 11px/1 var(--lm-font-display);letter-spacing:.14em;color:var(--lm-text-secondary)}
.mjc-head .hot{color:var(--lm-coral)}
.mjc-sp{flex:1 1 auto}
.mjc-list{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto;scrollbar-width:thin}
.mjc-empty{margin:0;font:500 12.5px/1.45 var(--lm-font-display);color:var(--lm-text-ghost)}
.mjc-msg{display:flex;flex-direction:column;gap:4px;max-width:88%;padding:8px 11px;border-radius:var(--lm-radius);border:1px solid var(--lm-border)}
.mjc-msg.is-michael{align-self:flex-end;background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.mjc-msg.is-agent{align-self:flex-start;background:var(--lm-paper)}
.mjc-msg.is-typing p{color:var(--lm-text-ghost)}
.mjc-who{display:flex;align-items:baseline;gap:8px;font:600 9.5px/1 var(--lm-font);letter-spacing:.06em;color:var(--lm-text-ghost)}
.mjc-who b{font:800 9.5px/1 var(--lm-font-display);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-secondary)}
.mjc-msg p{margin:0;font:500 13px/1.45 var(--lm-font-display);white-space:pre-wrap;overflow-wrap:anywhere}
.mjc-msg ul{margin:2px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.mjc-msg li{font:500 10.5px/1.45 var(--lm-font);color:var(--lm-text-secondary)}
.mjc-msg li::before{content:"· ";color:var(--lm-text-ghost)}
.mjc-msg li.miss{color:var(--lm-amber,#e8a838)}
.mjc-wait{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font:600 10px/1.4 var(--lm-font);color:var(--lm-text-ghost)}
.mjc-form{display:flex;align-items:flex-end;gap:8px}
.mjc-form textarea{flex:1 1 auto;min-height:38px;max-height:160px;padding:9px 11px;resize:vertical;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary);font:500 13px/1.4 var(--lm-font-display)}
.mjc-form textarea:focus,.mjr-field input:focus,.mjr-note:focus{outline:none;border-color:var(--lm-text-tertiary)}
.mjq-item-run{padding:2px 5px;border:1px solid var(--lm-border-strong);border-radius:3px;font:700 8.5px/1 var(--lm-font);letter-spacing:.08em;color:var(--lm-text-tertiary)}
`;
