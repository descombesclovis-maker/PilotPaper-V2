import { SiteTwinError } from "./errors";
import { assertPiecesShareContext, type SiteTwinDocumentContext, type SiteTwinPieceReceipt } from "./documentContext";
import { assertCameraRegistrationForDp6, assertLayoutPolicy, assertTwinReadyForAutomaticDocuments } from "./policy";
import type { SiteTwinRoofFace, TwinXY } from "./types";

export type InspectorCheck = {
  id: string;
  passed: boolean;
  critical: boolean;
  message: string;
};

export type InspectorReport = {
  passed: boolean;
  score: number;
  checks: InspectorCheck[];
};

type NormalizedPoint = { x: number; y: number };

function push(checks: InspectorCheck[], id: string, passed: boolean, critical: boolean, message: string) {
  checks.push({ id, passed, critical, message });
}

function pointToSegmentDistance(point: TwinXY, a: TwinXY, b: TwinXY) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function pointInsideOrOnPolygon(point: TwinXY, polygon: TwinXY[], toleranceM = 0.005) {
  if (polygon.length < 3) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointToSegmentDistance(point, polygon[index]!, polygon[(index + 1) % polygon.length]!) <= toleranceM) return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function zAt(face: SiteTwinRoofFace, point: TwinXY) {
  return face.plane.a * point.x + face.plane.b * point.y + face.plane.c;
}

function distance3d(face: SiteTwinRoofFace, a: TwinXY, b: TwinXY) {
  return Math.hypot(b.x - a.x, b.y - a.y, zAt(face, b) - zAt(face, a));
}

function projectionInterval(polygon: NormalizedPoint[], axis: NormalizedPoint) {
  const values = polygon.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function convexPolygonsStrictlyOverlap(a: NormalizedPoint[], b: NormalizedPoint[], tolerance = 1e-7) {
  const axes: NormalizedPoint[] = [];
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const first = polygon[index]!;
      const second = polygon[(index + 1) % polygon.length]!;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      if (length > 1e-12) axes.push({ x: -dy / length, y: dx / length });
    }
  }
  for (const axis of axes) {
    const aa = projectionInterval(a, axis);
    const bb = projectionInterval(b, axis);
    if (Math.min(aa.max, bb.max) - Math.max(aa.min, bb.min) <= tolerance) return false;
  }
  return true;
}

function signedPolygonArea(polygon: NormalizedPoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea / 2;
}

function convexQuadrilateral(polygon: NormalizedPoint[]) {
  if (polygon.length !== 4) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % 4]!;
    const c = polygon[(index + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= 1e-10) return false;
    const current = Math.sign(cross);
    if (sign && current !== sign) return false;
    sign = current;
  }
  return true;
}

