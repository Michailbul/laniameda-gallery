(function registerEditConsent(scope) {
  "use strict";
  function galleryConsent(text) {
    const words = String(text || "").trim().toLowerCase().replace(/[’']/g, "'");
    if (/\b(?:don't|do not|never|stop|disable|disconnect|no)\b[^.!?\n]{0,45}\bgallery\b|\bgallery\s+(?:access\s+)?off\b/.test(words)) return false;
    if (/\?/.test(words) || /^["'>]/.test(words)) return undefined;
    if (/(?:^|[.!]\s*|\band\s+)(?:(?:please|pls|also|yes)[,\s]+)*(?:(?:use|enable|connect to|read|search|look (?:in|through)|access)\s+(?:(?:my|the|our)\s+)?gallery\b|gallery\s+(?:access\s+)?on\b)/.test(words)) return true;
    return undefined;
  }
  scope.SaveToGalleryEditConsent = { galleryConsent };
})(typeof globalThis !== "undefined" ? globalThis : self);
