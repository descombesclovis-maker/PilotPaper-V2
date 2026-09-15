import "server-only";

import { getDpPieceContract } from "@/lib/dp-piece-contract";
import type { DpPieceInput, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import { generateGeometryLockedPhotographicDp } from "./constrainedPhotographicDp";

function requireSource(input: DpPieceInput) {
  const source = input.photos?.find((photo) => photo.role === "near") ?? input.photos?.find((photo) => photo.role === "roof");
  if (!source?.base64 || source.base64.length < 1000) throw new Error("DP4 : ajoutez une photo réelle de la maison et de la toiture concernée.");
  return source;
}

function dataUrl(photo: Pick<PiecePhotoInput, "mimeType" | "base64">) {
  return `data:${photo.mimeType};base64,${photo.base64}`;
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char] ?? char);
}

export async function generateGeometryLockedDp4(input: DpPieceInput & { dp: 4 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(4);
  if (!contract) throw new Error("Contrat DP4 introuvable.");
  const source = requireSource(input);

  // Reuse the exact same locked photographic renderer as DP5/DP6. The temporary
  // DP5 discriminator only selects the near/roof source and visual QA rules; it
  // cannot change Site Twin geometry, module coordinates or the mask.
  const projected = await generateGeometryLockedPhotographicDp({ ...input, dp: 5 });
  if (!projected.base64) throw new Error("DP4 : la vue projetée verrouillée n'a pas été produite.");

  const width = 1600;
  const height = 1060;
  const frameY = 150;
  const frameW = 720;
  const frameH = 700;
  const leftX = 55;
  const rightX = 825;
  const initialUrl = dataUrl(source);
  const projectedUrl = `data:image/png;base64,${projected.base64}`;
  const panelCount = Number(input.panelCount ?? 0);
  const rows = Number(input.rows ?? 0);
  const columns = Number(input.columns ?? 0);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="55" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#18181b">DP4 — État initial / état projeté</text>
  <text x="55" y="91" font-family="Arial, sans-serif" font-size="15" fill="#52525b">${escapeXml(input.address)} · même photographie, même cadrage, seule l'installation photovoltaïque est ajoutée</text>
  <text x="${leftX}" y="130" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#27272a">ÉTAT INITIAL</text>
  <text x="${rightX}" y="130" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#27272a">ÉTAT PROJETÉ</text>
  <rect x="${leftX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="#f4f4f5" stroke="#d4d4d8" stroke-width="2"/>
  <rect x="${rightX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="#f4f4f5" stroke="#d4d4d8" stroke-width="2"/>
  <image href="${initialUrl}" x="${leftX}" y="${frameY}" width="${frameW}" height="${frameH}" preserveAspectRatio="xMidYMid meet"/>
  <image href="${projectedUrl}" x="${rightX}" y="${frameY}" width="${frameW}" height="${frameH}" preserveAspectRatio="xMidYMid meet"/>
  <g transform="translate(55,895)" font-family="Arial, sans-serif">
    <rect width="1490" height="120" rx="12" fill="#f4f4f5"/>
    <text x="22" y="32" font-size="16" font-weight="700" fill="#18181b">Projet photovoltaïque : ${panelCount} panneaux · ${rows} × ${columns} · ${escapeXml(input.orientation ?? "portrait")}</text>
    <text x="22" y="58" font-size="14" fill="#3f3f46">Vue projetée obtenue par projection géométrique du même Site Twin que DP2/DP3, puis rendu photoréaliste limité aux îlots photovoltaïques.</text>
    <text x="22" y="84" font-size="14" fill="#3f3f46">Les pixels hors champ photovoltaïque sont restaurés depuis la photographie réelle après génération.</text>
    <text x="22" y="106" font-size="12" fill="#71717a">Aucune modification libre de façade, toiture, végétation, environnement ou cadrage n'est autorisée.</text>
  </g>
</svg>`;

  return {
    dp: 4,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    base64: Buffer.from(svg, "utf8").toString("base64"),
    text: svg,
    sourceSummary: [
      "DP4 composée déterministiquement depuis la photographie initiale et une insertion photovoltaïque géométriquement verrouillée.",
      ...projected.sourceSummary.map((line) => line.replace(/^DP5\s*:/, "Vue projetée :")),
      "Mise en page état initial / état projeté réalisée par PilotPaper, sans génération de la planche complète par l'IA.",
    ],
    inspector: {
      passed: projected.inspector.passed,
      score: projected.inspector.score,
      checks: [
        "État initial : photographie source originale",
        "État projeté : même photo, insertion limitée aux polygones PV",
        `Panneaux : ${panelCount}`,
        `Matrice : ${rows} × ${columns}`,
        ...projected.inspector.checks,
      ],
      issues: projected.inspector.issues,
    },
  };
}
