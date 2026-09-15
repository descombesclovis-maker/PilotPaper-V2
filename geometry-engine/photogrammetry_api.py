from __future__ import annotations

import base64
import importlib.util
import json
from typing import Any

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

router = APIRouter()


def _decode(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or min(image.shape[:2]) < 256:
        raise ValueError("Photo photogrammétrique non décodable ou trop petite.")
    return image


def _two_view_sparse(first: np.ndarray, second: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    sift = cv2.SIFT_create(nfeatures=12000, contrastThreshold=0.02, edgeThreshold=12)
    key_a, desc_a = sift.detectAndCompute(first, None)
    key_b, desc_b = sift.detectAndCompute(second, None)
    if desc_a is None or desc_b is None or len(key_a) < 80 or len(key_b) < 80:
        raise ValueError("Pas assez de détails visuels communs pour la photogrammétrie.")
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(desc_a, desc_b, k=2)
    good = [a for a, b in pairs if a.distance < 0.72 * b.distance]
    if len(good) < 40:
        raise ValueError(f"Seulement {len(good)} correspondances photogrammétriques fiables.")
    pa = np.float32([key_a[item.queryIdx].pt for item in good])
    pb = np.float32([key_b[item.trainIdx].pt for item in good])
    width = max(first.shape[1], second.shape[1])
    height = max(first.shape[0], second.shape[0])
    focal = 1.2 * max(width, height)
    camera = np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]], dtype=np.float64)
    essential, mask = cv2.findEssentialMat(pa, pb, camera, cv2.RANSAC, 0.999, 1.2)
    if essential is None or mask is None:
        raise ValueError("Matrice essentielle impossible à estimer.")
    _, rotation, translation, pose_mask = cv2.recoverPose(essential, pa, pb, camera, mask=mask)
    inliers = pose_mask.reshape(-1) > 0
    pa = pa[inliers]
    pb = pb[inliers]
    if len(pa) < 30:
        raise ValueError("Pose caméra trop incertaine après RANSAC.")
    projection_a = camera @ np.hstack([np.eye(3), np.zeros((3, 1))])
    projection_b = camera @ np.hstack([rotation, translation])
    homogeneous = cv2.triangulatePoints(projection_a, projection_b, pa.T, pb.T)
    points = (homogeneous[:3] / homogeneous[3]).T
    valid = np.isfinite(points).all(axis=1) & (points[:, 2] > 0)
    points = points[valid]
    if len(points) < 25:
        raise ValueError("Nuage photogrammétrique clairsemé insuffisant.")
    return points, {
        "matches": len(good),
        "poseInliers": int(inliers.sum()),
        "triangulatedPoints": int(len(points)),
        "focalAssumptionPx": float(focal),
    }


@router.post("/v1/photogrammetry/reconstruct")
async def reconstruct_photogrammetry(
    property: str = Form(...),
    photos: list[UploadFile] = File(...),
    metric_anchor: str | None = Form(default=None),
):
    try:
        property_lock = json.loads(property)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail=f"Property Lock invalide : {error}") from error
    if not property_lock.get("targetBuildingIds"):
        raise HTTPException(status_code=400, detail="Photogrammétrie interdite sans Property Lock.")
    if len(photos) < 3:
        raise HTTPException(status_code=422, detail="Photogrammétrie : au moins 3 vues distinctes sont requises.")

    decoded: list[np.ndarray] = []
    for photo in photos[:8]:
        try:
            decoded.append(_decode(await photo.read()))
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=str(error)) from error

    candidates: list[tuple[np.ndarray, dict[str, Any]]] = []
    errors: list[str] = []
    for index in range(len(decoded) - 1):
        try:
            candidates.append(_two_view_sparse(decoded[index], decoded[index + 1]))
        except Exception as error:  # noqa: BLE001
            errors.append(f"paire {index}-{index + 1}: {error}")
    if not candidates:
        raise HTTPException(status_code=422, detail="Aucune paire photogrammétrique exploitable. " + " | ".join(errors[-3:]))

    best_points, diagnostics = max(candidates, key=lambda item: len(item[0]))
    pycolmap_available = importlib.util.find_spec("pycolmap") is not None

    # Sparse photogrammetry has arbitrary scale without a metric anchor. PilotPaper
    # must never silently turn it into legal-plan geometry. A future automatic
    # metric anchor can be obtained from Site Twin/orthophoto correspondences.
    anchor = None
    if metric_anchor:
        try:
            anchor = json.loads(metric_anchor)
        except json.JSONDecodeError:
            anchor = None
    metric_anchored = bool(anchor and anchor.get("confirmed") is True and anchor.get("scaleMetersPerUnit"))

    preview_points = best_points
    if len(preview_points) > 1200:
        indices = np.linspace(0, len(preview_points) - 1, 1200).astype(int)
        preview_points = preview_points[indices]
    preview = base64.b64encode(preview_points.astype(np.float32).tobytes()).decode("ascii")

    return {
        "status": "metric_candidate" if metric_anchored else "candidate_requires_metric_anchor",
        "metricAnchored": metric_anchored,
        "pycolmapAvailable": pycolmap_available,
        "diagnostics": diagnostics,
        "pairErrors": errors,
        "pointFormat": "float32_xyz",
        "pointCount": int(len(preview_points)),
        "pointsBase64": preview,
        "restriction": (
            "Candidat photogrammétrique seulement. Interdit comme géométrie DP canonique sans ancrage métrique vérifié."
        ),
    }
