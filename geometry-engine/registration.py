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


def _enhance(image: np.ndarray) -> np.ndarray:
    # Orthophotos and chantier photos frequently differ in season, exposure and
    # local contrast. CLAHE improves repeatable structural keypoints without
    # inventing or moving geometry.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(image)


def _homography_from_matches(
    points_a: np.ndarray,
    points_b: np.ndarray,
    method: str,
    diagnostics: list[str],
) -> RegistrationResult:
    if len(points_a) < 8 or len(points_b) < 8:
        raise ValueError("Pas assez de correspondances pour calculer une homographie robuste.")

    robust_method = cv2.USAC_MAGSAC if hasattr(cv2, "USAC_MAGSAC") else cv2.RANSAC
    matrix, mask = cv2.findHomography(
        points_a,
        points_b,
        robust_method,
        3.0,
        maxIters=10000,
        confidence=0.999,
    )
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
    denominator = float(matrix[2, 2])
    if not np.isfinite(denominator) or abs(denominator) < 1e-12:
        raise ValueError("Homographie numériquement instable.")
    matrix = matrix / denominator
    if not np.all(np.isfinite(matrix)):
        raise ValueError("Homographie contenant des valeurs non finies.")
    diagnostics = diagnostics + [
        "Homographie validée par USAC MAGSAC." if robust_method == getattr(cv2, "USAC_MAGSAC", None)
        else "Homographie validée par RANSAC OpenCV.",
    ]
    return RegistrationResult(
        homography=[float(value) for value in matrix.reshape(-1)],
        reprojection_error_px=error,
        matches=int(len(points_a)),
        inliers=inliers,
        method=method,
        diagnostics=diagnostics,
    )


def _register_sift(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    reference = _enhance(_decode_image(reference_bytes))
    photo = _enhance(_decode_image(photo_bytes))
    if not hasattr(cv2, "SIFT_create"):
        raise ValueError("SIFT n'est pas disponible dans cette build OpenCV.")
    detector = cv2.SIFT_create(
        nfeatures=7000,
        contrastThreshold=0.018,
        edgeThreshold=12,
        sigma=1.4,
    )
    key_a, des_a = detector.detectAndCompute(reference, None)
    key_b, des_b = detector.detectAndCompute(photo, None)
    if des_a is None or des_b is None or len(key_a) < 16 or len(key_b) < 16:
        raise ValueError("SIFT n'a pas trouvé assez de points caractéristiques.")
    matcher = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [first for pair in pairs if len(pair) == 2 for first, second in [pair] if first.distance < 0.76 * second.distance]
    if len(good) < 8:
        raise ValueError(f"SIFT n'a conservé que {len(good)} correspondances fiables.")
    points_a = np.float32([key_a[item.queryIdx].pt for item in good])
    points_b = np.float32([key_b[item.trainIdx].pt for item in good])
    return _homography_from_matches(
        points_a,
        points_b,
        "opencv-sift",
        [f"SIFT : {len(key_a)} points référence, {len(key_b)} points photo, {len(good)} correspondances filtrées."],
    )


def _register_orb(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    reference = _enhance(_decode_image(reference_bytes))
    photo = _enhance(_decode_image(photo_bytes))
    detector = cv2.ORB_create(nfeatures=10000, scaleFactor=1.18, nlevels=10, fastThreshold=7)
    key_a, des_a = detector.detectAndCompute(reference, None)
    key_b, des_b = detector.detectAndCompute(photo, None)
    if des_a is None or des_b is None or len(key_a) < 16 or len(key_b) < 16:
        raise ValueError("ORB n'a pas trouvé assez de points caractéristiques.")
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [first for pair in pairs if len(pair) == 2 for first, second in [pair] if first.distance < 0.74 * second.distance]
    if len(good) < 8:
        raise ValueError(f"ORB n'a conservé que {len(good)} correspondances fiables.")
    points_a = np.float32([key_a[item.queryIdx].pt for item in good])
    points_b = np.float32([key_b[item.trainIdx].pt for item in good])
    return _homography_from_matches(
        points_a,
        points_b,
        "opencv-orb",
        [f"ORB : {len(key_a)} points référence, {len(key_b)} points photo, {len(good)} correspondances filtrées."],
    )


def _register_lightglue(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    # LightGlue is optional because torch wheels and CUDA compatibility vary by host.
    # Any import/runtime problem falls back to deterministic OpenCV methods.
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
        [f"LightGlue exécuté sur {device}."],
    )


def register_images(reference_bytes: bytes, photo_bytes: bytes) -> RegistrationResult:
    failures: list[str] = []
    strategies = [
        ("LightGlue", _register_lightglue),
        ("SIFT", _register_sift),
        ("ORB", _register_orb),
    ]
    for label, strategy in strategies:
        try:
            result = strategy(reference_bytes, photo_bytes)
            result.diagnostics = [f"Stratégie retenue : {label}."] + failures + result.diagnostics
            return result
        except Exception as error:  # noqa: BLE001 - every deterministic fallback must be tried.
            failures.append(f"{label} non concluant : {error}")
    raise ValueError("Aucune stratégie de recalage n'a convergé. " + " | ".join(failures))
