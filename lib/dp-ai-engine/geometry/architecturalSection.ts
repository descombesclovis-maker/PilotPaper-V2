import type { GoogleSolarBuildingInsights, GoogleSolarRoofSegment } from "../providers/googleSolar";
import type { BuildingFootprint } from "../site-model/types";

const EARTH_RADIUS_M = 6_378_137;
const EPS = 1e-6;

type AxisPoint = { x: number; y: number };
type EastNorth = { east: number; north: number };

type SegmentDescriptor = {
  index: number;
  segment: GoogleSolarRoofSegment;
  center: EastNorth;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
};

export type ArchitecturalSectionPoint = { x: number; z: number };

export type ArchitecturalSectionGeometry = {
  leftX: number;
  rightX: number;
  widthM: number;
  roofProfile: ArchitecturalSectionPoint[];
  ridgeX: number;
  ridgeHeightM: number;
  leftEaveHeightM: number;
  rightEaveHeightM: number;
  selectedPitchDeg: number;
  selectedAzimuthDeg: number;
  baseAltitudeM: number;
  sectionCenter: { latitude: number; longitude: number };
  selectedSegmentIndex: number;
};

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function localEastNorth(
  point: { latitude: number; longitude: number },
  origin: { latitude: number; longitude: number },
): EastNorth {
  const lat0 = radians(origin.latitude);
  return {
    east: radians(point.longitude - origin.longitude) * EARTH_RADIUS_M * Math.cos(lat0),
    north: radians(point.latitude - origin.latitude) * EARTH_RADIUS_M,
  };
}

function axes(azimuthDeg: number) {
  const azimuth = radians(azimuthDeg);
  const down = { east: Math.sin(azimuth), north: Math.cos(azimuth) };
  const along = { east: Math.cos(azimuth), north: -Math.sin(azimuth) };
  return { down, along };
}

function toAxis(
  point: { latitude: number; longitude: number },
  origin: { latitude: number; longitude: number },
  azimuthDeg: number,
): AxisPoint {
  const local = localEastNorth(point, origin);
  const basis = axes(azimuthDeg);
  return {
    x: local.east * basis.down.east + local.north * basis.down.north,
    y: local.east * basis.along.east + local.north * basis.along.north,
  };
}

function uniqueSorted(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    if (!unique.length || Math.abs(value - unique[unique.length - 1]!) > 0.015) unique.push(value);
  }
  return unique;
}

function intersectionsAtYZero(polygon: AxisPoint[]) {
  const values: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const aOn = Math.abs(a.y) < EPS;
    const bOn = Math.abs(b.y) < EPS;
    if (aOn && bOn) {
      values.push(a.x, b.x);
      continue;
    }
    if ((a.y <= 0 && b.y >= 0) || (b.y <= 0 && a.y >= 0)) {
      const dy = b.y - a.y;
      if (Math.abs(dy) < EPS) continue;
      const t = -a.y / dy;
      if (t >= -EPS && t <= 1 + EPS) values.push(a.x + (b.x - a.x) * t);
    }
  }
  return uniqueSorted(values);
}

function intervalsFromIntersections(values: number[]) {
  const intervals: Array<{ min: number; max: number }> = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const min = values[index]!;
    const max = values[index + 1]!;
    if (max - min > 0.05) intervals.push({ min, max });
  }
  return intervals;
}

export function sectionIntervalForFootprint(args: {
  polygon: Array<[number, number]>;
  sectionCenter: { latitude: number; longitude: number };
  azimuthDeg: number;
}) {
  const polygonAxis = args.polygon.map(([longitude, latitude]) => (
    toAxis({ longitude, latitude }, args.sectionCenter, args.azimuthDeg)
  ));
  const intervals = intervalsFromIntersections(intersectionsAtYZero(polygonAxis));
  if (!intervals.length) {
    throw new Error("DP3 : la coupe ne traverse pas de façon exploitable l'emprise BD TOPO du bâtiment.");
  }
  const containingCenter = intervals.find((interval) => interval.min <= 0 && interval.max >= 0);
  const selected = containingCenter ?? [...intervals].sort((a, b) => {
    const midA = (a.min + a.max) / 2;
    const midB = (b.min + b.max) / 2;
    return Math.abs(midA) - Math.abs(midB);
  })[0]!;
  return { leftX: selected.min, rightX: selected.max, widthM: selected.max - selected.min };
}

