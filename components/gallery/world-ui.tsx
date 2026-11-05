"use client";

import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActionButton, Micro, RADIUS, display, mono } from "./moodboards-view";

// Shared pieces of a world's Docs and Journal tabs: the quiet failure state,
// the actor and op badges, times, and the dry-run-first undo dialog.

export const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error
    ? error.message.replace(/^[\s\S]*?Uncaught ConvexError: /, "").split("\n")[0] || fallback
    : fallback;
};

/* ── Failure state ───────────────────────────────────────────────────────── */

/**
 * A world query that throws (not deployed yet, world unmarked, network) ends
 * here instead of taking the gallery down with it.
 */
export class WorldBoundary extends Component<
  { children: ReactNode; resetKey: string; what: string },
  { failed: boolean; message?: string }
> {
  state: { failed: boolean; message?: string } = { failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: errorText(error, "") };
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false, message: undefined });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="px-4 py-16 text-center md:px-6">
      <p className="text-sm font-black uppercase tracking-tight" style={display}>{this.props.what} are not available</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
        The gallery could not read them for this world. {this.state.message ? <span style={mono}>{this.state.message}</span> : "Try again in a moment."}
      </p>
      <ActionButton className="mt-5" icon={<RotateCcw size={13} aria-hidden />} onClick={() => this.setState({ failed: false, message: undefined })}>
        Try again
      </ActionButton>
    </section>;
  }
}

/* ── Times ───────────────────────────────────────────────────────────────── */

export const timeAgo = (at: number, now = Date.now()) => {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return dayLabel(at);
};

export const dayLabel = (at: number) => {
  const date = new Date(at);
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
};

export const clockLabel = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const fullStamp = (at: number) => `${dayLabel(at)} · ${clockLabel(at)}`;

/* ── Badges ──────────────────────────────────────────────────────────────── */

export const isAgentActor = (actor: string) => actor !== "owner" && actor.trim() !== "";

/** `owner` on ink, `agent:…` on coral. The name keeps its case. */
export function ActorBadge({ actor }: { actor: string }) {
  const agent = isAgentActor(actor);
  return <span title={agent ? `Written by ${actor}` : "Written by you"}
    className="inline-flex max-w-[180px] shrink-0 items-center gap-1 px-1.5 py-[3px] text-[10px] font-bold leading-none tracking-[0.04em]"
    style={{
      ...mono, borderRadius: RADIUS,
      background: agent ? "color-mix(in srgb, var(--lm-coral) 14%, transparent)" : "var(--lm-ink)",
      color: agent ? "var(--lm-coral)" : "var(--lm-paper)",
      border: `1px solid ${agent ? "color-mix(in srgb, var(--lm-coral) 40%, transparent)" : "var(--lm-ink)"}`,
    }}>
    <span className="truncate">{agent ? actor : "owner"}</span>
  </span>;
}

const OP_COLOR: Record<string, string> = {
  doc: "var(--lm-text-primary)",
  assets: "var(--lm-success-text)",
  shelf: "var(--lm-text-secondary)",
  world: "var(--lm-text-secondary)",
  moodboard: "var(--lm-coral)",
  profile: "var(--lm-coral)",
  story: "var(--lm-text-primary)",
};

/** `doc.write`, `assets.file` …: code, so it keeps its case. */
export function OpBadge({ op }: { op: string }) {
  const color = OP_COLOR[op.split(".")[0] ?? ""] ?? "var(--lm-text-secondary)";
  return <span className="inline-flex shrink-0 items-center border px-1.5 py-[3px] text-[10px] font-semibold leading-none tracking-[0.02em]"
    style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color }}>
    {op}
  </span>;
}

export function MonoBadge({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return <span title={title} className="inline-flex shrink-0 items-center border px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.1em]"
    style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border)", color: color ?? "var(--lm-text-tertiary)" }}>
    {children}
  </span>;
}

/* ── Undo, dry run first ─────────────────────────────────────────────────── */

export type UndoTarget =
  | { kind: "change"; changeId: string; label: string }
  | { kind: "session"; session: string; world: string; label: string };

type UndoResult = {
  dryRun: boolean;
  undone: Array<{ changeId: string; summary: string }>;
  blocked: Array<{ changeId: string; summary: string; reason: string }>;
};

type UndoState =
  | { step: "idle" }
  | { step: "checking"; target: UndoTarget }
  | { step: "preview"; target: UndoTarget; result: UndoResult }
  | { step: "running"; target: UndoTarget; result: UndoResult }
  | { step: "done"; target: UndoTarget; result: UndoResult }
  | { step: "error"; target: UndoTarget; message: string };

/**
 * `request(target)` runs the undo as a dry run, shows what will be undone and
 * what is blocked, and only on confirm runs it for real. Render `dialog`.
 */
