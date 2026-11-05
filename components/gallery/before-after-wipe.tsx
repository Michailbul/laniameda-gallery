"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

export type EditCompare = {
  jobId: string;
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
};

/**
 * Before / after wipe over a media stage: the edit underneath, the source
 * clipped to the left of a coral line that follows the pointer. From the
 * reviewer kit's `.stage.cmp`. Fills its positioned parent.
 */
export function BeforeAfterWipe({ compare, fit = "contain" }: { compare: EditCompare; fit?: "contain" | "cover" }) {
  const [cut, setCut] = useState(50);
  const follow = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) setCut(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <div className="lm-wipe" onPointerMove={follow} onPointerDown={follow} aria-label="Before and after" role="img">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote originals, compared pixel for pixel */}
      <img src={compare.afterUrl} alt="" draggable={false} style={{ objectFit: fit }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- remote originals, compared pixel for pixel */}
      <img src={compare.beforeUrl} alt="" draggable={false} className="lm-wipe-before"
        style={{ objectFit: fit, clipPath: `inset(0 ${100 - cut}% 0 0)` }} />
      <span className="lm-wipe-line" style={{ left: `${cut}%` }} />
      <span className="lm-wipe-tag lm-wipe-tag-b">Before · {compare.beforeLabel}</span>
      <span className="lm-wipe-tag lm-wipe-tag-a">After · {compare.afterLabel}</span>
    </div>
  );
}
