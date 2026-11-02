"use client";

import { Children, createContext, isValidElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

type Collection = { _id: string; name: string; parentFolderId?: string; kind?: "storybook" };
type Story = Doc<"stories">;
type IndexRow = FunctionReturnType<typeof api.stories.listStoryIndex>[number];
type Picture = FunctionReturnType<typeof api.stories.getStoryPictures>[number];
type ViewMode = "human" | "agent";

// Stories, markdown first. The text is the record: agents write it, and the
// tab reads it two ways. Human renders the markdown with every picture the
// text names (asset:<id>) shown where it is named; Agent shows the raw
// markdown with a front-matter block of ids, the copy an agent pastes from.
// No form of fields: kind, status, world and links are the agents' to set.

const KIND_LABEL: Record<Story["kind"], string> = { script: "Script", idea: "Idea", "style-lock": "Style lock" };
const KIND_ORDER: Story["kind"][] = ["script", "idea", "style-lock"];
const KIND_GROUP: Record<Story["kind"], string> = { script: "Scripts", idea: "Ideas", "style-lock": "Style locks" };
const VIEW_KEY = "lm-stories-view";
// A bare asset:<id> in prose; one already inside markdown ( ![x](asset:id) ) stays as written.
const BARE_ASSET = /(?<![(\w:])asset:([a-z0-9]{20,40})/gi;

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();

const urlTransform = (url: string) => (url.startsWith("asset:") ? url : defaultUrlTransform(url));

export function StoriesView({ ownerUserId, collections, initialStory, openStoryId, onOpenStoryChange }: {
  ownerUserId: string;
  collections: Collection[];
  initialStory?: Story;
  /** The story the address names (/stories/<id>); the view opens it and reports what it opens. */
  openStoryId?: string | null;
  onOpenStoryChange?: (id: string | null) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [search, setSearch] = useState("");
  const [world, setWorld] = useState("");
  const [archive, setArchive] = useState(false);
  const [localId, setLocalId] = useState<string | null>(initialStory?._id ?? null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "agent" ? "agent" : "human");
  useEffect(() => { window.localStorage.setItem(VIEW_KEY, view); }, [view]);

  // The address leads when the dashboard routes; otherwise the local pick.
  const selectedId = creating ? null : openStoryId !== undefined ? openStoryId : localId;
  const select = (id: string | null) => {
    setCreating(false);
    setLocalId(id);
    onOpenStoryChange?.(id);
  };

  const index = useQuery(api.stories.listStoryIndex, isAuthenticated ? { ownerUserId } : "skip");
  const byId = useMemo(() => new Map(collections.map((c) => [c._id, c])), [collections]);
  const worldOf = useMemo(() => (folderId?: string) => {
    if (!folderId) return undefined;
    const folder = byId.get(folderId);
    if (!folder) return undefined;
    return folder.parentFolderId ? byId.get(folder.parentFolderId) ?? folder : folder;
  }, [byId]);

  const live = useMemo(() => (index ?? []).filter((row) => (row.status === "archived") === archive), [index, archive]);
  const archivedCount = useMemo(() => (index ?? []).filter((row) => row.status === "archived").length, [index]);
  const worlds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of (index ?? []).filter((r) => r.status !== "archived")) {
      const w = worldOf(row.folderId);
      if (w) counts.set(w._id, (counts.get(w._id) ?? 0) + 1);
    }
    return [...counts].map(([id, n]) => ({ id, name: byId.get(id)?.name ?? "World", n })).sort((a, b) => b.n - a.n);
  }, [index, worldOf, byId]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.filter((row) =>
      (!world || worldOf(row.folderId)?._id === world) &&
      (!q || row.title.toLowerCase().includes(q) || row.excerpt.toLowerCase().includes(q)));
  }, [live, search, world, worldOf]);
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: shown.filter((row) => row.kind === kind) })).filter((g) => g.rows.length);
  const open = Boolean(selectedId || creating);

  return <section className={`lmst ${open ? "lmst-open" : ""}`}>
    <style href="lm-stories-tab" precedence="default">{CSS}</style>
    <aside className="lmst-index">
      <header className="lmst-head">
        <h2>Stories</h2>
        <span className="lmst-count">{index ? live.length : "…"}</span>
        <button type="button" className="lmst-btn" disabled={!isAuthenticated} onClick={() => { setCreating(true); setLocalId(null); onOpenStoryChange?.(null); }}>+ New</button>
      </header>
      <input className="lmst-search" aria-label="Find a story" placeholder="Find a story" value={search} onChange={(e) => setSearch(e.target.value)} />
      {worlds.length > 1 && <nav className="lmst-worlds" aria-label="Worlds">
        <button type="button" className={!world ? "on" : ""} onClick={() => setWorld("")}>All</button>
        {worlds.map((w) => <button key={w.id} type="button" className={world === w.id ? "on" : ""} onClick={() => setWorld(world === w.id ? "" : w.id)}>{w.name}<b>{w.n}</b></button>)}
      </nav>}
      {index === undefined ? <p className="lmst-quiet">Loading…</p> : groups.length === 0 ? <p className="lmst-quiet">{archive ? "Nothing archived." : "No stories here yet."}</p> : groups.map((group) => <div key={group.kind} className="lmst-group">
        <div className="lmst-kicker">{KIND_GROUP[group.kind]} · {group.rows.length}</div>
        {group.rows.map((row) => <StoryRow key={row._id} row={row} world={worldOf(row.folderId)?.name} active={row._id === selectedId} onOpen={() => select(row._id)} />)}
      </div>)}
      {archivedCount > 0 && <button type="button" className="lmst-archive" onClick={() => { setArchive(!archive); select(null); }}>
        {archive ? "← Back to stories" : `Archive · ${archivedCount}`}
      </button>}
    </aside>
    <main className="lmst-reader">
      {creating ? <StoryEditor key="new" ownerUserId={ownerUserId} worldId={world || undefined} onDone={(id) => select(id)} onCancel={() => setCreating(false)} />
        : selectedId ? <StoryReader key={selectedId} ownerUserId={ownerUserId} id={selectedId as Id<"stories">} initial={initialStory?._id === selectedId ? initialStory : undefined} worldName={(folderId) => worldOf(folderId)?.name} storybookName={(id) => (id ? byId.get(id)?.name : undefined)} view={view} setView={setView} onBack={() => select(null)} />
          : <div className="lmst-empty"><p>Pick a story to read it.</p><p className="lmst-quiet">Human shows the text with its pictures. Agent shows the markdown and ids to copy.</p></div>}
    </main>
  </section>;
}

