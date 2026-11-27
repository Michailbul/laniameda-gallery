import { createRoot } from "react-dom/client";
import { buildGalleryEntries } from "../../../lib/gallery-entries";
import { MasonryGrid } from "../../../components/masonry-grid";

// Four square packs in two columns. The server makes the same WebP
// renditions as the gallery from the checked-in world artwork.
const assets = Array.from({ length: 24 }, (_, i) => ({
  _id: String(i),
  assetPackId: String(Math.floor(i / 6)),
  packSlotIndex: i % 6,
  createdAt: 24 - i,
  kind: "image",
  promptText: `Frame ${i + 1}`,
  width: 1440,
  height: 1440,
  url: `/frames/${i}/1440.webp`,
  thumbUrl: `/frames/${i}/960.webp`,
  thumbWidth: 960,
  thumbHeight: 960,
  thumbVariants: [{ url: `/frames/${i}/480.webp`, width: 480, height: 480 }],
}));
const images = buildGalleryEntries({ assets, sortOrder: "newest" });
createRoot(document.getElementById("grid")).render(<MasonryGrid images={images} />);
