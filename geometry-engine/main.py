from __future__ import annotations

import importlib.util
import io
import json
import math
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pyproj import CRS, Transformer
from shapely.geometry import Point
from shapely.ops import unary_union

from app import (
    ENGINE_VERSION,
    _extract_point_cloud,
    _extract_raster_points,
    _parse_property,
    _projected_buildings,
    _segment_planes,
)
from registration import register_images
from topology_refinement import refine_roof_topology

app = FastAPI(title="PilotPaper Geometry Engine", version=ENGINE_VERSION)


def _optional_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


@app.get("/health")
def health() -> dict[str, Any]:
    capabilities = [
        "geotiff-dsm",
        "ign-mnx-samples",
        "sampled-elevation-points",
        "las-laz",
        "ransac-planes",
        "metric-obstacles",
        "roof-edge-topology",
        "opencv-registration",
        "site-twin-photo-projection",
    ]
    if _optional_module("open3d"):
        capabilities.append("open3d")
    if _optional_module("pdal"):
        capabilities.extend(["pdal", "ign-copc-streaming"])
    if _optional_module("torch") and _optional_module("lightglue"):
        capabilities.append("lightglue")
    if _optional_module("pycolmap"):
        capabilities.append("photogrammetry-pycolmap")
    return {"ok": True, "version": ENGINE_VERSION, "capabilities": capabilities}


def _clean_with_open3d(points: np.ndarray, source: str) -> tuple[np.ndarray, list[str]]:
    if not _optional_module("open3d") or len(points) < 250:
        return points, []
    diagnostics: list[str] = []
    try:
        import open3d as o3d  # type: ignore

        cloud = o3d.geometry.PointCloud()
        cloud.points = o3d.utility.Vector3dVector(points)
        voxel = 0.08 if source == "google-dsm" else 0.12
        cloud = cloud.voxel_down_sample(voxel_size=voxel)
        if len(cloud.points) >= 250:
            cloud, _ = cloud.remove_statistical_outlier(nb_neighbors=24, std_ratio=2.2)
        cleaned = np.asarray(cloud.points, dtype=np.float64)
        if len(cleaned) >= 180:
            diagnostics.append(f"Open3D : {len(points)} → {len(cleaned)} points après nettoyage/voxelisation.")
            return cleaned, diagnostics
    except Exception as error:  # noqa: BLE001
        diagnostics.append(f"Open3D ignoré après erreur non bloquante : {error}")
    return points, diagnostics


def _sampled_points_to_metric(raw: str, property_lock: dict[str, Any]):
    try:
        samples = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"Échantillons IGN invalides : {error}") from error
    if not isinstance(samples, list) or len(samples) < 120:
        raise ValueError("Pas assez d'échantillons IGN pour reconstruire le toit.")
    crs = CRS.from_epsg(2154)
    transform = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    rows: list[list[float]] = []
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        lon = float(sample.get("longitude", math.nan))
        lat = float(sample.get("latitude", math.nan))
        z = float(sample.get("z", math.nan))
        if not (math.isfinite(lon) and math.isfinite(lat) and math.isfinite(z)):
            continue
        x, y = transform.transform(lon, lat)
        rows.append([x, y, z])
    if len(rows) < 120:
        raise ValueError("Échantillons IGN valides insuffisants après projection Lambert-93.")
    buildings = _projected_buildings(property_lock, crs)
    points = np.asarray(rows, dtype=np.float64)
    target = unary_union([polygon for _, polygon in buildings]).buffer(0.65)
    minx, miny, maxx, maxy = target.bounds
    keep = (
        (points[:, 0] >= minx) & (points[:, 0] <= maxx)
        & (points[:, 1] >= miny) & (points[:, 1] <= maxy)
        & np.isfinite(points[:, 2])
    )
    points = points[keep]
    if len(points):
        inside = np.fromiter(
            (target.covers(Point(x, y)) for x, y in points[:, :2]),
            dtype=bool,
            count=len(points),
        )
        points = points[inside]
    if len(points) < 120:
        raise ValueError(f"IGN MNX : couverture insuffisante sur le bâtiment verrouillé ({len(points)} points).")
    return points, buildings, crs


