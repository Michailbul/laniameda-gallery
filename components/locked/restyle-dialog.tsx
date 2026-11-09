"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// "Redo in style": locked location prompts (one, a place, or many) × world
// styles → one MJ Queue thread Michael sends himself, one job per click.
// Opened from the project page (a place or a prompt), the styles page (a
// style) and an open frame (its locked prompt). Two honest modes.

type Prompts = FunctionReturnType<typeof api.lockedPrompts.listLockedPrompts>["prompts"];
type Mode = "seed" | "frame";
type Result = FunctionReturnType<typeof api.lockedPrompts.restyleLockedPrompts>;

const SANS: CSSProperties = { fontFamily: "var(--font-geist-sans), system-ui, sans-serif" };

export type RestylePreset = { promptIds?: string[]; places?: string[]; styleIds?: string[] };

export function RestyleDialog({ ownerUserId, world, preset, onClose }: {
  ownerUserId: string; world: string; preset: RestylePreset; onClose: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const listing = useQuery(api.lockedPrompts.listLockedPrompts, isAuthenticated ? { ownerUserId, world } : "skip");
  const styles = useQuery(api.worldStyles.listStyles, isAuthenticated ? { ownerUserId, world, coverLimit: 1 } : "skip");
  const restyle = useMutation(api.lockedPrompts.restyleLockedPrompts);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [styleIds, setStyleIds] = useState<Set<string>>(new Set(preset.styleIds ?? []));
  const [mode, setMode] = useState<Mode>("seed");
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompts: Prompts = useMemo(() => listing?.prompts ?? [], [listing]);
  // The preset decides the first selection once the prompts are in.
  useEffect(() => {
    if (!listing) return;
    const ids = new Set(preset.promptIds ?? []);
    for (const place of preset.places ?? []) {
      const key = place.toLowerCase();
      for (const row of listing.prompts) if (row.place.toLowerCase() === key || row.place.toLowerCase().startsWith(`${key} ·`)) ids.add(row.id);
    }
    setPicked(ids);
  }, [listing, preset.promptIds, preset.places]);

  const groups = useMemo(() => {
    const map = new Map<string, Prompts>();
    for (const row of prompts) {
      const area = row.place.split("·")[0]!.trim();
      map.set(area, [...(map.get(area) ?? []), row]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [prompts]);
  const withFrame = prompts.filter((row) => picked.has(row.id) && row.lockedFrame).length;
  const count = picked.size * styleIds.size;

  const args = useMemo(() => ({ ownerUserId, world, prompts: [...picked], styles: [...styleIds], mode }), [ownerUserId, world, picked, styleIds, mode]);
  useEffect(() => {
    setPreview(null);
    if (!picked.size || !styleIds.size) return;
    let live = true;
    const timer = setTimeout(() => {
      restyle({ ...args, dryRun: true }).then((result) => { if (live) setPreview(result); }, () => undefined);
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [args, picked.size, styleIds.size, restyle]);

  const send = async () => {
    setBusy(true); setError(null);
    try { setDone(await restyle(args)); }
    catch (err) { setError((err instanceof Error ? err.message : String(err)).replace(/^[\s\S]*?ConvexError: /, "").split("\n")[0]!.slice(0, 160)); }
    finally { setBusy(false); }
  };
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const sample = preview?.items[0];

  return (
    <div className="lmr-scrim" onClick={onClose} role="presentation">
      <style>{CSS}</style>
      <div className="lmr" role="dialog" aria-label="Redo in style" onClick={(event) => event.stopPropagation()}>
        <header className="lmr-h">
          <div>
            <span className="lmr-kicker">Locked locations</span>
            <h2 style={SANS}>Redo in style</h2>
          </div>
          <button type="button" className="lmr-x" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </header>

        {done ? (
          <div className="lmr-done">
            <Check size={18} aria-hidden />
            <div>
              <b style={SANS}>{done.items.filter((item) => item.created).length} prompts queued</b>
              <p>{done.thread}. Nothing is sent: open the queue and send each one yourself.</p>
              <Link href={`/w/${done.worldKey}/queue?thread=${done.threadId}`} className="lmr-go">Open the queue</Link>
            </div>
          </div>
        ) : (
          <>
            <section className="lmr-sec">
              <span className="lmr-kicker">Places</span>
              {listing === undefined ? <Loader2 className="animate-spin" size={14} /> : !prompts.length ? <p className="lmr-dim">No locked locations in this world yet.</p> : (
                <div className="lmr-places">
                  {groups.map(([area, rows]) => {
                    const all = rows.every((row) => picked.has(row.id));
                    return (
                      <div key={area} className="lmr-area">
                        <button type="button" className="lmr-area-h" data-on={all || undefined}
                          onClick={() => setPicked((set) => { const next = new Set(set); for (const row of rows) { if (all) next.delete(row.id); else next.add(row.id); } return next; })}>
                          {area}<span>{rows.filter((row) => picked.has(row.id)).length}/{rows.length}</span>
                        </button>
                        <div className="lmr-chips">
                          {rows.map((row) => (
                            <button key={row.id} type="button" className="lmr-chip" data-on={picked.has(row.id) || undefined} onClick={() => setPicked((set) => toggle(set, row.id))} title={row.text}>
                              {row.lockedFrame?.thumbUrl || row.imagePrompts[0]?.thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={row.lockedFrame?.thumbUrl ?? row.imagePrompts[0]?.thumbUrl} alt="" loading="lazy" />
                              ) : null}
                              <span>{row.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="lmr-sec">
              <span className="lmr-kicker">Styles</span>
              <div className="lmr-styles">
                {(styles?.styles ?? []).map((style) => (
                  <button key={style.id} type="button" className="lmr-style" data-on={styleIds.has(style.id) || undefined} onClick={() => setStyleIds((set) => toggle(set, style.id))}>
                    {style.covers[0]?.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={style.covers[0].thumbUrl} alt="" loading="lazy" />
                    ) : <span className="lmr-style-blank" />}
                    <span style={SANS}>{style.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lmr-sec">
              <span className="lmr-kicker">How</span>
              <div className="lmr-modes">
                <button type="button" className="lmr-mode" data-on={mode === "seed" || undefined} onClick={() => setMode("seed")}>
                  <b style={SANS}>Same prompt and seed</b>
                  <span>A new picture with a similar composition. A different style reference or profile still moves it.</span>
                </button>
                <button type="button" className="lmr-mode" data-on={mode === "frame" || undefined} onClick={() => setMode("frame")}>
                  <b style={SANS}>Restyle the locked frame</b>
                  <span>Keeps the exact layout of the frame you picked, changes only the look.{picked.size ? ` ${withFrame} of ${picked.size} have a locked frame; the rest go as same prompt and seed.` : ""}</span>
                </button>
              </div>
            </section>

            {sample ? (
              <section className="lmr-sec">
                <span className="lmr-kicker">First prompt · {sample.style}</span>
                <code className="lmr-cmd">{sample.command}</code>
              </section>
            ) : null}

            <footer className="lmr-f">
              <span className="lmr-dim">{count ? `${count} prompts into one queue thread. You send each one.` : "Pick places and styles."}</span>
              {error ? <span className="lmr-err">{error}</span> : null}
              <button type="button" className="lmr-send" disabled={!count || busy} onClick={() => void send()}>
                {busy ? <Loader2 className="animate-spin" size={13} /> : null}Queue {count || ""} for Midjourney
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export type LockedStyleId = Id<"worldStyles">;

const CSS = `
.lmr-scrim{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.5)}
.lmr{width:min(860px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:12px;border:1px solid var(--lm-border-subtle);background:var(--lm-paper);color:var(--lm-text-primary);font-family:var(--font-geist-sans),system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.lmr-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 6px}
.lmr-h h2{font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:-.01em;line-height:1}
.lmr-kicker{display:block;margin-bottom:8px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lmr-x{width:30px;height:30px;display:grid;place-items:center;border-radius:999px;border:1px solid var(--lm-border-strong)}
.lmr-sec{padding:12px 20px}
.lmr-dim{font-size:12.5px;color:var(--lm-text-tertiary)}
.lmr-places{display:flex;flex-direction:column;gap:12px}
.lmr-area-h{display:inline-flex;gap:8px;align-items:baseline;font-size:13px;font-weight:900;text-transform:uppercase;margin-bottom:6px;padding:3px 9px;border-radius:999px}
.lmr-area-h span{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:500;color:var(--lm-text-tertiary)}
.lmr-area-h[data-on]{background:var(--lm-surface-2)}
.lmr-chips{display:flex;flex-wrap:wrap;gap:6px}
.lmr-chip{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:4px 10px 4px 4px;border-radius:999px;border:1px solid var(--lm-border-subtle);font-size:12.5px;color:var(--lm-text-secondary);text-align:left}
.lmr-chip img{width:34px;height:22px;object-fit:cover;border-radius:999px}
.lmr-chip[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong);color:var(--lm-text-primary)}
.lmr-styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.lmr-style{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:8px;border:1px solid var(--lm-border-subtle);text-align:left;font-size:12px;font-weight:800;text-transform:uppercase;opacity:.75}
.lmr-style img,.lmr-style-blank{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:5px;background:var(--lm-surface-2)}
.lmr-style[data-on]{opacity:1;background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.lmr-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px}
.lmr-mode{display:flex;flex-direction:column;gap:5px;padding:12px 14px;border-radius:8px;border:1px solid var(--lm-border-subtle);text-align:left}
.lmr-mode b{font-size:14px;font-weight:900;text-transform:uppercase}
.lmr-mode span{font-size:12.5px;line-height:1.45;color:var(--lm-text-secondary)}
.lmr-mode[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.lmr-cmd{display:block;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;line-height:1.5;color:var(--lm-text-secondary);word-break:break-word;max-height:120px;overflow:auto}
.lmr-f{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid var(--lm-border-subtle);background:var(--lm-paper)}
.lmr-err{font-size:12px;color:var(--lm-coral)}
.lmr-send{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:10px 16px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
.lmr-send:disabled{opacity:.4}
.lmr-done{display:flex;gap:12px;padding:16px 20px 22px}
.lmr-done b{font-size:18px;font-weight:900;text-transform:uppercase}
.lmr-done p{margin:6px 0 12px;font-size:13px;color:var(--lm-text-secondary)}
.lmr-go{display:inline-flex;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:9px 14px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
`;
