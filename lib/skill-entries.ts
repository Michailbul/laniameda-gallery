import type { GalleryEntry } from "@/lib/gallery-entries";
import { isCinematographySkill } from "@/lib/cinematography";

// The card shape `skills:listSkills` and `semanticSearch:searchSkills`
// return. Kept structural so both feeds map through one function.
export type SkillCardData = {
  _id: string;
  title: string;
  description?: string;
  excerpt?: string;
  tagNames: string[];
  folderIds?: string[];
  modelNames?: string[];
  stepCount: number;
  isPublic?: boolean;
  isFeatured?: boolean;
  createdAt: number;
  previewImages: Array<{
    id: string;
    kind: "image" | "video";
    url?: string;
    thumbUrl?: string;
    contentType?: string;
    width?: number;
    height?: number;
  }>;
};

// A Skill renders in any masonry grid as one native skill card. Its step
// media rides along as the hover previews.
export const skillCardToEntry = (skill: SkillCardData): GalleryEntry => {
  const previews = skill.previewImages
    .filter((preview) => preview.url || preview.thumbUrl)
    .map((preview) => ({
      id: preview.id,
      galleryItemId: preview.id,
      galleryItemType: "asset" as const,
      src: preview.thumbUrl ?? preview.url ?? "/placeholder.svg",
      fullSrc: preview.url ?? preview.thumbUrl ?? "/placeholder.svg",
      prompt: skill.title,
      width: preview.width,
      height: preview.height,
      kind: preview.kind,
      contentType: preview.contentType,
    }));
  const cover = previews[0];
  return {
    id: skill._id,
    galleryItemId: skill._id,
    galleryItemType: "skill",
    src: cover?.src ?? "/placeholder.svg",
    fullSrc: cover?.fullSrc ?? "/placeholder.svg",
    prompt: skill.title,
    author: isCinematographySkill(skill.tagNames) ? "Cinematography" : "Skill",
    likes: 0,
    // A text-only skill gets a document-shaped tile.
    width: cover?.width ?? 4,
    height: cover?.height ?? 5,
    kind: cover?.kind,
    contentType: cover?.contentType,
    description: skill.description,
    excerpt: skill.description?.trim() || skill.excerpt,
    tagNames: skill.tagNames,
    folderIds: skill.folderIds,
    createdAt: skill.createdAt,
    isPublic: skill.isPublic ?? false,
    isFeatured: skill.isFeatured ?? false,
    stepCount: skill.stepCount,
    previewImages: previews,
  };
};
