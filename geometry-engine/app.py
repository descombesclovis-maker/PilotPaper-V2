from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import math
from typing import Any

import laspy
import numpy as np
import rasterio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pyproj import CRS, Transformer
from rasterio.io import MemoryFile
from rasterio.mask import mask
from shapely.geometry import LineString, MultiPoint, Point, Polygon, mapping
from shapely.ops import unary_union
from sklearn.cluster import DBSCAN
from sklearn.linear_model import LinearRegression, RANSACRegressor

from registration import register_images

ENGINE_VERSION = "pilotpaper-geometry-0.2.0"
MAX_POINTS = 100_000
MIN_FACE_AREA_M2 = 2.0
MIN_FACE_POINTS = 60
MIN_OBSTACLE_AREA_M2 = 0.06
MIN_OBSTACLE_HEIGHT_M = 0.18

app = FastAPI(title="PilotPaper Geometry Engine", version=ENGINE_VERSION)


def _optional_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


@app.get("/health")
def health() -> dict[str, Any]:
    capabilities = [
        "geotiff-dsm",
        "las-laz",
        "sampled-elevation-points",
        "ransac-planes",
        "metric-obstacles",
        "roof-edge-topology",
        "opencv-registration",
    ]
    if _optional_module("open3d"):
        capabilities.append("open3d")
    if _optional_module("pdal"):
        capabilities.append("pdal")
    if _optional_module("torch") and _optional_module("lightglue"):
        capabilities.append("lightglue")
    return {"ok": True, "version": ENGINE_VERSION, "capabilities": capabilities}


def _parse_property(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail=f"Property JSON invalide : {error}") from error
    if not value.get("targetBuildingIds") or not value.get("buildings"):
        raise HTTPException(status_code=400, detail="Property Lock incomplet : bâtiments cibles absents.")
    if not value.get("parcel", {}).get("polygonLonLat"):
        raise HTTPException(status_code=400, detail="Property Lock incomplet : parcelle absente.")
    return value


def _projected_buildings(property_lock: dict[str, Any], crs: CRS):
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    result: list[tuple[str, Polygon]] = []
    target_ids = set(property_lock["targetBuildingIds"])
    for building in property_lock["buildings"]:
        if building.get("id") not in target_ids:
            continue
        coordinates = building.get("polygonLonLat") or []
        if len(coordinates) < 3:
            continue
        projected = [transformer.transform(float(lon), float(lat)) for lon, lat in coordinates]
        polygon = Polygon(projected)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty or polygon.area < 4:
            continue
        result.append((str(building["id"]), polygon))
    if not result:
        raise ValueError("Aucune emprise bâtiment cible exploitable dans le CRS altimétrique.")
    return result


def _limit_points(points: np.ndarray) -> np.ndarray:
    if len(points) <= MAX_POINTS:
        return points
    rng = np.random.default_rng(42)
    return points[rng.choice(len(points), size=MAX_POINTS, replace=False)]


def _extract_raster_points(data: bytes, property_lock: dict[str, Any]):
    with MemoryFile(data) as memory:
        with memory.open() as dataset:
            if dataset.count < 1 or dataset.crs is None:
                raise ValueError("GeoTIFF sans bande altimétrique ou sans système de coordonnées.")
            buildings = _projected_buildings(property_lock, CRS.from_user_input(dataset.crs))
            target = unary_union([polygon for _, polygon in buildings])
            clipped, transform = mask(dataset, [mapping(target.buffer(0.75))], crop=True, filled=False, indexes=1)
            values = np.asarray(clipped)
            if np.ma.isMaskedArray(values):
                valid = ~values.mask & np.isfinite(values.data)
                z = values.data
            else:
                valid = np.isfinite(values)
                z = values
                if dataset.nodata is not None:
                    valid &= z != dataset.nodata
            valid &= z > -1000
            rows, cols = np.where(valid)
            if len(rows) < 120:
                raise ValueError("Pas assez de points DSM valides sur le bâtiment ciblé.")
            xs, ys = rasterio.transform.xy(transform, rows, cols, offset="center")
            points = np.column_stack([np.asarray(xs), np.asarray(ys), z[rows, cols]]).astype(np.float64)
            return _limit_points(points), buildings, CRS.from_user_input(dataset.crs)


