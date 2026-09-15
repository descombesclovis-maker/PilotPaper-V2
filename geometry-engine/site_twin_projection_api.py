from __future__ import annotations

import base64
import io
import json
import math
from typing import Any

import cv2
import numpy as np
import rasterio
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps
from pyproj import Transformer
from rasterio.io import MemoryFile

from registration import register_images

router = APIRouter()
MAX_EDGE = 4096


def _normalise_photo(raw: bytes) -> tuple[bytes, int, int]:
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            if image.width < 64 or image.height < 64:
                raise ValueError("photo trop petite")
            scale = min(1.0, MAX_EDGE / max(image.width, image.height))
            if scale < 1.0:
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.Resampling.LANCZOS,
                )
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
            return output.getvalue(), image.width, image.height
    except Exception as error:  # noqa: BLE001
        raise ValueError(f"photo non décodable : {error}") from error


def _normalise_band(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    out = np.zeros(values.shape, dtype=np.uint8)
    selected = values[valid]
    if selected.size == 0:
        return out
    if values.dtype == np.uint8:
        out[valid] = values[valid]
        return out
    lo, hi = np.percentile(selected.astype(np.float64), [1.0, 99.0])
    if not math.isfinite(float(lo)) or not math.isfinite(float(hi)) or hi <= lo:
        lo, hi = float(np.min(selected)), float(np.max(selected))
    if hi <= lo:
        out[valid] = 128
        return out
    scaled = np.clip((values.astype(np.float64) - lo) * (255.0 / (hi - lo)), 0, 255)
    out[valid] = scaled[valid].astype(np.uint8)
    return out


def _reference_png_and_dataset(raw: bytes):
    memory = MemoryFile(raw)
    dataset = memory.open()
    if dataset.crs is None or dataset.count < 1:
        dataset.close()
        memory.close()
        raise ValueError("orthophoto de référence sans CRS ou sans bande image")
    bands = dataset.read(list(range(1, min(dataset.count, 3) + 1)), masked=True)
    if bands.shape[0] == 1:
        bands = np.repeat(bands, 3, axis=0)
    elif bands.shape[0] == 2:
        bands = np.concatenate([bands, bands[1:2]], axis=0)
    rgb = np.zeros((dataset.height, dataset.width, 3), dtype=np.uint8)
    for channel in range(3):
        band = bands[channel]
        values = np.asarray(band.data if np.ma.isMaskedArray(band) else band)
        valid = ~np.asarray(band.mask) if np.ma.isMaskedArray(band) else np.isfinite(values)
        if np.ndim(valid) == 0:
            valid = np.full(values.shape, bool(valid), dtype=bool)
        valid = valid & np.isfinite(values)
        rgb[:, :, channel] = _normalise_band(values, valid)
    output = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(output, format="PNG", optimize=True)
    return memory, dataset, output.getvalue()


def _module_polygons(raw: str) -> list[list[dict[str, float]]]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"polygones modules invalides : {error}") from error
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("aucun polygone module fourni")
    output: list[list[dict[str, float]]] = []
    for module in parsed:
        if not isinstance(module, list) or len(module) != 4:
            raise ValueError("chaque module doit contenir exactement quatre coins")
        corners: list[dict[str, float]] = []
        for point in module:
            if not isinstance(point, dict):
                raise ValueError("coin de module invalide")
            x = float(point.get("x", math.nan))
            y = float(point.get("y", math.nan))
            if not (math.isfinite(x) and math.isfinite(y)):
                raise ValueError("coordonnée module non finie")
            corners.append({"x": x, "y": y})
        output.append(corners)
    return output


def _local_to_lonlat(origin_lon: float, origin_lat: float, x_m: float, y_m: float) -> tuple[float, float]:
    latitude = origin_lat + y_m / 110_540.0
    metres_per_lon_degree = max(1.0, 111_320.0 * math.cos(math.radians(origin_lat)))
    longitude = origin_lon + x_m / metres_per_lon_degree
    return longitude, latitude


