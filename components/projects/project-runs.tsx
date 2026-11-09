"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";

// The comparison grid of a project (/w/<world>/project): prompt sets × style
// presets × locked seeds. "New run" picks a set, its variants and presets,
// shows the job count and how long it takes at the account caps, and writes
// one MJ Queue thread (screening first) that Michael sends himself.

type Sets = FunctionReturnType<typeof api.promptGrid.listPromptSets>;
type Presets = FunctionReturnType<typeof api.promptGrid.listPresets>;
const SANS: CSSProperties = { fontFamily: "var(--font-geist-sans), system-ui, sans-serif" };

export function ProjectRuns({ ownerUserId, world }: { ownerUserId: string; world: string }) {
  const { isAuthenticated } = useConvexAuth();
  const sets = useQuery(api.promptGrid.listPromptSets, isAuthenticated ? { ownerUserId, world } : "skip");
  const presets = useQuery(api.promptGrid.listPresets, isAuthenticated ? { ownerUserId, world } : "skip");
  const runs = useQuery(api.promptGrid.listRuns, isAuthenticated ? { ownerUserId, world } : "skip");
  const [open, setOpen] = useState(false);
  if (sets === undefined || presets === undefined) return <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} />;
  return (
    <div className="lpr">
      <style>{CSS}</style>
      <div className="lpr-cols">
        <div>
          <span className="lpr-k">Prompt sets</span>
          {sets.map((set) => (
            <div key={set.id} className="lpr-set">
              <b style={SANS}>{set.name}</b>
              <span className="lpr-m">{set.prompts.length} prompts · {set.prompts.reduce((n, p) => n + p.variants.length, 0)} variants</span>
              <div className="lpr-thumbs">
                {set.prompts.slice(0, 8).map((prompt) => prompt.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={prompt.id} src={prompt.thumbUrl} alt="" title={prompt.title} loading="lazy" />
                ) : <span key={prompt.id} title={prompt.title}>{prompt.title.split(" ").slice(0, 2).join(" ")}</span>)}
              </div>
            </div>
          ))}
        </div>
        <div>
          <span className="lpr-k">Style presets · one exact recipe each</span>
          <div className="lpr-presets">
            {presets.map((preset) => (
              <span key={preset.id} className="lpr-preset" data-child={preset.parentPresetId ? "" : undefined} title={[...preset.moodboards.map((m) => `${m.code} ${m.name ?? ""}`), ...preset.profiles.map((p) => `${p.code} ${p.name ?? ""}`), ...preset.srefs.map((s) => `--sref ${s.code}${s.sv ? ` --sv ${s.sv}` : ""}`), preset.parameters ?? ""].join("\n")}>
                {preset.parentPresetId ? preset.perturbation : preset.name}
                {preset.status === "locked" ? <i>locked</i> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="lpr-runs">
        <button type="button" className="lpr-go" onClick={() => setOpen(true)}>New run ▸</button>
        {(runs ?? []).map((run) => (
          <Link key={run.id} href={`/w/${world}/grid?run=${run.id}`} className="lpr-run">
            <b style={SANS}>{run.name}</b>
            <span className="lpr-m">{run.stage}{run.draft ? " · draft" : ""} · {run.jobs} jobs · {run.frames} frames back</span>
          </Link>
        ))}
      </div>
      {open ? <RunDialog ownerUserId={ownerUserId} world={world} sets={sets} presets={presets} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function RunDialog({ ownerUserId, world, sets, presets, onClose }: { ownerUserId: string; world: string; sets: Sets; presets: Presets; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const [setId, setSetId] = useState<string>((sets.find((row) => row.kind === "test_shots") ?? sets[0])?.id ?? "");
  // Locked presets start picked; the rest are Michael's choice.
  const [presetIds, setPresetIds] = useState<Set<string>>(new Set(presets.filter((p) => p.status === "locked").map((p) => p.id)));
  const [stage, setStage] = useState<"screen" | "refine">("screen");
  const [draft, setDraft] = useState(true);
  const [variants, setVariants] = useState<Set<string>>(new Set());
  const [allSeeds, setAllSeeds] = useState(false);
  const [done, setDone] = useState<FunctionReturnType<typeof api.promptGrid.queueRun> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useMutation(api.promptGrid.queueRun);
  const set = sets.find((row) => row.id === setId);
  const keys = useMemo(() => [...new Set((set?.prompts ?? []).flatMap((p) => p.variants.map((v) => v.key)))], [set]);
  useEffect(() => { setDraft(stage === "screen"); }, [stage]);
  const args = { ownerUserId, world, set: setId, presets: [...presetIds], stage, draft, allSeeds, variants: variants.size ? [...variants] : undefined };
  const preview = useQuery(api.promptGrid.previewRun, isAuthenticated && setId && presetIds.size ? args : "skip");
  const toggle = (list: Set<string>, id: string) => { const next = new Set(list); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const send = async () => {
    setBusy(true); setError(null);
    try { setDone(await queue(args)); }
    catch (err) { setError((err instanceof Error ? err.message : String(err)).replace(/^[\s\S]*?ConvexError: /, "").split("\n")[0]!.slice(0, 180)); }
    finally { setBusy(false); }
  };
  return (
    <div className="lpr-scrim" onClick={onClose} role="presentation">
      <div className="lpr-dialog" role="dialog" aria-label="New run" onClick={(event) => event.stopPropagation()}>
        <header className="lpr-h"><div><span className="lpr-k">Prompts × presets × locked seeds</span><h2 style={SANS}>New run</h2></div><button type="button" className="lpr-x" onClick={onClose} aria-label="Close"><X size={14} /></button></header>
        {done ? (
          <div className="lpr-done">
            <Check size={18} aria-hidden />
            <div>
              <b style={SANS}>{done.created} prompts queued</b>
              <p>{done.thread}. {done.pacing.label} at your Midjourney pace. Nothing is sent: you send each one.</p>
              <div className="lpr-row">
                <Link href={`/w/${done.worldKey}/queue?thread=${done.threadId}`} className="lpr-go">Open the queue</Link>
                <Link href={`/w/${done.worldKey}/grid?run=${done.runId}`} className="lpr-ghost">Open the grid</Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            <section className="lpr-sec">
              <span className="lpr-k">Prompt set</span>
              <div className="lpr-row">{sets.map((row) => <button key={row.id} type="button" className="lpr-chip" data-on={row.id === setId || undefined} onClick={() => setSetId(row.id)}>{row.name}<span>{row.prompts.length}</span></button>)}</div>
            </section>
            <section className="lpr-sec">
              <span className="lpr-k">Presets</span>
              <div className="lpr-row">
                {presets.map((preset) => (
                  <button key={preset.id} type="button" className="lpr-chip" data-on={presetIds.has(preset.id) || undefined} data-child={preset.parentPresetId ? "" : undefined} onClick={() => setPresetIds((list) => toggle(list, preset.id))}>
                    {preset.parentPresetId ? `· ${preset.perturbation}` : preset.name}
                  </button>
                ))}
              </div>
            </section>
            <section className="lpr-sec lpr-two">
              <div>
                <span className="lpr-k">Stage</span>
                <div className="lpr-modes">
                  <button type="button" className="lpr-mode" data-on={stage === "screen" || undefined} onClick={() => setStage("screen")}><b style={SANS}>Screen</b><span>Every preset × one wording on its first seed. Draft: 24 small images per job.</span></button>
                  <button type="button" className="lpr-mode" data-on={stage === "refine" || undefined} onClick={() => setStage("refine")}><b style={SANS}>Refine</b><span>The presets you kept × every wording{allSeeds ? " and seed" : ""}, full quality.</span></button>
                </div>
              </div>
              <div>
                <span className="lpr-k">Wordings</span>
                <div className="lpr-row">{keys.map((key) => <button key={key} type="button" className="lpr-chip" data-on={variants.size === 0 || variants.has(key) || undefined} onClick={() => setVariants((list) => toggle(list.size ? list : new Set(keys), key))}>{key}</button>)}</div>
                <label className="lpr-check"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Draft</label>
                {stage === "refine" ? <label className="lpr-check"><input type="checkbox" checked={allSeeds} onChange={(event) => setAllSeeds(event.target.checked)} /> Every locked seed</label> : null}
              </div>
            </section>
            {preview ? (
              <section className="lpr-sec">
                <div className="lpr-count"><b style={SANS}>{preview.jobs} jobs</b><span>{preview.pacing.label} at 30 an hour, 150 a day</span></div>
                {stage === "screen" ? <p className="lpr-m">{preview.refineHint}</p> : null}
                {preview.sample[0] ? <code className="lpr-cmd">{preview.sample[0].command}</code> : null}
              </section>
            ) : null}
            <footer className="lpr-f">
              <span className="lpr-m">One queue thread, screening first. You send every job yourself.</span>
              {error ? <span className="lpr-err">{error}</span> : null}
              <button type="button" className="lpr-go" disabled={!preview?.jobs || busy} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" size={13} /> : null}Queue {preview?.jobs ?? ""} for Midjourney</button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.lpr-k{display:block;margin-bottom:8px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lpr-m{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10.5px;color:var(--lm-text-tertiary)}
.lpr-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}
.lpr-set{display:flex;flex-direction:column;gap:5px;padding:10px 12px;margin-bottom:8px;border:1px solid var(--lm-border-subtle);border-radius:8px}
.lpr-set b{font-size:15px;font-weight:900;text-transform:uppercase}
.lpr-thumbs{display:flex;gap:3px;overflow:hidden}
.lpr-thumbs img,.lpr-thumbs span{width:64px;height:40px;flex:0 0 auto;object-fit:cover;border-radius:4px;background:var(--lm-surface-2);font-size:9px;line-height:1.1;padding:3px;color:var(--lm-text-tertiary);overflow:hidden}
.lpr-presets{display:flex;flex-wrap:wrap;gap:5px}
.lpr-preset{display:inline-flex;gap:6px;align-items:baseline;font-size:12px;font-weight:700;text-transform:uppercase;padding:5px 9px;border-radius:999px;border:1px solid var(--lm-border-subtle)}
.lpr-preset[data-child]{font-weight:500;text-transform:none;color:var(--lm-text-secondary);border-style:dashed}
.lpr-preset i{font-style:normal;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9px;color:var(--lm-text-tertiary)}
.lpr-runs{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:stretch}
.lpr-run{display:flex;flex-direction:column;gap:3px;padding:9px 12px;border:1px solid var(--lm-border-subtle);border-radius:8px}
.lpr-run:hover{border-color:var(--lm-border-strong)}
.lpr-run b{font-size:13px;font-weight:800;text-transform:uppercase}
.lpr-go{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:10px 16px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
.lpr-go:disabled{opacity:.4}
.lpr-ghost{display:inline-flex;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:10px 16px;border-radius:999px;border:1px solid var(--lm-border-strong)}
.lpr-scrim{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.5)}
.lpr-dialog{width:min(900px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:12px;border:1px solid var(--lm-border-subtle);background:var(--lm-paper);color:var(--lm-text-primary);box-shadow:0 30px 80px rgba(0,0,0,.35)}
.lpr-h{display:flex;justify-content:space-between;gap:12px;padding:18px 20px 4px}
.lpr-h h2{font-size:26px;font-weight:900;text-transform:uppercase;line-height:1}
.lpr-x{width:30px;height:30px;display:grid;place-items:center;border-radius:999px;border:1px solid var(--lm-border-strong)}
.lpr-sec{padding:10px 20px}
.lpr-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.lpr-row{display:flex;flex-wrap:wrap;gap:6px}
.lpr-chip{display:inline-flex;gap:6px;align-items:baseline;font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-border-subtle);color:var(--lm-text-secondary)}
.lpr-chip span{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;color:var(--lm-text-tertiary)}
.lpr-chip[data-child]{font-weight:500;border-style:dashed}
.lpr-chip[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong);color:var(--lm-text-primary)}
.lpr-modes{display:grid;gap:6px}
.lpr-mode{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:8px;border:1px solid var(--lm-border-subtle);text-align:left}
.lpr-mode b{font-size:13px;font-weight:900;text-transform:uppercase}
.lpr-mode span{font-size:12px;color:var(--lm-text-secondary)}
.lpr-mode[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.lpr-check{display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:var(--lm-text-secondary)}
.lpr-count{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.lpr-count b{font-size:22px;font-weight:900;text-transform:uppercase}
.lpr-count span{font-size:13px;color:var(--lm-text-secondary)}
.lpr-cmd{display:block;margin-top:8px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;line-height:1.5;color:var(--lm-text-secondary);word-break:break-word;max-height:110px;overflow:auto}
.lpr-f{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid var(--lm-border-subtle);background:var(--lm-paper)}
.lpr-err{font-size:12px;color:var(--lm-coral)}
.lpr-done{display:flex;gap:12px;padding:16px 20px 22px}
.lpr-done b{font-size:18px;font-weight:900;text-transform:uppercase}
.lpr-done p{margin:6px 0 12px;font-size:13px;color:var(--lm-text-secondary)}
`;
