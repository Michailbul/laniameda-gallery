"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

export type PresetFilters = Doc<"galleryPresets">["filters"];
export function FilterPresets({ ownerUserId, current, onApply, validFilterIds, validFolderIds, includeSkills, onIncludeSkillsChange }: { ownerUserId: string; current: PresetFilters; onApply: (filters: PresetFilters) => void; validFilterIds: Set<string>; validFolderIds: Set<string>; includeSkills: boolean; onIncludeSkillsChange: (next: boolean) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const presets = useQuery(api.galleryPresets.listPresets, isAuthenticated ? { ownerUserId } : "skip");
  const save = useMutation(api.galleryPresets.savePreset);
  const seed = useMutation(api.galleryPresets.seedPresets);
  const remove = useMutation(api.galleryPresets.deletePreset);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const apply = (filters: PresetFilters) => {
    if ([...filters.selectedFilterIds, ...filters.excludedFilterIds].some((id) => !validFilterIds.has(id)) || (filters.folderId && !validFolderIds.has(filters.folderId))) { setError("This preset refers to an unavailable filter or collection. Save the current filters under its name to update it."); return; }
    setError(""); onApply(filters);
  };
  const run = async (task: () => Promise<unknown>) => { if (busy || !isAuthenticated) return; setBusy(true); setError(""); try { await task(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save preset."); } finally { setBusy(false); } };
  return <div className="mx-4 mb-3 space-y-2 text-xs" style={{ fontFamily: "var(--lm-font)", color: "var(--lm-text-secondary)" }}>
    <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[var(--lm-text-tertiary)]">Presets</span>{presets?.map((preset) => <span key={preset._id} className="flex shrink-0 items-center gap-1"><button type="button" className="lm-glass-icon-btn lm-glass-text-btn" onClick={() => apply(preset.filters)}>{preset.name}</button>{editing && <button aria-label={`Delete ${preset.name} preset`} disabled={busy} onClick={() => void run(() => remove({ ownerUserId, id: preset._id }))}>×</button>}</span>)}{presets?.length === 0 && <button disabled={busy} onClick={() => void run(() => seed({ ownerUserId }))}>Add starter presets</button>}<button type="button" onClick={() => setEditing(!editing)} className="px-2 py-1 text-[var(--lm-text-tertiary)]">{editing ? "Done" : "Save / manage"}</button><label className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap"><input type="checkbox" checked={includeSkills} onChange={(e) => onIncludeSkillsChange(e.target.checked)} /> Include skills</label></div>
    {editing && <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await save({ ownerUserId, name, filters: current }); setName(""); }); }}><input aria-label="Preset name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this filter combination" className="rounded-lg border border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2" maxLength={80} /><button type="submit" disabled={busy || !name.trim()} className="lm-glass-icon-btn lm-glass-text-btn">{busy ? "Saving…" : "Save current"}</button></form>}
    {error && <p role="alert" className="text-[var(--lm-coral)]">{error}</p>}
  </div>;
}
