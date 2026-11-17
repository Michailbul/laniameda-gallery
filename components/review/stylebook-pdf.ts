"use client";

import { thumbAtLeast, type Thumb } from "@/lib/review-client";

// The style book as a real PDF (Michael, 15 Nov 2026: "a tool for making it
// in PDF, no margins, images are occupying 90%"). Browser Print embedded the
// WebP thumbnails losslessly (about 110 MB for 403 frames), so the book is
// built here instead: every frame drawn into a canvas, compressed to JPEG at
// the size its cell needs, and placed with pdf-lib, page by page.
//
// A page is full-bleed: an even grid of 16:9 cells edge to edge with
// hairline gaps fills the full width and 90 % of the height, and a thin
// strip on top (the other 10 %) carries the style's name, its frame count,
// the style's own page number and, for the owner, its one-line look on the
// style's first page. 16:9 cells filling the width make the grid itself
// 16:9, so the strip makes the page 16:10: a 16:9 page could only hold the
// strip by cropping every frame or leaving side margins.
//
// R2's public address sends no CORS headers for the review's addresses, so
// thumbnails come through the review's own download route (?thumb=<key>);
// full URLs (frames without an R2 copy) are fetched directly and skipped if
// the browser may not read them.

export type PdfFrame = { assetId: string; code: string; thumbs: Thumb[]; width: number; height: number };
export type PdfStyle = { key: string; title: string; line?: string; frames: PdfFrame[] };
export type PerPage = 1 | 4 | 9;

export type PdfJob = {
  project: string;
  round: string;
  perPage: PerPage;
  styles: PdfStyle[];
  /** The review's address ("/cassandra", "/review/cassandra-test"). */
  base: string;
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
};

export type PdfResult = { blob: Blob; pages: number; frames: number; skipped: number };

// Page geometry in points (1 pt = 1 px at 100 %).
const PAGE_W = 1920;
const PAGE_H = 1200;
const GAP = 2;
const PAD = 44;

// Obsidian ground, Linen text at three opacities (the board look).
const GROUND = { r: 10 / 255, g: 8 / 255, b: 5 / 255 };
const CELL = { r: 21 / 255, g: 16 / 255, b: 13 / 255 };
const INK = "255, 244, 234";

const STRIP_SCALE = 2;
const PARALLEL = 6;

/** Layout of one page: n × n cells, the strip takes what the grid leaves. */
export const pageLayout = (perPage: PerPage) => {
  const n = Math.round(Math.sqrt(perPage));
  const cellW = (PAGE_W - (n - 1) * GAP) / n;
  const cellH = (cellW * 9) / 16;
  const gridH = n * cellH + (n - 1) * GAP;
  return { n, cellW, cellH, gridH, stripH: PAGE_H - gridH };
};

export const pageCount = (styles: PdfStyle[], perPage: PerPage) =>
  styles.reduce((sum, style) => sum + Math.max(1, Math.ceil(style.frames.length / perPage)), 0);

const fileSlug = (value: string, keep = "") =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(new RegExp(`[^a-z0-9${keep}]+`, "g"), "-")
    .replace(/^-+|-+$/g, "");

/** cassandra-style-book-v0.2.pdf (the round keeps its dot), plus the style when it is one. */
export const pdfFileName = (project: string, round: string, style?: string, kind = "style-book") =>
  [fileSlug(project) || "review", style && !kind ? fileSlug(style) : kind, fileSlug(round, "."), style && kind ? fileSlug(style) : ""].filter(Boolean).join("-") + ".pdf";

// ------------------------------------------------------------ images

type Encoded = { bytes: Uint8Array; w: number; h: number; contain: boolean } | null;

const makeCanvas = (w: number, h: number) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

const canvasBlob = async (canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number) => {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))), type, quality),
  );
};

