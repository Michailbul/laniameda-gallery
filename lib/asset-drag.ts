/**
 * Shared contract for dragging gallery assets onto drop targets (e.g. sidebar
 * collections). Uses a custom MIME type so file-upload dropzones and other
 * drag consumers can ignore internal asset drags — and vice versa.
 */

export const ASSET_DRAG_MIME = "application/x-laniameda-assets";

type AssetDragPayload = {
  assetIds: string[];
};

export function writeAssetDragPayload(
  dataTransfer: DataTransfer,
  assetIds: string[],
): void {
  const payload: AssetDragPayload = { assetIds };
  dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "move";
}

export function hasAssetDragPayload(dataTransfer: DataTransfer): boolean {
  // During dragover only the type list is readable, not the data itself.
  return Array.from(dataTransfer.types).includes(ASSET_DRAG_MIME);
}

export function readAssetDragPayload(dataTransfer: DataTransfer): string[] {
  try {
    const raw = dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<AssetDragPayload>;
    if (!Array.isArray(parsed.assetIds)) return [];
    return parsed.assetIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}
