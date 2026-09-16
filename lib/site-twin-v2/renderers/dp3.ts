import type { SiteTwinDocumentContext } from "../documentContext";
import { receiptForPiece } from "../documentContext";
import { requireInspectorPass, inspectCanonicalContext } from "../inspector";
import { SiteTwinError } from "../errors";
import { escapeXml } from "./common";
import type { SiteTwinRoofEdge, SiteTwinRoofFace, TwinXY } from "../types";

function dot(a: TwinXY, b: TwinXY) {
  return a.x * b.x + a.y * b.y;
}

function normalize(vector: TwinXY): TwinXY {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-9) throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "DP3 : direction de coupe dégénérée.");
  return { x: vector.x / length, y: vector.y / length };
}

function faceDownslope(face: SiteTwinRoofFace): TwinXY {
  const azimuth = face.azimuthDeg * Math.PI / 180;
  return { x: Math.sin(azimuth), y: Math.cos(azimuth) };
}

function zAt(face: SiteTwinRoofFace, point: TwinXY) {
  return face.plane.a * point.x + face.plane.b * point.y + face.plane.c;
}

function ridgeForFace(context: SiteTwinDocumentContext, face: SiteTwinRoofFace) {
  const candidates = context.siteTwin.roof.edges
    .filter((edge) => edge.kind === "ridge" && edge.adjacentFaceIds.includes(face.id))
    .sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y));
  return candidates[0];
}

