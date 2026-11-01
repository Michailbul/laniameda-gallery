"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { worldStylesPath } from "@/lib/gallery-routes";
import { Micro, display } from "@/components/inbox/inbox-ui";
import { MOSAIC_COVERS, MOSAIC_CSS, StyleCaption, StyleMosaic, orderMedia } from "./style-mosaic";

// The top of a world page: every style of the world's universe as a big
// mosaic card, filtered by medium (Film, Art Deco, 3D) instead of separate
// worlds. A card opens the style's own page: its frames by story, its recipes
// and its style lock. The pieces of the world follow underneath as before.

const CARD_WIDTH = 236;
const ROW_HEIGHT = 112;

export function WorldStylesStrip({ ownerUserId, worldKey }: { ownerUserId: string; worldKey: string }) {
  const { isAuthenticated } = useConvexAuth();
  const listing = useQuery(api.worldStyles.listStyles, isAuthenticated ? { ownerUserId, world: worldKey, coverLimit: MOSAIC_COVERS } : "skip");
  const [medium, setMedium] = useState<string | null>(null);
  const rail = useRef<HTMLDivElement>(null);

  const media = useMemo(() => orderMedia([...new Set((listing?.styles ?? []).map((style) => style.family))]), [listing]);
  const styles = useMemo(() => {
    const all = listing?.styles ?? [];
    const rank = new Map(media.map((name, index) => [name, index]));
    return all
      .filter((style) => !medium || style.family === medium)
      .map((style, index) => ({ style, index }))
      .sort((a, b) => (rank.get(a.style.family) ?? 9) - (rank.get(b.style.family) ?? 9) || a.index - b.index)
      .map(({ style }) => style);
  }, [listing, medium, media]);

  if (listing === undefined) {
    return <div className="px-4 pt-3 md:px-6" aria-hidden><div className="lm-strip-skel" /><style>{STRIP_CSS}</style></div>;
  }
  if (listing.styles.length === 0) return null;
  const count = (name: string | null) => listing.styles.filter((style) => !name || style.family === name).length;
  const scrollBy = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <section aria-label="Styles of this world" className="pb-2 pt-3" style={{ borderBottom: "1px solid var(--lm-border-subtle)" }}>
      <style>{MOSAIC_CSS + STRIP_CSS}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 md:px-6">
        <h2 className="text-[18px] font-black uppercase leading-none tracking-tight" style={display}>Styles</h2>
        <nav aria-label="Medium" className="flex flex-wrap items-center gap-1">
          {[null, ...media].map((name) => (
            <button key={name ?? "all"} type="button" onClick={() => setMedium(name)} className="lm-strip-pill" data-on={name === medium || undefined}>
              {name ?? "All"}<span className="lm-strip-n">{count(name)}</span>
            </button>
          ))}
        </nav>
        <Link href={worldStylesPath(worldKey)} className="ml-auto inline-flex items-center gap-1.5 hover:opacity-80" style={{ color: "var(--lm-text-secondary)" }}>
          <Micro color="var(--lm-text-secondary)">Open styles</Micro><ArrowRight size={12} aria-hidden />
        </Link>
      </div>
      <div className="relative">
        <div ref={rail} className="lm-strip-rail flex gap-3 overflow-x-auto px-4 pb-3 pt-3 md:px-6">
          {styles.map((style, index) => (
            <Link key={style.id} href={worldStylesPath(worldKey, style.slug)} className="shrink-0" style={{ width: CARD_WIDTH }}
              title={style.line ?? style.name}>
              <StyleMosaic style={style} width={CARD_WIDTH} rowHeight={ROW_HEIGHT} eager={index < 4} />
              <StyleCaption style={style} showMedium={!medium} />
            </Link>
          ))}
        </div>
        <button type="button" aria-label="Earlier styles" onClick={() => scrollBy(-1)} className="lm-strip-btn left-1"><ChevronLeft size={16} /></button>
        <button type="button" aria-label="More styles" onClick={() => scrollBy(1)} className="lm-strip-btn right-1"><ChevronRight size={16} /></button>
      </div>
    </section>
  );
}

const STRIP_CSS = `
.lm-strip-rail{scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding-inline:16px}
@media (min-width:768px){.lm-strip-rail{scroll-padding-inline:24px}}
.lm-strip-rail>a{scroll-snap-align:start}
.lm-strip-pill{font-family:var(--lm-font);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-border);color:var(--lm-text-secondary);background:transparent;display:inline-flex;gap:6px;align-items:center;transition:background-color .12s,color .12s}
.lm-strip-pill:hover{color:var(--lm-text-primary);background:var(--lm-surface-2)}
.lm-strip-pill[data-on]{background:var(--lm-ink);color:var(--lm-paper);border-color:var(--lm-ink)}
.lm-strip-n{font-weight:600;opacity:.6;letter-spacing:.04em}
.lm-strip-btn{position:absolute;top:${ROW_HEIGHT + 12}px;transform:translateY(-50%);width:32px;height:32px;display:none;place-items:center;border-radius:999px;background:color-mix(in srgb,var(--lm-paper) 78%,transparent);border:1px solid var(--lm-border-strong);color:var(--lm-text-primary);backdrop-filter:blur(8px);z-index:5}
@media (hover:hover){.lm-strip-btn{display:grid}}
.lm-strip-skel{height:${ROW_HEIGHT * 2 + 58}px;border-radius:var(--lm-radius);background:var(--lm-surface-1);animation:lm-strip-pulse 1.4s ease-in-out infinite}
@keyframes lm-strip-pulse{50%{opacity:.5}}
`;