function metricGeometryChecks(context: SiteTwinDocumentContext) {
  const checks: InspectorCheck[] = [];
  const expectedWidthM = (context.layout.configuration.orientation === "portrait"
    ? context.layout.configuration.moduleWidthMm
    : context.layout.configuration.moduleHeightMm) / 1000;
  const expectedHeightM = (context.layout.configuration.orientation === "portrait"
    ? context.layout.configuration.moduleHeightMm
    : context.layout.configuration.moduleWidthMm) / 1000;
  const dimensionToleranceM = 0.02;
  let finiteAndFourCorners = true;
  let dimensionsCorrect = true;
  let insideFaces = true;
  let physicalObstacleOverlap = false;
  const polygonsByFace = new Map<string, NormalizedPoint[][]>();

  for (const module of context.layout.modules) {
    const face = context.siteTwin.roof.faces.find((candidate) => candidate.id === module.faceId);
    if (!face || module.polygonLocalM.length !== 4 || module.polygonLocalM.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      finiteAndFourCorners = false;
      dimensionsCorrect = false;
      insideFaces = false;
      continue;
    }
    const [a, b, c, d] = module.polygonLocalM;
    const width1 = distance3d(face, a!, b!);
    const width2 = distance3d(face, d!, c!);
    const height1 = distance3d(face, b!, c!);
    const height2 = distance3d(face, a!, d!);
    if ([width1, width2].some((value) => Math.abs(value - expectedWidthM) > dimensionToleranceM)
      || [height1, height2].some((value) => Math.abs(value - expectedHeightM) > dimensionToleranceM)) {
      dimensionsCorrect = false;
    }
    if (!module.polygonLocalM.every((point) => pointInsideOrOnPolygon(point, face.polygonLocalM))) insideFaces = false;
    for (const obstacle of face.obstacles) {
      if (obstacle.polygonLocalM.length >= 3
        && convexPolygonsStrictlyOverlap(module.polygonLocalM, obstacle.polygonLocalM)) physicalObstacleOverlap = true;
    }
    const facePolygons = polygonsByFace.get(face.id) ?? [];
    facePolygons.push(module.polygonLocalM);
    polygonsByFace.set(face.id, facePolygons);
  }

  let modulesOverlap = false;
  for (const polygons of polygonsByFace.values()) {
    for (let first = 0; first < polygons.length - 1; first += 1) {
      for (let second = first + 1; second < polygons.length; second += 1) {
        if (convexPolygonsStrictlyOverlap(polygons[first]!, polygons[second]!, 0.0005)) modulesOverlap = true;
      }
    }
  }

  push(checks, "metric-module-quadrilaterals", finiteAndFourCorners, true,
    finiteAndFourCorners ? "Chaque module possède exactement quatre sommets métriques finis." : "Au moins un module ne possède pas quatre sommets métriques valides.");
  push(checks, "metric-module-dimensions", dimensionsCorrect, true,
    dimensionsCorrect ? `Dimensions 3D de chaque module conformes à ${expectedWidthM.toFixed(3)} × ${expectedHeightM.toFixed(3)} m.` : "Au moins un module ne respecte pas ses dimensions fabricant sur le plan de toiture.");
  push(checks, "metric-module-inside-face", insideFaces, true,
    insideFaces ? "Tous les sommets de modules restent dans leurs pans physiques." : "Au moins un sommet photovoltaïque sort du pan physique.");
  push(checks, "metric-module-overlap", !modulesOverlap, true,
    modulesOverlap ? "Deux modules photovoltaïques se chevauchent dans la géométrie métrique." : "Aucun chevauchement entre modules métriques.");
  push(checks, "metric-obstacle-overlap", !physicalObstacleOverlap, true,
    physicalObstacleOverlap ? "Un module chevauche physiquement un obstacle de toiture." : "Aucun module ne chevauche physiquement un obstacle de toiture.");
  return checks;
}

export function inspectCanonicalContext(context: SiteTwinDocumentContext): InspectorReport {
  const checks: InspectorCheck[] = [];
  try {
    assertTwinReadyForAutomaticDocuments(context.siteTwin);
    push(checks, "twin-ready", true, true, "Site Twin géométriquement exploitable.");
  } catch (error) {
    push(checks, "twin-ready", false, true, error instanceof Error ? error.message : "Site Twin invalide.");
  }

  try {
    assertLayoutPolicy(context.siteTwin, context.layout);
    push(checks, "layout-policy", true, true, "Calepinage cohérent avec le Site Twin.");
  } catch (error) {
    push(checks, "layout-policy", false, true, error instanceof Error ? error.message : "Calepinage invalide.");
  }

  const exactCount = context.layout.modules.length === context.layout.configuration.panelCount;
  push(
    checks,
    "exact-module-count",
    exactCount,
    true,
    exactCount
      ? `${context.layout.modules.length} modules exactement.`
      : `${context.layout.modules.length} modules présents au lieu de ${context.layout.configuration.panelCount}.`,
  );

  const physicalFaceIds = new Set(context.siteTwin.roof.faces.map((face) => face.id));
  const moduleFacesValid = context.layout.modules.every((module) => physicalFaceIds.has(module.faceId));
  push(checks, "module-face-identity", moduleFacesValid, true, moduleFacesValid
    ? "Tous les modules appartiennent à des pans physiques canoniques."
    : "Au moins un module cible un pan inexistant.");

  const allFacesExplicit = context.siteTwin.roof.faces.every((face) => context.layout.eligibility.some((entry) => entry.faceId === face.id));
  push(checks, "all-physical-faces-preserved", allFacesExplicit, true, allFacesExplicit
    ? "Tous les pans physiques restent présents, y compris incompatibles."
    : "Des pans physiques ont disparu de l'éligibilité PV.");

  checks.push(...metricGeometryChecks(context));

  const criticalFailures = checks.filter((check) => check.critical && !check.passed).length;
  const passedCount = checks.filter((check) => check.passed).length;
  return {
    passed: criticalFailures === 0,
    score: checks.length ? passedCount / checks.length : 0,
    checks,
  };
}

