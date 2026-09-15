import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";

export type ProductionDocumentBranding = {
  companyName?: string;
  logoDataUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  paperColor?: string;
};

function safeHex(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function pdfColor(hex: string) {
  const clean = hex.replace("#", "");
  return rgb(
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  );
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\u00C0-\u00FF\u20AC]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), bytes: Uint8Array.from(Buffer.from(match[2], "base64")) };
}

async function embedLogo(pdf: PDFDocument, dataUrl: string | undefined): Promise<PDFImage | null> {
  if (!dataUrl || dataUrl.length > 800_000) return null;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  try {
    return decoded.mimeType === "image/png" ? await pdf.embedPng(decoded.bytes) : await pdf.embedJpg(decoded.bytes);
  } catch {
    return null;
  }
}

export async function applyProductionDocumentBranding(
  generatedPdfBytes: Uint8Array,
  officialCerfaBytes: Uint8Array,
  requestedBranding: ProductionDocumentBranding | undefined,
) {
  const branding = requestedBranding ?? {};
  const companyName = cleanText(branding.companyName).slice(0, 80);
  const primary = pdfColor(safeHex(branding.primaryColor, "#102a56"));
  const accent = pdfColor(safeHex(branding.accentColor, "#36a9cd"));

  const pdf = await PDFDocument.load(generatedPdfBytes);
  const officialCerfa = await PDFDocument.load(officialCerfaBytes, { ignoreEncryption: true });
  const officialPageCount = officialCerfa.getPageCount();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, branding.logoDataUrl);

  for (let pageIndex = officialPageCount; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const page = pdf.getPage(pageIndex);
    const { width, height } = page.getSize();

    // A restrained agency signature that never touches the official CERFA pages.
    page.drawRectangle({ x: 0, y: height - 5, width, height: 5, color: primary });
    page.drawRectangle({ x: width * 0.78, y: height - 5, width: width * 0.22, height: 5, color: accent });
    page.drawLine({
      start: { x: 38, y: 34 },
      end: { x: width - 38, y: 34 },
      thickness: 0.8,
      color: primary,
      opacity: 0.72,
    });

    if (companyName) {
      const nameSize = pageIndex === officialPageCount ? 10 : 7.5;
      const textWidth = bold.widthOfTextAtSize(companyName, nameSize);
      const logoWidth = logo ? 30 : 0;
      const right = width - 38;
      const textX = Math.max(width * 0.56, right - textWidth);
      const y = height - (pageIndex === officialPageCount ? 34 : 26);
      page.drawText(companyName, { x: textX - logoWidth, y, size: nameSize, font: bold, color: primary });

      if (logo) {
        const scale = Math.min(28 / logo.width, 24 / logo.height);
        const drawWidth = logo.width * scale;
        const drawHeight = logo.height * scale;
        page.drawImage(logo, {
          x: Math.max(38, textX - logoWidth - drawWidth - 7),
          y: y - 5,
          width: drawWidth,
          height: drawHeight,
        });
      }
    } else if (logo) {
      const scale = Math.min(34 / logo.width, 28 / logo.height);
      page.drawImage(logo, {
        x: width - 38 - logo.width * scale,
        y: height - 37,
        width: logo.width * scale,
        height: logo.height * scale,
      });
    }

    page.drawText("DOSSIER PERSONNALISE PAR PILOTPAPER", {
      x: 38,
      y: 17,
      size: 5.6,
      font,
      color: primary,
      opacity: 0.58,
    });
  }

  return pdf.save();
}