def _extract_point_cloud(data: bytes, property_lock: dict[str, Any]):
    cloud = laspy.read(io.BytesIO(data))
    crs = cloud.header.parse_crs()
    if crs is None:
        raise ValueError("Le nuage LAS/LAZ ne déclare aucun CRS.")
    metric_crs = CRS.from_user_input(crs)
    buildings = _projected_buildings(property_lock, metric_crs)
    target = unary_union([polygon for _, polygon in buildings]).buffer(0.5)
    xyz = np.column_stack([np.asarray(cloud.x), np.asarray(cloud.y), np.asarray(cloud.z)]).astype(np.float64)
    minx, miny, maxx, maxy = target.bounds
    keep = (
        (xyz[:, 0] >= minx) & (xyz[:, 0] <= maxx)
        & (xyz[:, 1] >= miny) & (xyz[:, 1] <= maxy)
        & np.isfinite(xyz[:, 2])
    )
    xyz = xyz[keep]
    if len(xyz) < 120:
        raise ValueError("Pas assez de points LiDAR sur le bâtiment ciblé.")
    inside = np.fromiter((target.covers(Point(x, y)) for x, y in xyz[:, :2]), dtype=bool, count=len(xyz))
    xyz = xyz[inside]
    if len(xyz) < 120:
        raise ValueError("Le nuage LiDAR ne couvre pas suffisamment l'emprise du bâtiment.")
    floor = np.percentile(xyz[:, 2], 12)
    xyz = xyz[xyz[:, 2] >= floor + 0.4]
    return _limit_points(xyz), buildings, metric_crs


def _local_metric_crs(property_lock: dict[str, Any], samples: list[dict[str, Any]]) -> CRS:
    address_point = property_lock.get("addressPoint") or []
    if len(address_point) >= 2:
        lon0, lat0 = float(address_point[0]), float(address_point[1])
    else:
        lon0 = float(np.mean([float(item["longitude"]) for item in samples]))
        lat0 = float(np.mean([float(item["latitude"]) for item in samples]))
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat0:.10f} +lon_0={lon0:.10f} +datum=WGS84 +units=m +no_defs")


def _extract_sampled_points(raw: str, property_lock: dict[str, Any]):
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"Points IGN invalides : {error}") from error
    if not isinstance(parsed, list):
        raise ValueError("Les points IGN doivent être une liste JSON.")
    samples = [
        item for item in parsed
        if isinstance(item, dict)
        and math.isfinite(float(item.get("longitude", float("nan"))))
        and math.isfinite(float(item.get("latitude", float("nan"))))
        and math.isfinite(float(item.get("z", float("nan"))))
    ]
    if len(samples) < 120:
        raise ValueError(f"Pas assez de points IGN valides ({len(samples)}).")
    crs = _local_metric_crs(property_lock, samples)
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    xyz = np.asarray([
        (*transformer.transform(float(item["longitude"]), float(item["latitude"])), float(item["z"]))
        for item in samples
    ], dtype=np.float64)
    buildings = _projected_buildings(property_lock, crs)
    target = unary_union([polygon for _, polygon in buildings]).buffer(0.65)
    minx, miny, maxx, maxy = target.bounds
    keep = (
        (xyz[:, 0] >= minx) & (xyz[:, 0] <= maxx)
        & (xyz[:, 1] >= miny) & (xyz[:, 1] <= maxy)
        & np.isfinite(xyz[:, 2])
    )
    xyz = xyz[keep]
    inside = np.fromiter((target.covers(Point(x, y)) for x, y in xyz[:, :2]), dtype=bool, count=len(xyz))
    xyz = xyz[inside]
    if len(xyz) < 120:
        raise ValueError(f"Couverture IGN insuffisante après verrouillage bâtiment ({len(xyz)} points).")
    return _limit_points(xyz), buildings, crs


def _angular_distance(a: float, b: float) -> float:
    delta = abs((a - b) % 360.0)
    return min(delta, 360.0 - delta)


def _face_building_id(geometry: Polygon, buildings: list[tuple[str, Polygon]]) -> str:
    ranked = sorted(
        ((geometry.intersection(polygon).area, building_id) for building_id, polygon in buildings),
        reverse=True,
    )
    if not ranked or ranked[0][0] <= 0:
        raise ValueError("Pan reconstruit impossible à rattacher au bâtiment verrouillé.")
    return ranked[0][1]


def _stable_face_id(building_id: str, geometry: Polygon, slope: float, azimuth: float) -> str:
    center = geometry.centroid
    key = f"{building_id}|{center.x:.2f}|{center.y:.2f}|{slope:.1f}|{azimuth:.1f}"
    return "roof-" + hashlib.sha1(key.encode("utf-8"), usedforsecurity=False).hexdigest()[:14]


