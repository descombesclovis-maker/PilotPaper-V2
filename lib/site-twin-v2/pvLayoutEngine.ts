import { SITE_TWIN_POLICY, assertLayoutPolicy, assertTwinReadyForAutomaticDocuments } from "./policy";
import { SiteTwinError } from "./errors";
import type {
  PvConfiguration,
  PvFaceEligibility,
  PvLayoutSnapshot,
  PvModulePlacement,
  SiteTwin,
  SiteTwinRoofFace,
  TwinXY,
} from "./types";

type FaceBasis = {
  origin: TwinXY;
  cross: TwinXY;
  slopeHorizontal: TwinXY;
  cosSlope: number;
};

type FacePoint = { u: number; v: number };
type Bounds = { minU: number; maxU: number; minV: number; maxV: number };

function dot(a: TwinXY, b: TwinXY) {
  return a.x * b.x + a.y * b.y;
}

function basisForFace(face: SiteTwinRoofFace): FaceBasis {
  const azimuthRad = face.azimuthDeg * Math.PI / 180;
  const downslope = { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) };
  const upslope = { x: -downslope.x, y: -downslope.y };
  const cross = { x: upslope.y, y: -upslope.x };
  const cosSlope = Math.max(0.15, Math.cos(face.slopeDeg * Math.PI / 180));
  return { origin: face.centerLocalM, cross, slopeHorizontal: upslope, cosSlope };
}

function toFacePoint(point: TwinXY, basis: FaceBasis): FacePoint {
  const delta = { x: point.x - basis.origin.x, y: point.y - basis.origin.y };
  return {
    u: dot(delta, basis.cross),
    v: dot(delta, basis.slopeHorizontal) / basis.cosSlope,
  };
}

function fromFacePoint(point: FacePoint, basis: FaceBasis): TwinXY {
  const horizontalSlopeDistance = point.v * basis.cosSlope;
  return {
    x: basis.origin.x + basis.cross.x * point.u + basis.slopeHorizontal.x * horizontalSlopeDistance,
    y: basis.origin.y + basis.cross.y * point.u + basis.slopeHorizontal.y * horizontalSlopeDistance,
  };
}

function polygonContainsPoint(point: FacePoint, polygon: FacePoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects = ((a.v > point.v) !== (b.v > point.v))
      && point.u < ((b.u - a.u) * (point.v - a.v)) / ((b.v - a.v) || 1e-12) + a.u;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point: FacePoint, a: FacePoint, b: FacePoint) {
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-12) return Math.hypot(point.u - a.u, point.v - a.v);
  const t = Math.max(0, Math.min(1, ((point.u - a.u) * dx + (point.v - a.v) * dy) / denominator));
  return Math.hypot(point.u - (a.u + t * dx), point.v - (a.v + t * dy));
}

function clearanceToPolygon(point: FacePoint, polygon: FacePoint[]) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    best = Math.min(best, pointToSegmentDistance(point, polygon[i]!, polygon[(i + 1) % polygon.length]!));
  }
  return best;
}

function rectangleCorners(left: number, bottom: number, width: number, height: number): [FacePoint, FacePoint, FacePoint, FacePoint] {
  return [
    { u: left, v: bottom },
    { u: left + width, v: bottom },
    { u: left + width, v: bottom + height },
    { u: left, v: bottom + height },
  ];
}

function boundsFor(polygon: FacePoint[]): Bounds {
  return {
    minU: Math.min(...polygon.map((point) => point.u)),
    maxU: Math.max(...polygon.map((point) => point.u)),
    minV: Math.min(...polygon.map((point) => point.v)),
    maxV: Math.max(...polygon.map((point) => point.v)),
  };
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a.minU < b.maxU && a.maxU > b.minU && a.minV < b.maxV && a.maxV > b.minV;
}

function expandedBounds(polygon: FacePoint[], keepoutM: number): Bounds {
  const bounds = boundsFor(polygon);
  return {
    minU: bounds.minU - keepoutM,
    maxU: bounds.maxU + keepoutM,
    minV: bounds.minV - keepoutM,
    maxV: bounds.maxV + keepoutM,
  };
}

function faceGeometry(face: SiteTwinRoofFace) {
  const basis = basisForFace(face);
  const polygon = face.polygonLocalM.map((point) => toFacePoint(point, basis));
  if (polygon.length < 3) throw new SiteTwinError("PV_LAYOUT_INVALID", `Pan ${face.displayLabel} sans polygone exploitable.`);
  const minU = Math.min(...polygon.map((point) => point.u));
  const maxU = Math.max(...polygon.map((point) => point.u));
  const minV = Math.min(...polygon.map((point) => point.v));
  const maxV = Math.max(...polygon.map((point) => point.v));
  const obstacles = face.obstacles.map((obstacle) => ({
    obstacle,
    polygon: obstacle.polygonLocalM.map((point) => toFacePoint(point, basis)),
    keepoutM: Math.max(0, obstacle.keepoutMm ?? 0) / 1000,
  }));
  return { basis, polygon, minU, maxU, minV, maxV, obstacles };
}