export function useWorldUndo(ownerUserId: string) {
  const undoMutation = useMutation(api.worlds.undoWorldChanges);
  // Dry runs and blocked runs roll back on the server and send their report
  // on the error; anything else is a real failure.
  const undo = useCallback(async (args: Parameters<typeof undoMutation>[0]): Promise<UndoResult> => {
    try {
      return await undoMutation(args);
    } catch (error) {
      const data = error instanceof ConvexError ? (error.data as (UndoResult & { kind?: string }) | undefined) : undefined;
      if (data?.kind === "world-undo-report") return { dryRun: data.dryRun, undone: data.undone, blocked: data.blocked };
      throw error;
    }
  }, [undoMutation]);
  const [state, setState] = useState<UndoState>({ step: "idle" });

  const argsFor = useCallback((target: UndoTarget, dryRun: boolean) => (
    target.kind === "change"
      ? { ownerUserId, changeId: target.changeId as Id<"worldChanges">, dryRun, actor: "owner" }
      : { ownerUserId, undoSession: target.session, world: target.world, dryRun, actor: "owner" }
  ), [ownerUserId]);

  const request = useCallback(async (target: UndoTarget) => {
    setState({ step: "checking", target });
    try {
      const result = await undo(argsFor(target, true));
      setState({ step: "preview", target, result });
    } catch (error) {
      setState({ step: "error", target, message: errorText(error, "Could not check this undo.") });
    }
  }, [argsFor, undo]);

  const confirm = useCallback(async () => {
    if (state.step !== "preview") return;
    const { target } = state;
    setState({ step: "running", target, result: state.result });
    try {
      const result = await undo(argsFor(target, false));
      setState({ step: "done", target, result });
    } catch (error) {
      setState({ step: "error", target, message: errorText(error, "The undo failed. Nothing was changed.") });
    }
  }, [argsFor, state, undo]);

  const close = useCallback(() => setState({ step: "idle" }), []);

  const busyId = state.step === "checking" || state.step === "running"
    ? (state.target.kind === "change" ? state.target.changeId : `session:${state.target.session}`)
    : null;

  const dialog = state.step === "idle" ? null : <UndoDialog state={state} onConfirm={confirm} onClose={close} />;
  return { request, dialog, busyId };
}

function UndoDialog({ state, onConfirm, onClose }: { state: Exclude<UndoState, { step: "idle" }>; onConfirm: () => void; onClose: () => void }) {
  const running = state.step === "running" || state.step === "checking";
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const result = "result" in state ? state.result : null;
  const title = state.step === "done" ? "Undone" : state.step === "error" ? "Undo failed" : state.target.kind === "session" ? "Undo session" : "Undo change";
  // A run is all or nothing, so anything blocked means it cannot run.
  const canRun = state.step === "preview" && (result?.undone.length ?? 0) > 0 && (result?.blocked.length ?? 0) === 0;

  return <div className="fixed inset-0 z-[90] grid place-items-center p-4" role="presentation"
    style={{ background: "var(--lm-overlay-canvas)" }} onClick={() => { if (!running) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}
      className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden border"
      style={{ borderRadius: RADIUS, background: "var(--lm-panel-bg)", borderColor: "var(--lm-border-strong)", boxShadow: "var(--lm-modal-shadow)", color: "var(--lm-text-primary)" }}>
      <header className="flex items-start justify-between gap-3 border-b px-5 pb-3 pt-4" style={{ borderColor: "var(--lm-border)" }}>
        <div className="min-w-0">
          <Micro color="var(--lm-coral)">{state.step === "done" ? "Done" : state.step === "checking" ? "Dry run" : state.step === "error" ? "Error" : "Dry run result"}</Micro>
          <h3 className="mt-1 text-xl font-black uppercase leading-none tracking-tight" style={display}>{title}</h3>
          <p className="mt-1.5 truncate text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{state.target.label}</p>
        </div>
        <button type="button" aria-label="Close" disabled={running} onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center disabled:opacity-30" style={{ color: "var(--lm-text-secondary)" }}>
          <X size={15} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {state.step === "checking" && <Micro>Checking what can be undone…</Micro>}
        {state.step === "error" && <p className="text-[13px] leading-5" style={{ color: "var(--lm-status-error-text)" }}>{state.message}</p>}
        {result && <div className="grid gap-4">
          {state.step !== "done" && result.undone.length === 0 && <p className="text-[13px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
            Nothing here can be undone right now.
          </p>}
          {result.undone.length > 0 && <UndoList
            heading={state.step === "done" ? `Undone · ${result.undone.length}` : `Will be undone · ${result.undone.length}`}
            tone="ok" rows={result.undone.map((row) => ({ id: row.changeId, summary: row.summary }))} />}
          {result.blocked.length > 0 && <UndoList heading={`Blocked · ${result.blocked.length}`} tone="blocked"
            rows={result.blocked.map((row) => ({ id: row.changeId, summary: row.summary, reason: row.reason }))} />}
        </div>}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--lm-border)" }}>
        {state.step === "done" || state.step === "error"
          ? <ActionButton tone="ink" onClick={onClose}>Close</ActionButton>
          : <>
            <ActionButton disabled={running} onClick={onClose}>Cancel</ActionButton>
            <ActionButton tone="coral" busy={state.step === "running"} disabled={!canRun || running}
              icon={<RotateCcw size={13} aria-hidden />} onClick={onConfirm}>
              {result && result.undone.length > 1 ? `Undo ${result.undone.length} changes` : "Undo"}
            </ActionButton>
          </>}
      </footer>
    </div>
  </div>;
}

function UndoList({ heading, tone, rows }: { heading: string; tone: "ok" | "blocked"; rows: Array<{ id: string; summary: string; reason?: string }> }) {
  return <div>
    <div className="mb-2 flex items-center gap-2">
      {tone === "ok" ? <Check size={12} style={{ color: "var(--lm-success-text)" }} aria-hidden /> : <AlertTriangle size={12} style={{ color: "var(--lm-coral)" }} aria-hidden />}
      <Micro color={tone === "ok" ? "var(--lm-text-secondary)" : "var(--lm-coral)"}>{heading}</Micro>
      <span aria-hidden className="h-px flex-1" style={{ background: "var(--lm-border)" }} />
    </div>
    <ul className="grid gap-1.5">
      {rows.map((row) => <li key={row.id} className="text-[12.5px] leading-5" style={{ color: "var(--lm-text-primary)" }}>
        {row.summary}
        {row.reason && <span className="block text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{row.reason}</span>}
      </li>)}
    </ul>
  </div>;
}
