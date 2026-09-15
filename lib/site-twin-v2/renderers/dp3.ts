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

function pointAlong(origin: TwinXY, direction: TwinXY, distance: number): TwinXY {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
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

function extremeOnFace(face: SiteTwinRoofFace, origin: TwinXY, axis: TwinXY, mode: "min" | "max") {
  const ranked = face.polygonLocalM
    .map((point) => ({ point, value: dot({ x: point.x - origin.x, y: point.y - origin.y }, axis) }))
    .sort((a, b) => mode === "max" ? b.value - a.value : a.value - b.value);
  return ranked[0];
}

function moduleSectionSegments(context: SiteTwinDocumentContext, face: SiteTwinRoofFace, origin: TwinXY, axis: TwinXY, ground: number) {
  return context.layout.modules
    .filter((module) => module.faceId === face.id)
    .map((module, index) => {
      const projected = module.polygonLocalM.map((point) => ({
        q: dot({ x: point.x - origin.x, y: point.y - origin.y }, axis),
        point,
      }));
      const min = projected.reduce((best, candidate) => candidate.q < best.q ? candidate : best);
      const max = projected.reduce((best, candidate) => candidate.q > best.q ? candidate : best);
      return {
        index,
        minQ: min.q,
        maxQ: max.q,
        minHeight: zAt(face, min.point) - ground + 0.08,
        maxHeight: zAt(face, max.point) - ground + 0.08,
      };
    });
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
  let rightFace: SiteTwinRoofFace = selectedFace;
  let leftQ = 0;
  let rightQ = 0;
  let leftHeight = 0;
  let rightHeight = 0;
  let ridgeHeight = 0;
  let sectionLabel = "Coupe perpendiculaire à la ligne de plus grande pente";

  if (ridge) {
    origin = ridgeMidpoint(ridge);
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
    // Mono-pitch / roof without a proven ridge: use the metric downslope axis,
    // but never label the upper edge as a ridge.
    axis = normalize(faceDownslope(selectedFace));
    origin = selectedFace.centerLocalM;
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
  const width = 1400;
  const height = 920;
  const chart = { left: 120, right: 1280, top: 150, bottom: 700 };
  const minQ = Math.min(leftQ, 0);
  const maxQ = Math.max(rightQ, 0);
  const spanQ = Math.max(1, maxQ - minQ);
  const maxH = Math.max(maxHeightValue + 1.5, 6);
  const x = (q: number) => chart.left + ((q - minQ) / spanQ) * (chart.right - chart.left);
  const y = (heightM: number) => chart.bottom - (heightM / maxH) * (chart.bottom - chart.top);
  const ridgeX = x(0);
  const ridgeY = y(ridgeHeight);

  const roofSegments: string[] = [];
  if (ridge) {
    if (leftFace) roofSegments.push(`<line x1="${x(leftQ).toFixed(1)}" y1="${y(leftHeight).toFixed(1)}" x2="${ridgeX.toFixed(1)}" y2="${ridgeY.toFixed(1)}" stroke="#18181b" stroke-width="6"/>`);
    roofSegments.push(`<line x1="${ridgeX.toFixed(1)}" y1="${ridgeY.toFixed(1)}" x2="${x(rightQ).toFixed(1)}" y2="${y(rightHeight).toFixed(1)}" stroke="#18181b" stroke-width="6"/>`);
  } else {
    roofSegments.push(`<line x1="${x(leftQ).toFixed(1)}" y1="${y(leftHeight).toFixed(1)}" x2="${x(rightQ).toFixed(1)}" y2="${y(rightHeight).toFixed(1)}" stroke="#18181b" stroke-width="6"/>`);
  }

  const moduleLines = modules.map((module) => `<g>
    <line x1="${x(module.minQ).toFixed(1)}" y1="${y(module.minHeight).toFixed(1)}" x2="${x(module.maxQ).toFixed(1)}" y2="${y(module.maxHeight).toFixed(1)}" stroke="#0e7490" stroke-width="5"/>
    <text x="${x((module.minQ + module.maxQ) / 2).toFixed(1)}" y="${(y((module.minHeight + module.maxHeight) / 2) - 8).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="10">PV ${module.index + 1}</text>
  </g>`).join("\n  ");

  const leftWall = `<line x1="${x(leftQ).toFixed(1)}" y1="${chart.bottom}" x2="${x(leftQ).toFixed(1)}" y2="${y(leftHeight).toFixed(1)}" stroke="#71717a" stroke-width="4"/>`;
  const rightWall = `<line x1="${x(rightQ).toFixed(1)}" y1="${chart.bottom}" x2="${x(rightQ).toFixed(1)}" y2="${y(rightHeight).toFixed(1)}" stroke="#71717a" stroke-width="4"/>`;
  const selectedRampantM = ridge ? Math.hypot(rightQ, ridgeHeight - rightHeight) : Math.hypot(rightQ - leftQ, rightHeight - leftHeight);
  const buildingWidthM = Math.abs(rightQ - leftQ);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="70" y="54" font-family="Arial" font-size="28" font-weight="700">DP3 — Plan en coupe du terrain et de la construction</text>
  <text x="70" y="84" font-family="Arial" font-size="15" fill="#52525b">${escapeXml(twin.normalizedAddress)} · ${escapeXml(sectionLabel)} · Site Twin ${escapeXml(twin.id)} rev. ${twin.revision}</text>
  <line x1="${chart.left}" y1="${chart.bottom}" x2="${chart.right}" y2="${chart.bottom}" stroke="#18181b" stroke-width="3"/>
  <text x="${chart.left}" y="${chart.bottom + 26}" font-family="Arial" font-size="12">Terrain IGN MNT ${ground.toFixed(2)} m</text>
  ${leftWall}
  ${rightWall}
  ${roofSegments.join("\n  ")}
  ${moduleLines}
  ${ridge ? `<circle cx="${ridgeX.toFixed(1)}" cy="${ridgeY.toFixed(1)}" r="5" fill="#18181b"/><text x="${(ridgeX + 12).toFixed(1)}" y="${(ridgeY - 12).toFixed(1)}" font-family="Arial" font-size="12" font-weight="700">Faîtage ${ridgeHeight.toFixed(2)} m</text>` : ""}
  <line x1="${x(rightQ) + 34}" y1="${chart.bottom}" x2="${x(rightQ) + 34}" y2="${y(rightHeight)}" stroke="#a1a1aa" stroke-width="1"/>
  <text x="${x(rightQ) + 44}" y="${(chart.bottom + y(rightHeight)) / 2}" font-family="Arial" font-size="12">Égout projeté ${rightHeight.toFixed(2)} m</text>
  <line x1="${x(leftQ).toFixed(1)}" y1="${chart.bottom + 46}" x2="${x(rightQ).toFixed(1)}" y2="${chart.bottom + 46}" stroke="#71717a" stroke-width="1"/>
  <line x1="${x(leftQ).toFixed(1)}" y1="${chart.bottom + 39}" x2="${x(leftQ).toFixed(1)}" y2="${chart.bottom + 53}" stroke="#71717a"/>
  <line x1="${x(rightQ).toFixed(1)}" y1="${chart.bottom + 39}" x2="${x(rightQ).toFixed(1)}" y2="${chart.bottom + 53}" stroke="#71717a"/>
  <text x="${x((leftQ + rightQ) / 2).toFixed(1)}" y="${chart.bottom + 68}" text-anchor="middle" font-family="Arial" font-size="12">Largeur de coupe ${buildingWidthM.toFixed(2)} m</text>
  <text x="${x(rightQ / 2).toFixed(1)}" y="${Math.min(ridgeY, y(rightHeight)) - 32}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">Pan ${escapeXml(selectedFace.displayLabel)} · pente ${selectedFace.slopeDeg.toFixed(1)}° · rampant ${selectedRampantM.toFixed(2)} m</text>
  <g transform="translate(70,805)" font-family="Arial">
    <rect width="${width - 140}" height="76" rx="10" fill="#f4f4f5"/>
    <text x="18" y="24" font-size="13" font-weight="700">Coupe vectorielle calculée depuis la même géométrie métrique que DP2.</text>
    <text x="18" y="46" font-size="12" fill="#52525b">Toiture : ${escapeXml(twin.sources.geometryPrimarySource ?? "source métrique")} · terrain : IGN MNT · ${modules.length} modules du même calepinage · aucune cote architecturale inventée.</text>
    <text x="18" y="65" font-size="11" fill="#71717a">Les éléments non démontrés par le Site Twin ne sont pas ajoutés à la coupe.</text>
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
    },
  };
}