function segmentDescriptor(
  segment: GoogleSolarRoofSegment,
  index: number,
  origin: { latitude: number; longitude: number },
  sectionAzimuthDeg: number,
): SegmentDescriptor | undefined {
  const planeHeight = Number(segment.planeHeightAtCenterMeters);
  if (!Number.isFinite(planeHeight)) return undefined;
  const center = localEastNorth(segment.center, origin);
  const centerAxis = toAxis(segment.center, origin, sectionAzimuthDeg);
  if (segment.boundingBox) {
    const { sw, ne } = segment.boundingBox;
    const corners = [
      sw,
      { latitude: sw.latitude, longitude: ne.longitude },
      ne,
      { latitude: ne.latitude, longitude: sw.longitude },
    ].map((point) => toAxis(point, origin, sectionAzimuthDeg));
    return {
      index,
      segment,
      center,
      bbox: {
        minX: Math.min(...corners.map((point) => point.x)),
        maxX: Math.max(...corners.map((point) => point.x)),
        minY: Math.min(...corners.map((point) => point.y)),
        maxY: Math.max(...corners.map((point) => point.y)),
      },
    };
  }
  const area = Number(segment.stats?.groundAreaMeters2 ?? segment.stats?.areaMeters2 ?? 100);
  const half = Math.max(3, Math.min(25, Math.sqrt(Math.max(16, area)) * 0.75));
  return {
    index,
    segment,
    center,
    bbox: {
      minX: centerAxis.x - half,
      maxX: centerAxis.x + half,
      minY: centerAxis.y - half,
      maxY: centerAxis.y + half,
    },
  };
}

function planeHeightAt(descriptor: SegmentDescriptor, sampleEastNorth: EastNorth) {
  const slope = Math.tan(radians(descriptor.segment.pitchDegrees));
  const basis = axes(descriptor.segment.azimuthDegrees);
  const deltaEast = sampleEastNorth.east - descriptor.center.east;
  const deltaNorth = sampleEastNorth.north - descriptor.center.north;
  const downDistance = deltaEast * basis.down.east + deltaNorth * basis.down.north;
  return Number(descriptor.segment.planeHeightAtCenterMeters) - slope * downDistance;
}

