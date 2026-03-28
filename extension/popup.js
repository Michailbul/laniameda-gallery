const pillarSelect = document.getElementById("defaultPillar");
const saveBtn = document.getElementById("save");

chrome.storage.sync.get(["defaultPillar"], (cfg) => {
  pillarSelect.value = cfg.defaultPillar || "dump";
});

saveBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ defaultPillar: pillarSelect.value }, () => {
    saveBtn.textContent = "Saved!";
    setTimeout(() => { saveBtn.textContent = "Save settings"; }, 1500);
  });
});
