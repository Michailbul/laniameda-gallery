export type AspectRatio = "portrait" | "landscape" | "square" | "tall" | "wide";

export const resolveAspectRatio = (
  width?: number,
  height?: number,
): AspectRatio => {
  if (!width || !height) return "square";
  const ratio = width / height;
  if (ratio >= 1.6) return "wide";
  if (ratio >= 1.2) return "landscape";
  if (ratio <= 0.6) return "tall";
  if (ratio <= 0.85) return "portrait";
  return "square";
};
