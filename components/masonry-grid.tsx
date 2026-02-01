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
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  }) => void;
  onImageLoad?: (imageId: string) => void;
}

export function MasonryGrid({ images, onImageSelect, onImageLoad }: MasonryGridProps) {
  return (
    <div className="px-4 pb-8">
      <div
        className="columns-2 gap-0 sm:columns-3 md:columns-4 lg:columns-5"
        style={{
          columnGap: 0,
          columnFill: "auto",
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
          />
        ))}
      </div>
    </div>
  );
}
