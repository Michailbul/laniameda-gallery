"use client";

/* eslint-disable @next/next/no-img-element -- beat covers are tiny raw thumbs
   already sized by R2; next/image adds wrapper overhead and its optimizer is
   bypassed for R2 URLs anyway. */

import { useState } from "react";

type Beat = {
  folderId: string;
  name: string;
  count: number;
  order?: number;
  cover?: {
    kind: "image" | "video";
    url?: string;
    thumbUrl?: string;
  };
};

type Episode = {
  folderId: string;
  name: string;
  synopsis?: string;
  beats: Beat[];
  assetCount: number;
};

/**
 * The Episodes tab of the project view. An episode is a chapter that groups
 * beats, so this is a list of episodes with their beats beneath each, plus the
 * beats not filed anywhere yet.
 *
 * Flat and boxless: episodes are separated by hairlines and typographic weight,
 * not cards. Clicking a beat drills into it the same way the grid does.
 */
export function ProjectEpisodes({
  projectName,
  episodes,
  unassignedBeats,
  loading,
  onOpenBeat,
  onCreateEpisode,
  onFileBeat,
}: {
  projectName: string;
  episodes: Episode[];
  unassignedBeats: Beat[];
  loading: boolean;
  onOpenBeat: (beatFolderId: string) => void;
  onCreateEpisode: (name: string) => Promise<void> | void;
  onFileBeat: (beatFolderId: string, episodeFolderId: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Beat folders are namespaced ("DARI — Beat 1"); the project is already the
  // heading, so show the leaf.
  const leaf = (name: string) => {
    const prefix = `${projectName} — `;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  };

  const submit = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreateEpisode(name);
      setDraft("");
      // Stay open so several episodes can be named in a row.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pb-16 pt-1 md:px-6" style={{ fontFamily: "var(--lm-font)" }}>
      {/* New episode. Idle it's just a word — the field (and its rule) only
          exist while you're actually typing, so the tab carries no spare line. */}
      <div className="flex items-center pb-4" style={{ minHeight: "26px" }}>
        {composing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft("");
                setComposing(false);
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setComposing(false);
            }}
            placeholder="Episode name, then Enter"
            aria-label="New episode name"
            disabled={busy}
            className="min-w-0 bg-transparent outline-none"
            style={{
              fontSize: "13px",
              width: "260px",
              color: "var(--lm-text-primary)",
              borderBottom: "1px solid var(--lm-coral)",
              caretColor: "var(--lm-coral)",
              paddingBottom: "3px",
              opacity: busy ? 0.5 : 1,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="lm-episode-add cursor-pointer border-none bg-transparent p-0"
            style={{
              fontSize: "12.5px",
              color: "var(--lm-text-tertiary)",
              transition: "color var(--lm-duration-fast)",
            }}
          >
            + New episode
          </button>
        )}
      </div>

      {loading ? (
        <p style={noteStyle}>Loading episodes…</p>
      ) : episodes.length === 0 && unassignedBeats.length === 0 ? (
        <p style={noteStyle}>
          No episodes yet. Name one above, then file this project&apos;s beats
          into it.
        </p>
      ) : (
        <>
          {episodes.map((episode) => (
            <section
              key={episode.folderId}
              className="pb-6 pt-4"
              style={{ borderTop: "1px solid var(--lm-border-subtle)" }}
            >
              <header className="flex items-baseline gap-2 pb-3">
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 650,
                    letterSpacing: "-0.01em",
                    color: "var(--lm-text-primary)",
                  }}
                >
                  {leaf(episode.name)}
                </h3>
                <span style={countStyle}>
                  {episode.beats.length}{" "}
                  {episode.beats.length === 1 ? "beat" : "beats"}
                </span>
                {episode.assetCount > 0 && (
                  <span style={countStyle}>· {episode.assetCount} media</span>
                )}
              </header>
              {episode.synopsis && (
                <p
                  className="pb-3"
                  style={{
                    fontSize: "12.5px",
                    lineHeight: 1.5,
                    color: "var(--lm-text-secondary)",
                    maxWidth: "62ch",
                  }}
                >
                  {episode.synopsis}
                </p>
              )}
              {episode.beats.length === 0 ? (
                <p style={noteStyle}>
                  Empty — file a beat into it from Unassigned below.
                </p>
              ) : (
                <BeatRow
                  beats={episode.beats}
                  leaf={leaf}
                  onOpenBeat={onOpenBeat}
                  episodes={episodes}
                  currentEpisodeId={episode.folderId}
                  onFileBeat={onFileBeat}
                />
              )}
            </section>
          ))}

          {unassignedBeats.length > 0 && (
            <section
              className="pb-6 pt-4"
              style={{ borderTop: "1px solid var(--lm-border-subtle)" }}
            >
              <header className="flex items-baseline gap-2 pb-3">
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 650,
                    letterSpacing: "-0.01em",
                    color: "var(--lm-text-tertiary)",
                  }}
                >
                  Unassigned
                </h3>
                <span style={countStyle}>
                  {unassignedBeats.length}{" "}
                  {unassignedBeats.length === 1 ? "beat" : "beats"}
                </span>
              </header>
              <BeatRow
                beats={unassignedBeats}
                leaf={leaf}
                onOpenBeat={onOpenBeat}
                episodes={episodes}
                currentEpisodeId={null}
                onFileBeat={onFileBeat}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

// A horizontal run of beat covers. Each carries a small episode picker so
// filing a beat never needs a separate mode.
function BeatRow({
  beats,
  leaf,
  onOpenBeat,
  episodes,
  currentEpisodeId,
  onFileBeat,
}: {
  beats: Beat[];
  leaf: (name: string) => string;
  onOpenBeat: (beatFolderId: string) => void;
  episodes: Episode[];
  currentEpisodeId: string | null;
  onFileBeat: (beatFolderId: string, episodeFolderId: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {beats.map((beat) => {
        const src = beat.cover?.thumbUrl ?? beat.cover?.url;
        return (
          <div key={beat.folderId} className="w-[168px]">
            <button
              type="button"
              onClick={() => onOpenBeat(beat.folderId)}
              className="lm-episode-beat block w-full cursor-pointer border-none bg-transparent p-0"
              title={`Open ${leaf(beat.name)}`}
            >
              <span
                className="block overflow-hidden"
                style={{
                  borderRadius: "8px",
                  aspectRatio: "16 / 9",
                  backgroundColor: "var(--lm-surface-2)",
                }}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </span>
              <span
                className="mt-1.5 block truncate text-left"
                style={{
                  fontSize: "12px",
                  fontWeight: 550,
                  color: "var(--lm-text-primary)",
                }}
              >
                {leaf(beat.name)}
              </span>
              <span className="block text-left" style={countStyle}>
                {beat.count} {beat.count === 1 ? "clip" : "clips"}
              </span>
            </button>
            <select
              value={currentEpisodeId ?? ""}
              onChange={(event) =>
                onFileBeat(beat.folderId, event.target.value || null)
              }
              aria-label={`Episode for ${leaf(beat.name)}`}
              className="mt-1 w-full cursor-pointer bg-transparent outline-none"
              style={{
                fontSize: "10.5px",
                color: "var(--lm-text-tertiary)",
                border: "none",
                borderBottom: "1px solid var(--lm-border-subtle)",
                paddingBottom: "2px",
              }}
            >
              <option value="">Unassigned</option>
              {episodes.map((episode) => (
                <option key={episode.folderId} value={episode.folderId}>
                  {leaf(episode.name)}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: "12.5px",
  color: "var(--lm-text-tertiary)",
};

const countStyle: React.CSSProperties = {
  fontSize: "10.5px",
  fontVariantNumeric: "tabular-nums",
  color: "var(--lm-text-ghost)",
};
