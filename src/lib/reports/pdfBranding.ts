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
 * Cabeçalho inteiro (largura A4) preenchido com o PNG em modo cover.
 *
 * Importante: os textos do cabeçalho (SIGMA-GCM / subtítulos / título central / data)
 * são desenhados no CANVAS e não como texto do PDF. Assim o layout fica idêntico
 * em qualquer visualizador (Android/Chrome/Edge), evitando variações de fonte/kerning
 * que mudam tamanho e “estouram” o cabeçalho.
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

function mmToPx(mm: number, pxPerMm: number) {
  return Math.round(mm * pxPerMm);
}

function drawCenteredText(opts: {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  maxWidth?: number;
}) {
  const { ctx, text, x, y, font, color, maxWidth } = opts;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (maxWidth && maxWidth > 0) {
    ctx.fillText(text, x, y, maxWidth);
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function drawSigmaHeaderText(opts: {
  ctx: CanvasRenderingContext2D;
  pxPerMm: number;
  widthPx: number;
  headerHeightPx: number;
  title: string;
  subtitleLine1: string;
  subtitleLine2?: string;
  centerLine?: string;
  generatedAtText?: string;
}) {
  const {
    ctx,
    pxPerMm,
    widthPx,
    headerHeightPx,
    title,
    subtitleLine1,
    subtitleLine2,
    centerLine,
    generatedAtText,
  } = opts;

  const cx = Math.round(widthPx / 2);

  // posições equivalentes às usadas no PDF (mm → px), para manter o mesmo desenho.
  const yTitle = mmToPx(15, pxPerMm);
  const ySub1 = mmToPx(21, pxPerMm);
  const ySub2 = mmToPx(27, pxPerMm);
  const yCenter = mmToPx(subtitleLine2 ? 33 : 31, pxPerMm);
  const yGen = mmToPx(40, pxPerMm);

  // tipografia: usamos fontes web-safe no canvas. Como vira imagem, fica consistente.
  drawCenteredText({
    ctx,
    text: title,
    x: cx,
    y: yTitle,
    font: `700 ${mmToPx(6.2, pxPerMm)}px Arial`,
    color: "#ffffff",
    maxWidth: widthPx - mmToPx(20, pxPerMm),
  });

  drawCenteredText({
    ctx,
    text: subtitleLine1,
    x: cx,
    y: ySub1,
    font: `italic 400 ${mmToPx(2.6, pxPerMm)}px Arial`,
    color: "#ffffff",
    maxWidth: widthPx - mmToPx(24, pxPerMm),
  });

  if (subtitleLine2) {
    drawCenteredText({
      ctx,
      text: subtitleLine2,
      x: cx,
      y: ySub2,
      font: `400 ${mmToPx(2.6, pxPerMm)}px Arial`,
      color: "#ffffff",
      maxWidth: widthPx - mmToPx(24, pxPerMm),
    });
  }

  if (centerLine) {
    drawCenteredText({
      ctx,
      text: centerLine,
      x: cx,
      y: yCenter,
      font: `400 ${mmToPx(3.7, pxPerMm)}px Arial`,
      color: "#ffffff",
      maxWidth: widthPx - mmToPx(24, pxPerMm),
    });
  }

  if (generatedAtText) {
    drawCenteredText({
      ctx,
      text: generatedAtText,
      x: cx,
      y: yGen,
      font: `400 ${mmToPx(2.6, pxPerMm)}px Arial`,
      color: "#ffffff",
      maxWidth: widthPx - mmToPx(24, pxPerMm),
    });
  }

  // Se, por algum motivo, o texto passar da área, “mascara” discretamente o rodapé.
  ctx.save();
  ctx.fillStyle = "rgba(0, 33, 71, 0.12)";
  ctx.fillRect(0, headerHeightPx - mmToPx(1.2, pxPerMm), widthPx, mmToPx(1.2, pxPerMm));
  ctx.restore();
}

async function loadSigmaHeaderCompositeDataUrl(opts: {
  logoUrl: string;
  widthMm: number;
  headerHeightMm: number;
  pxPerMm: number;
  coverBoost: number;
  title: string;
  subtitleLine1: string;
  subtitleLine2?: string;
  centerLine?: string;
  generatedAtText?: string;
}): Promise<string> {
  const {
    logoUrl,
    widthMm,
    headerHeightMm,
    pxPerMm,
    coverBoost,
    title,
    subtitleLine1,
    subtitleLine2,
    centerLine,
    generatedAtText,
  } = opts;

  const base64 = await loadFullBleedHeaderDataUrl(logoUrl, widthMm, headerHeightMm, pxPerMm, coverBoost);
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = base64;
  });

  const widthPx = Math.max(1, Math.round(widthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(headerHeightMm * pxPerMm));
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(img, 0, 0, widthPx, heightPx);
  drawSigmaHeaderText({
    ctx,
    pxPerMm,
    widthPx,
    headerHeightPx: heightPx,
    title,
    subtitleLine1,
    subtitleLine2,
    centerLine,
    generatedAtText,
  });

  return canvas.toDataURL("image/png");
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
      const generatedAtText = opts.generatedAt
        ? `Gerado em: ${format(opts.generatedAt, "dd/MM/yyyy HH:mm")}`
        : undefined;
      const base64Header = await loadSigmaHeaderCompositeDataUrl({
        logoUrl,
        widthMm: PAGE_W_MM,
        headerHeightMm,
        pxPerMm: 8,
        coverBoost: 1.62,
        title: opts.title,
        subtitleLine1: opts.subtitleLine1,
        subtitleLine2: opts.subtitleLine2,
        centerLine: opts.centerLine,
        generatedAtText,
      });
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

  return { headerHeightMm };
}

/** Layout do cabeçalho SIGMA nos PDFs (faixa full-bleed em A4). */
export const SIGMA_PDF_HEADER_LAYOUT = {
  pageWidthMm: PAGE_W_MM,
  headerHeightMm: 45,
  titleCenterXMm: 105,
} as const;
