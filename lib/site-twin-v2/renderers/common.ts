import type { TwinLonLat, TwinXY } from "../types";

export function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char] ?? char);
}

export function lonLatToLocalM(point: TwinLonLat, origin: TwinLonLat): TwinXY {
  const latitudeRad = origin[1] * Math.PI / 180;
  return {
    x: (point[0] - origin[0]) * 111_320 * Math.cos(latitudeRad),
    y: (point[1] - origin[1]) * 110_540,
  };
}

export function svgTransform(points: TwinXY[], width: number, height: number, padding: number) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const offsetX = (width - usedW) / 2;
  const offsetY = (height - usedH) / 2;
  return (point: TwinXY) => ({
    x: offsetX + (point.x - minX) * scale,
    y: height - (offsetY + (point.y - minY) * scale),
  });
}

export function svgPolygon(points: TwinXY[], project: (point: TwinXY) => TwinXY) {
  return points.map(project).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}
