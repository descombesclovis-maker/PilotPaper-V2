from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


@dataclass
class RegistrationResult:
    homography: list[float]
    reprojection_error_px: float
    matches: int
    inliers: int
    method: str
    diagnostics: list[str]


def _decode_image(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape[0] < 64 or image.shape[1] < 64:
        raise ValueError("Image absente, corrompue ou trop petite pour le recalage.")
    return image


def _homography_from_matches(
    points_a: np.ndarray,
    points_b: np.ndarray,
    method: str,
    diagnostics: list[str],
) -> RegistrationResult:
    if len(points_a) < 8 or len(points_b) < 8:
        raise ValueError("Pas assez de correspondances pour calculer une homographie robuste.")
    matrix, mask = cv2.findHomography(points_a, points_b, cv2.RANSAC, 3.0, maxIters=5000, confidence=0.999)
    if matrix is None or mask is None:
        raise ValueError("Homographie impossible à estimer.")
    inlier_mask = mask.reshape(-1).astype(bool)
    inliers = int(inlier_mask.sum())
    if inliers < 8:
        raise ValueError(f"Recalage rejeté : seulement {inliers} correspondances cohérentes.")
    projected = cv2.perspectiveTransform(points_a.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    residuals = np.linalg.norm(projected - points_b, axis=1)
    error = float(np.median(residuals[inlier_mask]))
    if not np.isfinite(error):
        raise ValueError("Erreur de reprojection non finie.")
    matrix = matrix / matrix[2, 2]
    return RegistrationResult(
        homography=[float(value) for value in matrix.reshape(-1)],
        reprojection_error_px=error,
        matches=int(len(points_a)),
        inliers=inliers,
        method=method,
        diagnostics=diagnostics,
    )


def _register_orb(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    reference = _decode_image(reference_bytes)
    photo = _decode_image(photo_bytes)
    detector = cv2.ORB_create(nfeatures=8000, scaleFactor=1.2, nlevels=8, fastThreshold=10)
    key_a, des_a = detector.detectAndCompute(reference, None)
    key_b, des_b = detector.detectAndCompute(photo, None)
    if des_a is None or des_b is None or len(key_a) < 16 or len(key_b) < 16:
        raise ValueError("ORB n'a pas trouvé assez de points caractéristiques.")
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [first for first, second in pairs if first.distance < 0.72 * second.distance]
    if len(good) < 8:
        raise ValueError(f"ORB n'a conservé que {len(good)} correspondances fiables.")
    points_a = np.float32([key_a[item.queryIdx].pt for item in good])
    points_b = np.float32([key_b[item.trainIdx].pt for item in good])
    return _homography_from_matches(points_a, points_b, "opencv-orb", ["Fallback local OpenCV ORB + RANSAC."])


def _register_lightglue(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    # LightGlue is optional because torch wheels and CUDA compatibility vary by host.
    # Any import/runtime problem falls back to OpenCV instead of blocking PilotPaper.
    import torch  # type: ignore
    from lightglue import LightGlue, SuperPoint  # type: ignore

    reference = _decode_image(reference_bytes)
    photo = _decode_image(photo_bytes)

    def tensor(image: np.ndarray):
        value = torch.from_numpy(image.astype(np.float32) / 255.0)[None, None]
        return value.cuda() if torch.cuda.is_available() else value

    device = "cuda" if torch.cuda.is_available() else "cpu"
    extractor = SuperPoint(max_num_keypoints=4096).eval().to(device)
    matcher = LightGlue(features="superpoint").eval().to(device)
    with torch.inference_mode():
        features_a: dict[str, Any] = extractor.extract(tensor(reference))
        features_b: dict[str, Any] = extractor.extract(tensor(photo))
        result: dict[str, Any] = matcher({"image0": features_a, "image1": features_b})

    key_a = features_a["keypoints"][0].detach().cpu().numpy()
    key_b = features_b["keypoints"][0].detach().cpu().numpy()
    matches = result.get("matches")
    if matches is None:
        matches0 = result.get("matches0")
        if matches0 is None:
            raise ValueError("LightGlue n'a renvoyé aucune correspondance.")
        matches0 = matches0[0].detach().cpu().numpy()
        valid = np.where(matches0 >= 0)[0]
        pairs = np.column_stack([valid, matches0[valid]])
    else:
        pairs = matches[0].detach().cpu().numpy()
    if len(pairs) < 8:
        raise ValueError(f"LightGlue n'a trouvé que {len(pairs)} correspondances.")
    points_a = np.float32(key_a[pairs[:, 0]])
    points_b = np.float32(key_b[pairs[:, 1]])
    return _homography_from_matches(
        points_a,
        points_b,
        "lightglue-superpoint",
        [f"LightGlue exécuté sur {device}.", "Homographie validée par RANSAC OpenCV."],
    )


def register_images(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    diagnostics: list[str] = []
    try:
        return _register_lightglue(reference_bytes, photo_bytes)
    except Exception as error:  # noqa: BLE001 - optional accelerator must never make the service unavailable.
        diagnostics.append(f"LightGlue indisponible ou non concluant : {error}")
    result = _register_orb(reference_bytes, photo_bytes)
    result.diagnostics = diagnostics + result.diagnostics
    return result
