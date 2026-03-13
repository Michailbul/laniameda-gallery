"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  BackgroundVariant,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CanvasImageNode, type CanvasImageNodeData } from "./canvas-image-node";
import { RotateCcw } from "lucide-react";

/* ── Types ────────────────────────────────────────── */

export interface CanvasImage {
  id: string;
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
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
}

interface CanvasViewProps {
  images: CanvasImage[];
  selectedImageId?: string;
  onImageSelect?: (image: {
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
  }) => void;
  positions?: Map<string, { x: number; y: number }>;
  onPositionChange?: (assetId: string, x: number, y: number) => void;
  onBatchPositionChange?: (
    positions: Array<{ assetId: string; x: number; y: number }>,
  ) => void;
  loading?: boolean;
}

type ImageFlowNode = Node<CanvasImageNodeData>;

/* ── Constants ────────────────────────────────────── */

const NODE_WIDTH = 200;
const GAP_X = 24;
const GAP_Y = 24;
const DEFAULT_COLUMNS = 6;

const nodeTypes = {
  imageNode: CanvasImageNode,
};

/* ── Auto-layout: masonry-style column placement ── */

function computeGridLayout(
  images: CanvasImage[],
  columns: number = DEFAULT_COLUMNS,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const columnHeights = new Array(columns).fill(0);

  for (const image of images) {
    const col = columnHeights.indexOf(Math.min(...columnHeights));
    const x = col * (NODE_WIDTH + GAP_X);
    const y = columnHeights[col];

    const aspectRatio =
      image.width && image.height ? image.width / image.height : 1;
    const nodeHeight = Math.round(NODE_WIDTH / aspectRatio);

    columnHeights[col] = y + nodeHeight + GAP_Y;
    positions.set(image.id, { x, y });
  }

  return positions;
}

/* ── Component ────────────────────────────────────── */

export function CanvasView({
  images,
  selectedImageId,
  onImageSelect,
  positions: savedPositions,
  onPositionChange,
  onBatchPositionChange,
  loading,
}: CanvasViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ImageFlowNode>([]);
  const initializedRef = useRef(false);
  const prevImageIdsRef = useRef<string>("");

  /* Build nodes from images + positions */
  const buildNodes = useCallback(
    (
      imgs: CanvasImage[],
      posMap?: Map<string, { x: number; y: number }>,
    ): ImageFlowNode[] => {
      const autoLayout = computeGridLayout(imgs);

      return imgs.map((img) => {
        const saved = posMap?.get(img.id);
        const auto = autoLayout.get(img.id)!;
        const pos = saved ?? auto;

        return {
          id: img.id,
          type: "imageNode" as const,
          position: { x: pos.x, y: pos.y },
          data: {
            imageId: img.id,
            src: img.src,
            fullSrc: img.fullSrc,
            prompt: img.prompt,
            width: img.width,
            height: img.height,
            modelName: img.modelName,
            pillar: img.pillar,
            tagNames: img.tagNames,
            sourceUrl: img.sourceUrl,
            createdAt: img.createdAt,
            folderId: img.folderId,
            isPublic: img.isPublic,
            isFeatured: img.isFeatured,
          },
          selected: img.id === selectedImageId,
        };
      });
    },
    [selectedImageId],
  );

  /* Initialize and sync nodes when images change */
  useEffect(() => {
    const currentIds = images.map((i) => i.id).join(",");
    if (currentIds === prevImageIdsRef.current && initializedRef.current) {
      return;
    }
    prevImageIdsRef.current = currentIds;
    initializedRef.current = true;
    setNodes(buildNodes(images, savedPositions));
  }, [images, savedPositions, buildNodes, setNodes]);

  /* Update selection highlight */
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === selectedImageId,
      })),
    );
  }, [selectedImageId, setNodes]);

  /* Drag end → persist position */
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: ImageFlowNode) => {
      onPositionChange?.(node.id, node.position.x, node.position.y);
    },
    [onPositionChange],
  );

  /* Click → open detail panel */
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: ImageFlowNode) => {
      const img = images.find((i) => i.id === node.id);
      if (!img) return;
      onImageSelect?.({
        id: img.id,
        thumbSrc: img.src,
        fullSrc: img.fullSrc,
        prompt: img.prompt,
        width: img.width,
        height: img.height,
        modelName: img.modelName,
        pillar: img.pillar,
        tagNames: img.tagNames,
        sourceUrl: img.sourceUrl,
        createdAt: img.createdAt,
        folderId: img.folderId,
        isPublic: img.isPublic,
        isFeatured: img.isFeatured,
      });
    },
    [images, onImageSelect],
  );

  /* Reset layout */
  const [fitViewFn, setFitViewFn] = useState<(() => void) | null>(null);

  const handleResetLayout = useCallback(() => {
    const autoLayout = computeGridLayout(images);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        position: autoLayout.get(n.id) ?? n.position,
      })),
    );
    if (onBatchPositionChange) {
      const batch = Array.from(autoLayout.entries()).map(
        ([assetId, pos]) => ({ assetId, x: pos.x, y: pos.y }),
      );
      onBatchPositionChange(batch);
    }
    fitViewFn?.();
  }, [images, setNodes, onBatchPositionChange, fitViewFn]);

  /* MiniMap node color */
  const miniMapNodeColor = useCallback(() => {
    return "var(--coral, #D97756)";
  }, []);

  if (loading && images.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center"
        style={{ color: "var(--text-ghost)" }}
      >
        <span className="text-sm font-mono">Loading canvas...</span>
      </div>
    );
  }

  return (
    <div className="canvas-wrapper relative h-full w-full">
      <ReactFlow<ImageFlowNode>
        nodes={nodes}
        edges={[]}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        selectionOnDrag={false}
        selectNodesOnDrag={false}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          setFitViewFn(() => () => instance.fitView({ padding: 0.2 }));
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--text-ghost)"
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          maskColor="rgba(0,0,0,0.08)"
          position="bottom-right"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Reset layout button */}
      <button
        type="button"
        onClick={handleResetLayout}
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider transition-all duration-150 hover:scale-[1.02]"
        style={{
          backgroundColor: "var(--paper)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <RotateCcw className="h-3 w-3" />
        Reset Layout
      </button>
    </div>
  );
}