export function inspectProjectedModuleGeometry(polygons: NormalizedPoint[][], expectedCount: number): InspectorReport {
  const checks: InspectorCheck[] = [];
  const countCorrect = polygons.length === expectedCount;
  push(checks, "projected-module-count", countCorrect, true,
    countCorrect ? `${polygons.length} quadrilatères projetés exactement.` : `${polygons.length} quadrilatères projetés au lieu de ${expectedCount}.`);

  const fourFiniteCorners = polygons.every((polygon) => polygon.length === 4
    && polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  push(checks, "projected-four-corners", fourFiniteCorners, true,
    fourFiniteCorners ? "Chaque module projeté possède quatre sommets finis." : "Projection photovoltaïque avec sommets manquants ou non finis.");

  const entirelyVisible = fourFiniteCorners && polygons.every((polygon) => polygon.every((point) => (
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  )));
  push(checks, "projected-inside-photo", entirelyVisible, true,
    entirelyVisible ? "Tous les modules projetés sont entièrement visibles dans la photographie." : "Au moins un module projeté sort du cadrage photographique.");

  const nonDegenerate = fourFiniteCorners && polygons.every((polygon) => Math.abs(signedPolygonArea(polygon)) > 1e-8 && convexQuadrilateral(polygon));
  push(checks, "projected-convex-area", nonDegenerate, true,
    nonDegenerate ? "Tous les modules projetés forment des quadrilatères convexes non dégénérés." : "Au moins un module projeté est dégénéré, inversé ou non convexe.");

  let overlap = false;
  if (fourFiniteCorners) {
    for (let first = 0; first < polygons.length - 1 && !overlap; first += 1) {
      for (let second = first + 1; second < polygons.length; second += 1) {
        if (convexPolygonsStrictlyOverlap(polygons[first]!, polygons[second]!, 1e-7)) {
          overlap = true;
          break;
        }
      }
    }
  }
  push(checks, "projected-module-overlap", !overlap, true,
    overlap ? "Deux modules se chevauchent après projection caméra." : "Aucun chevauchement de modules après projection caméra.");

  const criticalFailures = checks.filter((check) => check.critical && !check.passed).length;
  const passedCount = checks.filter((check) => check.passed).length;
  return { passed: criticalFailures === 0, score: checks.length ? passedCount / checks.length : 0, checks };
}

export function inspectDp6Registration(context: SiteTwinDocumentContext, photoId: string): InspectorCheck {
  try {
    const registration = assertCameraRegistrationForDp6(context.siteTwin, photoId);
    return {
      id: "dp6-camera-registration",
      passed: true,
      critical: true,
      message: `Photo recalée (${registration.reprojectionErrorPx?.toFixed(1) ?? "?"} px d'erreur).`,
    };
  } catch (error) {
    return {
      id: "dp6-camera-registration",
      passed: false,
      critical: true,
      message: error instanceof Error ? error.message : "Recalage DP6 invalide.",
    };
  }
}

export function inspectCrossPieceConsistency(
  context: SiteTwinDocumentContext,
  receipts: SiteTwinPieceReceipt[],
): InspectorReport {
  const base = inspectCanonicalContext(context);
  const checks = [...base.checks];
  try {
    assertPiecesShareContext(context, receipts);
    push(checks, "cross-piece-context", true, true, "Toutes les DP utilisent exactement la même révision Site Twin et le même calepinage.");
  } catch (error) {
    push(checks, "cross-piece-context", false, true, error instanceof Error ? error.message : "Incohérence inter-pièces.");
  }
  const criticalFailures = checks.filter((check) => check.critical && !check.passed).length;
  const passedCount = checks.filter((check) => check.passed).length;
  return { passed: criticalFailures === 0, score: checks.length ? passedCount / checks.length : 0, checks };
}

export function requireInspectorPass(report: InspectorReport) {
  const critical = report.checks.filter((check) => check.critical && !check.passed);
  if (critical.length) {
    throw new SiteTwinError(
      "CROSS_PIECE_INCONSISTENCY",
      `PilotPaper Inspector rejette la sortie : ${critical.map((check) => check.message).join(" | ")}`,
      { recoverable: true, details: { checks: report.checks } },
    );
  }
  return report;
}
