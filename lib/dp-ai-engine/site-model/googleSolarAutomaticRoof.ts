import type { MetricFrame } from "../context/officialParcel";
import { toWebMercator } from "../context/officialParcel";
import type { Point2D } from "../types";
import type {
  GoogleSolarBuildingInsights,
  GoogleSolarPanel,
  GoogleSolarRoofSegment,
} from "../providers/googleSolar";
import type { ManualRoofDesign, ManualRoofQuad } from "./manualRoofDesigner";

const EARTH_RADIUS_M = 6_378_137;

type LocalPoint = { east: number; north: number };
type AxisPoint = { u: number; v: number; panel: GoogleSolarPanel };
type GooglePanelOrientation = "PORTRAIT" | "LANDSCAPE";

type GridCell = {
  row: number;
  column: number;
  point: AxisPoint;
};

export type GoogleSolarAutomaticRoofResult = {
  design: ManualRoofDesign & { obstaclesConfirmed: true };
  segmentIndex: number;
  segment: GoogleSolarRoofSegment;
  googleCandidateOrientation: GooglePanelOrientation;
  googlePanelCountUsedAsSafeArea: number;
  googlePanelWidthMeters: number;
  googlePanelHeightMeters: number;
  requestedArrayWidthMeters: number;
  requestedArraySlopeLengthMeters: number;
  safeAreaWidthMeters: number;
  safeAreaSlopeLengthMeters: number;
  yearlyEnergyDcKwh: number;
};

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function localPoint(point: { latitude: number; longitude: number }, origin: { latitude: number; longitude: number }): LocalPoint {
  const lat0 = radians(origin.latitude);
  return {
    east: radians(point.longitude - origin.longitude) * EARTH_RADIUS_M * Math.cos(lat0),
    north: radians(point.latitude - origin.latitude) * EARTH_RADIUS_M,
  };
}

function lonLatFromLocal(point: LocalPoint, origin: { latitude: number; longitude: number }) {
  const lat0 = radians(origin.latitude);
  return {
    latitude: origin.latitude + (point.north / EARTH_RADIUS_M) * (180 / Math.PI),
    longitude: origin.longitude + (point.east / (EARTH_RADIUS_M * Math.cos(lat0))) * (180 / Math.PI),
  };
}

function normalizedInFrame(point: { latitude: number; longitude: number }, frame: MetricFrame): Point2D {
  const projected = toWebMercator(point.longitude, point.latitude);
  return {
    x: (projected.x - frame.minX) / (frame.maxX - frame.minX),
    y: (frame.maxY - projected.y) / (frame.maxY - frame.minY),
  };
}

function clusterValues(values: number[], tolerance: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const value of sorted) {
    const previous = clusters.at(-1);
    if (!previous || Math.abs(value - previous.reduce((sum, item) => sum + item, 0) / previous.length) > tolerance) {
      clusters.push([value]);
    } else {
      previous.push(value);
    }
  }
  return clusters.map((cluster) => cluster.reduce((sum, item) => sum + item, 0) / cluster.length);
}

function nearestCluster(value: number, clusters: number[]) {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  clusters.forEach((candidate, index) => {
    const next = Math.abs(value - candidate);
    if (next < distance) {
      distance = next;
      best = index;
    }
  });
  return { index: best, distance };
}

function panelAxes(segment: GoogleSolarRoofSegment) {
  const azimuth = radians(segment.azimuthDegrees);
  // Google azimuth is clockwise from North. v is down-slope; u is along eave/ridge.
  const down = { east: Math.sin(azimuth), north: Math.cos(azimuth) };
  const along = { east: Math.cos(azimuth), north: -Math.sin(azimuth) };
  return { down, along };
}

function axisPoint(panel: GoogleSolarPanel, segment: GoogleSolarRoofSegment): AxisPoint {
  const point = localPoint(panel.center, segment.center);
  const { down, along } = panelAxes(segment);
  return {
    u: point.east * along.east + point.north * along.north,
    v: point.east * down.east + point.north * down.north,
    panel,
  };
}

function placementPenalty(args: {
  placement: "centered" | "left" | "right" | "custom";
  blockCenterColumn: number;
  totalColumns: number;
}) {
  const normalized = args.totalColumns <= 1 ? 0.5 : args.blockCenterColumn / (args.totalColumns - 1);
  if (args.placement === "left") return normalized;
  if (args.placement === "right") return 1 - normalized;
  return Math.abs(normalized - 0.5);
}

function rectangleCells(args: {
  cells: Map<string, GridCell>;
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
}) {
  const result: GridCell[] = [];
  for (let row = args.startRow; row < args.startRow + args.rows; row += 1) {
    for (let column = args.startColumn; column < args.startColumn + args.columns; column += 1) {
      const cell = args.cells.get(`${row}:${column}`);
      if (!cell) return undefined;
      result.push(cell);
    }
  }
  return result;
}

