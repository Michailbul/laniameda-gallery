"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

export type SkillMediaRef = {
  id: string;
  kind: "image" | "video";
  url?: string;
  thumbUrl?: string;
  description?: string;
};

type SkillMarkdownProps = {
  children: string;
  /** Gallery media that `![caption](asset:<id>)` can point at. */
  media?: Map<string, SkillMediaRef>;
  onOpenMedia?: (media: SkillMediaRef) => void;
  onCopy?: (text: string, label: string) => void;
  className?: string;
};

const ASSET_PREFIX = "asset:";

// react-markdown strips unknown URL schemes; `asset:` is ours.
const urlTransform = (url: string) =>
  url.startsWith(ASSET_PREFIX) ? url : defaultUrlTransform(url);

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
};

function CodeBlock({
  children,
  onCopy,
}: {
  children: ReactNode;
  onCopy?: (text: string, label: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = textOf(children).replace(/\n$/, "");
  return (
    <div className="skill-md-code">
      <button
        type="button"
        className="skill-md-code-copy"
        onClick={() => {
          if (onCopy) onCopy(text, "BLOCK COPIED");
          else void navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
        aria-label="Copy block"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

// A skill's prose as a post: GitHub-flavoured markdown, gallery images inline
// through `asset:<id>`, every fenced block copyable.
export const SkillMarkdown = memo(function SkillMarkdown({
  children,
  media,
  onOpenMedia,
  onCopy,
  className,
}: SkillMarkdownProps) {
  const components: Components = {
    a: ({ href, children: label }) => (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {label}
      </a>
    ),
    pre: ({ children: code }) => <CodeBlock onCopy={onCopy}>{code}</CodeBlock>,
    img: ({ src, alt }) => {
      const raw = typeof src === "string" ? src : "";
      const ref = raw.startsWith(ASSET_PREFIX)
        ? media?.get(raw.slice(ASSET_PREFIX.length))
        : undefined;
      const url = ref ? ref.url ?? ref.thumbUrl : raw.startsWith(ASSET_PREFIX) ? undefined : raw;
      if (!url) {
        return <span className="skill-md-missing">{alt || raw}</span>;
      }
      const caption = alt?.trim() || ref?.description?.trim();
      return (
        <span className="skill-md-figure">
          <button
            type="button"
            className="skill-md-figure-frame"
            onClick={() =>
              onOpenMedia?.(ref ?? { id: url, kind: "image", url, description: caption })
            }
          >
            {ref?.kind === "video" ? (
              <video
                src={url}
                poster={ref.thumbUrl}
                muted
                loop
                playsInline
                autoPlay
                className="skill-md-figure-media"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={caption ?? ""} loading="lazy" className="skill-md-figure-media" />
            )}
          </button>
          {caption ? <span className="skill-md-figure-caption">{caption}</span> : null}
        </span>
      );
    },
  };

  return (
    <div className={`skill-md${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
