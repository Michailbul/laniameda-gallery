"use client";

import {
  createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element as HastElement, ElementContent } from "hast";
import type { Parent, PhrasingContent, Root, RootContent } from "mdast";
import { useConvex, useConvexAuth } from "convex/react";
import { ArrowDownUp, BookOpenText, Check, ChevronDown, Copy, ImageIcon, LayoutGrid } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorldContext } from "@/lib/world-agent-doc";
import {
  extractHeadings, parseLearnings, parseRef, shortId, splitRefs, type DocHeading, type Learning, type WorldRef,
} from "@/lib/world-doc-markdown";
import { WORLD_DOC_LEARNINGS } from "@/lib/world-docs";

// The reading surface for a world's docs: a document measure, tables that
// scroll inside themselves, codes as copyable mono chips, story:/asset:/
// moodboard: references as chips that open the item, LEARNINGS as rows and a
// table of contents from the headings. Styles live in globals.css (.wdoc*).

/* ── Links: what codes and references resolve to ────────────────────────── */

export type WorldDocLinks = {
  ownerUserId?: string;
  /** Midjourney code → "DA FILM · Golden (moodboard)". */
  codes: Map<string, string>;
  /** Story / moodboard id → title. */
  titles: Map<string, string>;
  /** Opens the referenced item in the gallery; without it a click copies. */
  onOpenRef?: (ref: WorldRef) => void;
};

const EMPTY_LINKS: WorldDocLinks = { codes: new Map(), titles: new Map() };
const LinksContext = createContext<WorldDocLinks>(EMPTY_LINKS);

export function WorldDocLinksProvider({ value, children }: { value: WorldDocLinks; children: ReactNode }) {
  return <LinksContext.Provider value={value}>{children}</LinksContext.Provider>;
}

/** Codes and titles a world already knows, from open_world's context. */
export function useWorldDocLinks(context: WorldContext | undefined, ownerUserId: string, onOpenRef?: (ref: WorldRef) => void): WorldDocLinks {
  return useMemo(() => {
    const codes = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const board of context?.moodboards ?? []) {
      titles.set(board.id, board.name);
      const code = board.profileFlag?.replace(/^--profile\s+/, "").trim();
      if (code) codes.set(code, `${board.name} · moodboard`);
    }
    for (const profile of context?.profiles ?? []) {
      const code = profile.flag.replace(/^--profile\s+/, "").trim();
      if (code && !codes.has(code)) codes.set(code, `${profile.name} · profile`);
    }
    for (const story of context?.stories ?? []) titles.set(story.id, story.title);
    for (const shelf of context?.storybooks ?? []) for (const story of shelf.stories) titles.set(story.id, story.title);
    return { ownerUserId, codes, titles, onOpenRef };
  }, [context, ownerUserId, onOpenRef]);
}

/* ── Copy ───────────────────────────────────────────────────────────────── */

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copy = async (value: string) => {
    if (!await copyText(value)) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1300);
  };
  return { copied, copy };
}

/** Inline code: a mono chip, copied on click. Known Midjourney codes say what they are. */
function CodeChip({ text }: { text: string }) {
  const { codes } = useContext(LinksContext);
  const { copied, copy } = useCopied();
  const known = text.split(/\s+/).map((token) => codes.get(token)).filter((name): name is string => Boolean(name));
  return <button type="button" className={`wdoc-code${known.length ? " is-known" : ""}`} data-copied={copied || undefined}
    title={`${known.length ? `${known.join(" + ")}\n` : ""}Click to copy`} aria-label={`Copy ${text}`}
    onClick={() => void copy(text)}>
    <span className="wdoc-code-text">{text}</span>
    {copied && <Check aria-hidden className="wdoc-code-icon" />}
  </button>;
}

const REF_ICON = { story: BookOpenText, asset: ImageIcon, moodboard: LayoutGrid } as const;

type AssetPreview = { url?: string; kind: "image" | "video"; name?: string } | null;

