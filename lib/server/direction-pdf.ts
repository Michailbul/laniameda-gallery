import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import sharp from "sharp";

/**
 * Server-side "direction package" PDF: a branded, shareable document for one
 * direction (a collection of similar options with a MASTER). Images are
 * embedded (re-encoded to JPEG via sharp — R2 assets are often WebP, which
 * PDF can't hold); videos are listed as clickable links instead.
 */

export type DirectionPdfAsset = {
  id: string;
  kind: "image" | "video";
  url?: string;
  thumbUrl?: string;
  fileName?: string;
  title?: string;
  approved: boolean;
};

export type DirectionPdfInput = {
  projectName: string;
  directionName: string;
  coverAssetId?: string | null;
  assets: DirectionPdfAsset[];
};

/* ── Brand (light/print variant of the warm editorial system) ── */
const PAPER = rgb(1, 0.956, 0.918); // Linen #FFF4EA
const INK = rgb(0.098, 0.098, 0.098); // Carbon #191919
const CORAL = rgb(0.949, 0.38, 0.341); // Coral #F26157
const MUTED = rgb(0.44, 0.4, 0.36);

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const FOOTER_H = 30;

// Keep the document light: long edge cap + JPEG re-encode.
const IMAGE_LONG_EDGE = 1400;
const JPEG_QUALITY = 78;
const FETCH_CONCURRENCY = 6;
const MAX_IMAGES = 120;

// Standard fonts only encode WinAnsi — normalize typographic exotics and
// strip anything else so drawText never throws on a stray glyph.
const safeText = (value: string) =>
  value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E -ÿ]/g, "")
    .trim();

const truncateToWidth = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
) => {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
};

const addLinkAnnotation = (
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const { context } = page.doc;
  const annotation = context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = context.register(annotation);
  const existing = page.node.get(PDFName.of("Annots"));
  if (existing instanceof PDFArray) {
    existing.push(ref);
  } else {
    page.node.set(PDFName.of("Annots"), context.obj([ref]));
  }
};

