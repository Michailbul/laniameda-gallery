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

type Look = FunctionReturnType<typeof api.mjThreads.threadLook>["codes"];

/** "pkdjfdf syleg2x · stylize 400" reads "STYLE · Chiseled Painted Cinematic + ANDROMEDA · stylize 400". */
export function namedSettings(settings: string | undefined, look: Look | undefined) {
  const name = (code: string) => look?.find((entry) => entry.code === code)?.name ?? code;
  return (settings ?? "").split(" · ").map((part) => {
    const tokens = part.split(" ");
    return tokens.every((token) => /^[A-Za-z0-9]{5,40}$/.test(token)) ? tokens.map(name).join(" + ") : part;
  }).join(" · ");
}

/** The runs as a timeline: All, Run 1, Run 2 … and Run again. */
export function RunStrip({ state, look, total, shown, onShow, rerunOpen, onRerun }: {
  state: State | undefined; look: Look | undefined; total: number; shown: number | null; onShow: (run: number | null) => void;
  rerunOpen: boolean; onRerun: () => void;
}) {
  const runs: Run[] = state?.runs ?? [];
  const focus = shown != null ? runs.find((run) => run.run === shown) : runs[runs.length - 1];
  return <div className="mjr">
    <div className="mjr-line" role="tablist" aria-label="Runs">
      <button type="button" role="tab" className="mjr-run" aria-selected={shown == null} onClick={() => onShow(null)}>All <span>{total}</span></button>
      {runs.map((run) => <button key={run.run} type="button" role="tab" className="mjr-run" aria-selected={shown === run.run} onClick={() => onShow(run.run)}
        title={[`Run ${run.run}: ${run.count} prompts`, run.settings && `Look: ${namedSettings(run.settings, look)}`, run.label && `Changed: ${run.label}`, run.note && `Why: ${run.note}`].filter(Boolean).join("\n")}>
        <i aria-hidden /><b>Run {run.run}</b><span>{run.count}</span>
      </button>)}
      <button type="button" className={`mjq-btn${rerunOpen ? "" : " primary"} mjr-go`} onClick={onRerun} disabled={!total}
        title="Copy these prompts into a new run with other moodboards, profiles or settings. The earlier runs keep their jobs and frames.">
        <RotateCcw size={12} aria-hidden />{rerunOpen ? "Close" : "Run again"}
      </button>
    </div>
    {focus && (focus.settings || focus.label) ? <p className="mjr-meta">
      <b>Run {focus.run}</b>{focus.settings && <span>{namedSettings(focus.settings, look)}</span>}{focus.label && <span className="mjr-changed">changed: {focus.label}</span>}
    </p> : null}
  </div>;
}

const flag = (params: string | undefined, names: string) => (new RegExp(`(?:^|\\s)--(?:${names})\\s+(\\S+)`, "i").exec(params ?? "") ?? [])[1] ?? "";
const ASPECTS = ["7:3", "16:9", "3:2", "1:1", "2:3", "9:16"];

type Draft = { codes: string[]; srefs: string; opening: string; stylize: number | null; chaos: string; ar: string; raw: boolean; hd: boolean; note: string };

function baseOf(items: Item[], run: Run | undefined): Draft {
  const first = items[0];
  const stylize = flag(first?.params, "stylize|s");
  return {
    codes: [...(first?.profileCodes ?? [])],
    srefs: (first?.styleRefs ?? []).map((ref) => ref.code || ref.url || "").filter(Boolean).join(" "),
    opening: run?.opening ?? "",
    stylize: stylize === "" ? null : Number(stylize),
    chaos: flag(first?.params, "chaos|c"),
    ar: flag(first?.params, "ar|aspect"),
    raw: /(?:^|\s)(?:--raw|--style\s+raw)(?=\s|$)/i.test(first?.params ?? ""),
    hd: /(?:^|\s)--hd(?=\s|$)/i.test(first?.params ?? ""),
    note: "",
  };
}

const splitCodes = (text: string) => text.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean);

function recipeOf(v: Draft, b: Draft): Recipe {
  const out: Recipe = {};
  if (v.codes.join(" ") !== b.codes.join(" ")) out.profileCodes = [...v.codes];
  if (splitCodes(v.srefs).join(" ") !== splitCodes(b.srefs).join(" ")) out.srefs = splitCodes(v.srefs);
  if (v.stylize !== b.stylize) out.stylize = v.stylize;
  if (v.chaos.trim() !== b.chaos.trim()) {
    if (v.chaos.trim() && !/^\d+$/.test(v.chaos.trim())) throw new Error("Chaos is a number from 0 to 100.");
    out.chaos = v.chaos.trim() ? Number(v.chaos.trim()) : null;
  }
  if (v.ar.trim() !== b.ar.trim()) {
    if (v.ar.trim() && !/^\d{1,3}:\d{1,3}$/.test(v.ar.trim())) throw new Error("Aspect is two numbers like 16:9.");
    out.ar = v.ar.trim() || null;
  }
  if (v.raw !== b.raw) out.raw = v.raw;
  if (v.hd !== b.hd) out.hd = v.hd;
  if (v.opening.trim() !== b.opening.trim()) out.opening = v.opening.trim();
  return out;
}

