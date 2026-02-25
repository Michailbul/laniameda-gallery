"use client";

import { ImageCard } from "./image-card";

interface GalleryImage {
  id: string;
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
  width?: number;
  height?: number;
  initiallyLoaded?: boolean;
  modelName?: string;
}

interface MasonryGridProps {
  images: GalleryImage[];
  compactColumns?: boolean;
  selectedImageId?: string;
  onImageSelect?: (image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    modelName?: string;
  }) => void;
  onImageLoad?: (imageId: string) => void;
}

export function MasonryGrid({
  images,
  compactColumns,
  selectedImageId,
  onImageSelect,
  onImageLoad,
}: MasonryGridProps) {
  const columnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

  return (
    <div
      className={columnClasses}
      style={{
        columnGap: "12px",
        columnFill: "balance",
        padding: "12px",
      }}
    >
      {images.map((image, index) => (
        <ImageCard
          key={image.id}
          image={image}
          eager={index < 12}
          onSelect={onImageSelect}
          selectedId={selectedImageId}
          initiallyLoaded={image.initiallyLoaded}
          onLoad={() => onImageLoad?.(image.id)}
          index={index}
        />
      ))}
    </div>
  );
}