function StoryRow({ row, world, active, onOpen }: { row: IndexRow; world?: string; active: boolean; onOpen: () => void }) {
  return <button type="button" className={`lmst-row ${active ? "on" : ""}`} onClick={onOpen} aria-pressed={active}>
    <span className="lmst-row-meta">{[world, row.status === "ready" ? "Ready" : row.status === "archived" ? null : "Draft", dateLabel(row.updatedAt)].filter(Boolean).join(" · ")}</span>
    <span className="lmst-row-title">{row.title}</span>
    {row.excerpt && <span className="lmst-row-excerpt">{row.excerpt}</span>}
  </button>;
}

function StoryReader({ ownerUserId, id, initial, worldName, storybookName, view, setView, onBack }: {
  ownerUserId: string; id: Id<"stories">; initial?: Story;
  worldName: (folderId?: string) => string | undefined;
  storybookName: (id?: string) => string | undefined;
  view: ViewMode; setView: (v: ViewMode) => void; onBack: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const fetched = useQuery(api.stories.getStory, isAuthenticated ? { ownerUserId, id } : "skip");
  const story = fetched ?? initial;
  const pictures = useQuery(api.stories.getStoryPictures, isAuthenticated ? { ownerUserId, id } : "skip");
  const save = useMutation(api.stories.saveStory);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<Picture | null>(null);
  const media = useMemo(() => new Map((pictures ?? []).map((p) => [String(p.id), p])), [pictures]);

  if (!story) return <p className="lmst-quiet lmst-pad">Loading…</p>;
  const world = worldName(story.folderId);
  const book = storybookName(story.storybookId);
  const frontMatter = [
    "---",
    `id: story:${story._id}`,
    `kind: ${story.kind}`,
    `status: ${story.status}`,
    story.folderId ? `world: ${world ?? "?"} (folder:${story.folderId})` : "world: none",
    story.storybookId ? `storybook: ${book ?? "?"} (folder:${story.storybookId})` : null,
    story.styleTag ? `style: ${story.styleTag}` : null,
    story.tagNames.length ? `tags: ${story.tagNames.join(", ")}` : null,
    `pictures: ${story.assetIds.length}`,
    `revision: ${story.revision}`,
    `updated: ${new Date(story.updatedAt).toISOString().slice(0, 10)}`,
    `ingestKey: ${story.ingestKey}`,
    "---",
  ].filter(Boolean).join("\n");
  const markdown = `# ${story.title}\n\n${story.logline ? `> ${story.logline}\n\n` : ""}${story.body}`;
  const loose = (pictures ?? []).filter((p) => !p.cited);

  const write = async (patch: Partial<Pick<Story, "title" | "body" | "status">>) => {
    setBusy(true); setError("");
    try {
      // Links that no longer resolve are dropped instead of blocking the save.
      const reachable = pictures ? story.assetIds.filter((a) => media.has(String(a))) : story.assetIds;
      await save({
        ownerUserId, ingestKey: story.ingestKey, title: patch.title ?? story.title, body: patch.body ?? story.body,
        kind: story.kind, status: patch.status ?? story.status, logline: story.logline, hook: story.hook,
        folderId: story.folderId, styleTag: story.styleTag, tagNames: story.tagNames, assetIds: reachable,
        storybookId: story.storybookId, expectedRevision: story.revision,
      });
      setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message.replace(/^.*ConvexError:\s*/, "") : "Could not save."); }
    finally { setBusy(false); }
  };

  return <article className="lmst-doc">
    <div className="lmst-bar">
      <button type="button" className="lmst-back" onClick={onBack}>← Stories</button>
      <div className="lmst-seg" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={view === "human"} className={view === "human" ? "on" : ""} onClick={() => setView("human")}>Human</button>
        <button type="button" role="tab" aria-selected={view === "agent"} className={view === "agent" ? "on" : ""} onClick={() => setView("agent")}>Agent</button>
      </div>
      <span className="lmst-sp" />
      <button type="button" className="lmst-btn" onClick={() => { void navigator.clipboard.writeText(view === "agent" ? `${frontMatter}\n\n${markdown}` : markdown); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy md"}</button>
      {!editing && <button type="button" className="lmst-btn" onClick={() => setEditing(true)}>Edit</button>}
      <button type="button" className="lmst-btn" disabled={busy} onClick={() => void write({ status: story.status === "archived" ? "draft" : "archived" })}>{story.status === "archived" ? "Restore" : "Archive"}</button>
    </div>

    <div className="lmst-kicker">{[world, KIND_LABEL[story.kind], story.status === "ready" ? "Ready" : story.status === "archived" ? "Archived" : "Draft", dateLabel(story.updatedAt)].filter(Boolean).join(" · ")}</div>
    {error && <p className="lmst-error" role="alert">{error}</p>}

    {editing ? <StoryEditor ownerUserId={ownerUserId} story={story} busy={busy} onSave={(title, body) => void write({ title, body })} onCancel={() => { setEditing(false); setError(""); }} />
      : view === "human" ? <>
        <h1 className="lmst-title">{story.title}</h1>
        {book && <p className="lmst-quiet">Storybook: {book}</p>}
        {story.logline && !story.body.includes(story.logline) && <p className="lmst-lede">{story.logline}</p>}
        <HumanMarkdown body={story.body} media={media} onOpen={setLightbox} />
        {loose.length > 0 && <section className="lmst-pictures">
          <div className="lmst-kicker">Pictures · {loose.length}</div>
          <div className="lmst-masonry">{loose.map((p) => <Thumb key={p.id} picture={p} onOpen={setLightbox} />)}</div>
        </section>}
      </> : <>
        <pre className="lmst-front">{frontMatter}</pre>
        <pre className="lmst-raw">{markdown}</pre>
        <Revisions ownerUserId={ownerUserId} id={story._id} />
      </>}

    {lightbox && <div className="lmst-lightbox" role="dialog" aria-label="Picture" onClick={() => setLightbox(null)}>
      {lightbox.kind === "video"
        ? <video src={lightbox.url ?? lightbox.thumbUrl} poster={lightbox.thumbUrl} autoPlay muted loop playsInline />
        // eslint-disable-next-line @next/next/no-img-element -- an R2 original
        : <img src={lightbox.url ?? lightbox.thumbUrl} alt="" />}
      <button type="button" className="lmst-btn" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(`asset:${lightbox.id}`); }}>Copy id</button>
    </div>}
  </article>;
}

