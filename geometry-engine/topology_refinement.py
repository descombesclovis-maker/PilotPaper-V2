from __future__ import annotations

import math
from typing import Any

from shapely import affinity
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union


MIN_SHARED_EDGE_M = 0.25
DEFAULT_JOIN_TOLERANCE_M = 0.50


def _polygon_from_local(face: dict[str, Any]) -> Polygon | None:
    raw = face.get("polygonLocalM") or []
    if len(raw) < 3:
        return None
    polygon = Polygon([(float(point["x"]), float(point["y"])) for point in raw])
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.geom_type != "Polygon":
        return None
    return polygon


def _line_parts(geometry) -> list[LineString]:
    if isinstance(geometry, LineString):
        return [geometry]
    return [item for item in getattr(geometry, "geoms", []) if isinstance(item, LineString)]


def _plane_z(face: dict[str, Any], x: float, y: float) -> float:
    plane = face["plane"]
    return float(plane["a"] * x + plane["b"] * y + plane["c"])


def _intersection_line(
    left: dict[str, Any],
    right: dict[str, Any],
    left_geometry: Polygon,
    right_geometry: Polygon,
    building_local,
    join_tolerance_m: float,
) -> LineString | None:
    if left.get("buildingId") != right.get("buildingId"):
        return None
    if left_geometry.distance(right_geometry) > join_tolerance_m * 2.25:
        return None

    lp = left.get("plane") or {}
    rp = right.get("plane") or {}
    da = float(lp.get("a", 0.0)) - float(rp.get("a", 0.0))
    db = float(lp.get("b", 0.0)) - float(rp.get("b", 0.0))
    dc = float(lp.get("c", 0.0)) - float(rp.get("c", 0.0))
    norm2 = da * da + db * db
    if norm2 <= 1e-10:
        return None

    # Closest point to the Site Twin metric origin on the exact line where
    # z_left(x, y) == z_right(x, y).
    x0 = -da * dc / norm2
    y0 = -db * dc / norm2
    norm = math.sqrt(norm2)
    direction_x = -db / norm
    direction_y = da / norm

    minx, miny, maxx, maxy = building_local.bounds
    reach = max(maxx - minx, maxy - miny, 1.0) * 3.0 + 4.0
    analytic = LineString([
        (x0 - direction_x * reach, y0 - direction_y * reach),
        (x0 + direction_x * reach, y0 + direction_y * reach),
    ])

    # The buffers only absorb LiDAR/RANSAC hull discretisation. Requiring both
    # buffered pans plus the locked building footprint prevents invented joins.
    adjacency = (
        left_geometry.buffer(join_tolerance_m)
        .intersection(right_geometry.buffer(join_tolerance_m))
        .intersection(building_local.buffer(0.08))
    )
    candidates = [
        line for line in _line_parts(analytic.intersection(adjacency))
        if line.length >= MIN_SHARED_EDGE_M
    ]
    return max(candidates, key=lambda line: line.length) if candidates else None


def _classify_pair(
    left: dict[str, Any],
    right: dict[str, Any],
    line: LineString,
    left_geometry: Polygon,
    right_geometry: Polygon,
) -> str:
    coordinates = list(line.coords)
    start = coordinates[0]
    end = coordinates[-1]
    mid_x = (start[0] + end[0]) / 2
    mid_y = (start[1] + end[1]) / 2
    edge_z = (_plane_z(left, mid_x, mid_y) + _plane_z(right, mid_x, mid_y)) / 2
    left_center = left_geometry.centroid
    right_center = right_geometry.centroid
    left_delta = edge_z - _plane_z(left, left_center.x, left_center.y)
    right_delta = edge_z - _plane_z(right, right_center.x, right_center.y)
    vertical_change = abs(_plane_z(left, end[0], end[1]) - _plane_z(left, start[0], start[1]))
    if left_delta > 0.12 and right_delta > 0.12:
        return "ridge" if vertical_change <= 0.16 else "hip"
    if left_delta < -0.12 and right_delta < -0.12:
        return "valley"
    return "unknown"


