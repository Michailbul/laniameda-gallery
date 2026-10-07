"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { BookOpenText, Plus, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type Collection = { _id: string; name: string; parentFolderId?: string; kind?: "storybook" };
type Story = Doc<"stories">;
const fieldClass = "w-full rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2 text-sm text-[var(--lm-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--lm-coral)]";

export function StoriesView({ ownerUserId, collections }: { ownerUserId: string; collections: Collection[] }) {
  const { isAuthenticated } = useConvexAuth();
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState("");
  const [kind, setKind] = useState<Story["kind"] | "">("");
  const [status, setStatus] = useState<Story["status"] | "">("");
  const [selected, setSelected] = useState<Story | "new" | null>(null);
  const stories = useQuery(api.stories.listStories, isAuthenticated ? { ownerUserId, folderId: (folderId || undefined) as Id<"folders"> | undefined, kind: kind || undefined, status: status || undefined, search: search.trim() || undefined, limit: 500 } : "skip");
  const names = useMemo(() => new Map(collections.map((folder) => [folder._id, folder.name])), [collections]);
  const visible = stories;
  return <section className="px-4 py-5 md:px-6" style={{ fontFamily: "var(--lm-font)", color: "var(--lm-text-primary)" }}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold"><BookOpenText size={18} /> Stories / Scripts</h2><p className="mt-1 text-sm text-[var(--lm-text-tertiary)]">Ideas, scripts, and the style locks that hold each world together.</p></div>
      <button disabled={!isAuthenticated} className="lm-glass-icon-btn lm-glass-text-btn gap-2 disabled:opacity-50" onClick={() => setSelected("new")}><Plus size={16} /> New text</button>
    </div>
    <div className="mb-5 flex flex-wrap gap-2">
      <label className="relative min-w-48 flex-1"><Search size={15} className="absolute left-3 top-3 text-[var(--lm-text-tertiary)]" /><input aria-label="Search stories" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ideas and scripts…" className={`${fieldClass} pl-9`} /></label>
      <select aria-label="Filter stories by world" className={fieldClass + " !w-auto"} value={folderId} onChange={(e) => setFolderId(e.target.value)}><option value="">All worlds</option>{collections.filter((f) => !f.kind).map((f) => <option key={f._id} value={f._id}>{f.parentFolderId ? `${names.get(f.parentFolderId)} › ` : ""}{f.name}</option>)}</select>
      <select aria-label="Filter text type" className={fieldClass + " !w-auto"} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="">All text</option><option value="idea">Ideas</option><option value="script">Scripts</option><option value="style-lock">Style locks</option></select>
      <select aria-label="Filter story status" className={fieldClass + " !w-auto"} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="">All statuses</option>{["idea", "draft", "ready", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
    </div>
    <div className={selected ? "grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(340px,1.2fr)]" : ""}>
      <div className={selected ? "space-y-3" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
        {visible === undefined ? <p>Loading texts…</p> : visible.length === 0 ? <p className="py-12 text-sm text-[var(--lm-text-tertiary)]">No texts here yet. Save an idea without an image.</p> : visible.map((story) => <button key={story._id} onClick={() => setSelected(story)} className="lm-island rounded-2xl p-5 text-left" aria-pressed={selected !== "new" && selected?._id === story._id}>
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--lm-text-tertiary)]"><span>{story.kind === "style-lock" ? "Style lock" : story.kind}</span><span>· {story.status}</span>{story.folderId && <span>· {names.get(story.folderId) ?? "World"}</span>}</div>
          <h3 className="mb-2 font-semibold">{story.title}</h3><p className="line-clamp-3 whitespace-pre-line text-sm text-[var(--lm-text-secondary)]">{story.hook || story.logline || story.body}</p>
          {story.styleTag && <p className="mt-3 text-xs text-[var(--lm-text-tertiary)]">{story.styleTag}</p>}
        </button>)}
      </div>
      {selected && <StoryEditor key={selected === "new" ? "new" : selected._id} ownerUserId={ownerUserId} story={selected === "new" ? undefined : selected} collections={collections} onClose={() => setSelected(null)} />}
    </div>
  </section>;
}

function StoryEditor({ ownerUserId, story, collections, onClose }: { ownerUserId: string; story?: Story; collections: Collection[]; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const [title, setTitle] = useState(story?.title ?? "");
  const [body, setBody] = useState(story?.body ?? "");
  const [kind, setKind] = useState<Story["kind"]>(story?.kind ?? "idea");
  const [status, setStatus] = useState<Story["status"]>(story?.status ?? "draft");
  const [folderId, setFolderId] = useState<string>(story?.folderId ?? "");
  const [styleTag, setStyleTag] = useState(story?.styleTag ?? "");
  const [logline, setLogline] = useState(story?.logline ?? "");
  const [hook, setHook] = useState(story?.hook ?? "");
  const [tags, setTags] = useState(story?.tagNames.join(", ") ?? "");
  const [storybookId, setStorybookId] = useState<string>(story?.storybookId ?? "");
  const [assetIds, setAssetIds] = useState<Id<"assets">[]>(story?.assetIds ?? []);
  const [ingestKey] = useState(() => story?.ingestKey ?? `text:${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const save = useMutation(api.stories.saveStory);
  const history = useQuery(api.stories.listStoryRevisions, isAuthenticated && story && historyOpen ? { ownerUserId, id: story._id } : "skip");
  const links = useQuery(api.stories.getStoryLinkStatus, isAuthenticated && story ? { ownerUserId, id: story._id } : "skip");
  const missingLinks = Boolean(links && (links.missingAssetIds.some((id) => assetIds.includes(id)) || (links.missingFolder && folderId === story?.folderId) || (links.missingStorybook && storybookId === story?.storybookId)));
  const names = new Map(collections.map((folder) => [folder._id, folder.name]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      await save({ ownerUserId, ingestKey, title, body, kind, status, folderId: (folderId || undefined) as Id<"folders"> | undefined, styleTag: styleTag || undefined, logline: logline || undefined, hook: hook || undefined, tagNames: tags.split(",").map((tag) => tag.trim()).filter(Boolean), assetIds, storybookId: (storybookId || undefined) as Id<"folders"> | undefined, expectedRevision: story?.revision ?? 0 });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save text."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="lm-island h-fit space-y-4 rounded-2xl p-5">
    <div className="flex items-center justify-between"><h3 className="font-semibold">{story ? "Edit text" : "New text"}</h3><button type="button" className="lm-glass-icon-btn" onClick={onClose} aria-label="Close text editor"><X size={16} /></button></div>
    <label className="block text-xs">Title<input required maxLength={200} className={`${fieldClass} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs">Type<select className={`${fieldClass} mt-1`} value={kind} onChange={(e) => setKind(e.target.value as Story["kind"])}><option value="idea">Idea</option><option value="script">Script</option><option value="style-lock">Style lock</option></select></label><label className="text-xs">Status<select className={`${fieldClass} mt-1`} value={status} onChange={(e) => setStatus(e.target.value as Story["status"])}>{["idea", "draft", "ready", "archived"].map((s) => <option key={s}>{s}</option>)}</select></label></div>
    <label className="block text-xs">World / format<select className={`${fieldClass} mt-1`} value={folderId} onChange={(e) => setFolderId(e.target.value)}><option value="">Unassigned idea</option>{collections.filter((f) => !f.kind).map((f) => <option key={f._id} value={f._id}>{f.parentFolderId ? `${names.get(f.parentFolderId)} › ` : ""}{f.name}</option>)}</select></label>
    <label className="block text-xs">Style<input className={`${fieldClass} mt-1`} value={styleTag} onChange={(e) => setStyleTag(e.target.value)} placeholder="World's locked look" /></label>
    <label className="block text-xs">Opening hook<input className={`${fieldClass} mt-1`} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="What is already happening when we arrive?" /></label>
    <label className="block text-xs">Logline<input className={`${fieldClass} mt-1`} value={logline} onChange={(e) => setLogline(e.target.value)} /></label>
    <label className="block text-xs">Text<textarea required maxLength={200000} rows={15} className={`${fieldClass} mt-1 leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the idea, beats, script, or world style lock…" /></label>
    <label className="block text-xs">Tags<input className={`${fieldClass} mt-1`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="relationship, longing, short-story" /></label>
    <label className="block text-xs">Visual storybook<select className={`${fieldClass} mt-1`} value={storybookId} onChange={(e) => setStorybookId(e.target.value)}><option value="">No visual storybook</option>{collections.filter((f) => f.kind === "storybook").map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}</select></label>
    {story && assetIds.length > 0 && <p className="text-xs text-[var(--lm-text-tertiary)]">{assetIds.length} source assets linked · revision {story.revision}</p>}
    {missingLinks && links && <div className="rounded-xl border border-[var(--lm-border)] p-3 text-xs"><p>Some source links no longer exist in the gallery. Remove those links to save your changes. Earlier versions keep the original references.</p><button type="button" className="mt-2 text-[var(--lm-coral)]" onClick={() => { setAssetIds((ids) => ids.filter((id) => !links.missingAssetIds.includes(id))); if (links.missingFolder && folderId === story?.folderId) setFolderId(""); if (links.missingStorybook && storybookId === story?.storybookId) setStorybookId(""); }}>Remove unavailable links</button></div>}
    {error && <p role="alert" className="text-sm text-[var(--lm-coral)]">{error}</p>}
    <button type="submit" disabled={!isAuthenticated || busy || missingLinks || !title.trim() || !body.trim()} className="rounded-xl bg-[var(--lm-coral)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save text"}</button>
    {story && <div><button type="button" onClick={() => setHistoryOpen(!historyOpen)} className="text-xs text-[var(--lm-text-tertiary)]">{historyOpen ? "Hide history" : "Revision history"}</button>{historyOpen && <div className="mt-3 space-y-3">{history === undefined ? "Loading…" : history.length === 0 ? <p className="text-xs">No older versions.</p> : history.map((version) => <details key={version._id} className="rounded-xl border border-[var(--lm-border)] p-3"><summary className="cursor-pointer text-xs">Revision {version.revision} · {version.title}</summary><p className="mt-3 whitespace-pre-wrap text-sm">{version.body}</p></details>)}</div>}</div>}
  </form>;
}
