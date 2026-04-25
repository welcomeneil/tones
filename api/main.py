import base64
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pipeline import run_pipeline
from api.serialize import zone_index_to_png_bytes, zone_map_to_png_bytes

app = FastAPI(title="tone_zone")

allowed_origin = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

ALLOWED_ALGOS = {"peaks", "kmeans", "otsu"}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    algo: str = Form("kmeans"),
    n: int = Form(5),
    sigma: float = Form(2.0),
):
    if algo not in ALLOWED_ALGOS:
        raise HTTPException(status_code=400, detail=f"algo must be one of {sorted(ALLOWED_ALGOS)}")
    if not 3 <= n <= 15:
        raise HTTPException(status_code=400, detail="n must be between 3 and 15")
    if not 0.1 <= sigma <= 10.0:
        raise HTTPException(status_code=400, detail="sigma must be between 0.1 and 10.0")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        zones, palette, boundaries = run_pipeline(contents, algo=algo, n=n, sigma=sigma)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"pipeline failed: {exc}") from exc

    height, width = zones.shape
    return {
        "width": width,
        "height": height,
        "algo": algo,
        "n": n,
        "palette": [int(v) for v in palette],
        "boundaries": [int(v) for v in boundaries.tolist()],
        "zoneIndexPng": base64.b64encode(zone_index_to_png_bytes(zones)).decode(),
        "zoneMapPng": base64.b64encode(zone_map_to_png_bytes(zones, palette)).decode(),
    }
