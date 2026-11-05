"use client";

export interface StyleScopeOption {
  _id: string;
  name: string;
  count?: number;
}

/**
 * The style a world is browsed in: ALL STYLES or one of its style branches.
 * Sits under the breadcrumb inside a world that has two or more styles, so a
 * shelf (Streets, Cast, Night…) can be read one style at a time. Same flat
 * text pills as the filter bar: gradient when active, ghost text at rest.
 */
export function StyleScopeSwitcher({
  styles,
  activeStyleId,
  onSelect,
}: {
  styles: StyleScopeOption[];
  activeStyleId: string | null;
  /** null = every style. */
  onSelect: (styleId: string | null) => void;
}) {
  const options: Array<{ id: string | null; label: string; count?: number }> = [
    { id: null, label: "All styles" },
    ...styles.map((style) => ({ id: style._id, label: style.name, count: style.count })),
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Style"
      className="flex items-center gap-2 overflow-x-auto px-4 pb-1 pt-1 md:px-6"
      style={{ fontFamily: "var(--lm-font)", scrollbarWidth: "none" }}
    >
      <span
        aria-hidden
        style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
          flexShrink: 0,
        }}
      >
        Style
      </span>
      <div className="flex items-center gap-1">
        {options.map((option) => {
          const active = option.id === activeStyleId;
          return (
            <button
              key={option.id ?? "all"}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(option.id)}
              className="inline-flex items-center gap-1.5 transition-all"
              style={{
                padding: "4px 10px",
                borderRadius: "12px",
                background: active
                  ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
                  : "transparent",
                color: active ? "#fff" : "var(--lm-text-tertiary)",
                fontSize: "9px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                border: active
                  ? "2px solid var(--gradient-1)"
                  : "2px solid var(--lm-border)",
                cursor: "pointer",
                fontFamily: "var(--lm-font)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title={
                option.id
                  ? `Show only ${option.label} in every folder of this world`
                  : "Show every style"
              }
            >
              {option.label}
              {typeof option.count === "number" && (
                <span
                  className="font-mono"
                  style={{
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    color: active ? "rgba(255,255,255,0.75)" : "var(--lm-text-ghost)",
                  }}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
