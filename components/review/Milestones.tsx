"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { plural, shortDate, type ReviewVersion } from "@/lib/review-client";

// Rounds as a milestone bar at the top middle: one milestone per published
// round, the shown one lit (amber, the track filled up to it), earlier ones
// a click away. For Michael only, a hollow "Next round" at the end: the
// draft that promoted frames gather in.

type Props = {
  versions: ReviewVersion[];
  shownId?: string;
  isOwner: boolean;
  directorName: string;
  onPick: (version: ReviewVersion) => void;
};

type Tip = { x: number; y: number; title: string; body: string };

export function Milestones({ versions, shownId, isOwner, directorName, onPick }: Props) {
  const published = versions.filter((row) => row.status === "published").sort((a, b) => a.number - b.number);
  const draft = isOwner ? versions.find((row) => row.isDraft) : undefined;
  const current = published.find((row) => row.isCurrent);
  const shownIndex = published.findIndex((row) => row.id === shownId);
  const draftShown = Boolean(draft && draft.id === shownId);
  const n = Math.max(1, published.length);
  const progress = draftShown ? 1 : n > 1 && shownIndex > 0 ? shownIndex / (n - 1) : 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  // Tooltips render in the page root: the header's blur and the bar's fade
  // mask would clip them in place. They only show after a pointer event.
  const host = tip && typeof document !== "undefined" ? (document.querySelector(".rv") as HTMLElement | null) : null;

  // Keep the shown milestone in view on narrow screens.
  useEffect(() => {
    const box = scrollRef.current;
    const node = box?.querySelector<HTMLElement>("[data-on]");
    if (!box || !node) return;
    box.scrollTo({ left: node.offsetLeft - box.clientWidth / 2 + node.offsetWidth / 2, behavior: "smooth" });
  }, [shownId]);

  const showTip = (event: React.PointerEvent | React.FocusEvent, title: string, body: string) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: rect.left + rect.width / 2, y: rect.bottom + 8, title, body });
  };

  const draftLine = draft
    ? draft.added || draft.removed
      ? [draft.added ? plural(draft.added, "new frame") : "", draft.removed ? `${draft.removed} taken out` : ""].filter(Boolean).join(", ")
      : "Frames moved or restyled"
    : "";

  return (
    <nav className="rv-ms" aria-label="Rounds" ref={scrollRef}>
      <div className="rv-ms-track" style={{ "--n": n, "--p": progress } as React.CSSProperties}>
        <span className="rv-ms-line" />
        <span className="rv-ms-fill" />
        {isOwner ? <span className="rv-ms-next" /> : null}
        {published.map((row, index) => {
          const on = row.id === shownId;
          const live = row.isCurrent && (isOwner || shownId !== current?.id);
          return (
            <button
              key={row.id}
              type="button"
              className="rv-ms-node"
              data-on={on ? "" : undefined}
              data-passed={!on && (draftShown || index < shownIndex) ? "" : undefined}
              data-live={row.isCurrent ? "" : undefined}
              aria-current={on ? "step" : undefined}
              aria-label={`${row.label}${row.title ? `, ${row.title}` : ""}`}
              onClick={() => {
                setTip(null);
                onPick(row);
              }}
              onPointerEnter={(event) =>
                showTip(
                  event,
                  `${row.label}${row.title ? ` · ${row.title}` : ""}`,
                  [
                    row.note,
                    row.publishedAt
                      ? isOwner
                        ? `Shown to ${directorName} ${shortDate(row.publishedAt)}${row.isCurrent ? `, the round ${directorName} sees now` : ""}`
                        : `${row.isCurrent ? "The latest round" : "An earlier round"}, from ${shortDate(row.publishedAt)}`
                      : "",
                  ].filter(Boolean).join(". "),
                )
              }
              onPointerLeave={() => setTip(null)}
              onFocus={(event) => showTip(event, `${row.label}${row.title ? ` · ${row.title}` : ""}`, row.note ?? "")}
              onBlur={() => setTip(null)}
            >
              <span className="dot" />
              <span className="lb">{row.label}</span>
              <span className="dt">{row.publishedAt ? shortDate(row.publishedAt) : ""}{live ? " · live" : ""}</span>
            </button>
          );
        })}
        {isOwner ? (
          <button
            type="button"
            className="rv-ms-node next"
            data-on={draftShown ? "" : undefined}
            data-empty={draft ? undefined : ""}
            aria-current={draftShown ? "step" : undefined}
            aria-label={draft ? `Next round: ${draftLine}` : "Next round: nothing waiting yet"}
            onClick={() => {
              setTip(null);
              if (draft) onPick(draft);
            }}
            onPointerEnter={(event) =>
              showTip(
                event,
                "Next round",
                draft
                  ? `${draftLine}. ${directorName} still sees ${current?.label ?? "nothing yet"} until you send it.`
                  : "Frames you promote in the gallery (R) gather here as the next round.",
              )
            }
            onPointerLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          >
            <span className="dot" />
            <span className="lb">Next round</span>
            <span className="dt">{draft ? (draft.added ? `${draft.added} waiting` : "ready") : "nothing yet"}</span>
          </button>
        ) : null}
      </div>
      {tip && host && (tip.title || tip.body)
        ? createPortal(
            <div className="rv-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
              <b>{tip.title}</b>
              {tip.body}
            </div>,
            host,
          )
        : null}
    </nav>
  );
}
