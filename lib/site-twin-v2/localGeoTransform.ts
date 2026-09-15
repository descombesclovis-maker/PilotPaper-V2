import type { SiteTwinRoofFace, TwinLonLat, TwinXY } from "./types";
import { SiteTwinError } from "./errors";

type Affine2 = {
  lon: [number, number, number];
  lat: [number, number, number];
  rmsErrorMeters: number;
};

function triangleArea2(a: TwinXY, b: TwinXY, c: TwinXY) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function bestTriangle(points: TwinXY[]) {
  let best: [number, number, number] | null = null;
  let bestArea = 0;
  for (let i = 0; i < points.length - 2; i += 1) {
    for (let j = i + 1; j < points.length - 1; j += 1) {
      for (let k = j + 1; k < points.length; k += 1) {
        const area = triangleArea2(points[i]!, points[j]!, points[k]!);
        if (area > bestArea) {
          bestArea = area;
          best = [i, j, k];
        }
      }
    }
  }
  if (!best || bestArea < 0.01) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Le repère géographique du pan est dégénéré.");
  }
  return best;
}

function solve3(points: [TwinXY, TwinXY, TwinXY], values: [number, number, number]): [number, number, number] {
  const [p1, p2, p3] = points;
  const determinant = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + (p2.x * p3.y - p2.y * p3.x);
  if (Math.abs(determinant) < 1e-9) throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Transformation géographique non inversible.");
  const a = (values[0] * (p2.y - p3.y) - p1.y * (values[1] - values[2]) + (values[1] * p3.y - p2.y * values[2])) / determinant;
  const b = (p1.x * (values[1] - values[2]) - values[0] * (p2.x - p3.x) + (p2.x * values[2] - values[1] * p3.x)) / determinant;
  const c = (p1.x * (p2.y * values[2] - values[1] * p3.y) - p1.y * (p2.x * values[2] - values[1] * p3.x) + values[0] * (p2.x * p3.y - p2.y * p3.x)) / determinant;
  return [a, b, c];
}

function apply(coefficients: [number, number, number], point: TwinXY) {
  return coefficients[0] * point.x + coefficients[1] * point.y + coefficients[2];
}

function metresBetween(a: TwinLonLat, b: TwinLonLat) {
  const latitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (a[0] - b[0]) * 111_320 * Math.cos(latitude);
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
}

export function localGeoTransformForFace(face: SiteTwinRoofFace): Affine2 {
  if (face.polygonLocalM.length < 3 || face.polygonLonLat.length !== face.polygonLocalM.length) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", `Pan ${face.displayLabel} : correspondance métrique/géographique incomplète.`);
  }
  const indices = bestTriangle(face.polygonLocalM);
  const metric: [TwinXY, TwinXY, TwinXY] = [
    face.polygonLocalM[indices[0]]!,
    face.polygonLocalM[indices[1]]!,
    face.polygonLocalM[indices[2]]!,
  ];
  const geographic: [TwinLonLat, TwinLonLat, TwinLonLat] = [
    face.polygonLonLat[indices[0]]!,
    face.polygonLonLat[indices[1]]!,
    face.polygonLonLat[indices[2]]!,
  ];
  const lon = solve3(metric, [geographic[0][0], geographic[1][0], geographic[2][0]]);
  const lat = solve3(metric, [geographic[0][1], geographic[1][1], geographic[2][1]]);
  const errors = face.polygonLocalM.map((point, index) => {
    const predicted: TwinLonLat = [apply(lon, point), apply(lat, point)];
    return metresBetween(predicted, face.polygonLonLat[index]!);
  });
  const rmsErrorMeters = Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length);
  if (!Number.isFinite(rmsErrorMeters) || rmsErrorMeters > 0.12) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      `Pan ${face.displayLabel} : transformation métrique/géographique trop imprécise (${rmsErrorMeters.toFixed(2)} m).`,
      { recoverable: true, details: { faceId: face.id, rmsErrorMeters } },
    );
  }
  return { lon, lat, rmsErrorMeters };
}

export function localPointsToLonLat(face: SiteTwinRoofFace, points: TwinXY[]): TwinLonLat[] {
  const transform = localGeoTransformForFace(face);
  return points.map((point) => [apply(transform.lon, point), apply(transform.lat, point)]);
}

export function modulePolygonsToLonLat(args: {
  faces: SiteTwinRoofFace[];
  modules: Array<{ faceId: string; polygonLocalM: TwinXY[] }>;
}) {
  const transforms = new Map<string, Affine2>();
  return args.modules.map((module) => {
    const face = args.faces.find((candidate) => candidate.id === module.faceId);
    if (!face) throw new SiteTwinError("PV_LAYOUT_INVALID", `Module rattaché à un pan introuvable : ${module.faceId}.`);
    let transform = transforms.get(face.id);
    if (!transform) {
      transform = localGeoTransformForFace(face);
      transforms.set(face.id, transform);
    }
    return module.polygonLocalM.map((point) => [apply(transform!.lon, point), apply(transform!.lat, point)] as TwinLonLat);
  });
}
