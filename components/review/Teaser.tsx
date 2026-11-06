/* eslint-disable @next/next/no-img-element -- tiny inline data images, also served on another domain */
import { getReviewTeaser } from "@/lib/server/review-teaser";
import { FolderIcon } from "./folder-icons";

// Behind the sign-in: the real review of the current round (folders in
// script order with their icons and counts, the style labels, the round,
// the frames), drawn from 48 px thumbnails and blurred. A server component:
// it adds no script, and it streams in after the card, so signing in never
// waits for it. Nothing sharper than the 48 px blur reaches the browser.

const FRAMES = 18;

export async function TeaserBackdrop({ slug }: { slug: string }) {
  const teaser = await getReviewTeaser(slug);
  if (!teaser) return null;
  const locations = teaser.folders.filter((row) => row.section === "locations");
  const folders = (locations.length ? locations : teaser.folders).slice(0, 16);
  const shownAt = Math.max(0, folders.findIndex((row) => row.count > 0));
  const heading = folders[shownAt]?.name ?? teaser.title;
  return (
    <div className="rv-tz" aria-hidden="true">
      <div className="rv-tz-layer">
        <div className="rv-tz-side">
          <div className="t">{teaser.title}</div>
          <div className="seg"><i /><span /></div>
          {folders.map((row, index) => (
            <div key={`${row.name}-${index}`} className="rv-tz-row" data-on={index === shownAt ? "" : undefined} data-empty={row.count ? undefined : ""}>
              <FolderIcon name={row.icon} section={row.section} />
              {row.name}
              <span className="n">{row.count}</span>
            </div>
          ))}
        </div>
        <div className="rv-tz-main">
          <div className="rv-tz-bar">{teaser.round ? <i data-on="" /> : null}</div>
          <div className="rv-tz-styles">
            {teaser.styles.filter((row) => row.count > 0).map((row) => <span key={row.label}>{row.label}</span>)}
          </div>
          <div className="rv-tz-head" style={{ width: `${Math.min(26, 6 + heading.length * 1.1)}ch` }} />
          <div className="rv-tz-grid">
            {teaser.frames.slice(0, FRAMES).map((frame, index) => (
              <div key={index} className="rv-tz-t" style={{ "--ar": (frame.w / Math.max(1, frame.h)).toFixed(3) } as React.CSSProperties}>
                <img src={frame.src} alt="" decoding="async" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rv-tz-shade" />
      <div className="rv-tz-grain" />
    </div>
  );
}
