// "Make it ours" on midjourney.com. When Michael runs Describe (drops an image
// to describe, or picks Describe on a picture), mj-describe-hook.js hands over
// the image link and Midjourney's four descriptions. They are kept (side
// panel's Describe tab reuses them) and a small pill offers the describer
// card: our prompt from the picture, Midjourney's reading and the world's
// style lock. Put in bar writes the Imagine bar only; nothing is submitted.

(function registerMjDescribe(globalScope) {
  if (typeof document === "undefined" || !/(^|\.)midjourney\.com$/i.test(location.hostname)) return;
  if (globalScope.__saveToGalleryMjDescribe) return;
  globalScope.__saveToGalleryMjDescribe = true;
  const core = () => globalScope.SaveToGalleryDescribe;
  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };

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

  // ── The card (shadow DOM; the newest extension copy's card wins) ──

  const instance = Math.random().toString(36).slice(2, 10);
  let retire = document.getElementById("stg-describe-retire");
  if (!retire) {
    retire = document.createElement("style");
    retire.id = "stg-describe-retire";
    (document.head || document.documentElement).appendChild(retire);
  }
  retire.textContent = `#stg-describe:not([data-stg-instance="${instance}"]){display:none!important}`;
  document.querySelectorAll("#stg-describe").forEach((node) => node.remove());

  const host = document.createElement("div");
  host.id = "stg-describe";
  host.dataset.stgInstance = instance;
  Object.assign(host.style, { position: "fixed", inset: "0 auto auto 0", width: "0", height: "0", zIndex: "2147483645" });
  const shadow = host.attachShadow({ mode: "open" });
  const frame = document.createElement("style");
  frame.textContent = `
    :host{all:initial}
    .pill{position:fixed;right:18px;bottom:112px;display:none;align-items:center;gap:8px;height:34px;padding:0 12px 0 4px;border-radius:999px;cursor:pointer;
      background:#0A0805;color:#FFF4EA;border:1px solid rgba(255,244,234,.2);box-shadow:0 10px 28px rgba(0,0,0,.45);font:800 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;user-select:none}
    .pill:hover{border-color:#F26157}
    .pill img{width:26px;height:26px;border-radius:50%;object-fit:cover;background:#191919}
    .pill i{width:6px;height:6px;border-radius:1px;background:#F26157;display:inline-block}
    .pill .x{margin-left:4px;color:rgba(255,244,234,.45);font:600 13px/1 system-ui}
    .card{position:fixed;right:16px;top:64px;bottom:96px;display:none;flex-direction:column;width:min(400px,calc(100vw - 32px));border-radius:14px;background:#0A0805;
      border:1px solid rgba(255,244,234,.16);box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden}
    .bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,244,234,.1)}
    .bar b{flex:1;font:800 11px/1 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#FFF4EA}
    .bar b i{display:inline-block;width:6px;height:6px;border-radius:1px;background:#F26157;margin-right:7px;vertical-align:1px}
    .bar button{width:24px;height:24px;border:1px solid rgba(255,244,234,.16);border-radius:6px;background:#191919;color:#FFF4EA;cursor:pointer;font:600 12px/1 system-ui}
    .body{overflow:auto;padding:12px}
  `;
  shadow.appendChild(frame);
  const pill = document.createElement("div");
  pill.className = "pill";
  pill.title = "Make Midjourney's describe into our prompt";
  pill.innerHTML = `<img alt=""><i></i>Make it ours<span class="x" title="Hide">×</span>`;
  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Make it ours");
  card.innerHTML = `<div class="bar"><b><i></i>Make it ours</b><button type="button" title="Close (Esc)">×</button></div><div class="body"></div>`;
  shadow.append(pill, card);
  const body = card.querySelector(".body");
  let ui = null;
  let latest = null;

  const mount = () => {
    if (!alive()) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  const ensureUi = () => {
    if (!ui && core()) ui = core().mount(body, { theme: "dark", putInBar: async (text) => writeBar(text) });
    return ui;
  };

  function openCard() {
    if (!latest) return;
    mount();
    ensureUi()?.load(latest);
    pill.style.display = "none";
    card.style.display = "flex";
  }
  function closeCard() {
    card.style.display = "none";
    if (latest) pill.style.display = "flex";
  }

  pill.addEventListener("click", (event) => {
    if (event.target?.classList?.contains("x")) { pill.style.display = "none"; return; }
    openCard();
  });
  card.querySelector(".bar button").addEventListener("click", closeCard);
  card.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); closeCard(); } });

  // ── Describes from the page hook ──

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "stg-mj-describe" || !Array.isArray(data.descriptions) || !data.imageUrl) return;
    const entry = { imageUrl: String(data.imageUrl), descriptions: data.descriptions.map(String).slice(0, 4), aspect: data.aspect || null, pageUrl: location.href };
    void core()?.rememberDescribe(entry);
    if (data.quiet) return;
    const same = latest && latest.imageUrl === entry.imageUrl;
    latest = entry;
    mount();
    pill.querySelector("img").src = entry.imageUrl;
    if (card.style.display === "flex") { if (!same) ensureUi()?.load(entry); }
    else pill.style.display = "flex";
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

  globalScope.SaveToGalleryMjDescribe = { open: openCard, close: closeCard, latest: () => latest };
})(typeof globalThis !== "undefined" ? globalThis : self);