def _split_inlier_clusters(points: np.ndarray, pixel_hint: float) -> list[np.ndarray]:
    if len(points) < MIN_FACE_POINTS:
        return []
    eps = max(0.22, min(0.9, pixel_hint * 3.2))
    labels = DBSCAN(eps=eps, min_samples=4).fit_predict(points[:, :2])
    clusters = [points[labels == label] for label in sorted(set(labels)) if label >= 0]
    return [cluster for cluster in clusters if len(cluster) >= MIN_FACE_POINTS]


def _plane_z(face: dict[str, Any], x: float, y: float, origin_x: float, origin_y: float) -> float:
    plane = face["plane"]
    return float(plane["a"] * (x - origin_x) + plane["b"] * (y - origin_y) + plane["c"])


def _source_evidence_name(source: str) -> str:
    if source == "google-dsm":
        return "google-solar"
    if source == "ign-mns":
        return "ign-mns"
    return "ign-lidar-hd"


def _detect_metric_obstacles(
    points: np.ndarray,
    face: dict[str, Any],
    origin_x: float,
    origin_y: float,
    pixel_hint: float,
    source: str,
) -> list[dict[str, Any]]:
    geometry: Polygon = face["_geometry"]
    interior = geometry.buffer(-max(0.08, min(0.18, pixel_hint * 0.7)))
    if interior.is_empty:
        interior = geometry
    minx, miny, maxx, maxy = interior.bounds
    candidates = points[
        (points[:, 0] >= minx) & (points[:, 0] <= maxx)
        & (points[:, 1] >= miny) & (points[:, 1] <= maxy)
    ]
    if not len(candidates):
        return []
    inside = np.fromiter((interior.covers(Point(x, y)) for x, y in candidates[:, :2]), dtype=bool, count=len(candidates))
    candidates = candidates[inside]
    if len(candidates) < 8:
        return []
    predicted = np.asarray([_plane_z(face, float(x), float(y), origin_x, origin_y) for x, y in candidates[:, :2]])
    residuals = candidates[:, 2] - predicted
    elevated = candidates[residuals >= MIN_OBSTACLE_HEIGHT_M]
    elevated_residuals = residuals[residuals >= MIN_OBSTACLE_HEIGHT_M]
    if len(elevated) < 4:
        return []
    eps = max(0.20, min(0.55, pixel_hint * 2.4))
    labels = DBSCAN(eps=eps, min_samples=4).fit_predict(elevated[:, :2])
    obstacles: list[dict[str, Any]] = []
    for label in sorted(set(labels)):
        if label < 0:
            continue
        cluster = elevated[labels == label]
        cluster_residuals = elevated_residuals[labels == label]
        if len(cluster) < 4:
            continue
        hull = MultiPoint(cluster[:, :2]).convex_hull
        if hull.geom_type != "Polygon":
            continue
        clipped = hull.intersection(interior)
        if clipped.geom_type != "Polygon" or clipped.is_empty:
            continue
        area = float(clipped.area)
        if area < MIN_OBSTACLE_AREA_M2 or area > min(8.0, max(0.5, geometry.area * 0.25)):
            continue
        height = float(np.percentile(cluster_residuals, 90))
        if height < MIN_OBSTACLE_HEIGHT_M:
            continue
        key = f"{face['id']}|{clipped.centroid.x:.2f}|{clipped.centroid.y:.2f}|{area:.2f}"
        obstacles.append({
            "id": "obs-" + hashlib.sha1(key.encode("utf-8"), usedforsecurity=False).hexdigest()[:12],
            "type": "other",
            "polygonLocalM": [
                {"x": float(x - origin_x), "y": float(y - origin_y)}
                for x, y in list(clipped.exterior.coords)[:-1]
            ],
            "heightM": height,
            "keepoutMm": 200,
            "evidence": [{
                "source": _source_evidence_name(source),
                "confidence": min(0.96, 0.68 + min(0.20, len(cluster) / 100) + min(0.08, height / 4)),
                "notes": [
                    f"Obstacle métrique détecté par surélévation de {height:.2f} m au-dessus du plan de toiture.",
                    "Le type visuel reste volontairement non classé tant qu'une preuve image ne le confirme pas.",
                ],
            }],
        })
    return obstacles


