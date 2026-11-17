// Midjourney's own Describe answers, kept for the side panel. When Michael
// runs Describe on midjourney.com (drops an image to describe, or picks
// Describe on a picture), mj-describe-hook.js hands over the image link and
// Midjourney's four descriptions; they are kept (the side panel's Describe tab
// lists them and passes them to the describer as vocabulary). This file also
// puts a prompt from the side panel into this tab's Imagine bar. It shows no
// card of its own: the "Make it ours" pill and card are gone (Michael,
// 17 Nov 2026: "remove that feature, not needed"). Nothing is submitted.

(function registerMjDescribe(globalScope) {
  if (typeof document === "undefined" || !/(^|\.)midjourney\.com$/i.test(location.hostname)) return;
  if (globalScope.__saveToGalleryMjDescribe) return;
  globalScope.__saveToGalleryMjDescribe = true;
  const core = () => globalScope.SaveToGalleryDescribe;

  // Older copies left a "Make it ours" pill and card on the page: remove them.
  document.querySelectorAll("#stg-describe, #stg-describe-retire").forEach((node) => node.remove());

  function findTextarea() {
    return [...document.querySelectorAll("textarea")].find((area) => /imagine/i.test(area.getAttribute("placeholder") || "")) || null;
  }
  function writeBar(text) {
    const area = findTextarea();
    if (!area) return { ok: false, error: "No Imagine bar on this page. Open Create." };
    const previous = area.value;
    globalScope.SaveToGalleryMoodboardDock?.holdSticky?.();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(area, text); else area.value = text;
    const tracker = area._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
    area.focus();
    area.setSelectionRange(text.length, text.length);
    return { ok: true, label: "In the bar ✓" };
  }

  // ── Describes from the page hook ──

  let latest = null;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "stg-mj-describe" || !Array.isArray(data.descriptions) || !data.imageUrl) return;
    const entry = { imageUrl: String(data.imageUrl), descriptions: data.descriptions.map(String).slice(0, 4), aspect: data.aspect || null, pageUrl: location.href };
    void core()?.rememberDescribe(entry);
    if (!data.quiet) latest = entry;
  });

  // The side panel's Describe tab puts a prompt in this tab's bar.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || sender.id !== chrome.runtime.id || sender.tab) return false;
      if (message.action === "mjDescribePutInBar") { sendResponse(writeBar(String(message.text || ""))); return false; }
      if (message.action === "mjDescribePing") { sendResponse({ ok: true, bar: Boolean(findTextarea()) }); return false; }
      return false;
    });
  } catch { /* extension reloaded */ }

  globalScope.SaveToGalleryMjDescribe = { latest: () => latest };
})(typeof globalThis !== "undefined" ? globalThis : self);
