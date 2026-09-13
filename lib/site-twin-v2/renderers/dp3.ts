import type { SiteTwinDocumentContext } from "../documentContext";
import { receiptForPiece } from "../documentContext";
import { requireInspectorPass, inspectCanonicalContext } from "../inspector";
import { SiteTwinError } from "../errors";
import { escapeXml } from "./common";
import type { TwinXY } from "../types";

function dot(a: TwinXY, b: TwinXY) {
  return a.x * b.x + a.y * b.y;
}

function sectionBasis(azimuthDeg: number) {
  const azimuth = azimuthDeg * Math.PI / 180;
  const downslope = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  return { upslope: { x: -downslope.x, y: -downslope.y } };
}

export function renderDp3FromSiteTwin(context: SiteTwinDocumentContext) {
  requireInspectorPass(inspectCanonicalContext(context));
  const twin = context.siteTwin;
  const faceId = context.layout.selectedFaceIds[0];
  const face = twin.roof.faces.find((item) => item.id === faceId);
  if (!face) throw new SiteTwinError("CROSS_PIECE_INCONSISTENCY", "DP3 : pan sélectionné absent du Site Twin.");
  const ground = twin.sources.terrainElevationM;
  if (ground == null || !Number.isFinite(ground)) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "DP3 refuse d'inventer les hauteurs : aucun niveau de terrain IGN MNT fiable n'est disponible.",
      { recoverable: true },
    );
  }

  const { upslope } = sectionBasis(face.azimuthDeg);
  const cosSlope = Math.max(0.15, Math.cos(face.slopeDeg * Math.PI / 180));
  const projectV = (point: TwinXY) => dot({ x: point.x - face.centerLocalM.x, y: point.y - face.centerLocalM.y }, upslope) / cosSlope;
  const faceV = face.polygonLocalM.map(projectV);
  const minV = Math.min(...faceV);
  const maxV = Math.max(...faceV);
  const localAtV = (v: number): TwinXY => ({
    x: face.centerLocalM.x + upslope.x * v * cosSlope,
    y: face.centerLocalM.y + upslope.y * v * cosSlope,
  });
  const zAt = (point: TwinXY) => face.plane.a * point.x + face.plane.b * point.y + face.plane.c;
  const eavePoint = localAtV(minV);
  const ridgePoint = localAtV(maxV);
  const eaveZ = zAt(eavePoint);
  const ridgeZ = zAt(ridgePoint);
  const eaveHeight = eaveZ - ground;
  const ridgeHeight = ridgeZ - ground;
  if (eaveHeight < 0.5 || ridgeHeight < eaveHeight || ridgeHeight > 30) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      `DP3 : hauteurs incohérentes après croisement DSM/MNT (égout ${eaveHeight.toFixed(2)} m, faîtage ${ridgeHeight.toFixed(2)} m).`,
      { recoverable: true },
    );
  }

  const modules = context.layout.modules.filter((module) => module.faceId === face.id).map((module) => {
    const values = module.polygonLocalM.map(projectV);
    return { minV: Math.min(...values), maxV: Math.max(...values) };
  });

  const width = 1400;
  const height = 900;
  const chart = { left: 120, right: 1250, top: 120, bottom: 720 };
  const spanV = Math.max(1, maxV - minV);
  const maxH = Math.max(ridgeHeight + 1.5, 6);
  const x = (v: number) => chart.left + ((v - minV) / spanV) * (chart.right - chart.left);
  const y = (heightM: number) => chart.bottom - (heightM / maxH) * (chart.bottom - chart.top);

  const roofStart = { x: x(minV), y: y(eaveHeight) };
  const roofEnd = { x: x(maxV), y: y(ridgeHeight) };
  const moduleLines = modules.map((module, index) => {
    const startPoint = localAtV(module.minV);
    const endPoint = localAtV(module.maxV);
    const startZ = zAt(startPoint) - ground + 0.08;
    const endZ = zAt(endPoint) - ground + 0.08;
    return `<line x1="${x(module.minV).toFixed(1)}" y1="${y(startZ).toFixed(1)}" x2="${x(module.maxV).toFixed(1)}" y2="${y(endZ).toFixed(1)}" stroke="#0e7490" stroke-width="5"/><text x="${x((module.minV + module.maxV) / 2).toFixed(1)}" y="${(y((startZ + endZ) / 2) - 8).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="10">${index + 1}</text>`;
  }).join("\n  ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="70" y="54" font-family="Arial" font-size="28" font-weight="700">DP3 — Plan en coupe du terrain et de la construction</text>
  <text x="70" y="84" font-family="Arial" font-size="15" fill="#52525b">${escapeXml(twin.normalizedAddress)} · Pan ${escapeXml(face.displayLabel)} · Site Twin ${escapeXml(twin.id)} rev. ${twin.revision}</text>
  <line x1="${chart.left}" y1="${chart.bottom}" x2="${chart.right}" y2="${chart.bottom}" stroke="#18181b" stroke-width="3"/>
  <text x="${chart.left}" y="${chart.bottom + 26}" font-family="Arial" font-size="12">Terrain IGN MNT ${ground.toFixed(2)} m</text>
  <line x1="${roofStart.x}" y1="${chart.bottom}" x2="${roofStart.x}" y2="${roofStart.y}" stroke="#71717a" stroke-width="4"/>
  <line x1="${roofEnd.x}" y1="${chart.bottom}" x2="${roofEnd.x}" y2="${roofEnd.y}" stroke="#71717a" stroke-width="4"/>
  <line x1="${roofStart.x}" y1="${roofStart.y}" x2="${roofEnd.x}" y2="${roofEnd.y}" stroke="#18181b" stroke-width="7"/>
  ${moduleLines}
  <line x1="${roofStart.x - 35}" y1="${chart.bottom}" x2="${roofStart.x - 35}" y2="${roofStart.y}" stroke="#a1a1aa" stroke-width="1"/>
  <text x="${roofStart.x - 45}" y="${(chart.bottom + roofStart.y) / 2}" text-anchor="end" font-family="Arial" font-size="12">Égout ${eaveHeight.toFixed(2)} m</text>
  <line x1="${roofEnd.x + 35}" y1="${chart.bottom}" x2="${roofEnd.x + 35}" y2="${roofEnd.y}" stroke="#a1a1aa" stroke-width="1"/>
  <text x="${roofEnd.x + 45}" y="${(chart.bottom + roofEnd.y) / 2}" font-family="Arial" font-size="12">Faîtage ${ridgeHeight.toFixed(2)} m</text>
  <text x="${(roofStart.x + roofEnd.x) / 2}" y="${Math.min(roofStart.y, roofEnd.y) - 35}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">Pente ${face.slopeDeg.toFixed(1)}° · rampant ${(maxV - minV).toFixed(2)} m</text>
  <g transform="translate(70,790)" font-family="Arial">
    <rect width="${width - 140}" height="64" rx="10" fill="#f4f4f5"/>
    <text x="18" y="25" font-size="13" font-weight="700">Coupe calculée depuis la même géométrie métrique que DP2.</text>
    <text x="18" y="47" font-size="12" fill="#52525b">Toiture : ${escapeXml(twin.sources.geometryPrimarySource ?? "source métrique")} · terrain : IGN MNT · ${modules.length} modules projetés sur le pan physique ${escapeXml(face.id)}.</text>
  </g>
</svg>`;

  return {
    dp: 3 as const,
    mimeType: "image/svg+xml",
    text: svg,
    receipt: receiptForPiece(context, 3),
    metrics: { groundElevationM: ground, eaveHeightM: eaveHeight, ridgeHeightM: ridgeHeight, slopeDeg: face.slopeDeg },
  };
}
