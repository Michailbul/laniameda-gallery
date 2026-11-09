"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InboxGate } from "@/components/inbox/inbox-ui";

// A prompt run as a grid (/w/<world>/grid?run=<id>): rows = style presets,
// columns = prompts, each cell the frames that came back with their wording
// and seed. Board keys on the hovered frame, cell or row header: 1 keep,
// 2 drop (again clears). Kept frames feed a gallery moodboard; a kept row can
// become a world style. Art-director scope: owner only.

type Verdict = "keep" | "drop";
type Target = { kind: "row"; presetId: string } | { kind: "cell"; presetId: string; promptId: string } | { kind: "frame"; assetId: string };
const SANS: CSSProperties = { fontFamily: "var(--font-geist-sans), system-ui, sans-serif" };

export function RunGridPage({ world, run }: { world: string; run?: string }) {
  return (
    <InboxGate title="Run grid" prompt="Sign in to see the grid">
      {(ownerUserId) => <Grid ownerUserId={ownerUserId} world={world} run={run} />}
    </InboxGate>
  );
}

function Grid({ ownerUserId, world, run }: { ownerUserId: string; world: string; run?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const runs = useQuery(api.promptGrid.listRuns, isAuthenticated ? { ownerUserId, world } : "skip");
  const runId = run ?? runs?.[0]?.id;
  const grid = useQuery(api.promptGrid.getRunGrid, isAuthenticated && runId ? { ownerUserId, run: runId } : "skip");
  const boards = useQuery(api.moodboards.listMoodboards, isAuthenticated && grid ? { ownerUserId, folderId: grid.run.worldId, includeChildren: true, includeArchived: false, previewLimit: 3 } : "skip");
  const presetList = useQuery(api.promptGrid.listPresets, isAuthenticated && grid ? { ownerUserId, world } : "skip");
  const coversOf = (id: string) => presetList?.find((preset) => preset.id === id)?.covers ?? [];
  const setVerdict = useMutation(api.promptGrid.setRunVerdict);
  const addItems = useMutation(api.moodboards.addMoodboardItems);
  const saveStyle = useMutation(api.worldStyles.saveStyle);
  const hovered = useRef<Target | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string>("");
  const [rowForStyle, setRowForStyle] = useState<string | null>(null);
  const recipe = useQuery(api.promptGrid.presetAsRecipe, isAuthenticated && rowForStyle ? { ownerUserId, preset: rowForStyle } : "skip");

  const say = useCallback((text: string) => { setFlash(text); setTimeout(() => setFlash((now) => (now === text ? null : now)), 1600); }, []);

  const current = useCallback((target: Target): Verdict | undefined => {
    if (!grid) return undefined;
    if (target.kind === "row") return grid.presets.find((p) => p.id === target.presetId)?.verdict;
    if (target.kind === "cell") return grid.cells.find((c) => c.presetId === target.presetId && c.promptId === target.promptId)?.verdict;
    for (const cell of grid.cells) { const frame = cell.frames.find((f) => f.assetId === target.assetId); if (frame) return frame.verdict; }
    return undefined;
  }, [grid]);

  const judge = useCallback(async (target: Target, verdict: Verdict) => {
    if (!grid) return;
    const next = current(target) === verdict ? null : verdict;
    const base = { ownerUserId, run: grid.run.id };
    try {
      if (target.kind === "row") await setVerdict({ ...base, presetId: target.presetId as Id<"stylePresets">, verdict: next });
      else if (target.kind === "cell") await setVerdict({ ...base, presetId: target.presetId as Id<"stylePresets">, promptId: target.promptId as Id<"lockedPrompts">, verdict: next });
      else await setVerdict({ ...base, assetId: target.assetId as Id<"assets">, verdict: next });
      say(next === "keep" ? "Kept" : next === "drop" ? "Dropped" : "Cleared");
    } catch { say("Could not save that."); }
  }, [grid, current, ownerUserId, setVerdict, say]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement)?.tagName ?? "")) return;
      const target = hovered.current;
      if (!target) return;
      if (event.key === "1") { event.preventDefault(); void judge(target, "keep"); }
      if (event.key === "2") { event.preventDefault(); void judge(target, "drop"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judge]);

  // The kept frames: kept themselves, or in a kept cell or row, and not dropped.
  const kept = grid ? grid.cells.flatMap((cell) => {
    const rowKept = grid.presets.find((p) => p.id === cell.presetId)?.verdict === "keep";
    return cell.frames.filter((frame) => frame.verdict === "keep" || (frame.verdict !== "drop" && (cell.verdict === "keep" || (rowKept && cell.verdict !== "drop"))));
  }) : [];

  const toBoard = async () => {
    if (!boardId || !kept.length) return;
    try {
      await addItems({ ownerUserId, moodboardId: boardId as Id<"moodboards">, assetIds: kept.map((f) => f.assetId), note: `kept on run ${grid?.run.name}` });
      say(`${kept.length} kept frames added to the moodboard (gallery first; mirror to Midjourney after review)`);
    } catch (err) { say((err instanceof Error ? err.message : String(err)).replace(/^[\s\S]*?ConvexError: /, "").split("\n")[0]!.slice(0, 120)); }
  };

  const makeStyle = async () => {
    if (!recipe) return;
    try {
      const rowFrames = grid!.cells.filter((c) => c.presetId === rowForStyle).flatMap((c) => c.frames).filter((f) => f.verdict !== "drop").slice(0, 6).map((f) => f.assetId);
      const result = await saveStyle({ ownerUserId, world: recipe.world, name: recipe.name, recipes: [recipe.recipe], coverAssetIds: rowFrames, status: "draft", session: "prompt-runs" });
      say(`Saved as the world style ${recipe.name}${result.created ? "" : " (updated)"}`);
    } catch (err) { say((err instanceof Error ? err.message : String(err)).replace(/^[\s\S]*?ConvexError: /, "").split("\n")[0]!.slice(0, 120)); }
    setRowForStyle(null);
  };

  if (runs === undefined || (runId && grid === undefined)) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}><Loader2 className="animate-spin" size={18} /></main>;
  }
  return (
    <main className="lrg min-h-dvh pb-24" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <style>{CSS}</style>
      <header className="lrg-bar">
        <Link href={`/w/${world}/project`} className="lrg-back"><ArrowLeft size={13} aria-hidden />Project</Link>
        <div className="lrg-runs">
          {(runs ?? []).slice(0, 8).map((row) => <Link key={row.id} href={`/w/${world}/grid?run=${row.id}`} className="lrg-pill" data-on={row.id === runId || undefined}>{row.name}</Link>)}
        </div>
      </header>
      {!grid ? <p className="lrg-empty">No runs yet. Start one from the project page.</p> : (
        <>
          <section className="lrg-head">
            <span className="lrg-k">{grid.run.stage}{grid.run.draft ? " · draft" : ""} · {grid.run.jobs} jobs</span>
            <h1 style={SANS}>{grid.run.name}</h1>
            <div className="lrg-tools">
              <Link href={`/w/${grid.run.worldKey}/queue?thread=${grid.run.threadId}`} className="lrg-btn">Open the queue</Link>
              <span className="lrg-k">{kept.length} kept{kept.length ? " · pick a moodboard to add them" : ""}</span>
            </div>
          </section>
          {kept.length && boards?.length ? (
            <div className="lrg-boards">
              {boards.map((board) => (
                <button key={board._id} type="button" className="lrg-board" data-on={boardId === board._id || undefined} onClick={() => setBoardId(board._id)} title={board.name}>
                  <span className="lrg-board-pics">
                    {board.previewItems.slice(0, 3).map((item, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={index} src={item.thumbUrl ?? item.url} alt="" loading="lazy" />
                    ))}
                  </span>
                  <span className="lrg-board-name">{board.name}</span>
                </button>
              ))}
              {boardId ? <button type="button" className="lrg-btn" onClick={() => void toBoard()}>Add {kept.length} kept</button> : null}
            </div>
          ) : null}
          <div className="lrg-scroll">
            <table className="lrg-table">
              <thead>
                <tr>
                  <th />
                  {grid.prompts.map((prompt) => <th key={prompt.id} className="lrg-col" style={SANS}>{prompt.title}<span>{prompt.place}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {grid.presets.map((preset) => (
                  <tr key={preset.id} data-v={preset.verdict}>
                    <th className="lrg-rowh" onMouseEnter={() => { hovered.current = { kind: "row", presetId: preset.id }; }} onMouseLeave={() => { hovered.current = null; }}>
                      <span className="lrg-covers">
                        {coversOf(preset.id).map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={url} src={url} alt="" loading="lazy" />
                        ))}
                      </span>
                      <b style={SANS}>{preset.name.replace(/^CAS /, "")}</b>
                      {preset.verdict ? <span className="lrg-v" data-v={preset.verdict}>{preset.verdict === "keep" ? "Kept" : "Dropped"}</span> : null}
                      <button type="button" className="lrg-mini lrg-hover" onClick={() => setRowForStyle(preset.id)}>Save as style</button>
                    </th>
                    {grid.prompts.map((prompt) => {
                      const cell = grid.cells.find((c) => c.presetId === preset.id && c.promptId === prompt.id);
                      return (
                        <td key={prompt.id} className="lrg-cell" data-v={cell?.verdict} onMouseEnter={() => { hovered.current = { kind: "cell", presetId: preset.id, promptId: prompt.id }; }} onMouseLeave={() => { hovered.current = null; }}>
                          {cell?.frames.length ? (
                            <div className="lrg-frames">
                              {cell.frames.map((frame) => (
                                <figure key={frame.assetId} className="lrg-frame" data-v={frame.verdict}
                                  onMouseEnter={(event) => { event.stopPropagation(); hovered.current = { kind: "frame", assetId: frame.assetId }; }}
                                  onMouseLeave={() => { hovered.current = { kind: "cell", presetId: preset.id, promptId: prompt.id }; }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={frame.thumbUrl} alt="" loading="lazy" style={frame.width && frame.height ? { aspectRatio: `${frame.width} / ${frame.height}` } : undefined} />
                                  <figcaption>{frame.variantKey} · {frame.seed}</figcaption>
                                </figure>
                              ))}
                            </div>
                          ) : <span className="lrg-wait">{cell?.queued ? `${cell.queued} to send` : cell?.sent ? `${cell.sent} sent · not saved yet` : "—"}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {rowForStyle && recipe ? (
        <div className="lrg-confirm">
          <span>Save <b>{recipe.name}</b> as a world style (draft), its frames as covers?</span>
          <button type="button" className="lrg-btn" onClick={() => void makeStyle()}>Save</button>
          <button type="button" className="lrg-mini" onClick={() => setRowForStyle(null)}>Cancel</button>
        </div>
      ) : null}
      {flash ? <div className="lrg-flash">{flash}</div> : null}
      <div className="lrg-keys"><span><kbd>1</kbd> keep</span><span><kbd>2</kbd> drop</span><span>on a frame, a cell or a row</span></div>
    </main>
  );
}

const CSS = `
.lrg{font-family:var(--font-geist-sans),system-ui,sans-serif}
.lrg-k{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lrg-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;padding:10px 16px;background:color-mix(in srgb,var(--lm-paper) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--lm-border-subtle)}
.lrg-back{display:inline-flex;gap:8px;align-items:center;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-secondary)}
.lrg-runs{display:flex;gap:6px;overflow-x:auto}
.lrg-pill{white-space:nowrap;font-size:11px;font-weight:700;padding:5px 10px;border-radius:999px;border:1px solid var(--lm-border-subtle);color:var(--lm-text-secondary)}
.lrg-pill[data-on]{background:var(--lm-surface-2);color:var(--lm-text-primary);border-color:var(--lm-border-strong)}
.lrg-head{padding:28px 16px 12px}
.lrg-head h1{font-size:clamp(28px,5vw,48px);font-weight:900;text-transform:uppercase;line-height:.95;margin:6px 0 12px}
.lrg-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lrg-btn{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:8px 13px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
.lrg-btn:disabled{opacity:.4}
.lrg-boards{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 16px 14px}
.lrg-board{display:flex;flex-direction:column;gap:4px;width:150px;padding:4px;border-radius:8px;border:1px solid transparent;text-align:left}
.lrg-board:hover,.lrg-board[data-on]{background:var(--lm-surface-2);border-color:var(--lm-border-strong)}
.lrg-board-pics{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;aspect-ratio:3/1;border-radius:5px;overflow:hidden;background:var(--lm-surface-2)}
.lrg-board-pics img{width:100%;height:100%;object-fit:cover}
.lrg-board-name{font-size:11px;font-weight:800;text-transform:uppercase;line-height:1.15}
.lrg-covers{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-bottom:6px;border-radius:5px;overflow:hidden}
.lrg-covers img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.lrg-hover{visibility:hidden}
.lrg-rowh:hover .lrg-hover{visibility:visible}
.lrg-select{font-size:12px;padding:7px 10px;border-radius:999px;border:1px solid var(--lm-border-strong);background:var(--lm-paper);color:var(--lm-text-primary)}
.lrg-scroll{overflow-x:auto;padding:0 16px}
.lrg-table{border-collapse:separate;border-spacing:4px}
.lrg-col{min-width:200px;text-align:left;vertical-align:bottom;font-size:12px;font-weight:800;text-transform:uppercase;padding:4px}
.lrg-col span{display:block;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;font-weight:500;color:var(--lm-text-tertiary);text-transform:none}
.lrg-rowh{position:sticky;left:0;z-index:2;background:var(--lm-paper);min-width:170px;max-width:200px;text-align:left;vertical-align:top;padding:8px;border-radius:6px}
.lrg-rowh b{display:block;font-size:12.5px;font-weight:900;text-transform:uppercase;line-height:1.1}
.lrg-rowh:hover,.lrg-cell:hover{outline:1px solid var(--lm-border-strong)}
.lrg-mini{margin-top:6px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid var(--lm-border-subtle);color:var(--lm-text-secondary)}
.lrg-v{display:inline-block;margin-top:4px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:var(--lm-surface-2)}
.lrg-cell{vertical-align:top;min-width:200px;padding:4px;border-radius:6px;background:color-mix(in srgb,var(--lm-surface-2) 40%,transparent)}
tr[data-v=drop] .lrg-cell,.lrg-cell[data-v=drop],.lrg-frame[data-v=drop]{opacity:.35}
.lrg-cell[data-v=keep],.lrg-frame[data-v=keep]{outline:2px solid var(--lm-text-primary)}
.lrg-frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:3px}
.lrg-frame{position:relative;margin:0;border-radius:4px;overflow:hidden;background:var(--lm-surface-2)}
.lrg-frame img{display:block;width:100%;height:auto}
.lrg-frame figcaption{position:absolute;left:3px;bottom:3px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:8.5px;padding:1px 5px;border-radius:3px;background:rgba(10,8,5,.72);color:#fff4ea}
.lrg-wait{display:block;padding:24px 6px;text-align:center;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;color:var(--lm-text-ghost)}
.lrg-empty{padding:60px 16px;color:var(--lm-text-tertiary)}
.lrg-confirm{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:40;display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:999px;background:var(--lm-paper);border:1px solid var(--lm-border-strong);box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:13px}
.lrg-flash{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:50;padding:8px 14px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper);font-size:12px;font-weight:700}
.lrg-keys{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:12px;padding:7px 14px;border-radius:999px;border:1px solid var(--lm-border-subtle);background:color-mix(in srgb,var(--lm-paper) 90%,transparent);font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--lm-text-secondary)}
.lrg-keys kbd{font-weight:800;color:var(--lm-text-primary);margin-right:4px}
@media (min-width:768px){.lrg-bar,.lrg-head,.lrg-scroll{padding-left:28px;padding-right:28px}}
`;
