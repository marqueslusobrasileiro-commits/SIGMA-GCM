import { format } from "date-fns";
/** Mesmo arte do app (`sigma-brand.png`), empacotado pelo Vite — não usar só `/public`. */
import sigmaBrandSrc from "../../assets/sigma-brand.png?url";

const PAGE_W_MM = 210;

type JsPdfLike = {
  setFillColor: (...args: any[]) => any;
  rect: (...args: any[]) => any;
  addImage: (...args: any[]) => any;
  setDrawColor: (...args: any[]) => any;
  setLineWidth: (...args: any[]) => any;
  circle: (...args: any[]) => any;
  roundedRect?: (...args: any[]) => any;
  setFontSize: (...args: any[]) => any;
  setTextColor: (...args: any[]) => any;
  setFont: (...args: any[]) => any;
  text: (...args: any[]) => any;
};

/**
 * Cabeçalho inteiro (largura A4) preenchido só com o PNG em modo cover + zoom extra,
 * para não ficar “quadrado pequeno” nem faixa escura vazia até ao texto — pedido no anexo.
 */
function loadFullBleedHeaderDataUrl(
  url: string,
  widthMm: number,
  heightMm: number,
  pxPerMm: number,
  coverBoost: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cw = Math.max(1, Math.round(widthMm * pxPerMm));
      const ch = Math.max(1, Math.round(heightMm * pxPerMm));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      ctx.fillStyle = "#002147";
      ctx.fillRect(0, 0, cw, ch);

      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const baseScale = Math.max(cw / iw, ch / ih);
      const scale = baseScale * coverBoost;
      const dw = iw * scale;
      const dh = ih * scale;
      const ox = Math.min(0, cw - dw);
      const oy = (ch - dh) / 2 + ch * 0.052;

      ctx.drawImage(img, ox, oy, dw, dh);

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
  pdfDoc.rect(0, 0, PAGE_W_MM, headerHeightMm, "F");

  /** Import Vite primeiro; APK/`sigma-logo.png` em `public` como segunda hipótese. */
  const logoCandidates = [sigmaBrandSrc, "/sigma-logo.png"];

  let headerOk = false;
  for (const logoUrl of logoCandidates) {
    try {
      const base64Header = await loadFullBleedHeaderDataUrl(
        logoUrl,
        PAGE_W_MM,
        headerHeightMm,
        8,
        1.62,
      );
      pdfDoc.addImage(base64Header, "PNG", 0, 0, PAGE_W_MM, headerHeightMm);
      headerOk = true;
      break;
    } catch {
      /* tenta próximo URL */
    }
  }

  if (!headerOk) {
    pdfDoc.setFillColor(0, 33, 71);
    pdfDoc.rect(0, 0, PAGE_W_MM, headerHeightMm, "F");
    pdfDoc.setDrawColor(255, 255, 255);
    pdfDoc.setLineWidth(0.35);
    (pdfDoc as any).roundedRect?.(6, 6, PAGE_W_MM - 12, headerHeightMm - 12, 3, 3, "S");
    pdfDoc.setFontSize(12);
    pdfDoc.setTextColor(255, 255, 255);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text("SIGMA-GCM", PAGE_W_MM / 2, headerHeightMm / 2 + 1, { align: "center" });
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
    pdfDoc.text(`Gerado em: ${format(opts.generatedAt, "dd/MM/yyyy HH:mm")}`, 105, 40, {
      align: "center",
    });
  }

  return { headerHeightMm };
}

/** Layout do cabeçalho SIGMA nos PDFs (faixa full-bleed em A4). */
export const SIGMA_PDF_HEADER_LAYOUT = {
  pageWidthMm: PAGE_W_MM,
  headerHeightMm: 45,
  titleCenterXMm: 105,
} as const;
