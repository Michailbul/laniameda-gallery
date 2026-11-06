"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Micro, RADIUS, display, errorText, mono } from "@/components/inbox/inbox-ui";
import { Chip, DecisionButton, HAIR, plural, usd } from "./parts";

// Paid generation for inspiration takes: off until Michael allows it. One
// strip under the library header: the state in plain words, Allow (a cap
// per 48 hours for a number of days) or Pause, and any job whose charge is
// unknown, with Charged / Not charged. Agents can read this, never change it.

type Status = FunctionReturnType<typeof api.inspirationDispatch.getInspirationDispatch>;

const CAPS = [5, 10, 20] as const;
const DAYS = [7, 14, 30] as const;

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Pick<T extends number>({ values, value, onPick, format }: { values: readonly T[]; value: T; onPick: (value: T) => void; format: (value: T) => string }) {
  return <div className="flex gap-1.5">
    {values.map((item) => <button key={item} type="button" aria-pressed={item === value} onClick={() => onPick(item)}
      className="min-h-[40px] min-w-[56px] px-3 text-[11px] font-black uppercase tracking-[0.1em] active:scale-[0.97]"
      style={{ ...mono, borderRadius: RADIUS, border: item === value ? "1px solid var(--lm-ink)" : "1px solid var(--lm-border-strong)", background: item === value ? "var(--lm-ink)" : "transparent", color: item === value ? "var(--lm-paper)" : "var(--lm-text-secondary)" }}>
      {format(item)}
    </button>)}
  </div>;
}

function Unknown({ ownerUserId, job }: { ownerUserId: string; job: Status["unknownOutcomes"][number] }) {
  const resolve = useMutation(api.inspirationDispatch.resolveInspirationJob);
  const [busy, setBusy] = useState<"yes" | "no">();
  const [error, setError] = useState<string>();
  const run = async (charged: boolean) => {
    setBusy(charged ? "yes" : "no"); setError(undefined);
    try { await resolve({ ownerUserId, jobId: job.jobId as Id<"inspirationJobs">, charged }); }
    catch (cause) { setError(errorText(cause, "That did not go through.")); }
    finally { setBusy(undefined); }
  };
  return <div className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:justify-between" style={{ borderTop: HAIR }}>
    <div className="min-w-0">
      <p className="text-[12px] font-bold leading-5">{job.model} on {job.provider} · {usd(job.estimateUsd, false)}</p>
      <p className="text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>
        We could not tell whether this ran. It is held, and it will not be sent again.{job.providerHandle ? ` Provider id ${job.providerHandle}.` : ""}
      </p>
      {error && <p className="mt-1 text-[11px]" style={{ color: "var(--lm-coral)" }}>{error}</p>}
    </div>
    <div className="flex shrink-0 gap-1.5">
      <DecisionButton busy={busy === "yes"} disabled={Boolean(busy)} onClick={() => void run(true)}>Charged</DecisionButton>
      <DecisionButton busy={busy === "no"} disabled={Boolean(busy)} onClick={() => void run(false)}>Not charged</DecisionButton>
    </div>
  </div>;
}

export function GenerationStrip({ ownerUserId }: { ownerUserId: string }) {
  const status = useQuery(api.inspirationDispatch.getInspirationDispatch, { ownerUserId });
  const set = useMutation(api.inspirationDispatch.setInspirationDispatch);
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState<(typeof CAPS)[number]>(10);
  const [days, setDays] = useState<(typeof DAYS)[number]>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!status) return <div className="mt-3 h-[58px]" style={{ borderRadius: RADIUS, background: "var(--lm-surface-1)" }} aria-hidden />;

  const on = status.canDispatch;
  const used = status.heldUsd + status.settledUsd;
  const apply = async (paused: boolean) => {
    setBusy(true); setError(undefined);
    try {
      await set({ ownerUserId, expectedRevision: status.revision, paused, ...(paused ? {} : { cycleCapUsd: cap, allowanceDays: days }) });
      setOpen(false);
    } catch (cause) {
      setError(errorText(cause, "That did not go through."));
    } finally {
      setBusy(false);
    }
  };

  return <section className="mt-3 px-3 py-2.5" style={{ borderRadius: RADIUS, border: on ? "1px solid color-mix(in srgb, var(--lm-coral) 45%, transparent)" : HAIR, background: "var(--lm-surface-1)" }}
    aria-label="Paid generation">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Chip tone={on ? "coral" : "ink"}>{on ? "Generation on" : "Generation off"}</Chip>
        <p className="min-w-0 text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
          {on && status.allowance
            ? <>{usd(used)} of ${status.allowance.cycleCapUsd} used until {when(status.cycleEnd)}{status.allowance.expiresAt ? ` · allowed until ${new Date(status.allowance.expiresAt).toLocaleDateString()}` : ""}</>
            : <>Takes are made only when you allow it. Saving and proposing go on.</>}
        </p>
      </div>
      {on
        ? <DecisionButton tone="coral" busy={busy} onClick={() => void apply(true)}>Pause</DecisionButton>
        : <DecisionButton onClick={() => setOpen((value) => !value)} title="Allow paid takes up to a cap">{open ? "Close" : "Allow"}</DecisionButton>}
    </div>
    {open && !on && <div className="mt-2 flex flex-col gap-2.5 pt-2.5" style={{ borderTop: HAIR }}>
      <div className="flex flex-wrap items-center gap-3">
        <Micro color="var(--lm-text-ghost)">Up to, per 48 h</Micro>
        <Pick values={CAPS} value={cap} onPick={setCap} format={(value) => `$${value}`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Micro color="var(--lm-text-ghost)">For</Micro>
        <Pick values={DAYS} value={days} onPick={setDays} format={(value) => `${value} days`} />
      </div>
      <p className="text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>
        Every take is priced before it runs and counted against this, retries included. Pause stops the next one.
      </p>
      <div><DecisionButton tone="ink" busy={busy} onClick={() => void apply(false)}>Allow ${cap} per 48 h</DecisionButton></div>
    </div>}
    {error && <p className="mt-1 text-[11px]" style={{ color: "var(--lm-coral)" }}>{error}</p>}
    {status.unknownOutcomes.length > 0 && <div className="mt-2">
      <p className="text-[11px] font-black uppercase tracking-[0.1em]" style={{ ...display, color: "var(--lm-coral)" }}>
        {plural(status.unknownOutcomes.length, "take")} with an unknown charge
      </p>
      {status.unknownOutcomes.map((job) => <Unknown key={job.jobId} ownerUserId={ownerUserId} job={job} />)}
    </div>}
  </section>;
}
