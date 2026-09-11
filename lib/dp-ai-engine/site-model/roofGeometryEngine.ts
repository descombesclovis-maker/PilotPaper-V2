import { toWebMercator, type LonLat } from "../context/officialParcel";
import type { BuildingFootprint, LidarHeightSample, RoofPlaneModel, SiteObstacle, SiteRoofModel } from "./types";

type LocalSample = LidarHeightSample & { x: number; y: number };
type LocalPoint = { x: number; y: number };
type Plane = { a: number; b: number; c: number };

function finite(value: number) {
  return Number.isFinite(value);
}

function localizeSamples(samples: LidarHeightSample[], origin: LonLat): LocalSample[] {
  const base = toWebMercator(origin[0], origin[1]);
  return samples.map((sample) => {
    const p = toWebMercator(sample.longitude, sample.latitude);
    return { ...sample, x: p.x - base.x, y: p.y - base.y };
  });
}

function centroidLonLat(building: BuildingFootprint): LonLat {
  return building.centroid;
}

function planeFrom3(p1: LocalSample, p2: LocalSample, p3: LocalSample): Plane | undefined {
  const x1 = p1.x; const y1 = p1.y; const z1 = p1.surfaceZ;
  const x2 = p2.x; const y2 = p2.y; const z2 = p2.surfaceZ;
  const x3 = p3.x; const y3 = p3.y; const z3 = p3.surfaceZ;
  const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
  if (Math.abs(det) < 1e-8) return undefined;
  const a = (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / det;
  const b = (x1 * (z2 - z3) + x2 * (z3 - z1) + x3 * (z1 - z2)) / det;
  const c = (
    x1 * (y3 * z2 - y2 * z3)
    + x2 * (y1 * z3 - y3 * z1)
    + x3 * (y2 * z1 - y1 * z2)
  ) / det;
  return [a, b, c].every(finite) ? { a, b, c } : undefined;
}

function solve3x3(matrix: number[][], rhs: number[]) {
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return undefined;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = a[col]![col]!;
    for (let j = col; j < 4; j++) a[col]![j] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      for (let j = col; j < 4; j++) a[row]![j] -= factor * a[col]![j]!;
    }
  }
  return [a[0]![3]!, a[1]![3]!, a[2]![3]!] as const;
}

export function fitPlaneLeastSquares(points: LocalSample[]): Plane | undefined {
  if (points.length < 3) return undefined;
  let sx = 0; let sy = 0; let sz = 0;
  let sxx = 0; let syy = 0; let sxy = 0; let sxz = 0; let syz = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sz += p.surfaceZ;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * p.surfaceZ; syz += p.y * p.surfaceZ;
  }
  const solved = solve3x3(
    [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]],
    [sxz, syz, sz],
  );
  return solved ? { a: solved[0], b: solved[1], c: solved[2] } : undefined;
}

function predictedZ(plane: Plane, point: LocalPoint) {
  return plane.a * point.x + plane.b * point.y + plane.c;
}

function residual(plane: Plane, point: LocalSample) {
  return point.surfaceZ - predictedZ(plane, point);
}

function planeRms(plane: Plane, points: LocalSample[]) {
  if (!points.length) return Infinity;
  return Math.sqrt(points.reduce((sum, point) => sum + residual(plane, point) ** 2, 0) / points.length);
}