def _classify_shared_edge(
    left: dict[str, Any],
    right: dict[str, Any],
    start: tuple[float, float],
    end: tuple[float, float],
    origin_x: float,
    origin_y: float,
) -> str:
    midx = (start[0] + end[0]) / 2
    midy = (start[1] + end[1]) / 2
    edge_z = (_plane_z(left, midx, midy, origin_x, origin_y) + _plane_z(right, midx, midy, origin_x, origin_y)) / 2
    left_center = left["_geometry"].centroid
    right_center = right["_geometry"].centroid
    left_delta = edge_z - _plane_z(left, left_center.x, left_center.y, origin_x, origin_y)
    right_delta = edge_z - _plane_z(right, right_center.x, right_center.y, origin_x, origin_y)
    z_start = _plane_z(left, start[0], start[1], origin_x, origin_y)
    z_end = _plane_z(left, end[0], end[1], origin_x, origin_y)
    vertical_change = abs(z_end - z_start)
    if left_delta > 0.12 and right_delta > 0.12:
        return "ridge" if vertical_change <= 0.16 else "hip"
    if left_delta < -0.12 and right_delta < -0.12:
        return "valley"
    return "unknown"


def _segment_planes(points: np.ndarray, buildings: list[tuple[str, Polygon]], crs: CRS, source: str):
    building_union = unary_union([polygon for _, polygon in buildings])
    origin_point = building_union.centroid
    origin_x, origin_y = origin_point.x, origin_point.y
    to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    remaining = points.copy()
    initial_count = len(points)
    raw_faces: list[dict[str, Any]] = []
    diagnostics: list[str] = []

    span = max(np.ptp(points[:, 0]), np.ptp(points[:, 1]), 1.0)
    pixel_hint = max(0.1, min(0.8, span / max(math.sqrt(len(points)), 1.0)))
    residual_threshold = 0.10 if source == "google-dsm" else 0.14

    for plane_index in range(12):
        if len(remaining) < max(180, int(initial_count * 0.018)):
            break
        model = RANSACRegressor(
            estimator=LinearRegression(),
            min_samples=3,
            residual_threshold=residual_threshold,
            max_trials=800,
            stop_probability=0.999,
            random_state=42 + plane_index,
        )
        model.fit(remaining[:, :2], remaining[:, 2])
        mask_inliers = np.asarray(model.inlier_mask_, dtype=bool)
        if int(mask_inliers.sum()) < max(100, int(initial_count * 0.025)):
            break
        estimator = model.estimator_
        coeff = np.asarray(estimator.coef_, dtype=float)
        a, b = float(coeff[0]), float(coeff[1])
        c = float(estimator.intercept_)
        slope = math.degrees(math.atan(math.hypot(a, b)))
        inlier_points = remaining[mask_inliers]
        remaining = remaining[~mask_inliers]
        if not (0.0 <= slope <= 85.0):
            diagnostics.append(f"Plan {plane_index} rejeté : pente {slope:.1f}°.")
            continue
        down_east, down_north = -a, -b
        azimuth = (math.degrees(math.atan2(down_east, down_north)) + 360.0) % 360.0 if slope > 0.3 else 0.0

        for cluster in _split_inlier_clusters(inlier_points, pixel_hint):
            hull = MultiPoint(cluster[:, :2]).convex_hull
            if hull.geom_type != "Polygon":
                continue
            clipped = hull.intersection(building_union.buffer(0.45))
            polygons = [clipped] if clipped.geom_type == "Polygon" else list(getattr(clipped, "geoms", []))
            for geometry in polygons:
                if geometry.is_empty or geometry.area < MIN_FACE_AREA_M2:
                    continue
                building_id = _face_building_id(geometry, buildings)
                actual_area = float(geometry.area / max(math.cos(math.radians(slope)), 0.15))
                center = geometry.centroid
                face_id = _stable_face_id(building_id, geometry, slope, azimuth)
                local_polygon = [
                    {"x": float(x - origin_x), "y": float(y - origin_y)}
                    for x, y in list(geometry.exterior.coords)[:-1]
                ]
                lonlat_polygon = [
                    list(to_wgs84.transform(float(x), float(y)))
                    for x, y in list(geometry.exterior.coords)[:-1]
                ]
                predictions = estimator.predict(cluster[:, :2])
                median_residual = float(np.median(np.abs(cluster[:, 2] - predictions)))
                support_ratio = len(cluster) / max(initial_count, 1)
                support_quality = min(1.0, support_ratio / 0.25)
                residual_quality = max(0.0, min(1.0, 1.0 - median_residual / max(residual_threshold * 1.6, 0.01)))
                source_bonus = 0.06 if source == "google-dsm" else 0.08
                confidence = min(0.98, 0.56 + 0.16 * support_quality + 0.16 * residual_quality + source_bonus)
                raw_faces.append({
                    "id": face_id,
                    "buildingId": building_id,
                    "polygonLocalM": local_polygon,
                    "polygonLonLat": lonlat_polygon,
                    "plane": {"a": a, "b": b, "c": a * origin_x + b * origin_y + c},
                    "slopeDeg": slope,
                    "azimuthDeg": azimuth,
                    "areaM2": actual_area,
                    "centerLocalM": {"x": float(center.x - origin_x), "y": float(center.y - origin_y)},
                    "edgeIds": [],
                    "obstacles": [],
                    "evidence": [{
                        "source": _source_evidence_name(source),
                        "confidence": confidence,
                        "notes": [
                            f"Plan de toiture extrait automatiquement par RANSAC depuis {source}.",
                            f"Résidu médian du plan : {median_residual:.3f} m.",
                            f"Support du plan : {len(cluster)} points ({support_ratio * 100:.1f} % de l'échantillon).",
                        ],
                    }],
                    "confidence": confidence,
                    "_geometry": geometry,
                })

    if not raw_faces:
        raise ValueError("Aucun plan de toiture métrique suffisamment fiable n'a été extrait.")

    deduplicated: list[dict[str, Any]] = []
    for face in sorted(raw_faces, key=lambda item: item["areaM2"], reverse=True):
        duplicate = False
        for accepted in deduplicated:
            overlap = face["_geometry"].intersection(accepted["_geometry"]).area
            smaller = min(face["_geometry"].area, accepted["_geometry"].area)
            if (
                smaller > 0
                and overlap / smaller > 0.55
                and abs(face["slopeDeg"] - accepted["slopeDeg"]) < 4
                and _angular_distance(face["azimuthDeg"], accepted["azimuthDeg"]) < 12
            ):
                duplicate = True
                break
        if not duplicate:
            deduplicated.append(face)

    deduplicated.sort(key=lambda item: (item["buildingId"], item["azimuthDeg"], item["centerLocalM"]["x"], item["centerLocalM"]["y"]))
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for index, face in enumerate(deduplicated):
        face["displayLabel"] = alphabet[index] if index < len(alphabet) else f"P{index + 1}"
        face["obstacles"] = _detect_metric_obstacles(points, face, origin_x, origin_y, pixel_hint, source)

    edges: list[dict[str, Any]] = []
    edge_counter = 0
    for left_index, left in enumerate(deduplicated):
        for right in deduplicated[left_index + 1 :]:
            shared = left["_geometry"].boundary.intersection(right["_geometry"].boundary)
            lines = [shared] if shared.geom_type == "LineString" else list(getattr(shared, "geoms", []))
            for line in lines:
                if not isinstance(line, LineString) or line.length < 0.25:
                    continue
                coordinates = list(line.coords)
                start, end = coordinates[0], coordinates[-1]
                z_start = _plane_z(left, start[0], start[1], origin_x, origin_y)
                z_end = _plane_z(left, end[0], end[1], origin_x, origin_y)
                edge_id = f"edge-{edge_counter:03d}"
                edge_counter += 1
                edges.append({
                    "id": edge_id,
                    "a": {"x": float(start[0] - origin_x), "y": float(start[1] - origin_y), "z": float(z_start)},
                    "b": {"x": float(end[0] - origin_x), "y": float(end[1] - origin_y), "z": float(z_end)},
                    "kind": _classify_shared_edge(left, right, start, end, origin_x, origin_y),
                    "adjacentFaceIds": [left["id"], right["id"]],
                })
                left["edgeIds"].append(edge_id)
                right["edgeIds"].append(edge_id)

    building_boundary = building_union.boundary
    for face in deduplicated:
        coords = list(face["_geometry"].exterior.coords)
        for start, end in zip(coords, coords[1:]):
            segment = LineString([start, end])
            if segment.length < 0.25 or segment.centroid.distance(building_boundary) > 0.65:
                continue
            if any(segment.hausdorff_distance(LineString([
                (edge["a"]["x"] + origin_x, edge["a"]["y"] + origin_y),
                (edge["b"]["x"] + origin_x, edge["b"]["y"] + origin_y),
            ])) < 0.15 for edge in edges):
                continue
            z_start = _plane_z(face, start[0], start[1], origin_x, origin_y)
            z_end = _plane_z(face, end[0], end[1], origin_x, origin_y)
            edge_id = f"edge-{edge_counter:03d}"
            edge_counter += 1
            edges.append({
                "id": edge_id,
                "a": {"x": float(start[0] - origin_x), "y": float(start[1] - origin_y), "z": float(z_start)},
                "b": {"x": float(end[0] - origin_x), "y": float(end[1] - origin_y), "z": float(z_end)},
                "kind": "eave",
                "adjacentFaceIds": [face["id"]],
            })
            face["edgeIds"].append(edge_id)

    obstacle_count = sum(len(face["obstacles"]) for face in deduplicated)
    topology_counts: dict[str, int] = {}
    for edge in edges:
        topology_counts[edge["kind"]] = topology_counts.get(edge["kind"], 0) + 1

    for face in deduplicated:
        face.pop("_geometry", None)

    origin_lon, origin_lat = to_wgs84.transform(origin_x, origin_y)
    coverage = min(1.0, sum(face["areaM2"] * max(math.cos(math.radians(face["slopeDeg"])), 0.15) for face in deduplicated) / max(building_union.area, 1.0))
    mean_confidence = float(np.mean([face["confidence"] for face in deduplicated]))
    confidence = min(0.98, mean_confidence * 0.82 + min(coverage, 1.0) * 0.18)
    diagnostics.append(f"{len(deduplicated)} pans physiques retenus après dédoublonnage.")
    diagnostics.append(f"Couverture projetée de l'emprise bâtiment : {coverage * 100:.1f} %.")
    diagnostics.append(f"{obstacle_count} obstacle(s) métrique(s) détecté(s) par résidu altimétrique.")
    diagnostics.append("Topologie arêtes : " + ", ".join(f"{key}={value}" for key, value in sorted(topology_counts.items())))
    return [float(origin_lon), float(origin_lat)], deduplicated, edges, confidence, diagnostics


