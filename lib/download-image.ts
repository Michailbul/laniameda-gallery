export async function downloadImage(url: string, filename?: string) {
  const name = filename ?? url.split("/").pop() ?? "image";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch {
    // CORS fallback — open in new tab
    window.open(url, "_blank");
    return false;
  }
}
