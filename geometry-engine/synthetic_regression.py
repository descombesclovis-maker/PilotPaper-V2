from __future__ import annotations

import math

import numpy as np
from pyproj import CRS
from shapely.geometry import Polygon

from main import _result

CENTER_X = 850_000.0
CENTER_Y = 6_560_000.0
BUILDING_WIDTH_M = 10.0
BUILDING_DEPTH_M = 8.0
RIDGE_ELEVATION_M = 106.0
EAVE_ELEVATION_M = 104.5
GRID_STEP_M = 0.14


def roof_z(relative_y: float) -> float:
    half_depth = BUILDING_DEPTH_M / 2
    rise = RIDGE_ELEVATION_M - EAVE_ELEVATION_M
    return RIDGE_ELEVATION_M - rise * abs(relative_y) / half_depth


def build_points() -> np.ndarray:
    rng = np.random.default_rng(20260916)
    xs = np.arange(-BUILDING_WIDTH_M / 2, BUILDING_WIDTH_M / 2 + 1e-9, GRID_STEP_M)
    ys = np.arange(-BUILDING_DEPTH_M / 2, BUILDING_DEPTH_M / 2 + 1e-9, GRID_STEP_M)
    rows: list[list[float]] = []
    for x in xs:
        for y in ys:
            z = roof_z(float(y)) + float(rng.normal(0, 0.012))
            # Deliberately raise a compact patch on the south pan. The obstacle
            # is large enough to be measurable but too small to become a roof plane.
            if 0.8 <= x <= 1.7 and -2.6 <= y <= -1.8:
                z += 0.52 + float(rng.normal(0, 0.01))
            rows.append([CENTER_X + float(x), CENTER_Y + float(y), z])
    return np.asarray(rows, dtype=np.float64)


def main() -> None:
    building = Polygon([
        (CENTER_X - BUILDING_WIDTH_M / 2, CENTER_Y - BUILDING_DEPTH_M / 2),
        (CENTER_X + BUILDING_WIDTH_M / 2, CENTER_Y - BUILDING_DEPTH_M / 2),
        (CENTER_X + BUILDING_WIDTH_M / 2, CENTER_Y + BUILDING_DEPTH_M / 2),
        (CENTER_X - BUILDING_WIDTH_M / 2, CENTER_Y + BUILDING_DEPTH_M / 2),
    ])
    result = _result(
        build_points(),
        [("synthetic-house", building)],
        CRS.from_epsg(2154),
        "ign-mns",
    )
    origin = result["origin"]
    faces = result["faces"]
    edges = result["edges"]
    confidence = float(result["confidence"])
    diagnostics = result["diagnostics"]

    if len(faces) != 2:
        raise AssertionError(f"Expected exactly 2 roof faces, got {len(faces)}: {diagnostics}")
    if confidence < 0.78:
        raise AssertionError(f"Synthetic Site Twin confidence too low: {confidence:.3f}")

    slopes = sorted(float(face["slopeDeg"]) for face in faces)
    expected_slope = math.degrees(math.atan((RIDGE_ELEVATION_M - EAVE_ELEVATION_M) / (BUILDING_DEPTH_M / 2)))
    if any(abs(slope - expected_slope) > 2.0 for slope in slopes):
        raise AssertionError(f"Unexpected roof slopes {slopes}; expected about {expected_slope:.2f}°")

    ridge_edges = [edge for edge in edges if edge.get("kind") == "ridge"]
    if not ridge_edges:
        raise AssertionError(f"No ridge classified in synthetic gable roof: {edges}")
    longest_ridge = max(
        ridge_edges,
        key=lambda edge: math.hypot(edge["b"]["x"] - edge["a"]["x"], edge["b"]["y"] - edge["a"]["y"]),
    )
    ridge_length = math.hypot(
        longest_ridge["b"]["x"] - longest_ridge["a"]["x"],
        longest_ridge["b"]["y"] - longest_ridge["a"]["y"],
    )
    if ridge_length < BUILDING_WIDTH_M * 0.75:
        raise AssertionError(f"Ridge is too short: {ridge_length:.2f} m")
    if ridge_length > BUILDING_WIDTH_M + 0.25:
        raise AssertionError(f"Ridge exceeds the locked building footprint: {ridge_length:.2f} m")

    obstacles = [obstacle for face in faces for obstacle in face.get("obstacles", [])]
    if not obstacles:
        raise AssertionError("Synthetic raised roof obstacle was not detected")
    if not any(float(obstacle.get("heightM") or 0) >= 0.35 for obstacle in obstacles):
        raise AssertionError(f"Detected obstacle height is implausible: {obstacles}")
    if not all(int(obstacle.get("keepoutMm") or 0) >= 200 for obstacle in obstacles):
        raise AssertionError(f"Obstacle safety envelope is missing: {obstacles}")

    if len(origin) != 2 or not all(math.isfinite(float(value)) for value in origin):
        raise AssertionError(f"Invalid geographic origin: {origin}")
    if not any("Topologie analytique" in str(item) for item in diagnostics):
        raise AssertionError(f"Analytic topology refinement did not run: {diagnostics}")

    print(
        "Synthetic geometry regression passed:",
        f"faces={len(faces)}",
        f"ridge={ridge_length:.2f}m",
        f"obstacles={len(obstacles)}",
        f"confidence={confidence:.3f}",
    )


if __name__ == "__main__":
    main()
