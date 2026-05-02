import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

let shareInFlight: Promise<void> | null = null;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao converter PDF para base64."));
    reader.onload = () => {
      const result = String(reader.result || "");
      // result = "data:application/pdf;base64,...."
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + "base64,".length) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function sharePdfBlob(blob: Blob, filename: string, title?: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("sharePdfBlob só deve ser usado no app nativo.");
  }

  // Evita erro "Can't share while sharing is in progress" em Android quando o usuário clica rápido.
  if (shareInFlight) {
    await shareInFlight;
  }

  shareInFlight = (async () => {
  const base64 = await blobToBase64(blob);
  const safeName = (filename || "relatorio.pdf").replace(/[\\/:*?"<>|]+/g, "_");
  const path = `reports/${Date.now()}-${safeName}`;

  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const uri = await Filesystem.getUri({ path, directory: Directory.Cache });

  await Share.share({
    title: title || safeName,
    text: title || safeName,
    // Em Android/iOS, usar `files` tende a ser mais compatível do que `url`
    files: [uri.uri],
    dialogTitle: "Compartilhar relatório",
  });
  })();

  try {
    await shareInFlight;
  } finally {
    shareInFlight = null;
  }
}