function xorshift32(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function convexHull(points: LocalPoint[]) {
  const unique = [...new Map(points.map((p) => [`${p.x.toFixed(5)}:${p.y.toFixed(5)}`, p])).values()];
  if (unique.length <= 3) return unique;
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: LocalPoint, a: LocalPoint, b: LocalPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: LocalPoint[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LocalPoint[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!; const b = polygon[j]!;
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function slopeAndAzimuth(plane: Plane) {
  const gradient = Math.hypot(plane.a, plane.b);
  const slopeDeg = Math.atan(gradient) * 180 / Math.PI;
  // gradient points uphill. Geographic x=east, y=north in local WebMercator.
  const uphillAzimuth = (Math.atan2(plane.a, plane.b) * 180 / Math.PI + 360) % 360;
  const downslopeAzimuth = (uphillAzimuth + 180) % 360;
  return { slopeDeg, azimuthDeg: downslopeAzimuth };
}

function projectionQuad(points: LocalPoint[], plane: Plane): RoofPlaneModel["projectionQuadLocalM"] {
  const norm = Math.hypot(plane.a, plane.b);
  const up = norm > 1e-9 ? { x: plane.a / norm, y: plane.b / norm } : { x: 0, y: 1 };
  const along = { x: up.y, y: -up.x };
  const projected = points.map((point) => ({
    point,
    u: point.x * along.x + point.y * along.y,
    v: point.x * up.x + point.y * up.y,
  }));
  const minU = Math.min(...projected.map((p) => p.u));
  const maxU = Math.max(...projected.map((p) => p.u));
  const minV = Math.min(...projected.map((p) => p.v));
  const maxV = Math.max(...projected.map((p) => p.v));
  const fromUV = (u: number, v: number): LocalPoint => ({
    x: along.x * u + up.x * v,
    y: along.y * u + up.y * v,
  });
  return [fromUV(minU, minV), fromUV(maxU, minV), fromUV(maxU, maxV), fromUV(minU, maxV)];
}

function extractPlaneRansac(points: LocalSample[], seed: number, thresholdM = 0.24) {
  if (points.length < 8) return undefined;
  const random = xorshift32(seed);
  let bestIndices: number[] = [];
  let bestPlane: Plane | undefined;
  const iterations = Math.min(220, Math.max(90, points.length * 2));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const indices = new Set<number>();
    while (indices.size < 3) indices.add(Math.floor(random() * points.length));
    const [i, j, k] = [...indices];
    const candidate = planeFrom3(points[i]!, points[j]!, points[k]!);
    if (!candidate) continue;
    const { slopeDeg } = slopeAndAzimuth(candidate);
    if (slopeDeg < 2 || slopeDeg > 65) continue;
    const inliers: number[] = [];
    for (let index = 0; index < points.length; index++) {
      if (Math.abs(residual(candidate, points[index]!)) <= thresholdM) inliers.push(index);
    }
    if (inliers.length > bestIndices.length) {
      bestIndices = inliers;
      bestPlane = candidate;
    }
  }
  if (!bestPlane || bestIndices.length < 8) return undefined;
  const inliers = bestIndices.map((index) => points[index]!);
  const refined = fitPlaneLeastSquares(inliers) ?? bestPlane;
  const refinedInliers = points.filter((point) => Math.abs(residual(refined, point)) <= thresholdM);
  return { plane: refined, inliers: refinedInliers, rms: planeRms(refined, refinedInliers) };
}

export function segmentRoofPlanes(samples: LidarHeightSample[], building: BuildingFootprint) {
  const origin = centroidLonLat(building);
  const localized = localizeSamples(samples, origin).filter((sample) => sample.heightM == null || sample.heightM >= 2.0);
  if (localized.length < 18) throw new Error("Roof Geometry : pas assez de points LiDAR bâtiment exploitables.");
  let remaining = [...localized];
  const planes: Array<{ plane: Plane; inliers: LocalSample[]; rms: number }> = [];
  for (let planeIndex = 0; planeIndex < 4; planeIndex++) {
    const extracted = extractPlaneRansac(remaining, 0x51f15e + planeIndex * 7919);
    if (!extracted) break;
    const minimum = Math.max(8, Math.floor(localized.length * 0.10));
    if (extracted.inliers.length < minimum) break;
    planes.push(extracted);
    const inlierSet = new Set(extracted.inliers);
    remaining = remaining.filter((point) => !inlierSet.has(point));
    if (remaining.length < 8) break;
  }
  if (!planes.length) throw new Error("Roof Geometry : aucun plan de toiture stable n'a été extrait du LiDAR.");
  const models: RoofPlaneModel[] = planes.map((entry, index) => {
    const polygon = convexHull(entry.inliers.map(({ x, y }) => ({ x, y })));
    const orientation = slopeAndAzimuth(entry.plane);
    const confidence = Math.max(0, Math.min(1,
      (entry.inliers.length / localized.length) * 1.8
      + Math.max(0, 0.35 - entry.rms) * 0.7,
    ));
    return {
      id: String.fromCharCode(65 + index),
      confidence,
      slopeDeg: orientation.slopeDeg,
      azimuthDeg: orientation.azimuthDeg,
      polygonLocalM: polygon,
      projectionQuadLocalM: projectionQuad(entry.inliers, entry.plane),
      plane: entry.plane,
      rmsErrorM: entry.rms,
      sampleCount: entry.inliers.length,
    };
  });
  return { origin, localized, planes: models };
}

function clusterPoints(points: Array<LocalPoint & { residualM: number }>, linkDistanceM = 1.35) {
  const pending = new Set(points.map((_, index) => index));
  const clusters: typeof points[] = [];
  while (pending.size) {
    const seed = pending.values().next().value as number;
    pending.delete(seed);
    const queue = [seed];
    const cluster = [points[seed]!];
    while (queue.length) {
      const current = points[queue.shift()!]!;
      for (const index of [...pending]) {
        const candidate = points[index]!;
        if (Math.hypot(candidate.x - current.x, candidate.y - current.y) <= linkDistanceM) {
          pending.delete(index);
          queue.push(index);
          cluster.push(candidate);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export function deriveLidarObstacles(
  localized: LocalSample[],
  planes: RoofPlaneModel[],
  samplingStepM = 0.8,
): SiteObstacle[] {
  const obstacles: SiteObstacle[] = [];
  for (const plane of planes) {
    const candidatePoints = localized.flatMap((sample) => {
      if (!pointInPolygon(sample, plane.polygonLocalM)) return [];
      const dz = sample.surfaceZ - predictedZ(plane.plane, sample);
      // Ignore texture/noise; keep meaningful roof protrusions. Very large values
      // are usually vegetation or another object outside the roof surface model.
      if (dz < 0.32 || dz > 4.5) return [];
      return [{ x: sample.x, y: sample.y, residualM: dz }];
    });
    const clusters = clusterPoints(candidatePoints, Math.max(1.2, samplingStepM * 1.8));
    for (const cluster of clusters) {
      if (!cluster.length) continue;
      const maxHeight = Math.max(...cluster.map((point) => point.residualM));
      const half = Math.max(0.35, samplingStepM * 0.55);
      let polygon = convexHull(cluster);
      if (polygon.length < 3) {
        const center = cluster[0]!;
        polygon = [
          { x: center.x - half, y: center.y - half },
          { x: center.x + half, y: center.y - half },
          { x: center.x + half, y: center.y + half },
          { x: center.x - half, y: center.y + half },
        ];
      }
      obstacles.push({
        id: `${plane.id}-O${obstacles.length + 1}`,
        type: "unknown",
        roofPlaneId: plane.id,
        confidence: Math.min(0.98, 0.72 + Math.min(0.22, cluster.length * 0.03)),
        polygonLocalM: polygon,
        maxHeightAbovePlaneM: maxHeight,
        keepoutMarginMm: 300,
        source: "lidar-residual",
      });
    }
  }
  return obstacles;
}

export function buildRoofModelFromLidar(args: {
  building: BuildingFootprint;
  samples: LidarHeightSample[];
  samplingStepM: number;
  coverage: number;
}): SiteRoofModel {
  const segmented = segmentRoofPlanes(args.samples, args.building);
  const obstacles = deriveLidarObstacles(segmented.localized, segmented.planes, args.samplingStepM);
  const stablePlaneShare = segmented.planes.reduce((sum, plane) => sum + plane.sampleCount, 0) / Math.max(1, segmented.localized.length);
  const coverageConfidence = Math.max(0, Math.min(1, args.coverage * 0.55 + stablePlaneShare * 0.45));
  return {
    origin: segmented.origin,
    planes: segmented.planes,
    obstacles,
    lidarSamples: args.samples,
    coverageConfidence,
  };
}
