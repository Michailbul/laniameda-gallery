// Topaz Image API: the one call the gallery makes, shared by the Convex
// action (convex/heroRendition.ts) and the agent script
// (scripts/upscale-hero.ts). Synchronous enhance: the response is the image.

export const TOPAZ_ENHANCE_URL = "https://api.topazlabs.com/image/v1/enhance";
export const TOPAZ_HERO_MODEL = "Standard V2";
/** A hero frame's renditions: 5120 for large and retina screens, 2560 between. */
export const HERO_RENDITION_WIDTH = 5120;
export const HERO_RENDITION_STEP_WIDTH = 2560;

/** The key has no credits left (or is refused): try the next key. */
export class TopazKeyError extends Error {}

export async function topazEnhance({
  apiKey,
  image,
  fileName = "frame.png",
  outputWidth = HERO_RENDITION_WIDTH,
  model = TOPAZ_HERO_MODEL,
}: {
  apiKey: string;
  image: Blob;
  fileName?: string;
  outputWidth?: number;
  model?: string;
}): Promise<Blob> {
  const form = new FormData();
  form.append("image", image, fileName);
  form.append("model", model);
  form.append("output_width", String(outputWidth));
  form.append("output_format", "jpeg");
  const response = await fetch(TOPAZ_ENHANCE_URL, {
    method: "POST",
    headers: { "X-API-Key": apiKey, accept: "image/jpeg" },
    body: form,
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/")) {
    const text = (await response.text()).slice(0, 400);
    if ([401, 402, 403].includes(response.status) || /credit|quota|balance/i.test(text)) {
      throw new TopazKeyError(`Topaz refused the key (${response.status}): ${text}`);
    }
    throw new Error(`Topaz enhance failed (${response.status}): ${text}`);
  }
  return await response.blob();
}