function distanceToRange(value: number, min: number, max: number) {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

export function buildArchitecturalSectionGeometry(args: {
  building: BuildingFootprint;
  insights: GoogleSolarBuildingInsights;
  selectedSegmentIndex: number;
}): ArchitecturalSectionGeometry {
  const selected = args.insights.solarPotential.roofSegmentStats[args.selectedSegmentIndex];
  if (!selected) throw new Error("DP3 : le pan Google Solar demandé n'existe pas.");
  if (!Number.isFinite(selected.pitchDegrees) || selected.pitchDegrees <= 0 || selected.pitchDegrees >= 75) {
    throw new Error("DP3 : la pente Google Solar du pan sélectionné n'est pas exploitable pour une coupe architecturale.");
  }
  const sectionCenter = selected.center;
  const interval = sectionIntervalForFootprint({
    polygon: args.building.polygon,
    sectionCenter,
    azimuthDeg: selected.azimuthDegrees,
  });
  if (interval.widthM < 2) throw new Error("DP3 : la largeur de bâtiment traversée par la coupe est trop faible.");

  const descriptors = args.insights.solarPotential.roofSegmentStats
    .map((segment, index) => segmentDescriptor(segment, index, sectionCenter, selected.azimuthDegrees))
    .filter((descriptor): descriptor is SegmentDescriptor => Boolean(descriptor))
    .filter((descriptor) => (
      descriptor.bbox.maxX >= interval.leftX - 1.5
      && descriptor.bbox.minX <= interval.rightX + 1.5
      && descriptor.bbox.maxY >= -1.5
      && descriptor.bbox.minY <= 1.5
    ));
  if (!descriptors.some((descriptor) => descriptor.index === args.selectedSegmentIndex)) {
    throw new Error("DP3 : le plan du pan sélectionné n'est pas défini en altitude par Google Solar.");
  }

  const sectionBasis = axes(selected.azimuthDegrees);
  const samples = 121;
  const rawProfile: Array<{ x: number; zAbs: number }> = [];
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    const x = interval.leftX + interval.widthM * t;
    const sample = { east: sectionBasis.down.east * x, north: sectionBasis.down.north * x };
    let candidates = descriptors.filter((descriptor) => (
      x >= descriptor.bbox.minX - 0.65
      && x <= descriptor.bbox.maxX + 0.65
      && descriptor.bbox.minY <= 0.65
      && descriptor.bbox.maxY >= -0.65
    ));
    if (!candidates.length) {
      candidates = [...descriptors].sort((a, b) => {
        const da = Math.hypot(
          distanceToRange(x, a.bbox.minX, a.bbox.maxX),
          distanceToRange(0, a.bbox.minY, a.bbox.maxY),
        );
        const db = Math.hypot(
          distanceToRange(x, b.bbox.minX, b.bbox.maxX),
          distanceToRange(0, b.bbox.minY, b.bbox.maxY),
        );
        return da - db;
      }).slice(0, 2);
    }
    const heights = candidates.map((descriptor) => planeHeightAt(descriptor, sample)).filter(Number.isFinite);
    if (!heights.length) throw new Error("DP3 : profil de toiture Google Solar incomplet sur la ligne de coupe.");
    rawProfile.push({ x, zAbs: Math.min(...heights) });
  }

  const edgeCount = 5;
  const edgeMeanAbs = average([
    ...rawProfile.slice(0, edgeCount).map((point) => point.zAbs),
    ...rawProfile.slice(-edgeCount).map((point) => point.zAbs),
  ]);
  const gutterHeightM = Number(args.building.heightM);
  if (!Number.isFinite(gutterHeightM) || gutterHeightM <= 1.5 || gutterHeightM > 25) {
    throw new Error("DP3 : la hauteur de gouttière BD TOPO du bâtiment est absente ou incohérente.");
  }
  const baseAltitudeM = edgeMeanAbs - gutterHeightM;
  const roofProfile = rawProfile.map((point) => ({ x: point.x, z: point.zAbs - baseAltitudeM }));
  const ridge = [...roofProfile].sort((a, b) => b.z - a.z)[0]!;
  const leftEaveHeightM = average(roofProfile.slice(0, edgeCount).map((point) => point.z));
  const rightEaveHeightM = average(roofProfile.slice(-edgeCount).map((point) => point.z));
  if (ridge.z <= Math.max(leftEaveHeightM, rightEaveHeightM) + 0.15) {
    throw new Error("DP3 : Google Solar ne démontre pas un profil de toiture incliné cohérent sur cette coupe.");
  }

  return {
    leftX: interval.leftX,
    rightX: interval.rightX,
    widthM: interval.widthM,
    roofProfile,
    ridgeX: ridge.x,
    ridgeHeightM: ridge.z,
    leftEaveHeightM,
    rightEaveHeightM,
    selectedPitchDeg: selected.pitchDegrees,
    selectedAzimuthDeg: selected.azimuthDegrees,
    baseAltitudeM,
    sectionCenter,
    selectedSegmentIndex: args.selectedSegmentIndex,
  };
}

export function interpolateSectionHeight(profile: ArchitecturalSectionPoint[], x: number) {
  if (!profile.length) throw new Error("DP3 : profil de coupe vide.");
  if (x <= profile[0]!.x) return profile[0]!.z;
  if (x >= profile[profile.length - 1]!.x) return profile[profile.length - 1]!.z;
  for (let index = 0; index < profile.length - 1; index += 1) {
    const a = profile[index]!;
    const b = profile[index + 1]!;
    if (x < a.x || x > b.x) continue;
    const span = b.x - a.x;
    if (Math.abs(span) < EPS) return a.z;
    const t = (x - a.x) / span;
    return a.z + (b.z - a.z) * t;
  }
  return profile.at(-1)!.z;
}