// Fetch + normalize one image to embeddable JPEG bytes. Returns null on any
// failure — a broken asset should cost one slot, not the whole export.
const fetchJpeg = async (asset: DirectionPdfAsset): Promise<Uint8Array | null> => {
  const url = asset.url ?? asset.thumbUrl;
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return new Uint8Array(
      await sharp(bytes)
        .rotate()
        .resize({
          width: IMAGE_LONG_EDGE,
          height: IMAGE_LONG_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#FFF4EA" })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer(),
    );
  } catch {
    return null;
  }
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

type EmbeddedImage = {
  asset: DirectionPdfAsset;
  image: PDFImage;
  isMaster: boolean;
};

export async function buildDirectionPdf(
  input: DirectionPdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const projectName = safeText(input.projectName) || "Project";
  const directionName = safeText(input.directionName) || "Direction";

  const images = input.assets
    .filter((asset) => asset.kind === "image")
    .slice(0, MAX_IMAGES);
  const videos = input.assets.filter((asset) => asset.kind === "video");

  // Master first — it fronts the cover and leads the variations.
  const masterId = input.coverAssetId ?? images[0]?.id ?? null;
  images.sort((a, b) =>
    a.id === masterId ? -1 : b.id === masterId ? 1 : 0,
  );

  const jpegs = await mapWithConcurrency(images, FETCH_CONCURRENCY, fetchJpeg);
  const embedded: EmbeddedImage[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const bytes = jpegs[i];
    if (!bytes) continue;
    embedded.push({
      asset: images[i]!,
      image: await doc.embedJpg(bytes),
      isMaster: images[i]!.id === masterId,
    });
  }

  const footer = (page: PDFPage, pageNumber: number, pageTotalSlot: string) => {
    page.drawCircle({
      x: MARGIN + 3,
      y: 24 + 3.2,
      size: 3,
      color: CORAL,
    });
    page.drawText(
      truncateToWidth(
        `LANIAMEDA  -  ${projectName} / ${directionName}`,
        sansBold,
        7.5,
        PAGE_W - MARGIN * 2 - 80,
      ),
      { x: MARGIN + 12, y: 24, size: 7.5, font: sansBold, color: MUTED },
    );
    const label = `${pageNumber}${pageTotalSlot}`;
    page.drawText(label, {
      x: PAGE_W - MARGIN - sans.widthOfTextAtSize(label, 7.5),
      y: 24,
      size: 7.5,
      font: sans,
      color: MUTED,
    });
  };

  const newPage = () => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H,
      color: PAPER,
    });
    return page;
  };

  // Contain-fit a drawn image inside a box, centered horizontally, top-aligned.
  const drawContained = (
    page: PDFPage,
    image: PDFImage,
    box: { x: number; y: number; w: number; h: number },
  ) => {
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = box.x + (box.w - w) / 2;
    const y = box.y + box.h - h;
    page.drawImage(image, { x, y, width: w, height: h });
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: INK,
      borderWidth: 1,
      opacity: 0,
      borderOpacity: 0.55,
    });
    return { x, y, w, h };
  };

  const pages: PDFPage[] = [];

  /* ── Cover ── */
  {
    const page = newPage();
    pages.push(page);
    let cursorY = PAGE_H - 64;

    page.drawCircle({ x: MARGIN + 3.5, y: cursorY + 3, size: 3.5, color: CORAL });
    page.drawText("LANIAMEDA", {
      x: MARGIN + 13,
      y: cursorY,
      size: 10,
      font: sansBold,
      color: INK,
    });
    const shared = "DIRECTION PACKAGE";
    page.drawText(shared, {
      x: PAGE_W - MARGIN - sansBold.widthOfTextAtSize(shared, 8),
      y: cursorY + 1,
      size: 8,
      font: sansBold,
      color: MUTED,
    });

    cursorY -= 64;
    page.drawText("DIRECTION", {
      x: MARGIN,
      y: cursorY,
      size: 11,
      font: sansBold,
      color: CORAL,
    });
    cursorY -= 40;
    const titleSize = serif.widthOfTextAtSize(directionName, 40) >
      PAGE_W - MARGIN * 2
      ? 28
      : 40;
    page.drawText(
      truncateToWidth(directionName, serif, titleSize, PAGE_W - MARGIN * 2),
      { x: MARGIN, y: cursorY, size: titleSize, font: serif, color: INK },
    );
    cursorY -= 24;
    const meta = [
      projectName,
      `${embedded.length} ${embedded.length === 1 ? "option" : "options"}`,
      videos.length > 0
        ? `${videos.length} ${videos.length === 1 ? "video" : "videos"}`
        : null,
      new Date().toISOString().slice(0, 10),
    ]
      .filter(Boolean)
      .join("   ·   ");
    page.drawText(safeText(meta), {
      x: MARGIN,
      y: cursorY,
      size: 9.5,
      font: sans,
      color: MUTED,
    });

    // Master hero
    const hero = embedded.find((e) => e.isMaster) ?? embedded[0];
    if (hero) {
      cursorY -= 30;
      const boxTop = cursorY;
      const boxBottom = MARGIN + FOOTER_H + 24;
      const drawn = drawContained(page, hero.image, {
        x: MARGIN,
        y: boxBottom,
        w: PAGE_W - MARGIN * 2,
        h: boxTop - boxBottom,
      });
      // MASTER tag pinned to the image's top-left corner.
      const tag = "MASTER";
      const tagW = sansBold.widthOfTextAtSize(tag, 8) + 12;
      page.drawRectangle({
        x: drawn.x,
        y: drawn.y + drawn.h - 16,
        width: tagW,
        height: 16,
        color: CORAL,
      });
      page.drawText(tag, {
        x: drawn.x + 6,
        y: drawn.y + drawn.h - 11.5,
        size: 8,
        font: sansBold,
        color: PAPER,
      });
    }
  }

  /* ── Variations — 2×2 grid pages ── */
  const variations = embedded.filter((e) => !e.isMaster);
  const COLS = 2;
  const ROWS = 2;
  const GUTTER = 14;
  const gridTop = PAGE_H - 92;
  const gridBottom = MARGIN + FOOTER_H;
  const cellW = (PAGE_W - MARGIN * 2 - GUTTER * (COLS - 1)) / COLS;
  const cellH = (gridTop - gridBottom - GUTTER * (ROWS - 1)) / ROWS;

  for (let start = 0; start < variations.length; start += COLS * ROWS) {
    const page = newPage();
    pages.push(page);
    page.drawText("OPTIONS", {
      x: MARGIN,
      y: PAGE_H - 56,
      size: 10,
      font: sansBold,
      color: CORAL,
    });
    const rangeLabel = `${directionName} - ${start + 1}-${Math.min(
      start + COLS * ROWS,
      variations.length,
    )} of ${variations.length}`;
    page.drawText(
      truncateToWidth(safeText(rangeLabel), sans, 9, PAGE_W - MARGIN * 2 - 70),
      { x: MARGIN + 58, y: PAGE_H - 56, size: 9, font: sans, color: MUTED },
    );

    const batch = variations.slice(start, start + COLS * ROWS);
    batch.forEach((entry, index) => {
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      const boxX = MARGIN + col * (cellW + GUTTER);
      const boxY = gridTop - (row + 1) * cellH - row * GUTTER;
      const drawn = drawContained(page, entry.image, {
        x: boxX,
        y: boxY,
        w: cellW,
        h: cellH - 14,
      });

      // Caption line: index + approved marker.
      const number = String(start + index + 1).padStart(2, "0");
      page.drawText(number, {
        x: drawn.x,
        y: drawn.y - 11,
        size: 7.5,
        font: sansBold,
        color: MUTED,
      });
      if (entry.asset.approved) {
        page.drawCircle({
          x: drawn.x + sansBold.widthOfTextAtSize(number, 7.5) + 8,
          y: drawn.y - 8.5,
          size: 2.4,
          color: CORAL,
        });
        page.drawText("APPROVED", {
          x: drawn.x + sansBold.widthOfTextAtSize(number, 7.5) + 14,
          y: drawn.y - 11,
          size: 7.5,
          font: sansBold,
          color: CORAL,
        });
      }
    });
  }

  /* ── Video links ── */
  if (videos.length > 0) {
    const page = newPage();
    pages.push(page);
    let cursorY = PAGE_H - 92;
    page.drawText("VIDEOS", {
      x: MARGIN,
      y: cursorY,
      size: 11,
      font: sansBold,
      color: CORAL,
    });
    cursorY -= 16;
    page.drawText(
      "Video options are not embedded - open the links to view or download.",
      { x: MARGIN, y: cursorY, size: 9, font: sans, color: MUTED },
    );
    cursorY -= 28;

    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i]!;
      const url = video.url ?? video.thumbUrl;
      if (!url) continue;
      if (cursorY < MARGIN + FOOTER_H + 30) break; // keep V1 to one page

      const name =
        safeText(video.fileName ?? video.title ?? "") ||
        `Video option ${i + 1}`;
      const label = `${String(i + 1).padStart(2, "0")}   ${name}${
        video.approved ? "   · APPROVED" : ""
      }`;
      page.drawText(truncateToWidth(label, sansBold, 10, PAGE_W - MARGIN * 2), {
        x: MARGIN,
        y: cursorY,
        size: 10,
        font: sansBold,
        color: INK,
      });
      cursorY -= 14;
      const shownUrl = truncateToWidth(url, sans, 8.5, PAGE_W - MARGIN * 2);
      page.drawText(shownUrl, {
        x: MARGIN,
        y: cursorY,
        size: 8.5,
        font: sans,
        color: CORAL,
      });
      addLinkAnnotation(
        page,
        url,
        MARGIN,
        cursorY - 3,
        sans.widthOfTextAtSize(shownUrl, 8.5),
        14,
      );
      cursorY -= 26;
    }
  }

  pages.forEach((page, index) => {
    footer(page, index + 1, ` / ${pages.length}`);
  });

  return await doc.save();
}
