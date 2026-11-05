"use client";

import "@/components/world-page/world-pitch.css";

// A failed read on a world page: the lacquer ground and one quiet line, with
// a retry, instead of the framework's default error screen.
export default function WorldError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wp" style={{ display: "grid", placeItems: "center" }}>
      <div className="wp-end wp-mono">
        <span className="wp-lozenge" aria-hidden />
        <p style={{ margin: 0 }}>The world did not open</p>
        <button
          type="button"
          className="wp-tab wp-mono"
          style={{ padding: "8px 0", color: "var(--wp-ivory)" }}
          onClick={reset}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
