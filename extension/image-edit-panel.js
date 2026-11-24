(function imageEditPanel(scope) {
  const root = document.getElementById("imageEditRoot");
  scope.SaveToGalleryImageEditPanel = {
    setVisible(visible) {
      if (!root) return;
      root.hidden = !visible;
      if (visible && !root.firstChild) {
        const frame = document.createElement("iframe");
        frame.src = "image-edit.html"; frame.title = "Image editing threads";
        frame.style.cssText = "border:0;width:100%;height:calc(100vh - 110px);display:block";
        root.appendChild(frame);
      }
      root.querySelector("iframe")?.contentWindow?.postMessage({ type: "image-edit-visible", visible }, location.origin);
    },
  };
})(globalThis);
