"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Pencil, X } from "lucide-react";
import { shortAssetId } from "@/lib/inbox";
import { imageKeyOf, type ImageKey } from "@/lib/inbox-keys";
import { CopyChip, Micro, RADIUS, SCRIM, mono } from "./inbox-ui";
import { EditInPlace } from "@/components/gallery/edit-in-place";
import { BeforeAfterWipe, type EditCompare } from "@/components/gallery/before-after-wipe";

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 12;

/**
 * Full-screen look at one card. The thumbnail paints first and the original
 * replaces it when decoded. Pinch or wheel to zoom, drag to pan, double-tap
 * (or 0) for 100 %: one image pixel per screen pixel. Esc, 4 or × closes.
 * 1 / A / K approve, 2 / X archive, 3 / C comment (`onKey`). E opens the
 * in-place edit panel beside the image (with `ownerUserId`); a landed take
 * wipes against the original on the stage.
 */
export function ZoomViewer({ assetId, kind, url, thumbUrl, width, height, defect, archived, onClose, onKey, ownerUserId, startEditing = false }: {
  assetId: string; kind: "image" | "video"; url?: string; thumbUrl?: string; width?: number; height?: number;
  /** An artifact's box in 0–1 image coordinates, drawn over the image. */
  defect?: { x: number; y: number; w: number; h: number };
  /** Archived images gray out here too. */
  archived?: boolean;
  onClose: () => void;
  onKey?: (key: ImageKey) => void;
  /** Enables the edit panel (E). */
  ownerUserId?: string;
  /** Open with the edit panel showing and its prompt focused. */
  startEditing?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [original, setOriginal] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; scale: number; mid: { x: number; y: number }; view: View } | null>(null);
  const lastTap = useRef(0);
  const canEdit = Boolean(ownerUserId) && kind === "image";
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [focusSignal, setFocusSignal] = useState(startEditing ? 1 : 0);
  const [compare, setCompare] = useState<EditCompare | null>(null);
  const openEdit = useCallback(() => { setEditing(true); setFocusSignal((n) => n + 1); }, []);

  useEffect(() => {
    const measure = () => {
      const rect = stage.current?.getBoundingClientRect();
      if (rect) setBox({ w: rect.width, h: rect.height });
    };
    measure();
    // The stage narrows when the edit panel opens beside it.
    const observer = new ResizeObserver(measure);
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  // The image's fitted size on screen; 100 % is its natural width over that.
  const natural = { w: width ?? 0, h: height ?? 0 };
  const fitScale = natural.w && natural.h && box.w && box.h ? Math.min(box.w / natural.w, box.h / natural.h, 1) : 1;
  const fitted = { w: natural.w * fitScale, h: natural.h * fitScale };
  const oneToOne = fitScale > 0 ? 1 / fitScale : 1;
  const percent = Math.round(view.scale * fitScale * 100);

  const zoomAt = useCallback((scale: number, point: { x: number; y: number }, from: View) => {
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    if (next === 1) return FIT;
    // Keep the point under the finger (relative to the stage centre) still.
    const ratio = next / from.scale;
    return { scale: next, x: point.x - (point.x - from.x) * ratio, y: point.y - (point.y - from.y) * ratio };
  }, []);

  const relative = (clientX: number, clientY: number) => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Typing an edit prompt: the keys are text. Escape leaves the field.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); target.blur(); }
        return;
      }
      if (canEdit && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "e") {
        event.preventDefault(); event.stopPropagation();
        if (editing) setEditing(false); else openEdit();
        return;
      }
      // Capture phase: these keys never reach the stack's own shortcuts
      // (K there is the duplicates' Keep all, numbers answer the card).
      const key = event.metaKey || event.ctrlKey || event.altKey ? null : imageKeyOf(event.key, event.code);
      if (key) {
        event.preventDefault(); event.stopPropagation();
        if (key === "open" || !onKey) onClose();
        else onKey(key);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "0") {
        event.preventDefault(); event.stopPropagation();
        setView((current) => (current.scale !== 1 ? FIT : { scale: oneToOne, x: 0, y: 0 }));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, onKey, oneToOne, canEdit, editing, openEdit]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = relative(event.clientX, event.clientY);
      setView((current) => zoomAt(current.scale * Math.exp(-event.deltaY * 0.0025), point, current));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale,
        mid: relative((a.x + b.x) / 2, (a.y + b.y) / 2), view,
      };
    } else if (points.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        const point = relative(event.clientX, event.clientY);
        setView((current) => (current.scale > 1.01 ? FIT : zoomAt(oneToOne, point, current)));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
      gesture.current = null;
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2 && gesture.current) {
      const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
      const start = gesture.current;
      setView(zoomAt(start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.distance), start.mid, start.view));
    } else if (points.length === 1) {
      setView((current) => (current.scale === 1 ? current : { ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  return <div className="fixed inset-0 z-[90] flex flex-col animate-fade-in" style={{ background: "var(--lm-overlay-canvas)" }}
    role="dialog" aria-modal="true" aria-label="Full-size image">
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
      <div className="pointer-events-auto flex items-center gap-2">
        <CopyChip value={`asset:${assetId}`} label={shortAssetId(assetId)} />
        {kind === "image" && <button type="button" onClick={() => setView((current) => (current.scale !== 1 ? FIT : { scale: oneToOne, x: 0, y: 0 }))}
          className="px-2 py-[5px] text-[10px] font-bold tracking-[0.08em]" title="Fit or 100 % (0)"
          style={{ ...mono, borderRadius: RADIUS, background: SCRIM, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-primary)" }}>
          {percent}%
        </button>}
        {kind === "image" && !original && url && <Micro color="var(--lm-text-ghost)">Loading original…</Micro>}
        {canEdit && <button type="button" onClick={() => (editing ? setEditing(false) : openEdit())} title="Edit in place (E)"
          className="flex items-center gap-1.5 px-2 py-[5px] text-[10px] font-bold uppercase tracking-[0.1em]"
          style={{ ...mono, borderRadius: RADIUS, background: editing ? "var(--lm-coral)" : SCRIM, border: `1px solid ${editing ? "var(--lm-coral)" : "var(--lm-border-strong)"}`, color: editing ? "#0a0805" : "var(--lm-text-primary)" }}>
          <Pencil size={11} aria-hidden />Edit · E
        </button>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="pointer-events-auto grid h-10 w-10 place-items-center"
        style={{ borderRadius: RADIUS, background: SCRIM, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-primary)" }}>
        <X size={18} aria-hidden />
      </button>
    </div>

    <div className="flex min-h-0 flex-1">
    <div ref={stage} className="relative min-h-0 min-w-0 flex-1 touch-none select-none overflow-hidden"
      onPointerDown={kind === "image" ? onPointerDown : undefined} onPointerMove={kind === "image" ? onPointerMove : undefined}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {kind === "video" && url
        ? <video src={url} poster={thumbUrl} controls autoPlay playsInline className="absolute inset-0 m-auto max-h-full max-w-full" />
        : <div className="absolute left-1/2 top-1/2" data-archived={archived} style={{
            width: fitted.w || "100%", height: fitted.h || "100%",
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center", willChange: "transform",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the cached card thumbnail paints first */}
            {thumbUrl && !original && <img src={thumbUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />}
            {/* eslint-disable-next-line @next/next/no-img-element -- the full original for inspection */}
            {url && <img src={url} alt="Full-size image" draggable={false} onLoad={() => setOriginal(true)}
              className="absolute inset-0 h-full w-full object-contain" style={{ opacity: original ? 1 : 0, imageRendering: view.scale * fitScale >= 2 ? "pixelated" : "auto" }} />}
            {defect && <span aria-label="The defect" className="pointer-events-none absolute" style={{
              left: `${defect.x * 100}%`, top: `${defect.y * 100}%`, width: `${defect.w * 100}%`, height: `${defect.h * 100}%`,
              border: `${2 / view.scale}px solid var(--lm-coral)`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.18)",
            }} />}
            {compare && <BeforeAfterWipe compare={compare} />}
          </div>}
    </div>
    {editing && ownerUserId && <aside className="relative z-10 w-[400px] max-w-[46vw] shrink-0 overflow-y-auto overscroll-contain px-4 pb-6"
      style={{ paddingTop: "max(64px, env(safe-area-inset-top))", background: "var(--lm-paper)", borderLeft: "1px solid var(--lm-border)" }}
      aria-label="Edit in place">
      <EditInPlace assetId={assetId} ownerUserId={ownerUserId} width={width} height={height} assetUrl={url}
        compare={compare} onCompare={setCompare} focusSignal={focusSignal} listenForE={false} />
    </aside>}
    </div>
  </div>;
}