function moduleDimensions(configuration: PvConfiguration) {
  const portrait = configuration.orientation === "portrait";
  return {
    widthM: (portrait ? configuration.moduleWidthMm : configuration.moduleHeightMm) / 1000,
    heightM: (portrait ? configuration.moduleHeightMm : configuration.moduleWidthMm) / 1000,
    gapM: Math.max(0, configuration.interPanelGapMm) / 1000,
  };
}

function candidateXPositions(args: {
  minU: number;
  maxU: number;
  arrayWidth: number;
  placement: PvConfiguration["placement"];
}) {
  const slack = args.maxU - args.minU - args.arrayWidth;
  if (slack < -1e-9) return [];
  const preferred = args.placement === "left"
    ? args.minU
    : args.placement === "right"
      ? args.maxU - args.arrayWidth
      : args.minU + slack / 2;
  const positions = [preferred];
  for (let offset = 0.05; offset <= slack / 2 + 0.001; offset += 0.05) {
    positions.push(preferred - offset, preferred + offset);
  }
  positions.push(args.minU, args.maxU - args.arrayWidth);
  return [...new Set(positions.map((value) => Math.round(value * 1000) / 1000))]
    .filter((value) => value >= args.minU - 1e-6 && value + args.arrayWidth <= args.maxU + 1e-6);
}

function validateModuleRectangle(
  corners: FacePoint[],
  polygon: FacePoint[],
  obstacles: Array<{ polygon: FacePoint[]; keepoutM: number; obstacle: SiteTwinRoofFace["obstacles"][number] }>,
) {
  if (!corners.every((corner) => polygonContainsPoint(corner, polygon) || clearanceToPolygon(corner, polygon) <= 0.002)) {
    return false;
  }
  const moduleBounds = boundsFor(corners);
  for (const item of obstacles) {
    if (item.polygon.length < 3) continue;
    // Keep-out belongs to physical truth. A panel is rejected even when it does
    // not touch the obstacle itself but enters its required safety envelope.
    if (boundsIntersect(moduleBounds, expandedBounds(item.polygon, item.keepoutM))) return false;
  }
  return true;
}

function tryLayoutOnFace(face: SiteTwinRoofFace, configuration: PvConfiguration) {
  const geometry = faceGeometry(face);
  const { widthM, heightM, gapM } = moduleDimensions(configuration);
  const arrayWidth = configuration.columns * widthM + Math.max(0, configuration.columns - 1) * gapM;
  const arrayHeight = configuration.rows * heightM + Math.max(0, configuration.rows - 1) * gapM;
  const preferredGutterM = Math.max(0, configuration.preferredGutterClearanceMm) / 1000;

  const gutterCandidates: number[] = [];
  for (let mm = Math.round(preferredGutterM * 1000); mm >= 0; mm -= 10) gutterCandidates.push(mm / 1000);
  if (!gutterCandidates.includes(0)) gutterCandidates.push(0);

  for (const gutterM of gutterCandidates) {
    const baseV = geometry.minV + gutterM;
    if (baseV + arrayHeight > geometry.maxV + 1e-6) continue;
    for (const leftU of candidateXPositions({
      minU: geometry.minU,
      maxU: geometry.maxU,
      arrayWidth,
      placement: configuration.placement,
    })) {
      const modules: PvModulePlacement[] = [];
      let valid = true;
      for (let row = 0; row < configuration.rows && valid; row += 1) {
        for (let column = 0; column < configuration.columns; column += 1) {
          const left = leftU + column * (widthM + gapM);
          const bottom = baseV + row * (heightM + gapM);
          const corners = rectangleCorners(left, bottom, widthM, heightM);
          if (!validateModuleRectangle(corners, geometry.polygon, geometry.obstacles)) {
            valid = false;
            break;
          }
          modules.push({
            moduleIndex: row * configuration.columns + column,
            faceId: face.id,
            polygonLocalM: corners.map((corner) => fromFacePoint(corner, geometry.basis)),
          });
        }
      }
      if (valid && modules.length === configuration.panelCount) {
        return { modules, resolvedGutterClearanceMm: Math.round(gutterM * 1000) };
      }
    }
  }
  return undefined;
}

