"use client";

import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Id } from "@/convex/_generated/dataModel";
import type { CanvasImage } from "@/components/canvas-view";
import { requestJson } from "@/lib/app-api";

const CanvasView = dynamic(
  () =>
    import("@/components/canvas-view").then((module) => ({
      default: module.CanvasView,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full w-full items-center justify-center"
        style={{ color: "var(--v7-text-ghost)" }}
      >
        <span
          style={{
            fontFamily: "var(--v7-font)",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            fontWeight: 700,
          }}
        >
          LOADING CANVAS...
        </span>
      </div>
    ),
  },
);

type SelectedImage = {
  id: string;
  thumbSrc: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
};

interface CanvasModeProps {
  images: CanvasImage[];
  selectedImage: SelectedImage | null;
  onImageSelect: (image: SelectedImage) => void;
  loading: boolean;
  ownerUserId: string;
  syncEnabled: boolean;
}

interface CanvasErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

export function CanvasMode({
  images,
  selectedImage,
  onImageSelect,
  loading,
  ownerUserId,
  syncEnabled,
}: CanvasModeProps) {
  return (
    <CanvasErrorBoundary
      resetKey={`${ownerUserId}:${images.length}:${syncEnabled ? "sync" : "local"}`}
      fallback={
        <CanvasModeFallback
          images={images}
          selectedImage={selectedImage}
          onImageSelect={onImageSelect}
          loading={loading}
          message="Canvas sync is unavailable right now. The board is still usable, but positions will stay local until Convex is running with the latest functions."
        />
      }
    >
      <CanvasModeWithSync
        images={images}
        selectedImage={selectedImage}
        onImageSelect={onImageSelect}
        loading={loading}
        ownerUserId={ownerUserId}
        syncEnabled={syncEnabled}
      />
    </CanvasErrorBoundary>
  );
}

function CanvasModeWithSync({
  images,
  selectedImage,
  onImageSelect,
  loading,
  ownerUserId,
  syncEnabled,
}: CanvasModeProps) {
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncDisabled, setSyncDisabled] = useState(false);
  const [canvasPositionsRaw, setCanvasPositionsRaw] = useState<
    Array<{ assetId: string; x: number; y: number }>
  >([]);
  const pendingPositionUpdates = useRef(new Map<string, { x: number; y: number }>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(flushTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!syncEnabled || syncDisabled || !ownerUserId) {
      return;
    }

    let cancelled = false;

    void requestJson<{
      positions: Array<{ assetId: string; x: number; y: number }>;
    }>("/api/canvas/positions")
      .then((payload) => {
        if (!cancelled) {
          setCanvasPositionsRaw(payload.positions ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanvasPositionsRaw([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ownerUserId, syncDisabled, syncEnabled]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    if (syncEnabled && !syncDisabled && ownerUserId) {
      for (const position of canvasPositionsRaw) {
        map.set(position.assetId, { x: position.x, y: position.y });
      }
    }
    for (const [assetId, position] of Object.entries(localPositions)) {
      map.set(assetId, position);
    }
    return map;
  }, [canvasPositionsRaw, localPositions, ownerUserId, syncDisabled, syncEnabled]);

  const persistPendingPositions = useCallback(async () => {
    const updates = Array.from(pendingPositionUpdates.current.entries()).map(
      ([assetId, position]) => ({
        assetId: assetId as Id<"assets">,
        ...position,
      }),
    );
    pendingPositionUpdates.current.clear();
    if (!updates.length || !syncEnabled || syncDisabled || !ownerUserId) return;
    try {
      await requestJson<{ count: number }>("/api/canvas/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: updates,
        }),
      });
    } catch {
      setSyncDisabled(true);
      setSyncNotice(
        "Canvas sync has been paused. Restart `bunx convex dev` so the latest canvas functions are available again.",
      );
    }
  }, [
    ownerUserId,
    syncDisabled,
    syncEnabled,
  ]);

  const queuePositionSync = useCallback(
    (assetId: string, position: { x: number; y: number }) => {
      setLocalPositions((current) => ({
        ...current,
        [assetId]: position,
      }));
      pendingPositionUpdates.current.set(assetId, position);
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        void persistPendingPositions();
      }, 800);
    },
    [persistPendingPositions],
  );

  const handleCanvasPositionChange = useCallback(
    (assetId: string, x: number, y: number) => {
      queuePositionSync(assetId, { x, y });
    },
    [queuePositionSync],
  );

  const handleCanvasBatchPositionChange = useCallback(
    (nextPositions: Array<{ assetId: string; x: number; y: number }>) => {
      setLocalPositions((current) => {
        const next = { ...current };
        for (const position of nextPositions) {
          next[position.assetId] = { x: position.x, y: position.y };
          pendingPositionUpdates.current.set(position.assetId, {
            x: position.x,
            y: position.y,
          });
        }
        return next;
      });
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        void persistPendingPositions();
      }, 800);
    },
    [persistPendingPositions],
  );

  const notice = syncNotice;

  return (
    <div className="relative h-full w-full">
      {notice ? <CanvasNotice message={notice} /> : null}
      <CanvasView
        images={images}
        selectedImageId={selectedImage?.id}
        onImageSelect={onImageSelect}
        positions={positions}
        onPositionChange={syncEnabled ? handleCanvasPositionChange : undefined}
        onBatchPositionChange={syncEnabled ? handleCanvasBatchPositionChange : undefined}
        loading={loading}
      />
    </div>
  );
}

function CanvasModeFallback({
  images,
  selectedImage,
  onImageSelect,
  loading,
  message,
}: {
  images: CanvasImage[];
  selectedImage: SelectedImage | null;
  onImageSelect: (image: SelectedImage) => void;
  loading: boolean;
  message: string;
}) {
  return (
    <div className="relative h-full w-full">
      <CanvasNotice message={message} />
      <CanvasView
        images={images}
        selectedImageId={selectedImage?.id}
        onImageSelect={onImageSelect}
        loading={loading}
      />
    </div>
  );
}

function CanvasNotice({ message }: { message: string }) {
  return (
    <div
      className="pointer-events-none absolute left-4 top-4 z-20 max-w-[28rem] rounded-[18px] px-4 py-3"
      style={{
        background: "rgba(255, 248, 240, 0.92)",
        border: "1px solid rgba(217, 119, 86, 0.35)",
        boxShadow: "0 18px 40px rgba(44, 24, 12, 0.14)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--v7-font)",
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--v7-coral)",
          marginBottom: "6px",
        }}
      >
        Canvas notice
      </div>
      <p
        style={{
          fontFamily: "var(--v7-font)",
          fontSize: "12px",
          lineHeight: 1.5,
          color: "var(--v7-text-primary)",
        }}
      >
        {message}
      </p>
    </div>
  );
}

class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: CanvasErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
