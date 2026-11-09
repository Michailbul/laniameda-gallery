// The side panel's Describe tab: drop a picture (a file, or an image dragged
// from any page), paste one, pick one of the last Midjourney describes, or
// right-click an image anywhere → "Describe to a prompt". The describer
// (mj-describe-core.js) writes our prompt; Put in bar goes to the open
// Midjourney tab, never further.

(function registerDescribePanel(globalScope) {
  const root = document.getElementById("dsRoot");
  const core = globalScope.SaveToGalleryDescribe;
  if (!root || !core) return;

  root.innerHTML = `
    <div class="dsp">
      <div class="dsp-drop" tabindex="0" role="button" aria-label="Drop a picture to describe">
        <div class="dsp-drop-in">
          <span class="dsp-drop-icon"></span>
          <b>Drop a picture</b>
          <span>a file, or an image dragged from any page · or paste</span>
        </div>
        <input class="dsp-file" type="file" accept="image/*" hidden>
      </div>
      <div class="dsp-recent-wrap" hidden>
        <p class="qe-label">Last Midjourney describes</p>
        <div class="dsp-recent"></div>
      </div>
      <div class="dsp-ui"></div>
    </div>`;

  const drop = root.querySelector(".dsp-drop");
  const fileInput = root.querySelector(".dsp-file");
  const recentWrap = root.querySelector(".dsp-recent-wrap");
  const recent = root.querySelector(".dsp-recent");

  async function midjourneyTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https:\/\/([a-z]+\.)?midjourney\.com\//.test(tab.url || "")) return tab;
    const tabs = await chrome.tabs.query({ url: ["https://www.midjourney.com/*", "https://midjourney.com/*"], currentWindow: true });
    return tabs.find((t) => /\/imagine|\/create|\/explore|\/jobs/.test(t.url || "")) || tabs[0] || null;
  }
  const putInBar = async (text) => {
    const tab = await midjourneyTab();
    if (!tab?.id) return { ok: false, error: "Open midjourney.com/imagine to put it in the bar." };
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: "mjDescribePutInBar", text }, (res) => {
        const error = chrome.runtime.lastError?.message;
        if (error) { resolve({ ok: false, error: "Reload the Midjourney tab once, then try again." }); return; }
        if (res?.ok && !tab.active) chrome.tabs.update(tab.id, { active: true });
        resolve(res || { ok: false, error: "No answer from the Midjourney tab." });
      });
    });
  };

  const ui = core.mount(root.querySelector(".dsp-ui"), { theme: "light", putInBar, barLabel: "Put in MJ bar" });
  const dspUi = root.querySelector(".dsp-ui");
  dspUi.hidden = true;
  const show = (source) => { dspUi.hidden = false; drop.classList.add("dsp-drop--small"); void ui.load(source); };

  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  async function fromTransfer(data) {
    const file = [...(data?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) return { dataUrl: await readFile(file), pageUrl: "" };
    const html = data?.getData?.("text/html") || "";
    const fromHtml = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    const uri = (data?.getData?.("text/uri-list") || "").split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("#"));
    const text = data?.getData?.("text/plain")?.trim();
    const url = [fromHtml, uri, text].find((value) => value && /^(https?:|data:image\/)/i.test(value));
    if (!url) return null;
    return url.startsWith("data:") ? { dataUrl: url } : { imageUrl: url.replace(/&amp;/g, "&") };
  }

  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dsp-drop--over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dsp-drop--over"));
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("dsp-drop--over");
    const source = await fromTransfer(event.dataTransfer);
    if (source) show(source);
  });
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) show({ dataUrl: await readFile(file) });
    fileInput.value = "";
  });
  document.addEventListener("paste", async (event) => {
    if (root.hidden || event.target?.closest?.("textarea, input")) return;
    const source = await fromTransfer(event.clipboardData);
    if (source) { event.preventDefault(); show(source); }
  });

  async function paintRecent() {
    const list = (await core.recentDescribes()).slice(0, 8);
    recentWrap.hidden = !list.length;
    recent.replaceChildren(...list.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dsp-recent-item";
      button.title = entry.descriptions?.[0] || "";
      const img = document.createElement("img");
      img.src = entry.imageUrl;
      img.alt = "";
      img.loading = "lazy";
      button.appendChild(img);
      button.addEventListener("click", () => show(entry));
      return button;
    }));
  }

  // Right-click → "Describe to a prompt" leaves the picture here.
  async function takePending() {
    let stored = {};
    try { stored = await chrome.storage.session.get("describePending"); } catch { return; }
    const pending = stored?.describePending;
    if (!pending?.imageUrl || Date.now() - (pending.at || 0) > 120_000) return;
    await chrome.storage.session.remove("describePending");
    globalScope.SaveToGalleryPanelMode?.("describe");
    show({ imageUrl: pending.imageUrl, pageUrl: pending.pageUrl || "" });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[core.STORE.recent]) void paintRecent();
    if (area === "session" && changes.describePending?.newValue) void takePending();
  });
  void paintRecent();
  void takePending();
})(typeof globalThis !== "undefined" ? globalThis : self);
