export type SelectableGalleryItemType = "asset" | "pack";

export type SelectableGalleryItem = {
  type: SelectableGalleryItemType;
  id: string;
};

export type DeletableGalleryItem =
  | SelectableGalleryItem
  | {
      type: "workflow";
      id: string;
    };

export const getGallerySelectionKey = (item: SelectableGalleryItem) =>
  `${item.type}:${item.id}`;

export const parseGallerySelectionKey = (
  key: string,
): SelectableGalleryItem | null => {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return null;
  }

  const type = key.slice(0, separatorIndex);
  if (type !== "asset" && type !== "pack") {
    return null;
  }

  return {
    type,
    id: key.slice(separatorIndex + 1),
  };
};
