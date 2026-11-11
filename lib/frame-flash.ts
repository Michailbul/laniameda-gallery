// The short confirmation a key paints on its frame: a ring and one word, gone
// in about a second. Painted straight into the frame's node, so a keypress
// never re-renders the grid to say it worked. Styles: components/frame-composer/frame-flash.css.

export type FlashTone = "coral" | "ember" | "teal" | "ink" | "crimson";

const LIFE_MS = 1300;

export function flashFrame(
  frame: HTMLElement | null | undefined,
  label: string,
  tone: FlashTone = "coral",
) {
  if (!frame || typeof document === "undefined") return;
  frame.querySelector(":scope > .frame-flash")?.remove();
  const flash = document.createElement("span");
  flash.className = "frame-flash";
  flash.dataset.tone = tone;
  flash.setAttribute("aria-hidden", "true");
  const word = document.createElement("span");
  word.textContent = label;
  flash.append(word);
  frame.append(flash);
  window.setTimeout(() => flash.remove(), LIFE_MS);
}

/**
 * The picture's own box inside its frame. An image shown whole
 * (object-fit: contain) is smaller than its element; anything else fills it.
 */
export function pictureRect(frame: HTMLElement): DOMRect {
  const box = frame.getBoundingClientRect();
  const media = frame.matches("img, video")
    ? (frame as HTMLImageElement | HTMLVideoElement)
    : frame.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
  if (!media) return box;
  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!width || !height || getComputedStyle(media).objectFit !== "contain") return box;
  const rect = media.getBoundingClientRect();
  if (!rect.width || !rect.height) return box;
  const scale = Math.min(rect.width / width, rect.height / height);
  const w = width * scale;
  const h = height * scale;
  return new DOMRect(rect.left + (rect.width - w) / 2, rect.top + (rect.height - h) / 2, w, h);
}