def _next_edge_id(edges: list[dict[str, Any]]) -> str:
    used = {str(edge.get("id", "")) for edge in edges}
    index = 0
    while f"edge-{index:03d}" in used:
        index += 1
    return f"edge-{index:03d}"


def refine_roof_topology(
    faces: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    buildings: list[tuple[str, Any]],
    *,
    join_tolerance_m: float = DEFAULT_JOIN_TOLERANCE_M,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Refine shared roof edges from fitted plane intersections.

    RANSAC hulls are evidence for face extent, but their exact boundary contact is
    not reliable enough to define a legal ridge length. Shared ridge/hip/valley
    geometry therefore comes from the fitted planes and is clipped only by the
    locked building footprint plus a small adjacency tolerance.
    """
    if len(faces) < 2 or not buildings:
        return faces, edges, []

    building_union = unary_union([polygon for _, polygon in buildings])
    if building_union.is_empty:
        return faces, edges, []
    metric_origin = building_union.centroid
    building_local = affinity.translate(building_union, xoff=-metric_origin.x, yoff=-metric_origin.y)

    geometries: dict[str, Polygon] = {}
    for face in faces:
        face_id = str(face.get("id", ""))
        polygon = _polygon_from_local(face)
        if face_id and polygon is not None:
            geometries[face_id] = polygon

    refined = list(edges)
    refined_count = 0
    for left_index, left in enumerate(faces):
        left_id = str(left.get("id", ""))
        left_geometry = geometries.get(left_id)
        if left_geometry is None:
            continue
        for right in faces[left_index + 1 :]:
            right_id = str(right.get("id", ""))
            right_geometry = geometries.get(right_id)
            if right_geometry is None:
                continue
            line = _intersection_line(
                left,
                right,
                left_geometry,
                right_geometry,
                building_local,
                join_tolerance_m,
            )
            if line is None:
                continue
            kind = _classify_pair(left, right, line, left_geometry, right_geometry)
            if kind == "unknown":
                continue

            pair = {left_id, right_id}
            existing_indices = [
                index for index, edge in enumerate(refined)
                if set(str(value) for value in (edge.get("adjacentFaceIds") or [])) == pair
            ]
            if existing_indices:
                keep_index = existing_indices[0]
                edge_id = str(refined[keep_index].get("id") or _next_edge_id(refined))
            else:
                keep_index = len(refined)
                edge_id = _next_edge_id(refined)

            start, end = list(line.coords)[0], list(line.coords)[-1]
            z_start = (_plane_z(left, start[0], start[1]) + _plane_z(right, start[0], start[1])) / 2
            z_end = (_plane_z(left, end[0], end[1]) + _plane_z(right, end[0], end[1])) / 2
            replacement = {
                "id": edge_id,
                "a": {"x": float(start[0]), "y": float(start[1]), "z": float(z_start)},
                "b": {"x": float(end[0]), "y": float(end[1]), "z": float(z_end)},
                "kind": kind,
                "adjacentFaceIds": [left_id, right_id],
            }
            if keep_index < len(refined):
                refined[keep_index] = replacement
            else:
                refined.append(replacement)

            duplicate_ids: set[str] = set()
            for index in reversed(existing_indices[1:]):
                duplicate_ids.add(str(refined[index].get("id", "")))
                refined.pop(index)
            if duplicate_ids:
                for face in faces:
                    face["edgeIds"] = [edge for edge in (face.get("edgeIds") or []) if str(edge) not in duplicate_ids]
            for face in (left, right):
                edge_ids = [str(value) for value in (face.get("edgeIds") or [])]
                if edge_id not in edge_ids:
                    edge_ids.append(edge_id)
                face["edgeIds"] = edge_ids
            refined_count += 1

    diagnostics = []
    if refined_count:
        diagnostics.append(
            f"Topologie analytique : {refined_count} arête(s) partagée(s) recalculée(s) depuis l'intersection des plans physiques."
        )
    return faces, refined, diagnostics
