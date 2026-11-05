import { useId } from "react";
import { DEAR_ANNETE_WORDMARK } from "./wordmark-dear-annete";

// A world's mark. Worlds with a drawn wordmark get it; any other world is set
// in the gallery's own bold sans so the page still works for it.
const WORDMARKS: Record<string, typeof DEAR_ANNETE_WORDMARK> = {
  "dear-annete": DEAR_ANNETE_WORDMARK,
};

export const hasWordmark = (slug: string) => slug in WORDMARKS;

export function WorldWordmark({
  slug,
  name,
  className,
  textClassName,
  as = "h1",
  small = false,
}: {
  slug: string;
  name: string;
  className?: string;
  textClassName?: string;
  as?: "h1" | "div";
  /** Bar size: a lighter hairline stroke, enough to keep the N's thin strokes. */
  small?: boolean;
}) {
  const gradientId = useId();
  const mark = WORDMARKS[slug];
  const Tag = as;
  if (!mark) return <Tag className={textClassName}>{name}</Tag>;
  return (
    <Tag style={{ margin: 0, lineHeight: 0 }}>
      <svg
        className={className}
        viewBox={mark.viewBox}
        role="img"
        aria-label={name}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Brass under lacquer: a warm low band, a pale highlight, a dark heel. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3dca4" />
            <stop offset="0.42" stopColor="#d4a957" />
            <stop offset="0.7" stopColor="#a87b36" />
            <stop offset="1" stopColor="#e6c27a" />
          </linearGradient>
        </defs>
        {/* The stroke is one screen pixel at any size: hairlines stay visible on a phone. */}
        <path
          d={mark.d}
          fill={`url(#${gradientId})`}
          stroke={`url(#${gradientId})`}
          strokeWidth={small ? 0.45 : 0.8}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="miter"
        />
      </svg>
    </Tag>
  );
}
