from __future__ import annotations

import base64
import hashlib
import io

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, ImageOps

router = APIRouter()
MAX_INPUT_BYTES = 24 * 1024 * 1024
MAX_EDGE = 4096


@router.post("/v1/photo/normalize")
async def normalize_photo(photo: UploadFile = File(...)):
    raw = await photo.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Photo vide.")
    if len(raw) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="Photo trop lourde : 24 Mo maximum.")
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            if image.width < 64 or image.height < 64:
                raise ValueError("Photo trop petite.")
            scale = min(1.0, MAX_EDGE / max(image.width, image.height))
            if scale < 1.0:
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.Resampling.LANCZOS,
                )
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=94, optimize=True, progressive=False)
            canonical = output.getvalue()
            width, height = image.size
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Image non décodable : {error}") from error

    if len(canonical) < 1000 or canonical[:2] != b"\xff\xd8":
        raise HTTPException(status_code=422, detail="La normalisation n'a pas produit un JPEG valide.")

    decoded = cv2.imdecode(np.frombuffer(canonical, np.uint8), cv2.IMREAD_GRAYSCALE)
    if decoded is None:
        raise HTTPException(status_code=422, detail="Le JPEG normalisé ne peut pas être relu.")
    sharpness = float(cv2.Laplacian(decoded, cv2.CV_64F).var())
    return {
        "mimeType": "image/jpeg",
        "widthPx": int(width),
        "heightPx": int(height),
        "base64": base64.b64encode(canonical).decode("ascii"),
        "digest": hashlib.sha256(canonical).hexdigest(),
        "sharpness": sharpness,
        "warning": "Photo potentiellement floue" if sharpness < 35 else None,
    }