/** story:/asset:/moodboard: as a chip: opens the item, copies the reference. */
function RefChip({ refValue, label }: { refValue: WorldRef; label?: ReactNode }) {
  const { titles, onOpenRef, ownerUserId } = useContext(LinksContext);
  const { copied, copy } = useCopied();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [preview, setPreview] = useState<AssetPreview | undefined>(undefined);
  const raw = `${refValue.kind}:${refValue.id}`;
  const title = titles.get(refValue.id);
  const Icon = REF_ICON[refValue.kind];

  // Asset references show the picture on hover, read once.
  const loadPreview = () => {
    if (refValue.kind !== "asset" || preview !== undefined || !isAuthenticated || !ownerUserId) return;
    setPreview(null);
    convex.query(api.assets.getGalleryAsset, { id: refValue.id as Id<"assets">, ownerUserId })
      .then((asset) => setPreview(asset ? { url: asset.thumbUrl ?? asset.url, kind: asset.kind, name: asset.name } : null))
      .catch(() => setPreview(null));
  };

  return <span className="wdoc-ref" data-kind={refValue.kind} onMouseEnter={loadPreview} onFocus={loadPreview}>
    <button type="button" className="wdoc-ref-open"
      title={`${title ? `${title}\n` : ""}${raw}\n${onOpenRef ? "Open in the gallery" : "Click to copy"}`}
      aria-label={onOpenRef ? `Open ${refValue.kind} ${title ?? refValue.id}` : `Copy ${raw}`}
      onClick={() => (onOpenRef ? onOpenRef(refValue) : void copy(raw))}>
      <Icon aria-hidden className="wdoc-ref-icon" />
      {label ? <span className="wdoc-ref-label">{label}</span> : <>
        <span className="wdoc-ref-kind">{refValue.kind}</span>
        <span className="wdoc-ref-id">{shortId(refValue.id)}</span>
      </>}
    </button>
    <button type="button" className="wdoc-ref-copy" aria-label={`Copy ${raw}`} title={`Copy ${raw}`} onClick={() => void copy(raw)}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </button>
    {preview?.url && <span className="wdoc-ref-preview" aria-hidden>
      {preview.kind === "video"
        ? <video src={preview.url} muted autoPlay loop playsInline />
        // eslint-disable-next-line @next/next/no-img-element -- gallery thumbnail
        : <img src={preview.url} alt="" />}
    </span>}
  </span>;
}

/* ── Markdown → the doc ─────────────────────────────────────────────────── */

const REF_URL = "lmref:";
// react-markdown drops unknown schemes; references are ours to keep.
const urlTransform = (url: string) => (url.startsWith(REF_URL) || parseRef(url) ? url : defaultUrlTransform(url));

// "(Michael, 19 Oct 2026)" closing a rule or a bullet: who said it and when.
const ATTRIBUTION = /\s(\([^()]{2,140}\b(?:19|20)\d{2}\b[^()]{0,40}\))\.?\s*$/;

type AnyParent = Parent & { children: RootContent[] };

/** Heading ids, attributions and references, written into the tree once. */
const remarkWorldDoc = (headings: DocHeading[], idPrefix: string) => () => (tree: Root) => {
  let headingIndex = 0;
  const visit = (node: AnyParent, inLink: boolean) => {
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      if (child.type === "heading") {
        const id = headings[headingIndex++]?.id;
        if (id) child.data = { ...child.data, hProperties: { ...child.data?.hProperties, id: `${idPrefix}${id}` } };
      }
      if (child.type === "listItem") {
        const last = child.children[child.children.length - 1];
        const tail = last?.type === "paragraph" ? last.children[last.children.length - 1] : undefined;
        if (last?.type === "paragraph" && tail?.type === "text") {
          const match = ATTRIBUTION.exec(tail.value);
          if (match && match.index > 0) {
            last.children.splice(last.children.length - 1, 1,
              { type: "text", value: tail.value.slice(0, match.index + 1) },
              { type: "emphasis", data: { hName: "span", hProperties: { className: ["wdoc-attrib"] } }, children: [{ type: "text", value: match[1] }] });
          }
        }
      }
      if (child.type === "text" && !inLink) {
        const parts = splitRefs(child.value);
        if (parts.some((part) => typeof part !== "string")) {
          const replacement: PhrasingContent[] = parts.map((part) => typeof part === "string"
            ? { type: "text", value: part }
            : { type: "link", url: `${REF_URL}${part.kind}:${part.id}`, children: [{ type: "text", value: `${part.kind}:${part.id}` }] });
          node.children.splice(index, 1, ...replacement);
          index += replacement.length - 1;
          continue;
        }
      }
      if ("children" in child) visit(child as AnyParent, inLink || child.type === "link");
    }
  };
  visit(tree as AnyParent, false);
};

const hastText = (node: ElementContent | HastElement): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map((child) => hastText(child as ElementContent)).join("") : "";

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
};

function CodeBlock({ text }: { text: string }) {
  const { copied, copy } = useCopied();
  return <div className="wdoc-pre">
    <button type="button" className="wdoc-pre-copy" onClick={() => void copy(text)} aria-label="Copy block">
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy"}
    </button>
    <pre><code>{text}</code></pre>
  </div>;
}