def _copc_points(raw: str, property_lock: dict[str, Any]):
    if not _optional_module("pdal"):
        raise ValueError("PDAL n'est pas installé : le streaming COPC LiDAR HD est indisponible.")
    try:
        tiles = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"Liste COPC invalide : {error}") from error
    if not isinstance(tiles, list) or not tiles:
        raise ValueError("Aucune dalle COPC IGN fournie.")

    import pdal  # type: ignore

    crs = CRS.from_epsg(2154)
    buildings = _projected_buildings(property_lock, crs)
    minx = min(poly.bounds[0] for _, poly in buildings) - 1.0
    miny = min(poly.bounds[1] for _, poly in buildings) - 1.0
    maxx = max(poly.bounds[2] for _, poly in buildings) + 1.0
    maxy = max(poly.bounds[3] for _, poly in buildings) + 1.0
    bounds = f"([{minx},{maxx}],[{miny},{maxy}])"

    arrays: list[np.ndarray] = []
    failures: list[str] = []
    for tile in tiles[:4]:
        url = str((tile or {}).get("url", "")).strip()
        if not url.startswith("https://"):
            continue
        try:
            pipeline = pdal.Pipeline(json.dumps([
                {"type": "readers.copc", "filename": url, "bounds": bounds},
            ]))
            pipeline.execute()
            for array in pipeline.arrays:
                names = set(array.dtype.names or [])
                if not {"X", "Y", "Z"}.issubset(names):
                    continue
                xyz = np.column_stack([array["X"], array["Y"], array["Z"]]).astype(np.float64)
                if "Classification" in names:
                    classification = np.asarray(array["Classification"])
                    building_only = xyz[classification == 6]
                    if len(building_only) >= 120:
                        xyz = building_only
                arrays.append(xyz)
        except Exception as error:  # noqa: BLE001
            failures.append(str(error))
    if not arrays:
        suffix = f" Dernière erreur : {failures[-1]}" if failures else ""
        raise ValueError(f"Aucun point COPC IGN n'a pu être lu.{suffix}")
    points = np.concatenate(arrays, axis=0)
    if len(points) < 120:
        raise ValueError("COPC IGN : moins de 120 points sur le bâtiment.")
    return points, buildings, crs


def _result(points: np.ndarray, buildings: list[tuple[str, Any]], crs: CRS, source: str):
    points, open3d_diagnostics = _clean_with_open3d(points, source)
    origin, faces, edges, confidence, diagnostics = _segment_planes(points, buildings, crs, source)
    faces, edges, topology_diagnostics = refine_roof_topology(faces, edges, buildings)
    diagnostics = open3d_diagnostics + diagnostics + topology_diagnostics
    return {
        "engineVersion": ENGINE_VERSION,
        "source": source,
        "origin": origin,
        "faces": faces,
        "edges": edges,
        "confidence": confidence,
        "diagnostics": diagnostics,
    }


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
    del imagery  # Metric geometry remains independent from texture generation.
    property_lock = _parse_property(property)
    if source not in {"google-dsm", "ign-mns", "ign-lidar", "photogrammetry"}:
        raise HTTPException(status_code=400, detail=f"Source géométrique inconnue : {source}")
    try:
        if copc_tiles:
            points, buildings, crs = _copc_points(copc_tiles, property_lock)
            return _result(points, buildings, crs, "ign-lidar")
        if point_cloud is not None:
            points, buildings, crs = _extract_point_cloud(await point_cloud.read(), property_lock)
            return _result(points, buildings, crs, source)
        if elevation is not None:
            points, buildings, crs = _extract_raster_points(await elevation.read(), property_lock)
            return _result(points, buildings, crs, source)
        if sampled_points:
            points, buildings, crs = _sampled_points_to_metric(sampled_points, property_lock)
            return _result(points, buildings, crs, "ign-mns")
        raise ValueError("Aucun GeoTIFF, nuage de points, COPC ou échantillon MNX fourni.")
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/photo/register")
async def register_photo(reference: UploadFile = File(...), photo: UploadFile = File(...)):
    try:
        result = register_images(await reference.read(), await photo.read())
        ratio = result.inliers / max(result.matches, 1)
        if result.reprojection_error_px > 8.0 or result.inliers < 12 or ratio < 0.28:
            raise ValueError(
                f"Recalage rejeté : erreur {result.reprojection_error_px:.1f} px, "
                f"{result.inliers}/{result.matches} inliers ({ratio * 100:.0f} %)."
            )
        return {
            "homography": result.homography,
            "reprojectionErrorPx": result.reprojection_error_px,
            "matches": result.matches,
            "inliers": result.inliers,
            "inlierRatio": ratio,
            "method": result.method,
            "diagnostics": result.diagnostics,
        }
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/photo/validate")
async def validate_photo(photo: UploadFile = File(...)):
    data = await photo.read()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="Photo non décodable.")
    height, width = image.shape[:2]
    if width < 256 or height < 256:
        raise HTTPException(status_code=422, detail="Photo trop petite pour une génération DP fiable.")
    sharpness = float(cv2.Laplacian(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    return {
        "ok": True,
        "widthPx": int(width),
        "heightPx": int(height),
        "sharpness": sharpness,
        "warning": "Image potentiellement floue" if sharpness < 35 else None,
    }