function automaticCandidateForSegment(args: {
  insights: GoogleSolarBuildingInsights;
  segmentIndex: number;
  candidateOrientation: GooglePanelOrientation;
  requestedRows: number;
  requestedColumns: number;
  requestedOrientation: "portrait" | "landscape";
  moduleWidthMeters: number;
  moduleHeightMeters: number;
  interPanelGapMeters: number;
  placement: "centered" | "left" | "right" | "custom";
}) {
  const segment = args.insights.solarPotential.roofSegmentStats[args.segmentIndex];
  if (!segment) return undefined;
  const panels = args.insights.solarPotential.solarPanels
    .filter((panel) => panel.segmentIndex === args.segmentIndex && panel.orientation === args.candidateOrientation);
  if (!panels.length) return undefined;

  const googlePanelWidth = args.insights.solarPotential.panelWidthMeters;
  const googlePanelHeight = args.insights.solarPotential.panelHeightMeters;
  const googleAlong = args.candidateOrientation === "PORTRAIT" ? googlePanelWidth : googlePanelHeight;
  const googleSlope = args.candidateOrientation === "PORTRAIT" ? googlePanelHeight : googlePanelWidth;
  const pitchCos = Math.max(0.2, Math.cos(radians(segment.pitchDegrees)));
  const googleSlopeGround = googleSlope * pitchCos;

  // The requested array is independent from Google's reference-panel orientation.
  // Google cells are only a proof that the underlying roof patch is admissible.
  const actualAlong = args.requestedOrientation === "portrait" ? args.moduleWidthMeters : args.moduleHeightMeters;
  const actualSlope = args.requestedOrientation === "portrait" ? args.moduleHeightMeters : args.moduleWidthMeters;
  const requestedWidth = args.requestedColumns * actualAlong + (args.requestedColumns - 1) * args.interPanelGapMeters;
  const requestedSlope = args.requestedRows * actualSlope + (args.requestedRows - 1) * args.interPanelGapMeters;

  const axisPoints = panels.map((panel) => axisPoint(panel, segment));
  const uClusters = clusterValues(axisPoints.map((point) => point.u), Math.max(0.18, googleAlong * 0.32));
  const vClusters = clusterValues(axisPoints.map((point) => point.v), Math.max(0.18, googleSlopeGround * 0.32));
  if (!uClusters.length || !vClusters.length) return undefined;

  const cells = new Map<string, GridCell>();
  for (const point of axisPoints) {
    const u = nearestCluster(point.u, uClusters);
    const v = nearestCluster(point.v, vClusters);
    if (u.index < 0 || v.index < 0) continue;
    if (u.distance > Math.max(0.28, googleAlong * 0.42) || v.distance > Math.max(0.28, googleSlopeGround * 0.42)) continue;
    const key = `${v.index}:${u.index}`;
    const existing = cells.get(key);
    if (!existing || (point.panel.yearlyEnergyDcKwh ?? 0) > (existing.point.panel.yearlyEnergyDcKwh ?? 0)) {
      cells.set(key, { row: v.index, column: u.index, point });
    }
  }

  // The number of Google cells is not the requested module count. Only the
  // physical union of a contiguous, fully occupied block matters.
  const minSupportColumns = Math.max(1, Math.ceil(requestedWidth / Math.max(0.1, googleAlong * 0.98)));
  const minSupportRows = Math.max(1, Math.ceil(requestedSlope / Math.max(0.1, googleSlope * 0.98)));
  const maxSupportColumns = Math.min(uClusters.length, minSupportColumns + 5);
  const maxSupportRows = Math.min(vClusters.length, minSupportRows + 5);

  let best: {
    cells: GridCell[];
    startRow: number;
    startColumn: number;
    rows: number;
    columns: number;
    score: number;
  } | undefined;

  for (let rows = minSupportRows; rows <= maxSupportRows; rows += 1) {
    for (let columns = minSupportColumns; columns <= maxSupportColumns; columns += 1) {
      for (let startRow = 0; startRow <= vClusters.length - rows; startRow += 1) {
        for (let startColumn = 0; startColumn <= uClusters.length - columns; startColumn += 1) {
          const block = rectangleCells({ cells, startRow, startColumn, rows, columns });
          if (!block) continue;
          const firstU = uClusters[startColumn]!;
          const lastU = uClusters[startColumn + columns - 1]!;
          const firstV = vClusters[startRow]!;
          const lastV = vClusters[startRow + rows - 1]!;
          const safeWidth = Math.abs(lastU - firstU) + googleAlong * 0.98;
          const safeSlopeGround = Math.abs(lastV - firstV) + googleSlopeGround * 0.98;
          const safeSlope = safeSlopeGround / pitchCos;
          if (requestedWidth > safeWidth + 0.02 || requestedSlope > safeSlope + 0.02) continue;
          const energy = block.reduce((sum, cell) => sum + (cell.point.panel.yearlyEnergyDcKwh ?? 0), 0);
          const centerColumn = startColumn + (columns - 1) / 2;
          const penalty = placementPenalty({
            placement: args.placement,
            blockCenterColumn: centerColumn,
            totalColumns: uClusters.length,
          });
          const excessArea = safeWidth * safeSlope - requestedWidth * requestedSlope;
          const score = energy - penalty * 100_000 - Math.max(0, excessArea) * 2;
          if (!best || score > best.score) {
            best = { cells: block, startRow, startColumn, rows, columns, score };
          }
        }
      }
    }
  }

  if (!best) return undefined;

  const firstU = uClusters[best.startColumn]!;
  const lastU = uClusters[best.startColumn + best.columns - 1]!;
  const firstV = vClusters[best.startRow]!;
  const lastV = vClusters[best.startRow + best.rows - 1]!;
  const uMin = Math.min(firstU, lastU) - googleAlong * 0.49;
  const uMax = Math.max(firstU, lastU) + googleAlong * 0.49;
  const vMin = Math.min(firstV, lastV) - googleSlopeGround * 0.49;
  const vMax = Math.max(firstV, lastV) + googleSlopeGround * 0.49;
  const safeWidth = uMax - uMin;
  const safeSlopeGround = vMax - vMin;
  const safeSlope = safeSlopeGround / pitchCos;
  if (requestedWidth > safeWidth + 0.03 || requestedSlope > safeSlope + 0.03) return undefined;

  const { down, along } = panelAxes(segment);
  function fromAxes(u: number, v: number): LocalPoint {
    return {
      east: along.east * u + down.east * v,
      north: along.north * u + down.north * v,
    };
  }

  // v increases down-slope (toward gutter). ManualRoofDesign requires gutter-left,
  // gutter-right, ridge-right, ridge-left.
  const localCorners = [
    fromAxes(uMin, vMax),
    fromAxes(uMax, vMax),
    fromAxes(uMax, vMin),
    fromAxes(uMin, vMin),
  ] as const;

  return {
    segment,
    candidateOrientation: args.candidateOrientation,
    localCorners,
    googlePanelCountUsedAsSafeArea: best.cells.length,
    yearlyEnergyDcKwh: best.cells.reduce((sum, cell) => sum + (cell.point.panel.yearlyEnergyDcKwh ?? 0), 0),
    requestedWidth,
    requestedSlope,
    safeWidth,
    safeSlope,
  };
}