/** "1. Vocabulary" → a mono section number and the title. */
function numbered(children: ReactNode) {
  const list = Array.isArray(children) ? children : [children];
  const first = list[0];
  if (typeof first !== "string") return children;
  const match = /^(\d{1,2})\.\s+/.exec(first);
  if (!match) return children;
  return <>
    <span className="wdoc-hnum" aria-hidden>{match[1].padStart(2, "0")}</span>
    <span className="sr-only">{match[1]}. </span>
    {first.slice(match[0].length)}{list.slice(1)}
  </>;
}

const COMPONENTS: Components = {
  h2: ({ id, children }) => <h2 id={id}>{numbered(children)}</h2>,
  h3: ({ id, children }) => <h3 id={id}>{numbered(children)}</h3>,
  // Numbers come from a CSS counter; a list that starts later keeps its count.
  ol: ({ start, children }) => <ol start={start} style={start && start !== 1 ? { counterReset: `wdoc-ol ${start - 1}` } : undefined}>{children}</ol>,
  table: ({ children }) => <div className="wdoc-table" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
  pre: ({ node }) => {
    const code = node?.children.find((child): child is HastElement => child.type === "element" && child.tagName === "code");
    return <CodeBlock text={(code ? hastText(code) : node ? hastText(node) : "").replace(/\n$/, "")} />;
  },
  // Only inline code reaches here: blocks render through pre above.
  code: ({ children }) => {
    const text = textOf(children);
    const ref = parseRef(text);
    return ref ? <RefChip refValue={ref} /> : <CodeChip text={text} />;
  },
  a: ({ href, children }) => {
    if (href?.startsWith(REF_URL)) {
      const ref = parseRef(href.slice(REF_URL.length));
      if (ref) return <RefChip refValue={ref} />;
    }
    // [World bible](story:<id>): the label, opening the item.
    const ref = href ? parseRef(href) : null;
    if (ref) return <RefChip refValue={ref} label={children} />;
    return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  },
  img: ({ src, alt }) => {
    const ref = typeof src === "string" ? parseRef(src) : null;
    // eslint-disable-next-line @next/next/no-img-element -- doc images are outside links
    return ref ? <RefChip refValue={ref} /> : typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" /> : null;
  },
};

const INLINE_COMPONENTS: Components = { ...COMPONENTS, p: ({ children }) => <>{children}</> };

/** Markdown in the doc's reading style. `inline` drops the paragraph wrapper. */
export const WorldDocProse = memo(function WorldDocProse({ body, idPrefix = "", inline = false, headings }: {
  body: string; idPrefix?: string; inline?: boolean; headings?: DocHeading[];
}) {
  const ids = useMemo(() => headings ?? extractHeadings(body), [body, headings]);
  const plugins = useMemo(() => [remarkGfm, remarkWorldDoc(ids, idPrefix)], [ids, idPrefix]);
  const content = <ReactMarkdown remarkPlugins={plugins} components={inline ? INLINE_COMPONENTS : COMPONENTS} urlTransform={urlTransform}>{body}</ReactMarkdown>;
  return inline ? content : <div className="wdoc-prose">{content}</div>;
});

