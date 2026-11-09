"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ArrowUpRight, ChevronDown, FileText, Loader2, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { CopyChip, InboxGate } from "@/components/inbox/inbox-ui";
import { galleryRoutePath, worldStylesPath } from "@/lib/gallery-routes";
import type { RestylePreset } from "@/components/locked/restyle-dialog";
import { ProjectMoodboards } from "./project-moodboards";

const ProjectRuns = dynamic(() => import("./project-runs").then((m) => m.ProjectRuns), { ssr: false });
const RestyleDialog = dynamic(() => import("@/components/locked/restyle-dialog").then((m) => m.RestyleDialog), { ssr: false });

// The art director's project room (/w/<world>/project). One page with the
// whole film: what production sent (briefs with their files and pictures),
// Michael's art-director shelves, the director review, the inspiration and
// the world. Owner only: nothing here is on the public world page or in the
// director review until Michael promotes or publishes it (9 Nov 2026).

type Project = FunctionReturnType<typeof api.projects.getProject>;
type Brief = Project["briefs"][number];
type Picture = Brief["previews"][number];

const SANS: CSSProperties = { fontFamily: "var(--font-geist-sans), system-ui, sans-serif" };
const KIND: Record<Brief["kind"], string> = {
  brief: "Design brief", storyboard: "Storyboard", script: "Script", style_guide: "Style guide", references: "Photo set", other: "From production",
};

