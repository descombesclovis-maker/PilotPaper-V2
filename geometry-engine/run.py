from __future__ import annotations

import os

import uvicorn

from main import app
from photo_api import router as photo_router
from photogrammetry_api import router as photogrammetry_router
from site_twin_projection_api import router as site_twin_projection_router

app.include_router(photo_router)
app.include_router(photogrammetry_router)
app.include_router(site_twin_projection_router)


if __name__ == "__main__":
    host = os.environ.get("PILOTPAPER_GEOMETRY_HOST", "127.0.0.1")
    port = int(os.environ.get("PILOTPAPER_GEOMETRY_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)
