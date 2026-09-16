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
from pyproj import CRS, Transformer
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


def _reference_png_with_explicit_geometry(raw: bytes, crs_raw: str, bbox_raw: str):
    try:
        crs = CRS.from_user_input(crs_raw)
    except Exception as error:  # noqa: BLE001
        raise ValueError(f"CRS de référence invalide : {error}") from error
    try:
        parsed = json.loads(bbox_raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"BBOX de référence invalide : {error}") from error
    if not isinstance(parsed, list) or len(parsed) != 4:
        raise ValueError("Le BBOX de référence doit contenir quatre coordonnées.")
    bbox = tuple(float(value) for value in parsed)
    if not all(math.isfinite(value) for value in bbox):
        raise ValueError("Le BBOX de référence contient une valeur non finie.")
    min_x, min_y, max_x, max_y = bbox
    if max_x <= min_x or max_y <= min_y:
        raise ValueError("Le BBOX de référence est dégénéré.")
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            image = opened.convert("RGB")
            if image.width < 64 or image.height < 64:
                raise ValueError("image de référence trop petite")
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
            return output.getvalue(), image.width, image.height, crs, bbox
    except Exception as error:  # noqa: BLE001
        raise ValueError(f"image de référence non décodable : {error}") from error


def _module_polygons_lonlat(raw: str) -> list[list[tuple[float, float]]]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"polygones géographiques modules invalides : {error}") from error
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("aucun polygone géographique module fourni")
    output: list[list[tuple[float, float]]] = []
    for module in parsed:
        if not isinstance(module, list) or len(module) != 4:
            raise ValueError("chaque module doit contenir exactement quatre coins géographiques")
        corners: list[tuple[float, float]] = []
        for point in module:
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError("coin géographique module invalide")
            lon = float(point[0])
            lat = float(point[1])
            if not (math.isfinite(lon) and math.isfinite(lat)):
                raise ValueError("coordonnée géographique module non finie")
            if lon < -180 or lon > 180 or lat < -90 or lat > 90:
                raise ValueError("coordonnée géographique module hors domaine")
            corners.append((lon, lat))
        output.append(corners)
    return output


def _project_reference_pixels(
    polygons_lonlat: list[list[tuple[float, float]]],
    *,
    dataset: rasterio.io.DatasetReader | None = None,
    explicit_crs: CRS | None = None,
    explicit_bbox: tuple[float, float, float, float] | None = None,
    explicit_width: int | None = None,
    explicit_height: int | None = None,
) -> list[np.ndarray]:
    if dataset is None and (explicit_crs is None or explicit_bbox is None or explicit_width is None or explicit_height is None):
        raise ValueError("géoréférencement de la référence incomplet")
    reference_crs = dataset.crs if dataset is not None else explicit_crs
    if reference_crs is None:
        raise ValueError("CRS de référence absent")
    to_reference = Transformer.from_crs("EPSG:4326", reference_crs, always_xy=True)
    result: list[np.ndarray] = []
    for module in polygons_lonlat:
        points: list[list[float]] = []
        for lon, lat in module:
            ref_x, ref_y = to_reference.transform(lon, lat)
            if not (math.isfinite(float(ref_x)) and math.isfinite(float(ref_y))):
                raise ValueError("transformation CRS non finie pour un coin de module")
            if dataset is not None:
                row, col = dataset.index(ref_x, ref_y)
                pixel_x = float(col) + 0.5
                pixel_y = float(row) + 0.5
                width = dataset.width
                height = dataset.height
            else:
                assert explicit_bbox is not None and explicit_width is not None and explicit_height is not None
                min_x, min_y, max_x, max_y = explicit_bbox
                pixel_x = ((float(ref_x) - min_x) / (max_x - min_x)) * explicit_width
                pixel_y = ((max_y - float(ref_y)) / (max_y - min_y)) * explicit_height
                width = explicit_width
                height = explicit_height
            points.append([pixel_x, pixel_y])
        array = np.asarray(points, dtype=np.float32)
        if (
            np.any(array[:, 0] < -3)
            or np.any(array[:, 0] > width + 3)
            or np.any(array[:, 1] < -3)
            or np.any(array[:, 1] > height + 3)
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
    if not np.all(np.isfinite(matrix)):
        raise ValueError("homographie non finie")
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
    module_polygons_lonlat: str = Form(...),
    reference: UploadFile = File(...),
    photo: UploadFile = File(...),
    reference_crs: str | None = Form(default=None),
    reference_bbox: str | None = Form(default=None),
):
    reference_raw = await reference.read()
    photo_raw = await photo.read()
    if not reference_raw or not photo_raw:
        raise HTTPException(status_code=422, detail="Référence géométrique ou photo absente.")
    if bool(reference_crs) != bool(reference_bbox):
        raise HTTPException(status_code=422, detail="CRS et BBOX de référence doivent être fournis ensemble.")

    memory = None
    dataset = None
    try:
        polygons_lonlat = _module_polygons_lonlat(module_polygons_lonlat)
        photo_png, width, height = _normalise_photo(photo_raw)

        explicit_crs = None
        explicit_bbox = None
        explicit_width = None
        explicit_height = None
        if reference_crs and reference_bbox:
            reference_png, explicit_width, explicit_height, explicit_crs, explicit_bbox = _reference_png_with_explicit_geometry(
                reference_raw,
                reference_crs,
                reference_bbox,
            )
        else:
            memory, dataset, reference_png = _reference_png_and_dataset(reference_raw)

        registration = register_images(reference_png, photo_png)
        ratio = registration.inliers / max(registration.matches, 1)
        if registration.reprojection_error_px > 8.0 or registration.inliers < 12 or ratio < 0.28:
            raise ValueError(
                f"recalage insuffisant : {registration.reprojection_error_px:.1f} px, "
                f"{registration.inliers}/{registration.matches} inliers ({ratio * 100:.0f} %)"
            )
        reference_polygons = _project_reference_pixels(
            polygons_lonlat,
            dataset=dataset,
            explicit_crs=explicit_crs,
            explicit_bbox=explicit_bbox,
            explicit_width=explicit_width,
            explicit_height=explicit_height,
        )
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