function Thumb({ picture, onOpen, inline }: { picture?: Picture; onOpen: (p: Picture) => void; inline?: boolean }) {
  if (!picture?.thumbUrl) return <span className="lmst-missing">picture</span>;
  return <button type="button" className={inline ? "lmst-inline" : "lmst-tile"} onClick={() => onOpen(picture)} title="Open picture">
    {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnails */}
    <img src={picture.thumbUrl} alt="" loading="lazy" width={picture.width} height={picture.height} />
  </button>;
}

type Media = { media: Map<string, Picture>; onOpen: (p: Picture) => void };
const MediaContext = createContext<Media>({ media: new Map(), onOpen: () => {} });

// An image in the markdown. asset:<id> resolves to the gallery picture.
function AssetImg({ src }: { src?: string | Blob }) {
  const { media, onOpen } = useContext(MediaContext);
  const raw = typeof src === "string" ? src : "";
  if (!raw.startsWith("asset:")) {
    // eslint-disable-next-line @next/next/no-img-element -- a link the text carries
    return <img src={raw} alt="" className="lmst-ext" loading="lazy" />;
  }
  return <Thumb picture={media.get(raw.slice(6))} onOpen={onOpen} inline />;
}

// The pictures a line names leave the sentence and sit in a strip under it,
// so the words read straight through and the frames line up beside them.
const splitPictures = (children: ReactNode) => {
  const kids = Children.toArray(children);
  const pictures = kids.filter((kid) => isValidElement(kid) && kid.type === AssetImg);
  const text = kids.filter((kid) => !pictures.includes(kid));
  const hasText = text.some((kid) => typeof kid !== "string" || /[\p{L}\p{N}]/u.test(kid));
  return { pictures, text: hasText ? text : [] };
};