/* ── LEARNINGS.md ───────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readableDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return month >= 1 && month <= 12 ? `${day} ${MONTHS[month - 1]} ${year}` : iso;
};

function LearningRow({ learning }: { learning: Learning }) {
  const { copied, copy } = useCopied();
  return <li className="wdoc-learning">
    <div className="wdoc-learning-meta">
      <button type="button" className="wdoc-learning-id" data-copied={copied || undefined} onClick={() => void copy(learning.id)}
        title={`Copy ${learning.id}`} aria-label={`Copy ${learning.id}`}>
        {learning.id}{copied && <Check aria-hidden />}
      </button>
      <time dateTime={learning.date}>{readableDate(learning.date)}</time>
    </div>
    <div className="wdoc-learning-body">
      <p className="wdoc-learning-text"><WorldDocProse body={learning.text} inline /></p>
      {learning.source && <p className="wdoc-learning-src"><span className="wdoc-learning-src-label">src</span><span><WorldDocProse body={learning.source} inline /></span></p>}
    </div>
  </li>;
}

function LearningsDoc({ body, idPrefix }: { body: string; idPrefix: string }) {
  const blocks = useMemo(() => parseLearnings(body), [body]);
  const [newestFirst, setNewestFirst] = useState(false);
  const total = blocks.reduce((sum, block) => sum + (block.kind === "learnings" ? block.items.length : 0), 0);
  const firstRun = blocks.findIndex((block) => block.kind === "learnings");
  return <div className="wdoc-prose">
    {blocks.map((block, index) => {
      if (block.kind === "prose") return <WorldDocProse key={index} body={block.text} idPrefix={idPrefix} inline={false} />;
      const items = newestFirst ? [...block.items].reverse() : block.items;
      const toggle = index === firstRun;
      return <div key={index} className="wdoc-learnings-wrap">
        {toggle && <div className="wdoc-learnings-bar">
          <span>{total} {total === 1 ? "learning" : "learnings"}</span>
          <button type="button" onClick={() => setNewestFirst(!newestFirst)} aria-pressed={newestFirst}>
            <ArrowDownUp aria-hidden />{newestFirst ? "Newest first" : "Oldest first"}
          </button>
        </div>}
        <ol className="wdoc-learnings">{items.map((learning) => <LearningRow key={`${learning.id}-${learning.line}`} learning={learning} />)}</ol>
      </div>;
    })}
  </div>;
}

/* ── Table of contents ──────────────────────────────────────────────────── */

/** The headings worth listing: below a single title, two levels deep. */
export const tocHeadings = (headings: DocHeading[]) => {
  const titles = headings.filter((heading) => heading.level === 1).length;
  const pool = titles === 1 ? headings.filter((heading) => heading.level > 1) : headings;
  const top = Math.min(...pool.map((heading) => heading.level));
  return pool.filter((heading) => heading.level <= top + 1).map((heading) => ({ ...heading, depth: heading.level - top }));
};

function DocToc({ headings, idPrefix, articleRef }: {
  headings: Array<DocHeading & { depth: number }>; idPrefix: string; articleRef: RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || typeof IntersectionObserver === "undefined") return;
    const elements = headings
      .map((heading) => article.querySelector<HTMLElement>(`[id="${CSS.escape(idPrefix + heading.id)}"]`))
      .filter((element): element is HTMLElement => Boolean(element));
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      // The first heading in the top band, else the last one scrolled past.
      const inBand = elements.find((element) => visible.has(element.id));
      if (inBand) { setActive(inBand.id); return; }
      const passed = elements.filter((element) => element.getBoundingClientRect().top < 0);
      if (passed.length) setActive(passed[passed.length - 1].id);
    }, { rootMargin: "0px 0px -72% 0px" });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [articleRef, headings, idPrefix]);

  const jump = (id: string) => {
    const target = articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(idPrefix + id)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(idPrefix + id);
    setOpen(false);
  };

  return <nav className="wdoc-toc" aria-label="Contents" data-open={open || undefined}>
    <button type="button" className="wdoc-toc-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>Contents</span><span className="wdoc-toc-count">{headings.length}</span>
      <ChevronDown aria-hidden className="wdoc-toc-chevron" />
    </button>
    <p className="wdoc-toc-label">Contents</p>
    <ol className="wdoc-toc-list">
      {headings.map((heading) => <li key={heading.id} data-depth={heading.depth}>
        <button type="button" aria-current={active === idPrefix + heading.id ? "location" : undefined} onClick={() => jump(heading.id)}>
          {heading.text}
        </button>
      </li>)}
    </ol>
  </nav>;
}

/* ── The reader ─────────────────────────────────────────────────────────── */

/**
 * One world doc for reading: the prose in a document measure and, when the
 * doc has enough sections, a contents list (a sticky column when there is
 * room, a collapsible bar above the doc when there is not).
 */
export function WorldDocReader({ path, body, idPrefix = "doc-", toc = true }: {
  path: string; body: string; idPrefix?: string; toc?: boolean;
}) {
  const articleRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const contents = useMemo(() => (toc ? tocHeadings(headings) : []), [headings, toc]);
  const learnings = path === WORLD_DOC_LEARNINGS;
  const withToc = contents.length >= 3;

  return <div className={`wdoc${withToc ? " wdoc-has-toc" : ""}`}>
    <div className="wdoc-layout">
      {withToc && <DocToc headings={contents} idPrefix={idPrefix} articleRef={articleRef} />}
      <article ref={articleRef} className="wdoc-article">
        {learnings ? <LearningsDoc body={body} idPrefix={idPrefix} /> : <WorldDocProse body={body} idPrefix={idPrefix} headings={headings} />}
      </article>
    </div>
  </div>;
}
