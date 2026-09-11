import { fromWebMercator, toWebMercator, type LonLat } from "../context/officialParcel";
import { pointInLonLatPolygon } from "./buildingResolver";
import type { BuildingFootprint, LidarHeightSample } from "./types";

const LIDAR_RESOURCE = "ign_lidar_hd_mnx_multi_wld";
const MAX_POINTS = 4_500;

export type AltimetryMeasure = {
  z?: number;
  source_name?: string;
  source_measure?: string;
  title?: string;
};

export type AltimetryElevation = {
  lon?: number;
  lat?: number;
  z?: number;
  measures?: AltimetryMeasure[];
};

function finite(value: unknown): value is number {
  return Number.isFinite(Number(value));
}

function labelFor(measure: AltimetryMeasure) {
  return `${measure.source_name ?? ""} ${measure.source_measure ?? ""} ${measure.title ?? ""}`.toLowerCase();
}

export function extractMnxValues(elevation: AltimetryElevation) {
  const measures = (elevation.measures ?? []).filter((measure) => finite(measure.z));
  let surface = measures.find((measure) => /\bmns\b|surface|sursol/.test(labelFor(measure)))?.z;
  let terrain = measures.find((measure) => /\bmnt\b|terrain|sol\b/.test(labelFor(measure)))?.z;
  let height = measures.find((measure) => /\bmnh\b|hauteur/.test(labelFor(measure)))?.z;

  const values = measures.map((measure) => Number(measure.z)).filter(Number.isFinite);
  if ((!finite(surface) || !finite(terrain) || !finite(height)) && values.length >= 3) {
    let best: { surface: number; terrain: number; height: number; error: number } | undefined;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        for (let k = 0; k < values.length; k++) {
          if (k === i || k === j) continue;
          const high = Math.max(values[i]!, values[j]!);
          const low = Math.min(values[i]!, values[j]!);
          const h = values[k]!;
          if (h < -0.5 || h > 150) continue;
          const error = Math.abs((high - low) - h);
          if (!best || error < best.error) best = { surface: high, terrain: low, height: h, error };
        }
      }
    }
    if (best && best.error <= 1.5) {
      if (!finite(surface)) surface = best.surface;
      if (!finite(terrain)) terrain = best.terrain;
      if (!finite(height)) height = best.height;
    }
  }

  if (!finite(surface) && finite(elevation.z)) surface = Number(elevation.z);
  if (!finite(height) && finite(surface) && finite(terrain)) height = surface - terrain;
  if (!finite(terrain) && finite(surface) && finite(height)) terrain = surface - height;

  return {
    surfaceZ: finite(surface) ? Number(surface) : undefined,
    terrainZ: finite(terrain) ? Number(terrain) : undefined,
    heightM: finite(height) ? Math.max(0, Number(height)) : undefined,
  };
}

function projectedBounds(polygon: LonLat[]) {
  const points = polygon.map(([lon, lat]) => toWebMercator(lon, lat));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export function buildPolygonSamplingGrid(polygon: LonLat[], requestedStepM = 0.8) {
  if (polygon.length < 3) throw new Error("LiDAR HD : polygone d'échantillonnage incomplet.");
  const bounds = projectedBounds(polygon);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const minimumStepForLimit = Math.sqrt((width * height) / MAX_POINTS);
  const stepM = Math.max(requestedStepM, minimumStepForLimit);
  const points: LonLat[] = [];
  for (let y = bounds.minY + stepM / 2; y <= bounds.maxY; y += stepM) {
    for (let x = bounds.minX + stepM / 2; x <= bounds.maxX; x += stepM) {
      const geo = fromWebMercator(x, y);
      const point: LonLat = [geo.longitude, geo.latitude];
      if (pointInLonLatPolygon(point, polygon)) points.push(point);
      if (points.length >= MAX_POINTS) return { points, stepM };
    }
  }
  return { points, stepM };
}

export function buildBuildingSamplingGrid(building: BuildingFootprint, requestedStepM = 0.8) {
  return buildPolygonSamplingGrid(building.polygon, requestedStepM);
}

async function requestAltimetry(points: LonLat[]) {
  const url = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
  const body = {
    lon: points.map((point) => point[0]).join("|"),
    lat: points.map((point) => point[1]).join("|"),
    resource: LIDAR_RESOURCE,
    delimiter: "|",
    indent: "false",
    measures: "true",
    zonly: "false",
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`LiDAR HD / altimétrie IGN indisponible (${response.status}).`);
  return response.json() as Promise<{ elevations?: AltimetryElevation[] }>;
}

async function sampleGrid(points: LonLat[], stepM: number, minimumSamples: number) {
  if (points.length < minimumSamples) throw new Error("LiDAR HD : zone trop petite pour un échantillonnage fiable.");
  const payload = await requestAltimetry(points);
  const elevations = payload.elevations ?? [];
  if (elevations.length !== points.length) {
    throw new Error(`LiDAR HD : ${elevations.length} altitude(s) reçue(s) pour ${points.length} point(s) demandés.`);
  }
  const samples: LidarHeightSample[] = [];
  for (let index = 0; index < elevations.length; index++) {
    const source = elevations[index]!;
    const expected = points[index]!;
    const values = extractMnxValues(source);
    if (!finite(values.surfaceZ) || Number(values.surfaceZ) <= -90_000) continue;
    samples.push({
      longitude: finite(source.lon) ? Number(source.lon) : expected[0],
      latitude: finite(source.lat) ? Number(source.lat) : expected[1],
      surfaceZ: Number(values.surfaceZ),
      terrainZ: finite(values.terrainZ) ? Number(values.terrainZ) : undefined,
      heightM: finite(values.heightM) ? Number(values.heightM) : undefined,
    });
  }
  const coverage = samples.length / points.length;
  if (samples.length < minimumSamples || coverage < 0.55) {
    throw new Error(`LiDAR HD : couverture insuffisante (${Math.round(coverage * 100)} %).`);
  }
  return {
    resource: LIDAR_RESOURCE,
    stepM,
    requestedPointCount: points.length,
    coverage,
    samples,
  };
}

/** Sample arbitrary validated roof/support polygon, used by Assisted Recovery. */
export async function samplePolygonLidarHeights(polygon: LonLat[], stepM = 0.65) {
  const grid = buildPolygonSamplingGrid(polygon, stepM);
  return sampleGrid(grid.points, grid.stepM, 10);
}

/**
 * Sample the official LiDAR HD MNX resource directly over the selected BD TOPO
 * building. This avoids downloading 150–500 MB COPC tiles for a residential roof.
 */
export async function sampleBuildingLidarHeights(building: BuildingFootprint, stepM = 0.8) {
  const grid = buildBuildingSamplingGrid(building, stepM);
  return sampleGrid(grid.points, grid.stepM, 18);
}
