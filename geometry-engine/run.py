from __future__ import annotations

import os

import uvicorn

from main import app


if __name__ == "__main__":
    host = os.environ.get("PILOTPAPER_GEOMETRY_HOST", "127.0.0.1")
    port = int(os.environ.get("PILOTPAPER_GEOMETRY_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)
