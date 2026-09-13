import type { SiteTwinDocumentContext } from "../documentContext";
import { receiptForPiece } from "../documentContext";
import { requireInspectorPass, inspectCanonicalContext } from "../inspector";
import { escapeXml, lonLatToLocalM, svgPolygon, svgTransform } from "./common";

export function renderDp2FromSiteTwin(context: SiteTwinDocumentContext) {
  requireInspectorPass(inspectCanonicalContext(context));
  const twin = context.siteTwin;
  const width = 1400;
  const height = 1000;
  const origin = twin.roof.origin;
  const parcel = twin.parcel.polygonLonLat.map((point) => lonLatToLocalM(point, origin));
  const buildings = twin.buildings.map((building) => ({
    id: building.id,
    polygon: building.polygonLonLat.map((point) => lonLatToLocalM(point, origin)),
  }));
  const roofFaces = twin.roof.faces;
  const modules = context.layout.modules;
  const allPoints = [
    ...parcel,
    ...buildings.flatMap((building) => building.polygon),
    ...roofFaces.flatMap((face) => face.polygonLocalM),
    ...modules.flatMap((module) => module.polygonLocalM),
  ];
  const project = svgTransform(allPoints, width, height, 80);
  const selected = new Set(context.layout.selectedFaceIds);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="70" y="54" font-family="Arial" font-size="28" font-weight="700">DP2 — Plan de masse</text>
  <text x="70" y="84" font-family="Arial" font-size="15" fill="#52525b">${escapeXml(twin.normalizedAddress)} · Parcelle ${escapeXml(twin.parcel.reference)} · Site Twin ${escapeXml(twin.id)} rev. ${twin.revision}</text>
  <polygon points="${svgPolygon(parcel, project)}" fill="#fafafa" stroke="#18181b" stroke-width="3" stroke-dasharray="10 7"/>
  ${buildings.map((building) => `<polygon points="${svgPolygon(building.polygon, project)}" fill="#e4e4e7" stroke="#71717a" stroke-width="2"/>`).join("\n  ")}
  ${roofFaces.map((face) => `<polygon points="${svgPolygon(face.polygonLocalM, project)}" fill="${selected.has(face.id) ? "#cffafe" : "#f4f4f5"}" stroke="${selected.has(face.id) ? "#0891b2" : "#a1a1aa"}" stroke-width="${selected.has(face.id) ? 4 : 2}"/>`).join("\n  ")}
  ${modules.map((module) => `<polygon points="${svgPolygon(module.polygonLocalM, project)}" fill="#164e63" stroke="white" stroke-width="1.5"/>`).join("\n  ")}
  ${roofFaces.map((face) => {
    const center = project(face.centerLocalM);
    return `<circle cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="18" fill="white" stroke="#18181b" stroke-width="2"/><text x="${center.x.toFixed(1)}" y="${(center.y + 6).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700">${escapeXml(face.displayLabel)}</text>`;
  }).join("\n  ")}
  <g transform="translate(70,${height - 92})" font-family="Arial">
    <rect width="${width - 140}" height="52" rx="10" fill="#f4f4f5"/>
    <text x="18" y="22" font-size="14" font-weight="700">Implantation déterministe : ${context.layout.modules.length} modules · ${context.layout.configuration.rows} × ${context.layout.configuration.columns} · ${escapeXml(context.layout.configuration.orientation)}</text>
    <text x="18" y="42" font-size="12" fill="#52525b">Aucune IA générative n'a choisi les coordonnées. Tous les pans physiques restent présents, y compris incompatibles.</text>
  </g>
</svg>`;

  return {
    dp: 2 as const,
    mimeType: "image/svg+xml",
    text: svg,
    receipt: receiptForPiece(context, 2),
  };
}
