"use client";

import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import type { DPNumber, DpPieceOutput } from "@/lib/pilotpaper-image2-types";
import type { CompleteDossierRecord } from "@/lib/pilotpaper-complete-dossiers";

const PIECES: Array<{ dp: DPNumber; title: string }> = [
  { dp: 1, title: "Plan de situation" },
  { dp: 2, title: "Plan de masse" },
  { dp: 3, title: "Plan en coupe" },
  { dp: 4, title: "État initial / état projeté" },
  { dp: 5, title: "Aspect extérieur rapproché" },
  { dp: 6, title: "Insertion du projet" },
  { dp: 7, title: "Photographie de l'environnement proche" },
  { dp: 8, title: "Photographie du paysage lointain" },
];

function safeHex(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function color(hex: string) {
  const clean = hex.slice(1);
  return rgb(
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  );
}

function bytesFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64FromDataUrl(value: string) {
  return value.split(",")[1] ?? "";
}

function safeText(value: string) {
  return value
    .replace(/[→⇒]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\u00C0-\u00FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function normalizeImageToPng(dataUrl: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Image illisible."));
    element.src = dataUrl;
  });
  const scale = Math.min(1, 700 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Conversion d'image impossible.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function embedLogo(pdf: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  try {
    const png = await normalizeImageToPng(dataUrl);
    return pdf.embedPng(bytesFromBase64(base64FromDataUrl(png)));
  } catch {
    return null;
  }
}

async function embedResult(pdf: PDFDocument, result: DpPieceOutput) {
  const bytes = bytesFromBase64(result.base64 ?? "");
  if (result.mimeType.includes("jpeg") || result.mimeType.includes("jpg")) return pdf.embedJpg(bytes);
  if (result.mimeType.includes("png")) return pdf.embedPng(bytes);
  const png = await normalizeImageToPng(`data:${result.mimeType};base64,${result.base64}`);
  return pdf.embedPng(bytesFromBase64(base64FromDataUrl(png)));
}

export async function buildProfessionalDossierPdf(record: CompleteDossierRecord) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = color(safeHex(record.branding.primaryColor, "#102a56"));
  const accent = color(safeHex(record.branding.accentColor, "#36a9cd"));
  const paper = color(safeHex(record.branding.paperColor, "#f8f8f5"));
  const company = safeText(record.branding.companyName || "PilotPaper").slice(0, 80);
  const address = safeText(record.project.address).slice(0, 105);
  const logo = await embedLogo(pdf, record.branding.logoDataUrl);
  const pageWidth = 841.89;
  const pageHeight = 595.28;

  const cover = pdf.addPage([pageWidth, pageHeight]);
  cover.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });
  cover.drawRectangle({ x: 0, y: 0, width: 19, height: pageHeight, color: primary });
  cover.drawRectangle({ x: 19, y: 0, width: 7, height: pageHeight, color: accent });
  cover.drawRectangle({ x: 40, y: 40, width: pageWidth - 80, height: pageHeight - 80, borderColor: primary, borderWidth: 1.6 });
  cover.drawRectangle({ x: 47, y: 47, width: pageWidth - 94, height: pageHeight - 94, borderColor: accent, borderWidth: 0.6, opacity: 0.6 });
  if (logo) {
    const logoScale = Math.min(150 / logo.width, 66 / logo.height);
    cover.drawImage(logo, { x: 70, y: 475, width: logo.width * logoScale, height: logo.height * logoScale });
  }
  cover.drawText(company.toUpperCase(), { x: 70, y: logo ? 451 : 505, size: 10, font: bold, color: primary });
  cover.drawText("DECLARATION PREALABLE", { x: 70, y: 377, size: 34, font: bold, color: primary });
  cover.drawText("DOSSIER PHOTOVOLTAIQUE COMPLET", { x: 70, y: 341, size: 16, font: regular, color: accent });
  cover.drawText(address, { x: 70, y: 282, size: 12, font: bold, color: primary });
  cover.drawText(
    safeText(`${record.project.panelCount} modules - ${record.project.rows} x ${record.project.columns} - ${record.project.moduleReference}`),
    { x: 70, y: 252, size: 9, font: regular, color: primary },
  );
  cover.drawText(safeText(record.project.mountingSystem), { x: 70, y: 230, size: 8, font: regular, color: primary, opacity: 0.7 });
  cover.drawText("DP1 a DP8 - dossier genere par PilotPaper", { x: 70, y: 91, size: 7, font: regular, color: primary, opacity: 0.55 });

  for (const piece of PIECES) {
    const result = record.pieces[piece.dp].result;
    if (!result?.base64) continue;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });

    // Professional frame: the two agency colors physically frame every DP sheet.
    page.drawRectangle({ x: 14, y: 14, width: pageWidth - 28, height: pageHeight - 28, borderColor: primary, borderWidth: 3.2 });
    page.drawRectangle({ x: 21, y: 21, width: pageWidth - 42, height: pageHeight - 42, borderColor: accent, borderWidth: 1.1, opacity: 0.9 });
    page.drawRectangle({ x: 21, y: pageHeight - 71, width: pageWidth - 42, height: 50, color: primary });
    page.drawRectangle({ x: pageWidth - 197, y: pageHeight - 71, width: 176, height: 50, color: accent });

    if (logo) {
      const scale = Math.min(65 / logo.width, 34 / logo.height);
      page.drawImage(logo, { x: 34, y: pageHeight - 63, width: logo.width * scale, height: logo.height * scale });
    }
    const headerX = logo ? 108 : 36;
    page.drawText(company.toUpperCase(), { x: headerX, y: pageHeight - 45, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    page.drawText(address, { x: headerX, y: pageHeight - 59, size: 6.2, font: regular, color: rgb(1, 1, 1), opacity: 0.76 });
    page.drawText(`DP${piece.dp}`, { x: pageWidth - 174, y: pageHeight - 48, size: 17, font: bold, color: primary });
    page.drawText(safeText(piece.title).toUpperCase().slice(0, 42), { x: pageWidth - 174, y: pageHeight - 61, size: 5.6, font: bold, color: primary });

    const image = await embedResult(pdf, result);
    const availableWidth = pageWidth - 78;
    const availableHeight = pageHeight - 146;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: 52 + (availableHeight - height) / 2,
      width,
      height,
    });

    page.drawLine({ start: { x: 34, y: 40 }, end: { x: pageWidth - 34, y: 40 }, thickness: 0.8, color: accent });
    page.drawText(company, { x: 34, y: 27, size: 5.8, font: bold, color: primary });
    page.drawText(`PilotPaper · ${record.project.panelCount} modules · ${record.project.rows} x ${record.project.columns}`, { x: pageWidth - 245, y: 27, size: 5.4, font: regular, color: primary, opacity: 0.68 });
  }

  return pdf.save();
}