function ridgeMidpoint(edge: SiteTwinRoofEdge): TwinXY {
  return { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
}

function sectionDirectionFromRidge(edge: SiteTwinRoofEdge, selectedFace: SiteTwinRoofFace) {
  const ridgeDirection = normalize({ x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y });
  let perpendicular = normalize({ x: -ridgeDirection.y, y: ridgeDirection.x });
  if (dot(perpendicular, faceDownslope(selectedFace)) < 0) {
    perpendicular = { x: -perpendicular.x, y: -perpendicular.y };
  }
  return perpendicular;
}

function moduleCenter(points: TwinXY[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function representativeModuleCenter(context: SiteTwinDocumentContext, faceId: string) {
  const modules = context.layout.modules.filter((module) => module.faceId === faceId);
  if (!modules.length) return null;
  const centers = modules.map((module) => moduleCenter(module.polygonLocalM));
  const fieldCenter = {
    x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
    y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
  };
  return centers.reduce((best, candidate) => (
    Math.hypot(candidate.x - fieldCenter.x, candidate.y - fieldCenter.y)
      < Math.hypot(best.x - fieldCenter.x, best.y - fieldCenter.y)
      ? candidate
      : best
  ));
}

function closestPointOnSegment(point: TwinXY, a: TwinXY, b: TwinXY): TwinXY {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-9) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function sectionOriginOnRidge(context: SiteTwinDocumentContext, ridge: SiteTwinRoofEdge, face: SiteTwinRoofFace) {
  const target = representativeModuleCenter(context, face.id);
  if (!target) return ridgeMidpoint(ridge);
  return closestPointOnSegment(target, { x: ridge.a.x, y: ridge.a.y }, { x: ridge.b.x, y: ridge.b.y });
}

function extremeOnFace(face: SiteTwinRoofFace, origin: TwinXY, axis: TwinXY, mode: "min" | "max") {
  const ranked = face.polygonLocalM
    .map((point) => ({ point, value: dot({ x: point.x - origin.x, y: point.y - origin.y }, axis) }))
    .sort((a, b) => mode === "max" ? b.value - a.value : a.value - b.value);
  return ranked[0];
}

function sectionIntersections(points: TwinXY[], origin: TwinXY, axis: TwinXY) {
  const lateral = { x: -axis.y, y: axis.x };
  const projected = points.map((point) => ({
    point,
    q: dot({ x: point.x - origin.x, y: point.y - origin.y }, axis),
    s: dot({ x: point.x - origin.x, y: point.y - origin.y }, lateral),
  }));
  const hits: number[] = [];
  const epsilon = 0.015;
  for (let index = 0; index < projected.length; index += 1) {
    const a = projected[index]!;
    const b = projected[(index + 1) % projected.length]!;
    if (Math.abs(a.s) <= epsilon) hits.push(a.q);
    if ((a.s < -epsilon && b.s > epsilon) || (a.s > epsilon && b.s < -epsilon)) {
      const t = a.s / (a.s - b.s);
      hits.push(a.q + t * (b.q - a.q));
    }
  }
  const unique = hits
    .sort((a, b) => a - b)
    .filter((value, index, array) => index === 0 || Math.abs(value - array[index - 1]!) > 0.005);
  return unique.length >= 2 ? [unique[0]!, unique[unique.length - 1]!] as const : null;
}

function moduleSectionSegments(context: SiteTwinDocumentContext, face: SiteTwinRoofFace, origin: TwinXY, axis: TwinXY, ground: number) {
  return context.layout.modules
    .filter((module) => module.faceId === face.id)
    .flatMap((module) => {
      const intersection = sectionIntersections(module.polygonLocalM, origin, axis);
      if (!intersection) return [];
      const [minQ, maxQ] = intersection;
      const minPoint = { x: origin.x + axis.x * minQ, y: origin.y + axis.y * minQ };
      const maxPoint = { x: origin.x + axis.x * maxQ, y: origin.y + axis.y * maxQ };
      return [{
        index: module.moduleIndex,
        minQ,
        maxQ,
        minHeight: zAt(face, minPoint) - ground,
        maxHeight: zAt(face, maxPoint) - ground,
      }];
    });
}

function dimensionHorizontal(x1: number, x2: number, y: number, label: string) {
  return `<g class="dimension">
    <line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" marker-start="url(#dim-arrow)" marker-end="url(#dim-arrow)"/>
    <text x="${((x1 + x2) / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle">${escapeXml(label)}</text>
  </g>`;
}

function dimensionVertical(x: number, y1: number, y2: number, label: string) {
  return `<g class="dimension">
    <line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" marker-start="url(#dim-arrow)" marker-end="url(#dim-arrow)"/>
    <text x="${(x + 13).toFixed(1)}" y="${((y1 + y2) / 2).toFixed(1)}" dominant-baseline="middle">${escapeXml(label)}</text>
  </g>`;
}

function scaleBar(spanM: number, chartWidthPx: number) {
  const target = Math.max(0.5, spanM / 5);
  const candidates = [0.5, 1, 2, 5, 10, 20];
  const lengthM = candidates.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best, candidates[0]!);
  const lengthPx = Math.min(chartWidthPx * 0.42, (lengthM / spanM) * chartWidthPx);
  const half = lengthPx / 2;
  return `<g transform="translate(120,778)" font-family="Arial, sans-serif">
    <text x="0" y="-10" font-size="11" font-weight="700">ÉCHELLE GRAPHIQUE</text>
    <rect x="0" y="0" width="${half.toFixed(1)}" height="10" fill="#18181b"/>
    <rect x="${half.toFixed(1)}" y="0" width="${half.toFixed(1)}" height="10" fill="white" stroke="#18181b"/>
    <line x1="0" y1="0" x2="0" y2="15" stroke="#18181b"/>
    <line x1="${half.toFixed(1)}" y1="0" x2="${half.toFixed(1)}" y2="15" stroke="#18181b"/>
    <line x1="${lengthPx.toFixed(1)}" y1="0" x2="${lengthPx.toFixed(1)}" y2="15" stroke="#18181b"/>
    <text x="0" y="28" font-size="10">0</text>
    <text x="${half.toFixed(1)}" y="28" text-anchor="middle" font-size="10">${(lengthM / 2).toLocaleString("fr-FR")} m</text>
    <text x="${lengthPx.toFixed(1)}" y="28" text-anchor="end" font-size="10">${lengthM.toLocaleString("fr-FR")} m</text>
  </g>`;
}

export function renderDp3FromSiteTwin(context: SiteTwinDocumentContext) {
  requireInspectorPass(inspectCanonicalContext(context));
  const twin = context.siteTwin;
  const faceId = context.layout.selectedFaceIds[0];
  const selectedFace = twin.roof.faces.find((item) => item.id === faceId);
  if (!selectedFace) throw new SiteTwinError("CROSS_PIECE_INCONSISTENCY", "DP3 : pan sélectionné absent du Site Twin.");
  const ground = twin.sources.terrainElevationM;
  if (ground == null || !Number.isFinite(ground)) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "DP3 refuse d'inventer les hauteurs : aucun niveau de terrain IGN MNT fiable n'est disponible.",
      { recoverable: true },
    );
  }

  const ridge = ridgeForFace(context, selectedFace);
  let origin: TwinXY;
  let axis: TwinXY;
  let leftFace: SiteTwinRoofFace | undefined;
  let leftQ = 0;
  let rightQ = 0;
  let leftHeight = 0;
  let rightHeight = 0;
  let ridgeHeight = 0;
  let sectionLabel = "Coupe perpendiculaire à la ligne de plus grande pente";

  if (ridge) {
    origin = sectionOriginOnRidge(context, ridge, selectedFace);
    axis = sectionDirectionFromRidge(ridge, selectedFace);
    const otherFaceId = ridge.adjacentFaceIds.find((id) => id !== selectedFace.id);
    leftFace = twin.roof.faces.find((item) => item.id === otherFaceId);
    const rightExtreme = extremeOnFace(selectedFace, origin, axis, "max");
    if (!rightExtreme || rightExtreme.value < 0.2) {
      throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "DP3 : l'égout du pan projeté n'est pas démontré par la géométrie.", { recoverable: true });
    }
    rightQ = rightExtreme.value;
    rightHeight = zAt(selectedFace, rightExtreme.point) - ground;
    if (leftFace) {
      const leftExtreme = extremeOnFace(leftFace, origin, axis, "min");
      if (!leftExtreme || leftExtreme.value > -0.2) {
        throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "DP3 : le pan opposé au faîtage n'est pas suffisamment démontré.", { recoverable: true });
      }
      leftQ = leftExtreme.value;
      leftHeight = zAt(leftFace, leftExtreme.point) - ground;
    }
    ridgeHeight = ((zAt(selectedFace, origin) + (leftFace ? zAt(leftFace, origin) : zAt(selectedFace, origin))) / 2) - ground;
    sectionLabel = `Coupe A-A perpendiculaire au faîtage ${ridge.id}`;
  } else {
    axis = normalize(faceDownslope(selectedFace));
    origin = representativeModuleCenter(context, selectedFace.id) ?? selectedFace.centerLocalM;
    const low = extremeOnFace(selectedFace, origin, axis, "max");
    const high = extremeOnFace(selectedFace, origin, axis, "min");
    if (!low || !high) throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "DP3 : profil métrique du pan incomplet.");
    leftQ = high.value;
    rightQ = low.value;
    leftHeight = zAt(selectedFace, high.point) - ground;
    rightHeight = zAt(selectedFace, low.point) - ground;
    ridgeHeight = Math.max(leftHeight, rightHeight);
    sectionLabel = "Coupe A-A du pan (aucun faîtage classé sur ce support)";
  }

  const heights = [leftHeight, rightHeight, ridgeHeight].filter(Number.isFinite);
  const minHeight = Math.min(...heights);
  const maxHeightValue = Math.max(...heights);
  if (minHeight < 0.5 || maxHeightValue > 30) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      `DP3 : hauteurs incohérentes après croisement toiture/MNT (${minHeight.toFixed(2)} à ${maxHeightValue.toFixed(2)} m).`,
      { recoverable: true },
    );
  }

  const modules = moduleSectionSegments(context, selectedFace, origin, axis, ground);
  if (!modules.length && context.layout.modules.some((module) => module.faceId === selectedFace.id)) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "DP3 : la ligne de coupe calculée n'intersecte aucun module du champ photovoltaïque ; la coupe ne sera pas déplacée arbitrairement.",
      { recoverable: true },
    );
  }

  const width = 1600;
  const height = 1000;
  const chart = { left: 145, right: 1415, top: 150, bottom: 700 };
  const minQ = Math.min(leftQ, 0);
  const maxQ = Math.max(rightQ, 0);
  const spanQ = Math.max(1, maxQ - minQ);
  const maxH = Math.max(maxHeightValue + 1.5, 6);
  const x = (q: number) => chart.left + ((q - minQ) / spanQ) * (chart.right - chart.left);
  const y = (heightM: number) => chart.bottom - (heightM / maxH) * (chart.bottom - chart.top);
  const ridgeX = x(0);
  const ridgeY = y(ridgeHeight);
  const leftX = x(leftQ);
  const rightX = x(rightQ);
  const leftY = y(leftHeight);
  const rightY = y(rightHeight);

  const roofSegments: string[] = [];
  if (ridge) {
    if (leftFace) roofSegments.push(`<line x1="${leftX.toFixed(1)}" y1="${leftY.toFixed(1)}" x2="${ridgeX.toFixed(1)}" y2="${ridgeY.toFixed(1)}" class="roof-cut"/>`);
    roofSegments.push(`<line x1="${ridgeX.toFixed(1)}" y1="${ridgeY.toFixed(1)}" x2="${rightX.toFixed(1)}" y2="${rightY.toFixed(1)}" class="roof-cut"/>`);
  } else {
    roofSegments.push(`<line x1="${leftX.toFixed(1)}" y1="${leftY.toFixed(1)}" x2="${rightX.toFixed(1)}" y2="${rightY.toFixed(1)}" class="roof-cut"/>`);
  }

  const moduleLines = modules.map((module) => `<g class="pv-section">
    <line x1="${x(module.minQ).toFixed(1)}" y1="${y(module.minHeight).toFixed(1)}" x2="${x(module.maxQ).toFixed(1)}" y2="${y(module.maxHeight).toFixed(1)}"/>
    <circle cx="${x(module.minQ).toFixed(1)}" cy="${y(module.minHeight).toFixed(1)}" r="2.4"/>
    <circle cx="${x(module.maxQ).toFixed(1)}" cy="${y(module.maxHeight).toFixed(1)}" r="2.4"/>
  </g>`).join("\n  ");

  const selectedRampantM = ridge
    ? Math.hypot(rightQ, ridgeHeight - rightHeight)
    : Math.hypot(rightQ - leftQ, rightHeight - leftHeight);
  const buildingWidthM = Math.abs(rightQ - leftQ);
  const silhouettePoints = ridge && leftFace
    ? `${leftX.toFixed(1)},${chart.bottom} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${ridgeX.toFixed(1)},${ridgeY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)} ${rightX.toFixed(1)},${chart.bottom}`
    : `${leftX.toFixed(1)},${chart.bottom} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)} ${rightX.toFixed(1)},${chart.bottom}`;
  const widthDimensionY = chart.bottom + 54;
  const ridgeDimensionX = Math.min(chart.right + 30, ridgeX + 48);
  const eaveDimensionX = Math.min(chart.right + 72, rightX + 42);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="dim-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
      <path d="M8,4 L0,0 L0,8 Z" fill="#52525b"/>
    </marker>
    <pattern id="section-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#e4e4e7" stroke-width="2"/>
    </pattern>
    <style>
      .roof-cut { stroke:#18181b; stroke-width:5; stroke-linecap:square; }
      .wall-cut { stroke:#27272a; stroke-width:4; }
      .terrain { stroke:#18181b; stroke-width:2.5; }
      .extension { stroke:#a1a1aa; stroke-width:1; stroke-dasharray:4 4; }
      .dimension line { stroke:#52525b; stroke-width:1; }
      .dimension text { fill:#3f3f46; font-family:Arial,sans-serif; font-size:11px; }
      .pv-section line { stroke:#075985; stroke-width:4; stroke-linecap:round; }
      .pv-section circle { fill:#075985; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="white"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#d4d4d8" stroke-width="1.5"/>

  <text x="70" y="62" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#18181b">DP3 — PLAN EN COUPE</text>
  <text x="70" y="92" font-family="Arial, sans-serif" font-size="14" fill="#52525b">${escapeXml(twin.normalizedAddress)}</text>
  <text x="70" y="116" font-family="Arial, sans-serif" font-size="12" fill="#71717a">${escapeXml(sectionLabel)} · Site Twin ${escapeXml(twin.id)} rev. ${twin.revision} · empreinte ${context.layoutDigest.slice(0, 16)}</text>
  <text x="${width - 72}" y="62" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#18181b">COUPE A—A</text>
  <text x="${width - 72}" y="84" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#71717a">géométrie métrique · cotations démontrées uniquement</text>

  <polygon points="${silhouettePoints}" fill="url(#section-hatch)" opacity="0.72"/>
  <line x1="${chart.left}" y1="${chart.bottom}" x2="${chart.right}" y2="${chart.bottom}" class="terrain"/>
  <text x="${chart.left}" y="${chart.bottom + 24}" font-family="Arial, sans-serif" font-size="11" fill="#52525b">Niveau terrain de référence IGN MNT : ${ground.toFixed(2)} m alt.</text>
  <line x1="${leftX.toFixed(1)}" y1="${chart.bottom}" x2="${leftX.toFixed(1)}" y2="${leftY.toFixed(1)}" class="wall-cut"/>
  <line x1="${rightX.toFixed(1)}" y1="${chart.bottom}" x2="${rightX.toFixed(1)}" y2="${rightY.toFixed(1)}" class="wall-cut"/>
  ${roofSegments.join("\n  ")}
  ${moduleLines}

  ${ridge ? `<circle cx="${ridgeX.toFixed(1)}" cy="${ridgeY.toFixed(1)}" r="4" fill="#18181b"/><text x="${(ridgeX + 12).toFixed(1)}" y="${(ridgeY - 12).toFixed(1)}" font-family="Arial, sans-serif" font-size="11" font-weight="700">FAÎTAGE</text>` : ""}
  <text x="${(rightX - 8).toFixed(1)}" y="${(rightY - 13).toFixed(1)}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#52525b">ÉGOUT</text>

  <line x1="${leftX.toFixed(1)}" y1="${chart.bottom}" x2="${leftX.toFixed(1)}" y2="${widthDimensionY + 8}" class="extension"/>
  <line x1="${rightX.toFixed(1)}" y1="${chart.bottom}" x2="${rightX.toFixed(1)}" y2="${widthDimensionY + 8}" class="extension"/>
  ${dimensionHorizontal(leftX, rightX, widthDimensionY, `Largeur de coupe ${buildingWidthM.toFixed(2)} m`)}

  <line x1="${rightX.toFixed(1)}" y1="${chart.bottom}" x2="${eaveDimensionX.toFixed(1)}" y2="${chart.bottom}" class="extension"/>
  <line x1="${rightX.toFixed(1)}" y1="${rightY.toFixed(1)}" x2="${eaveDimensionX.toFixed(1)}" y2="${rightY.toFixed(1)}" class="extension"/>
  ${dimensionVertical(eaveDimensionX, chart.bottom, rightY, `Égout ${rightHeight.toFixed(2)} m`)}

  ${ridge ? `<line x1="${ridgeX.toFixed(1)}" y1="${ridgeY.toFixed(1)}" x2="${ridgeDimensionX.toFixed(1)}" y2="${ridgeY.toFixed(1)}" class="extension"/>
  ${dimensionVertical(ridgeDimensionX, chart.bottom, ridgeY, `Faîtage ${ridgeHeight.toFixed(2)} m`)}` : ""}

  <text x="${x(rightQ / 2).toFixed(1)}" y="${Math.max(chart.top + 22, Math.min(ridgeY, rightY) - 34).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#27272a">PAN ${escapeXml(selectedFace.displayLabel)} · pente ${selectedFace.slopeDeg.toFixed(1)}° · rampant ${selectedRampantM.toFixed(2)} m</text>
  <g transform="translate(${Math.max(chart.left, x(Math.min(0, rightQ) + Math.abs(rightQ) * 0.52)).toFixed(1)},${Math.max(chart.top + 50, y(Math.max(rightHeight, ridgeHeight) * 0.74)).toFixed(1)})" font-family="Arial, sans-serif">
    <line x1="0" y1="0" x2="44" y2="0" stroke="#075985" stroke-width="4"/>
    <text x="52" y="4" font-size="11" fill="#075985" font-weight="700">Champ PV coupé · ${modules.length} module${modules.length > 1 ? "s" : ""} intersecté${modules.length > 1 ? "s" : ""}</text>
  </g>

  ${scaleBar(spanQ, chart.right - chart.left)}

  <g transform="translate(70,842)" font-family="Arial, sans-serif">
    <rect width="${width - 140}" height="100" fill="#fafafa" stroke="#d4d4d8"/>
    <line x1="1060" y1="0" x2="1060" y2="100" stroke="#d4d4d8"/>
    <text x="18" y="24" font-size="12" font-weight="700" fill="#18181b">BASE TECHNIQUE</text>
    <text x="18" y="46" font-size="11" fill="#52525b">Toiture : ${escapeXml(twin.sources.geometryPrimarySource ?? "source métrique")} · terrain : IGN MNT · ${context.layout.modules.length} modules dans le calepinage canonique.</text>
    <text x="18" y="66" font-size="11" fill="#52525b">Le trait PV représente l'intersection du module avec le plan A—A ; aucune épaisseur de fixation ni hauteur de surimposition non vérifiée n'est cotée.</text>
    <text x="18" y="86" font-size="10" fill="#71717a">Les éléments constructifs internes non démontrés par le Site Twin (charpente, dalle, fondations, épaisseurs) ne sont volontairement pas inventés.</text>
    <text x="1080" y="24" font-size="11" font-weight="700" fill="#18181b">PILOTPAPER V2</text>
    <text x="1080" y="45" font-size="10" fill="#52525b">DP3 · Coupe A—A</text>
    <text x="1080" y="64" font-size="10" fill="#52525b">Pente : ${selectedFace.slopeDeg.toFixed(1)}°</text>
    <text x="1080" y="83" font-size="10" fill="#52525b">Digest : ${context.layoutDigest.slice(0, 12)}</text>
  </g>
</svg>`;

  return {
    dp: 3 as const,
    mimeType: "image/svg+xml",
    text: svg,
    receipt: receiptForPiece(context, 3),
    metrics: {
      groundElevationM: ground,
      eaveHeightM: rightHeight,
      ridgeHeightM: ridge ? ridgeHeight : undefined,
      slopeDeg: selectedFace.slopeDeg,
      sectionWidthM: buildingWidthM,
      selectedRampantM,
      sectionMode: ridge ? "perpendicular-to-ridge" : "single-slope",
      intersectedPvModules: modules.length,
    },
  };
}