def _project_reference_pixels(
    dataset: rasterio.io.DatasetReader,
    origin_lon: float,
    origin_lat: float,
    polygons: list[list[dict[str, float]]],
) -> list[np.ndarray]:
    to_reference = Transformer.from_crs("EPSG:4326", dataset.crs, always_xy=True)
    result: list[np.ndarray] = []
    for module in polygons:
        points: list[list[float]] = []
        for point in module:
            lon, lat = _local_to_lonlat(origin_lon, origin_lat, point["x"], point["y"])
            ref_x, ref_y = to_reference.transform(lon, lat)
            row, col = dataset.index(ref_x, ref_y)
            points.append([float(col) + 0.5, float(row) + 0.5])
        array = np.asarray(points, dtype=np.float32)
        if (
            np.any(array[:, 0] < -3)
            or np.any(array[:, 0] > dataset.width + 3)
            or np.any(array[:, 1] < -3)
            or np.any(array[:, 1] > dataset.height + 3)
        ):
            raise ValueError("un module projeté sort de l'orthophoto de référence")
        result.append(array)
    return result


def _apply_homography(
    polygons: list[np.ndarray],
    matrix_values: list[float],
    width: int,
    height: int,
) -> list[list[dict[str, float]]]:
    matrix = np.asarray(matrix_values, dtype=np.float64).reshape(3, 3)
    output: list[list[dict[str, float]]] = []
    for polygon in polygons:
        projected = cv2.perspectiveTransform(polygon.reshape(-1, 1, 2), matrix).reshape(-1, 2)
        if not np.all(np.isfinite(projected)):
            raise ValueError("projection photo non finie")
        normalised = [
            {"x": float(x / width), "y": float(y / height)}
            for x, y in projected
        ]
        if any(point["x"] < -0.03 or point["x"] > 1.03 or point["y"] < -0.03 or point["y"] > 1.03 for point in normalised):
            raise ValueError("projection des panneaux hors image")
        output.append(normalised)
    return output


@router.post("/v1/site-twin/project-modules")
async def project_modules(
    origin_lon: float = Form(...),
    origin_lat: float = Form(...),
    module_polygons: str = Form(...),
    reference: UploadFile = File(...),
    photo: UploadFile = File(...),
):
    reference_raw = await reference.read()
    photo_raw = await photo.read()
    if not reference_raw or not photo_raw:
        raise HTTPException(status_code=422, detail="Référence géométrique ou photo absente.")

    memory = None
    dataset = None
    try:
        polygons = _module_polygons(module_polygons)
        photo_png, width, height = _normalise_photo(photo_raw)
        memory, dataset, reference_png = _reference_png_and_dataset(reference_raw)
        registration = register_images(reference_png, photo_png)
        ratio = registration.inliers / max(registration.matches, 1)
        if registration.reprojection_error_px > 8.0 or registration.inliers < 12 or ratio < 0.28:
            raise ValueError(
                f"recalage insuffisant : {registration.reprojection_error_px:.1f} px, "
                f"{registration.inliers}/{registration.matches} inliers ({ratio * 100:.0f} %)"
            )
        reference_polygons = _project_reference_pixels(dataset, origin_lon, origin_lat, polygons)
        projected = _apply_homography(reference_polygons, registration.homography, width, height)
        return {
            "mimeType": "image/png",
            "photoBase64": base64.b64encode(photo_png).decode("ascii"),
            "widthPx": width,
            "heightPx": height,
            "panelPolygonsNormalized": projected,
            "registration": {
                "homography": registration.homography,
                "reprojectionErrorPx": registration.reprojection_error_px,
                "matches": registration.matches,
                "inliers": registration.inliers,
                "inlierRatio": ratio,
                "method": registration.method,
                "diagnostics": registration.diagnostics,
            },
        }
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        if dataset is not None:
            dataset.close()
        if memory is not None:
            memory.close()