function maximumPanelCount(face: SiteTwinRoofFace, configuration: PvConfiguration) {
  const geometry = faceGeometry(face);
  const { widthM, heightM, gapM } = moduleDimensions(configuration);
  const columns = Math.max(0, Math.floor((geometry.maxU - geometry.minU + gapM) / (widthM + gapM)));
  const rows = Math.max(0, Math.floor((geometry.maxV - geometry.minV + gapM) / (heightM + gapM)));
  return columns * rows;
}

function faceScore(face: SiteTwinRoofFace, resolvedGutterClearanceMm: number) {
  const southDelta = Math.min(Math.abs(face.azimuthDeg - 180), 360 - Math.abs(face.azimuthDeg - 180));
  return face.confidence * 100 + Math.min(face.areaM2, 200) * 0.15 - southDelta * 0.04 + resolvedGutterClearanceMm * 0.001;
}

export function buildPvLayout(args: {
  twin: SiteTwin;
  configuration: PvConfiguration;
  selectedFaceIds?: string[];
}): PvLayoutSnapshot {
  const twin = assertTwinReadyForAutomaticDocuments(args.twin);
  const configuration = args.configuration;
  if (configuration.rows * configuration.columns !== configuration.panelCount) {
    throw new SiteTwinError(
      "PV_LAYOUT_INVALID",
      `${configuration.rows} × ${configuration.columns} ne correspond pas à ${configuration.panelCount} modules.`,
    );
  }

  const attempts = new Map<string, ReturnType<typeof tryLayoutOnFace>>();
  const eligibility: PvFaceEligibility[] = twin.roof.faces.map((face) => {
    const attempt = tryLayoutOnFace(face, configuration);
    attempts.set(face.id, attempt);
    return {
      faceId: face.id,
      fits: Boolean(attempt),
      maximumPanelCount: maximumPanelCount(face, configuration),
      resolvedRows: attempt ? configuration.rows : undefined,
      resolvedColumns: attempt ? configuration.columns : undefined,
      resolvedGutterClearanceMm: attempt?.resolvedGutterClearanceMm,
      reasons: attempt
        ? [attempt.resolvedGutterClearanceMm === configuration.preferredGutterClearanceMm
          ? "Configuration exacte compatible avec le recul bas préféré et les zones de sécurité des obstacles."
          : `Configuration exacte compatible après réduction automatique du recul bas à ${attempt.resolvedGutterClearanceMm} mm, obstacles et zones de sécurité inclus.`]
        : ["La configuration exacte ne tient pas dans le polygone physique après prise en compte des obstacles, de leurs zones de sécurité et des dimensions réelles."],
    };
  });

  const requested = (args.selectedFaceIds ?? []).filter((id) => twin.roof.faces.some((face) => face.id === id));
  let selectedFace: SiteTwinRoofFace | undefined;
  if (requested.length) {
    if (requested.length > 1) {
      throw new SiteTwinError("PV_LAYOUT_INVALID", "Le moteur V1 accepte un seul champ photovoltaïque par pan sélectionné.");
    }
    selectedFace = twin.roof.faces.find((face) => face.id === requested[0]);
    if (!selectedFace || !attempts.get(selectedFace.id)) {
      throw new SiteTwinError("PV_LAYOUT_INVALID", "Le pan sélectionné ne peut pas accueillir la configuration exacte.", { recoverable: true });
    }
  } else {
    selectedFace = twin.roof.faces
      .filter((face) => Boolean(attempts.get(face.id)))
      .sort((a, b) => {
        const aa = attempts.get(a.id)!;
        const bb = attempts.get(b.id)!;
        return faceScore(b, bb!.resolvedGutterClearanceMm) - faceScore(a, aa!.resolvedGutterClearanceMm);
      })[0];
  }

  if (!selectedFace) {
    throw new SiteTwinError(
      "PV_LAYOUT_INVALID",
      "Aucun pan physique ne peut accueillir automatiquement la configuration demandée.",
      { recoverable: true, details: { eligibility } },
    );
  }
  const selectedAttempt = attempts.get(selectedFace.id);
  if (!selectedAttempt) throw new SiteTwinError("PV_LAYOUT_INVALID", "Calepinage sélectionné introuvable.");

  const layout: PvLayoutSnapshot = {
    siteTwinId: twin.id,
    siteTwinRevision: twin.revision,
    configuration: {
      ...configuration,
      preferredGutterClearanceMm: configuration.preferredGutterClearanceMm || SITE_TWIN_POLICY.preferredGutterClearanceMm,
    },
    selectedFaceIds: [selectedFace.id],
    eligibility,
    modules: selectedAttempt.modules,
  };
  return assertLayoutPolicy(twin, layout);
}
