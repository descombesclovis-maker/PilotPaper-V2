import type {
  FacePlacement,
  GeneratedAsset,
  PhysicalModulePlacement,
  ProjectContext,
  ProjectForm,
  QualityReport,
} from "../types";
import { materializePhysicalModules } from "../geometry/moduleGeometry";
import { checkSingleRoofPlaneFit, computePVField } from "../geometry/pvConstraints";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]!);
}

function m(mm: number | undefined) {
  return mm == null ? "—" : `${(mm / 1000).toFixed(2)} m`;
}

function finiteModule(placedModule: PhysicalModulePlacement) {
  return placedModule.polygonMm.length === 4 && placedModule.polygonMm.every(
    (point) => Number.isFinite(point.xMm) && Number.isFinite(point.yMm),
  );
}

/**
 * DP5 consumes the same physical module polygons as DP4/DP6. If V1.2 has
 * persisted authoritative polygons, an incomplete/corrupt set is rejected and
 * never silently reconstructed from rows/columns.
 */
export function physicalModulesForDP5(
  form: ProjectForm,
  placement: FacePlacement,
): PhysicalModulePlacement[] {
  const persisted = placement.modulePlacementsMm;
  const modules = persisted ?? materializePhysicalModules({
    placement,
    panel: form.panel,
    array: form.array,
  });

  if (persisted && persisted.length !== placement.panelCount) {
    throw new Error(
      `DP5 authoritative geometry rejected on face ${placement.faceId}: ${persisted.length} physical modules for ${placement.panelCount} expected.`,
    );
  }
  if (modules.length !== placement.panelCount || !modules.every(finiteModule)) {
    throw new Error(`DP5 could not obtain a complete physical module set for face ${placement.faceId}.`);
  }
  for (const placedModule of modules) {
    if (placedModule.faceId !== placement.faceId) {
      throw new Error(`DP5 module ${placedModule.index} belongs to ${placedModule.faceId}, expected face ${placement.faceId}.`);
    }
    if (
      placedModule.polygonMm.some(
        (point) =>
          point.xMm < -1e-6 ||
          point.yMm < -1e-6 ||
          point.xMm > placement.widthMm + 1e-6 ||
          point.yMm > placement.slopeLengthMm + 1e-6,
      )
    ) {
      throw new Error(`DP5 module ${placedModule.index} leaves physical face ${placement.faceId}.`);
    }
  }
  return modules;
}

function moduleBounds(modules: PhysicalModulePlacement[]) {
  const points = modules.flatMap((placedModule) => placedModule.polygonMm);
  return {
    minX: Math.min(...points.map((point) => point.xMm)),
    maxX: Math.max(...points.map((point) => point.xMm)),
    minY: Math.min(...points.map((point) => point.yMm)),
    maxY: Math.max(...points.map((point) => point.yMm)),
  };
}