/** "Adds Golden Hour. Drops Anya. Stylize 400 → 750": the changes in plain words. */
function changesOf(v: Draft, b: Draft, name: (code: string) => string) {
  const out: string[] = [];
  for (const code of v.codes) if (!b.codes.includes(code)) out.push(`Adds ${name(code)}`);
  for (const code of b.codes) if (!v.codes.includes(code)) out.push(`Drops ${name(code)}`);
  if (v.stylize !== b.stylize) out.push(`Stylize ${b.stylize ?? "default"} → ${v.stylize ?? "default"}`);
  if (v.ar.trim() !== b.ar.trim()) out.push(`Aspect ${b.ar || "default"} → ${v.ar.trim() || "default"}`);
  if (v.raw !== b.raw) out.push(v.raw ? "Raw on" : "Raw off");
  if (v.hd !== b.hd) out.push(v.hd ? "HD on" : "HD off");
  if (v.chaos.trim() !== b.chaos.trim()) out.push(`Chaos ${b.chaos || "0"} → ${v.chaos.trim() || "0"}`);
  if (splitCodes(v.srefs).join(" ") !== splitCodes(b.srefs).join(" ")) out.push("New sref");
  if (v.opening.trim() !== b.opening.trim()) out.push("New opening words");
  return out;
}

/**
 * Run again: one plain sentence says what the new run will be; the look shows
 * moodboards and profiles by name with their cover; stylize is a slider,
 * aspect a few presets; sref, chaos, opening words and a note wait under More.
 */