const MD_COMPONENTS: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
  img: AssetImg,
  p: ({ children }) => {
    const { pictures, text } = splitPictures(children);
    return <>{text.length > 0 && <p>{text}</p>}{pictures.length > 0 && <div className="lmst-strip">{pictures}</div>}</>;
  },
  li: ({ children }) => {
    const { pictures, text } = splitPictures(children);
    return <li>{text}{pictures.length > 0 && <div className="lmst-strip">{pictures}</div>}</li>;
  },
};

// What the human view reads: pictures where the text names them, its own line
// breaks kept (agents write plain lines, not markdown paragraphs), and the
// agents' codes (DA-CH-001-C02) left out. The Agent view keeps every byte.
const CODE = /\s?\(?\b[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}(?:-C\d{2})?\b\)?/g;
const humanSource = (body: string) => {
  let fenced = false;
  return body.split("\n").map((line, i, lines) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    const next = lines[i + 1] ?? "";
    const text = line.replace(BARE_ASSET, (_m, assetId: string) => `![](asset:${assetId})`).replace(CODE, "").replace(/ +([.,;:])/g, "$1");
    return text.trim() && next.trim() && !/^\s*\|/.test(line) ? `${text}  ` : text;
  }).join("\n");
};

function HumanMarkdown({ body, media, onOpen }: { body: string; media: Map<string, Picture>; onOpen: (p: Picture) => void }) {
  // Bare asset:<id> references become pictures where they are named.
  const source = useMemo(() => humanSource(body), [body]);
  const value = useMemo(() => ({ media, onOpen }), [media, onOpen]);
  return <MediaContext.Provider value={value}>
    <div className="lmst-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS} urlTransform={urlTransform}>{source}</ReactMarkdown></div>
  </MediaContext.Provider>;
}