const day = (at?: number) => at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : undefined;
const size = (bytes: number) => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const ago = (at?: number) => {
  if (!at) return "not yet";
  const hours = (Date.now() - at) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export function ProjectPage({ world }: { world: string }) {
  return (
    <InboxGate title="Project" prompt="Sign in to open the project">
      {(ownerUserId) => <ProjectScreen ownerUserId={ownerUserId} world={world} />}
    </InboxGate>
  );
}

function ProjectScreen({ ownerUserId, world }: { ownerUserId: string; world: string }) {
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.getProject, isAuthenticated ? { ownerUserId, world } : "skip");
  // Inspiration reads the world's members: after the first screen is in.
  const inspiration = useQuery(api.projects.projectInspiration, isAuthenticated && project ? { ownerUserId, world, limit: 24 } : "skip");
  const locked = useQuery(api.lockedPrompts.listLockedPrompts, isAuthenticated && project ? { ownerUserId, world } : "skip");
  const [restyle, setRestyle] = useState<RestylePreset | null>(null);

  if (project === undefined) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}>
      <Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading the project" />
    </main>;
  }
  const key = project.world.key;
  const details = project.details;
  const adShelves = project.shelves.filter((shelf) => shelf.artDirector);
  const otherShelves = project.shelves.filter((shelf) => !shelf.artDirector);

  return (
    <main className="lmp min-h-dvh pb-24" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <style>{CSS}</style>
      <header className="lmp-bar">
        <Link href={`/w/${encodeURIComponent(key)}`} className="lmp-mono lmp-back"><ArrowLeft size={13} aria-hidden />{project.world.name}</Link>
        <span className="lmp-scope"><Lock size={11} aria-hidden />Art director only</span>
      </header>

      <section className="lmp-hero">
        {project.world.cover?.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.world.cover.thumbUrl} alt="" className="lmp-hero-img" fetchPriority="high" />
        ) : null}
        <div className="lmp-hero-text">
          <span className="lmp-kicker">Project{details?.client ? ` · ${details.client}` : ""}</span>
          <h1 style={SANS}>{project.world.name}</h1>
          {details?.line ? <p className="lmp-line">{details.line}</p> : null}
          <div className="lmp-people">
            {details?.role ? <span className="lmp-person"><b>Michael</b>{details.role}</span> : null}
            {(details?.people ?? []).map((person) => (
              <span key={person.name} className="lmp-person"><b>{person.name}</b>{[person.role, person.org].filter(Boolean).join(" · ")}</span>
            ))}
          </div>
          <nav className="lmp-links" aria-label="Project places">
            <Link href={`/w/${encodeURIComponent(key)}`} className="lmp-link">World<span>{project.world.memberCount}</span></Link>
            <Link href={worldStylesPath(key)} className="lmp-link">Styles<span>{project.styles}</span></Link>
            <a href="#moodboards" className="lmp-link">Moodboards</a>
            {project.reviews.map((review) => (
              <Link key={review.slug} href={`/review/${review.slug}`} className="lmp-link">Director review{review.unread ? <span data-hot>{review.unread} new</span> : null}</Link>
            ))}
            <Link href={`/w/${encodeURIComponent(key)}/journal`} className="lmp-link">Journal</Link>
          </nav>
        </div>
      </section>

      <Section title="From production" count={project.briefs.length} note="What the director and producers sent, with who, when and why.">
        {project.briefs.length ? (
          <div className="lmp-briefs">
            {project.briefs.map((brief) => <BriefCard key={brief.id} brief={brief} ownerUserId={ownerUserId} worldKey={key} />)}
          </div>
        ) : <p className="lmp-empty">Nothing from production yet.</p>}
      </Section>

      <Section id="moodboards" title="Moodboards" note="Every look of the film as a board. Open one, or make a new one, and drag frames in from the project beside it. Then send it to Midjourney: an agent makes it there under the same name and records its code.">
        <ProjectMoodboards
          ownerUserId={ownerUserId}
          worldId={project.world.id}
          worldKey={key}
          worldName={project.world.name}
          shelves={project.shelves.map((shelf) => ({ id: shelf.id, name: shelf.name, group: shelf.group, count: shelf.count, artDirector: shelf.artDirector }))}
        />
      </Section>

      <Section title="Locked locations" count={locked?.prompts.filter((row) => !row.place.startsWith("Test shots")).length} note="Each place written once, without a style. Click a place to redo it in another look.">
        {locked === undefined ? <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /> : locked.prompts.length ? (
          <LockedPlaces prompts={locked.prompts} onRestyle={setRestyle} />
        ) : <p className="lmp-empty">No locked location prompts yet.</p>}
      </Section>

      <Section title="Compare looks" note="The same shots through several looks, on the same seeds. You send each job; then keep or drop on the grid.">
        <ProjectRuns ownerUserId={ownerUserId} world={key} />
      </Section>

      <Section title="Art director shelves" count={adShelves.length} note="Your working shelves. Not in the director review, not on the public page.">
        {adShelves.length ? (
          <div className="lmp-shelves">
            {adShelves.map((shelf) => (
              <Link key={shelf.id} href={galleryRoutePath({ kind: "world", world: key, shelf: shelf.id })} className="lmp-shelf">
                <div className="lmp-shelf-strip">
                  {shelf.previews.map((picture) => <Thumb key={picture.assetId} picture={picture} />)}
                </div>
                <div className="lmp-shelf-meta">
                  <b style={SANS}>{shelf.name}</b>
                  <span className="lmp-mono">{shelf.group ? `${shelf.group} · ` : ""}{shelf.count} frames</span>
                </div>
              </Link>
            ))}
          </div>
        ) : <p className="lmp-empty">No art-director shelf yet. New shelves in this project start here.</p>}
      </Section>

      <Section title="Director review" count={project.reviews.length}>
        <div className="lmp-reviews">
          {project.reviews.map((review) => (
            <article key={review.slug} className="lmp-card lmp-review">
              <div className="lmp-review-h">
                <div>
                  <span className="lmp-kicker">{review.subtitle ?? "Review"}</span>
                  <h3 style={SANS}>{review.title}</h3>
                </div>
                {review.unread ? <span className="lmp-badge" data-hot>{review.unread} new from reviewers</span> : null}
              </div>
              <div className="lmp-rounds">
                {review.current ? <span className="lmp-round"><b>{review.current.label}</b>shown · {review.current.frames} frames{review.current.publishedAt ? ` · ${day(review.current.publishedAt)}` : ""}</span> : null}
                {review.draft ? <span className="lmp-round" data-draft><b>{review.draft.label}</b>draft · {review.draft.frames} frames</span> : null}
                <span className="lmp-round"><b>{review.folders}</b>folders</span>
              </div>
              <ul className="lmp-reviewers">
                {review.reviewers.map((person) => (
                  <li key={person.name}><b>{person.name}</b><span>{person.title}</span><span className="lmp-mono">seen {ago(person.lastSeenAt)}</span></li>
                ))}
              </ul>
              <div className="lmp-actions">
                <Link href={`/review/${review.slug}`} className="lmp-btn">Open review <ArrowUpRight size={12} aria-hidden /></Link>
                {review.publicUrl ? <CopyChip value={review.publicUrl} label="Copy public address" /> : null}
              </div>
            </article>
          ))}
          {!project.reviews.length ? <p className="lmp-empty">No director review for this project.</p> : null}
        </div>
      </Section>

      <Section title="Inspiration" count={inspiration?.total} note="Outside references filed in the world, and library takes made for it.">
        {inspiration === undefined ? <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /> : inspiration.pieces.length || inspiration.takes.length ? (
          <>
            <div className="lmp-wall">
              {inspiration.pieces.map((picture) => (
                <Link key={picture.assetId} href={galleryRoutePath({ kind: "world", world: key }, picture.assetId)} className="lmp-wall-tile"><Thumb picture={picture} /></Link>
              ))}
            </div>
            {inspiration.takes.length ? (
              <ul className="lmp-takes">
                {inspiration.takes.map((take) => (
                  <li key={take.adaptationId}><Link href={`/inspiration/${take.sourceId}`}><b>{take.title}</b><span>{take.intendedUse}</span><span className="lmp-mono">{take.status}</span></Link></li>
                ))}
              </ul>
            ) : null}
          </>
        ) : <p className="lmp-empty">No inspiration filed for this project yet. Briefs from production sit above.</p>}
      </Section>

      <Section title="The world" count={otherShelves.length}>
        <div className="lmp-chips">
          {otherShelves.map((shelf) => (
            <Link key={shelf.id} href={galleryRoutePath({ kind: "world", world: key, shelf: shelf.id })} className="lmp-chip">
              {shelf.group ? <span className="lmp-mono">{shelf.group}</span> : null}{shelf.name}<span className="lmp-mono">{shelf.count}</span>
            </Link>
          ))}
        </div>
      </Section>
      {restyle ? <RestyleDialog ownerUserId={ownerUserId} world={key} preset={restyle} onClose={() => setRestyle(null)} /> : null}
    </main>
  );
}