/**
 * Converts Google's already-vetted contiguous panel cells into a deterministic
 * metric support for PilotPaper. Google decides where panels can safely exist;
 * PilotPaper still lays out the exact manufacturer dimensions/orientation from the form.
 */
export function automaticRoofDesignFromGoogleSolar(args: {
  insights: GoogleSolarBuildingInsights;
  frame: MetricFrame;
  requestedRows: number;
  requestedColumns: number;
  requestedOrientation: "portrait" | "landscape";
  moduleWidthMeters: number;
  moduleHeightMeters: number;
  interPanelGapMeters: number;
  placement: "centered" | "left" | "right" | "custom";
}): GoogleSolarAutomaticRoofResult {
  const orientations: GooglePanelOrientation[] = ["PORTRAIT", "LANDSCAPE"];
  const candidates = args.insights.solarPotential.roofSegmentStats
    .flatMap((_, segmentIndex) => orientations.map((candidateOrientation) => ({
      segmentIndex,
      candidate: automaticCandidateForSegment({ ...args, segmentIndex, candidateOrientation }),
    })))
    .filter((entry): entry is { segmentIndex: number; candidate: NonNullable<ReturnType<typeof automaticCandidateForSegment>> } => Boolean(entry.candidate));

  const best = candidates.sort((a, b) => b.candidate.yearlyEnergyDcKwh - a.candidate.yearlyEnergyDcKwh)[0];
  if (!best) {
    throw new Error(
      `Google Solar : aucun bloc sûr ${args.requestedRows}×${args.requestedColumns} ${args.requestedOrientation} n'accueille les dimensions réelles du module demandé.`,
    );
  }

  const quad = best.candidate.localCorners.map((corner) => {
    const latLng = lonLatFromLocal(corner, best.candidate.segment.center);
    return normalizedInFrame(latLng, args.frame);
  }) as ManualRoofQuad;

  if (quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    throw new Error("Google Solar : la zone sûre détectée sort du cadrage métrique PilotPaper.");
  }

  return {
    design: {
      quadNormalized: quad,
      slopeDeg: best.candidate.segment.pitchDegrees,
      keepouts: [],
      obstaclesConfirmed: true,
    },
    segmentIndex: best.segmentIndex,
    segment: best.candidate.segment,
    googleCandidateOrientation: best.candidate.candidateOrientation,
    googlePanelCountUsedAsSafeArea: best.candidate.googlePanelCountUsedAsSafeArea,
    googlePanelWidthMeters: args.insights.solarPotential.panelWidthMeters,
    googlePanelHeightMeters: args.insights.solarPotential.panelHeightMeters,
    requestedArrayWidthMeters: best.candidate.requestedWidth,
    requestedArraySlopeLengthMeters: best.candidate.requestedSlope,
    safeAreaWidthMeters: best.candidate.safeWidth,
    safeAreaSlopeLengthMeters: best.candidate.safeSlope,
    yearlyEnergyDcKwh: best.candidate.yearlyEnergyDcKwh,
  };
}
