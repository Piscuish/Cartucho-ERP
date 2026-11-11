/**
 * Reduce una imagen en el navegador antes de enviarla a Rust, para que la base de datos
 * no crezca con fotos enormes. Devuelve Base64 (sin prefijo) y tipo MIME.
 */
export async function readImageFile(
  file: File,
  maxSide = 800,
  preferType: "image/webp" | "image/png" = "image/webp",
): Promise<{ base64: string; mime: string; dataUrl: string }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Usa una imagen PNG, JPG o WEBP.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("La imagen es demasiado grande (máximo 15 MB).");
  }
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo leer la imagen."));
      el.src = srcUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen.");
    ctx.drawImage(img, 0, 0, w, h);
    let dataUrl = canvas.toDataURL(preferType, 0.86);
    let mime: string = preferType;
    // Algunos motores no soportan WEBP al exportar: se usa PNG.
    if (!dataUrl.startsWith(`data:${preferType}`)) {
      dataUrl = canvas.toDataURL("image/png");
      mime = "image/png";
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, mime, dataUrl };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}