type LockedRow = FunctionReturnType<typeof api.lockedPrompts.listLockedPrompts>["prompts"][number];

function LockedPlaces({ prompts, onRestyle }: { prompts: LockedRow[]; onRestyle: (preset: RestylePreset) => void }) {
  // Test shots belong to Compare looks; here only real places, one picture grid per area.
  const places = prompts.filter((row) => !row.place.startsWith("Test shots"));
  const areaOf = (place: string) => place.split("·")[0]!.trim();
  const areas = [...new Set(places.map((row) => areaOf(row.place)))]
    .sort((a, b) => places.filter((row) => areaOf(row.place) === b).length - places.filter((row) => areaOf(row.place) === a).length);
  return (
    <div className="lmp-locked">
      {areas.map((area) => (
        <div key={area} className="lmp-locked-area">
          <div className="lmp-locked-area-h">
            <h3 style={SANS}>{area}</h3>
            <button type="button" className="lmp-more" onClick={() => onRestyle({ places: [area] })}>Redo in another style</button>
          </div>
          <div className="lmp-lp-row">
            {places.filter((row) => areaOf(row.place) === area).map((row) => {
              const thumb = row.lastTakes[0]?.thumbUrl ?? row.lockedFrame?.thumbUrl ?? row.imagePrompts[0]?.thumbUrl;
              return (
                <button type="button" key={row.id} className="lmp-lp" title="Redo this place in another style" onClick={() => onRestyle({ promptIds: [row.id] })}>
                  <div className="lmp-lp-art">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" />
                    ) : <span className="lmp-lp-words">{row.text.split(",").slice(0, 2).join(",")}</span>}
                    <span className="lmp-wall-chip">{row.place.split("·").slice(1).join("·").trim() || row.place}</span>
                  </div>
                  <div className="lmp-lp-body">
                    <b style={SANS}>{row.title}</b>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ id, title, count, note, children }: { id?: string; title: string; count?: number; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="lmp-section">
      <div className="lmp-section-h">
        <h2 style={SANS}>{title}</h2>
        {count !== undefined ? <span className="lmp-mono lmp-count">{count}</span> : null}
        {note ? <p>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Thumb({ picture }: { picture: Picture }) {
  if (!picture.thumbUrl) return <span className="lmp-thumb lmp-thumb-empty" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lmp-thumb" src={picture.thumbUrl} alt="" loading="lazy" decoding="async"
    style={picture.width && picture.height ? { aspectRatio: `${picture.width} / ${picture.height}` } : undefined} />;
}

function BriefCard({ brief, ownerUserId, worldKey }: { brief: Brief; ownerUserId: string; worldKey: string }) {
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useConvexAuth();
  const whole = useQuery(api.projects.findBriefs, open && isAuthenticated ? { ownerUserId, brief: brief.id } : "skip");
  const cover = brief.files.find((file) => file.coverUrl);
  const meta = [brief.from ? `From ${brief.from}` : null, day(brief.receivedAt)].filter(Boolean).join(" · ");
  const pictures = whole?.[0]?.assets;
  return (
    <article className="lmp-card lmp-brief">
      <div className="lmp-brief-art">
        {brief.previews.length ? (
          <div className="lmp-brief-strip">{brief.previews.slice(0, 6).map((picture) => <Thumb key={picture.assetId} picture={picture} />)}</div>
        ) : cover?.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.coverUrl} alt="" className="lmp-brief-cover" loading="lazy" />
        ) : <div className="lmp-brief-blank"><FileText size={22} aria-hidden /></div>}
      </div>
      <div className="lmp-brief-body">
        <div className="lmp-brief-top">
          <span className="lmp-badge">{KIND[brief.kind]}</span>
          <CopyChip value={`brief:${brief.id}`} label={brief.id.slice(-7)} />
        </div>
        <h3 style={SANS}>{brief.title}</h3>
        {meta ? <p className="lmp-mono lmp-meta">{meta}</p> : null}
        {brief.note ? <p className="lmp-note">{brief.note}</p> : null}
        {brief.topics.length ? <div className="lmp-tags">{brief.topics.map((topic) => <span key={topic}>{topic}</span>)}</div> : null}
        {brief.files.length ? (
          <ul className="lmp-files">
            {brief.files.map((file) => (
              <li key={file.key}>
                <FileText size={13} aria-hidden />
                <a href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
                <span className="lmp-mono">{[file.pages ? `${file.pages} p` : null, size(file.size)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {brief.assetCount ? (
          <button type="button" className="lmp-more" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {brief.assetCount} pictures{brief.groups.length ? ` · ${brief.groups.map((group) => `${group.label} ${group.count}`).join(" · ")}` : ""}
            <ChevronDown size={12} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="lmp-brief-all">
          {pictures === undefined ? <Loader2 className="animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} /> : (
            <div className="lmp-wall">
              {pictures.map((picture) => (
                <Link key={picture.assetId} href={galleryRoutePath({ kind: "world", world: worldKey }, picture.assetId)} className="lmp-wall-tile" title={picture.description ?? picture.group}>
                  <Thumb picture={{ assetId: picture.assetId, kind: picture.kind === "video" ? "video" : "image", thumbUrl: picture.thumbUrl, width: picture.width, height: picture.height }} />
                  {picture.group ? <span className="lmp-wall-chip">{picture.group}</span> : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

const CSS = `
.lmp{font-family:var(--font-geist-sans),system-ui,sans-serif}
.lmp-mono,.lmp-kicker,.lmp-badge,.lmp-scope,.lmp-count{font-family:var(--font-geist-mono),ui-monospace,monospace}
.lmp-kicker{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lmp-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:color-mix(in srgb,var(--lm-paper) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--lm-border-subtle)}
.lmp-back{display:inline-flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-secondary)}
.lmp-back:hover{color:var(--lm-text-primary)}
.lmp-scope{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border-radius:999px;border:1px solid var(--lm-border-strong);color:var(--lm-text-secondary)}
.lmp-hero{position:relative;display:grid;grid-template-columns:minmax(0,1fr);overflow:hidden;border-bottom:1px solid var(--lm-border-subtle)}
.lmp-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.32;filter:saturate(.9)}
.lmp-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 0%,var(--lm-paper) 92%)}
.lmp-hero-text{position:relative;z-index:1;padding:72px 16px 28px;max-width:1100px}
.lmp-hero h1{font-size:clamp(44px,9vw,104px);font-weight:900;text-transform:uppercase;letter-spacing:-.03em;line-height:.9;margin:8px 0 10px}
.lmp-line{font-size:15px;line-height:1.45;color:var(--lm-text-secondary);max-width:620px}
.lmp-people{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:16px}
.lmp-person{display:inline-flex;flex-direction:column;font-size:12px;color:var(--lm-text-tertiary)}
.lmp-person b{font-size:13px;color:var(--lm-text-primary);font-weight:700}
.lmp-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:20px}
.lmp-link{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px;border-radius:999px;border:1px solid var(--lm-border-strong);color:var(--lm-text-primary)}
.lmp-link:hover{background:var(--lm-surface-2)}
.lmp-link span{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:500;color:var(--lm-text-tertiary)}
.lmp-link span[data-hot]{color:var(--lm-coral)}
.lmp-section{padding:34px 16px 4px;max-width:1440px}
.lmp-section-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin-bottom:14px}
.lmp-section-h h2{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:-.01em}
.lmp-section-h p{flex-basis:100%;font-size:13px;color:var(--lm-text-tertiary)}
.lmp-count{font-size:11px;color:var(--lm-text-tertiary)}
.lmp-empty{font-size:13px;color:var(--lm-text-tertiary)}
.lmp-card{border:1px solid var(--lm-border-subtle);border-radius:var(--lm-radius,8px);background:var(--lm-surface-1,transparent);overflow:hidden}
.lmp-badge{display:inline-flex;align-items:center;font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:var(--lm-surface-2);color:var(--lm-text-secondary)}
.lmp-badge[data-hot]{color:var(--lm-coral)}
.lmp-briefs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:12px}
.lmp-brief{display:flex;flex-direction:column}
.lmp-brief-art{height:168px;background:var(--lm-surface-2);overflow:hidden}
.lmp-brief-strip{display:flex;height:100%;gap:2px}
.lmp-brief-strip .lmp-thumb{height:100%;width:auto;flex:1 1 0;min-width:0;object-fit:cover}
.lmp-brief-cover{width:100%;height:100%;object-fit:cover;object-position:top}
.lmp-brief-blank{height:100%;display:grid;place-items:center;color:var(--lm-text-ghost)}
.lmp-brief-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px}
.lmp-brief-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lmp-brief h3{font-size:19px;font-weight:900;text-transform:uppercase;letter-spacing:-.01em;line-height:1.05}
.lmp-meta{font-size:11px;color:var(--lm-text-secondary)}
.lmp-note{font-size:13px;line-height:1.5;color:var(--lm-text-secondary)}
.lmp-tags{display:flex;flex-wrap:wrap;gap:4px}
.lmp-tags span{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;padding:3px 7px;border-radius:4px;border:1px solid var(--lm-border-subtle);color:var(--lm-text-tertiary)}
.lmp-files{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid var(--lm-border-subtle)}
.lmp-files li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;font-size:12.5px;color:var(--lm-text-tertiary)}
.lmp-files a{color:var(--lm-text-primary);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lmp-files a:hover{text-decoration:underline;text-underline-offset:3px}
.lmp-files .lmp-mono{font-size:10.5px}
.lmp-more{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-border-strong);color:var(--lm-text-primary)}
.lmp-more:hover{background:var(--lm-surface-2)}
.lmp-brief-all{padding:0 16px 16px}
.lmp-wall{columns:4 160px;column-gap:6px}
.lmp-wall-tile{position:relative;display:block;break-inside:avoid;margin-bottom:6px;border-radius:4px;overflow:hidden;background:var(--lm-surface-2)}
.lmp-wall-tile .lmp-thumb{display:block;width:100%;height:auto}
.lmp-wall-chip{position:absolute;left:6px;bottom:6px;font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;border-radius:4px;background:rgba(10,8,5,.72);color:#fff4ea}
.lmp-thumb{display:block;background:var(--lm-surface-2)}
.lmp-thumb-empty{width:100%;height:100%}
.lmp-shelves{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:12px}
.lmp-shelf{display:flex;flex-direction:column;border:1px solid var(--lm-border-subtle);border-radius:var(--lm-radius,8px);overflow:hidden}
.lmp-shelf:hover{border-color:var(--lm-border-strong)}
.lmp-shelf-strip{display:flex;height:150px;gap:2px;background:var(--lm-surface-2)}
.lmp-shelf-strip .lmp-thumb{height:100%;width:auto;flex:1 1 0;min-width:0;object-fit:cover}
.lmp-shelf-meta{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 14px}
.lmp-shelf-meta b{font-size:16px;font-weight:900;text-transform:uppercase}
.lmp-shelf-meta span{font-size:10.5px;color:var(--lm-text-tertiary)}
.lmp-reviews{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:12px}
.lmp-review{padding:16px;display:flex;flex-direction:column;gap:12px}
.lmp-review-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.lmp-review h3{font-size:22px;font-weight:900;text-transform:uppercase;line-height:1}
.lmp-rounds{display:flex;flex-wrap:wrap;gap:6px}
.lmp-round{display:inline-flex;align-items:baseline;gap:6px;font-size:12px;color:var(--lm-text-secondary);padding:6px 10px;border-radius:6px;background:var(--lm-surface-2)}
.lmp-round b{font-family:var(--font-geist-mono),ui-monospace,monospace;color:var(--lm-text-primary)}
.lmp-reviewers{display:flex;flex-direction:column;gap:6px}
.lmp-reviewers li{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;gap:10px;align-items:baseline;font-size:12.5px;color:var(--lm-text-tertiary)}
.lmp-reviewers b{color:var(--lm-text-primary)}
.lmp-reviewers .lmp-mono{font-size:10.5px}
.lmp-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.lmp-btn{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:8px 14px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
.lmp-btn:hover{opacity:.9}
.lmp-btn.ghost{background:transparent;color:var(--lm-text-secondary);box-shadow:inset 0 0 0 1px var(--lm-border-strong)}
.lmp-btn.ghost:hover{color:var(--lm-text-primary)}
.lmp-btn[data-on]{background:transparent;color:var(--lm-text-primary);box-shadow:inset 0 0 0 1px var(--lm-border-strong)}
.lmp-btn.small{padding:5px 10px;font-size:10px}
.lmp-btn:disabled{opacity:.5;cursor:default}
.lmp-boards-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.lmp-board-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.lmp-board{display:grid;gap:6px;align-content:start;min-width:0}
.lmp-board-sync{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:26px}
.lmp-board-sync .lmp-mono{font-size:10px;letter-spacing:.04em;color:var(--lm-text-tertiary)}
.lmp-board-sync[data-tone="ok"] .lmp-mono{color:var(--lm-teal,#79B791)}
.lmp-board-sync[data-tone="drift"] .lmp-mono:first-child{color:var(--lm-ember,#FF8C42)}
.lmp-asked{display:inline-flex;align-items:center;gap:4px}
.lmp-err{font-size:11px;color:var(--lm-coral)}
.lmp-takes{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.lmp-takes a{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px;color:var(--lm-text-tertiary)}
.lmp-takes b{color:var(--lm-text-primary)}
.lmp-chips{display:flex;flex-wrap:wrap;gap:6px}
.lmp-chip{display:inline-flex;align-items:baseline;gap:7px;font-size:12.5px;font-weight:600;padding:7px 11px;border-radius:999px;border:1px solid var(--lm-border-subtle);color:var(--lm-text-primary)}
.lmp-chip:hover{background:var(--lm-surface-2)}
.lmp-chip .lmp-mono{font-size:10px;font-weight:500;color:var(--lm-text-tertiary)}
.lmp-locked{display:flex;flex-direction:column;gap:22px}
.lmp-locked-area-h{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:10px}
.lmp-locked-area-h h3{font-size:18px;font-weight:900;text-transform:uppercase}
.lmp-place{margin-bottom:14px}
.lmp-place-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:8px}
.lmp-place-h b{font-size:14px;font-weight:800;text-transform:uppercase}
.lmp-place-h .lmp-mono{font-size:10.5px;color:var(--lm-text-tertiary)}
.lmp-redo{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:5px 10px;border-radius:999px;border:1px solid var(--lm-border-strong);color:var(--lm-text-primary)}
.lmp-redo:hover{background:var(--lm-surface-2)}
.lmp-lp-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:8px}
.lmp-lp{display:block;width:100%;text-align:left;background:transparent;cursor:pointer;border:1px solid var(--lm-border-subtle);border-radius:var(--lm-radius,8px);overflow:hidden}
.lmp-lp:hover{border-color:var(--lm-border-strong)}
.lmp-lp-art{position:relative;aspect-ratio:16/9;background:var(--lm-surface-2)}
.lmp-lp-art img{width:100%;height:100%;object-fit:cover;display:block}
.lmp-lp-words{position:absolute;inset:0;display:flex;align-items:center;padding:12px;font-size:12px;line-height:1.35;color:var(--lm-text-tertiary)}
.lmp-lp-body{display:flex;flex-direction:column;gap:5px;padding:9px 10px 10px}
.lmp-lp-body b{font-size:13px;font-weight:800;text-transform:uppercase;line-height:1.15}
.lmp-lp-body .lmp-mono{font-size:10px;color:var(--lm-text-tertiary)}
.lmp-lp-actions{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px}
@media (min-width:768px){.lmp-bar,.lmp-section{padding-left:28px;padding-right:28px}.lmp-hero-text{padding:96px 28px 34px}}
`;
