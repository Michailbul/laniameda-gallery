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
}

interface MasonryGridProps {
  images: GalleryImage[];
  onImageSelect?: (image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  }) => void;
  onImageLoad?: (imageId: string) => void;
}

export function MasonryGrid({
  images,
  onImageSelect,
  onImageLoad,
}: MasonryGridProps) {
  return (
    <div
      className="columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5"
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
          initiallyLoaded={image.initiallyLoaded}
          onLoad={() => onImageLoad?.(image.id)}
          index={index}
        />
      ))}
    </div>
  );
}