function modulesSvg(args: {
  modules: PhysicalModulePlacement[];
  roofX: number;
  roofY: number;
  roofHeight: number;
  sx: number;
  sy: number;
  strokeWidth?: number;
}) {
  const { modules, roofX, roofY, roofHeight, sx, sy, strokeWidth = 1.5 } = args;
  return modules.map((placedModule) => {
    const points = placedModule.polygonMm.map((point) => {
      const x = roofX + point.xMm * sx;
      const y = roofY + roofHeight - point.yMm * sy;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    return `<polygon data-module-index="${placedModule.index}" points="${points}" fill="#152d4d" stroke="#eef4fb" stroke-width="${strokeWidth}"/>`;
  }).join("");
}

function buildMultiFaceDP5(
  form: ProjectForm,
  context: ProjectContext,
): { asset: GeneratedAsset; quality: QualityReport } {
  const placements = context.facePlacements ?? [];
  const W = 1200;
  const H = 900;
  const cardW = Math.min(500, 980 / Math.max(1, placements.length));
  const startX = (W - cardW * placements.length) / 2;
  let bodies = "";
  let observed = 0;

  placements.forEach((placement, index) => {
    const modules = physicalModulesForDP5(form, placement);
    observed += modules.length;
    const x = startX + index * cardW;
    const y = 205;
    const rw = cardW - 24;
    const rh = 420;
    const sx = rw / placement.widthMm;
    const sy = rh / placement.slopeLengthMm;
    const panels = modulesSvg({ modules, roofX: x + 12, roofY: y, roofHeight: rh, sx, sy, strokeWidth: 1 });

    bodies += `<g>
      <rect x="${x + 12}" y="${y}" width="${rw}" height="${rh}" fill="#c98355" stroke="#222" stroke-width="2"/>
      <line x1="${x + 12}" y1="${y}" x2="${x + 12 + rw}" y2="${y}" stroke="#111" stroke-width="5"/>
      ${panels}
      <text x="${x + 18}" y="${y - 18}" font-family="Arial" font-size="18" font-weight="700">Pan ${esc(placement.faceId)} — ${placement.panelCount} modules</text>
      <text x="${x + 18}" y="${y + rh + 30}" font-family="Arial" font-size="14">${placement.rows} rangée(s), jusqu’à ${placement.columns} colonnes · recul bas ${Math.round(placement.resolvedGutterMm)} mm</text>
    </g>`;
  });

  if (observed !== context.exactPanelCount) {
    throw new Error(`DP5 physical geometry contains ${observed} modules, expected ${context.exactPanelCount}.`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="18" y="18" width="1164" height="864" fill="white" stroke="#222" stroke-width="2"/>
    <text x="55" y="70" font-family="Arial" font-size="42" font-weight="700">DP5</text>
    <text x="165" y="70" font-family="Arial" font-size="30" font-weight="700">Plan des toitures — répartition multi-pans</text>
    <text x="55" y="110" font-family="Arial" font-size="16">${esc(form.address)}</text>
    ${bodies}
    <rect x="55" y="690" width="1090" height="120" fill="#fafafa" stroke="#bbb"/>
    <text x="80" y="722" font-family="Arial" font-size="17" font-weight="700">${context.exactPanelCount} panneaux au total — ${placements.length} champs indépendants</text>
    <text x="80" y="752" font-family="Arial" font-size="15">Coordonnées physiques identiques aux insertions DP4/DP6.</text>
    <text x="80" y="782" font-family="Arial" font-size="15">Répartition : ${placements.map((placement) => `Pan ${esc(placement.faceId)} : ${placement.panelCount}`).join(" · ")}</text>
    <text x="55" y="857" font-family="Arial" font-size="13">DP AI Engine — géométrie physique déterministe, rendu non génératif</text>
  </svg>`;

  const quality: QualityReport = {
    passed: true,
    score: 1,
    panelCountObserved: observed,
    buildingPreserved: true,
    perspectiveCoherent: true,
    scaleCoherent: true,
    placementCoherent: true,
    roofFaceCorrect: true,
    insideSelectedRoofFace: true,
    singleRoofPlane: placements.length === 1,
    crossesRidge: false,
    arrayGeometryConsistent: true,
    expectedFaceAllocationsMatched: true,
    issues: [],
    correctionPrompt: "",
  };
  return { asset: { dp: 5, kind: "svg", mimeType: "image/svg+xml", text: svg, attempt: 1 }, quality };
}

function legacySinglePlacement(form: ProjectForm): {
  placement: FacePlacement;
  calibrated: boolean;
  source?: string;
} {
  const fit = checkSingleRoofPlaneFit(form);
  const field = computePVField(form.panel, form.array);
  if (fit.calibrated && !fit.fits) {
    throw new Error(`DP5 geometry rejected before rendering: ${fit.reasons.join(" ")}`);
  }
  const roofWmm = form.roofGeometry?.widthMm ?? Math.max(field.fieldWidthMm + 1600, field.fieldWidthMm * 1.25);
  const roofHmm = form.roofGeometry?.slopeLengthMm ?? Math.max(field.fieldHeightMm + 1200, field.fieldHeightMm * 1.35);
  const leftMm = fit.leftMm ?? (roofWmm - field.fieldWidthMm) / 2;
  const rightMm = fit.rightMm ?? roofWmm - field.fieldWidthMm - leftMm;
  const gutterMm = fit.gutterMm ?? (form.array.gutterClearanceMm ?? 300);
  const ridgeMm = fit.ridgeMm ?? roofHmm - gutterMm - field.fieldHeightMm;
  return {
    placement: {
      faceId: form.array.roofFace || "A",
      label: form.array.roofFace || "Pan A",
      panelCount: form.array.rows * form.array.columns,
      rows: form.array.rows,
      columns: form.array.columns,
      lastRowCount: form.array.columns,
      resolvedGutterMm: gutterMm,
      resolvedRidgeMm: ridgeMm,
      resolvedLeftMm: leftMm,
      resolvedRightMm: rightMm,
      widthMm: roofWmm,
      slopeLengthMm: roofHmm,
    },
    calibrated: fit.calibrated,
    source: form.roofGeometry?.source,
  };
}

export function buildDP5RoofPlan(
  form: ProjectForm,
  context: ProjectContext,
): { asset: GeneratedAsset; quality: QualityReport } {
  if ((context.facePlacements?.length ?? 0) > 1) return buildMultiFaceDP5(form, context);

  const contextPlacement = context.facePlacements?.[0];
  const legacy = contextPlacement ? undefined : legacySinglePlacement(form);
  const placement = contextPlacement ?? legacy!.placement;
  const modules = physicalModulesForDP5(form, placement);
  if (modules.length !== context.exactPanelCount) {
    throw new Error(`DP5 contains ${modules.length} physical modules, expected ${context.exactPanelCount}.`);
  }

  const bounds = moduleBounds(modules);
  const roofWmm = placement.widthMm;
  const roofHmm = placement.slopeLengthMm;
  const W = 1200;
  const H = 900;
  const roofW = 780;
  const roofH = Math.min(430, roofW * (roofHmm / roofWmm));
  const rx = 150;
  const ry = 205;
  const sx = roofW / roofWmm;
  const sy = roofH / roofHmm;
  const panels = modulesSvg({ modules, roofX: rx, roofY: ry, roofHeight: roofH, sx, sy });
  const fieldX = rx + bounds.minX * sx;
  const fieldY = ry + roofH - bounds.maxY * sy;
  const fieldW = (bounds.maxX - bounds.minX) * sx;
  const fieldH = (bounds.maxY - bounds.minY) * sy;
  const leftMm = placement.resolvedLeftMm ?? bounds.minX;
  const rightMm = placement.resolvedRightMm ?? roofWmm - bounds.maxX;
  const gutterMm = placement.resolvedGutterMm;
  const ridgeMm = placement.resolvedRidgeMm ?? roofHmm - bounds.maxY;
  const calibrated = contextPlacement ? true : Boolean(legacy?.calibrated);
  const source = context.roofGeometry?.source ?? legacy?.source ?? "donnée projet";
  const metricNote = calibrated
    ? `Implantation métrique — source : ${source}`
    : "Pan non calibré métriquement — cotes du pan à confirmer";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="tiles" width="28" height="18" patternUnits="userSpaceOnUse">
      <rect width="28" height="18" fill="#c98355"/>
      <path d="M0 9 H28 M14 0 V9 M0 18 V9 M28 18 V9" stroke="#a96543" stroke-width="1" opacity="0.55"/>
    </pattern>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#222"/></marker>
  </defs>
  <rect x="18" y="18" width="1164" height="864" fill="white" stroke="#222" stroke-width="2"/>
  <text x="55" y="70" font-family="Arial,sans-serif" font-size="42" font-weight="700">DP5</text>
  <text x="165" y="70" font-family="Arial,sans-serif" font-size="30" font-weight="700">Plan des toitures</text>
  <text x="55" y="108" font-family="Arial,sans-serif" font-size="17">Projet : ${esc(form.address)}</text>
  <text x="55" y="134" font-family="Arial,sans-serif" font-size="15">Pan sélectionné : ${esc(placement.faceId)} — ${metricNote}</text>

  <g transform="translate(1035 70)">
    <circle cx="45" cy="42" r="31" fill="none" stroke="#111" stroke-width="2"/>
    <path d="M45 5 L34 45 L45 38 L56 45 Z" fill="#111"/>
    <text x="39" y="92" font-family="Arial" font-size="18" font-weight="700">N</text>
  </g>

  <rect x="${rx}" y="${ry}" width="${roofW}" height="${roofH}" fill="url(#tiles)" stroke="#333" stroke-width="3"/>
  <line x1="${rx}" y1="${ry}" x2="${rx + roofW}" y2="${ry}" stroke="#111" stroke-width="6"/>
  <text x="${rx + roofW - 155}" y="${ry - 14}" font-family="Arial" font-size="14" font-weight="700">FAÎTAGE</text>
  <line x1="${rx}" y1="${ry + roofH}" x2="${rx + roofW}" y2="${ry + roofH}" stroke="#444" stroke-width="5"/>
  <text x="${rx + roofW - 160}" y="${ry + roofH + 27}" font-family="Arial" font-size="14" font-weight="700">GOUTTIÈRE</text>
  ${panels}
  <rect x="${fieldX}" y="${fieldY}" width="${fieldW}" height="${fieldH}" fill="none" stroke="#081a2d" stroke-width="3"/>

  <line x1="${rx}" y1="${ry - 28}" x2="${rx + roofW}" y2="${ry - 28}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <line x1="${rx}" y1="${ry - 18}" x2="${rx}" y2="${ry - 40}" stroke="#222"/>
  <line x1="${rx + roofW}" y1="${ry - 18}" x2="${rx + roofW}" y2="${ry - 40}" stroke="#222"/>
  <text x="${rx + roofW / 2 - 35}" y="${ry - 39}" font-family="Arial" font-size="16" font-weight="700">${m(roofWmm)}</text>
  <line x1="${rx - 55}" y1="${ry}" x2="${rx - 55}" y2="${ry + roofH}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="${rx - 118}" y="${ry + roofH / 2}" font-family="Arial" font-size="16" font-weight="700" transform="rotate(-90 ${rx - 118} ${ry + roofH / 2})">${m(roofHmm)}</text>

  <rect x="55" y="680" width="1090" height="145" fill="#fafafa" stroke="#bbb"/>
  <rect x="82" y="705" width="36" height="22" fill="#152d4d"/><text x="132" y="722" font-family="Arial" font-size="16">Panneaux photovoltaïques projetés</text>
  <rect x="82" y="741" width="36" height="22" fill="url(#tiles)" stroke="#a96543"/><text x="132" y="758" font-family="Arial" font-size="16">Toiture existante — un seul pan autorisé</text>
  <text x="580" y="718" font-family="Arial" font-size="17" font-weight="700">${context.exactPanelCount} panneaux — ${placement.rows} × ${placement.columns} — ${form.array.orientation}</text>
  <text x="580" y="748" font-family="Arial" font-size="15">Champ physique : ${m(bounds.maxX - bounds.minX)} × ${m(bounds.maxY - bounds.minY)}</text>
  <text x="580" y="776" font-family="Arial" font-size="15">Rives : ${m(leftMm)} / ${m(rightMm)} — gouttière : ${m(gutterMm)} — faîtage : ${m(ridgeMm)}</text>
  <text x="82" y="808" font-family="Arial" font-size="14" font-weight="700">Contrôle : DP5 utilise les coordonnées physiques autoritatives partagées avec DP4 et DP6.</text>
  <text x="55" y="857" font-family="Arial" font-size="13">DP AI Engine — plan généré à partir des données projet autoritatives</text>
</svg>`;

  const issues = calibrated ? [] : [{
    code: "METRIC_ROOF_UNCALIBRATED",
    severity: "warning" as const,
    message: "Selected roof face lacks an authoritative metric width/slope length.",
    correction: "Provide or derive roofGeometry before production certification.",
  }];
  const quality: QualityReport = {
    passed: true,
    score: calibrated ? 1 : 0.93,
    panelCountObserved: modules.length,
    rowsObserved: placement.rows,
    columnsObserved: placement.columns,
    buildingPreserved: true,
    perspectiveCoherent: true,
    scaleCoherent: true,
    placementCoherent: true,
    roofFaceCorrect: true,
    insideSelectedRoofFace: true,
    singleRoofPlane: true,
    crossesRidge: false,
    arrayGeometryConsistent: true,
    issues,
    correctionPrompt: "",
  };
  return { asset: { dp: 5, kind: "svg", mimeType: "image/svg+xml", text: svg, attempt: 1 }, quality };
}
