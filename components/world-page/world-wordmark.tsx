import { worldBrand } from "./world-brand";

// A world's mark. Worlds with a drawn wordmark get it (ivory, currentColor);
// any other world is set in the page's UI face so the page still works.
// `draw` traces the outline once, then fills it (the opening hero).

export const hasWordmark = (slug: string) => Boolean(worldBrand(slug).wordmark);

export function WorldWordmark({
  slug,
  name,
  variant = "stack",
  className,
  as = "div",
  draw = false,
  style,
}: {
  slug: string;
  name: string;
  variant?: "stack" | "line";
  className?: string;
  as?: "h1" | "div";
  draw?: boolean;
  style?: React.CSSProperties;
}) {
  const Tag = as;
  const mark = worldBrand(slug).wordmark?.[variant];
  if (!mark) {
    return <Tag className={`wp-wordmark-text ${className ?? ""}`} style={style}>{name}</Tag>;
  }
  return (
    <Tag className={className} style={{ margin: 0, lineHeight: 0, ...style }}>
      <svg
        viewBox={mark.viewBox}
        role="img"
        aria-label={name}
        preserveAspectRatio="xMidYMid meet"
        data-draw={draw || undefined}
      >
        <path
          d={mark.d}
          fill="currentColor"
          fillRule="evenodd"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Tag>
  );
}
