// Inline icons for the review page (no icon library in this route's bundle).
// 16-unit grid, stroke icons drawn with currentColor.

type IconProps = { size?: number; className?: string };

const Svg = ({ size = 14, className, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ThumbUp = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 7v7H2.5V7H5Z" />
    <path d="M5 7.2 7.6 2.3c.9 0 1.7.8 1.5 1.8L8.7 6.3h3.9c.9 0 1.5.8 1.3 1.7l-1 4.7c-.2.8-.8 1.3-1.6 1.3H5" />
  </Svg>
);

export const ThumbDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="M11 9V2h2.5v7H11Z" />
    <path d="M11 8.8 8.4 13.7c-.9 0-1.7-.8-1.5-1.8l.4-2.2H3.4c-.9 0-1.5-.8-1.3-1.7l1-4.7C3.3 2.5 3.9 2 4.7 2H11" />
  </Svg>
);

export const Bubble = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 3.5h11v7.5H8l-3.2 2.5V11H2.5V3.5Z" />
  </Svg>
);

export const Download = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10" />
  </Svg>
);

export const Close = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
  </Svg>
);

export const ChevronLeft = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10 3 5 8l5 5" />
  </Svg>
);

export const ChevronRight = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 3 5 5-5 5" />
  </Svg>
);

export const ChevronDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3.5 6 4.5 4.5L12.5 6" />
  </Svg>
);

export const Check = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3 8.5 3.2 3L13 4.5" />
  </Svg>
);

export const Menu = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Svg>
);

export const Copy = (props: IconProps) => (
  <Svg {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);

export const Zoom = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3M5 7h4M7 5v4" />
  </Svg>
);

export const BellIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.2H2.8L4 11.5Z" />
    <path d="M6.6 14.2a1.5 1.5 0 0 0 2.8 0" />
  </Svg>
);