export function RerunForm({ ownerUserId, batch, state, look, items, onDone, onClose }: {
  ownerUserId: string; batch: string; state: State | undefined; look: Look | undefined; items: Item[];
  onDone: (run: number, text: string) => void; onClose: () => void;
}) {
  const rerun = useMutation(api.mjThreads.rerunThread);
  const edit = useMutation(api.mjThreads.editThread);
  const runs = state?.runs.length ? state.runs.map((run) => run.run) : [1];
  const next = Math.max(state?.latestRun ?? 1, ...runs) + 1;
  const [fromRun, setFromRun] = useState(state?.latestRun ?? 1);
  const own = useMemo(() => items.filter((item) => runOf(item) === fromRun && item.status !== "skipped"), [items, fromRun]);
  const [base, setBase] = useState<Draft>(() => baseOf(own, state?.runs.find((run) => run.run === fromRun)));
  const [values, setValues] = useState<Draft>(base);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = items.filter((item) => item.status === "queued" || item.status === "injected");
  const name = (code: string) => look?.find((entry) => entry.code === code)?.name ?? code;
  const changes = changesOf(values, base, name);
  const addable = (look ?? []).filter((entry) => entry.kind !== "code" && !values.codes.includes(entry.code));

  const pickRun = (run: number) => {
    const next = baseOf(items.filter((item) => runOf(item) === run && item.status !== "skipped"), state?.runs.find((entry) => entry.run === run));
    setFromRun(run);
    setBase(next);
    setValues({ ...next, note: values.note });
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async (mode: "rerun" | "edit") => {
    let recipe: Recipe;
    try { recipe = recipeOf(values, base); } catch (caught) { setError(errorText(caught, "Check the fields.")); return; }
    if (mode === "edit" && !Object.keys(recipe).length) { setError("Change something first."); return; }
    setBusy(true);
    setError(null);
    try {
      if (mode === "rerun") {
        const result = await rerun({ ownerUserId, batch, fromRun, recipe, note: values.note.trim() || undefined, createdBy: "gallery · rerun" });
        onDone(result.run, `Run ${result.run} is in the queue: ${result.items.length} prompts. Run ${result.fromRun} stays as it was.`);
      } else {
        const result = await edit({ ownerUserId, batch, recipe });
        onDone(0, `Changed ${result.changed} prompts not sent yet: ${changes.join(". ")}. No new run.`);
      }
    } catch (caught) {
      setError(errorText(caught, "Not saved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return <section className="mjr-form" aria-label={`New run · Run ${next}`}>
    <div className="mjr-form-head">
      <b>New run · Run {next}</b>
      <span className="mjc-sp" />
      <button type="button" className="mjq-ghost" onClick={onClose}>Cancel</button>
    </div>
    <p className="mjr-lead">
      Makes a copy of all {own.length} prompts from {runs.length > 1
        ? <select value={fromRun} onChange={(event) => pickRun(Number(event.target.value))} aria-label="Copy from which run">
          {runs.map((run) => <option key={run} value={run}>Run {run}</option>)}
        </select>
        : <b>Run {fromRun}</b>} and changes only what you set below. Run {fromRun} stays as it is, with its jobs and frames.
    </p>
    <div className="mjr-row">
      <span className="mjr-label">Look</span>
      <div className="mjr-chips">
        {values.codes.map((code) => {
          const entry = look?.find((item) => item.code === code);
          return <span key={code} className={`mjr-chip${base.codes.includes(code) ? "" : " is-new"}`} title={`${entry?.kind === "profile" ? "Profile" : entry?.kind === "moodboard" ? "Moodboard" : "Code"} ${code}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {entry?.thumbUrl ? <img src={entry.thumbUrl} alt="" loading="lazy" /> : null}
            {name(code)}
            <button type="button" aria-label={`Take ${name(code)} out`} onClick={() => set("codes", values.codes.filter((other) => other !== code))}>×</button>
          </span>;
        })}
        {!values.codes.length && <span className="mjr-none">No moodboard or profile</span>}
        <select className="mjr-add" value="" disabled={!addable.length} aria-label="Add a moodboard or profile"
          onChange={(event) => { if (event.target.value) set("codes", [...values.codes, event.target.value].slice(0, 10)); }}>
          <option value="">{look === undefined ? "+ Add (loading…)" : addable.length ? "+ Add" : "All added"}</option>
          {(["moodboard", "profile"] as const).map((kind) => {
            const list = addable.filter((entry) => entry.kind === kind);
            return list.length ? <optgroup key={kind} label={kind === "moodboard" ? "Moodboards" : "Profiles"}>
              {list.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
            </optgroup> : null;
          })}
        </select>
      </div>
    </div>
    <div className="mjr-row">
      <span className="mjr-label">Stylize</span>
      <input type="range" min={0} max={1000} step={25} value={values.stylize ?? 100} aria-label="Stylize of the new run"
        onChange={(event) => set("stylize", Number(event.target.value))} />
      <b className={`mjr-val${values.stylize !== base.stylize ? " mjr-changed" : ""}`}>{values.stylize ?? "—"}</b>
    </div>
    <div className="mjr-row">
      <span className="mjr-label">Aspect</span>
      <div className="mjq-seg" role="group" aria-label="Aspect">
        {(ASPECTS.includes(values.ar) || !values.ar ? ASPECTS : [values.ar, ...ASPECTS]).map((ratio) =>
          <button key={ratio} type="button" aria-pressed={values.ar === ratio} onClick={() => set("ar", ratio)}>{ratio}</button>)}
      </div>
      <div className="mjq-seg" role="group" aria-label="Raw and HD">
        <button type="button" aria-pressed={values.raw} onClick={() => set("raw", !values.raw)}>Raw</button>
        <button type="button" aria-pressed={values.hd} onClick={() => set("hd", !values.hd)}>HD</button>
      </div>
    </div>
    <button type="button" className="mjq-ghost mjr-more" onClick={() => setMore((value) => !value)}>{more ? "Less" : "More: sref, chaos, opening words, note"}</button>
    {more && <div className="mjr-fields">
      {([["opening", "Opening words", "Painted storybook animation frame.", true], ["srefs", "Sref codes or image links", "none", true], ["chaos", "Chaos", "0", false], ["note", "Note (why this run)", "optional", true]] as const).map(([key, label, placeholder, wide]) =>
        <label key={key} className={`mjr-field${wide ? " is-wide" : ""}`}>
          <span>{label}</span>
          <input value={values[key]} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} />
        </label>)}
    </div>}
    <p className="mjr-sum">
      {changes.length
        ? <><b>Run {next}: {own.length} prompt{own.length === 1 ? "" : "s"}.</b> {changes.join(". ")}.</>
        : <>Nothing changed yet: Run {next} would repeat Run {fromRun} exactly.</>}
    </p>
    <div className="mjr-actions">
      <button type="button" className="mjq-btn primary" disabled={busy || !own.length} onClick={() => void submit("rerun")}>
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}Queue Run {next} · {own.length} prompt{own.length === 1 ? "" : "s"}
      </button>
    </div>
    {open.length > 0 && changes.length > 0 && <p className="mjr-alt">
      {open.length} prompt{open.length === 1 ? " in this thread is" : "s in this thread are"} not sent yet.{" "}
      <button type="button" disabled={busy} onClick={() => void submit("edit")}>Put these changes on them instead</button>
    </p>}
    {error && <p className="mjq-warn">{error}</p>}
  </section>;
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
.mjr-form{display:flex;flex-direction:column;gap:12px;margin:10px 0 4px;padding:14px 0 16px;border-top:1px solid var(--lm-border-strong);border-bottom:1px solid var(--lm-border)}
.mjr-form-head{display:flex;align-items:center;gap:10px}
.mjr-form-head b{font:900 14px/1 var(--lm-font-display);letter-spacing:.06em;text-transform:uppercase}
.mjr-form select,.mjc-head select{min-height:30px;padding:0 8px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary);font:700 10px/1 var(--lm-font);letter-spacing:.06em;text-transform:uppercase}
.mjr-fields{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
.mjr-field{display:flex;flex-direction:column;gap:4px;width:84px}
.mjr-field.is-wide{flex:1 1 180px;width:auto;min-width:160px}
.mjr-field span{font:700 8.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjr-field input{min-height:34px;padding:0 10px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary);font:500 12px/1 var(--lm-font);width:100%;box-sizing:border-box}
.mjr-lead{margin:0;font:500 13.5px/1.5 var(--lm-font-display);color:var(--lm-text-secondary)}
.mjr-lead b{color:var(--lm-text-primary);font-weight:700}
.mjr-lead select{margin:0 2px}
.mjr-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.mjr-row input[type=range]{flex:1 1 180px;accent-color:var(--lm-text-primary)}
.mjr-label{width:64px;flex:none;font:700 8.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjr-val{min-width:36px;text-align:right;font:700 13px/1 var(--lm-font)}
.mjr-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1 1 220px}
.mjr-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 3px 3px 4px;border-radius:999px;border:1px solid var(--lm-border-strong);background:var(--lm-surface-2);font:700 11.5px/1.2 var(--lm-font-display)}
.mjr-chip:not(:has(img)){padding-left:10px}
.mjr-chip.is-new{border-color:var(--lm-amber,#e8a838)}
.mjr-chip img{width:22px;height:22px;border-radius:50%;object-fit:cover}
.mjr-chip button{width:20px;height:20px;border:0;border-radius:50%;background:none;color:var(--lm-text-tertiary);cursor:pointer;font:600 14px/1 var(--lm-font-display)}
.mjr-chip button:hover{background:var(--lm-surface-1);color:var(--lm-text-primary)}
.mjr-none{font:500 12px/1.2 var(--lm-font-display);color:var(--lm-text-ghost)}
.mjr-add{border-style:dashed !important;border-radius:999px !important;text-transform:none !important;letter-spacing:0 !important}
.mjr-more{align-self:flex-start;text-transform:none;letter-spacing:.02em;font-size:11px}
.mjr-fields .mjq-seg button[aria-pressed="true"],.mjr-row .mjq-seg button[aria-pressed="true"]{background:var(--lm-ink);color:var(--lm-paper)}
.mjr-sum{margin:0;font:500 13.5px/1.5 var(--lm-font-display);color:var(--lm-text-secondary)}
.mjr-sum b{color:var(--lm-text-primary);font-weight:800}
.mjr-alt{margin:0;font:500 12px/1.5 var(--lm-font-display);color:var(--lm-text-ghost)}
.mjr-alt button{padding:0;border:0;background:none;color:var(--lm-text-primary);font:600 12px/1.5 var(--lm-font-display);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.mjr-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.mjc{display:flex;flex-direction:column;gap:12px;margin:12px 0 6px;padding:12px 0 14px;border-top:1px solid var(--lm-border);border-bottom:1px solid var(--lm-border)}
.mjc-head{display:flex;align-items:center;gap:10px;font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjc-head b{font:800 11px/1 var(--lm-font-display);letter-spacing:.14em;color:var(--lm-text-secondary)}
.mjc-head .hot{color:var(--lm-coral)}
.mjc-sp{flex:1 1 auto}
.mjc-list{display:flex;flex-direction:column;gap:16px;max-height:360px;overflow-y:auto;scrollbar-width:thin}
.mjc-empty{margin:0;font:500 12.5px/1.45 var(--lm-font-display);color:var(--lm-text-ghost)}
.mjc-msg{display:flex;flex-direction:column;gap:4px;max-width:88%;padding:8px 11px;border-radius:var(--lm-radius);border:1px solid var(--lm-border)}
.mjc-msg.is-michael{align-self:flex-end;background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.mjc-msg.is-agent{align-self:stretch;max-width:none;padding:0;border:0;border-radius:0;background:none}
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
