from __future__ import annotations

import os
import sys
from pathlib import Path


def _configure_bundled_geospatial_runtime() -> None:
    """Point GDAL/PROJ to the data directories bundled by PyInstaller.

    Rasterio and PyProj work from their wheel data during development, but a
    frozen Windows executable has a different filesystem layout. Resolve both
    the PyInstaller extraction root and the onedir _internal layout explicitly
    before importing any geospatial module.
    """

    roots: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(Path(meipass))

    executable_dir = Path(sys.executable).resolve().parent
    roots.extend((executable_dir, executable_dir / "_internal"))

    def first_existing(relative_paths: tuple[Path, ...]) -> Path | None:
        for root in roots:
            for relative in relative_paths:
                candidate = root / relative
                if candidate.is_dir():
                    return candidate
        return None

    gdal_data = first_existing(
        (
            Path("rasterio") / "gdal_data",
            Path("gdal_data"),
        )
    )
    if gdal_data is not None:
        os.environ["GDAL_DATA"] = str(gdal_data)

    proj_data = first_existing(
        (
            Path("pyproj") / "proj_dir" / "share" / "proj",
            Path("pyproj") / "proj_data" / "share" / "proj",
            Path("proj_data") / "share" / "proj",
            Path("share") / "proj",
        )
    )
    if proj_data is not None:
        os.environ["PROJ_DATA"] = str(proj_data)
        os.environ["PROJ_LIB"] = str(proj_data)


_configure_bundled_geospatial_runtime()

import uvicorn

from main import app
from photo_api import router as photo_router
from photogrammetry_api import router as photogrammetry_router

app.include_router(photo_router)
app.include_router(photogrammetry_router)


if __name__ == "__main__":
    host = os.environ.get("PILOTPAPER_GEOMETRY_HOST", "127.0.0.1")
    port = int(os.environ.get("PILOTPAPER_GEOMETRY_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)