const fetchImage = async (src: string, job: PdfJob) => {
  // An R2 key goes through the review's own route (same address, so the canvas may read it).
  const url = /^https?:\/\//.test(src) ? src : `${job.base}/api/download?thumb=${encodeURIComponent(src)}`;
  const response = await fetch(url, { signal: job.signal, credentials: "same-origin", mode: /^https?:\/\//.test(src) ? "cors" : "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.blob();
};

/**
 * One frame as a JPEG for its cell: the stored thumbnail that covers the
 * cell (the largest for one frame per page), drawn at the cell's size. Frames
 * close to 16:9 fill the cell (at most a sliver cropped); any other shape
 * (portraits) is fitted whole inside it, never cropped.
 */
const encodeFrame = async (frame: PdfFrame, job: PdfJob): Promise<Encoded> => {
  const { cellW, cellH } = pageLayout(job.perPage);
  const thumb = job.perPage === 1 ? thumbAtLeast(frame.thumbs, 100000) : thumbAtLeast(frame.thumbs, Math.round(cellW));
  if (!thumb) return null;
  try {
    const blob = await fetchImage(thumb.src, job);
    const bitmap = await createImageBitmap(blob);
    try {
      const ratio = bitmap.width / Math.max(1, bitmap.height);
      const cellRatio = cellW / cellH;
      const contain = Math.abs(ratio - cellRatio) / cellRatio > 0.06;
      // Pixels: the size the frame takes on the page (1 pt = 1 px), never
      // more than the thumbnail has.
      let sx = 0;
      let sy = 0;
      let sw = bitmap.width;
      let sh = bitmap.height;
      let w: number;
      let h: number;
      if (contain) {
        const fit = Math.min(1, cellW / bitmap.width, cellH / bitmap.height);
        w = Math.max(1, Math.round(bitmap.width * fit));
        h = Math.max(1, Math.round(bitmap.height * fit));
      } else {
        if (ratio > cellRatio) {
          sw = bitmap.height * cellRatio;
          sx = (bitmap.width - sw) / 2;
        } else {
          sh = bitmap.width / cellRatio;
          sy = (bitmap.height - sh) / 2;
        }
        const scale = Math.min(1, sw / cellW);
        w = Math.max(1, Math.round(cellW * scale));
        h = Math.max(1, Math.round(cellH * scale));
      }
      const canvas = makeCanvas(w, h);
      const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      const quality = job.perPage === 1 ? 0.84 : job.perPage === 4 ? 0.78 : 0.76;
      const jpeg = await canvasBlob(canvas, "image/jpeg", quality);
      return { bytes: new Uint8Array(await jpeg.arrayBuffer()), w, h, contain };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (job.signal.aborted) throw error;
    return null;
  }
};

// ------------------------------------------------------------ the strip

type Fonts = { sans: string; mono: string };

const readFonts = async (): Promise<Fonts> => {
  const root = document.querySelector(".rv") ?? document.body;
  const style = getComputedStyle(root);
  const sans = style.getPropertyValue("--sans").trim() || "Inter, system-ui, sans-serif";
  const mono = style.getPropertyValue("--mono").trim() || "ui-monospace, Menlo, monospace";
  // The mono face loads lazily on the page; ask for both before drawing.
  await Promise.allSettled([document.fonts.load(`800 30px ${sans}`, "A"), document.fonts.load(`500 14px ${sans}`, "a"), document.fonts.load(`500 14px ${mono}`, "0")]);
  return { sans, mono };
};

const ellipsize = (context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, max: number) => {
  if (context.measureText(text).width <= max) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= max) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
};

const setSpacing = (context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, px: number) => {
  if ("letterSpacing" in context) (context as { letterSpacing: string }).letterSpacing = `${px}px`;
};

/** The strip on top of a page, as a PNG: the page's own fonts, crisp at 2×. */
const drawStrip = async (
  fonts: Fonts,
  stripH: number,
  parts: { title: string; count: number; line?: string; page: number; pages: number; project: string; round: string },
) => {
  const s = STRIP_SCALE;
  const canvas = makeCanvas(Math.round(PAGE_W * s), Math.round(stripH * s));
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.fillStyle = "#0a0805";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "alphabetic";

  const line = parts.line?.trim();
  const baseline = (line ? stripH * 0.47 : stripH * 0.6) * s;

  // Right: project · round, then the style's page number.
  context.textAlign = "right";
  context.font = `500 ${15 * s}px ${fonts.mono}`;
  setSpacing(context, 1.2 * s);
  context.fillStyle = `rgba(${INK}, 0.62)`;
  const pageText = `${parts.page} / ${parts.pages}`;
  context.fillText(pageText, (PAGE_W - PAD) * s, baseline);
  const pageW = context.measureText(pageText).width;
  context.font = `500 ${12 * s}px ${fonts.mono}`;
  setSpacing(context, 1.8 * s);
  context.fillStyle = `rgba(${INK}, 0.38)`;
  const where = `${parts.project} · ${parts.round}`.toUpperCase();
  context.fillText(where, (PAGE_W - PAD) * s - pageW - 28 * s, baseline);
  const rightW = pageW + 28 * s + context.measureText(where).width;

  // Left: the style, then its frame count.
  context.textAlign = "left";
  context.font = `800 ${30 * s}px ${fonts.sans}`;
  setSpacing(context, 1.6 * s);
  context.fillStyle = `rgb(${INK})`;
  const maxTitle = PAGE_W * s - PAD * 2 * s - rightW - 220 * s;
  const title = ellipsize(context, parts.title.toUpperCase(), maxTitle);
  context.fillText(title, PAD * s, baseline);
  const titleW = context.measureText(title).width;
  context.font = `500 ${13 * s}px ${fonts.mono}`;
  setSpacing(context, 1.6 * s);
  context.fillStyle = `rgba(${INK}, 0.38)`;
  context.fillText(`${parts.count} ${parts.count === 1 ? "FRAME" : "FRAMES"}`, PAD * s + titleW + 20 * s, baseline);

  // The owner's one-line look, on the style's first page.
  if (line) {
    context.font = `500 ${16 * s}px ${fonts.sans}`;
    setSpacing(context, 0);
    context.fillStyle = `rgba(${INK}, 0.62)`;
    context.fillText(ellipsize(context, line, PAGE_W * s - PAD * 2 * s - rightW - 40 * s), PAD * s, baseline + 34 * s);
  }

  const png = await canvasBlob(canvas, "image/png");
  return new Uint8Array(await png.arrayBuffer());
};

// ------------------------------------------------------------ the book

export async function buildStyleBookPdf(job: PdfJob): Promise<PdfResult> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fonts = await readFonts();
  const layout = pageLayout(job.perPage);
  const doc = await PDFDocument.create();
  doc.setTitle(`${job.project} · Style book · ${job.round}`);
  doc.setCreator("laniameda.gallery");
  doc.setProducer("laniameda.gallery");

  const frames = job.styles.flatMap((style) => style.frames);
  const total = frames.length;
  let done = 0;
  let skipped = 0;
  job.onProgress(0, total);

  // Encode a few frames ahead, place them in book order.
  const encoded = new Map<number, Promise<Encoded>>();
  let next = 0;
  const fill = () => {
    while (next < total && encoded.size < PARALLEL) {
      const at = next;
      encoded.set(at, encodeFrame(frames[at]!, job));
      next += 1;
    }
  };

  let index = 0;
  let pages = 0;
  for (const style of job.styles) {
    const stylePages = Math.max(1, Math.ceil(style.frames.length / job.perPage));
    for (let p = 0; p < stylePages; p += 1) {
      if (job.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const page = doc.addPage([PAGE_W, PAGE_H]);
      pages += 1;
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(GROUND.r, GROUND.g, GROUND.b) });
      const strip = await drawStrip(fonts, layout.stripH, {
        title: style.title,
        count: style.frames.length,
        line: p === 0 ? style.line : undefined,
        page: p + 1,
        pages: stylePages,
        project: job.project,
        round: job.round,
      });
      const stripImage = await doc.embedPng(strip);
      // pdf-lib compresses a PNG only when it is embedded; doing it now, page
      // by page, keeps that work from freezing the page all at once on save.
      await stripImage.embed();
      page.drawImage(stripImage, { x: 0, y: PAGE_H - layout.stripH, width: PAGE_W, height: layout.stripH });

      const slice = style.frames.slice(p * job.perPage, (p + 1) * job.perPage);
      for (let cell = 0; cell < slice.length; cell += 1) {
        fill();
        const result = await encoded.get(index)!;
        encoded.delete(index);
        index += 1;
        fill();
        const col = cell % layout.n;
        const row = Math.floor(cell / layout.n);
        const x = col * (layout.cellW + GAP);
        const top = PAGE_H - layout.stripH - row * (layout.cellH + GAP);
        const y = top - layout.cellH;
        if (!result) {
          skipped += 1;
          page.drawRectangle({ x, y, width: layout.cellW, height: layout.cellH, color: rgb(CELL.r, CELL.g, CELL.b) });
        } else {
          const image = await doc.embedJpg(result.bytes);
          await image.embed();
          if (result.contain) {
            page.drawRectangle({ x, y, width: layout.cellW, height: layout.cellH, color: rgb(CELL.r, CELL.g, CELL.b) });
            const fit = Math.min(layout.cellW / result.w, layout.cellH / result.h);
            const w = result.w * fit;
            const h = result.h * fit;
            page.drawImage(image, { x: x + (layout.cellW - w) / 2, y: y + (layout.cellH - h) / 2, width: w, height: h });
          } else {
            page.drawImage(image, { x, y, width: layout.cellW, height: layout.cellH });
          }
        }
        done += 1;
        job.onProgress(done, total);
      }
    }
  }

  // Saving yields to the page every few objects, so it stays responsive.
  const bytes = await doc.save({ objectsPerTick: 40 });
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  return { blob, pages, frames: total - skipped, skipped };
}

export const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

