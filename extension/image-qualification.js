(function registerImageQualification(globalScope) {
  // Tuned to skip icons, favicons, sprites, avatars, and small thumbnails so the
  // Save badge only appears on real content images. Both the intrinsic (source)
  // and on-screen (rendered) edges must clear these floors.
  const MIN_SOURCE_EDGE = 200;
  const MIN_RENDERED_EDGE = 110;

  function toFiniteNumber(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function getRenderedSize(img) {
    const rect = typeof img.getBoundingClientRect === "function"
      ? img.getBoundingClientRect()
      : null;

    return {
      width: Math.max(
        toFiniteNumber(rect?.width),
        toFiniteNumber(img.clientWidth),
        toFiniteNumber(img.offsetWidth),
        toFiniteNumber(img.width),
      ),
      height: Math.max(
        toFiniteNumber(rect?.height),
        toFiniteNumber(img.clientHeight),
        toFiniteNumber(img.offsetHeight),
        toFiniteNumber(img.height),
      ),
    };
  }

  function getSourceSize(img) {
    return {
      width: Math.max(
        toFiniteNumber(img.naturalWidth),
        toFiniteNumber(img.width),
        toFiniteNumber(img.offsetWidth),
      ),
      height: Math.max(
        toFiniteNumber(img.naturalHeight),
        toFiniteNumber(img.height),
        toFiniteNumber(img.offsetHeight),
      ),
    };
  }

  function isQualifiedImageElement(img, options = {}) {
    const badgeAttr = options.badgeAttr ?? "data-stg-badge";
    if (typeof img.hasAttribute === "function" && img.hasAttribute(badgeAttr)) return false;

    const sourceSize = getSourceSize(img);
    if (sourceSize.width < MIN_SOURCE_EDGE || sourceSize.height < MIN_SOURCE_EDGE) return false;

    const renderedSize = getRenderedSize(img);
    if (renderedSize.width < MIN_RENDERED_EDGE || renderedSize.height < MIN_RENDERED_EDGE) {
      return false;
    }

    const imageUrl = options.getImageUrl?.(img) ?? img.currentSrc ?? img.src ?? "";
    if (
      !imageUrl ||
      imageUrl.startsWith("data:image/gif") ||
      imageUrl.includes("spacer") ||
      imageUrl.includes("pixel.")
    ) {
      return false;
    }

    return true;
  }

  globalScope.SaveToGalleryImageQualification = {
    MIN_SOURCE_EDGE,
    MIN_RENDERED_EDGE,
    getRenderedSize,
    getSourceSize,
    isQualifiedImageElement,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
