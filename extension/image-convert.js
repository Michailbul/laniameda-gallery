// Shared by the content script and the service worker: re-encode captured
// image bytes before they are uploaded.
//
// Midjourney (and most modern CDNs) serve WebP. Storing those bytes verbatim
// left the gallery holding .webp files — a format the ingest decoder can't
// read (no dimensions, so the masonry falls back to a 1:1 square) and that
// lands as a .webp on disk when the piece is downloaded later. The browser
// already has a WebP decoder, so the conversion happens here, at capture time.
// Midjourney asks for PNG specifically; other CDN captures default to JPEG.
//
// PNG is left alone on purpose: JPEG has no alpha, and a transparent asset
// would come back flattened. GIF keeps its animation for the same reason.
(function () {
  "use strict";

  const JPEG_QUALITY = 0.94;
  const PNG_CONTENT_TYPE = "image/png";

  // Formats re-encoded on capture. Everything else is stored as-is.
  const CONVERTIBLE_TYPES = new Set([
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
  ]);

  const normalizeType = (contentType) =>
    String(contentType || "").split(";")[0].trim().toLowerCase();

  function shouldConvertToJpeg(contentType) {
    return CONVERTIBLE_TYPES.has(normalizeType(contentType));
  }

  function shouldConvertToPng(contentType) {
    const sourceType = normalizeType(contentType);
    return sourceType.startsWith("image/") &&
      sourceType !== PNG_CONTENT_TYPE &&
      sourceType !== "image/gif" &&
      sourceType !== "image/svg+xml";
  }

  async function hasPngSignature(blob) {
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return signature.length === 8 &&
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a;
  }

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return null;
  }

  function canvasToImageBlob(canvas, targetContentType) {
    const quality = targetContentType === "image/jpeg" ? JPEG_QUALITY : undefined;
    if (typeof canvas.convertToBlob === "function") {
      return canvas.convertToBlob({ type: targetContentType, quality });
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))),
        targetContentType,
        quality,
      );
    });
  }

  async function blobToImageBlob(blob, targetContentType) {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = createCanvas(bitmap.width, bitmap.height);
      if (!canvas) throw new Error("No canvas available for conversion.");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      if (targetContentType === "image/jpeg") {
        // JPEG has no alpha channel — flatten onto white rather than black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap, 0, 0);
      return await canvasToImageBlob(canvas, targetContentType);
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  }

  function blobToJpegBlob(blob) {
    return blobToImageBlob(blob, "image/jpeg");
  }

  /**
   * Convert a captured blob to the requested storage format. Midjourney uses
   * PNG; other convertible CDN formats default to JPEG. Returns the original
   * blob when no conversion is needed, and also when conversion fails, so a
   * decode error never loses the save.
   */
  async function convertCapturedBlob(blob, contentType, preferredContentType) {
    const sourceType = normalizeType(contentType || blob.type);
    const requestedType = normalizeType(preferredContentType);
    const targetContentType = requestedType === PNG_CONTENT_TYPE
      ? PNG_CONTENT_TYPE
      : "image/jpeg";
    const shouldConvert = targetContentType === PNG_CONTENT_TYPE
      ? shouldConvertToPng(sourceType)
      : shouldConvertToJpeg(sourceType);

    if (!shouldConvert) {
      return { blob, contentType: sourceType || "application/octet-stream", converted: false };
    }
    try {
      const convertedBlob = await blobToImageBlob(blob, targetContentType);
      return { blob: convertedBlob, contentType: targetContentType, converted: true };
    } catch (err) {
      console.warn(`[Save to Gallery] ${targetContentType} conversion failed:`, err);
      return { blob, contentType: sourceType, converted: false };
    }
  }

  // Chunked so a multi-megabyte image doesn't blow the argument limit of
  // String.fromCharCode.apply.
  async function base64FromBlob(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  globalThis.SaveToGalleryImageConvert = {
    shouldConvertToJpeg,
    shouldConvertToPng,
    hasPngSignature,
    blobToJpegBlob,
    blobToImageBlob,
    convertCapturedBlob,
    base64FromBlob,
  };
})();
