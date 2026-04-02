import type { Infer } from "convex/values";

import {
  designCaptureKindValidator,
  designInspirationTypeValidator,
  designSaveIntentValidator,
} from "./validators";

type DesignCaptureKind = Infer<typeof designCaptureKindValidator>;
type DesignInspirationType = Infer<typeof designInspirationTypeValidator>;
type DesignSaveIntent = Infer<typeof designSaveIntentValidator>;

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "si",
  "spm",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_name",
  "utm_source",
  "utm_term",
]);

export const trimOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const buildDesignSearchText = (values: Array<string | undefined>) =>
  values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .join(" ");

export const parseSourceDomain = (sourceUrl?: string) => {
  const normalized = trimOptionalText(sourceUrl);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

export const normalizeSourceUrl = (sourceUrl?: string | null) => {
  const normalized = trimOptionalText(sourceUrl);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }

    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      if (!parsed.pathname) {
        parsed.pathname = "/";
      }
    }

    return parsed.toString();
  } catch {
    return normalized;
  }
};

export const resolveDesignInspirationType = (
  captureKind?: DesignCaptureKind,
  inspirationType?: DesignInspirationType,
) => {
  if (inspirationType) {
    return inspirationType;
  }

  switch (captureKind) {
    case "component":
      return "component";
    case "website":
    case "tutorial":
      return "website";
    case "image":
    default:
      return "other";
  }
};

export const resolveDesignSaveIntent = (
  captureKind?: DesignCaptureKind,
  saveIntent?: DesignSaveIntent,
) => {
  if (saveIntent) {
    return saveIntent;
  }

  switch (captureKind) {
    case "component":
      return "component";
    case "tutorial":
      return "tutorial";
    case "website":
      return "utility";
    case "image":
    default:
      return "inspiration";
  }
};

export const buildDesignSourceFingerprint = (args: {
  captureKind?: DesignCaptureKind;
  sourceUrl?: string;
  imageUrl?: string;
}) => {
  const normalizedSourceUrl = normalizeSourceUrl(args.sourceUrl);
  const normalizedImageUrl = normalizeSourceUrl(args.imageUrl);

  if (normalizedImageUrl) {
    return normalizedSourceUrl
      ? `image:${normalizedImageUrl}::source:${normalizedSourceUrl}`
      : `image:${normalizedImageUrl}`;
  }

  if (normalizedSourceUrl) {
    return `${args.captureKind ?? "website"}:${normalizedSourceUrl}`;
  }

  return undefined;
};
