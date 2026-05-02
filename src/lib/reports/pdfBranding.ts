import { format } from "date-fns";

type JsPdfLike = {
  setFillColor: (...args: any[]) => any;
  rect: (...args: any[]) => any;
  addImage: (...args: any[]) => any;
  setDrawColor: (...args: any[]) => any;
  setLineWidth: (...args: any[]) => any;
  circle: (...args: any[]) => any;
  setFontSize: (...args: any[]) => any;
  setTextColor: (...args: any[]) => any;
  setFont: (...args: any[]) => any;
  text: (...args: any[]) => any;
};

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImageRoundedTransparent(
  url: string,
  opts: { radiusFactor: number; insetPx?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const inset = Math.max(0, opts.insetPx || 0);
      const w = canvas.width - inset * 2;
      const h = canvas.height - inset * 2;
      const radius = Math.round(Math.min(w, h) * opts.radiusFactor);
      roundRectPath(ctx, inset, inset, w, h, radius);
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

export async function addSigmaHeader(
  pdfDoc: JsPdfLike,
  opts: {
    title: string;
    subtitleLine1: string;
    subtitleLine2?: string;
    centerLine?: string;
    generatedAt?: Date;
  },
): Promise<{ headerHeightMm: number }> {
  const headerHeightMm = 45;

  pdfDoc.setFillColor(0, 33, 71);
  pdfDoc.rect(0, 0, 210, headerHeightMm, "F");

  try {
    const logoUrl = "/sigma-logo.png";
    const base64Logo = await loadImageRoundedTransparent(logoUrl, { radiusFactor: 0.22, insetPx: 2 });
    pdfDoc.addImage(base64Logo, "PNG", 10, 5, 35, 35);
  } catch (e) {
    // Fallback visual (não depende de asset)
    pdfDoc.setDrawColor(255, 255, 255);
    pdfDoc.setLineWidth(0.5);
    pdfDoc.circle(30, 22, 12, "S");
    pdfDoc.setFontSize(8);
    pdfDoc.setTextColor(255, 255, 255);
    pdfDoc.text("SIGMA", 30, 24, { align: "center" });
  }

  pdfDoc.setTextColor(255, 255, 255);
  pdfDoc.setFontSize(24);
  pdfDoc.setFont("helvetica", "bold");
  pdfDoc.text(opts.title, 105, 15, { align: "center" });

  pdfDoc.setFontSize(9);
  pdfDoc.setFont("helvetica", "italic");
  pdfDoc.text(opts.subtitleLine1, 105, 21, { align: "center" });

  const hasSubtitle2 = !!opts.subtitleLine2;
  if (hasSubtitle2) {
    pdfDoc.setFontSize(9);
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.text(opts.subtitleLine2!, 105, 27, { align: "center" });
  }

  if (opts.centerLine) {
    pdfDoc.setFontSize(14);
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.text(opts.centerLine, 105, hasSubtitle2 ? 33 : 31, { align: "center" });
  }

  if (opts.generatedAt) {
    pdfDoc.setFontSize(9);
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.text(`Gerado em: ${format(opts.generatedAt, "dd/MM/yyyy HH:mm")}`, 105, 40, { align: "center" });
  }

  return { headerHeightMm };
}