@app.post("/v1/roof/reconstruct")
async def reconstruct_roof(
    property: str = Form(...),
    source: str = Form(...),
    elevation: UploadFile | None = File(default=None),
    point_cloud: UploadFile | None = File(default=None),
    sampled_points: str | None = Form(default=None),
    copc_tiles: str | None = Form(default=None),
    imagery: UploadFile | None = File(default=None),
):
    del imagery  # RGB is reserved for later semantic obstacle classification; geometry stays metric-only.
    property_lock = _parse_property(property)
    if source not in {"google-dsm", "ign-mns", "ign-lidar", "photogrammetry"}:
        raise HTTPException(status_code=400, detail=f"Source géométrique inconnue : {source}")
    try:
        if point_cloud is not None:
            points, buildings, crs = _extract_point_cloud(await point_cloud.read(), property_lock)
        elif elevation is not None:
            points, buildings, crs = _extract_raster_points(await elevation.read(), property_lock)
        elif sampled_points:
            points, buildings, crs = _extract_sampled_points(sampled_points, property_lock)
        elif copc_tiles:
            raise ValueError("Des dalles COPC ont été découvertes mais leur lecture distante n'est pas encore autorisée ; le fallback IGN échantillonné doit être utilisé.")
        else:
            raise ValueError("Aucun GeoTIFF, nuage de points ou échantillon altimétrique fourni.")
        origin, faces, edges, confidence, diagnostics = _segment_planes(points, buildings, crs, source)
        return {
            "engineVersion": ENGINE_VERSION,
            "source": source,
            "origin": origin,
            "faces": faces,
            "edges": edges,
            "confidence": confidence,
            "diagnostics": diagnostics,
        }
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/photo/register")
async def register_photo(
    reference: UploadFile = File(...),
    photo: UploadFile = File(...),
):
    try:
        result = register_images(await reference.read(), await photo.read())
        if result.reprojection_error_px > 8.0:
            raise ValueError(f"Recalage rejeté : erreur médiane {result.reprojection_error_px:.1f} px (> 8 px).")
        return {
            "homography": result.homography,
            "reprojectionErrorPx": result.reprojection_error_px,
            "matches": result.matches,
            "inliers": result.inliers,
            "method": result.method,
            "diagnostics": result.diagnostics,
        }
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(error)) from error