function Revisions({ ownerUserId, id }: { ownerUserId: string; id: Id<"stories"> }) {
  const { isAuthenticated } = useConvexAuth();
  const [open, setOpen] = useState(false);
  const history = useQuery(api.stories.listStoryRevisions, isAuthenticated && open ? { ownerUserId, id } : "skip");
  return <div className="lmst-revs">
    <button type="button" className="lmst-btn" onClick={() => setOpen(!open)}>{open ? "Hide earlier versions" : "Earlier versions"}</button>
    {open && (history === undefined ? <p className="lmst-quiet">Loading…</p> : history.length === 0 ? <p className="lmst-quiet">No earlier versions.</p>
      : history.map((v) => <details key={v._id}><summary>Revision {v.revision} · {new Date(v.savedAt).toISOString().slice(0, 10)} · {v.title}</summary><pre className="lmst-raw">{v.body}</pre></details>))}
  </div>;
}

/** One markdown box: the first line is the title (# …), the rest is the text. */
function StoryEditor({ ownerUserId, story, worldId, busy: savingOuter, onSave, onDone, onCancel }: {
  ownerUserId: string; story?: Story; worldId?: string; busy?: boolean;
  onSave?: (title: string, body: string) => void;
  onDone?: (id: string) => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.stories.saveStory);
  const [text, setText] = useState(story ? `# ${story.title}\n\n${story.body}` : "# \n\n");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ingestKey] = useState(() => `text:${crypto.randomUUID()}`);
  const split = () => {
    const [first = "", ...rest] = text.split("\n");
    return { title: first.replace(/^#+\s*/, "").trim(), body: rest.join("\n").trim() };
  };
  const { title, body } = split();
  const submit = async () => {
    if (story && onSave) { onSave(title, body); return; }
    setBusy(true); setError("");
    try {
      const result = await save({ ownerUserId, ingestKey, title, body, kind: "idea", status: "draft", folderId: worldId as Id<"folders"> | undefined, tagNames: [], assetIds: [], expectedRevision: 0 });
      onDone?.(result.id);
    } catch (err) { setError(err instanceof Error ? err.message.replace(/^.*ConvexError:\s*/, "") : "Could not save."); }
    finally { setBusy(false); }
  };
  return <div className="lmst-edit">
    {!story && <div className="lmst-kicker">New idea · markdown, first line is the title</div>}
    <textarea aria-label="Story markdown" value={text} onChange={(e) => setText(e.target.value)} spellCheck autoFocus rows={24} />
    {error && <p className="lmst-error" role="alert">{error}</p>}
    <div className="lmst-bar">
      <button type="button" className="lmst-btn lmst-primary" disabled={busy || savingOuter || !title || !body} onClick={() => void submit()}>{busy || savingOuter ? "Saving…" : "Save"}</button>
      <button type="button" className="lmst-btn" onClick={onCancel}>Cancel</button>
      <span className="lmst-quiet">Name a picture as asset:&lt;id&gt; to show it here.</span>
    </div>
  </div>;
}

const CSS = `
.lmst{--st-sans:var(--font-geist-sans),system-ui,sans-serif;--st-mono:var(--font-geist-mono),ui-monospace,monospace;display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);min-height:calc(100dvh - 90px);font-family:var(--st-sans);color:var(--lm-text-primary)}
.lmst-index{border-right:1px solid var(--lm-border);padding:18px 14px 40px 18px;display:flex;flex-direction:column;gap:10px;position:sticky;top:0;align-self:start;max-height:calc(100dvh - 70px);overflow-y:auto;scrollbar-width:thin}
.lmst-head{display:flex;align-items:baseline;gap:8px}
.lmst-head h2{margin:0;font:800 15px/1 var(--st-sans);letter-spacing:.08em;text-transform:uppercase}
.lmst-count{font:500 11px var(--st-mono);color:var(--lm-text-tertiary)}
.lmst-head .lmst-btn{margin-left:auto}
.lmst-btn{font:500 11px/1 var(--st-mono);color:var(--lm-text-primary);background:none;border:1px solid var(--lm-border);border-radius:999px;padding:6px 11px;cursor:pointer;white-space:nowrap}
.lmst-btn:hover{border-color:var(--lm-text-tertiary)}.lmst-btn:disabled{opacity:.45;cursor:default}
.lmst-primary{background:var(--lm-coral);border-color:var(--lm-coral);color:#0a0805}
.lmst-search{font:12px var(--st-mono);background:var(--lm-surface-1);color:var(--lm-text-primary);border:1px solid var(--lm-border);border-radius:999px;padding:7px 13px;outline:none}
.lmst-search:focus{border-color:var(--lm-coral)}
.lmst-worlds{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;flex-shrink:0;mask-image:linear-gradient(to right,#000 85%,transparent);-webkit-mask-image:linear-gradient(to right,#000 85%,transparent)}
.lmst-worlds::-webkit-scrollbar{display:none}
.lmst-worlds button{flex-shrink:0;white-space:nowrap;font:500 10px/1 var(--st-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--lm-text-tertiary);background:none;border:1px solid var(--lm-border);border-radius:999px;padding:5px 8px;cursor:pointer}
.lmst-worlds button b{font-weight:500;margin-left:5px;opacity:.6}
.lmst-worlds button.on{background:var(--lm-text-primary);color:var(--lm-surface-0);border-color:var(--lm-text-primary)}
.lmst-kicker{font:500 10.5px/1.4 var(--st-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--lm-coral)}
.lmst-group{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.lmst-group .lmst-kicker{margin:0 0 4px}
.lmst-row{display:flex;flex-direction:column;gap:3px;text-align:left;background:none;border:0;border-left:2px solid transparent;padding:8px 8px 9px 10px;cursor:pointer;color:inherit;border-radius:0 2px 2px 0}
.lmst-row:hover{background:var(--lm-surface-1)}
.lmst-row.on{border-left-color:var(--lm-coral);background:var(--lm-surface-1)}
.lmst-row-meta{font:500 9.5px/1.3 var(--st-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lmst-row-title{font:800 12.5px/1.25 var(--st-sans);letter-spacing:.03em;text-transform:uppercase}
.lmst-row-excerpt{font-size:12px;line-height:1.4;color:var(--lm-text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lmst-archive{margin-top:14px;align-self:flex-start;font:500 10.5px var(--st-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--lm-text-tertiary);background:none;border:0;cursor:pointer;padding:4px 0}
.lmst-archive:hover{color:var(--lm-text-primary)}
.lmst-quiet{font:12px/1.5 var(--st-mono);color:var(--lm-text-tertiary);margin:0}
.lmst-pad{padding:24px}
.lmst-reader{min-width:0;padding:18px clamp(18px,4vw,56px) 120px}
.lmst-empty{max-width:520px;margin:18vh auto 0;text-align:center;display:flex;flex-direction:column;gap:8px}
.lmst-empty p:first-child{font:800 18px var(--st-sans);text-transform:uppercase;letter-spacing:.04em;margin:0}
.lmst-doc{max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.lmst-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lmst-sp{flex:1}
.lmst-back{display:none;font:500 11px var(--st-mono);background:none;border:0;color:var(--lm-text-tertiary);cursor:pointer;padding:6px 6px 6px 0}
.lmst-seg{display:inline-flex;border:1px solid var(--lm-border);border-radius:999px;padding:2px}
.lmst-seg button{font:500 10.5px/1 var(--st-mono);letter-spacing:.08em;text-transform:uppercase;background:none;border:0;border-radius:999px;padding:6px 12px;cursor:pointer;color:var(--lm-text-tertiary)}
.lmst-seg button.on{background:var(--lm-text-primary);color:var(--lm-surface-0)}
.lmst-title{margin:0;font:800 clamp(24px,3.2vw,38px)/1.05 var(--st-sans);text-transform:uppercase;letter-spacing:.01em}
.lmst-lede{margin:0;font-size:17px;line-height:1.55;color:var(--lm-text-secondary)}
.lmst-error{margin:0;font:12px/1.5 var(--st-mono);color:var(--lm-coral)}
.lmst-md{font-size:15.5px;line-height:1.72;color:var(--lm-text-secondary)}
.lmst-md>:first-child{margin-top:0}
.lmst-md p{margin:0 0 1em}
.lmst-md h1,.lmst-md h2,.lmst-md h3{font-family:var(--st-sans);font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--lm-text-primary);margin:1.8em 0 .5em;line-height:1.15}
.lmst-md h1{font-size:22px}.lmst-md h2{font-size:18px}.lmst-md h3{font-size:15px}
.lmst-md ul,.lmst-md ol{margin:0 0 1em;padding-left:1.3em}
.lmst-md li{margin:.25em 0}
.lmst-md strong{color:var(--lm-text-primary)}
.lmst-md blockquote{margin:0 0 1em;border-left:2px solid var(--lm-coral);padding-left:14px;color:var(--lm-text-primary)}
.lmst-md code{font:12.5px var(--st-mono);background:var(--lm-surface-1);padding:1px 4px;border-radius:2px}
.lmst-md pre{font:12.5px/1.6 var(--st-mono);background:var(--lm-surface-1);padding:12px 14px;border-radius:2px;overflow-x:auto;white-space:pre-wrap}
.lmst-md pre code{background:none;padding:0}
.lmst-md table{border-collapse:collapse;font-size:13.5px;margin:0 0 1em;display:block;overflow-x:auto}
.lmst-md th,.lmst-md td{border-bottom:1px solid var(--lm-border);padding:6px 10px 6px 0;text-align:left;vertical-align:top}
.lmst-md hr{border:0;border-top:1px solid var(--lm-border);margin:1.6em 0}
.lmst-md a{color:var(--lm-coral)}
.lmst-strip{display:flex;gap:6px;overflow-x:auto;margin:6px 0 14px;scrollbar-width:thin}
.lmst-inline{display:block;flex-shrink:0;padding:0;border:0;background:var(--lm-surface-1);cursor:zoom-in;border-radius:2px;overflow:hidden;line-height:0}
.lmst-inline img{height:150px;width:auto;max-width:280px;object-fit:cover;display:block}
.lmst-inline:hover{outline:2px solid var(--lm-coral);outline-offset:-2px}
.lmst-ext{max-width:100%;border-radius:2px}
.lmst-missing{font:500 9.5px var(--st-mono);text-transform:uppercase;color:var(--lm-text-ghost);border:1px dashed var(--lm-border);padding:1px 5px;border-radius:2px}
.lmst-pictures{margin-top:18px;border-top:1px solid var(--lm-border);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.lmst-masonry{columns:3 180px;column-gap:6px}
.lmst-tile{display:block;width:100%;margin:0 0 6px;padding:0;border:0;background:var(--lm-surface-1);cursor:zoom-in;break-inside:avoid;line-height:0;border-radius:2px;overflow:hidden}
.lmst-tile img{width:100%;height:auto;display:block}
.lmst-tile:hover{outline:2px solid var(--lm-coral);outline-offset:-2px}
.lmst-front,.lmst-raw{margin:0;font:12.5px/1.65 var(--st-mono);white-space:pre-wrap;word-break:break-word;color:var(--lm-text-primary)}
.lmst-front{color:var(--lm-text-tertiary);background:var(--lm-surface-1);padding:12px 14px;border-radius:2px}
.lmst-revs{display:flex;flex-direction:column;gap:8px;margin-top:10px;border-top:1px solid var(--lm-border);padding-top:12px;align-items:flex-start}
.lmst-revs details{width:100%}.lmst-revs summary{font:500 11px var(--st-mono);cursor:pointer;color:var(--lm-text-tertiary)}
.lmst-edit{display:flex;flex-direction:column;gap:10px}
.lmst-edit textarea{width:100%;min-height:60vh;font:13px/1.7 var(--st-mono);background:var(--lm-surface-1);color:var(--lm-text-primary);border:1px solid var(--lm-border);border-radius:2px;padding:14px 16px;outline:none;resize:vertical}
.lmst-edit textarea:focus{border-color:var(--lm-coral)}
.lmst-lightbox{position:fixed;inset:0;z-index:80;background:rgba(10,8,5,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;cursor:zoom-out}
.lmst-lightbox img,.lmst-lightbox video{max-width:100%;max-height:calc(100% - 50px);object-fit:contain}
.lmst-lightbox .lmst-btn{color:#fff4ea;border-color:rgba(255,244,234,.3)}
@media (max-width:860px){
  .lmst{grid-template-columns:1fr}
  .lmst-index{position:static;max-height:none;border-right:0;padding:14px 14px 30px}
  .lmst-reader{display:none;padding:12px 14px 120px}
  .lmst-open .lmst-index{display:none}
  .lmst-open .lmst-reader{display:block}
  .lmst-back{display:inline-block}
  .lmst-inline img{height:110px}
}
`;
