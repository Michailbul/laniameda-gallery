"use client";

import { useEffect, useState, type CSSProperties } from "react";
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
  const parents = presets.filter((preset) => !preset.parentPresetId);
  const childrenOf = (id: string) => presets.filter((preset) => preset.parentPresetId === id);
  return (
    <div className="lpr">
      <style>{CSS}</style>
      <span className="lpr-k">Looks</span>
      <div className="lpr-cards">
        {parents.map((preset) => <PresetCard key={preset.id} preset={preset} variations={childrenOf(preset.id).length} />)}
      </div>
      <span className="lpr-k" style={{ marginTop: 18 }}>Shots</span>
      <div className="lpr-cards">
        {sets.map((set) => <SetCard key={set.id} set={set} />)}
      </div>
      <div className="lpr-runs">
        <button type="button" className="lpr-go" onClick={() => setOpen(true)}>Compare looks</button>
        {(runs ?? []).map((run) => (
          <Link key={run.id} href={`/w/${world}/grid?run=${run.id}`} className="lpr-run">
            <b style={SANS}>{run.name}</b>
            <span className="lpr-m">{run.frames ? `${run.frames} pictures back` : `${run.jobs} to send`}</span>
          </Link>
        ))}
      </div>
      {open ? <RunDialog ownerUserId={ownerUserId} world={world} sets={sets} presets={presets} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

type Preset = Presets[number];
type PromptSet = Sets[number];

function Mosaic({ urls, words }: { urls: string[]; words?: string }) {
  if (!urls.length) return <div className="lpr-mosaic lpr-mosaic--words"><span>{words ?? "No pictures yet"}</span></div>;
  return (
    <div className="lpr-mosaic" data-n={Math.min(urls.length, 3)}>
      {urls.slice(0, 3).map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={url} alt="" loading="lazy" />
      ))}
    </div>
  );
}

function PresetCard({ preset, variations, on, onClick }: { preset: Preset; variations?: number; on?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <Mosaic urls={preset.covers} />
      <span className="lpr-name" style={SANS}>{preset.name.replace(/^CAS /, "")}</span>
      {variations ? <span className="lpr-m">+{variations} variations</span> : null}
    </>
  );
  return onClick
    ? <button type="button" className="lpr-card" data-on={on || undefined} onClick={onClick}>{body}</button>
    : <div className="lpr-card">{body}</div>;
}

function SetCard({ set, on, onClick }: { set: PromptSet; on?: boolean; onClick?: () => void }) {
  const pictures = set.prompts.map((prompt) => prompt.thumbUrl).filter(Boolean) as string[];
  const body = (
    <>
      <Mosaic urls={pictures} words={set.prompts.slice(0, 4).map((prompt) => prompt.title).join(" · ")} />
      <span className="lpr-name" style={SANS}>{set.name.replace(/^Cassandra /, "")}</span>
      <span className="lpr-m">{set.prompts.length} shots</span>
    </>
  );
  return onClick
    ? <button type="button" className="lpr-card" data-on={on || undefined} onClick={onClick}>{body}</button>
    : <div className="lpr-card">{body}</div>;
}

function RunDialog({ ownerUserId, world, sets, presets, onClose }: { ownerUserId: string; world: string; sets: Sets; presets: Presets; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const [setId, setSetId] = useState<string>((sets.find((row) => row.kind === "test_shots") ?? sets[0])?.id ?? "");
  // Locked presets start picked; the rest are Michael's choice.
  const [presetIds, setPresetIds] = useState<Set<string>>(new Set(presets.filter((p) => p.status === "locked").map((p) => p.id)));
  const [stage, setStage] = useState<"screen" | "refine">("screen");
  const [draft, setDraft] = useState(true);
  const [allSeeds, setAllSeeds] = useState(false);
  const [done, setDone] = useState<FunctionReturnType<typeof api.promptGrid.queueRun> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useMutation(api.promptGrid.queueRun);
  useEffect(() => { setDraft(stage === "screen"); }, [stage]);
  const args = { ownerUserId, world, set: setId, presets: [...presetIds], stage, draft, allSeeds };
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
        <header className="lpr-h"><div><span className="lpr-k">Same shots, several looks</span><h2 style={SANS}>Compare looks</h2></div><button type="button" className="lpr-x" onClick={onClose} aria-label="Close"><X size={14} /></button></header>
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
              <span className="lpr-k">Shots</span>
              <div className="lpr-cards">{sets.map((row) => <SetCard key={row.id} set={row} on={row.id === setId} onClick={() => setSetId(row.id)} />)}</div>
            </section>
            <section className="lpr-sec">
              <span className="lpr-k">Looks</span>
              <div className="lpr-cards">
                {presets.filter((preset) => !preset.parentPresetId).map((preset) => {
                  const kids = presets.filter((row) => row.parentPresetId === preset.id);
                  return (
                    <div key={preset.id} className="lpr-pick">
                      <PresetCard preset={preset} on={presetIds.has(preset.id)} onClick={() => setPresetIds((list) => toggle(list, preset.id))} />
                      {kids.length ? (
                        <div className="lpr-kids">
                          {kids.map((kid) => <button key={kid.id} type="button" className="lpr-kid" data-on={presetIds.has(kid.id) || undefined} onClick={() => setPresetIds((list) => toggle(list, kid.id))} title={kid.name}>{kid.perturbation}</button>)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
                <p className="lpr-m">{stage === "screen" ? "One wording per shot, on its first seed." : `Every wording${allSeeds ? " on every seed" : ""}.`}</p>
                {stage === "refine" ? <label className="lpr-check"><input type="checkbox" checked={allSeeds} onChange={(event) => setAllSeeds(event.target.checked)} /> Every seed too</label> : null}
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
.lpr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.lpr-card{display:flex;flex-direction:column;gap:5px;padding:5px 5px 8px;border-radius:9px;border:1px solid transparent;text-align:left;background:transparent}
button.lpr-card:hover{background:var(--lm-surface-2)}
.lpr-card[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.lpr-name{font-size:12.5px;font-weight:900;text-transform:uppercase;line-height:1.1;padding:0 2px}
.lpr-card .lpr-m{padding:0 2px}
.lpr-mosaic{display:grid;gap:2px;aspect-ratio:4/3;border-radius:6px;overflow:hidden;background:var(--lm-surface-2)}
.lpr-mosaic[data-n="2"]{grid-template-columns:1fr 1fr}
.lpr-mosaic[data-n="3"]{grid-template-columns:2fr 1fr;grid-template-rows:1fr 1fr}
.lpr-mosaic[data-n="3"] img:first-child{grid-row:1/3}
.lpr-mosaic img{width:100%;height:100%;object-fit:cover;display:block}
.lpr-mosaic--words{display:flex;align-items:flex-end;padding:8px;font-size:11px;line-height:1.3;color:var(--lm-text-tertiary)}
.lpr-pick{display:flex;flex-direction:column;gap:4px}
.lpr-kids{display:flex;flex-wrap:wrap;gap:3px;padding:0 4px}
.lpr-kid{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;padding:2px 6px;border-radius:999px;border:1px dashed var(--lm-border-subtle);color:var(--lm-text-tertiary)}
.lpr-kid[data-on]{background:var(--lm-surface-2);border-style:solid;border-color:var(--lm-border-strong);color:var(--lm-text-primary)}
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
